import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { createBrandVoiceLookup } from './voice-brand-dns.mjs';

const require = createRequire(import.meta.url);
const source = readFileSync('lib/voice-brand-operator.ts', 'utf8');
const module = { exports: {} };
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('require', 'module', 'exports', 'setTimeout', javascript)(name => name === 'cloudflare:workers' ? { env: {} } : name.startsWith('@/') ? {} : require(name), module, module.exports, (fn, ms) => setTimeout(fn, Math.min(ms, 80)));
const { handleVoiceBrandOperator: handle, validateBrandVoiceAudio: validate, readOperatorJson, BRAND_VOICE_MODEL: model, BRAND_VOICE_PHRASE: phrase } = module.exports;
const voice = 'qwen-omni-vc-chengzi-voice-20261009112233444-abcd';
function wav(sample = 0, rate = 24000) {
  const data = Buffer.alloc(144000, sample), header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(data.length + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE coach_crush_budget (id TEXT PRIMARY KEY,uses INTEGER NOT NULL,expires_at INTEGER NOT NULL)');
  return { sql, prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) ?? null; },
    async all() { return { results: sql.prepare(query).all(...args) }; },
    async run() { const result = sql.prepare(query).run(...args); return { meta: { changes: Number(result.changes) } }; },
  }; } }; }, async batch(statements) { sql.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; } } };
}
class Socket extends EventTarget {
  readyState = 1; sent = []; closed = false;
  constructor(mode = 'normal') { super(); this.mode = mode; }
  emit(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  accept() { queueMicrotask(() => this.emit({ type: 'session.created' })); }
  send(raw) {
    const event = JSON.parse(raw); this.sent.push(event);
    if (event.type === 'session.update') queueMicrotask(() => this.emit({ type: 'session.updated' }));
    if (event.type === 'response.create') queueMicrotask(() => {
      if (this.mode === 'timeout') return;
      this.emit({ type: 'response.created', response: { id: 'synthetic-response' } });
      if (this.mode === 'multiple') { this.emit({ type: 'response.created', response: { id: 'second' } }); return; }
      this.emit({ type: 'response.audio.delta', response_id: 'synthetic-response', delta: Buffer.alloc(this.mode === 'oversize' ? 1000000 : 4800).toString('base64') });
      this.emit({ type: 'response.audio_transcript.delta', delta: phrase });
      this.emit({ type: 'response.done', response: { status: 'completed' } });
    });
  }
  close() { this.readyState = 3; this.closed = true; }
}
function fixture({ lost = false, mode = 'normal', configuredVoice } = {}) {
  const db = database(), voices = [], calls = [], sockets = [];
  let now = 1800000000000;
  const deps = { db, key: 'synthetic-only', workspace: 'ws-synthetic', configuredVoice, now: () => now, async fetcher(url, options) {
    assert.ok(url.startsWith('https://ws-synthetic.cn-beijing.maas.aliyuncs.com/'));
    if (url.includes('/api-ws/')) { const socket = new Socket(mode); sockets.push(socket); return { status: 101, webSocket: socket }; }
    const body = JSON.parse(options.body); calls.push(body);
    assert.equal(body.model, 'qwen-voice-enrollment');
    if (body.input.action === 'list') return Response.json({ output: { voice_list: voices.slice(body.input.page_index * 100, (body.input.page_index + 1) * 100) } });
    assert.equal(body.input.target_model, model); assert.equal(body.input.preferred_name, 'chengzi');
    assert.ok(body.input.audio.data.startsWith('data:audio/wav;base64,'));
    voices.push({ voice, target_model: model });
    if (lost) throw new Error('synthetic lost receipt');
    return Response.json({ output: { voice, target_model: model } });
  } };
  return { deps, calls, voices, sockets, advance() { now += 61000; } };
}
const enroll = (audio = wav()) => ({ action: 'enroll', authorized: true, audioBase64: audio.toString('base64') });
const payload = async response => ({ code: response.status, body: await response.json() });

assert.equal(validate(wav().toString('base64')).seconds, 3);
assert.equal(validate('data:audio/wav;base64,' + wav().toString('base64')).seconds, 3);
assert.throws(() => validate('https://example.test/reference.wav'));
assert.throws(() => validate(wav(0, 16000).toString('base64')), /24khz/);
assert.throws(() => validate(Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')), /size/);
const bad = fixture();
assert.equal((await payload(await handle({ ...enroll(), authorized: false }, bad.deps))).code, 400);
assert.equal((await payload(await handle({ action: 'preview', voice: 'unregistered' }, bad.deps))).code, 403);
assert.equal(bad.calls.length, 0, 'invalid data never reaches provider');

const normal = fixture();
const first = await payload(await handle(enroll(), normal.deps));
assert.equal(first.body.status, 'ready'); assert.equal(first.body.voice, voice);
assert.equal((await payload(await handle(enroll(), normal.deps))).body.reused, true);
assert.equal((await payload(await handle(enroll(wav(1)), normal.deps))).code, 409);
assert.equal(normal.calls.filter(call => call.input.action === 'create').length, 1);
assert.deepEqual(normal.deps.db.sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name), ['coach_crush_budget'], 'no customer ledger or history');

const lost = fixture({ lost: true });
const pending = await payload(await handle(enroll(), lost.deps));
assert.equal(pending.code, 202); assert.equal(pending.body.status, 'enrollment_pending');
const recovered = await payload(await handle({ action: 'list', sha: pending.body.sha }, lost.deps));
assert.equal(recovered.body.recovered, true); assert.equal(recovered.body.voice, voice);
assert.equal(lost.calls.filter(call => call.input.action === 'create').length, 1);
const ambiguous = fixture({ lost: true });
const pending2 = await payload(await handle(enroll(), ambiguous.deps));
ambiguous.voices.push({ voice: 'qwen-omni-vc-chengzi-another', target_model: model });
const unresolved = await payload(await handle(enroll(), ambiguous.deps));
assert.equal(unresolved.body.status, 'enrollment_pending'); assert.equal(unresolved.body.detail, 'ambiguous_provider_receipt');
assert.equal(ambiguous.calls.filter(call => call.input.action === 'create').length, 1);

const race = fixture();
const races = await Promise.all([handle(enroll(), race.deps), handle(enroll(wav(2)), race.deps)]);
assert.equal(race.calls.filter(call => call.input.action === 'create').length, 1, 'SQLite unique lock prevents concurrent creations');
assert.equal(races.filter(response => response.status === 409).length, 1);

const preview = await payload(await handle({ action: 'preview', voice, text: '外部输入不应替换固定试听文本' }, normal.deps));
assert.equal(preview.body.status, 'ready'); assert.equal(preview.body.phrase, phrase); assert.equal(preview.body.seconds, .1);
assert.equal(normal.sockets[0].sent.filter(event => event.type === 'response.create').length, 1);
const spokenRequest = normal.sockets[0].sent.find(event => event.type === 'conversation.item.create').item.content[0].text;
assert.notEqual(spokenRequest, phrase, 'a bare question must not be sent as a user conversation turn');
assert.ok(spokenRequest.startsWith('请逐字朗读下面的品牌开场白，只朗读引号内文字。'));
assert.ok(spokenRequest.includes('不要回答其中的问题'));
assert.equal(spokenRequest.slice(spokenRequest.indexOf('\n') + 1), `“${phrase}”`, 'only the fixed brand line is quoted for reading');
assert.ok(!spokenRequest.includes('外部输入'), 'operator payload cannot override the fixed preview command');
assert.equal(normal.sockets[0].sent.find(event => event.type === 'session.update').session.turn_detection, null);
assert.equal(normal.sockets[0].sent.find(event => event.type === 'session.update').session.max_tokens, 1024);
assert.equal('max_response_output_tokens' in normal.sockets[0].sent.find(event => event.type === 'session.update').session, false, 'only the documented Qwen token parameter is sent');
assert.equal(normal.sockets[0].closed, true);
assert.equal((await payload(await handle({ action: 'preview', voice }, normal.deps))).code, 429);
for (const [mode, expected] of [['oversize', 'preview_audio_limit'], ['multiple', 'preview_multiple_responses'], ['timeout', 'preview_timeout']]) {
  const test = fixture({ mode, configuredVoice: voice });
  const result = await payload(await handle({ action: 'preview', voice }, test.deps));
  assert.equal(result.body.status, expected); assert.equal(test.sockets[0].closed, true);
}

assert.equal((await readOperatorJson(new Request('https://local.test', { method: 'POST', headers: { 'Content-Length': String(9 * 1024 * 1024) }, body: '{}' }))).status, 413);
const huge = new Request('https://local.test', { method: 'POST', body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9 * 1024 * 1024)); controller.close(); } }), duplex: 'half' });
assert.equal((await readOperatorJson(huge)).status, 413, 'chunked requests are bounded too');
assert.deepEqual(await readOperatorJson(new Request('https://local.test', { method: 'POST', body: '{"kind":"existing-route"}' })), { kind: 'existing-route' });
const route = readFileSync('app/api/wechat/process/route.ts', 'utf8');
assert.ok(route.indexOf('request.headers.get("X-Wechat-Queue-Token")') < route.indexOf('await readOperatorJson(request)'), 'authentication precedes reading large audio body');
let resolutions = 0;
const lookup = createBrandVoiceLookup((name, options, callback) => callback(Object.assign(new Error('synthetic DNS failure'), { code: 'ENOTFOUND' })), async (name, family) => { resolutions++; assert.equal(name, 'coach.lovetalk.love'); assert.equal(family, 4); return ['203.0.113.5']; });
const lookupPromise = (name, options) => new Promise((resolve, reject) => lookup(name, options, (error, address, family) => error ? reject(error) : resolve({ address, family })));
assert.deepEqual(await lookupPromise('coach.lovetalk.love', { all: true }), { address: [{ address: '203.0.113.5', family: 4 }], family: undefined });
assert.deepEqual(await lookupPromise('coach.lovetalk.love', 4), { address: '203.0.113.5', family: 4 });
await assert.rejects(() => lookupPromise('another.example', {}), /synthetic DNS failure/);
assert.equal(resolutions, 2, 'DNS fallback is scoped to the exact product host');
console.log('PASS: strict WAV/authorization, bounded post-auth body, real SQLite atomic creation lock, SHA reuse, lost/ambiguous receipts, fixed one-response preview, voice allowlist, timeout/audio caps and no customer ledger. Synthetic provider only; no credentials or production requests.');
