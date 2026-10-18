// Synthetic questions/evidence only; no network calls or user data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
const cache = new Map();
function load(file) {
  const path = resolve(file);
  if (cache.has(path)) return cache.get(path);
  const exports = {}; cache.set(path, exports);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', code)(exports, name => {
    assert.ok(name.startsWith('.'), 'test imports only local pure helpers');
    return load(resolve(dirname(path), name + '.ts'));
  });
  return exports;
}
const { wantsBriefAnswer, chengziAnswerStyle } = load('lib/chengzi-answer-style.ts');
const { needsCaptureHistoryAnswer, captureArchiveExcerpts, cleanCaptureHistoryAnswer } = load('lib/capture-question-depth.ts');
const { quickQuestionTextEvidence } = load('lib/quick-question.ts');

for (const question of ['只给一句怎么回她？', '简短说结论', '不要展开', '不用展开，直接说结论', '别分析，帮我回', '20字以内']) {
  assert.equal(wantsBriefAnswer(question), true, question);
  assert.equal(chengziAnswerStyle(question, { detailedArchive: true }).maxTokens, 1200, question);
  assert.equal(needsCaptureHistoryAnswer(question, [], false, true), false, question);
}
for (const question of ['不要只给一句话，解释原因', '不要每次这么简短，把变化讲清楚', '不需要简短，详细讲', '为什么微信回复少，但会主动约见面？']) {
  assert.equal(wantsBriefAnswer(question), false, question);
  assert.equal(chengziAnswerStyle(question).maxTokens, 2200, question);
  assert.equal(chengziAnswerStyle(question, { detailedArchive: true }).maxTokens, 3000, question);
  assert.equal(needsCaptureHistoryAnswer(question, [], true, true), true, 'new screenshot keeps history: ' + question);
}
assert.equal(chengziAnswerStyle('帮我回她，并详细解释这样回的原因').depth, 'explain');
assert.equal(chengziAnswerStyle('那我怎么回？').maxTokens, 1200);
assert.equal(chengziAnswerStyle('你好').maxTokens, 1200);

const source = (quote, speaker, at = '') => ({ sourceId: 'synthetic-source', quote, speaker, at });
const events = [
  { kind: 'chat', basis: 'interpretation', detail: '模型曾经猜对方一定喜欢用户', sources: [source('周六我来订餐厅。', 'other', '2026-10-10')] },
  { kind: 'moments', basis: 'interpretation', detail: '模型推断他很富有', sources: [source('周末徒步完成。', 'other', '')] },
  { kind: 'user-event', basis: 'user-report', detail: '线下互动', sources: [{ factId: 'synthetic-fact', quote: '昨天我们打了一个小时电话。', speaker: 'unknown', at: '' }] },
  { kind: 'chat', basis: 'quote', detail: '未知身份', sources: [source('下周再约。', 'unknown', '')] },
  { kind: 'chat', basis: 'interpretation', detail: '没有来源的旧判断', sources: [] },
];
const lines = captureArchiveExcerpts('当前人物统一事件与证据摘要（日期为空表示未知）：' + JSON.stringify(events));
assert.equal(lines.length, 4);
assert.ok(lines.includes('用户补充：昨天我们打了一个小时电话。'));
assert.ok(lines.includes('对方朋友圈：周末徒步完成。'));
assert.ok(lines.includes('未确认一方：下周再约。'));
assert.equal(lines.some(line => line.includes('一定喜欢') || line.includes('很富有')), false);
const verified = quickQuestionTextEvidence('「周六我来订餐厅。」「昨天我们打了一个小时电话。」「周末徒步完成。」', 'conversation', '她的投入如何？', '', [], lines);
assert.match(verified, /2026-10-10\] 对方：/);
assert.match(verified, /用户补充：「昨天我们打了一个小时电话。/);
assert.match(verified, /对方朋友圈：「周末徒步完成。/);
const invented = quickQuestionTextEvidence('「模型曾经猜对方一定喜欢用户」「2026-10-10」', 'conversation', '她的投入如何？', '', [], lines);
assert.match(invented, /没有可逐字核对/);
assert.deepEqual(captureArchiveExcerpts('当前人物统一事件与证据摘要：{broken'), []);

const repeated = '这次的变化在于对方主动给了具体时间，而且承担了安排。';
assert.equal(cleanCaptureHistoryAnswer(repeated + '\n\n' + repeated), repeated);
const text = '先给直接回答。' + '这个细节需要结合后续安排来看。'.repeat(1) + '\n\n' + '之后的解释不要被截断在半个句子中间。';
const bounded = cleanCaptureHistoryAnswer(text, 31);
assert.match(bounded, /[。！？…]$/);
assert.ok(bounded.length <= 32);
assert.match(cleanCaptureHistoryAnswer('判断。\n\n下一段解释。'), /\n\n/);
console.log('PASS adaptive explanation length, explicit brevity/negation, complete-history screenshot context, provenance labels, quote-only grounding and paragraph deduplication.');
