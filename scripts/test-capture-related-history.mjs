import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
const require=createRequire(import.meta.url),sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
const db={prepare(query){return{args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return{results:sql.prepare(query).all(...this.args)};},async run(){return{meta:{changes:Number(sql.prepare(query).run(...this.args).changes)}};}};},async batch(statements){return Promise.all(statements.map(statement=>statement.run()));}};
const overrides=new Map(),cache=new Map();function load(file){const path=resolve(file);if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require','fetch',code)(exports,name=>{if(overrides.has(name))return overrides.get(name);if(name==='@/db')return{getD1:()=>db};if(name.startsWith('@/')||name.startsWith('.')){let next=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(path),name);if(!/\.(?:ts|mjs)$/.test(next))next+='.ts';return load(next);}return require(name);},()=>assert.fail('No external requests'));return exports;}
const {captureAnalysisInput}=load('lib/capture-analysis-input.ts'),{checkRelatedCaptureSnapshots,readRelatedCaptureEvidence,verifySupplementalEvidence,supplementalEvidenceKey}=load('lib/capture-related-history-server.ts'),{analyzeCaptureSemanticHistory}=load('lib/capture-semantic-history.ts');
const owner='synthetic',subject=crypto.randomUUID(),chatId='cl_'+'a'.repeat(64),momentsId='cl_'+'b'.repeat(64);
for(const [id,kind]of[[chatId,'chat'],[momentsId,'moments']])sql.prepare("INSERT INTO coach_capture_libraries(id,owner_id,account,friend,kind,subject_id,created_at,updated_at) VALUES(?,?,'wx-account','same display name',?,?,?,?)").run(id,owner,kind,subject,'2026-01-01','2026-01-01');
const make=(i,kind='post')=>({localId:'item-'+i,kind,senderRole:'other',sender:'合成人物',at:'2026-01-02',text:kind==='post'?'动态原文第'+i+'条：今天散步看展':'[图片]',imageCount:i<6?1:0,source:{label:'synthetic',method:'test'}});
const moments=Array.from({length:30},(_,i)=>make(i)),chats=Array.from({length:6},(_,i)=>make(i,'image'));
moments[29].imageCount=1;
moments[0].imageCount=9;moments[0].source.imageType='visible-ui-preview';
moments[29].imageCount=0;moments[29].source.imageType='visible-ui-preview';moments[29].source.previewUnavailable='capture-unavailable';
const cloudRecord=load('lib/capture-cloud.ts').validateCloudCaptureRecord({...moments[29],firstCapturedAt:'2026-01-01T00:00:00Z',lastCapturedAt:'2026-01-01T00:00:00Z'});assert.equal(cloudRecord.source.imageType,'visible-ui-preview');assert.equal(cloudRecord.source.previewUnavailable,'capture-unavailable');
for(const [library,rows]of[[chatId,chats],[momentsId,moments]])for(const row of rows)sql.prepare("INSERT INTO coach_capture_records(library_id,owner_id,epoch,local_id,digest,record_json,sort_known,sort_time,updated_at) VALUES(?,?,1,?,?,?,0,1,1)").run(library,owner,row.localId,row.localId,JSON.stringify(row));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF4cAAAAASUVORK5CYII=','base64');
for(const [library,rows]of[[chatId,chats],[momentsId,moments.slice(0,6)]])for(const [i,row]of rows.entries()){
 const bytes=Buffer.concat([png,Buffer.from(library+i)]),sha=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),id='cm_'+sha;
 sql.prepare("INSERT INTO coach_capture_media(id,owner_id,library_id,epoch,local_id,image_index,mime,name,sha256,bytes,chunk_count,status,created_at) VALUES(?,?,?,1,?,0,'image/png','synthetic',?,?,1,'ready',1)").run(id,owner,library,row.localId,sha,bytes.length);
 sql.prepare('INSERT INTO coach_capture_media_chunks VALUES(?,0,?)').run(id,bytes.toString('base64'));
}
const input=captureAnalysisInput({requestId:crypto.randomUUID(),confirmed:true,kind:'chat',analysisScope:'fullHistory',friend:'same display name',subjectId:subject,libraryId:chatId,expectedEpoch:1,expectedTotal:6,records:[],relatedSnapshots:[{libraryId:momentsId,kind:'moments',expectedEpoch:1,expectedTotal:30}]});
assert.equal((await checkRelatedCaptureSnapshots(db,owner,input))[0].total,30);
await assert.rejects(checkRelatedCaptureSnapshots(db,'different-owner',input),/同一个人物/);
await assert.rejects(checkRelatedCaptureSnapshots(db,owner,{...input,subjectId:crypto.randomUUID()}),/同一个人物/);
sql.prepare("UPDATE coach_capture_libraries SET account='wrong-account' WHERE id=?").run(momentsId);await assert.rejects(checkRelatedCaptureSnapshots(db,owner,input),/账号或人物/);sql.prepare("UPDATE coach_capture_libraries SET account='wx-account' WHERE id=?").run(momentsId);
await assert.rejects(checkRelatedCaptureSnapshots(db,owner,{...input,relatedSnapshots:[{...input.relatedSnapshots[0],expectedTotal:31}]}),/未完整同步/);
let calls=0,failedOnce=true;
const vision=async(messages,options)=>{assert.equal(options.vision,true);calls++;const metadata=JSON.parse(messages[1].content[0].text);if(metadata.sourceKind==='chat'&&metadata.sourceId==='item-4'&&failedOnce){failedOnce=false;throw Error('synthetic timeout');}return JSON.stringify({readable:metadata.sourceId!=='item-5',observation:metadata.sourceId==='item-5'?'':'画面可见海边、步行道与展览海报。'});};
const first=await readRelatedCaptureEvidence(db,owner,input,{records:chats,revision:0},vision);
assert.equal(calls,12,'all twelve synchronized previews are submitted, no four-image slice');assert.equal(first.sourceCoverage.find(row=>row.kind==='moments').total,30);assert.equal(first.sourceCoverage.find(row=>row.kind==='moments').imagesMissing,1);assert.equal(first.sourceCoverage[0].imagesFailed,1);assert.equal(first.sourceCoverage[0].imagesUnreadable,1);assert.equal(first.supplementalRecords.filter(row=>row.basis==='caption').length,30,'all moments captions, not twelve selected posts');
assert.equal(first.sourceCoverage.find(row=>row.kind==='moments').imagesExpected,7,'nine-photo grid in one frame counts as one expected preview; failed frame remains one missing preview');
const second=await readRelatedCaptureEvidence(db,owner,input,{records:chats,revision:0},vision);assert.equal(calls,13,'a retry only inspects the failed image; successful and unreadable results reuse exact-media cache');assert.equal(second.sourceCoverage[0].imagesFailed,0);assert.equal(second.mediaEvidence.length,10);assert.ok(second.sourceCoverage.every(row=>row.imageScope==='synced-preview'&&row.status==='partial'));
const seen=[],primary=[{localId:'chat-original',kind:'text',senderRole:'self',at:'2026-01-01',text:'我喜欢先约好见面时间'}];
function synthesisFor(findings){
 const evidenceIds=[findings[0].id],moment=findings.find(finding=>finding.evidence.some(source=>source.sourceKind==='moments'));
 return {summary:'已综合聊天和动态里的实际材料。',explanation:'原文包含日常安排与活动表达。这些记录能帮助了解表达偏好，但不能单凭公开动态判断对方对用户的关系意愿，需要结合实际回应继续确认。',summaryEvidenceIds:evidenceIds,affinityAssessment:{dimensions:[],unavailableReason:'这些合成资料没有足够的互动依据评价接近意愿。'},action:'询问下一次交流的具体安排',actionEvidenceIds:evidenceIds,observeWindow:'下一次交流时',stopCondition:'明确拒绝就停止推进',actionPlan:{goal:'connection',rationale:'把日常表达放回实际交流中核对。',steps:[{title:'确认安排',action:'询问下一次交流的具体安排',why:'目前材料只显示日常活动与安排，需要确认对方是否愿意继续交流。',evidenceIds,observeFor:'下一次交流时',advanceWhen:'双方明确愿意再谈具体安排',stopWhen:'对方明确拒绝继续交流'}]},...(moment?{sourceInsights:{moments:{summary:'动态呈现散步与看展等活动，图片也有可见活动线索；这些是公开表达，不能直接当作对用户的好感。',evidenceIds:[moment.id],unknowns:['这些表达与实际相处是否一致仍待核实。']}}}:{})};
}
const semantic=await analyzeCaptureSemanticHistory({historyRecords:primary,totalImported:7,selectedLineCount:0,fullHistory:true,supplementalRecords:second.supplementalRecords},async messages=>{const input=JSON.parse(messages[1].content);if(input.rows){seen.push(...input.rows);return JSON.stringify({findings:input.rows.filter(row=>row.basis==='caption'||row.basis==='visual').slice(-8).map(row=>({claim:row.basis==='visual'?'图片有可见活动线索':'动态记录了活动',confidence:'低',alternative:'呈现不等于关系意图',evidence:[{sourceId:row.sourceId,quote:row.text.slice(0,30)}]}))});}assert.ok(input.findings.some(finding=>finding.evidence.some(source=>source.basis==='visual'&&source.mediaId&&source.libraryId)));return JSON.stringify({...synthesisFor(input.findings),trend:'升温'});});
assert.equal(semantic.status,'complete');assert.ok(semantic.sourceInsights.moments.summary);assert.ok(semantic.actionPlan.steps.length);assert.equal(seen.length,primary.length+second.supplementalRecords.length);assert.equal(semantic.coverage.analyzedText,1,'photo observations do not inflate the chat text count');assert.equal(semantic.coverage.sources[momentsId].captions,30);assert.equal(semantic.trend,'待了解','posting or photo dates alone cannot prove relationship warming');assert.ok(semantic.findings.flatMap(row=>row.evidence).every(source=>source.sourceId.startsWith('item-')),'citations return raw local IDs, namespace stays in libraryId');

