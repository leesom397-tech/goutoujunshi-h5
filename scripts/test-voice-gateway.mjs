import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("worker-entry.mjs", "utf8");
let body = source.slice(source.indexOf("const realtimeSession="));
assert.ok(body.startsWith("const realtimeSession="));
body = `const CREDIT_PRICES={voice:20}; const reserveCredits=async()=>({execute:true}); const requireNewCreditTask=()=>{}; const finishCreditTask=async()=>{}; class CreditError extends Error{}; const createVoiceTurnGuard=()=>({output(){},playback(){},accept(){return true;}});\n` + body;
// This protocol test isolates transport. Actual cookie/token ownership and
// billing are exercised with SQLite by test-web-api.mjs.
body = `const requestOwner=async request=>/^Bearer a{64}$/.test(request.headers.get('Authorization')||'')?{ownerId:'test-owner'}:null; const isWebApi=request=>String(request.url||'').includes('/api/web/');\n` + body;
const session = new Function(body + "\nreturn realtimeSession();")();
assert.equal(session.input_audio_format, "pcm");
assert.equal(session.output_audio_format, "pcm");
assert.equal(session.audio, undefined, "the gateway and clients retain their compatible flat PCM format configuration");

class FakeSocket {
  constructor() { this.readyState = 1; this.sent = []; this.listeners = {}; }
  accept() {}
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  send(packet) { this.sent.push(JSON.parse(packet)); }
  close() { this.readyState = 3; }
  emit(type, event = {}) { for (const callback of this.listeners[type] || []) callback(event); }
}
class FakeResponse {
  constructor(_body, options) { Object.assign(this, options); }
  static json(body, options) { return { body, ...options, async json() { return body; } }; }
}

{
  let upgradeSignal;
  const connectRealtime = new Function("fetch", body + "\nreturn connectRealtime;")(
    async (_url, options) => { upgradeSignal = options.signal; return { status: 101 }; }
  );
  await connectRealtime({ DASHSCOPE_WORKSPACE_ID: "test-space", DASHSCOPE_API_KEY: "fake-provider-key" }, 5);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(upgradeSignal.aborted, false, "the upgrade timeout must not later abort an established voice WebSocket");
}

async function checkProbe(status, expectedStage) {
  const upstream = new FakeSocket();
  if (status === 101) upstream.send = function(packet) {
    this.sent.push(JSON.parse(packet));
    this.emit("message", { data: JSON.stringify({ type: "session.updated" }) });
  };
  if (status === 101) upstream.accept = function() {
    queueMicrotask(() => this.emit("message", { data: JSON.stringify({ type: "session.created" }) }));
  };
  const checkLiveVoice = new Function("Response", "fetch", body + "\nreturn checkLiveVoice;")(
    FakeResponse, async () => status === 101 ? { status, webSocket: upstream } : { status }
  );
  const env = {
    MINIAPP_APPID: "test-app", MINIAPP_APPSECRET: "test-secret",
    DASHSCOPE_API_KEY: "fake-provider-key", DASHSCOPE_WORKSPACE_ID: "test-space", QWEN_REALTIME_VOICE: "qwen-omni-vc-test-voice-20260911161744020-3f9d",
    DB: { prepare() { return { bind() { return { async first() { return { owner_id: "test-owner" }; }, async run() { return { meta: { changes: 1 } }; } }; } }; } }
  };
  const request = { method: "GET", headers: new Headers({ Authorization: "Bearer " + "a".repeat(64) }) };
  const response = await checkLiveVoice(request, env);
  assert.equal(response.body.stage, expectedStage);
  assert.equal(JSON.stringify(response.body).includes("fake-provider-key"), false);
  if (status === 101) { assert.equal(upstream.sent[0].type, "session.update"); assert.equal(upstream.sent[0].session.voice, env.QWEN_REALTIME_VOICE, "health check validates the selected production voice"); }
  const unauthorized = await checkLiveVoice({ method: "GET", headers: new Headers() }, env);
  assert.equal(unauthorized.status, 401);
}

