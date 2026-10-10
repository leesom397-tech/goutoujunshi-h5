import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reportSource = readFileSync('miniapp/pages/report/index.js', 'utf8');
const { present, interactionOverview } = new Function('require', reportSource.split('Page({')[0] + '; return {present,interactionOverview};')(() => ({}));
const quickSource = readFileSync('miniapp/pages/quick/index.js', 'utf8');
const metrics = new Function('require', 'Page', 'wx', quickSource + '; return relationshipMetrics;')(() => ({}), () => {}, {});
const lines = [
  { id: 'a', speaker: 'other', text: '你周末有空吗？' },
  { id: 'b', speaker: 'other', text: '一起喝咖啡？' },
  { id: 'c', speaker: 'self', text: '可以呀' },
  { id: 'd', speaker: 'unknown', text: '这句身份尚未确认' },
  { id: 'e', speaker: 'other', text: '那我看看时间' },
  { id: 'f', speaker: 'self', text: '周日下午呢' },
  { id: 'g', speaker: 'other', text: '可以，下午三点去上次说的那家店，你觉得怎么样？' },
  { id: 'g', speaker: 'other', text: '可以，下午三点去上次说的那家店，你觉得怎么样？' },
  { id: 'h', speaker: 'other', text: '【图片】不可读内容' }
];
const summary = interactionOverview(lines);
assert.deepEqual(summary, { otherTurnCount: 3, activeCount: 2, expandedCount: 1, responseCount: 1 });
for (const [key, value] of Object.entries(summary)) assert.equal(value, metrics(lines, [], null)[key], key + ' must use the same observable counting rule on both pages');
assert.deepEqual(interactionOverview([]), { otherTurnCount: 0, activeCount: 0, expandedCount: 0, responseCount: 0 });
const missing = present({ lines });
assert.equal(missing.hasAffectionScore, false);
assert.equal(missing.affectionScore, null, 'activity counts never synthesize an affection score');
assert.deepEqual(missing.interactionOverview, summary);
for (const value of [0, 72, 100]) assert.equal(present({ affinity: { value } }).affectionScore, value);
for (const value of [null, -1, 101, NaN, '80']) assert.equal(present({ affinity: { value } }).hasAffectionScore, false);
const partial = present({ affinity: { value: null, dimensions: [{ key: 'one', label: '投入', value: 0 }, { key: 'two', label: '边界', value: null }] } });
assert.equal(partial.affinity.dimensions[0].displayValue, '0');
assert.equal(partial.affinity.dimensions[1].displayValue, '待验证');
assert.equal(partial.affinity.radarReady, false);
for (const name of ['quick', 'report']) {
  const markup = readFileSync(`miniapp/pages/${name}/index.wxml`, 'utf8');
  const start = markup.indexOf('class="affection-highlight"');
  const end = markup.indexOf('id="report-judgment"');
  assert.ok(start >= 0 && start < end, 'existing affection data must be prominent before the judgment');
  const highlight = markup.slice(start, end);
  assert.match(highlight, /好感度 · 互动参考/);
  assert.match(highlight, /otherTurnCount/);
  assert.match(highlight, /activeCount/);
  assert.match(highlight, /expandedCount/);
  assert.match(highlight, /affectionBoundary/);
  assert.match(highlight, /data-section="metrics" bindtap="jumpReport"/);
  assert.doesNotMatch(highlight, /<canvas/, 'missing history never becomes an empty hero chart');
}
console.log('PASS affection highlight: existing scores, real-zero semantics, observable counts, media/unknown boundaries, preserved dimensions and detail anchors');
