import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './lib/capture-media-lane';export {readHistoryProgress} from './lib/capture-history-import';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const {runCaptureMediaLane,readCaptureMediaJob,readHistoryProgress}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const storage=new Map();Object.defineProperty(globalThis,'localStorage',{value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},configurable:true});
const contact={contactId:'fixture-contact',accountKey:'fixture-account-key'},owner='fixture-owner',friend='Fixture';
function makeHarness(){
 let library={id:'fixture-library',ownerId:owner,friend,account:'fixture-account',kind:'chat',records:[row('voice','1'),row('image','2')],reportLinks:[],warnings:[]};
 const calls=[],jobs=new Map();let starts=0,hook;
 function row(kind,id,done=false){return{id:'wechat-db:'+id,localId:'local-'+id,kind:kind==='voice'?done?'text':'other':'image',text:kind==='voice'?done?'synthetic transcript':'[语音]':'[图片]',senderRole:'other',sender:friend,at:'2026-10-24T00:00:00Z',...(kind==='image'&&done?{images:[{mime:'image/png',data:'AAAA',name:'fixture.png'}]}:{}),source:{method:'wechat-local-db',label:'fixture',accountId:'fixture-account',messageId:id,messageShard:'message_0.db',...(kind==='voice'?{mediaKind:'voice',transcriptionStatus:done?'visible-text':'not-transcribed'}:{})}};}
 function payload(body){const refs=body.voiceIds||body.imageIds;return{version:1,kind:'chat',friend,account:'fixture-account',capturedAt:'2026-10-24T00:00:00Z',warnings:[],records:refs.map(ref=>row(body.voiceOnly?'voice':'image',ref.messageId,true)),history:{version:1,direction:'backward',count:refs.length,hasMore:false,nextCursor:null,snapshot:'sample_'+(body.voiceOnly?'voice':'image'),complete:true}};}
 const options={get library(){return library;},contact,subjectId:'fixture-person',voiceSupported:true,imagesSupported:true,signal:new AbortController().signal,pollMs:0,
  request:async(path,options={})=>{calls.push({path,body:options.body});if(path==='/capture'){const jobId='media_'+(++starts);jobs.set(jobId,{body:options.body,reads:0});return{jobId};}const job=jobs.get(path.split('/')[2]);assert.ok(job,'only this lane jobs may be polled or cancelled');if(path.endsWith('/cancel'))return{status:'cancelled'};job.reads++;const custom=await hook?.(job);return custom||{status:'completed',result:payload(job.body)};},
  accept:async batch=>{let updatedVoice=0;library={...library,records:library.records.map(old=>{const next=batch.records.find(row=>row.id===old.id);if(!next)return old;if(next.source.mediaKind==='voice'&&old.kind!=='text')updatedVoice++;return next;})};return{added:0,updatedVoice,total:library.records.length,libraryId:library.id};},readLibrary:async()=>library,onUpdate:()=>{},
 };
 return {options,calls,jobs,setHook:value=>{hook=value;},get library(){return library;}};
}
let passed=0;
async function test(name,run){storage.clear();await run();passed++;console.log('ok '+passed+' - '+name);}
await test('voice and image jobs finish while independent Moments work is still running',async()=>{
 const h=makeHarness();let release,finished=false;const moments=new Promise(resolve=>{release=()=>{finished=true;resolve();};});
 const result=await runCaptureMediaLane(h.options);assert.equal(finished,false);assert.equal(result.records[0].kind,'text');assert.ok(result.records[1].images.length);
 assert.deepEqual(h.calls.filter(call=>call.path==='/capture').map(call=>[!!call.body.voiceOnly,!!call.body.imageOnly]),[[true,false],[false,true]]);
 assert.equal(readCaptureMediaJob(owner),null);assert.ok(h.calls.every(call=>call.path==='/capture'||/^\/jobs\/media_/.test(call.path)));release();await moments;
});
await test('transport loss resumes exact voice job and does not restart Moments or duplicate media',async()=>{
 const h=makeHarness();let failed=false;h.setHook(()=>{if(!failed){failed=true;throw Error('synthetic connection loss');}});
 await assert.rejects(runCaptureMediaLane(h.options),/connection loss/);assert.equal(readCaptureMediaJob(owner).jobId,'media_1');assert.equal(readHistoryProgress(owner+':voice',friend).pendingJob,'media_1');
 await runCaptureMediaLane({...h.options,library:h.library});assert.equal(h.calls.filter(call=>call.path==='/capture').length,2);assert.equal(readCaptureMediaJob(owner),null);
});
await test('cancelling media only cancels its own job and preserves media resume metadata',async()=>{
 const h=makeHarness(),controller=new AbortController();h.setHook(()=>{controller.abort();return{status:'running'};});
 await assert.rejects(runCaptureMediaLane({...h.options,signal:controller.signal}),error=>error.name==='AbortError');
 assert.deepEqual(h.calls.filter(call=>call.path.endsWith('/cancel')).map(call=>call.path),['/jobs/media_1/cancel']);
 assert.equal(readCaptureMediaJob(owner).phase,'voice');assert.equal(readCaptureMediaJob(owner).jobId,null);assert.equal(readHistoryProgress(owner+':voice',friend).pendingJob,null);
 h.setHook(undefined);await runCaptureMediaLane({...h.options,library:h.library});assert.equal(readCaptureMediaJob(owner),null);
});
await test('pending media cannot be attached to another person or account',async()=>{
 const h=makeHarness();h.setHook(()=>{throw Error('offline');});await assert.rejects(runCaptureMediaLane(h.options));const count=h.calls.length;
 await assert.rejects(runCaptureMediaLane({...h.options,subjectId:'other-person'}),/另一位好友/);
 await assert.rejects(runCaptureMediaLane({...h.options,contact:{...contact,accountKey:'other'}}),/另一位好友/);assert.equal(h.calls.length,count);
});
console.log('PASS media lane: '+passed+' cases; isolated jobs, controllers, source-bound checkpoints and safe resume; all synthetic.');
