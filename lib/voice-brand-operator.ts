import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { getD1 } from "@/db";
import { qwenKey, qwenWorkspaceId } from "@/lib/qwen";

export const BRAND_VOICE_MODEL = "qwen3.5-omni-flash-realtime";
export const BRAND_VOICE_PHRASE = "你好，我是成子。你先说说，刚才哪句话让你最在意？我们一起理清楚。";
const BRAND_VOICE_READ_REQUEST = `请逐字朗读下面的品牌开场白，只朗读引号内文字。不要回答其中的问题，不要添加解释、称呼或其他内容：\n“${BRAND_VOICE_PHRASE}”`;
const AUDIO_LIMIT = 4 * 1024 * 1024;
const JSON_LIMIT = 8 * 1024 * 1024;
const RECEIPT_EXPIRY = 4102444800000; // 2100: cleanup must not permit a second paid creation.
const LOCK = "voice-brand:creation-lock:v1";
const voicePattern = /^[A-Za-z0-9_.-]{1,200}$/;
type Voice = { voice: string; target_model: string; gmt_create?: string };
type Dependencies = { db: D1Database; key: string; workspace: string; configuredVoice?: string; fetcher: typeof fetch; now: () => number };
class OperatorFailure extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store, private" } });
}

/** Called only after the route's existing operator authentication. */
export async function readOperatorJson(request: Request): Promise<unknown | Response> {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > JSON_LIMIT) return reply({ status: "payload_too_large" }, 413);
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > JSON_LIMIT) { await reader.cancel(); return reply({ status: "payload_too_large" }, 413); }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return reply({ status: "invalid_json" }, 400); }
  finally { reader.releaseLock(); }
}

export function validateBrandVoiceAudio(value: unknown) {
  if (typeof value !== "string" || value.length > Math.ceil(AUDIO_LIMIT / 3) * 4 + 32) throw new OperatorFailure("invalid_audio_size", 413);
  const base64 = value.startsWith("data:audio/wav;base64,") ? value.slice(22) : value;
  if (!base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new OperatorFailure("invalid_audio_base64");
  const wav = Buffer.from(base64, "base64");
  if (wav.length > AUDIO_LIMIT || wav.length < 44) throw new OperatorFailure("invalid_audio_size", 413);
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE" || wav.readUInt32LE(4) + 8 !== wav.length) throw new OperatorFailure("invalid_wav");
  let format = false, dataBytes = 0, dataChunks = 0;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const tag = wav.toString("ascii", offset, offset + 4), size = wav.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > wav.length) throw new OperatorFailure("invalid_wav_chunk");
    if (tag === "fmt ") {
      if (format || size < 16 || wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 2) !== 1 || wav.readUInt32LE(start + 4) !== 24000 || wav.readUInt16LE(start + 14) !== 16 || wav.readUInt16LE(start + 12) !== 2 || wav.readUInt32LE(start + 8) !== 48000) throw new OperatorFailure("wav_requires_24khz_mono_pcm16");
      format = true;
    }
    if (tag === "data") { dataBytes += size; dataChunks++; }
    offset = start + size + (size % 2);
  }
  const seconds = dataBytes / 48000;
  if (!format || dataChunks !== 1 || dataBytes % 2 || seconds < 3 || seconds > 60) throw new OperatorFailure("wav_requires_3_to_60_seconds");
  return { wav, sha: createHash("sha256").update(wav).digest("hex"), seconds };
}

