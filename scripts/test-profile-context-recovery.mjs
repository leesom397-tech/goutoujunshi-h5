import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const load = (path, dependencies = {}) => {
  const exports = {};
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  new Function("exports", "require", js)(exports, name => {
    if (!(name in dependencies)) throw Error(`Unexpected import: ${name}`);
    return dependencies[name];
  });
  return exports;
};
const recovery = load("lib/profile-fact-fields.ts");
const feedback = load("lib/relationship-feedback.ts");
const communicationReading = load("lib/communication-reading.ts");
const profileFields = load("lib/profile.ts");
const chatActivity = load("lib/chat-activity.ts");
const facts = [
  { owner: "owner", subject_id: null, field: "selfBasic:occupation", value: "导演", status: "accepted" },
  { owner: "owner", subject_id: null, field: "selfBasic:city", value: "截图旧城市", status: "accepted" },
  { owner: "owner", subject_id: "A", field: "subjectBasic:occupation", value: "主播", status: "accepted" },
  { owner: "owner", subject_id: "A", field: "profileClue", value: "价值观：重视独立", status: "accepted" },
  { owner: "owner", subject_id: "A", field: "subjectBasic:city", value: "未确认城市", status: "pending" },
  { owner: "owner", subject_id: "B", field: "subjectBasic:occupation", value: "另一个人物职业", status: "accepted" },
  { owner: "outsider", subject_id: "A", field: "subjectBasic:city", value: "其他账号城市", status: "accepted" }
];
let paused = false, consent = true;
const calls = [];
let self = JSON.stringify({ city: "手填城市" });
let person = JSON.stringify({ actionFeedback: [{ reportId: "report-A", outcome: "alternative", action: "邀请一次", note: "改到周日", recordedAt: 1 }] });
const db = { prepare(sql) { return { bind(...args) {
  calls.push({ sql, args });
  return {
    async first() {
      if (sql.includes("coach_profiles")) return { consent_at: consent ? 1 : null, paused: paused ? 1 : 0, data: self };
      if (sql.includes("coach_subjects")) return args[0] === "A" && args[1] === "owner" ? { label: "测试人物", status: "active", data: person } : null;
      throw Error(sql);
    },
    async all() {
      if (sql.includes("SELECT subject_id,field,value,status")) return { results: facts.filter(fact => fact.owner === args[0] && fact.status === "accepted" && (fact.subject_id === null || fact.subject_id === args[1])) };
      if (sql.includes("coach_facts")) return { results: [] };
      throw Error(sql);
    }
  };
} }; } };
const api = load("lib/profile-context.ts", {
  "@/db": { getD1: () => db },
  "@/lib/profile": profileFields,
  "@/lib/profile-fact-fields": recovery,
  "@/lib/relationship-feedback": feedback,
  "@/lib/communication-reading": communicationReading
  , "@/lib/chat-activity": chatActivity
  , "./self-archive-memory": {loadSelfArchiveMemory:async()=>({status:"ready",summaries:[]}),selfArchiveMemoryContext:()=>""}
});
const snapshot = structuredClone(facts);
const result = await api.loadProfileContext("owner", "A");
for (const expected of ["导演", "主播", "重视独立", "手填城市", "改到周日"]) assert.ok(result.includes(expected), expected);
for (const absent of ["截图旧城市", "未确认城市", "另一个人物职业", "其他账号城市"]) assert.ok(!result.includes(absent), absent);
assert.deepEqual(facts, snapshot, "projection must not edit confirmed facts");
assert.ok(!calls.some(call => /UPDATE|INSERT|DELETE/.test(call.sql)));
const global = await api.loadProfileContext("owner");
assert.match(global, /导演/);
assert.doesNotMatch(global, /主播|改到周日/);
assert.doesNotMatch(await api.loadProfileContext("owner", "missing"), /主播|改到周日/);
self = JSON.stringify(Object.fromEntries(profileFields.selfFields.map(field => [field, "长档案内容".repeat(100)])));
const longContext = await api.loadProfileContext("owner", "A");
assert.ok(longContext.length <= 4200);
assert.match(longContext, /改到周日/, "latest outcome must survive a fully populated long self profile");
assert.match(longContext, /当前人物：测试人物/);
for (const line of longContext.split("\n")) {
  const start = line.search(/[\[{]/);
  if (start >= 0) assert.doesNotThrow(() => JSON.parse(line.slice(start)), "context must not cut structured data mid-JSON");
}
person = JSON.stringify({ ...Object.fromEntries(profileFields.subjectFields.map(field => [field, '"\\\n'.repeat(200)])),
  actionFeedback: Array.from({length:3},(_,index)=>({reportId:`long-${index}`,outcome:"positive",action:'"\\\n'.repeat(150),note:'"\\\n'.repeat(150),recordedAt:index+1,eventDate:"2026-10-01"})) });
const escapedContext = await api.loadProfileContext("owner", "A");
assert.ok(escapedContext.length<=4200);
assert.match(escapedContext,/用户本人：/);
assert.match(escapedContext,/当前人物：测试人物/);
assert.match(escapedContext,/用户主动记录的行动反馈/);
const feedbackLine=escapedContext.split("\n").find(line=>line.startsWith("用户主动记录的行动反馈"));
assert.equal(JSON.parse(feedbackLine.slice(feedbackLine.indexOf("["))).length,3);
for(const line of escapedContext.split("\n")) { const start=line.search(/[\[{]/); if(start>=0) assert.doesNotThrow(()=>JSON.parse(line.slice(start))); }
for (const mode of ["paused", "no-consent"]) {
  paused = mode === "paused"; consent = mode !== "no-consent";
  calls.length = 0;
  assert.equal(await api.loadProfileContext("owner", "A"), "");
  assert.equal(calls.length, 1, "disabled memory must not query any facts or subjects");
}
console.log("Profile context recovery passed: accepted basics, manual priority, feedback, owner/person isolation and disabled memory.");
