import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { voiceActionFeedback, loadVoiceMemory } from "../lib/miniapp-voice-memory.mjs";

const js = ts.transpileModule(readFileSync("lib/relationship-feedback.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = {};
new Function("exports", js)(api);
const id = "11111111-1111-4111-8111-111111111111";
const reportId = "22222222-2222-4222-8222-222222222222";
const nextId = "33333333-3333-4333-8333-333333333333";
const now = Date.parse("2026-10-06T04:00:00Z");
const data = { city: "原城市", relationshipHistory: [{ reportId, nextStep: "问一次具体时间，观察是否落实。", score: 60 }] };
const input = { id, reportId, outcome: "not_done", note: "还没发", eventDate: "" };
const initial = structuredClone(data);
const first = api.appendActionFeedback(data, input, now);
assert.deepEqual(data, initial, "feedback must not mutate facts, history or scores");
assert.equal(first.entry.action, data.relationshipHistory[0].nextStep);
assert.match(first.entry.review, /尚未执行/);
assert.equal(first.entry.eventDate, "", "record time must not be invented as event time");
const withFirst = { ...data, actionFeedback: first.entries };
assert.equal(api.appendActionFeedback(withFirst, input, now + 1000).duplicate, true);
assert.throws(() => api.appendActionFeedback(withFirst, { ...input, outcome: "positive" }, now), /标识已被使用/);
const changed = api.appendActionFeedback(withFirst, { ...input, id: nextId, outcome: "alternative", eventDate: "2026-10-05" }, now);
assert.equal(changed.entries.length, 2);
assert.equal(changed.entry.revisionOf, id);
assert.equal(changed.entries[0].outcome, "not_done", "corrections retain prior feedback");
assert.match(changed.entry.review, /确认具体时间/);
const context = api.actionFeedbackContext({ actionFeedback: changed.entries });
assert.match(context, /对方提出其他安排/);
assert.doesNotMatch(context, /尚未执行/);
assert.equal(api.actionFeedbackContext({}), "");
assert.match(voiceActionFeedback({ actionFeedback: changed.entries }), /提出其他安排/);
assert.doesNotMatch(voiceActionFeedback({ actionFeedback: changed.entries }), /尚未执行/);
assert.equal(voiceActionFeedback({}), "");
const voiceData = { ...data, city: "成都", occupation: "设计师", actionFeedback: changed.entries };
const voiceDb = { prepare(sql) { return { bind(...args) { return { async first() { if (sql.includes("coach_profiles")) { assert.equal(args[0], "owner"); return { consent_at: 1, paused: 0, data: JSON.stringify({ city: "上海", lifestyle: "喜欢运动" }) }; } assert.equal(args[1], "owner"); return { label: "测试人物", data: JSON.stringify(voiceData) }; }, async all() { return { results: [] }; } }; } }; } };
const voice = await loadVoiceMemory(voiceDb, "owner", id);
assert.match(voice.text, /上海/); assert.match(voice.text, /成都/); assert.match(voice.text, /设计师/); assert.match(voice.text, /提出其他安排/);
assert.equal(api.actionFeedbackCards({ ...data, actionFeedback: changed.entries })[0].revisionCount, 2);
assert.equal(api.actionFeedbackCards({ actionFeedback: changed.entries })[0].action, first.entry.action, "old feedback retains its source action after history rotation");
assert.equal(api.appendActionFeedback({ actionFeedback: changed.entries }, { ...input, id: "44444444-4444-4444-8444-444444444444" }, now).entry.action, first.entry.action);
assert.throws(() => api.appendActionFeedback(data, { ...input, reportId: nextId }, now), /对应的行动建议/);
assert.throws(() => api.appendActionFeedback(data, { ...input, outcome: "made-up" }, now), /执行结果/);
assert.throws(() => api.appendActionFeedback(data, { ...input, note: "a".repeat(501) }, now), /500/);
for (const eventDate of ["2026-02-30", "2026-10-07", "yesterday", "2026-99-01"]) assert.throws(() => api.appendActionFeedback(data, { ...input, eventDate }, now));
for (const outcome of api.feedbackOutcomes) {
  const result = api.appendActionFeedback(data, { ...input, outcome }, now);
  assert.ok(result.entry.review);
  assert.ok(api.feedbackLabel(outcome));
}

// Execute the route with in-memory DB stubs to verify access boundaries and CAS.
const routeJs = ts.transpileModule(readFileSync("app/api/miniapp/relationship-feedback/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let authenticated = true, consented = true, paused = false, subjectOwned = true, cas = true, writes = 0, deleting = false;
let storedData = data;
let storedEventFacts = [];
const db = { prepare(sql) { return { bind(...values) { return {
  async all() { assert.match(sql,/owner_id=\? AND subject_id=\?/); assert.match(sql,/status='accepted'/); assert.deepEqual(values,["owner","person-a"]); return {results:storedEventFacts}; },
  async first() {
    if (sql.startsWith("SELECT consent_at")) { assert.equal(values[0], "owner"); return { consent_at: consented ? 1 : null, paused: paused ? 1 : 0 }; }
    assert.match(sql, /owner_id=\?/); assert.equal(values[1], "owner");
    return subjectOwned ? { data: JSON.stringify(storedData) } : null;
  },
  async run() { writes++; assert.match(sql, /owner_id=\?/); if (!deleting) assert.match(sql, /consent_at IS NOT NULL AND paused=0/); assert.match(sql, /AND data=\?/); if (deleting && cas) storedData = { ...storedData, actionFeedback: JSON.parse(values[0]) }; return { meta: { changes: cas ? 1 : 0 } }; }
}; } }; } };
const route = {};
new Function("exports", "require", routeJs)(route, name => name.endsWith("miniapp-auth") ? { miniappOwner: async () => authenticated ? { ownerId: "owner" } : null } : name === "@/db" ? { getD1: () => db } : api);
const request = (patch = {}) => new Request("https://example.test/api/miniapp/relationship-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, subjectId: "person-a", confirmed: true, ...patch }) });
assert.equal((await route.POST(request())).status, 200);
assert.equal(writes, 1);
authenticated = false; assert.equal((await route.POST(request())).status, 401); authenticated = true;
consented = false; assert.equal((await route.POST(request())).status, 403); consented = true;
paused = true; assert.equal((await route.POST(request())).status, 403); paused = false;
subjectOwned = false; assert.equal((await route.POST(request())).status, 404); subjectOwned = true;
assert.equal((await route.POST(request({ confirmed: false }))).status, 400);
assert.equal(writes, 1, "unauthorized requests must not write");
cas = false; assert.equal((await route.POST(request())).status, 409);
assert.equal(writes, 4, "concurrent update retries must be bounded");
cas = true;
const getRequest = () => new Request("https://example.test/api/miniapp/relationship-feedback?subjectId=person-a");
storedData = { ...data, actionFeedback: changed.entries };
const cards = await (await route.GET(getRequest())).json();
assert.equal(cards.cards[0].revisionCount, 2);
assert.equal(cards.cards[0].latest.outcome, "alternative");
storedEventFacts = [{id:"fact-A",status:"accepted",value:"对方说：周末见",evidence:"周末见",created_at:1,event_meta:JSON.stringify({version:1,scope:"speech_act",kind:"invite",speaker:"other",eventKey:"a".repeat(64),spokenDate:"2026-10-01",sourceReportId:reportId})}];
const eventResponse=await (await route.GET(getRequest())).json();
assert.equal(eventResponse.events.find(event=>event.id==="fact-A").dateKind,"聊天日期");
assert.equal(eventResponse.events.find(event=>event.id==="fact-A").title,"对方发出邀约");
assert.ok(eventResponse.events.some(event=>event.source==="我的行动反馈"));
storedEventFacts=[];
subjectOwned = false; assert.equal((await route.GET(getRequest())).status, 404); subjectOwned = true;
paused = true; assert.equal((await route.GET(getRequest())).status, 403);
deleting = true;
assert.equal((await route.DELETE(request())).status, 200, "deletion remains available while paused");
assert.deepEqual(storedData.actionFeedback, []);
assert.deepEqual(storedData.relationshipHistory, data.relationshipHistory, "deleting feedback must preserve the source report");
assert.equal((await route.DELETE(request())).status, 200, "repeat deletion is idempotent");
subjectOwned = false; assert.equal((await route.DELETE(request())).status, 404); subjectOwned = true;
authenticated = false; assert.equal((await route.DELETE(request())).status, 401);
console.log("PASS: feedback outcomes, preserved recommendation, revision trail, idempotency, event dates, ownership, consent and concurrent-write protection");
{
  const sourceData = { relationshipHistory: [
    { reportId: "source-a", nextStep: "确认周六时间", summary: "对方提出具体活动", updatedAt: 1000, eventStart: "2026-10-01", eventEnd: "2026-10-02", score: 55 },
    { reportId: "source-b", nextStep: "尊重这次拒绝", summary: "对方拒绝本次安排", updatedAt: 2000, score: 20 }
  ], actionFeedback: [] };
  const snapshot = structuredClone(sourceData);
  const cards = api.actionFeedbackCards(sourceData);
  const origin = cards.find(card => card.reportId === "source-a");
  assert.equal(origin.sourceSummary, "对方提出具体活动");
  assert.equal(origin.sourceEventStart, "2026-10-01");
  assert.equal(origin.sourceEventEnd, "2026-10-02");
  assert.equal(origin.sourceAvailable, true);
  assert.deepEqual(sourceData, snapshot, "source projection must not rewrite history or scores");
  const old = api.actionFeedbackCards({ actionFeedback: [{ id: "old", reportId: "expired-source", action: "保留原建议", outcome: "waiting", recordedAt: 1, eventDate: "2026-10-03", note: "", review: "用户反馈" }] })[0];
  assert.equal(old.sourceAvailable, false);
  assert.equal(old.sourceSummary, "");
  assert.equal(old.sourceEventStart, "", "feedback occurrence must not be reused as source material date");
  assert.equal(old.action, "保留原建议");
  console.log("PASS: original advice source, material date separation, missing-source honesty and immutable history scores");
}
{
  const entry = (id, reportId, outcome, eventDate, recordedAt) => ({ id, reportId, outcome, eventDate, recordedAt, action: "试着邀请一次", note: "用户的结果", review: "", revisionOf: null });
  const data = { relationshipHistory: [{ reportId: "A", score: 60, summary: "当时的判断", nextStep: "确认时间" }], actionFeedback: [
    entry("a1", "A", "waiting", "2026-10-01", 1),
    entry("b", "B", "positive", "2026-10-04", 2),
    entry("a2", "A", "declined", "2026-10-02", 9),
    entry("unknown", "C", "positive", "", 100),
    entry("not-done", "D", "not_done", "2026-10-05", 110),
    entry("bad-date", "E", "waiting", "2026-02-30", 80)
  ] };
  const before = structuredClone(data);
  const events = api.actionFeedbackEvents(data);
  assert.deepEqual(events.map(item => item.reportId), ["B", "A", "C", "E"]);
  assert.equal(events.find(item => item.reportId === "A").revisionCount, 2);
  assert.equal(events.find(item => item.reportId === "A").id, "a2");
  assert.equal(events.find(item => item.reportId === "A").sourceSummary, "当时的判断");
  assert.equal(events.find(item => item.reportId === "E").eventDate, "");
  assert.ok(events.every(item => !("score" in item)), "reported outcomes must not become graph scores");
  assert.deepEqual(data, before);
  data.actionFeedback.push(entry("a3", "A", "not_done", "", 120));
  assert.ok(!api.actionFeedbackEvents(data).some(item => item.reportId === "A"), "correcting to not done removes the event projection, not its history");
  console.log("PASS: action events use effective feedback, real dates, separate unknown dates, no extra score or duplicate progress");
}
{
  const meta={version:1,scope:"speech_act",kind:"invite",speaker:"other",eventKey:"a".repeat(64),spokenDate:"2026-10-01",sourceReportId:"report"};
  const fact=(id,patch={},status="accepted")=>({id,status,value:"对方说：明天见",evidence:"明天见",created_at:999999,event_meta:JSON.stringify({...meta,...patch})});
  const facts=[fact("first"),fact("duplicate"),fact("pending",{eventKey:"b".repeat(64)},"pending"),fact("bad-date",{eventKey:"c".repeat(64),spokenDate:"2026-02-30"}),fact("unknown-speaker",{eventKey:"d".repeat(64),speaker:"unknown"}),fact("wrong-scope",{eventKey:"e".repeat(64),scope:"fulfilled_meeting"}),{...fact("legacy"),event_meta:null},{...fact("broken"),event_meta:"invalid"}];
  const before=structuredClone(facts);
  const projected=api.confirmedConversationEvents(facts);
  assert.deepEqual(projected.map(event=>event.id),["first","bad-date"]);
  assert.equal(projected[1].eventDate,"");
  assert.equal(projected[0].eventDate,"2026-10-01");
  assert.ok(projected.every(event=>!("score" in event)&&event.outcome==="conversation"));
  assert.deepEqual(facts,before);
  const without=api.confirmedConversationEvents(facts.filter(fact=>!["first","duplicate"].includes(fact.id)));
  assert.ok(!without.some(event=>event.eventDate==="2026-10-01"),"deleted source facts disappear on next read");
  console.log("PASS: confirmed speech acts join progress, pending/legacy/invalid data excluded, date semantics and no score fabrication");
}
{
  const raw=JSON.stringify({version:1,scope:"speech_act",kind:"invite",speaker:"self",eventKey:"a".repeat(64),spokenDate:"2026-10-01",sourceReportId:"original-report"});
  const input={id:"11111111-1111-4111-8111-111111111111",date:"2026-10-02",expectedDate:"2026-10-01"};
  const changed=api.correctConversationEventDate(raw,input,now);
  assert.equal(JSON.parse(changed).spokenDate,"2026-10-01");
  assert.equal(JSON.parse(changed).eventKey,JSON.parse(raw).eventKey);
  assert.equal(api.conversationEventMetadata(changed).spokenDate,"2026-10-02");
  assert.equal(api.correctConversationEventDate(changed,input,now),changed,"lost-response retries are idempotent");
  assert.throws(()=>api.correctConversationEventDate(changed,{...input,date:"2026-10-03"},now),/标识已被使用/);
  const second={...input,id:"22222222-2222-4222-8222-222222222222",date:""};
  assert.throws(()=>api.correctConversationEventDate(changed,second,now),/日期已被其他操作修改/);
  const cleared=api.correctConversationEventDate(changed,{...second,expectedDate:"2026-10-02"},now);
  assert.equal(api.conversationEventMetadata(cleared).spokenDate,"");
  assert.equal(JSON.parse(cleared).dateCorrections.length,2);
  assert.equal(JSON.parse(cleared).spokenDate,"2026-10-01");
  for(const date of ["2026-02-30","2099-01-01","昨天",null]) assert.throws(()=>api.correctConversationEventDate(raw,{...input,date},now),/有效的聊天日期/);
  assert.throws(()=>api.correctConversationEventDate("{}",input,now),/旧记录/);
  console.log("PASS: event date revisions retain original source, idempotent retries, stale-edit conflict, clear-to-unknown and date validation");
}
