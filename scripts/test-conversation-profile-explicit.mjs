import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
const cache = new Map();
function load(file) {
  const path = resolve(file);
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  cache.set(path, exports);
  const js = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', js)(exports, name => load(resolve(dirname(path), name + '.ts')));
  return exports;
}
const { extractExplicitConversationProfileCandidates: extract } = load('lib/conversation-profile-explicit.ts');
const line = (text, senderRole = 'self', localId = 'synthetic-source') => ({ localId, senderRole, at: '2026-01-01 12:00', kind: 'text', text });
let checks = 0;
for (const [text, field] of [
  ['我擅长写代码。', 'strengths'],
  ['我的长处是整理复杂信息。', 'strengths'],
  ['我比较擅长画建筑。', 'strengths'],
  ['周末可以帮忙，我拍照可厉害了。', 'strengths'],
  ['我编程很厉害。', 'strengths'],
  ['我正在开发一个旅行路线工具。', 'goals'],
  ['我目前正在学习日语，还没达到流利的程度。', 'goals'],
  ['我的目标是今年完成自己的作品集。', 'goals'],
  ['我计划下个月制作一段动画，还没有开始。', 'goals'],
  ['我正在做一个整理书评的视频工具，功能还没完成。', 'goals'],
]) {
  const rows = extract([line(text)]);
  assert.equal(rows.length, 1, text);
  assert.equal(rows[0].field, field, text);
  assert.equal(rows[0].basis, 'statement');
  assert.equal(rows[0].quote, text);
  assert.equal(rows[0].value, text, 'original qualifications and tense are preserved');
  assert.equal(rows[0].sourceId, 'synthetic-source');
  assert.equal(rows[0].sourceAt, '2026-01-01 12:00');
  checks++;
}
for (const text of [
  '他说：“我擅长摄影”。', '他说我擅长摄影。', '朋友告诉我，我擅长摄影。',
  '转发一段介绍：我擅长摄影。', '比如我擅长摄影。', '我没说我擅长摄影。',
  '我不擅长摄影。', '我擅长摄影吗？', '难道我擅长摄影。',
  '如果我擅长摄影就好了。', '要是我擅长摄影就好了。', '要不是我擅长摄影才怪。',
  '我吹牛说我擅长摄影。', '我开玩笑说我擅长摄影。', '我擅长摄影，其实是装的。',
  '我今天拍得很厉害。', '我这次拍照很厉害。', '我以前擅长摄影。',
  '我擅长摄影，但现在不太会了。', '我擅长摄影？你确认一下。',
  '我可能擅长摄影。', '我喜欢你。', '我以前喜欢摄影。',
  '我在广州。', '我今年三十岁。', '我现在是摄影师。',
  '我的目标是结婚。', '我计划认识更多女生。', '我正在做饭。',
  '我擅长投资理财。', '我正在研究银行卡密码。',
  '我擅长摄影，手机号是13800000000。',
  '我正在开发工具。她说：“我擅长摄影”。',
  '我并没有说，我擅长摄影。', '我否认这句，我擅长摄影。',
  '我擅长摄影，都是吹的。', '这是去年的事。我正在开发一个工具。',
  '我计划学习日语，不过后来取消了这个计划。',
  '我正在开发' + '工具'.repeat(85) + '，但这只是虚构的句子。',
]) {
  assert.deepEqual(extract([line(text)]), [], text);
  checks++;
}
const other = extract([line('我擅长弹钢琴。', 'other')]);
assert.equal(other[0].target, 'subject');
assert.deepEqual(extract([line('我擅长弹钢琴。', 'unknown')]), []);
assert.deepEqual(extract([{ ...line('我擅长弹钢琴。'), kind: 'image' }]), []);
assert.deepEqual(extract([line('我擅长弹钢琴。'), line('我擅长画画。')]), [], 'conflicting source IDs cannot be trusted');
assert.equal(extract([line('我擅长弹钢琴。我擅长唱歌。')]).length, 1, 'one candidate per source / speaker / field');
const many = Array.from({ length: 20 }, (_, i) => line(`我正在开发第${i + 1}个测试工具。`, i % 2 ? 'other' : 'self', `source-${i}`));
assert.equal(extract(many).length, 12);
assert.deepEqual(extract(many), extract(many), 'stable deterministic output');
checks += 7;
console.log(`Explicit conversation profile supplement: ${checks} synthetic checks passed.`);
