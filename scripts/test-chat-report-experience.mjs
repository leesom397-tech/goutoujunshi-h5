import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const quickSource = readFileSync('miniapp/pages/quick/index.js', 'utf8');
const reportSource = readFileSync('miniapp/pages/report/index.js', 'utf8');
const quickMarkup = readFileSync('miniapp/pages/quick/index.wxml', 'utf8');
const reportMarkup = readFileSync('miniapp/pages/report/index.wxml', 'utf8');
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });

function page(source, api = {}, wx = {}, followup = {}) {
  let definition;
  new Function('require', 'Page', 'wx', source)(name => name.endsWith('/followup-context') ? followup : api, value => { definition = value; }, wx);
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(update, done) {
      for (const [key, value] of Object.entries(update)) {
        const path = key.split('.');
        let target = this.data;
        for (const segment of path.slice(0, -1)) target = target[segment];
        target[path.at(-1)] = value;
      }
      done?.();
    }
  };
}

const copied = [], scrolls = [];
const native = {
  setClipboardData(value) { copied.push(value); },
  pageScrollTo(value) { scrolls.push(value); }
};
const quick = page(quickSource, {}, native);
assert.equal(quick.data.agreed, false);
assert.equal(quick.data.newPersonConsent, false);
assert.equal(quick.data.personIndex, 0);
assert.equal(quick.data.people[0].id, '');
quick.togglePrivacyDetails();
assert.equal(quick.data.showPrivacyDetails, true);
assert.equal(quick.data.agreed, false, 'reading privacy information is not consent');
quick.agree({ detail: { value: ['yes'] } });
quick.togglePrivacyDetails();
assert.equal(quick.data.agreed, true, 'closing privacy details must not change an explicit choice');
quick.data.people.push({ id: 'person', label: '人物' });
quick.personChange({ detail: { value: '1' } });
assert.equal(quick.data.agreed, false, 'changing the archive scope requires renewed confirmation');
quick.data.agreed = true;
quick.skipArchive();
assert.equal(quick.data.personIndex, 0);
assert.equal(quick.data.agreed, false, 'removing the archive scope also clears confirmation');
quick.data.newPersonOpen = true;
quick.data.newPersonConsent = true;
quick.data.personIndex = 1;
quick.data.copiedReplyIndex = 0;
quick.reset();
assert.equal(quick.data.personIndex, 0, 'another analysis must not inherit a person');
assert.equal(quick.data.newPersonOpen, false);
assert.equal(quick.data.newPersonConsent, false);
assert.equal(quick.data.agreed, false);
assert.equal(quick.data.copiedReplyIndex, -1);

const sample = {
  id: '11111111-1111-4111-8111-111111111111',
  subjectId: '22222222-2222-4222-8222-222222222222',
  lines: [{ id: 'line-1', speaker: 'other', text: '周日下午有空' }],
  annotations: [{ lineId: 'line-1', emotion: [{ label: '平静', probability: .7 }], intent: [{ label: '提供安排', probability: .8 }], note: '直接给出了可用时间', evidence: 'limited' }],
  decision: {
    judgment: '对方愿意继续商量时间', possibleIntent: '可能在提供可行安排', observation: '提到了周日下午', evidence: '周日下午有空', nextStep: '可以确认一个具体时间',
    replyOptions: [
      { text: '那周日下午见？', style: '确认安排', reason: '承接可用时间', weight: 90 },
      { text: '我看看周日安排再回你', style: '稍后确认', reason: '先核对自己的安排', weight: 60 },
      { text: '这周日我不方便，改天吧', style: '另约时间', reason: '不勉强当前时间', weight: 30 }
    ],
    photoClues: [{ location: '右上', observation: '一张风景图' }]
  }
};
const original = structuredClone(sample);
quick.presentBatch([sample], () => 3);
assert.equal(quick.data.result.judgment, sample.decision.judgment);
assert.equal(quick.data.result.possibleIntent, sample.decision.possibleIntent);
assert.equal(quick.data.result.observation, sample.decision.observation);
assert.equal(quick.data.result.replies.length, 3, 'all available reply directions remain available');
assert.equal(quick.data.result.lines[0].note, '直接给出了可用时间');
assert.equal(quick.data.showLines, true);
assert.equal(quick.data.showEvidence, false);
assert.equal(quick.data.result.photoClueCount, 1);
assert.equal(quick.data.result.interactionScore, null);
assert.deepEqual(sample, original, 'display formatting must not modify the source report');