async function probe(ready, expectedCode, closeCode = 4001) {
  const upstream = new FakeSocket();
  let server;
  class FakePair {
    constructor() { server = new FakeSocket(); return { 0: new FakeSocket(), 1: server }; }
  }
  let fetchCount = 0;
  const liveVoice = new Function("Response", "WebSocketPair", "fetch", body + "\nreturn liveVoice;")(
    FakeResponse, FakePair, async () => ++fetchCount === 1 ? { status: 101, webSocket: upstream } : { status: 401 }
  );
  const env = {
    MINIAPP_APPID: "test-app", MINIAPP_APPSECRET: "test-secret",
    DASHSCOPE_API_KEY: "fake-provider-key", DASHSCOPE_WORKSPACE_ID: "test-space",
    DB: { prepare() { return { bind() { return { async first() { return { owner_id: "test-owner" }; }, async run() { return { meta: { changes: 1 } }; } }; } }; } }
  };
  const response = await liveVoice({ url: "https://coach.lovetalk.love/api/miniapp/voice-live?requestId=11111111-1111-4111-8111-111111111111", headers: new Headers({ Upgrade: "websocket", Authorization: "Bearer " + "a".repeat(64) }) }, env);
  assert.equal(response.status, 101);
  assert.equal(upstream.sent.length, 0, "wait for session.created before sending session.update");
  upstream.emit("message", { data: JSON.stringify({ type: "session.created" }) });
  assert.equal(upstream.sent[0].type, "session.update");
  if (ready) upstream.emit("message", { data: JSON.stringify({ type: "session.updated" }) });
  upstream.emit("close", { code: closeCode });
  for (let attempt=0; attempt<50 && server.readyState!==3; attempt++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(server.sent.at(-1).type, "error");
  assert.equal(server.sent.at(-1).error.code, expectedCode);
  assert.equal(server.readyState, 3);
  assert.equal(fetchCount, 1, "a failed call must not silently open another paid provider connection for diagnosis");
  assert.equal(typeof server.sent.at(-1).error.message, "string", "client errors have an actionable user message");
}

await probe(false, "UPSTREAM_CLOSED_BEFORE_READY_4001");
await probe(true, "UPSTREAM_CLOSED_4001");
await probe(false, "UPSTREAM_CLOSED_BEFORE_READY_1006", 1006);
await checkProbe(101, "ready");
await checkProbe(401, "upgrade_rejected");
{
  const status = new Function("Response", body + "\nreturn liveVoiceStatus;")(FakeResponse);
  const env = { MINIAPP_APPID: "test-app", MINIAPP_APPSECRET: "test-secret", DASHSCOPE_API_KEY: "fake-key", DASHSCOPE_WORKSPACE_ID: "test-space",
    DB: { prepare(sql) { return { bind() { return { async first() { return sql.includes("SELECT uses") ? { uses: 12 } : { owner_id: "test-owner" }; } }; } }; } } };
  const response = await status({ method: "GET", headers: new Headers({ Authorization: "Bearer " + "a".repeat(64) }) }, env);
  assert.equal(response.body.remaining, 18, "voice status must report remaining attempts without exposing the owner");
  assert.equal(response.body.configured, true);
}
{
  let budgetWrites = 0;
  const liveVoice = new Function("Response", "fetch", body + "\nreturn liveVoice;")(FakeResponse, async () => ({ status: 503 }));
  const env = { MINIAPP_APPID: "test-app", MINIAPP_APPSECRET: "test-secret", DASHSCOPE_API_KEY: "fake-key", DASHSCOPE_WORKSPACE_ID: "test-space",
    DB: { prepare(sql) { return { bind() { return { async first() { return sql.includes("SELECT uses") ? { uses: 0 } : { owner_id: "test-owner" }; }, async run() { budgetWrites++; return { meta: { changes: 1 } }; } }; } }; } } };
  const response = await liveVoice({ url: "https://coach.lovetalk.love/api/miniapp/voice-live?requestId=11111111-1111-4111-8111-111111111111", headers: new Headers({ Upgrade: "websocket", Authorization: "Bearer " + "a".repeat(64) }) }, env);
  assert.equal(response.status, 503);
  assert.equal(budgetWrites, 0, "failed upstream handshakes must not consume a voice call");
}
console.log("Voice gateway close-reason propagation passed without network or audio.");
