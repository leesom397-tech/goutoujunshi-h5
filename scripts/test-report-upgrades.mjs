import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import ts from "typescript";
const cache=new Map();
function load(path,overrides={}){
 const file=path.endsWith(".ts")?path:path+".ts";
 if(cache.has(file)&&!Object.keys(overrides).length)return cache.get(file);
 const output={};const js=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function("exports","require",js)(output,name=>overrides[name]??load(name.startsWith("@/")?name.slice(2):"lib/"+name.replace(/^\.\//,"")));
 if(!Object.keys(overrides).length)cache.set(file,output);return output;
}
const {reportVersionChanges}=load("lib/report-version-changes");
const firstId="11111111-1111-4111-8111-111111111111",reportId="22222222-2222-4222-8222-222222222222";
const evidence=(id,quote)=>({sourceId:id,libraryId:"lib-chat",senderRole:"other",quote,at:"2026-10-02"});
const finding=(id,claim,source)=>({id,claim,evidence:[source]});
const earlier={id:firstId,createdAt:1,report:{semanticHistory:{summary:"还没约定时间。",findings:[finding("a","愿意安排见面",evidence("1","有空一起看展。"))]}}};
const current={id:reportId,createdAt:2,report:{semanticHistory:{summary:"已经提出具体安排。",summaryEvidenceIds:["c"],findings:[finding("b","愿意安排见面",evidence("2","下周一起看看时间。")),finding("c","提出时间",evidence("3","周六两点我可以。")),finding("d","换一个词重复同一事件",evidence("3","周六两点我可以。"))]}}};
let result=reportVersionChanges([earlier,current],reportId);
assert.deepEqual(result.items.map(item=>item.kind),["supporting","revised"]);
assert.equal(result.items.length,2,"same evidence event not repeated across claims");
assert.equal(result.previousId,firstId);
result=reportVersionChanges([earlier,{...current,report:earlier.report}],reportId);
assert.equal(result.items.length,0);assert.match(result.note,/不据此认定关系没有变化/);
assert.equal(reportVersionChanges([current],reportId).status,"first");

const sqlite=new DatabaseSync(":memory:");
sqlite.exec(`CREATE TABLE coach_profiles(owner_id TEXT,consent_at INTEGER,paused INTEGER,data TEXT);
CREATE TABLE coach_subjects(id TEXT,owner_id TEXT,status TEXT,data TEXT,updated_at INTEGER);
CREATE TABLE coach_facts(id TEXT,owner_id TEXT,subject_id TEXT,field TEXT,value TEXT,evidence TEXT,event_meta TEXT,status TEXT,created_at INTEGER);
CREATE TABLE coach_capture_libraries(id TEXT,owner_id TEXT,subject_id TEXT,epoch INTEGER,revision INTEGER,deleted_at INTEGER);
CREATE TABLE coach_capture_records(owner_id TEXT,library_id TEXT,epoch INTEGER);
INSERT INTO coach_profiles VALUES('owner',1,0,'{"city":"上海"}');
INSERT INTO coach_subjects VALUES('person','owner','active','{"city":"杭州"}',1);
INSERT INTO coach_subjects VALUES('private','other','active','{}',1);
INSERT INTO coach_capture_libraries VALUES('lib-chat','owner','person',1,2,NULL);
INSERT INTO coach_capture_records VALUES('owner','lib-chat',1);`);
const db={prepare(sql){return{bind(...args){return{async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return{results:sqlite.prepare(sql).all(...args)};},async run(){return{meta:{changes:sqlite.prepare(sql).run(...args).changes}};}};}};}};
const {reportContextSnapshot,reportFreshness}=load("lib/report-freshness");
const snapshot=await reportContextSnapshot(db,"owner","person");assert.equal(snapshot.version,1);assert.deepEqual(snapshot.libraryIds,["lib-chat"]);
sqlite.prepare("UPDATE coach_subjects SET data=json_set(data,'$.relationshipHistory',json(?)),updated_at=9 WHERE id='person'").run(JSON.stringify([{reportId,nextStep:"确认具体时间",updatedAt:3}]));
assert.deepEqual(await reportContextSnapshot(db,"owner","person"),snapshot,"report history never invalidates itself");
const saved={analysisScope:"fullHistory",analysisVersion:load("lib/capture-report-version").CAPTURE_REPORT_VERSION,archiveSnapshot:{libraryId:"lib-chat",epoch:1,revision:2,total:1},contextSnapshot:snapshot};
assert.equal((await reportFreshness(db,"owner","person",saved)).status,"current");
assert.equal((await reportFreshness(db,"owner","person",{...saved,analysisVersion:undefined})).analysisUpdated,true,"old complete report must not block the improved analysis through indefinite reuse");
assert.equal((await reportFreshness(db,"owner","person",{...saved,analysisVersion:undefined})).status,"changed");
sqlite.exec("INSERT INTO coach_capture_libraries VALUES('lib-new','owner','person',1,1,NULL)");
assert.equal((await reportFreshness(db,"owner","person",saved)).newLibraries,1);
sqlite.exec("DELETE FROM coach_capture_libraries WHERE id='lib-new'; UPDATE coach_subjects SET data=json_set(data,'$.city','成都') WHERE id='person'");
assert.equal((await reportFreshness(db,"owner","person",saved)).profileChanged,true);
assert.equal(await reportContextSnapshot(db,"owner","private"),null);
sqlite.exec("INSERT INTO coach_facts VALUES('foreign','other','private','city','北京','','','accepted',1)");
const beforeForeign=await reportContextSnapshot(db,"owner","person");
sqlite.exec("UPDATE coach_facts SET value='深圳' WHERE id='foreign'");
assert.deepEqual(await reportContextSnapshot(db,"owner","person"),beforeForeign);
assert.equal((await reportFreshness(db,"owner","person",{...saved,contextSnapshot:undefined})).status,"unknown");

// Every profile editor field participates, including numeric scores and the
// older subject basic fields. Report-generated metadata stays excluded.
{
const {selfFields,subjectFields,dimensions:profileDimensions}=load("lib/profile");
const selfBase=JSON.parse(sqlite.prepare("SELECT data FROM coach_profiles WHERE owner_id='owner'").get().data);
const personBase=JSON.parse(sqlite.prepare("SELECT data FROM coach_subjects WHERE id='person'").get().data);
const updateSelf=value=>sqlite.prepare("UPDATE coach_profiles SET data=? WHERE owner_id='owner'").run(JSON.stringify(value));
const updatePerson=value=>sqlite.prepare("UPDATE coach_subjects SET data=? WHERE id='person'").run(JSON.stringify(value));
for(const [side,keys,base,update] of [["self",selfFields,selfBase,updateSelf],["other",[...new Set([...subjectFields,...selfFields])],personBase,updatePerson]]){
 for(const key of keys){
  update({...base,[key]:key==="subjectiveScore"?20:"修改前"});
  const before=await reportContextSnapshot(db,"owner","person");
  update({...base,[key]:key==="subjectiveScore"?80:"修改后"});
  assert.notEqual((await reportContextSnapshot(db,"owner","person")).profileFingerprint,before.profileFingerprint,`${side}.${key} modification invalidates context`);
  assert.equal((await reportFreshness(db,"owner","person",{...saved,contextSnapshot:before})).profileChanged,true,`${side}.${key} is visibly stale`);
  update(base);
 }
}
for(const [key,base,update] of [["weights",selfBase,updateSelf],["ratings",personBase,updatePerson]])for(const {key:dimension} of profileDimensions){
 update({...base,[key]:{[dimension]:1}});const before=await reportContextSnapshot(db,"owner","person");
 update({...base,[key]:{[dimension]:5}});assert.notEqual((await reportContextSnapshot(db,"owner","person")).profileFingerprint,before.profileFingerprint,`${key}.${dimension}`);update(base);
}
const stable=await reportContextSnapshot(db,"owner","person");
updateSelf({...Object.fromEntries(Object.entries(selfBase).reverse()),reportHistory:[{id:"automatic-report"}],updatedAt:999});
updatePerson({...Object.fromEntries(Object.entries(personBase).reverse()),updatedAt:999});
assert.deepEqual(await reportContextSnapshot(db,"owner","person"),stable,"key order and generated metadata do not invalidate context");
updateSelf(selfBase);updatePerson(personBase);
const addMemory=(id,value,ownerId="owner",subjectId=null,field="selfArchiveSummary",status="derived")=>sqlite.prepare("INSERT INTO coach_facts VALUES(?,?,?,?,?,'','',?,1)").run(id,ownerId,subjectId,field,JSON.stringify(value),status);
const setMemory=(id,value,time=1)=>sqlite.prepare("UPDATE coach_facts SET value=?,created_at=? WHERE id=?").run(JSON.stringify(value),time,id);
const statement={id:"line-1:interests",sourceId:"line-1",field:"interests",label:"兴趣",value:"我喜欢运动",quote:"我喜欢运动",at:"2026-10-01",basis:"statement"};
const memory={version:1,libraryId:"lib-chat",epoch:1,items:[statement],removed:[]};
addMemory("self-archive:lib-chat:1",memory);
addMemory("self-archive:empty:1",{version:1,items:[],removed:[]});
assert.deepEqual(await reportContextSnapshot(db,"owner","person"),stable,"new automatic statement and empty facts do not stale a generating report");
setMemory("self-archive:lib-chat:1",{...memory,version:7,items:[{...statement,value:"自动摘要更新"},{...statement,id:"line-2:interests",sourceId:"line-2"}]},999);
assert.deepEqual(await reportContextSnapshot(db,"owner","person"),stable,"automatic values, added statements, version and creation time are excluded");
const corrected={...statement,value:"纠正：只喜欢周末散步",basis:"correction"};
setMemory("self-archive:lib-chat:1",{...memory,version:8,items:[corrected]});
const correctedSnapshot=await reportContextSnapshot(db,"owner","person");
assert.notEqual(correctedSnapshot.profileFingerprint,stable.profileFingerprint,"user correction invalidates the original context");
setMemory("self-archive:lib-chat:1",{...memory,version:9,items:[statement,corrected]},3000);
assert.deepEqual(await reportContextSnapshot(db,"owner","person"),correctedSnapshot,"automatic statements appended next to a correction are ignored");
setMemory("self-archive:lib-chat:1",{...memory,items:[{...corrected,value:"再次纠正：偏好室内运动"}]});
assert.notEqual((await reportContextSnapshot(db,"owner","person")).profileFingerprint,correctedSnapshot.profileFingerprint,"subsequent correction invalidates old interpretation");
const secondCorrection={...corrected,id:"line-3:goals",sourceId:"line-3",field:"goals",value:"纠正目标",quote:"我打算学摄影"};
const two={...memory,items:[corrected,secondCorrection],removed:["removed-b","removed-a"]};
setMemory("self-archive:lib-chat:1",two);const ordered=await reportContextSnapshot(db,"owner","person");
setMemory("self-archive:lib-chat:1",{...two,items:[secondCorrection,corrected],removed:["removed-a","removed-b","removed-a"],version:100},5000);
assert.deepEqual(await reportContextSnapshot(db,"owner","person"),ordered,"correction/removal canonicalization ignores item ordering, duplicates and metadata");
setMemory("self-archive:lib-chat:1",{...memory,items:[],removed:[statement.id]});
const removedSnapshot=await reportContextSnapshot(db,"owner","person");
assert.notEqual(removedSnapshot.profileFingerprint,stable.profileFingerprint,"removal alone persists as a freshness change");
setMemory("self-archive:lib-chat:1",{...memory,items:[],removed:[statement.id,"interests:我喜欢运动"]});
assert.notEqual((await reportContextSnapshot(db,"owner","person")).profileFingerprint,removedSnapshot.profileFingerprint,"another removed identity also invalidates cache");
const beforePrivate=await reportContextSnapshot(db,"owner","person");
addMemory("foreign-self",two,"other");addMemory("other-person-derived",two,"owner","unrelated-person");addMemory("other-derived-field",two,"owner",null,"unrelatedSummary");addMemory("pending-self",two,"owner",null,"selfArchiveSummary","pending");
assert.deepEqual(await reportContextSnapshot(db,"owner","person"),beforePrivate,"foreign owners, other subjects, fields and unconfirmed memory kinds are isolated");
console.log("PASS profile freshness: every editor field and dimension, corrected/removed self memories; stable ordering and automatic statement exclusion; strict owner/self scope.");
}

const feedback=load("lib/relationship-feedback"),updates=load("lib/relationship-updates");
let owner="owner";
const route=load("app/api/miniapp/relationship-feedback/route",{
 "@/lib/miniapp-auth":{miniappOwner:async()=>({ownerId:owner})},"@/db":{getD1:()=>db},
 "@/lib/relationship-feedback":feedback,"@/lib/relationship-updates":updates,
 "@/lib/report-version-changes":{reportVersionChanges},
 "@/lib/relationship-evidence-server":{loadRelationshipEvidence:async()=>({authorized:true,validFocus:true,reports:[earlier,current],data:JSON.parse(sqlite.prepare("SELECT data FROM coach_subjects WHERE id='person'").get().data),cutoff:2})}
});
const post=async(outcome,note,id)=>route.POST(new Request("https://test/api/web/relationship-feedback",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({subjectId:"person",reportId,id,outcome,note,eventDate:"",confirmed:true})}));
assert.equal((await post("waiting","我已确认时间","33333333-3333-4333-8333-333333333333")).status,200);
const get=()=>route.GET(new Request("https://test/api/web/relationship-feedback?subjectId=person&reportId="+reportId));
let response=await(await get()).json();assert.equal(response.currentFeedback.latest.note,"我已确认时间","new feedback after historical report cutoff is visible");
assert.equal((await post("changed","纠正：我还没联系，对方主动约了周末","44444444-4444-4444-8444-444444444444")).status,200);
response=await(await get()).json();assert.equal(response.currentFeedback.latest.outcome,"changed");assert.equal(response.currentFeedback.revisionCount,2);
assert.match(feedback.actionFeedbackContext(JSON.parse(sqlite.prepare("SELECT data FROM coach_subjects WHERE id='person'").get().data)),/纠正：我还没联系/);
assert.doesNotMatch(feedback.actionFeedbackContext(JSON.parse(sqlite.prepare("SELECT data FROM coach_subjects WHERE id='person'").get().data)),/我已确认时间/);
owner="other";assert.equal((await get()).status,403);owner="owner";
sqlite.exec("UPDATE coach_profiles SET paused=1");assert.equal((await get()).status,403);sqlite.exec("UPDATE coach_profiles SET paused=0");

let seen=[],calls=0;
const dimensions=[{key:"a",label:"主动性",weight:100,question:"?",levels:[]}];
const affinity=load("lib/crush/affinity-jev",{
 "cloudflare:workers":{env:{JEV_API_KEY:"synthetic"}},
 "@/vendor/crush-monitor/shared/affinity":{AFFINITY_DIMENSIONS:dimensions,composeAffinity:()=>({affinity:{value:50,status:"clear"},boundaryApplied:false})},
 "./provider":{validateChoice:()=>({choice:"sufficient",confidence:1})},"./evidence":{readableChat:lines=>lines},
 "./jev-client":{requestJev:async(state)=>{seen=state.messages;calls++;return {boundary:{type:"noul",noul:0},a:{type:"score",score:2,confidence:1,probabilities:{"0":0,"1":0,"2":1,"3":0,"4":0}},a_enough:{}};}}
});
const lines=Array.from({length:81},(_,i)=>({speaker:i%2?"other":"self",text:i===0?"最早的完整原话".repeat(30):"完整消息"+i}));
const affinityResult=await affinity.affinityJev(lines);
assert.equal(affinityResult.contextCount,81);assert.equal(seen.length,81);assert.equal(seen[0].text,lines[0].text,"no per-line silent truncation");
const tooLarge=await affinity.affinityJev(Array.from({length:801},()=>({speaker:"other",text:"文本"})));
assert.equal(calls,1);assert.equal(tooLarge.contextCount,0);assert.equal(tooLarge.inputCount,801);assert.match(tooLarge.unavailableReason,/超出/);
console.log("PASS report versions: exact evidence dedup, support/revision limits; SQLite freshness/owner isolation; after-report feedback corrections and future context; full 81-line affinity and explicit budget rejection.");

// A handoff carries raw lines separately, preserving English/newlines; generated
// summaries and uncertain speakers never enter the original-quote channel.
const clientJs=ts.transpileModule(readFileSync("components/web-analysis/client.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const client={};new Function("exports","require",clientJs)(client,()=>({}));
const memory=new Map();globalThis.sessionStorage={setItem:(k,v)=>memory.set(k,v)};globalThis.window={location:{href:""}};
client.followup({reportId,subjectId:"person",decision:{judgment:"Generated interpretation must stay summary-only"},lines:[{speaker:"unknown",text:"unverified role"},{speaker:"other",text:"[语音]"},{speaker:"self",text:"My original\nquestion"},{speaker:"other",text:"Keep the English source intact."}]},"owner");
const handoff=JSON.parse([...memory.values()].at(-1));assert.deepEqual(handoff.originalQuotes,[{speaker:"self",text:"My original\nquestion"},{speaker:"other",text:"Keep the English source intact."}]);
assert.match(handoff.summary,/Generated interpretation/);assert.ok(!handoff.originalQuotes.some(row=>row.text.includes("Generated")));assert.equal(handoff.reportId,reportId);
client.followup({reportId,analysisScope:"fullHistory",lines:[],semanticHistory:{summary:"generated",findings:[{quote:"not report.lines"}]}},"owner");
assert.deepEqual(JSON.parse([...memory.values()].at(-1)).originalQuotes,[]);
const legacy=await reportFreshness(db,"owner","person",{analysisScope:"fullHistory",archiveSnapshot:{libraryId:"lib-chat"}});
assert.equal(legacy.status,"changed");assert.equal(legacy.analysisUpdated,true,"legacy reports may offer the newer interpretation without asserting material changes");
assert.equal(legacy.added,0,"unknown prior count must not claim newly imported records");assert.equal(legacy.profileChanged,false);
console.log("PASS quote provenance handoff and explicit legacy analysis upgrade.");

{
 const old={...earlier,report:{...earlier.report,analysisScope:"fullHistory",archiveSnapshot:{libraryId:"same"},relationshipDiagnosis:{question:"next"},semanticHistory:{...earlier.report.semanticHistory,status:"complete",action:"先问对方哪天方便。"}}};
 const now={...current,report:{...current.report,analysisScope:"fullHistory",archiveSnapshot:{libraryId:"same"},relationshipDiagnosis:{question:"next"},semanticHistory:{...current.report.semanticHistory,status:"complete",action:"确认已经提出的周六安排。",actionEvidenceIds:["c"]}}};
 assert.equal(reportVersionChanges([old,now],reportId).actionChange.after,"确认已经提出的周六安排。");
 assert.equal(reportVersionChanges([old,{...now,report:{...now.report,archiveSnapshot:{libraryId:"different"}}}],reportId).actionChange,undefined,"different source windows cannot imply advice adjustment");
 assert.equal(reportVersionChanges([old,{...now,report:{...now.report,semanticHistory:{...now.report.semanticHistory,actionEvidenceIds:[]}}}],reportId).actionChange,undefined,"no supporting new evidence means no advice change claim");
 assert.equal(reportVersionChanges([old,{...now,report:{...now.report,relationshipDiagnosis:{question:"risk"}}}],reportId).actionChange,undefined,"different goals are not compared as a revised action");
 console.log("PASS advice adjustments require same full-history sources, same goal and new verified action evidence.");
}