const present = new Function('require', 'Page', reportSource + '\nreturn present;')(() => ({}), () => {});
const report = page(reportSource, {}, native);
report.data.report = present(sample);
assert.equal(report.data.showLines, true);
assert.equal(report.data.report.replies.length, 3);
assert.equal(report.data.report.lines[0].note, '直接给出了可用时间');
assert.equal(report.data.report.affinity, null);
assert.deepEqual(sample, original);

for (const [name, current] of [['quick', quick], ['report', report]]) {
  const value = name === 'quick' ? current.data.result : current.data.report;
  if (name === 'quick') value.replies[0].personalizedText = '那就周日下午吧';
  const count = copied.length;
  for (const invalid of [-1, 1.5, 8, 'invalid']) current.copyReply(event('index', invalid));
  assert.equal(copied.length, count);
  current.copyReply(event('index', 0));
  assert.equal(current.data.copiedReplyIndex, -1, 'feedback waits for native clipboard success');
  assert.equal(copied.at(-1).data, name === 'quick' ? '那就周日下午吧' : sample.decision.replyOptions[0].text);
  copied.at(-1).success();
  assert.equal(current.data.copiedReplyIndex, 0);
  current.copyReply(event('index', 0));
  const earlierCopy = copied.at(-1);
  current.copyReply(event('index', 1));
  copied.at(-1).success();
  earlierCopy.success();
  assert.equal(current.data.copiedReplyIndex, 1, 'out-of-order clipboard callbacks must keep the latest selection');
  current.copyReply(event('index', 1));
  copied.at(-1).fail();
  assert.equal(current.data.copiedReplyIndex, -1);
  assert.match(current.data.copyError, /长按/);
  current.copyReply(event('index', 0));
  const pending = copied.at(-1);
  if (name === 'quick') current.data.result = { ...value, reportId: 'another-report' };
  else current.data.report = { ...value, id: 'another-report' };
  pending.success();
  assert.equal(current.data.copiedReplyIndex, -1, 'late clipboard callbacks must not affect another report');
  current.data.showLines = false;
  current.jumpReport(event('section', 'lines'));
  assert.equal(current.data.showLines, true);
  assert.equal(scrolls.at(-1).selector, '#report-lines');
  const scrollCount = scrolls.length;
  current.jumpReport(event('section', 'not-a-section'));
  assert.equal(scrolls.length, scrollCount);
}
report.data.report.compatibility = { fitScore: null, fit: [] };
report.jumpReport(event('section', 'fit'));
assert.equal(report.data.showFitDetails, true, 'the supplement shortcut opens the destination before scrolling');
assert.equal(scrolls.at(-1).selector, '#report-fit');

for (const source of [quickSource, reportSource]) {
  let destination;
  const query = {
    select() { return this; }, boundingClientRect() { return this; }, selectViewport() { return this; }, scrollOffset() { return this; },
    exec(done) { done([{ top: 240 }, { height: 64 }, { scrollTop: 300 }]); }
  };
  const current = page(source, {}, { createSelectorQuery: () => query, pageScrollTo(value) { destination = value; } });
  current.scrollReportSection('lines');
  assert.equal(destination.scrollTop, 464, 'section titles must stay below the sticky navigation');
}

