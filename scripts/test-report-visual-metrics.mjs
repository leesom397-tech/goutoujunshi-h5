// Synthetic activity only; no model scores, private archive or network calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', code)(exports, name => Object.hasOwn(mocks, name) ? mocks[name] : require(name));
  return exports;
}
const model = load('components/web-analysis/report-visual-metrics.ts');
const { readReportVisualMetrics: read, visualMetricsDays: windowDays } = model;
const day = (date, self, other, unknown = 0) => ({ date, self, other, unknown, total: self + other + unknown, voices: 0 });
const activity = { messages: 100, self: 50, other: 45, unknown: 5, days: [day('2026-08-01', 1, 2), day('2026-10-18', 49, 43, 5)], starts: { self: 3, other: 2, unknown: 1, comparable: 5 }, sessionGapHours: 6, responses: { selfToOther: 8, otherToSelf: 9, comparableTurns: 17 } };
const full = read({ chatActivity: activity });
assert.equal(full.total, 100);
assert.deepEqual(full.replies, { self: 9, other: 8 }, 'a reply to self is from the other person');
assert.equal(full.activeDays, 2);
assert.equal(full.spanDays, 79);
assert.equal(full.undated, 0);
assert.equal(read({ score: 90, relationshipDiagnosis: { relationship: { interest: 99 } } }), null);
assert.equal(read({ chatActivity: { ...activity, messages: 99 } }), null, 'inconsistent role totals are not drawn');
assert.equal(read({ relationshipContext: { activity } }).total, 100, 'archive contract fallback');
assert.equal(read({ chatActivity: { ...activity, messages: 99 }, relationshipContext: { activity } }).total, 100);
assert.equal(read({ chatActivity: { ...activity, days: [day('2026-02-30', 50, 45, 5)] } }).days.length, 0, 'no invented dates');
assert.equal(read({ chatActivity: { ...activity, days: [day('2026-10-18', 99, 0)] } }).days.length, 0, 'daily role counts cannot exceed totals');
assert.equal(read({ chatActivity: { ...activity, days: [] } }).undated, 100);
assert.equal(read({ chatActivity: { ...activity, starts: { self: 0, other: 0, unknown: 0, comparable: 0 } } }).starts, null);
let covered = [];
for (let p = 0; p < windowDays(full).pages; p++) {
  const { days } = windowDays(full, p);
  assert.ok(days.length <= 28);
  covered.push(...days);
}
assert.equal(covered.length, 79);
assert.equal(new Set(covered.map(d => d.date)).size, 79, 'date paging has no duplicates or skipped dates');
assert.equal(covered.reduce((sum, d) => sum + d.total, 0), 100, 'all history remains reachable');
assert.equal(windowDays(full, 99).page, 2);
const { ReportVisualMetrics } = load('components/web-analysis/ReportVisualMetrics.tsx', { './report-visual-metrics': model, './ReportVisualMetrics.module.css': { default: new Proxy({}, { get: (_, key) => String(key) }) } });
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const render = value => renderToStaticMarkup(React.createElement(ReportVisualMetrics, { report: value }));
const fullHtml = render({ chatActivity: activity });
assert.match(fullHtml, /data-message-composition/);
assert.match(fullHtml, /data-daily-activity/);
assert.match(fullHtml, /我 50 条，对方 45 条，未确认 5 条/);
assert.match(fullHtml, /每日消息数量，可用左右方向键选择日期/);
assert.doesNotMatch(fullHtml, /好感|喜欢.*%|亲密.*%/);
assert.doesNotMatch(render({ chatActivity: { ...activity, days: [day('2026-10-18', 50, 45, 5)] } }), /data-daily-activity/);
assert.match(render({ chatActivity: { ...activity, days: [] } }), /data-metrics-date-limited/);
const singleDayHtml = render({ chatActivity: { ...activity, days: [day('2026-10-18', 50, 45, 5)] } });
assert.match(singleDayHtml, /观察范围/);
assert.match(singleDayHtml, /data-date-state="known" aria-label="2026-10-18"/);
assert.doesNotMatch(singleDayHtml, /shareBars/, 'limited dates show scope, not a second message composition');
assert.match(render({ chatActivity: { ...activity, days: [] } }), /data-date-state="unknown" aria-label="日期尚未确认"/);
assert.equal(render({ score: 90 }), '');
console.log('PASS report visual metrics: exact counts, date limits, 79-day paging, reply direction and semantic markup');
