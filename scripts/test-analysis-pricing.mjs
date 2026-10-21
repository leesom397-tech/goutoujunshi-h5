// Real SQLite credit triggers and production screenshot Durable Object logic.
// All media, identities and model responses are synthetic; no network calls.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import * as credits from '../lib/account-credits.mjs';
import {screenshotPrice,fullHistoryPrice,ANALYSIS_PRICE_VERSION} from '../lib/analysis-pricing.mjs';
import {requestOwner} from '../lib/request-identity.mjs';
import {LEGACY_MINIAPP_PRICE_ALIASES} from '../lib/miniapp-legacy-pricing.mjs';
import {saveAnalysisReport,readAnalysisReport,listAnalysisReports} from '../lib/saved-reports.mjs';
const require=createRequire(import.meta.url),sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
const db={prepare(query){
  return {
    args:[],
    bind(...args){this.args=args;return this},
    async first(){return sql.prepare(query).get(...this.args)||null},
    async all(){return {results:sql.prepare(query).all(...this.args)}},
    async run(){return {meta:{changes:Number(sql.prepare(query).run(...this.args).changes)}}},
  };
}};
const calls=[],states=new Map(),instances=new Map();
let denyModel=false,modelHook=null;
globalThis.__pricingApp={async fetch(request){
  const body=await request.json();calls.push(body);
  if(modelHook)await modelHook(body);
  if(denyModel)return Response.json({error:'Synthetic settings revoked'},{status:403});
  return Response.json({id:body.requestId,lines:[{id:'0',speaker:'other',text:'合成原话 '+body.image}],decision:{judgment:'合成已完成报告'},selfSide:body.selfSide});
}};
const bundled=await build({entryPoints:['lib/social-profile-jobs.mjs'],bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent',
  plugins:[{name:'synthetic-runtime',setup(build){
    build.onResolve({filter:/^(cloudflare:workers|\.\.\/dist\/server\/index\.js|\.\/request-identity\.mjs)$/},args=>({path:args.path,namespace:'mock'}));
    build.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='cloudflare:workers'
      ?'export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env}}'
      :args.path.includes('dist/server')?'export default globalThis.__pricingApp;'
      :'export const isWebApi=r=>new URL(r.url).pathname.startsWith("/api/web/");export const requestOwner=async r=>isWebApi(r)?(r.headers.get("x-test-owner")?{ownerId:r.headers.get("x-test-owner"),openId:null}:null):globalThis.__pricingNativeOwner(r);export const webSessionCookie=()=>"";',loader:'js'}));
  }}]});
