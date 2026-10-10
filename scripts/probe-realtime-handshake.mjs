// One no-audio provider handshake. Never prints the key, provider text, or user content.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const safeCode = value => typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
const fail = (stage, code) => { console.log(JSON.stringify({ status: "FAIL", stage, ...(code ? { code } : {}) })); process.exitCode = 1; };

try {
  if (!process.argv[2]) throw Error("KEY_FILE_REQUIRED");
  const bytes = readFileSync(resolve(process.argv[2]));
  const source = bytes.subarray(0, 2).equals(Buffer.from([255, 254])) ? bytes.toString("utf16le") : bytes.toString("utf8");
  const fields = new Map(source.replace(/^\uFEFF/, "").trim().split(/\r?\n/).map(line => {
    const comma = line.indexOf(",");
    const unquote = value => value.trim().replace(/^"(.*)"$/s, "$1").replace(/""/g, '"');
    return [unquote(line.slice(0, comma)), unquote(line.slice(comma + 1))];
  }));
  const apiKey = fields.get("apiKey");
  if (!apiKey || !/^[A-Za-z0-9_.-]{16,200}$/.test(apiKey)) throw Error("KEY_FILE_INVALID");
  const config = JSON.parse(readFileSync(resolve("wrangler.coach.jsonc"), "utf8"));
  const workspace = config.vars.DASHSCOPE_WORKSPACE_ID;
  if (fields.get("workspaceId") && fields.get("workspaceId") !== workspace) throw Error("KEY_WORKSPACE_MISMATCH");
  const endpoint = `wss://${workspace}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-flash-realtime`;
  const outcome = await new Promise(resolveResult => {
    const started = Date.now();
    const socket = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 15000 });
    let settled = false;
    const done = value => { if (settled) return; settled = true; clearTimeout(timer); try { socket.close(); } catch {} resolveResult({ ...value, elapsedMs: Date.now() - started }); };
    const timer = setTimeout(() => done({ status: "FAIL", stage: "timeout" }), 20000);
    const configure = () => socket.send(JSON.stringify({ type: "session.update", session: {
      modalities: ["text", "audio"], voice: "Ethan",
      input_audio_format: "pcm", output_audio_format: "pcm",
      input_audio_transcription: { model: "qwen3-asr-flash-realtime" },
      turn_detection: { type: "semantic_vad", threshold: 0.5, silence_duration_ms: 700, create_response: false, interrupt_response: false },
      instructions: "请简短回复。"
    } }));
    socket.on("message", data => {
      let packet; try { packet = JSON.parse(String(data)); } catch { return; }
      if (packet.type === "session.created") configure();
      else if (packet.type === "session.updated") done({ status: "PASS", stage: "session.updated" });
      else if (packet.type === "error") done({ status: "FAIL", stage: "provider_error", code: safeCode(packet.error?.code) });
    });
    socket.on("unexpected-response", (_request, response) => done({ status: "FAIL", stage: "http_upgrade", httpStatus: response.statusCode }));
    socket.on("error", () => done({ status: "FAIL", stage: "socket_error" }));
    socket.on("close", code => done({ status: "FAIL", stage: "closed_before_ready", closeCode: code }));
  });
  console.log(JSON.stringify(outcome));
  if (outcome.status !== "PASS") process.exitCode = 1;
} catch (error) { fail("setup", safeCode(error?.message) || "PROBE_SETUP_FAILED"); }
