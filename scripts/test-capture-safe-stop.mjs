import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync('app/capture/page.tsx','utf8');
const file=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let declaration, retryDeclaration, repairDeclaration;
function visit(node){if(ts.isFunctionDeclaration(node)){if(node.name?.text==='cancel')declaration=node.getText(file);if(node.name?.text==='retryMoments')retryDeclaration=node.getText(file);if(node.name?.text==='repairChatImages')repairDeclaration=node.getText(file);}ts.forEachChild(node,visit);}
visit(file);assert.ok(declaration);assert.ok(retryDeclaration);assert.ok(repairDeclaration);
for(const pending of [true,false]){
  const events=[];
  const env={personStopped:{current:false},mediaAbort:{current:null},invalidateCaptureUploads:()=>{},setRelatedLoading:()=>{},setRelatedError:()=>{},historyRunning:false,
    jobId:'moments-1',owner:'owner',generation:{current:1},scopeKey:value=>value,abort:{current:{abort:()=>events.push('abort')}},token:{current:'fixture'},
    bridgeRequest:async()=>pending?{status:'running',cancelRequested:true,message:'正在安全停止…'}:{status:'cancelled'},
    accept:async()=>{},remember:()=>events.push('forget'),stored:()=>null,
    setBusy:value=>events.push(['busy',value]),setJobPhase:value=>events.push(['phase',value]),setJobMessage:value=>events.push(['message',value]),
    setJobId:value=>events.push(['job',value]),setNote:()=>{},setError:error=>{throw Error(error)},message:error=>error.message};
  const cancel=new Function(...Object.keys(env),ts.transpileModule(declaration,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return cancel')(...Object.values(env));
  await cancel();
  assert.equal(env.personStopped.current,true);
  assert.equal(events.includes('abort'),!pending,'queued stop must retain progress polling');
  assert.equal(events.includes('forget'),!pending,'queued stop must retain resumable job');
  assert.equal(events.some(event=>Array.isArray(event)&&event[0]==='job'),!pending);
  assert.ok(events.some(event=>Array.isArray(event)&&event[0]==='phase'&&event[1]===(pending?'running':'failed')));
}
console.log('PASS production cancel: queued stop keeps polling and job; terminal stop clears both.');

for(const scenario of ['release','timeout','superseded']){
  const events=[], previous={jobId:'moments-old',kind:'moments'};
  let clock=0, active=true, saved=previous, waits=0;
  const captureActive={get current(){return active},set current(_){assert.fail('retry must not overwrite the old capture owner');}};
  const generation={current:1};
  const env={owner:'owner',analyzing:false,cloudBusy:false,retryingMoments:{current:false},captureActive,generation,
    stored:()=>saved,scopeKey:value=>value,invalidateCaptureUploads:()=>{},abort:{current:{abort:()=>events.push('abort')}},
    token:{current:'fixture'},Date:{now:()=>clock},
    setTimeout:(resolve,delay)=>{waits++;clock+=delay;events.push(['wait',delay]);
      if(scenario==='release'&&waits===2){active=false;events.push('old capture settled');}
      if(scenario==='superseded')generation.current++;
      queueMicrotask(resolve);},
    bridgeRequest:async path=>{events.push(path);return path==='/health'?{ready:true}:{status:'cancelled'}},
    accept:async()=>{},remember:(_key,value)=>{saved=value;events.push(value?'retained':'forgot');},
    setBusy:value=>events.push(['busy',value]),setError:value=>events.push(['error',value]),setJobMessage:()=>{},
    setJobId:value=>events.push(['job',value]),setJobPhase:value=>events.push(['phase',value]),setHealth:()=>{},
    setShowImportControls:()=>{},message:error=>error.message,BridgeError:class extends Error{},
    capture:async()=>{assert.equal(active,false,'new capture must wait for old local save');events.push('capture');}};
  const retry=new Function(...Object.keys(env),ts.transpileModule(retryDeclaration,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return retryMoments')(...Object.values(env));
  await retry();
  assert.equal(env.retryingMoments.current,false);
  if(scenario==='release'){
    assert.ok(events.indexOf('old capture settled')<events.indexOf('forgot'));
    assert.ok(events.indexOf('forgot')<events.indexOf('capture'));
    assert.equal(events.filter(event=>event==='capture').length,1);
  }else{
    assert.equal(events.includes('capture'),false);
    assert.equal(events.includes('forgot'),false,'retain the old job until handoff completes');
    assert.equal(saved,previous);
    if(scenario==='timeout'){
      assert.equal(clock,30000,'handoff wait must be bounded');
      assert.ok(events.some(event=>Array.isArray(event)&&event[0]==='phase'&&event[1]==='failed'));
      assert.ok(events.some(event=>Array.isArray(event)&&event[0]==='job'&&event[1]===previous.jobId));
      assert.ok(events.some(event=>Array.isArray(event)&&event[0]==='error'&&event[1].includes('重新连接并重试')));
    }else assert.equal(events.some(event=>Array.isArray(event)&&event[0]==='phase'),false,'superseded retry must not mutate the new page state');
  }
}
console.log('PASS production retry: waits for local save, preserves job on 30s timeout, ignores superseded handoff.');

for(const scenario of ['repair','reconnect','superseded','unfinished-media']){
  const events=[],sourceContact={contactId:'original-contact',accountKey:'original-account'};
  const library={id:'saved-chat',kind:'chat',records:Array.from({length:9},(_,index)=>({kind:'image',source:{messageId:String(index)}}))};
  const complete={...library,records:library.records.map(row=>({...row,images:[{name:'synthetic.png'}]}))};
  let release;
  const imageDone=new Promise(resolve=>{release=resolve;});
  const env={owner:'owner',library,locked:false,receipt:null,connected:scenario!=='reconnect',captureActive:{current:false},personStopped:{current:true},generation:{current:1},
    captureImageTargets:rows=>rows.filter(row=>!row.images),readCaptureMediaJob:()=>scenario==='unfinished-media'?{jobId:'existing-media'}:null,
    invalidateCaptureUploads:()=>events.push('invalidate-upload'),setBusy:value=>events.push(['busy',value]),setError:value=>events.push(['error',value]),setConsent:()=>{},setNote:()=>{},
    resumeExistingConnection:async()=>{events.push('reconnect');return true;},
    contactFromCaptureLibrary:async target=>{assert.equal(target,library);if(scenario==='superseded')env.generation.current++;return sourceContact;},
    bridgeRequest:async path=>{assert.equal(path,'/health');events.push('health');return{capabilities:{backgroundImagesById:true}};},setHealth:()=>{},
    enrichImportedImages:async(target,contact)=>{assert.equal(target,library);assert.equal(contact,sourceContact);events.push('images-only');await imageDone;return complete;},
    prepareImportedReport:async target=>{assert.equal(target,complete);events.push('fee-confirmation');},relatedMoments:[],subject:'person',
    capture:()=>assert.fail('repair must not import chat again'),enrichImportedVoices:()=>assert.fail('repair must not transcribe voice'),analyze:()=>assert.fail('repair must not generate or charge analysis'),
    message:error=>error.message,setHistoryRunning:()=>{},setImportStage:()=>{}};
  const repair=new Function(...Object.keys(env),ts.transpileModule(repairDeclaration,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return repairChatImages')(...Object.values(env));
  const running=repair();await new Promise(resolve=>setImmediate(resolve));
  if(['repair','reconnect'].includes(scenario)){
    assert.equal(events.filter(event=>event==='images-only').length,1);
    assert.equal(events.includes('fee-confirmation'),false);
    await repair();assert.equal(events.filter(event=>event==='images-only').length,1,'double click cannot create two image jobs');
    release();await running;
    assert.equal(events.filter(event=>event==='fee-confirmation').length,1);
    assert.equal(events.includes('reconnect'),scenario==='reconnect');
    assert.equal(env.captureActive.current,false);
  }else{
    await running;assert.equal(events.includes('images-only'),false);assert.equal(events.includes('fee-confirmation'),false);
    if(scenario==='unfinished-media')assert.ok(events.some(event=>Array.isArray(event)&&event[0]==='error'&&event[1].includes('继续补齐')));
  }
}
console.log('PASS production image repair: exact original contact, images only, safe reconnect/double-click, returns to fee confirmation without paid analysis.');
