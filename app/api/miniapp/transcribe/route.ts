import { miniappOwner } from "@/lib/miniapp-auth";
import { getD1 } from "@/db";
import { transcribeWechatAudio, voicePublicError } from "@/lib/wechat-asr";
import { CREDIT_PRICES } from "@/lib/account-credits.mjs";
import { creditResponse } from "@/lib/credit-response.mjs";

export const runtime = "edge";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

async function executeRequest(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请返回首页重试。" }, 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 2_700_000) return json({ error: "录音太长，请分段说。" }, 413);
  let body: { audio?: unknown; confirmed?: unknown; requestId?: unknown };
  try { const raw = await request.text(); if (raw.length > 2_700_000) return json({ error: "录音太长，请分段说。" }, 413); body = JSON.parse(raw); }
  catch { return json({ error: "没有收到录音。" }, 400); }
  if (body.confirmed !== true) return json({ error: "请先同意本次语音识别。" }, 400);
  if (typeof body.audio !== "string" || body.audio.length < 200 || body.audio.length > 2_666_668 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio)) return json({ error: "录音格式不正确。" }, 400);
  const bytes = Buffer.from(body.audio, "base64");
  if (bytes.length > 2_000_000 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "RIFF" || new TextDecoder().decode(bytes.subarray(8, 12)) !== "WAVE") return json({ error: "仅支持 30 秒内的 WAV 录音。" }, 400);
  const db = getD1(), day = new Date().toISOString().slice(0, 10), now = Date.now();
  for (const [key, limit] of [[identity.ownerId + ":mini-asr:" + day, 30], ["global:mini-asr:" + day, 500]] as Array<[string, number]>) {
    await db.prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,0,?)").bind(key, now + 2 * 86400000).run();
    const spent = await db.prepare("UPDATE coach_crush_budget SET uses=uses+1 WHERE id=? AND uses<?").bind(key, limit).run();
    if (!spent.meta.changes) return json({ error: "今天的语音识别已达到试运行上限，请明天再试。" }, 429);
  }
  try {
    const result = await transcribeWechatAudio(bytes, "wav", AbortSignal.timeout(35000));
    
    return json({ text: result.text.slice(0, 1500) });
  } catch (error) { return json({ error: voicePublicError(error) }, 503); }
}

export async function POST(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  return creditResponse(getD1(), identity.ownerId, request, "chat", CREDIT_PRICES.transcription, () => executeRequest(request));
}
