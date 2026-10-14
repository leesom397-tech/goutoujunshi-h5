// Actual workerd Durable Object storage/alarms and SQLite billing. Synthetic media only.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const mockApp=`const app={async fetch(request,env,ctx){
 const body=await request.json(),owner=request.headers.get('authorization').slice(7),task=request.headers.get('x-screenshot-task');
 const stub=env.JOBS.get(env.JOBS.idFromName(owner));
 const cp=update=>stub.screenshotCheckpoint(task,body.requestId,owner,'fixture-secret',update);
 const prior=await cp(),stats=await ctx.storage.get('test:stats')||{ocr:0,analyses:0,budgets:0};
 if(!prior.budgetReserved){stats.budgets++;await cp({phase:'ocr',budgetReserved:true});}
 const tag=atob(body.image.split(',')[1]);
 const raw=prior.raw||{layout:tag==='layout'?'other':'wechat-one-to-one',lines:tag==='doubt'?[['unknown','text','可见原话'],['right','unread','']]:[['left','text','合成原话'],['right','image','']],photoClues:[]};
 if(!prior.raw)stats.ocr++;await ctx.storage.put('test:stats',stats);await cp({phase:'recognized',raw});
 if(prior.reviewOnDoubt&&!prior.reviewed&&recognitionSnapshot(raw,{index:0,requestId:body.requestId,selfSide:body.selfSide}).issues.length)return Response.json({reviewRequired:true},{status:202});
 await cp({phase:'text_analysis'});await new Promise(resolve=>setTimeout(resolve,200));stats.analyses++;await ctx.storage.put('test:stats',stats);await cp({phase:'save'});
 return Response.json({id:body.requestId,lines:raw.lines.map((line,index)=>({id:String(index),speaker:line[0]===body.selfSide?'self':'other',text:line[2]})),decision:{judgment:'合成已完成报告'},selfSide:body.selfSide});
}};`;
let source=readFileSync('lib/social-profile-jobs.mjs','utf8').replace('import app from "../dist/server/index.js";',mockApp)
 .replace('import { requestOwner, isWebApi, webSessionCookie } from "./request-identity.mjs";',`const requestOwner=async()=>null,isWebApi=()=>false,webSessionCookie=()=>'';`);
source+=`
export class TestJobs extends SocialProfileJobs{
 async fetch(request){
  if(new URL(request.url).pathname==='/inspect')return Response.json(Object.fromEntries(await this.ctx.storage.list()));
  if(request.method==='POST'){const body=await request.json();body.ownerId=request.headers.get('x-test-owner')||'fixture-a';request=new Request(request,{body:JSON.stringify(body)});}
  return super.fetch(request);
 }
}
export default{fetch(request,env){const owner=request.headers.get('x-test-owner')||'fixture-a';return env.JOBS.get(env.JOBS.idFromName(owner)).fetch(request)}};`;
const bundled=await build({stdin:{contents:source,resolveDir:resolve('lib'),sourcefile:'review-runtime.mjs'},bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],write:false});
const persist=mkdtempSync(join(tmpdir(),'chengzi-review-runtime-'));
const options={modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-05-15',bindings:{WECHAT_CALLBACK_TOKEN:'fixture-secret'},d1Databases:{DB:'review-ledger'},d1Persist:join(persist,'db'),durableObjects:{JOBS:{className:'TestJobs',useSQLite:true}},durableObjectsPersist:join(persist,'do')};
let runtime=new Miniflare(options);
const image=tag=>'data:image/png;base64,'+Buffer.from(tag).toString('base64');
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const url=task=>'http://local/api/miniapp/screenshot/batch?taskId='+task;
const get=async(task,owner='fixture-a')=>(await runtime.dispatchFetch(url(task),{headers:{'x-test-owner':owner}})).json();
const inspect=async()=>(await runtime.dispatchFetch('http://local/inspect')).json();
async function post(task,body,expected=200,owner='fixture-a'){
 const response=await runtime.dispatchFetch(url(task),{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+owner,'x-test-owner':owner},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;
}
const init=task=>({uploadAction:'init',confirmed:true,autoStart:true,imageCount:2,selfSide:'right',sessionId:task,reviewOnDoubt:true});
async function waitStatus(task,status){let value;const end=Date.now()+10000;do{value=await get(task);if(value.status===status)return value;await delay(70)}while(Date.now()<end);assert.fail('Expected '+status+': '+JSON.stringify(value));}
const confirm=(recognition,overrides={})=>({reviewAction:'confirm',confirmed:true,index:recognition.index,requestId:recognition.requestId,revision:recognition.revision,selfSide:recognition.selfSide,lines:recognition.lines,...overrides});
try{
 let db=await runtime.getD1Database('DB');
 for(const name of ['0015_account_credits','0016_credit_receipts','0018_saved_analysis_reports']){
  const sql=readFileSync('drizzle/'+name+'.sql','utf8').replace(/^\s*--.*$/gm,'');
  for(const statement of sql.match(/CREATE TRIGGER[\s\S]*?\nEND;|CREATE (?:TABLE|INDEX)[\s\S]*?;/g))await db.prepare(statement).run();
 }
 await db.prepare('CREATE TABLE coach_subjects(id TEXT,owner_id TEXT,status TEXT)').run();
 await db.prepare('CREATE TABLE coach_crush_reports(id TEXT,owner_id TEXT,status TEXT,result TEXT)').run();
 await db.prepare("INSERT INTO coach_credit_accounts(owner_id,public_id,balance,features,enabled_until,created_at,updated_at) VALUES ('fixture-a','public-a',1000,'[\"analysis\"]',?,0,0)").bind(Date.now()+86400000).run();
 const task=id(1),parameters=init(task);await post(task,parameters,201);await post(task,{uploadAction:'part',index:0,image:image('clear')});await post(task,{uploadAction:'part',index:1,image:image('doubt')});
 let pending=await waitStatus(task,'awaiting_review');assert.equal(pending.completedCount,1);assert.equal(pending.partialResult.entries.length,1);assert.equal(pending.recognition.editable,true);assert.equal(pending.recognition.index,1);assert.equal(pending.recognition.lines[0].side,'unknown');
 const prior=(await inspect())['test:stats'];assert.deepEqual(prior,{ocr:2,analyses:1,budgets:2});
 assert.equal((await get(task,'fixture-b')).status,'expired','another namespace cannot read the snapshot');
 await post(task,confirm(pending.recognition,{index:0}),409);await post(task,confirm(pending.recognition,{selfSide:'left'}),409);
 await runtime.dispose();runtime=new Miniflare(options);pending=await get(task);assert.equal(pending.status,'awaiting_review');assert.equal(pending.partialResult.entries.length,1,'partial result and OCR survive full runtime restart');
 const payload=confirm(pending.recognition,{lines:[{side:'left',kind:'text',text:'修正后的原话'},{side:'right',kind:'sticker',text:''}]});
 await post(task,payload,202);await post(task,payload,202);await post(task,{...payload,lines:[{side:'left',kind:'text',text:'不能改第二版'},payload.lines[1]]},409);
 await post(task,parameters,202);const done=await waitStatus(task,'done');assert.equal(done.result.entries[1].lines[0].text,'修正后的原话');assert.equal(done.result.selfSide,'right');
 assert.deepEqual((await inspect())['test:stats'],{ocr:2,analyses:2,budgets:2},'confirmation/repeated init never repeats OCR or daily usage');await post(task,payload,202);
 db=await runtime.getD1Database('DB');assert.equal((await db.prepare('SELECT status FROM coach_credit_tasks WHERE request_id=?').bind(task).first()).status,'settled');
 assert.equal((await db.prepare("SELECT balance FROM coach_credit_accounts WHERE owner_id='fixture-a'").first()).balance,980,'only original task price charged');
 const cancel=id(2);await post(cancel,init(cancel),201);await post(cancel,{uploadAction:'part',index:0,image:image('clear')});await post(cancel,{uploadAction:'part',index:1,image:image('doubt')});await waitStatus(cancel,'awaiting_review');
 assert.equal((await post(cancel,{reviewAction:'cancel'})).reviewCancelled,true);await post(cancel,{reviewAction:'cancel'});
 const cancelled=await get(cancel);assert.equal(cancelled.status,'error');assert.equal(cancelled.partialResult.entries.length,1,'cancel retains completed single-image report');
 assert.equal((await db.prepare('SELECT status FROM coach_credit_tasks WHERE request_id=?').bind(cancel).first()).status,'released');assert.equal((await db.prepare("SELECT balance FROM coach_credit_accounts WHERE owner_id='fixture-a'").first()).balance,980,'repeated cancellation releases original reservation once');
 const state=await inspect();assert.equal(Object.keys(state).filter(key=>key.startsWith('screenshot:'+cancel)||key.startsWith('upload:'+cancel)).length,0,'cancel deletes temporary OCR/images');
 const blocked=id(3);await post(blocked,{...init(blocked),imageCount:1},201);await post(blocked,{uploadAction:'part',index:0,image:image('layout')});const layout=await waitStatus(blocked,'awaiting_review');assert.equal(layout.recognition.canContinue,false);await post(blocked,confirm(layout.recognition),422);await post(blocked,{reviewAction:'cancel'});
 const legacy=id(4);await post(legacy,{...init(legacy),imageCount:1,reviewOnDoubt:false},201);await post(legacy,{uploadAction:'part',index:0,image:image('doubt')});assert.equal((await waitStatus(legacy,'done')).status,'done','old clients retain automatic flow');
 console.log('PASS actual Durable Object+SQLite: doubt pauses before analysis, owner isolation, partial results, restart/confirm/init recovery, OCR/daily-budget reuse, single fee, idempotent cancel/refund/cleanup and blocked layout; old clients unchanged.');
}finally{await runtime.dispose();}