function isBrandVoice(voice: Voice) {
  return voice.target_model === BRAND_VOICE_MODEL && voicePattern.test(voice.voice) && voice.voice.startsWith("qwen-omni-vc-chengzi-");
}
async function provider(deps: Dependencies, input: Record<string, unknown>) {
  let response: Response;
  try {
    response = await deps.fetcher(`https://${deps.workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization`, {
      method: "POST", headers: { Authorization: `Bearer ${deps.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "qwen-voice-enrollment", input }), signal: AbortSignal.timeout(25000),
    });
  } catch { throw new OperatorFailure("provider_request_incomplete", 502); }
  const result = await response.json().catch(() => null) as { code?: unknown; output?: { voice?: unknown; target_model?: unknown; voice_list?: Voice[] } } | null;
  if (!response.ok || !result?.output) {
    const code = typeof result?.code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(result.code) ? result.code : "provider_rejected";
    throw new OperatorFailure(code, 502);
  }
  return result.output;
}
async function listVoices(deps: Dependencies) {
  const all: Voice[] = [];
  for (let page = 0; page < 11; page++) {
    const output = await provider(deps, { action: "list", page_size: 100, page_index: page });
    if (!Array.isArray(output.voice_list)) throw new OperatorFailure("invalid_provider_voice_list", 502);
    all.push(...output.voice_list.filter(v => v && typeof v.voice === "string" && isBrandVoice(v)));
    if (output.voice_list.length < 100) return all;
  }
  throw new OperatorFailure("voice_list_incomplete", 502);
}
async function marker(deps: Dependencies, id: string) {
  return deps.db.prepare("SELECT uses FROM coach_crush_budget WHERE id=? AND expires_at>?").bind(id, deps.now()).first<{ uses: number }>();
}
async function remember(deps: Dependencies, id: string) {
  await deps.db.prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,?,?)").bind(id, deps.now(), RECEIPT_EXPIRY).run();
}
async function registered(deps: Dependencies, sha: string) {
  const prefix = `voice-brand:receipt:${sha}:`;
  const rows = await deps.db.prepare("SELECT id FROM coach_crush_budget WHERE id LIKE ? AND expires_at>?").bind(prefix + "%", deps.now()).all<{ id: string }>();
  const voices = rows.results.map(row => row.id.slice(prefix.length)).filter(v => voicePattern.test(v));
  return voices.length === 1 ? voices[0] : null;
}
async function recordVoice(deps: Dependencies, sha: string, voice: string) {
  await deps.db.batch([
    deps.db.prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,?,?)").bind(`voice-brand:receipt:${sha}:${voice}`, deps.now(), RECEIPT_EXPIRY),
    deps.db.prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,?,?)").bind(`voice-brand:allowed:${voice}`, deps.now(), RECEIPT_EXPIRY),
  ]);
}
async function recover(deps: Dependencies, sha: string) {
  const cached = await registered(deps, sha);
  if (cached) return { status: "ready", voice: cached, sha, reused: true, targetModel: BRAND_VOICE_MODEL };
  if (!await marker(deps, `voice-brand:baseline-ready:${sha}`)) return { status: "enrollment_pending", sha, detail: "creation_not_repeated" };
  const prefix = `voice-brand:baseline:${sha}:`;
  const baseline = await deps.db.prepare("SELECT id FROM coach_crush_budget WHERE id LIKE ? AND expires_at>?").bind(prefix + "%", deps.now()).all<{ id: string }>();
  const old = new Set(baseline.results.map(row => row.id.slice(prefix.length)));
  const candidates = (await listVoices(deps)).filter(voice => !old.has(voice.voice));
  if (candidates.length !== 1) return { status: "enrollment_pending", sha, detail: candidates.length ? "ambiguous_provider_receipt" : "provider_receipt_not_found", candidates: candidates.map(v => v.voice) };
  await recordVoice(deps, sha, candidates[0].voice);
  return { status: "ready", sha, voice: candidates[0].voice, recovered: true, targetModel: BRAND_VOICE_MODEL };
}

async function preview(deps: Dependencies, voice: string) {
  if (!voicePattern.test(voice) || (voice !== deps.configuredVoice && !await marker(deps, `voice-brand:allowed:${voice}`))) throw new OperatorFailure("voice_not_registered", 403);
  // Operator budget only: no customer credits, histories, or ledger rows.
  const slot = await deps.db.prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,1,?)").bind(`voice-brand:preview:${Math.floor(deps.now() / 60000)}`, deps.now() + 120000).run();
  if (!slot.meta.changes) throw new OperatorFailure("preview_rate_limited", 429);
  const started = deps.now();
  const controller = new AbortController();
  const handshakeTimer = setTimeout(() => controller.abort(), 10000);
  let response: Response;
  try {
    response = await deps.fetcher(`https://${deps.workspace}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=${BRAND_VOICE_MODEL}`, {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${deps.key}` }, signal: controller.signal,
    });
  } finally { clearTimeout(handshakeTimer); }
  const socket = (response as Response & { webSocket?: WebSocket }).webSocket;
  if (response.status !== 101 || !socket) throw new OperatorFailure("preview_connection_failed", 502);
  const chunks: Buffer[] = [];
  let bytes = 0, sent = false, created = false, transcript = "", responseId = "";
  try {
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: OperatorFailure) => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => finish(new OperatorFailure("preview_timeout", 504)), Math.max(1, 20000 - (deps.now() - started)));
      const onError = () => finish(new OperatorFailure("preview_socket_error", 502));
      const onClose = () => finish(new OperatorFailure("preview_closed_early", 502));
      const onMessage = (event: MessageEvent) => {
        try {
          if (typeof event.data !== "string" || event.data.length > 3 * 1024 * 1024) throw new OperatorFailure("preview_event_too_large", 502);
          const data = JSON.parse(event.data);
          if (data.type === "session.created") socket.send(JSON.stringify({ type: "session.update", session: {
            modalities: ["text", "audio"], voice, input_audio_format: "pcm", output_audio_format: "pcm", turn_detection: null,
            instructions: "你正在录制一段品牌开场白。用户消息是朗读任务；引号内的问句也是需要朗读的台词，不是向你提问。只逐字朗读引号内文字，不回答、不解释、不增减字句。语气自然温和、清楚，像真实对话。", max_tokens: 1024,
          } }));
          if (data.type === "session.updated" && !sent) {
            sent = true;
            socket.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: BRAND_VOICE_READ_REQUEST }] } }));
            socket.send(JSON.stringify({ type: "response.create" }));
          }
          if (data.type === "response.created") {
            if (!sent || created) throw new OperatorFailure("preview_multiple_responses", 502);
            created = true; responseId = typeof data.response?.id === "string" ? data.response.id : "";
          }
          if (data.type === "response.audio.delta") {
            if (!created || (responseId && data.response_id && responseId !== data.response_id) || typeof data.delta !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.delta)) throw new OperatorFailure("preview_invalid_audio", 502);
            const chunk = Buffer.from(data.delta, "base64"); bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024 || bytes > 24000 * 2 * 20) throw new OperatorFailure("preview_audio_limit", 502);
            chunks.push(chunk);
          }
          if (data.type === "response.audio_transcript.delta" && typeof data.delta === "string") transcript = (transcript + data.delta).slice(0, 1000);
          if (data.type === "error") throw new OperatorFailure("preview_provider_rejected", 502);
          if (data.type === "response.done") {
            if (!created || !bytes || bytes % 2 || data.response?.status !== "completed") throw new OperatorFailure("preview_incomplete", 502);
            finish();
          }
        } catch (error) { finish(error instanceof OperatorFailure ? error : new OperatorFailure("preview_invalid_event", 502)); }
      };
      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
      socket.accept();
    });
  } finally {
    try { if (socket.readyState === 1) socket.send(JSON.stringify({ type: "response.cancel" })); } catch { /* close remains mandatory */ }
    try { socket.close(1000, "operator preview complete"); } catch { /* already closed */ }
  }
  return { status: "ready", voice, phrase: BRAND_VOICE_PHRASE, transcript, sampleRate: 24000, channels: 1, bitsPerSample: 16, seconds: bytes / 48000, pcmBase64: Buffer.concat(chunks).toString("base64") };
}