for (const [name, markup] of [['quick', quickMarkup], ['report', reportMarkup]]) {
  const anchors = [...markup.matchAll(/\bid="report-([^"\s]+)"/g)].map(match => match[1]);
  assert.equal(new Set(anchors).size, anchors.length, name + ' has unique scroll anchors');
  for (const match of markup.matchAll(/data-section="([^"]+)"/g)) assert.ok(anchors.includes(match[1]), name + ' navigation points to a rendered section');
  assert.ok(markup.indexOf('id="report-judgment"') < markup.indexOf('id="report-replies"'));
  assert.ok(markup.indexOf('id="report-replies"') < markup.indexOf('id="report-metrics"'), 'reply choices precede supplementary scores');
  assert.ok(markup.indexOf('{{item.reason') < markup.indexOf('wx:if="{{item.expanded}}"'), 'the reason is readable before opening optional cautions');
  assert.match(markup, /<signal-tags[^>]*note="\{\{item\.note\}\}"/);
  assert.match(markup, /class="reply-text" selectable/);
  assert.match(markup, /copiedReplyIndex === replyIndex/);
}
assert.match(quickMarkup, /<button class="picker" bindtap="choose">/);
assert.match(quickMarkup, /checked="\{\{agreed\}\}"/);
assert.match(quickMarkup, /showPrivacyDetails/);
for (const phrase of ['阿里云百炼', '保留 7 天', '本机会保存临时图片副本', '下次进入时重试', '服务端副本仅临时处理']) assert.ok(quickMarkup.includes(phrase));
assert.match(reportMarkup, /report\.affinity\.radarReady/);
assert.match(reportMarkup, /补充查看 · 最新资料适配/);

for (const [name, source, markup] of [['quick', quickSource, quickMarkup], ['report', reportSource, reportMarkup]]) {
  const snapshots = [];
  let failure = false;
  const current = page(source, {}, native, { async openReportFollowup(snapshot) { if (failure) throw new Error('暂时无法打开聊天'); snapshots.push(snapshot); } });
  if (name === 'quick') current.presentBatch([sample], () => 2);
  else current.data.report = present(sample);
  current.data.token = 'current-session';
  current._token = 'current-session';
  current.data.people = [{ id: 'unrelated-person', label: '另一个人' }];
  current.data.personIndex = 0;
  const opening = current.openFollowup();
  await current.openFollowup();
  await opening;
  assert.equal(snapshots.length, 1, 'repeated taps must open one contextual follow-up');
  const snapshot = snapshots[0];
  assert.equal(snapshot.source, 'chat-analysis');
  assert.equal(snapshot.reportId, sample.id);
  assert.equal(snapshot.subjectId, sample.subjectId, 'the report owns the person context, not the current picker');
  assert.equal(snapshot.token, 'current-session');
  assert.match(snapshot.summary, /对方：周日下午有空/);
  assert.match(snapshot.summary, /可能的意思（推测）/);
  assert.match(snapshot.summary, /下一步建议/);
  assert.ok(snapshot.summary.length <= 1050);
  assert.equal(snapshot.question, undefined, 'opening follow-up must not invent or submit a user question');
  if (name === 'quick') {
    assert.equal(current.data.agreed, false);
    current.data.result.subjectId = '';
  } else current.data.report.subjectId = '';
  await current.openFollowup();
  assert.equal(snapshots.at(-1).subjectId, '', 'an unarchived report must not inherit another selected person');
  failure = true;
  await current.openFollowup();
  assert.equal(current.data.followupBusy, false);
  assert.match(current.data.followupError, /无法打开/);
  assert.equal((markup.match(/bindtap="openFollowup"/g) || []).length, 1, 'one clear follow-up entry per report');
  assert.ok(markup.indexOf('bindtap="openFollowup"') < markup.indexOf('id="report-replies"'), 'follow-up remains visible near the primary judgment');
}
console.log('PASS: explicit consent and optional archive, visible judgment and explanations, three reply directions, safe clipboard feedback, report anchors and sticky-header offsets, retained scores/photos/fit, report-owned follow-up context without automatic sending');
