import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const dir = path.resolve('.tmp/qa-public-report-cases');
await mkdir(dir, { recursive: true });
const entry = path.join(dir, 'entry.tsx'), bundle = path.join(dir, 'bundle.mjs');
await writeFile(entry, [
  'export * from "../../data/public-report-cases";',
  'export * from "../../lib/personal-context";',
  'export * from "../../lib/relationship-risk";',
  'export * from "../../lib/risk-aware-presentation";',
  'export * from "../../lib/crush/reply-style";',
  'export * from "../../components/web-analysis/interaction-dashboard";',
  'export * from "../../components/web-analysis/RelationshipEvidenceCards";',
].join('\n'));
await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic' });
const { publicReports, publicExpectationCase, personalConnection, relationshipRiskReview, riskAwarePresentation, personalizeReplyText, interactionDashboard, RelationshipEvidenceCards } = await import(pathToFileURL(bundle).href);
const { default: React } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

for (const [mode, report] of [...Object.entries(publicReports), ['expectation', publicExpectationCase]]) {
  assert.equal(report.demo, true);
  for (const key of ['id', 'reportId', 'owner', 'ownerId', 'subjectId', 'userId']) assert.equal(report[key], '');
  assert.doesNotMatch(JSON.stringify(report), /雅欣|chengyi01|ba3aec70|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  const personal = personalConnection(report);
  assert.ok(personal.commonPoints.length > 0, mode + ': supported common points');
  for (const item of personal.commonPoints) {
    const evidence = personal.sources.filter(row => item.evidenceIds.includes(row.id));
    assert.ok(evidence.some(row => row.side === 'self') && evidence.some(row => row.side === 'other'));
  }
  for (const source of personal.sources) {
    assert.match(source.label, /虚构/);
    if (source.source === 'chat') assert.ok(report.lines.some(line => line.id === source.lineId && line.text === source.quote && line.speaker === source.side));
    if (source.source === 'moments') assert.ok(report.moments.posts.some(post => post.content === source.quote));
    if (source.source === 'social-profile') assert.ok([...report.profileBasics, ...report.profileContext].some(row => row.value === source.quote));
  }
  if (!report.lines) continue;
  assert.equal(report.readableLineCount, report.lines.length);
  assert.equal(new Set(report.lines.map(row => row.id)).size, report.lines.length);
  assert.equal(report.annotations.length, report.lines.length);
  for (const [index, line] of report.lines.entries()) {
    assert.ok(Number.isFinite(Date.parse(line.sourceAt)));
    if (index) assert.ok(Date.parse(line.sourceAt) >= Date.parse(report.lines[index - 1].sourceAt));
    const annotation = report.annotations.find(row => row.lineId === line.id);
    assert.ok(annotation?.note);
    for (const key of ['emotion', 'intent']) assert.ok(Math.abs(annotation[key].reduce((sum, row) => sum + row.probability, 0) - 1) < 0.001);
  }
  for (const card of report.publicEvidenceReview.cards) for (const source of card.sources) {
    const line = report.lines.find(row => row.id === source.lineId);
    assert.equal(source.text, line.text);
    assert.equal(source.date, line.timestampRaw.slice(0, 10));
    assert.equal(source.reportId, '');
  }
}
const chat = publicReports.chat;
assert.equal(chat.lines.length, 9);
assert.equal(publicExpectationCase.lines.length, 11);
assert.deepEqual(publicExpectationCase.lines.slice(0, 9), chat.lines, 'new evidence preserves original story');
assert.equal(relationshipRiskReview(chat).signals.length, 0, 'do not invent risk to fill the positive case');
const risk = relationshipRiskReview(publicExpectationCase), presentation = riskAwarePresentation(publicExpectationCase);
assert.ok(risk.signals.some(row => row.kind === 'expectation' && row.evidence.includes(publicExpectationCase.lines[10].text)));
assert.equal(presentation.mode, 'expectation');
assert.match(presentation.nextStep, /期待|关系取向/);
assert.ok(presentation.replyOptions.every(row => !/周日两点可以呀/.test(row.text)), 'new goal conflict replaces ordinary time confirmation');
assert.notEqual(presentation.replyOptions[0].text, riskAwarePresentation(chat).replyOptions[0].text);
const dashboard = interactionDashboard(chat);
assert.equal(dashboard.readableCount, 9);
assert.equal(dashboard.otherCount, 5);
assert.ok(dashboard.dimensions.every(row => row.count > 0), 'all four dimensions have actual matching sources');
assert.equal(dashboard.total, dashboard.dimensions.reduce((sum, row) => sum + row.count, 0));
const rewrite = personalizeReplyText(chat.decision.replyOptions[0].text, chat.lines);
assert.equal(rewrite.status, 'adjusted');
assert.match(rewrite.text, /谢啦/);
assert.match(rewrite.text, /周日两点/);
const moments = publicReports.moments.moments;
assert.equal(moments.posts.length, 8);
assert.equal(moments.statistics.total, 8);
assert.equal(moments.statistics.visibleContent.find(row => row.label === '日常').count, 6);
assert.ok(moments.posts.every(post => /^2026-\d{2}-\d{2}$/.test(post.date)));
assert.ok(moments.hypotheses.every(row => row.evidence && row.possibility && row.alternative && row.verify));
const html = renderToStaticMarkup(React.createElement(RelationshipEvidenceCards, { review: chat.publicEvidenceReview, publicExample: true }));
assert.match(html, /说法与行动/);
assert.match(html, /2026-10-09/);
assert.doesNotMatch(html, /href=|\/report\?/);
const source = await readFile('components/web-analysis/AnalysisExample.tsx', 'utf8');
assert.doesNotMatch(source, /PreviewBars|visibleSignalProfile|detailsToggle/);
assert.match(source, /<ChatReport/); assert.match(source, /<SocialReport/);
console.log('PASS public cases: fictional provenance; consistent dates, speakers and counts; four actual interaction dimensions; two-sided common points; expectation-prioritized replies; visible free rewrite; public evidence without private links.');
