import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import * as crypto from "node:crypto";
const load=(file,deps={})=>{const exports={};const js=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function("exports","require",js)(exports,name=>{if(!(name in deps))throw Error(name);return deps[name];});return exports;};
const timeline=load("lib/relationship-timeline.ts",{"node:crypto":crypto});
const {relationshipEventCandidates}=load("lib/relationship-event-candidates.ts",{"@/lib/relationship-timeline":timeline,"node:crypto":crypto});
const lines=[
  {id:"1",speaker:"self",text:"明天一起吃饭吗？",timestampRaw:"2026-10-01 18:00"},
  {id:"2",speaker:"unknown",text:"周末见",timestampRaw:"18:01"},
  {id:"3",speaker:"other",text:"请不要临时改时间",timestampRaw:"18:02"},
  {id:"4",speaker:"other",text:"抱歉，今天有事",timestampRaw:"昨天"},
  {id:"5",speaker:"self",text:"明天一起吃饭吗？",timestampRaw:"2026-10-04 18:00"},
  {id:"6",speaker:"other",text:"没看清的邀约",timestampRaw:"18:01"}
];
const report={id:"source-report",lines,annotations:lines.map((line,i)=>({lineId:line.id,evidence:i===5?"insufficient":"sufficient",intent:[{key:i===2?"boundary":i===3?"apologize":"invite"}]}))};
const before=structuredClone(report);
const events=relationshipEventCandidates(report);
assert.deepEqual(events.map(item=>item.sourceLineId),["1","3","4","5"]);
assert.deepEqual(events.map(item=>item.spokenDate),["2026-10-01","2026-10-01","","2026-10-04"]);
assert.equal(events[0].title,"发出邀约");
assert.equal(events[0].spokenDate,"2026-10-01","tomorrow in an invitation is not its speech date or proof of fulfillment");
assert.equal(events[0].quote,events[3].quote,"same words on different dates stay separate at extraction");
assert.notEqual(events[0].eventKey,events[3].eventKey);
assert.equal(relationshipEventCandidates({...report,id:"repeat-report"})[0].eventKey,events[0].eventKey,"reanalysis must not create a new event key");
assert.ok(events.every(item=>item.sourceReportId===report.id&&!item.confirmed&&item.scope==="speech_act"));
assert.deepEqual(report,before);
console.log("PASS: dated source-linked speech acts, unknown speakers excluded, relative dates unset, repeated words retained across days, no invented fulfillment");
