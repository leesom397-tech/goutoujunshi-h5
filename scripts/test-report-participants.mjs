import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const sql=new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE coach_subjects(id TEXT,owner_id TEXT,label TEXT,status TEXT);
CREATE TABLE coach_capture_libraries(id TEXT,owner_id TEXT,friend TEXT,subject_id TEXT,deleted_at INTEGER);`);
const db={prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)||null;}};}};}};
function load(path,imports={}){const output={};const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',source)(output,name=>{assert.ok(name in imports,'unexpected dependency '+name);return imports[name];});return output;}
const {loadReportParticipants}=load('lib/report-participants-server.ts');
const owner='owner-a',person='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',library='cl_'+'a'.repeat(64);
sql.prepare("INSERT INTO coach_subjects VALUES(?,?,?,'active')").run(person,owner,'林小欣');
sql.prepare("INSERT INTO coach_subjects VALUES(?,?,?,'active')").run(person,'owner-b','同编号但另一个账号');
sql.prepare('INSERT INTO coach_capture_libraries VALUES(?,?,?,?,NULL)').run(library,owner,'微信备注 · #abcdef0123456789',person);
const original={id,reportId:id,subjectId:person,analysisScope:'fullHistory',archiveSnapshot:{libraryId:library},summary:'已保存的历史判断',semanticHistory:{findings:[]}};
let result=await loadReportParticipants(db,owner,person,original);
assert.equal(result.other.label,'林小欣');assert.equal(result.self.label,'你');assert.equal(result.identified,true);assert.equal(result.source,'profile');
assert.equal((await loadReportParticipants(db,'stranger',person,original)).identified,false,'no cross-account profile lookup');
assert.equal((await loadReportParticipants(db,'stranger',null,original)).identified,false,'no cross-account source lookup');
const libraryOnly=await loadReportParticipants(db,owner,null,original);assert.equal(libraryOnly.other.label,'微信备注');assert.equal(libraryOnly.source,'capture');
sql.prepare("UPDATE coach_subjects SET label='新备注' WHERE id=? AND owner_id=?").run(person,owner);
assert.equal((await loadReportParticipants(db,owner,person,original)).other.label,'新备注','read projection reflects corrected name');
const otherId='33333333-3333-4333-8333-333333333333';sql.prepare("INSERT INTO coach_subjects VALUES(?,?,?,'active')").run(otherId,owner,'对方');
assert.equal((await loadReportParticipants(db,owner,otherId,original)).identified,false,'another person cannot inherit the source name');
assert.equal((await loadReportParticipants(db,owner,null,{summary:'分析对象是随便一个名字',lines:[{speaker:'other',sender:'冒充的名字'}]})).identified,false,'prose and message sender do not decide report subject');
let saved={kind:'chat',reportId:id,subjectId:person,report:original,entries:[{...original,id:'entry-1'},{...original,id:'entry-2'}]},loggedIn=true,readCalls=0;
const route=load('app/api/miniapp/report/route.ts',{
 '@/lib/miniapp-auth':{miniappOwner:async()=>loggedIn?{ownerId:owner}:null},
 '@/lib/crush/service':{ownedReport:async()=>{throw Error('unexpected old report read');}},
 '@/lib/crush/types':{CrushError:class extends Error{}},
 '@/lib/relationship-context-server':{loadRelationshipFit:async()=>null},
 '@/db':{getD1:()=>db},
 '@/lib/saved-reports.mjs':{readAnalysisReport:async()=>{readCalls++;return structuredClone(saved);}},
 '@/lib/crush/evidence':{readableReport:value=>({...value,readableLineCount:0})},
 '@/lib/personal-context-server':{personalizeReport:async()=>({commonPoints:[]})},
 '@/lib/report-freshness':{reportFreshness:async()=>null},
 '@/lib/report-participants-server':{loadReportParticipants},
 '@/lib/capture-history-purge':{},
});
const response=await route.GET(new Request('https://test.invalid/api/web/report?id='+id));assert.equal(response.status,200);
const body=await response.json();assert.equal(body.report.participants.other.label,'新备注');assert.ok(body.entries.every(entry=>entry.participants.other.label==='新备注'),'batch entries retain participant projection before frontend merge');assert.equal(body.report.summary,original.summary,'does not rewrite old analysis');
saved={...saved,report:{...original,riskAnalysis:{summary:'旧风险报告'}}};assert.equal((await (await route.GET(new Request('https://test.invalid/api/web/report?id='+id))).json()).report.participants.other.label,'新备注','legacy risk also gets identity');
loggedIn=false;const before=readCalls;assert.equal((await route.GET(new Request('https://test.invalid/api/web/report?id='+id))).status,401);assert.equal(readCalls,before);
sql.prepare("UPDATE coach_subjects SET status='deleted' WHERE id=? AND owner_id=?").run(person,owner);
assert.equal((await loadReportParticipants(db,owner,person,{...original,participants:result})).identified,false,'removed identity is not resurrected from a stored label');
console.log('PASS report participant identity: authenticated profile/source resolution, renamed and unknown subjects, account/person isolation, batch/risk GET projection, preserved historical conclusions; no model calls.');