// Real HTTP route, credit reservation/replay and report persistence use the same
// production code. Only the provider and optional personalization are stubbed.
sql.prepare("INSERT INTO coach_subjects(id,owner_id,label,status,data,created_at,updated_at) VALUES(?,?,'合成人物','active','{}',1,1)").run(subject,owner);
const textRow={...primary[0],sender:'我',source:{label:'synthetic'},imageCount:0};sql.prepare("INSERT INTO coach_capture_records(library_id,owner_id,epoch,local_id,digest,record_json,sort_known,sort_time,updated_at) VALUES(?,?,1,?,?,?,0,1,1)").run(chatId,owner,textRow.localId,textRow.localId,JSON.stringify(textRow));
const credits=load('lib/account-credits.mjs');await credits.ensureCreditAccount(db,owner);await credits.adjustCredits(db,{id:crypto.randomUUID(),ownerId:owner,actorId:'fixture',delta:100,reason:'合成测试'});await credits.setCreditPermissions(db,{id:crypto.randomUUID(),ownerId:owner,actorId:'fixture',features:['analysis'],enabledUntil:Date.now()+86400000,reason:'合成测试'});
let routeCalls=0;
const durableEnv={DB:db,WECHAT_CALLBACK_TOKEN:'synthetic-internal-capture-token'},durableInstances=new Map();
overrides.set('cloudflare:workers',{env:durableEnv,DurableObject:class{constructor(ctx,env){this.ctx=ctx;this.env=env;}}});
overrides.set('../dist/server/index.js',{default:{fetch:request=>route.POST(request)}});
const {CaptureHistoryJobs}=load('lib/capture-history-jobs.mjs');
durableEnv.CAPTURE_HISTORY_JOBS={idFromName:value=>value,get(value){
 if(!durableInstances.has(value)){
  const values=new Map();let alarm=null;
  const storage={async get(key){return structuredClone(values.get(key));},async put(key,value){values.set(key,structuredClone(value));},async list({prefix=''}){return new Map([...values].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)]));},async delete(key){values.delete(key);},async getAlarm(){return alarm;},async setAlarm(value){alarm=value;},async transaction(run){return run(storage);}};
  durableInstances.set(value,new CaptureHistoryJobs({storage},durableEnv));
 }
 return durableInstances.get(value);
}};
overrides.set('@/lib/miniapp-auth',{miniappOwner:async()=>({ownerId:owner})});overrides.set('@/lib/crush/service',{requireSettings:async()=>({}),reserveBudget:async()=>{},analyzeLines:()=>assert.fail('full history must not run recent-line analysis')});overrides.set('@/lib/crush/screenshot',{});overrides.set('@/lib/profile-context',{loadProfileContext:async()=>''});overrides.set('@/lib/personal-context-server',{personalizeReport:async()=>({commonPoints:[],summary:'',differences:[]})});overrides.set('@/lib/conversation-profile-memory-server',{});overrides.set('@/lib/self-archive-memory',{updateSelfArchiveMemory:async()=> 'disabled'});overrides.set('@/lib/knowledge',{selectKnowledge:()=>[]});overrides.set('@/lib/knowledge-public',{publicKnowledgeSources:()=>[]});
overrides.set('@/lib/qwen',{parseQwenJson:JSON.parse,qwenPublicError:(_error,message)=>message,qwenChat:async(messages,options)=>{routeCalls++;if(options.vision)return vision(messages,options);const body=JSON.parse(messages[1].content);if(body.rows)return JSON.stringify({findings:body.rows.filter(row=>row.basis==='chat-original'||row.basis==='caption'||row.basis==='visual').slice(-8).map(row=>({claim:'从这份资料看到活动线索'+row.sourceId,confidence:'低',alternative:'不能代替相处意图',evidence:[{sourceId:row.sourceId,quote:row.text.slice(0,25)}]}))});return JSON.stringify(synthesisFor(body.findings));}});
const route=load('app/api/web/capture/analyze/route.ts'),body={requestId:crypto.randomUUID(),confirmed:true,kind:'chat',analysisScope:'fullHistory',friend:input.friend,subjectId:subject,libraryId:chatId,expectedEpoch:1,expectedTotal:7,relatedSnapshots:input.relatedSnapshots,records:[]},request=()=>new Request('https://fixture.invalid/api/web/capture/analyze',{method:'POST',headers:{'content-type':'application/json',origin:'https://fixture.invalid'},body:JSON.stringify(body)});
async function completeDurable(request){
 const before=routeCalls,response=await route.POST(request),task=await response.clone().json();
 assert.equal(routeCalls,before,'external admission and replay never call the provider');
 if(response.status===200&&task.status==='done')return Response.json(task.result);
 assert.equal(response.status,202,JSON.stringify(task));
 const jobs=durableEnv.CAPTURE_HISTORY_JOBS.get(owner);
 for(let round=0;round<20;round++){
  const callsBefore=routeCalls;await jobs.alarm();assert.ok(routeCalls-callsBefore<=2,'each alarm is bounded to two model calls');
  const status=await jobs.status(owner,task.taskId);
  assert.notEqual(status.status,'error',status.error);
  if(status.status==='done')return Response.json(status.result);
 }
 assert.fail('Durable synthetic task failed to finish');
}
const response=await completeDurable(request());assert.equal(response.status,200,await response.clone().text());const report=await response.json();assert.equal(report.sourceCoverage.find(source=>source.kind==='moments').textRead,30);assert.equal(report.relatedSnapshots[0].total,30);assert.equal(report.mediaEvidence.length,10);assert.equal(report.semanticHistory.coverage.analyzedText,1);assert.equal(report.relationshipContext.coverage.archiveMessages,7);assert.equal(report.lines.length,0);assert.equal((await credits.readCreditAccount(db,owner)).balance,100-credits.CREDIT_PRICES.analysisSmall,'joint sources use the existing one analysis price');const completedCalls=routeCalls;assert.deepEqual(await(await completeDurable(request())).json(),report);assert.equal(routeCalls,completedCalls,'replay returns the same paid receipt without another model call');assert.ok(sql.prepare("SELECT result FROM coach_saved_reports WHERE id=? AND owner_id=? AND status='done'").get(body.requestId,owner));
// The earliest risk is intentionally omitted by the synthetic chunk model's
// last-eight findings. Full-archive deterministic review must still retain it.
const riskLibrary='cl_'+'c'.repeat(64);
sql.prepare("INSERT INTO coach_capture_libraries(id,owner_id,account,friend,kind,subject_id,created_at,updated_at) VALUES(?,?,'wx-account','risk fixture','chat',?,'2026-01-01','2026-01-01')").run(riskLibrary,owner,subject);
for(let i=0;i<675;i++){
 const record={localId:'risk-'+i,kind:'text',senderRole:i%2?'self':'other',sender:i%2?'我':'对方',at:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),text:i===0?'把验证码发给我。':i===1?'我不会提供验证码。':'今天聊了日常安排。',imageCount:0,source:{label:'synthetic'}};
 sql.prepare("INSERT INTO coach_capture_records(library_id,owner_id,epoch,local_id,digest,record_json,sort_known,sort_time,updated_at) VALUES(?,?,1,?,?,?,1,?,1)").run(riskLibrary,owner,record.localId,record.localId,JSON.stringify(record),Date.parse(record.at));
}
const riskBody={...body,requestId:crypto.randomUUID(),friend:'risk fixture',libraryId:riskLibrary,expectedTotal:675,relatedSnapshots:[],question:'risk'};
const callsBeforeRisk=routeCalls;
const riskResponse=await completeDurable(new Request('https://fixture.invalid/api/web/capture/analyze',{method:'POST',headers:{'content-type':'application/json',origin:'https://fixture.invalid'},body:JSON.stringify(riskBody)}));assert.equal(riskResponse.status,200,await riskResponse.clone().text());
const riskReport=await riskResponse.json();assert.equal(riskReport.relationshipDiagnosis.question,'risk');assert.equal(riskReport.riskReview.coverage.readable,675);assert.equal(riskReport.riskReview.signals[0].sources[0].sourceId,'risk-0');assert.equal(riskReport.riskReview.signals[0].sources[0].response.sourceId,'risk-1');assert.equal(riskReport.lines.length,0);assert.equal(riskReport.riskReview.signals[0].occurrences,1);
assert.equal(routeCalls-callsBeforeRisk,4,'risk review adds zero provider calls: three existing text chunks and one synthesis');
const savedRisk=JSON.parse(sql.prepare("SELECT result FROM coach_saved_reports WHERE id=?").get(riskBody.requestId).result);assert.deepEqual(savedRisk.riskReview,riskReport.riskReview);
assert.ok(riskReport.sourceIds.includes('risk-0'),'early risk is returned for client-side source association');assert.equal(savedRisk.riskReview.signals[0].sources[0].libraryId,riskLibrary,'saved risk can load the exact source library even before source association finishes');
const evidence=semantic.findings.flatMap(row=>row.evidence),verified=await verifySupplementalEvidence(db,owner,subject,evidence);assert.equal(verified.size,evidence.length);assert.equal((await verifySupplementalEvidence(db,owner,crypto.randomUUID(),evidence)).size,0);
const visual=evidence.find(source=>source.basis==='visual');sql.prepare('DELETE FROM coach_capture_media WHERE id=?').run(visual.mediaId);assert.ok(!(await verifySupplementalEvidence(db,owner,subject,evidence)).has(supplementalEvidenceKey(visual)),'deleted media cannot remain a question/profile fact');
const caption=second.supplementalRecords.find(row=>row.basis==='caption'),captionEvidence={sourceId:caption.sourceLocalId,libraryId:caption.libraryId,sourceKind:'moments',basis:'caption',quote:caption.text,senderRole:'other',at:'2020-01-01'};assert.equal((await verifySupplementalEvidence(db,owner,subject,[captionEvidence])).get(supplementalEvidenceKey(captionEvidence)).at,'2026-01-02','source date is restored from current original');
sql.prepare('UPDATE coach_capture_libraries SET subject_id=? WHERE id=?').run(crypto.randomUUID(),momentsId);assert.equal((await verifySupplementalEvidence(db,owner,subject,evidence)).size,0,'reassigned library is not reused for the prior person');
console.log('PASS: full joint snapshots, 30 captions + 12 previews (no 12/4 truncation), metadata/hash checks, missing/unreadable/failure coverage, cached retry, all supplemental evidence enters synthesis, source kind/role/date retained, ownership/person/account isolation and deleted/reassigned media exclusion. Synthetic models only.');
