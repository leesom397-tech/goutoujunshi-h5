import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as credits from '../lib/account-credits.mjs';
import { createVoiceTurnGuard } from '../lib/voice-turn-guard.mjs';

// Execute the production gateway handlers, real turn guard, credit service and
// SQLite triggers; only transport, the clock and already-verified identity are fake.
const source = readFileSync(new URL('../worker-entry.mjs', import.meta.url), 'utf8');
const handlers = source.slice(source.indexOf('const realtimeSession='));
assert.ok(handlers.startsWith('const realtimeSession='));
class Socket {
  readyState = 1; sent = []; listeners = {};
  accept() {}
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  send(raw) { if (this.readyState !== 1) throw Error('socket closed'); this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
  async emit(type, event = {}) { await Promise.all((this.listeners[type] || []).map(fn => fn(event))); }
  packet(packet) { return this.emit('message', { data: JSON.stringify(packet) }); }
  of(type) { return this.sent.filter(packet => packet.type === type); }
}
class TestResponse {
  constructor(_body, options) { Object.assign(this, options); }
  static json(body, options) { return { body, ...options, async json() { return body; } }; }
}
async function fixture(extraEnv = {}) {
  const sql = new DatabaseSync(':memory:');
  for (const name of ['0003_wealthy_stephen_strange', '0015_account_credits']) sql.exec(readFileSync(new URL('../drizzle/' + name + '.sql', import.meta.url), 'utf8'));
  const db = { prepare(query) { let values = []; return {
    bind(...v) { values = v; return this; },
    async first() { return sql.prepare(query).get(...values) || null; },
    async all() { return { results: sql.prepare(query).all(...values) }; },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } }; },
  }; } };
  const ownerId = 'voice-lifecycle-test';
  await credits.ensureCreditAccount(db, ownerId);
  await credits.adjustCredits(db, { id: crypto.randomUUID(), ownerId, actorId: 'fixture', delta: 100, reason: '离线回归测试' });
  await credits.setCreditPermissions(db, { id: crypto.randomUUID(), ownerId, actorId: 'fixture', features: ['voice'], enabledUntil: Date.now() + 86400000, reason: '离线回归测试' });
  const timers = new Map(), settlements = [];
  let timerId = 0, fetches = 0, server;
  const upstream = new Socket();
  class Pair { constructor() { server = new Socket(); return { 0: new Socket(), 1: server }; } }
  const dependencies = {
    Response: TestResponse, WebSocketPair: Pair,
    fetch: async () => { fetches++; return { status: 101, webSocket: upstream }; },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    requestOwner: async () => ({ ownerId }), createVoiceTurnGuard,
    CREDIT_PRICES: credits.CREDIT_PRICES, reserveCredits: credits.reserveCredits,
    requireNewCreditTask: credits.requireNewCreditTask, CreditError: credits.CreditError,
    finishCreditTask: credits.finishCreditTask,
  };
  const liveVoice = new Function(...Object.keys(dependencies), handlers + '\nreturn liveVoice;')(...Object.values(dependencies));
  const env = { DB: db, DASHSCOPE_API_KEY: 'offline-test-placeholder', DASHSCOPE_WORKSPACE_ID: 'test-space', ...extraEnv };
  const requestId = crypto.randomUUID();
  const request = id => ({ url: 'https://example.test/api/web/voice-live?requestId=' + id, headers: new Headers({ Upgrade: 'websocket' }) });
  const ctx = { waitUntil(promise) { settlements.push(promise); } };
  const start = id => liveVoice(request(id || requestId), env, ctx);
  const result = await start(); assert.equal(result.status, 101);
  const balance = () => sql.prepare('SELECT balance FROM coach_credit_accounts WHERE owner_id=?').get(ownerId).balance;
  const task = () => sql.prepare('SELECT * FROM coach_credit_tasks WHERE owner_id=? AND request_id=?').get(ownerId, requestId);
  const flush = async () => { await Promise.all(settlements); };
  return { upstream, server, timers, settlements, sql, start, balance, task, flush,
    fetches: () => fetches,
    ready: async () => { await upstream.packet({ type: 'session.created' }); await upstream.packet({ type: 'session.updated' }); },
    asr: (id, text) => upstream.packet({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text }),
    timeout: async ms => { const entry = [...timers].find(([, value]) => value.ms === ms); assert.ok(entry, 'expected timer ' + ms); timers.delete(entry[0]); await entry[1].fn(); await flush(); },
    close: async () => { await server.emit('close'); await flush(); sql.close(); },
  };
}

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
await test('credit reservation, duplicate start and refund are idempotent', async () => {
  const f = await fixture();
  assert.equal(f.balance(), 80); assert.equal(f.task().status, 'reserved');
  assert.equal((await f.start()).status, 409); assert.equal(f.fetches(), 1);
  await f.server.emit('close'); await f.flush();
  assert.equal(f.balance(), 100); assert.equal(f.task().status, 'released');
  await f.upstream.emit('close', { code: 1006 }); await f.flush();
  assert.equal(f.settlements.length, 1); assert.equal(f.balance(), 100);
  assert.equal((await f.start()).status, 409); assert.equal(f.fetches(), 1);
  await f.close();
});
await test('session config, custom voice and authoritative duration metadata', async () => {
  const voice = 'qwen-omni-vc-test-voice-20260911161744020-3f9d';
  const f = await fixture({ QWEN_REALTIME_VOICE: voice, QWEN_REALTIME_STYLE: '自然交流\n短句' });
  await f.server.packet({ type: 'input_audio_buffer.append', audio: 'AAA=' });
  assert.equal(f.upstream.sent.length, 0, 'audio cannot precede session configuration');
  const started = Date.now(); await f.ready();
  const session = f.upstream.of('session.update')[0].session;
  assert.equal(session.voice, voice); assert.equal(session.input_audio_format, 'pcm'); assert.equal(session.output_audio_format, 'pcm');
  assert.equal(session.turn_detection.create_response, false); assert.equal(session.turn_detection.interrupt_response, false);
  assert.ok(session.instructions.includes('40到100字')); assert.ok(session.instructions.includes('自然交流 短句'));
  assert.ok(session.instructions.includes('没有授权使用档案'));
  await f.upstream.packet({ type: 'session.updated' });
  const meta = f.server.of('gateway.session_meta'); assert.equal(meta.length, 1);
  assert.equal(meta[0].maxDurationSeconds, 180); assert.ok(meta[0].expiresAt >= started + 180000 && meta[0].expiresAt <= Date.now() + 180000);
  assert.deepEqual([...f.timers.values()].map(value => value.ms), [180000]);
  await f.server.packet({ type: 'input_audio_buffer.append', audio: 'AAA=' });
  await f.server.packet({ type: 'response.create' });
  assert.equal(f.upstream.of('input_audio_buffer.append').length, 1); assert.equal(f.upstream.of('response.create').length, 0);
  await f.close();
  const fallback = await fixture({ QWEN_REALTIME_VOICE: 'invalid voice\n', QWEN_REALTIME_STYLE: 'a'.repeat(1000) });
  await fallback.ready(); const configured = fallback.upstream.of('session.update')[0].session;
  assert.equal(configured.voice, 'Ethan'); assert.ok(!configured.instructions.includes('a'.repeat(501))); await fallback.close();
});
await test('manual interrupt drops remaining answer and waits for next utterance', async () => {
  const f = await fixture(); await f.ready(); await f.asr('u1', '我想聊聊昨天的约会');
  assert.equal(f.upstream.of('response.create').length, 1);
  await f.upstream.packet({ type: 'response.created', response: { id: 'r1' } });
  await f.server.packet({ type: 'gateway.interrupt' }); await f.server.packet({ type: 'gateway.interrupt' });
  assert.equal(f.upstream.of('response.cancel').length, 1);
  await f.upstream.packet({ type: 'response.audio.delta', response_id: 'r1', delta: 'AAA=' });
  await f.upstream.packet({ type: 'response.audio_transcript.delta', response_id: 'r1', delta: '旧回答' });
  await f.upstream.packet({ type: 'response.done', response: { id: 'r1', status: 'cancelled' } });
  assert.equal(f.server.of('response.audio.delta').length, 0); assert.equal(f.server.of('response.audio_transcript.delta').length, 0);
  assert.equal(f.upstream.of('response.create').length, 1, 'interrupt alone cannot begin another answer');
  await f.asr('u2', '我想补充具体发生的事情'); assert.equal(f.upstream.of('response.create').length, 2);
  // An old cancellation completion can arrive after a new response is requested,
  // before the provider announces its new response id. It must not reset it.
  await f.upstream.packet({ type: 'response.done', response: { id: 'r1', status: 'cancelled' } });
  await f.asr('u3', '还有一件事需要一起考虑');
  assert.equal(f.upstream.of('response.create').length, 2, 'late old completion must not create overlapping responses');
  await f.close(); assert.equal(f.settlements.length, 1);
});
await test('accepted barge-in cancels once, queues once, and rejects echoed/duplicate turns', async () => {
  const f = await fixture(); await f.ready(); await f.asr('u1', '他昨天说忙我应该怎么办');
  await f.upstream.packet({ type: 'response.created', response: { id: 'r1' } });
  await f.upstream.packet({ type: 'response.audio_transcript.delta', response_id: 'r1', delta: '可以先问问他方便的时间，留出空间。' });
  await f.asr('echo', '可以先问问他方便的时间');
  assert.equal(f.upstream.of('response.cancel').length, 0);
  await f.asr('u2', '我还有个问题需要说一下'); await f.asr('u2', '我还有个问题需要说一下');
  assert.equal(f.upstream.of('response.cancel').length, 1); assert.equal(f.upstream.of('response.create').length, 1);
  await f.upstream.packet({ type: 'response.done', response: { id: 'r1', status: 'cancelled' } });
  assert.equal(f.upstream.of('response.create').length, 2); assert.equal(f.server.of('gateway.user_turn').length, 2);
  await f.close();
});
await test('cancel/complete race recovers to the pending utterance without ending call', async () => {
  const f = await fixture(); await f.ready(); await f.asr('u1', '请帮我分析');
  await f.asr('u2', '我再补充一点');
  await f.upstream.packet({ type: 'error', error: { code: 'response_cancel_not_active', message: 'already finished' } });
  assert.equal(f.upstream.of('response.create').length, 2); assert.equal(f.server.readyState, 1); assert.equal(f.server.of('error').length, 0);
  await f.close();
});
await test('only valid delivered PCM settles credits, at most once', async () => {
  const f = await fixture(); await f.ready();
  await f.upstream.packet({ type: 'response.audio.delta', response_id: 'r1', delta: 'AAA=' });
  assert.equal(f.server.of('response.audio.delta').length, 1);
  await f.server.emit('close'); await f.flush(); await f.upstream.emit('close', { code: 1006 }); await f.flush();
  assert.equal(f.task().status, 'settled'); assert.equal(f.balance(), 80); assert.equal(f.settlements.length, 1); await f.close();
  const empty = await fixture(); await empty.ready();
  for (const delta of ['', 'AA==', 'not-audio', 'A===']) await empty.upstream.packet({ type: 'response.audio.delta', delta });
  assert.equal(empty.server.of('response.audio.delta').length, 0);
  await empty.server.emit('close'); await empty.flush(); assert.equal(empty.balance(), 100); assert.equal(empty.task().status, 'released'); await empty.close();
  const lost = await fixture(); await lost.ready();
  lost.server.send = () => { throw Error('client transport is gone'); };
  await lost.upstream.packet({ type: 'response.audio.delta', delta: 'AAA=' });
  await lost.server.emit('close'); await lost.flush(); assert.equal(lost.balance(), 100, 'provider generation alone is not a delivered answer'); await lost.close();
});
await test('ASR failure gives a retry message without closing or leaking provider payload', async () => {
  const f = await fixture(); await f.ready();
  await f.upstream.packet({ type: 'conversation.item.input_audio_transcription.failed', error: { message: 'private provider context' } });
  assert.deepEqual(f.server.of('gateway.notice'), [{ type: 'gateway.notice', code: 'TRANSCRIPTION_FAILED', message: '这句话没能识别清楚，请再说一次。' }]);
  assert.equal(f.server.readyState, 1); assert.equal(f.server.of('conversation.item.input_audio_transcription.failed').length, 0);
  await f.asr('retry', '请听我说说具体情况'); assert.equal(f.upstream.of('response.create').length, 1); await f.close();
});
await test('provider failure is sanitized, closes immediately and refunds no-answer call', async () => {
  const f = await fixture(); await f.ready();
  await f.upstream.packet({ type: 'error', error: { code: 'insufficient_quota', message: 'private provider key and raw customer context' } });
  assert.equal(f.server.readyState, 3); assert.equal(f.upstream.readyState, 3); await f.flush();
  const error = f.server.of('error').at(-1).error;
  assert.equal(error.code, 'VOICE_PROVIDER_ERROR'); assert.ok(error.message.includes('文字咨询')); assert.equal(error.retryable, true);
  assert.ok(!JSON.stringify(f.server.sent).includes('private provider')); assert.equal(f.balance(), 100); assert.equal(f.fetches(), 1); await f.close();
});
await test('startup timeout refunds and 3-minute timeout sends a normal end event', async () => {
  const early = await fixture(); await early.timeout(25000);
  assert.equal(early.server.of('error').at(-1).error.code, 'VOICE_START_TIMEOUT'); assert.equal(early.balance(), 100); await early.close();
  const ready = await fixture(); await ready.ready(); await ready.timeout(180000);
  assert.deepEqual(ready.server.of('gateway.session_end'), [{ type: 'gateway.session_end', reason: 'time_limit' }]);
  assert.equal(ready.server.of('error').length, 0); assert.equal(ready.balance(), 100); assert.equal(ready.timers.size, 0); await ready.close();
});
console.log(`${passed} voice lifecycle regressions passed with real SQLite; no network, microphone or billable provider calls.`);
