import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("miniapp/pages/archive/index.js", "utf8");
const markup = readFileSync("miniapp/pages/archive/index.wxml", "utf8");
let definition;
const requests = [], drawings = [], navigation = [], scroll = [];
let responseState;
const api = {
  async request(path, method, body) { requests.push({ path, method, body }); return responseState; },
  setCurrentSubject() {}
};
const wx = {
  navigateTo({ url }) { navigation.push(url); },
  pageScrollTo(value) { scroll.push(value); },
  setNavigationBarTitle() {}
};
new Function("require", "Page", "wx", source)(
  name => name.endsWith("/api") ? api : {
    drawRadar(page, id) { drawings.push(id); },
    drawTrend(page, id) { drawings.push(id); }
  },
  value => { definition = value; }, wx
);
const makePage = options => {
  const page = { ...definition, data: structuredClone(definition.data), setData(value, done) { Object.assign(this.data, value); done?.(); } };
  page.onLoad(options);
  return page;
};
const event = dataset => ({ currentTarget: { dataset } });

// Parse the template so onboarding tests inspect the visible controls, rather
// than just looking for a label somewhere in the source.
const root = { tag: "root", attrs: {}, children: [] }, stack = [root];
const tags = /<(\/?)(([\w-]+):?[\w-]*)(\s+(?:"[^"]*"|'[^']*'|[^'">])*)?\s*(\/?)>/g;
for (const match of markup.matchAll(tags)) {
  const [, closing, tag, , raw = "", selfClosing] = match;
  if (closing) {
    assert.equal(stack.pop().tag, tag, "WXML tags must remain balanced");
    continue;
  }
  const attrs = {};
  for (const attribute of raw.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[attribute[1]] = attribute[2] ?? true;
  const node = { tag, attrs, children: [] };
  stack.at(-1).children.push(node);
  if (!selfClosing && !raw.trimEnd().endsWith("/")) stack.push(node);
}
assert.equal(stack.length, 1);
const valueOf = (value, data) => {
  if (value === true) return true;
  const match = typeof value === "string" && value.match(/^\{\{([\s\S]*)\}\}$/);
  if (!match) return value;
  const scope = new Proxy(data, { has: () => true, get: (target, key) => key === Symbol.unscopables ? undefined : target[key] });
  try { return new Function("scope", "with (scope) { return (" + match[1] + "); }")(scope); } catch { return undefined; }
};
function visibleNodes(children, data) {
  let matched = false;
  const visible = [];
  for (const node of children) {
    const attrs = node.attrs;
    if (attrs["wx:for"]) {
      for (const [index, item] of (valueOf(attrs["wx:for"], data) || []).entries()) {
        const copy = { ...node, attrs: { ...attrs } };
        delete copy.attrs["wx:for"];
        visible.push(...visibleNodes([copy], { ...data, [attrs["wx:for-item"] || "item"]: item, [attrs["wx:for-index"] || "index"]: index }));
      }
      matched = false;
      continue;
    }
    let show = true;
    if (attrs["wx:if"]) { show = !!valueOf(attrs["wx:if"], data); matched = show; }
    else if (attrs["wx:elif"]) { show = !matched && !!valueOf(attrs["wx:elif"], data); matched ||= show; }
    else if (attrs["wx:else"]) { show = !matched; matched = true; }
    else matched = false;
    if (show) visible.push(node, ...visibleNodes(node.children, data));
  }
  return visible;
}
const shown = page => visibleNodes(root.children, page.data);
const hasHandler = (page, name) => shown(page).some(node => node.attrs.bindtap === name);

const state = {
  enabled: false, paused: false, self: { city: "杭州" },
  subjects: [{ id: "A", label: "甲" }, { id: "B", label: "乙" }],
  facts: [{ id: "self-pending", subjectId: null, status: "pending", value: "我的资料" }, { id: "a-pending", subjectId: "A", status: "pending", value: "甲的资料" }]
};
const self = makePage({ tab: "self", subjectId: "A" });
self.apply(state);
assert.equal(self.data.selectedId, "", "self deep links must not select somebody else");
assert.equal(self.data.subjects.length, 0);
assert.deepEqual(self.data.pendingFacts.map(item => item.id), ["self-pending"]);
assert.ok(hasHandler(self, "enableSelfOnly"));
assert.equal(hasHandler(self, "createFirst"), false);
assert.equal(shown(self).some(node => node.attrs.bindinput === "labelInput"), false, "first self visit must not ask for somebody else's name");
await self.enableSelfOnly();
assert.equal(requests.length, 0, "existing consent gate is preserved");
responseState = { ...state, enabled: true };
self.firstConsentChange({ detail: { value: ["yes"] } });
await self.enableSelfOnly();
assert.deepEqual(requests.map(item => item.body), [{ action: "consent", enabled: true }], "enabling self must never create another person");
assert.equal(self.data.showSelfEditor, true);
assert.equal(self.data.archiveTab, "self");
assert.equal(self.data.firstConsent, false);
assert.equal(scroll.at(-1).selector, "#self-profile-editor");
assert.equal(hasHandler(self, "openManualCreate"), false);
assert.equal(hasHandler(self, "switchArchiveTab"), false, "own details and person list have separate entry ownership");

const people = makePage({});
people.apply({ ...state, subjects: [], self: {} });
assert.ok(hasHandler(people, "createFirst"));
assert.equal(hasHandler(people, "enableSelfOnly"), false);
people.apply({ ...state, enabled: true });
assert.ok(hasHandler(people, "openManualCreate"));
assert.equal(hasHandler(people, "create"), false, "secondary name-only entry starts collapsed");
people.toggleQuickCreate();
assert.ok(hasHandler(people, "create"));

const person = makePage({ subjectId: "A" });
const unknownDimensions = Array.from({ length: 6 }, (_, index) => ({ label: "维度" + index, value: null }));
const detailState = {
  ...state, enabled: true,
  subjects: [{ id: "A", label: "甲", compatibility: { fitScore: null, coverage: 0, fit: unknownDimensions }, communicationReading: { hypotheses: [{ title: "推测一", possibility: "可能的解释", evidence: "原文一" }, { title: "推测二", evidence: "原文二" }] } }, { id: "B", label: "乙" }],
  signals: [{ subjectId: "A", dimensions: unknownDimensions, reportId: "report-A", summary: "当前判断" }],
  trends: [{ subjectId: "A", points: [{ reportId: "old", eventStart: "2026-10-01", dateLabel: "10月1日", score: null, summary: "较早记录" }, { reportId: "new", eventStart: "2026-10-07", dateLabel: "10月7日", score: null, changeSummary: "最近主动约好了时间" }, { reportId: "undated", score: null, summary: "发生日期未知的补充" }] }]
};
const original = JSON.stringify(detailState);
drawings.length = 0;
person.apply(detailState);
assert.equal(person.data.hasFitRadar, false);
assert.equal(person.data.hasInteractionRadar, false);
assert.equal(person.data.hasTrendChart, false);
assert.equal(person.data.selectedRecentChange, "最近主动约好了时间", "dated progress must not be replaced by a newer upload without an event date");
assert.equal(drawings.length, 0, "no empty chart should be drawn");
assert.equal(shown(person).some(node => node.tag === "canvas"), false);
assert.ok(markup.indexOf('id="selected-subject"') < markup.indexOf("item.communicationReading.hypotheses"), "current judgment and action must precede detailed readings");
person.toggleReadingEvidence(event({ index: 0 }));
assert.equal(person.data.readingExpanded[0], true);
assert.equal(person.data.readingExpanded[1], undefined);
person.toggleReadingEvidence(event({ index: -1 }));
assert.equal(person.data.readingExpanded[-1], undefined);
assert.equal(JSON.stringify(detailState), original, "disclosure and summaries must not mutate saved data");
person.confirmAll = definition.confirmAll;
let confirmPayload;
person.action = value => { confirmPayload = value; };
person.confirmAll();
assert.deepEqual(confirmPayload.ids, ["a-pending"], "one-tap confirmation stays scoped to the current person");

const withData = structuredClone(detailState);
withData.subjects[0].compatibility.fit[0].value = 0;
withData.signals[0].dimensions[0].value = 45;
withData.trends[0].points[1].score = 62;
person.apply(withData);
assert.ok(person.data.hasFitRadar, "zero is a real observed value");
assert.ok(person.data.hasInteractionRadar);
assert.ok(person.data.hasTrendChart);
assert.equal(drawings.at(-1), "personFitRadar");
drawings.length = 0;
person.switchDetailSection(event({ section: "trend" }));
assert.deepEqual(drawings, ["personInteractionRadar", "relationshipTrend"]);
person.switchDetailSection(event({ section: "profile" }));
person.toggleSubjectEditor();
assert.equal(scroll.at(-1).selector, "#subject-profile-editor");
person.toggleSubjectEditor();
assert.equal(person.data.selectedId, "A", "closing the editor must not leave the person");
person.openSelectedReport();
assert.equal(navigation.at(-1), "/pages/report/index?id=report-A");
person.select(event({ id: "B" }));
assert.deepEqual(person.data.readingExpanded, {}, "disclosure state must not leak to another person");
assert.equal(person.data.selectedRecentChange, "");
assert.equal(person.data.hasFitRadar, false);
assert.equal(person.data.hasPendingFacts, false, "switching to a different person must also replace the pending-review scope");
const confirmationsBefore = confirmPayload;
person.confirmAll();
assert.equal(confirmPayload, confirmationsBefore, "an empty person's confirm-all must not submit the previous person's facts");

console.log("PASS: self onboarding separation, consent-only activation, person entry ownership, scoped review, dated summary, evidence disclosure, empty-chart guards and editor continuity");
