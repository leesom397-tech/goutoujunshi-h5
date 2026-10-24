'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {Collector}=require('../collector.cjs');
const setup=(fields={})=>({jobId:'fixture-job',attempt:1,revision:1,phase:'waiting-for-user',active:true,can_continue:true,cleanupPending:false,ready:false,...fields});
function fixture(options={}){
  const children=[],launches=[];let handler=()=>{};
  const spawnProcess=(...args)=>{launches.push(args);const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;child.killed=0;child.ended=0;child.requests=[];
    child.send=value=>child.stdout.write(JSON.stringify(value)+'\n');child.exit=code=>{child.exitCode=code;child.emit('exit',code);};child.kill=()=>{child.killed++;child.exit(1);};
    child.stdin=new Writable({write(chunk,encoding,done){const request=JSON.parse(chunk.toString());child.requests.push(request);handler(child,request);done();},final(done){child.ended++;done();queueMicrotask(()=>child.exit(0));}});
    children.push(child);queueMicrotask(()=>child.send({event:'ready',setupAvailable:options.available??true}));return child;};
  const collector=new Collector({resources:process.cwd(),platform:'darwin',spawnProcess,...options});
  // A real file supplies only the existence check; no binary is executed.
  collector.development=true;const previous=process.env.CHENGZI_DESKTOP_PYTHON;process.env.CHENGZI_DESKTOP_PYTHON=process.execPath;
  return {collector,children,launches,setHandler:fn=>{handler=fn;},restore:()=>{if(previous===undefined)delete process.env.CHENGZI_DESKTOP_PYTHON;else process.env.CHENGZI_DESKTOP_PYTHON=previous;}};
}
async function use(t,options){const f=fixture(options);t.after(()=>{f.restore();for(const c of f.children)if(c.exitCode===null)c.exit(0);});await f.collector.launch();return f;}
test('spawn env enables only explicit Darwin experiment and always overrides inherited flag',async t=>{
  for(const options of [{},{platform:'win32',experimentalMacSetup:true},{experimentalMacSetup:true}]){
    const f=await use(t,options);assert.equal(f.launches[0][2].env.CHENGZI_MAC_EXPERIMENTAL_SETUP,options.platform==='win32'||!options.experimentalMacSetup?'0':'1');assert.equal(f.launches[0][2].shell,false);assert.equal(f.collector.state().serviceReady,true);assert.equal(f.collector.state().sourceReady,false);await f.collector.stop();f.restore();
  }
});
test('progress is sanitized and cannot resolve a normal request even when carrying its id',async t=>{
  const f=await use(t);let settled=false;
  f.setHandler((child,request)=>{child.send({event:'setup-progress',id:request.id,ok:true,setup:setup({message:'PRIVATE',account:'PRIVATE'})});});
  const result=f.collector.request('status').then(value=>{settled=true;return value;});await new Promise(setImmediate);assert.equal(settled,false);assert.equal(JSON.stringify(f.collector.state()).includes('PRIVATE'),false);
  const child=f.children[0];child.send({id:child.requests[0].id,ok:true});await result;
});
test('exit clears ready state; restart accepts a lower revision and old child cannot alter new generation',async t=>{
  const f=await use(t);const first=f.children[0];first.send({event:'setup-progress',setup:setup({attempt:4,revision:90,phase:'ready',active:false,ready:true})});assert.equal(f.collector.state().sourceReady,true);
  first.exit(0);assert.equal(f.collector.state().sourceReady,false);assert.equal(f.collector.setup,null);assert.equal(f.collector.setupAvailable,false);
  await f.collector.launch();const second=f.children[1];second.send({event:'setup-progress',setup:setup({attempt:1,revision:1,active:false,phase:'idle'})});
  first.send({event:'setup-progress',setup:setup({attempt:10,revision:100,phase:'ready',active:false,ready:true})});first.emit('error',Error('private'));
  assert.equal(f.collector.child,second);assert.equal(f.collector.setup.attempt,1);assert.equal(f.collector.state().sourceReady,false);
});
test('new attempt lower revision supersedes old ready cache, and request payloads are closed',async t=>{
  const f=await use(t);const child=f.children[0];child.send({event:'setup-progress',setup:setup({revision:99,active:false,phase:'ready',ready:true})});child.send({event:'setup-progress',setup:setup({attempt:2,revision:1})});assert.equal(f.collector.state().sourceReady,false);assert.equal(f.collector.setup.attempt,2);
  await assert.rejects(f.collector.request('setup'),/CONSENT_REQUIRED/);await assert.rejects(f.collector.request('status',{path:'PRIVATE'}),/INVALID_COMMAND/);await assert.rejects(f.collector.request('setup-continue',{jobId:'bad/id'}),/JOB_STALE/);assert.equal(child.requests.length,0);
});
test('stop cancels setup and waits for observed cleanup before ending control pipe',async t=>{
  let now=0;const f=await use(t,{clock:()=>now,sleep:async ms=>{now+=ms;}});const child=f.children[0];child.send({event:'setup-progress',setup:setup()});
  f.setHandler((c,r)=>{assert.equal(c.ended,0);c.send({id:r.id,ok:true,setup:setup(r.command==='setup-cancel'?{phase:'cancelling',cleanupPending:true}:{phase:'cancelled',active:false,cleanupPending:false,can_continue:false})});});
  await f.collector.stop();assert.deepEqual(child.requests.map(x=>x.command),['setup-cancel','setup-status']);assert.equal(child.killed,0);assert.equal(child.ended,1);
});
test('cleanup timeout keeps child and pipe alive; explicit failed cleanup remains blocked after child exit',async t=>{
  let now=0;const f=await use(t,{setupShutdownMs:500,clock:()=>now,sleep:async ms=>{now+=ms;}});const child=f.children[0];child.send({event:'setup-progress',setup:setup()});
  f.setHandler((c,r)=>c.send({id:r.id,ok:true,setup:setup({phase:'cancelling',cleanupPending:true})}));
  await assert.rejects(f.collector.stop(),/SETUP_CLEANUP_PENDING/);assert.equal(child.ended,0);assert.equal(child.killed,0);assert.equal(f.collector.child,child);
  child.send({event:'error',error:{code:'SETUP_CLEANUP_PENDING',message:'PRIVATE'}});child.exit(1);assert.equal(f.collector.setup,null);await assert.rejects(f.collector.stop(),/SETUP_CLEANUP_PENDING/);await assert.rejects(f.collector.launch(),/SETUP_CLEANUP_PENDING/);
});