const module={exports:{}};new Function('require','exports','module',bundled.outputFiles[0].text)(require,module.exports,module);
const {SocialProfileJobs,routeSocialProfileJob}=module.exports;
const env={DB:db,WECHAT_CALLBACK_TOKEN:'synthetic',SOCIAL_PROFILE_JOBS:{idFromName:owner=>owner,get(owner){
  if(!instances.has(owner)){
    const values=new Map();const storage={alarm:null,async get(key){return structuredClone(values.get(key))},async put(key,value){values.set(key,structuredClone(value))},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])values.delete(key)},async list({prefix=''}){return new Map([...values].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)]))},async setAlarm(value){this.alarm=value},async transaction(fn){return fn(storage)}};
    states.set(owner,storage);instances.set(owner,new SocialProfileJobs({storage},env));
  }return instances.get(owner);
}}};
env.MINIAPP_APPID='synthetic-app';env.MINIAPP_APPSECRET='synthetic-secret';
globalThis.__pricingNativeOwner=request=>requestOwner(request,env);
async function setup(owner){
  await credits.ensureCreditAccount(db,owner);await credits.adjustCredits(db,{id:crypto.randomUUID(),ownerId:owner,actorId:'fixture',delta:1000,reason:'测试账本'});
  await credits.setCreditPermissions(db,{id:crypto.randomUUID(),ownerId:owner,actorId:'fixture',features:['analysis'],enabledUntil:Date.now()+86400000,reason:'测试开通'});
  sql.prepare("INSERT INTO coach_crush_settings(owner_id,consent_at,image_consent_at,image_self_side,provider,updated_at) VALUES(?,1,1,'right','qwen',1)").run(owner);
}
const balance=owner=>sql.prepare('SELECT balance FROM coach_credit_accounts WHERE owner_id=?').get(owner).balance;
const ledger=(owner,id)=>sql.prepare('SELECT * FROM coach_credit_tasks WHERE owner_id=? AND request_id=?').get(owner,id);
async function send(owner,id,body,expected=200){
  const response=await routeSocialProfileJob(new Request('https://fixture.invalid/api/web/screenshot/batch?taskId='+id,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-test-owner':owner,'x-request-id':id},...(body?{body:JSON.stringify(body)}:{})}),env,{});
  const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;
}
async function upload(owner,images,{subjectId=null,side='right',price=screenshotPrice(images.length),taskId=crypto.randomUUID(),parentReportId,...coverage}={}){
  const init={...coverage,uploadAction:'init',confirmed:true,imageCount:images.length,selfSide:side,sessionId:crypto.randomUUID(),subjectId,priceConfirmation:price,...(parentReportId?{parentReportId}:{})};
  await send(owner,taskId,init,201);
  for(let index=0;index<images.length;index++)await send(owner,taskId,{uploadAction:'part',index,image:images[index]});
  await send(owner,taskId,{uploadAction:'commit'},202);
  return {id:taskId,init};
}
async function finish(owner,id){
  let result;
  for(let round=0;round<12;round++){await instances.get(owner).alarm();result=await send(owner,id);if(['done','error'].includes(result.status))return result;}
  assert.fail('synthetic task never finished');
}
await setup('alice');await setup('bob');
for(const [count,amount] of [[1,5],[2,10],[3,10],[4,15],[6,15],[7,20],[9,20]])assert.equal(screenshotPrice(count).amount,amount);
for(const total of [0,-1,20001,NaN])assert.throws(()=>fullHistoryPrice({expectedTotal:total}));
assert.equal(fullHistoryPrice({expectedTotal:20000,relatedSnapshots:[{expectedTotal:20000}]}).amount,100);
assert.throws(()=>fullHistoryPrice({expectedTotal:20000,relatedSnapshots:[{expectedTotal:20000},{expectedTotal:1}]}));
const invalidId=crypto.randomUUID(),parameters={uploadAction:'init',confirmed:true,imageCount:1,selfSide:'right',sessionId:crypto.randomUUID()};
for(const priceConfirmation of [undefined,{version:'old',amount:20},{version:ANALYSIS_PRICE_VERSION,amount:0}]){
  const rejected=await send('alice',invalidId,{...parameters,priceConfirmation},409);
  assert.equal(rejected.quote.amount,5);assert.equal(rejected.code,'PRICE_CONFIRMATION_REQUIRED');assert.equal(ledger('alice',invalidId),undefined);
}
const missingPerson=crypto.randomUUID();
await send('alice',missingPerson,{...parameters,subjectId:crypto.randomUUID(),priceConfirmation:screenshotPrice(1)},503);
assert.equal(ledger('alice',missingPerson).status,'released');assert.equal(balance('alice'),1000,'failed admission refunds before any upload task exists');
let spent=0;
for(const [count,amount] of [[1,5],[3,10],[6,15],[9,20]]){
  const images=Array.from({length:count},(_,index)=>'data:image/png;base64,'+Buffer.from(`synthetic tier ${count} image ${index}`).toString('base64'));
  const first=await upload('alice',images);assert.equal(ledger('alice',first.id).amount,amount);
  assert.equal((await finish('alice',first.id)).status,'done');spent+=amount;assert.equal(balance('alice'),1000-spent);
  const callsBefore=calls.length,second=await upload('alice',images);
  assert.equal((await finish('alice',second.id)).status,'done');assert.equal(calls.length,callsBefore,'exact uploaded materials reuse saved result despite a new session/request ID');
  assert.equal(ledger('alice',second.id).status,'released');assert.equal(balance('alice'),1000-spent,'duplicate result is free');
  await instances.get('alice').alarm();assert.equal(balance('alice'),1000-spent,'repeated alarm cannot double-refund');
  if(count===1){
    const other=await upload('bob',images);assert.equal((await finish('bob',other.id)).status,'done');
    assert.equal(balance('bob'),995);assert.equal(calls.length,callsBefore+1,'another owner cannot reuse private report or images');
    const flipped=await upload('alice',images,{side:'left'});assert.equal((await finish('alice',flipped.id)).status,'done');
    spent+=5;assert.equal(balance('alice'),1000-spent,'changed speaker identity is a different analysis');
    const subjectId=crypto.randomUUID();sql.prepare("INSERT INTO coach_subjects(id,owner_id,label,status,data,created_at,updated_at) VALUES(?,?,'合成人物','active','{}',1,1)").run(subjectId,'alice');
    const scoped=await upload('alice',images,{subjectId});assert.equal((await finish('alice',scoped.id)).status,'done');
    spent+=5;assert.equal(balance('alice'),1000-spent,'person scope cannot borrow another report');
  }
}
denyModel=true;
sql.prepare('UPDATE coach_crush_settings SET image_consent_at=NULL WHERE owner_id=?').run('alice');
const noConsent=await upload('alice',['data:image/png;base64,'+Buffer.from('synthetic tier 1 image 0').toString('base64')]),noConsentCalls=calls.length;
assert.equal((await finish('alice',noConsent.id)).status,'error');assert.equal(calls.length,noConsentCalls+1,'cached images still enter the ordinary permission rejection when settings are revoked');
assert.equal(ledger('alice',noConsent.id).status,'released');assert.equal(balance('alice'),1000-spent);
const failed=await upload('alice',['data:image/png;base64,ZmFpbHVyZQ==']);
assert.equal((await finish('alice',failed.id)).status,'error');assert.equal(ledger('alice',failed.id).status,'released');assert.equal(balance('alice'),1000-spent,'revoked settings still fails and refunds; hash reuse cannot generate new content');
await instances.get('alice').alarm();assert.equal(balance('alice'),1000-spent);
assert.equal((await send('bob',failed.id,undefined,404)).status,'expired');
assert.equal(sql.prepare('SELECT count(*) AS n FROM coach_credit_adjustments').get().n,2,'no balance reset or hidden grant');
// Real native Bearer verification and persisted published-client bodies.
await setup('native');
const nativeToken='a'.repeat(64),nativeOpenId='synthetic-openid';
sql.prepare('INSERT INTO coach_miniapp_links(open_id,owner_id,created_at,updated_at) VALUES(?,?,1,1)').run(nativeOpenId,'native');
sql.prepare('INSERT INTO coach_miniapp_sessions(token_hash,open_id,expires_at,created_at) VALUES(?,?,?,1)')
  .run(Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(nativeToken))).toString('hex'),nativeOpenId,Date.now()+60000);
