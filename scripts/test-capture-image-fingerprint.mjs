import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['lib/capture-report-state.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const uri='data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64');
const {captureMaterialVersion}=await import(uri);
const nativeAtob=globalThis.atob,nativeDigest=crypto.subtle.digest.bind(crypto.subtle);
let decodes=0,hashes=0,active=0,maxActive=0,ticks=0;
globalThis.atob=value=>{decodes++;return nativeAtob(value);};
crypto.subtle.digest=async(...args)=>{hashes++;active++;maxActive=Math.max(maxActive,active);try{return await nativeDigest(...args);}finally{active--;}};
const library={id:'local-large',updatedAt:'2026-01-01T00:00:00Z',cloud:{id:'cloud-large',epoch:1,mediaDigests:{}},records:Array.from({length:124},(_,index)=>({localId:'post-'+index,kind:'post',senderRole:'other',at:'2026-01-01',text:'合成动态 '+index,source:{materialRole:'moment'},images:[{mime:'image/png',name:'synthetic',data:Buffer.alloc(562500,index).toString('base64')}]}))};
const started=performance.now(),timer=setInterval(()=>ticks++,1);
try{
  const pending=captureMaterialVersion(library);
  assert.equal(decodes,0,'no image decode/hash runs synchronously when the UI schedules a material check');
  const version=await pending;
  const coldMs=Math.round(performance.now()-started);
  assert.equal(hashes,124);assert.equal(decodes,124);assert.ok(ticks>10,'the event loop receives turns while a 93 MB library is fingerprinted');assert.ok(maxActive<=2,'image hashing concurrency is bounded');
  const warmStarted=performance.now();
  for(let i=0;i<10;i++){
    const clone={...library,updatedAt:new Date(1760000000000+i).toISOString(),cloud:{...library.cloud,syncedAt:String(i)},records:library.records.map(row=>({...row,images:row.images.map(image=>({...image}))}))};
    assert.equal((await captureMaterialVersion(clone)).contentKey,version.contentKey);
  }
  const warmMs=Math.round(performance.now()-warmStarted);
  assert.equal(hashes,124,'ten metadata/sync updates must not hash any image again');assert.equal(decodes,124);
  const textChanged={...library,records:library.records.map((row,index)=>index===0?{...row,text:'同数量的正文修正'}:row)};
  assert.notEqual((await captureMaterialVersion(textChanged)).contentKey,version.contentKey);assert.equal(hashes,124);
  const imageChanged={...library,records:library.records.map((row,index)=>index===0?{...row,images:[{...row.images[0],data:Buffer.alloc(562500,200).toString('base64')}]}:row)};
  assert.notEqual((await captureMaterialVersion(imageChanged)).contentKey,version.contentKey);assert.equal(hashes,125,'same-count/same-size image edit hashes only that image');
  const fresh=await import(uri+'#fresh-runtime');
  assert.equal((await fresh.captureMaterialVersion(library)).contentKey,version.contentKey,'signatures remain stable across refresh with an empty runtime cache');
  console.log(`PASS 124 x 750KB image fingerprints: cold ${coldMs} ms with event-loop yields; ten warm metadata passes ${warmMs} ms and zero rehashes; same-count text/image edits, bounded work and cold refresh stability.`);
}finally{clearInterval(timer);globalThis.atob=nativeAtob;crypto.subtle.digest=nativeDigest;}
