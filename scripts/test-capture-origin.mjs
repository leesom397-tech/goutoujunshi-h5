// Synthetic material only; verifies the real task cleaner and durable report store.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import * as reports from '../lib/saved-reports.mjs';

const sql=new DatabaseSync(':memory:');
for(const file of ['0000_lying_leech.sql','0003_wealthy_stephen_strange.sql','0018_saved_analysis_reports.sql'])sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
const db={prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:sql.prepare(query).run(...values)};}};}};
const output=ts.transpileModule(readFileSync('lib/social-profile-jobs.mjs','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exported={};
const mocks={'cloudflare:workers':{DurableObject:class{constructor(ctx,env){this.ctx=ctx;this.env=env;}}},'../dist/server/index.js':{default:{}},'./account-credits.mjs':{},'./request-identity.mjs':{isWebApi:()=>true,webSessionCookie:()=>'',requestOwner:()=>null},'./saved-reports.mjs':reports};
new Function('require','exports',output)(name=>{if(!(name in mocks))throw Error('missing mock '+name);return mocks[name];},exported);
const {SocialProfileJobs}=exported;

for(const [kind,inputFlag] of [['chat',true],['moments',true],['social',true],['chat','true'],['moments',undefined]]){
  const stored=new Map(),storage={async get(key){return structuredClone(stored.get(key));},async put(key,value){stored.set(key,structuredClone(value));},async list({prefix}){return new Map([...stored].filter(([key])=>key.startsWith(prefix)));},async setAlarm(){},async transaction(fn){return fn(storage);}};
  const jobs=new SocialProfileJobs({storage},{DB:db});
  jobs.reserveJob=async()=>0;
  const owner='synthetic-capture-owner',taskId=crypto.randomUUID(),path=kind==='chat'?'screenshot/batch':'social-profile';
  const body={uploadAction:'init',ownerId:owner,confirmed:true,imageCount:1,selfSide:'right',sessionId:crypto.randomUUID(),materialType:kind==='moments'?'moments':'profile',captureOrigin:inputFlag,captureSource:{libraryId:'must-stay-local',sourceIds:['private-local-id']}};
  const url='https://coach.example.test/api/web/'+path+'?taskId='+taskId;
  const init=await jobs.fetch(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  assert.equal(init.status,201);
  const job=stored.get('job:'+taskId);
  assert.equal(job.captureOrigin,inputFlag===true);
  assert.equal(job.parameters.captureOrigin,inputFlag===true,'only literal boolean true is accepted');
  assert.equal(job.parameters.captureSource,undefined,'browser library IDs are not stored by task cleaner');
  const entryId=crypto.randomUUID(),entry={id:entryId,lines:[],decision:{judgment:'虚构结果'}};
  if(kind==='chat')sql.prepare("INSERT INTO coach_crush_reports(id,owner_id,thread_id,source_key,input_hash,revision,status,result,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,1,'done',?,?,?,?)").run(entryId,owner,'synthetic-thread',entryId,'synthetic-hash',JSON.stringify({...entry,affinity:{score:42}}),1,1,2);
  delete job.parameters; // Terminal credential/payload cleanup must not lose provenance.
  const saved=await jobs.persistReport(job,kind==='chat'?{entries:[entry]}:{summary:'虚构结果'});
  assert.equal(saved.captureOrigin,inputFlag===true?true:undefined);
  const reopened=await reports.readAnalysisReport(db,owner,taskId);
  assert.equal(reopened.report.captureOrigin,inputFlag===true?true:undefined);
  if(kind==='chat'){
    assert.equal(reopened.entries[0].affinity.score,42,'source report enrichment is still refreshed');
    assert.equal(reopened.entries[0].captureOrigin,inputFlag===true?true:undefined,'fresh source report cannot erase the batch provenance marker');
  }
  Object.assign(job,{status:'done',reportSaved:true});
  stored.set('job:'+taskId,job);
  const polled=await (await jobs.fetch(new Request(url))).json();
  assert.equal(polled.result.captureOrigin,inputFlag===true?true:undefined,'reopened job result exposes the marker');
  const content=JSON.stringify(sql.prepare('SELECT result FROM coach_saved_reports WHERE id=?').get(taskId));
  assert.ok(!content.includes('must-stay-local')&&!content.includes('private-local-id'));
}
sql.close();
console.log('PASS captureOrigin: strict task input, no local-source IDs, terminal cleanup, chat/moments/social persistence, enriched source refresh and polling');
