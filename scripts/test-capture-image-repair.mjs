import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { newHistoryProgress, readHistoryProgress, runHistoryImport } from "../lib/capture-history-import.ts";
const modules=new Map();
function load(file){const name=resolve(file);if(modules.has(name))return modules.get(name);const exports={};modules.set(name,exports);
  new Function("exports","require",ts.transpileModule(readFileSync(name,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,path=>load(resolve(dirname(name),path)+".ts"));return exports;}
const {mergeCaptureRecords:merge}=load("lib/desktop-capture.ts");
const {captureImageTargets:targets,captureImageCoverage:coverage}=load("lib/capture-image-targets.ts");
const {sanitizeCloudCaptureRecord}=load("lib/capture-cloud.ts");
const storage=new Map();
Object.defineProperty(globalThis,"localStorage",{value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},configurable:true});
const ns={ownerId:"synthetic-image-owner",account:"synthetic-wx",friend:"synthetic-person",kind:"chat"};
const contact={accountKey:"a".repeat(64),contactId:"synthetic-contact"},scope=ns.ownerId+":images";
const png={mime:"image/png",name:"synthetic.png",data:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGkAAAAASUVORK5CYII="};
const originals=Array.from({length:41},(_,i)=>({id:`wechat-db:synthetic-image-${i}`,kind:"image",sender:"合成好友",senderRole:"other",at:`2026-10-20T00:${String(i).padStart(2,"0")}:00Z`,text:"[图片]",
  source:{label:"合成图片",method:"wechat-local-db",accountId:ns.account,sessionId:contact.contactId,messageShard:"message_0.db",messageId:String(1000+i),localId:String(i+1),mediaAvailability:"image-key-unavailable",previewUnavailable:"image-key-unavailable"}}));
const batch=records=>({version:1,kind:"chat",friend:ns.friend,account:ns.account,capturedAt:"2026-10-21T00:00:00Z",warnings:[],records});
let rows=merge([],batch(originals),ns).records,starts=[],jobs=new Map(),accepts=0;
const reset=()=>{storage.clear();rows=merge([],batch(originals),ns).records;starts=[];jobs=new Map();accepts=0;};
let hook;
async function request(path,options={}){
  if(path==="/capture"){
    const body=structuredClone(options.body);assert.equal(body.imageOnly,true);assert.equal(body.includeVoice,false);
    assert.equal(body.voiceOnly,undefined);assert.equal(body.voiceIds,undefined);assert.equal(body.since,undefined);assert.equal(body.cursor,undefined);
    assert.equal(body.contactId,contact.contactId);assert.equal(body.accountKey,contact.accountKey);assert.ok(body.imageIds.length<=16);
    const id=`images_${starts.length}`;starts.push(body);jobs.set(id,{body,reads:0});return{jobId:id};
  }
  const id=path.split("/")[2],job=jobs.get(id);assert.ok(job);job.reads++;
  const records=job.body.imageIds.map(ref=>{const row=originals.find(row=>row.source.messageId===ref.messageId);assert.ok(row);
    return{...row,source:{...row.source,mediaAvailability:"preview"},images:[png]};});
  const result={...batch(records),history:{version:1,direction:"backward",count:records.length,hasMore:false,nextCursor:null,snapshot:id,complete:true}};
  if(hook){const response=await hook(job,result);if(response)return response;}
  return{status:"done",result};
}
async function accept(value){const merged=merge(rows,value,ns);rows=merged.records;accepts++;return{...merged,libraryId:"synthetic-library"};}
const run=(progress=newHistoryProgress(scope,ns.friend),imageIds=targets(rows),extra={})=>{
  progress.account=ns.account;return runHistoryImport({progress,imageIds,contact,includeVoice:false,request,accept,pollMs:0,...extra});};

// An old missing-image placeholder is enriched in place and never loses evidence.
const before=structuredClone(rows[0]),repaired=merge(rows,batch([{...originals[0],images:[png],source:{...originals[0].source,mediaAvailability:"preview"}}]),ns);
assert.equal(repaired.added,0);assert.equal(repaired.updatedVoice,0);assert.equal(repaired.records[0].localId,before.localId);
assert.equal(repaired.records[0].text,before.text);assert.equal(repaired.records[0].at,before.at);assert.equal(repaired.records[0].images.length,1);
assert.equal(repaired.records[0].source.previewUnavailable,undefined);
assert.equal(sanitizeCloudCaptureRecord(repaired.records[0]).imageCount,1);
assert.equal(sanitizeCloudCaptureRecord(repaired.records[0]).source.mediaAvailability,"preview");
assert.deepEqual(merge(repaired.records,batch([originals[0]]),ns).records[0].images,[png],"a later failed preview cannot erase a saved image");
for(const patch of [{accountId:"other"},{sessionId:"another-person"},{messageShard:"another.db"},{messageId:"99999"}]){
  assert.throws(()=>merge(rows,batch([{...originals[0],images:[png],source:{...originals[0].source,...patch}}]),ns),/冲突/);
}
assert.deepEqual(coverage(repaired.records),{total:41,available:1,missing:40});
assert.equal(targets([...repaired.records,{...before,kind:"sticker"},{...before,source:{...before.source,method:"uia"}}]).length,40);

let result=await run();
assert.deepEqual(starts.map(value=>value.imageIds.length),[16,16,9]);assert.equal(result.added,0);assert.equal(result.updatedVoice,0);assert.equal(result.progress.count,41);
assert.equal(rows.length,41);assert.equal(targets(rows).length,0);assert.ok(rows.every(row=>row.images.length===1));

// Mid-batch disconnect restores exactly the saved image task and its original refs.
reset();let interrupted=false;
hook=(job,result)=>{
  if(job.body.imageIds[0].messageId==="1016"&&job.reads===1)return{status:"running",partial:result,partialRevision:1};
  if(job.body.imageIds[0].messageId==="1016"&&!interrupted){interrupted=true;throw Error("synthetic-image-disconnect");}
};
await assert.rejects(run(),/synthetic-image-disconnect/);
assert.equal(starts.length,2);assert.equal(targets(rows).length,9);
result=await run(readHistoryProgress(scope,ns.friend));
assert.equal(starts.length,3);assert.equal(starts[2].imageIds[0].messageId,"1032");assert.equal(result.progress.count,41);assert.equal(targets(rows).length,0);

// A final saved partial still closes its job even when no image refs remain.
reset();rows=rows.slice(0,1);interrupted=false;
hook=(job,result)=>{if(job.reads===1)return{status:"running",partial:result,partialRevision:1};if(!interrupted){interrupted=true;throw Error("final-disconnect");}};
await assert.rejects(run(),/final-disconnect/);assert.equal(targets(rows).length,0);
result=await run(readHistoryProgress(scope,ns.friend));assert.equal(result.progress.complete,true);assert.equal(starts.length,1);

// Failures are terminal for this pass, persisted as missing; no spin/retry loop.
reset();rows=rows.slice(0,1);
hook=(_job,result)=>{result.records[0]={...originals[0],source:{...originals[0].source,mediaAvailability:"missing-local",previewUnavailable:"missing-local"}};return{status:"done",result};};
await run();assert.equal(starts.length,1);assert.equal(rows[0].source.previewUnavailable,"missing-local");assert.equal(coverage(rows).missing,1);
assert.equal(sanitizeCloudCaptureRecord(rows[0]).source.previewUnavailable,"missing-local");
assert.equal(sanitizeCloudCaptureRecord(rows[0]).source.mediaAvailability,"missing-local");

for(const field of ["messageId","messageShard","localId","mediaKind","accountId","sessionId"]){
  reset();rows=rows.slice(0,1);
  hook=(_job,result)=>{result.records[0].source[field]=field==="mediaKind"?"voice":"outside-scope";return{status:"done",result};};
  await assert.rejects(run());assert.equal(accepts,0);assert.equal(rows[0].images,undefined);
}
hook=undefined;reset();
await assert.rejects(run(undefined,targets(rows),{voiceIds:targets(rows)}),/不能混入/);
await assert.rejects(run(undefined,targets(rows),{includeVoice:true}),/不能混入/);
assert.equal(starts.length,0);
console.log("PASS image repair: exact-ID in-place merge, existing media preserved, 16-row batches, independent resume/final-partial close, terminal missing media, scope/actor safeguards, no text scan/voice replay/network/billing.");
