'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {publicSetup,older,experimentalSetupEnabled,createSetupFlow}=require('../setup.cjs');
const state=(fields={})=>publicSetup({jobId:'fixture-job',attempt:1,revision:1,phase:'waiting-for-user',active:true,can_continue:true,...fields});
function fixture({platform='darwin',available=true,consent=true,current=null}={}){
  const requests=[],panels=[],timers=[];let confirmations=0;
  const collector={setup:current,async request(command,payload){requests.push({command,payload});if(command==='status')return {setupAvailable:available};if(command==='setup')this.setup=state();return {ok:true,setup:this.setup};}};
  const flow=createSetupFlow({collector,platform,confirm:async()=>{confirmations++;return typeof consent==='function'?consent():consent;},openPanel:value=>panels.push(value),schedule:fn=>{timers.push(fn);return timers.length;},cancelSchedule:()=>{}});
  return {collector,requests,panels,timers,flow,get confirmations(){return confirmations;}};
}
test('public setup is fixed content, ordered by attempt then revision, and never promotes active cleanup to ready',()=>{
  const result=state({message:'PRIVATE path/key',account:'PRIVATE',ready:true,realDeviceValidated:true,error_code:'PRIVATE'});
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(result.ready,false);assert.equal(result.realDeviceValidated,false);
  assert.equal(publicSetup({phase:'PRIVATE'}),null);assert.equal(publicSetup({phase:'idle',attempt:true}),null);
  assert.equal(older(state({attempt:2,revision:1}),state({attempt:1,revision:100})),false);
  assert.equal(older(state({attempt:1,revision:100}),state({attempt:2,revision:1})),true);
  assert.equal(state({phase:'ready',active:false,can_continue:false,ready:true}).ready,true);
  assert.equal(state({phase:'ready',active:false,ready:true,cleanupPending:true}).ready,false);
});
test('packaged experimental enable requires a fixed true boolean and Mac; inherited env cannot enable production',()=>{
  const base={platform:'darwin',isPackaged:true,environment:{CHENGZI_MAC_EXPERIMENTAL_SETUP:'1'}};
  assert.equal(experimentalSetupEnabled(base),false);
  assert.equal(experimentalSetupEnabled({...base,packageMetadata:{chengziExperimentalMacSetup:'true'}}),false);
  assert.equal(experimentalSetupEnabled({...base,packageMetadata:{chengziExperimentalMacSetup:true}}),true);
  assert.equal(experimentalSetupEnabled({...base,platform:'win32',packageMetadata:{chengziExperimentalMacSetup:true}}),false);
  assert.equal(experimentalSetupEnabled({...base,isPackaged:false}),true);
});
test('disabled Mac and Windows never send consent or setup requests',async()=>{
  for(const options of [{platform:'win32'},{available:false}]){const f=fixture(options);assert.deepEqual(await f.flow.open(),{available:false});assert.equal(f.confirmations,0);assert.equal(f.requests.some(x=>x.command==='setup'),false);f.flow.dispose();}
});
test('native consent is awaited, concurrent opens share one prompt, and declining never starts setup',async()=>{
  let answer;const f=fixture({consent:()=>new Promise(resolve=>{answer=resolve;})});
  const one=f.flow.open(),two=f.flow.open();await Promise.resolve();await Promise.resolve();
  assert.equal(f.confirmations,1);assert.equal(f.requests.some(x=>x.command==='setup'),false);
  answer(true);await Promise.all([one,two]);assert.deepEqual(f.requests.filter(x=>x.command==='setup'),[{command:'setup',payload:{consent:true}}]);f.flow.dispose();
  const no=fixture({consent:false});assert.equal((await no.flow.open()).cancelled,true);assert.equal(no.requests.some(x=>x.command==='setup'),false);assert.deepEqual(no.panels,[true,false]);no.flow.dispose();
});
test('existing setup resumes without new consent and continuation carries only current job ID',async()=>{
  const f=fixture({current:state()});await f.flow.open();assert.equal(f.confirmations,0);
  await assert.rejects(f.flow.action('continue','stale'),/SETUP_JOB_STALE/);
  await f.flow.action('continue','fixture-job');assert.deepEqual(f.requests.at(-1),{command:'setup-continue',payload:{jobId:'fixture-job'}});
  f.collector.setup=state({cleanupPending:true});await assert.rejects(f.flow.action('continue','fixture-job'),/CONTINUATION_UNAVAILABLE/);
  await f.flow.action('cancel','fixture-job');assert.equal(f.requests.at(-1).command,'setup-cancel');
  f.flow.closePanel();assert.equal(f.requests.filter(x=>x.command==='setup-cancel').length,1);f.flow.dispose();
});
test('setup polling asks only cached setup status and never renews a session',async()=>{
  const f=fixture({current:state()});await f.flow.open();await f.timers[0]();assert.equal(f.requests.at(-1).command,'setup-status');assert.equal(f.requests.some(x=>x.command==='setup'),false);f.flow.dispose();
});
