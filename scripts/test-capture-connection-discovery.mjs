import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/capture-connection-discovery.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {captureConnectionEntry,rememberCaptureConnectionEntry,restoreCaptureConnectionEntry,discoverCaptureConnection}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const values=new Map(), storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
const subject='11111111-1111-4111-8111-111111111111';
const entry='/capture?intent=person&subjectId='+subject+'&returnTo='+encodeURIComponent('/archive?subjectId='+subject)+'&contactSearch='+encodeURIComponent('合成人物')+'&kind=moments&focus=affinity#connect=secret';
rememberCaptureConnectionEntry('owner-a',entry,storage,1000);
const restored=new URL(restoreCaptureConnectionEntry('owner-a','https://example.test/capture?method=desktop',storage,1001),'https://example.test');
for(const [key,value] of new URL(entry,'https://example.test').searchParams)assert.equal(restored.searchParams.get(key),value);
assert.equal(restored.hash,'');assert.doesNotMatch([...values.values()].join(''),/connect=|secret/);
assert.equal(restoreCaptureConnectionEntry('owner-b',entry,storage,1001),'','navigation is account scoped');
assert.equal(new URL(restoreCaptureConnectionEntry('owner-a','/capture?kind=chat&contactSearch=explicit',storage,1001),'https://example.test').searchParams.get('contactSearch'),'explicit');
assert.equal(restoreCaptureConnectionEntry('owner-a','/capture',storage,1_801_000),'','stale navigation expires');
assert.equal(captureConnectionEntry('/capture?returnTo=https://evil.test&subjectId=invalid&token=secret&contactSearch=%00bad'),'/capture?method=desktop');
assert.equal(captureConnectionEntry('/other?intent=person'),'');

const originals={BroadcastChannel:globalThis.BroadcastChannel,window:globalThis.window,document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
const channels=new Set(),messages=[],timers=new Map();let timerId=0;
class Channel{
 constructor(name){this.name=name;this.onmessage=null;channels.add(this);}
 postMessage(data){messages.push(structuredClone(data));for(const peer of channels)if(peer!==this&&peer.name===this.name)queueMicrotask(()=>{if(channels.has(peer))peer.onmessage?.({data:structuredClone(data)});});}
 close(){channels.delete(this);}
}
class Events extends EventTarget{
 listeners=new Set();
 addEventListener(name,fn){super.addEventListener(name,fn);this.listeners.add(fn);}
 removeEventListener(name,fn){super.removeEventListener(name,fn);this.listeners.delete(fn);}
}
globalThis.BroadcastChannel=Channel;globalThis.window=new Events();globalThis.document=new Events();
globalThis.setInterval=fn=>{const id=++timerId;timers.set(id,fn);return id;};globalThis.clearInterval=id=>timers.delete(id);
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const session={token:'synthetic-token-'.repeat(3),expiresAt:Date.now()+60_000};
const clients=[];const create=options=>{const client=discoverCaptureConnection(options);clients.push(client);return client;};
try{
 let oldSession=null,paused=false,accepts=0,foreignAccepts=0;
 const old=create({owner:'owner-a',getConnection:()=>oldSession,canConnect:()=>!paused,accept:async value=>{accepts++;oldSession=value;}});
 create({owner:'owner-b',getConnection:()=>null,canConnect:()=>true,accept:async()=>{foreignAccepts++;}});
 const helper=create({owner:'owner-a',getConnection:()=>session,canConnect:()=>true,accept:async()=>assert.fail('connected helper must not accept a session')});
 await flush();assert.equal(accepts,1);assert.deepEqual(oldSession,session);assert.equal(foreignAccepts,0);
 paused=true;oldSession=null;helper.announce();old.refresh();await flush();assert.equal(accepts,1,'explicit disconnect never reconnects');
 paused=false;old.refresh();await flush();assert.equal(accepts,2,'explicit resume can rediscover');
 let attempts=0,recovered=null;
 const retry=create({owner:'owner-a',getConnection:()=>recovered,canConnect:()=>true,accept:async value=>{attempts++;if(attempts===1)throw Error('session not yet reachable');recovered=value;}});
 await flush();assert.equal(recovered,null);retry.refresh();await flush();assert.deepEqual(recovered,session);
 let aborted=false,lateWrites=0;
 const pending=create({owner:'owner-a',getConnection:()=>null,canConnect:()=>true,accept:async(_value,signal)=>{await new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));if(!signal.aborted)lateWrites++;}});
 await flush();pending.close();await flush();assert.equal(aborted,true);assert.equal(lateWrites,0);
 let invalid=0;create({owner:'owner-expired',getConnection:()=>({...session,expiresAt:Date.now()-1}),canConnect:()=>false,accept:async()=>{}});
 create({owner:'owner-expired',getConnection:()=>null,canConnect:()=>true,accept:async()=>{invalid++;}});await flush();assert.equal(invalid,0);
 const request=messages.find(m=>m.type==='request'&&m.owner==='owner-b');
 for(const peer of channels)peer.onmessage?.({data:{type:'offer',owner:'owner-b',from:'forged',to:request.from,nonce:'stale-nonce',connection:session}});
 await flush();assert.equal(foreignAccepts,0,'unsolicited stale offers are ignored');
 for(const client of clients)client.close();
 assert.equal(channels.size,0);assert.equal(timers.size,0);assert.equal(window.listeners.size,0);assert.equal(document.listeners.size,0);
 const before=messages.length;window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));assert.equal(messages.length,before);
 console.log('PASS capture discovery: safe navigation + TTL, same-owner auto-connect, other-owner isolation, pause/resume, validation retry, in-flight unload abort, stale offers, complete listener/timer/channel cleanup');
}finally{for(const client of clients)client.close();Object.assign(globalThis,originals);}
