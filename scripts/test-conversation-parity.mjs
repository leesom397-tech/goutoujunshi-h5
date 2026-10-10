import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { restoreConversation, conversationHistory, fitConversationRequest, voiceAccessError } from '../lib/web-conversation-state.mjs';
import { createEchoFilter } from '../lib/web-voice-echo-filter.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const subject = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const body = { requestId, self: '原来的问题', other: '', mode: 'conversation', subjectId: subject, history: [], confirmed: true };
const saved = { owner, subject, mode: 'conversation', draft: body.self, other: '', messages: [{ id: 'a', role: 'user', content: 'A账号的对话' }], requestId, requestBody: body, contextKey: 'report-a' };
assert.equal(restoreConversation(saved, owner).requestId, requestId, 'same request survives retry/reload');
const another = restoreConversation(saved, 'different-owner');
assert.equal(another.messages.length, 0, 'foreign owner snapshot is rejected');
assert.equal(another.requestId, null);
const changed = restoreConversation(saved, owner, { subject: '' });
assert.equal(changed.messages.length, 0);
assert.equal(changed.requestBody, null, 'person deep link cannot replay the previous person request');
assert.equal(changed.draft, '');
assert.equal(restoreConversation(saved, owner, { mode: 'positioning' }).requestId, null);
assert.equal(restoreConversation(saved, owner, { contextKey: 'report-a' }).messages.length, 1, 'same report reload keeps the conversation');
assert.equal(restoreConversation(saved, owner, { contextKey: 'report-b' }).requestId, null);
assert.equal(restoreConversation({ ...saved, draft: '已经改了输入' }, owner).requestId, null, 'changed input cannot reuse old receipt');
const summary = '前'.repeat(700) + '尾部证据';
const history = conversationHistory(Array.from({ length: 10 }, () => ({ role: 'assistant', content: '中'.repeat(600) })), { summary });
assert.equal(history.length, 6);
assert.ok(history[1].content.includes('尾部证据'), 'report summary tail is preserved across two history entries');
const fitted = fitConversationRequest({ ...body, self: '中'.repeat(1500), history });
assert.ok(new TextEncoder().encode(JSON.stringify(fitted)).length <= 11000, 'Chinese history respects the actual HTTP byte limit');
assert.equal(fitted.self.length, 1500, 'history fitting preserves the actual question');
assert.throws(() => fitConversationRequest({ ...body, self: '中'.repeat(1500), other: '中'.repeat(3000) }), /精简/);
const enabled = { account: { userId: owner, active: true, features: ['voice'], balance: 20 }, prices: { voice: 20 } };
assert.equal(voiceAccessError(enabled), '');
assert.match(voiceAccessError({ ...enabled, account: { ...enabled.account, active: false } }), /到期/);
assert.match(voiceAccessError({ ...enabled, account: { ...enabled.account, features: [] } }), /语音功能/);
assert.match(voiceAccessError({ ...enabled, account: { ...enabled.account, balance: 19 } }), /积分不足/);
for (const price of [undefined, NaN, -1, Infinity]) assert.match(voiceAccessError({ ...enabled, prices: { voice: price } }), /语音价格/);
assert.equal(voiceAccessError({ ...enabled, prices: { voice: 0 } }), '', 'a valid free price remains usable');
assert.match(voiceAccessError({ ...enabled, account: { ...enabled.account, balance: NaN } }), /可用积分/);

// Exercise the actual browser microphone module with deterministic device doubles.
const source = ts.transpileModule(fs.readFileSync('components/web-analysis/audio.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let streamStops = 0, contextCloses = 0, contextFailure = '', optionsSeen, ended = 0;
const track = { onended: null, stop() { streamStops++; } };
const navigator = { mediaDevices: { async getUserMedia(options) { optionsSeen = options; return { getTracks: () => [track], getAudioTracks: () => [track] }; } } };
class AudioContext {
  state = 'running'; sampleRate = 16000; destination = {};
  async resume() { if (contextFailure === 'resume') throw Error('resume failed'); }
  async close() { this.state = 'closed'; contextCloses++; }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { if (contextFailure === 'processor') throw Error('processor failed'); return { connect() {}, disconnect() {}, onaudioprocess: null }; }
  createGain() { return { connect() {}, disconnect() {}, gain: { value: 1 } }; }
}
const module = { exports: {} };
new Function('require', 'module', 'exports', 'navigator', 'AudioContext', source)(() => ({ encodeBase64: bytes => Buffer.from(bytes).toString('base64') }), module, module.exports, navigator, AudioContext);
for (const failure of ['resume', 'processor']) {
  contextFailure = failure;
  const stops = streamStops, closes = contextCloses;
  await assert.rejects(module.exports.openMicrophone(() => {}));
  assert.equal(streamStops, stops + 1, `${failure} failure stops captured tracks`);
  assert.equal(contextCloses, closes + 1, `${failure} failure closes audio context`);
}
contextFailure = '';
const microphone = await module.exports.openMicrophone(() => {}, { echoCancellation: false, onEnded() { ended++; } });
assert.equal(optionsSeen.audio.echoCancellation, false, 'headphone mode uses selected capture configuration');
track.onended(); assert.equal(ended, 1, 'natural device stop is reported');
const stops = streamStops;
await microphone.close(); await microphone.close();
assert.equal(streamStops, stops + 1, 'explicit close is idempotent');
assert.equal(track.onended, null, 'closing removes callbacks before stopping tracks');

// The browser uses the exact previously tested filter, avoiding unconditional microphone muting.
const miniSource = fs.readFileSync('miniapp/lib/echo-filter.js', 'utf8').replace('module.exports = { createEchoFilter };', 'export { createEchoFilter };');
assert.equal(fs.readFileSync('lib/web-voice-echo-filter.mjs', 'utf8'), miniSource);
assert.equal(createEchoFilter().isEcho(new ArrayBuffer(320), 0), false, 'no reference never silences user input');
console.log('PASS: owner isolation, retry identity, report continuity/UTF-8 history budget, voice access and actual microphone failure/stop cleanup');