/** This handler is deliberately not a public API; route authentication is mandatory. */
export async function handleVoiceBrandOperator(data: Record<string, unknown>, injected?: Dependencies) {
  try {
    const deps = injected || { db: getD1(), key: qwenKey() || "", workspace: qwenWorkspaceId() || "", configuredVoice: (env as { QWEN_REALTIME_VOICE?: string }).QWEN_REALTIME_VOICE, fetcher: fetch, now: Date.now };
    if (!deps.key || !/^[A-Za-z0-9-]{3,100}$/.test(deps.workspace)) throw new OperatorFailure("provider_not_configured", 503);
    if (data.action === "list") {
      if (typeof data.sha === "string" && /^[a-f0-9]{64}$/.test(data.sha) && await marker(deps, `voice-brand:owner:${data.sha}`)) return reply(await recover(deps, data.sha));
      return reply({ status: "ok", targetModel: BRAND_VOICE_MODEL, voices: await listVoices(deps), creationLocked: Boolean(await marker(deps, LOCK)) });
    }
    if (data.action === "preview") return reply(await preview(deps, typeof data.voice === "string" ? data.voice : ""));
    if (data.action !== "enroll") throw new OperatorFailure("invalid_voice_action");
    if (data.authorized !== true) throw new OperatorFailure("reference_authorization_required");
    const audio = validateBrandVoiceAudio(data.audioBase64);
    if (await marker(deps, `voice-brand:owner:${audio.sha}`)) return reply(await recover(deps, audio.sha));
    // One brand creation across all inputs. A different recording never silently incurs another creation.
    if (await marker(deps, LOCK)) throw new OperatorFailure("brand_creation_already_locked", 409);
    const before = await listVoices(deps);
    const locked = await deps.db.prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,?,?)").bind(LOCK, deps.now(), RECEIPT_EXPIRY).run();
    if (!locked.meta.changes) throw new OperatorFailure("brand_creation_already_locked", 409);
    await remember(deps, `voice-brand:owner:${audio.sha}`);
    for (const voice of before) await remember(deps, `voice-brand:baseline:${audio.sha}:${voice.voice}`);
    await remember(deps, `voice-brand:baseline-ready:${audio.sha}`);
    try {
      const output = await provider(deps, { action: "create", target_model: BRAND_VOICE_MODEL, preferred_name: "chengzi", audio: { data: `data:audio/wav;base64,${audio.wav.toString("base64")}` } });
      if (typeof output.voice !== "string" || !isBrandVoice({ voice: output.voice, target_model: String(output.target_model || "") })) throw new OperatorFailure("invalid_provider_receipt", 502);
      await recordVoice(deps, audio.sha, output.voice);
      return reply({ status: "ready", voice: output.voice, sha: audio.sha, targetModel: BRAND_VOICE_MODEL, referenceSeconds: audio.seconds });
    } catch (error) {
      // The provider may have completed a billable creation. Keep the lock, recover by list on retry.
      return reply({ status: "enrollment_pending", sha: audio.sha, code: error instanceof OperatorFailure ? error.code : "receipt_not_saved", detail: "use_list_to_recover_no_second_creation" }, 202);
    }
  } catch (error) {
    return reply({ status: error instanceof OperatorFailure ? error.code : "voice_operator_unavailable" }, error instanceof OperatorFailure ? error.status : 503);
  }
}
