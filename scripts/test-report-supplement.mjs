// Real report/subject/settings storage and screenshot save path; synthetic OCR/AI.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import * as supplement from '../lib/report-supplement.mjs';
import {saveAnalysisReport,readAnalysisReport,listAnalysisReports} from '../lib/saved-reports.mjs';
const nativeRequire=createRequire(import.meta.url),root=resolve('.'),sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
const db={prepare(query){return{args:[],bind(...args){this.args=args;return this},async first(){return sql.prepare(query).get(...this.args)||null},async all(){return{results:sql.prepare(query).all(...this.args)}},async run(){return{meta:{changes:Number(sql.prepare(query).run(...this.args).changes)}}}}},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const item of statements)result.push(await item.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const owner='supplement-fixture',subjectId=crypto.randomUUID(),parentReportId=crypto.randomUUID();
sql.prepare("INSERT INTO coach_subjects(id,owner_id,label,status,data,created_at,updated_at) VALUES(?,?,'合成对象','active','{}',1,1)").run(subjectId,owner);
sql.prepare("INSERT INTO coach_crush_settings(owner_id,consent_at,image_consent_at,image_self_side,provider,updated_at) VALUES(?,1,1,'right','qwen',1)").run(owner);
const parent={subjectId,analysisScope:'fullHistory',captureKind:'chat',generatedAt:'2026-10-20T00:00:00Z',semanticHistory:{summary:'旧判断只谈一次邀约',summaryEvidenceIds:['fact'],findings:[{id:'fact',claim:'曾提出周末见面',alternative:'可能仅是朋友邀约',evidence:[{sourceId:'old-source',quote:'OLD_VERIFIED_QUOTE 周末见面吗',at:'2026-10-19',sourceKind:'chat'}]},{id:'fiction',claim:'UNSUPPORTED_FICTION',evidence:[]}],unknowns:['后来有没有见面尚不清楚']}};
await saveAnalysisReport(db,{ownerId:owner,id:parentReportId,subjectId,kind:'chat',result:parent});
const original=sql.prepare('SELECT result FROM coach_saved_reports WHERE id=?').get(parentReportId).result;
const verified=await supplement.loadReportSupplement(db,owner,{parentReportId,subjectId});
const background=supplement.supplementPrompt(verified);assert.match(background,/OLD_VERIFIED_QUOTE/);assert.match(background,/旧报告/);assert.ok(!background.includes('UNSUPPORTED_FICTION'));
await assert.rejects(supplement.loadReportSupplement(db,'foreign',{parentReportId,subjectId}),supplement.ReportSupplementError);
await assert.rejects(supplement.loadReportSupplement(db,owner,{parentReportId,subjectId:crypto.randomUUID()}),supplement.ReportSupplementError);
await assert.rejects(supplement.loadReportSupplement(db,owner,{parentReportId,subjectId,target:'self'}),supplement.ReportSupplementError);
const nonFull=crypto.randomUUID();await saveAnalysisReport(db,{ownerId:owner,id:nonFull,subjectId,kind:'chat',result:{lines:[],annotations:[]}});
await assert.rejects(supplement.loadReportSupplement(db,owner,{parentReportId:nonFull,subjectId}),supplement.ReportSupplementError);
let ocrCalls=0,textCalls=0,socialCalls=0,lastBackground='',modelHook=null,visionMessages=[];
const mocks={
  '@/db':{getD1:()=>db},'cloudflare:workers':{env:{WECHAT_CALLBACK_TOKEN:'test'}},'@/app/chatgpt-auth':{getChatGPTUser:async()=>null},
  '@/lib/miniapp-auth':{miniappOwner:async()=>({ownerId:owner,openId:'synthetic'})},
  '@/lib/profile-context':{loadProfileContext:async()=>''},
  '@/lib/crush/archive':{suggestScreenshotEvents:async()=>{}},
  '../personal-context-server':{personalizeReport:async()=>({})},'@/lib/personal-context-server':{loadPersonalContext:async()=>({evidence:[]})},
  '@/lib/relationship-history':{recordRelationshipHistory:async()=>{}},
  './provider':{RUBRIC_VERSION:'fixture',classifierStatus:()=>({qwen:true,jev:false}),classify:async()=>assert.fail('No extra classification for prepared screenshot')},
  './affinity-jev':{affinityJev:async()=>assert.fail('No separate affinity call')},
  '@/lib/crush/screenshot':{
    readScreenshotQuickData:async()=>{ocrCalls++;return{raw:{layout:'wechat-one-to-one',lines:[['left','text','NEW_SCREENSHOT 周六我有空']]}}},
    readScreenshotFromQuick:async(_raw,_side,_history,profile)=>{textCalls++;lastBackground=profile;if(modelHook)await modelHook();return{text:'对方：NEW_SCREENSHOT 周六我有空',count:1,prepared:{model:'synthetic',lines:[{speaker:'other',text:'NEW_SCREENSHOT 周六我有空',annotation:{emotion:[],intent:[],evidence:'limited',note:'本次新原话谈周六安排'}}]},decision:{observation:'本次新原话',judgment:'对方提供了可用时间，可继续确认地点',evidence:'NEW_SCREENSHOT 周六我有空',nextStep:'确认地点',replyDraft:'那我们确认一下地点'}}},
    readScreenshot:async()=>assert.fail('No extra vision fallback'),
  },
  '@/lib/qwen':{parseQwenJson:JSON.parse,qwenPublicError:(_error,fallback)=>fallback,qwenChat:async(messages)=>{socialCalls++;visionMessages=messages;if(modelHook)await modelHook();return JSON.stringify({kind:'profile',readable:true,summary:'这次新截图记录登山',visibleFacts:[{title:'活动',evidence:'图1 NEW_MOMENTS 登山',meaning:'只代表本次活动'}],moments:{summary:'本次登山动态',posts:[{content:'NEW_MOMENTS 登山',evidence:'图1 NEW_MOMENTS 登山',date:'2026-10-21',contentTags:['运动']}],hypotheses:[],themes:[],unknowns:[]}})}},
};
const cache=new Map();function load(file){const path=resolve(root,file);if(cache.has(path))return cache.get(path).exports;const module={exports:{}};cache.set(path,module);if(path.endsWith('.json')){module.exports=JSON.parse(readFileSync(path,'utf8'));return module.exports;}const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',source)(id=>{if(id in mocks)return mocks[id];if(id.startsWith('.')||id.startsWith('@/')){let next=id.startsWith('@/')?resolve(root,id.slice(2)):resolve(dirname(path),id);if(!/\.(?:[cm]?[jt]sx?|json)$/.test(next))next+='.ts';return load(next)}return nativeRequire(id)},module,module.exports);return module.exports;}
const screenshot=load('app/api/crush/screenshot/route.ts');
const request=(extra={})=>new Request('https://test/api/miniapp/screenshot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmed:true,selfSide:'right',requestId:crypto.randomUUID(),sessionId:crypto.randomUUID(),image:'data:image/png;base64,AA==',subjectId,parentReportId,...extra})});
const first=request(),firstBody=await first.clone().json(),response=await screenshot.analyzeScreenshot(first,owner);assert.equal(response.status,200,await response.clone().text());const result=await response.json();
assert.equal(ocrCalls,1);assert.equal(textCalls,1);assert.match(lastBackground,/OLD_VERIFIED_QUOTE/);assert.match(lastBackground,/不能写成本次截图事实/);
assert.equal(result.analysisScope,'supplement');assert.equal(result.supplementOf.reportId,parentReportId);assert.equal(result.lines.length,1);assert.ok(result.lines.every(line=>!line.text.includes('OLD_VERIFIED_QUOTE')));
const persisted=JSON.parse(sql.prepare('SELECT result FROM coach_crush_reports WHERE id=?').get(result.id).result);assert.equal(persisted.supplementOf.reportId,parentReportId);
const retry=await screenshot.analyzeScreenshot(request(firstBody),owner);assert.equal(retry.status,200);assert.equal(ocrCalls,1);assert.equal(textCalls,1,'same request reuses source report');
const removedContext=await screenshot.analyzeScreenshot(request({...firstBody,parentReportId:null}),owner);assert.equal(removedContext.status,409,'same request cannot drop its report background');
const profile=load('app/api/miniapp/social-profile/route.ts');
const socialRequest=()=>new Request('https://test/api/miniapp/social-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmed:true,target:'other',materialType:'moments',images:['data:image/png;base64,AA=='],subjectId,parentReportId})});
const socialResponse=await profile.POST(socialRequest());assert.equal(socialResponse.status,200,await socialResponse.clone().text());const moments=await socialResponse.json();assert.equal(moments.analysisScope,'supplement');assert.equal(moments.supplementOf.reportId,parentReportId);assert.equal(socialCalls,1);assert.match(JSON.stringify(visionMessages),/OLD_VERIFIED_QUOTE/);assert.ok(!JSON.stringify(moments.moments.posts).includes('OLD_VERIFIED_QUOTE'));
const batchId=crypto.randomUUID();await saveAnalysisReport(db,{ownerId:owner,id:batchId,subjectId,kind:'chat',imageCount:1,supplement:verified,result:{entries:[result]}});const reopened=await readAnalysisReport(db,owner,batchId);assert.equal(reopened.entries[0].analysisScope,'supplement');assert.equal(reopened.report.supplementOf.reportId,parentReportId);
const listing=await listAnalysisReports(db,owner);assert.equal(listing.reports.find(row=>row.id===batchId).analysisScope,'supplement');assert.equal(listing.reports.find(row=>row.id===parentReportId).captureKind,'chat');assert.equal((await listAnalysisReports(db,'foreign')).total,0);
assert.equal(sql.prepare('SELECT result FROM coach_saved_reports WHERE id=?').get(parentReportId).result,original);
modelHook=()=>sql.prepare("UPDATE coach_subjects SET status='deleted' WHERE id=?").run(subjectId);
const failed=await screenshot.analyzeScreenshot(request(),owner);assert.equal(failed.status,409);assert.equal(sql.prepare("SELECT count(*) AS n FROM coach_crush_reports WHERE owner_id=? AND status='done'").get(owner).n,1,'parent/person change during model never saves a second report');
sql.prepare("UPDATE coach_subjects SET status='active' WHERE id=?").run(subjectId);
modelHook=()=>sql.prepare("UPDATE coach_saved_reports SET status='deleted' WHERE id=?").run(parentReportId);
const failedSocial=await profile.POST(socialRequest());assert.equal(failedSocial.status,409);
await assert.rejects(saveAnalysisReport(db,{ownerId:owner,id:crypto.randomUUID(),subjectId,kind:'chat',supplement:verified,result:{entries:[result]}}),supplement.ReportSupplementError);
sql.close();console.log('PASS supplement real SQLite + source routes: verified same-person full history, grounded background, new evidence only, no extra model calls, durable metadata/list, replay guard, mid-flight deletion/person change stops saves.');