async function nativeSend(path,id,body,expected=201,headers={}){
  const result=await routeSocialProfileJob(new Request('https://fixture.invalid'+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+nativeToken,'x-request-id':id,...headers},body:JSON.stringify(body)}),env,{});
  const value=await result.json();assert.equal(result.status,expected,JSON.stringify(value));return value;
}
const nativeInit={uploadAction:'init',confirmed:true,imageCount:1,selfSide:'right',sessionId:crypto.randomUUID()};
for(const path of ['/api/miniapp/screenshot/batch','/api/miniapp/social-profile']){
  const blocked=crypto.randomUUID();
  await nativeSend(path,blocked,nativeInit,401,{authorization:'',cookie:'fake','x-open-id':nativeOpenId,'x-owner-id':'native'});
  assert.equal(ledger('native',blocked),undefined);
  for(const priceConfirmation of [null,{version:'old',amount:20}]){
    await nativeSend(path,blocked,{...nativeInit,priceConfirmation},409);assert.equal(ledger('native',blocked),undefined);
  }
  await nativeSend(path,blocked,{...nativeInit,confirmed:false},400);
  for(const [count,amount] of [[1,5],[3,10],[6,15],[9,20]]){
    const id=crypto.randomUUID(),accepted=await nativeSend(path,id,{...nativeInit,imageCount:count});
    assert.equal(accepted.creditAmount,amount);assert.equal(ledger('native',id).amount,amount);
    const displayed=path.endsWith('social-profile')?30:LEGACY_MINIAPP_PRICE_ALIASES[count<=3?'analysisSmall':count<=6?'analysisMedium':'analysisLarge'];
    assert.ok(amount<=displayed,'published client charge never exceeds displayed authorization');
    await nativeSend(path,id,{uploadAction:'cancel'},200);assert.equal(ledger('native',id).status,'released');
  }
  const directId=crypto.randomUUID(),direct=await nativeSend(path,directId,{confirmed:true,images:['data:image/png;base64,b2xk'],selfSide:'right',sessionId:crypto.randomUUID()},202);
  assert.equal(direct.creditAmount,5);assert.equal((await finish('native',directId)).status,'error');
  assert.equal(ledger('native',directId).status,'released');
}
const forgedId=crypto.randomUUID();
await send('native',forgedId,{...nativeInit,legacyMiniapp:true,openId:nativeOpenId},409);
assert.equal(ledger('native',forgedId),undefined);assert.equal(balance('native'),1000);
// Supplement admission, cache scope and changes during processing use real SQL.
denyModel=false;
const subjectId=crypto.randomUUID(),otherSubject=crypto.randomUUID(),parentReportId=crypto.randomUUID(),nextParentId=crypto.randomUUID();
for(const id of [subjectId,otherSubject])sql.prepare("INSERT INTO coach_subjects(id,owner_id,label,status,data,created_at,updated_at) VALUES(?,?,'合成对象','active','{}',1,1)").run(id,'native');
const parentData={analysisScope:'fullHistory',captureKind:'chat',subjectId,generatedAt:'2026-10-21T00:00:00Z',semanticHistory:{summary:'过去讨论过安排',summaryEvidenceIds:['f1'],findings:[{id:'f1',claim:'过去讨论过安排',evidence:[{sourceId:'r1',quote:'之前讨论的原话',sourceKind:'chat'}]}]}};
await saveAnalysisReport(db,{ownerId:'native',id:parentReportId,subjectId,kind:'chat',result:parentData});
await saveAnalysisReport(db,{ownerId:'native',id:nextParentId,subjectId,kind:'chat',result:parentData});
const original=sql.prepare('SELECT result FROM coach_saved_reports WHERE id=?').get(parentReportId).result;
for(const invalid of [{subjectId:otherSubject,parentReportId},{subjectId,parentReportId:crypto.randomUUID()},{subjectId,parentReportId,target:'self'}]){
  const id=crypto.randomUUID();await send('native',id,{...nativeInit,...invalid,priceConfirmation:screenshotPrice(1)},invalid.target?400:409);assert.equal(ledger('native',id),undefined);
}
const foreign=crypto.randomUUID();await send('bob',foreign,{...nativeInit,subjectId,parentReportId,priceConfirmation:screenshotPrice(1)},409);assert.equal(ledger('bob',foreign),undefined);
const newImage=['data:image/png;base64,c3VwcGxlbWVudA=='],baseOptions={subjectId,parentReportId};
const supplemented=await upload('native',newImage,baseOptions),beforeModel=calls.length;
const supplementResult=await finish('native',supplemented.id);
assert.equal(supplementResult.status,'done');assert.equal(calls.length,beforeModel+1,'supplement reuses the usual screenshot call');
assert.equal(calls.at(-1).parentReportId,parentReportId);assert.equal(supplementResult.result.analysisScope,'supplement');assert.equal(supplementResult.result.entries[0].supplementOf.reportId,parentReportId);
const savedSupplement=await readAnalysisReport(db,'native',supplemented.id);assert.equal(savedSupplement.report.supplementOf.reportId,parentReportId);assert.match(savedSupplement.report.scopeNote,/不重新统计/);
const listed=(await listAnalysisReports(db,'native')).reports.find(row=>row.id===supplemented.id);assert.equal(listed.analysisScope,'supplement');assert.equal(listed.supplementOf.reportId,parentReportId);
assert.equal(sql.prepare('SELECT result FROM coach_saved_reports WHERE id=?').get(parentReportId).result,original,'old report is never rewritten');
const repeat=await upload('native',newImage,baseOptions),beforeRepeat=calls.length;await finish('native',repeat.id);assert.equal(calls.length,beforeRepeat);assert.equal(ledger('native',repeat.id).status,'released');
const changed=await upload('native',newImage,{subjectId,parentReportId:nextParentId});await finish('native',changed.id);assert.equal(calls.length,beforeRepeat+1,'different full report cannot borrow cached interpretation');
const pending=await upload('native',['data:image/png;base64,YmVmb3Jl'],baseOptions),beforeDeletion=calls.length;
sql.prepare("UPDATE coach_saved_reports SET status='deleted' WHERE id=?").run(parentReportId);
assert.equal((await finish('native',pending.id)).status,'error');assert.equal(calls.length,beforeDeletion);assert.equal(ledger('native',pending.id).status,'released');
sql.prepare("UPDATE coach_saved_reports SET status='done' WHERE id=?").run(parentReportId);
const midFlight=await upload('native',['data:image/png;base64,ZHVyaW5n'],baseOptions);
modelHook=()=>sql.prepare('UPDATE coach_saved_reports SET subject_id=? WHERE id=?').run(otherSubject,parentReportId);
assert.equal((await finish('native',midFlight.id)).status,'error');modelHook=null;assert.equal(ledger('native',midFlight.id).status,'released');assert.equal(await readAnalysisReport(db,'native',midFlight.id),null);
await setup('coverage');
const originalFetch=globalThis.__pricingApp.fetch;
let compositions=0;
globalThis.__pricingApp.fetch=async function(request){
 if(new URL(request.url).pathname.endsWith('/comprehensive')){
  compositions++;const body=await request.json();
  assert.equal(body.historyCoverage,'complete');
  assert.equal(request.headers.get('x-screenshot-job-key'),'synthetic');
  return Response.json({id:body.taskId,analysisScope:'uploadedHistory',materialCoverage:{history:'user-declared-complete'},scopeNote:'synthetic complete short history',semanticHistory:{summary:'combined'},decision:{judgment:'combined'}});
 }
 return originalFetch(request);
};
const completeImages=['data:image/png;base64,Y29tcGxldGU='];
const completeOptions={reportDepth:'auto',historyCoverage:'complete'};
const completeJob=await upload('coverage',completeImages,completeOptions);
const completeResult=await finish('coverage',completeJob.id);
assert.equal(completeResult.status,'done');assert.equal(compositions,1);
assert.equal(completeResult.result.aggregateReport.semanticHistory.summary,'combined');
assert.equal(balance('coverage'),995,'composition is covered by the original screenshot price');
const reusedComplete=await upload('coverage',completeImages,completeOptions);
const reusedResult=await finish('coverage',reusedComplete.id);
assert.equal(reusedResult.result.aggregateReport.semanticHistory.summary,'combined');
assert.equal(compositions,1);assert.equal(balance('coverage'),995,'reuse cannot charge again');
const partialJob=await upload('coverage',completeImages,{reportDepth:'auto',historyCoverage:'partial'});
const partialResult=await finish('coverage',partialJob.id);
assert.equal(partialResult.result.analysisScope,'screenshots','same bytes with different coverage cannot reuse complete-history classification');
assert.equal(compositions,1);
globalThis.__pricingApp.fetch=originalFetch;
delete globalThis.__pricingApp;delete globalThis.__pricingNativeOwner;sql.close();
console.log('PASS screenshot 5/10/15/20; stale quotes no task; actual SQLite debits/refunds; exact bytes + scope reuse across IDs; owner/person/speaker isolation; permission failure refunds; no balance reset; full range bounds.');
