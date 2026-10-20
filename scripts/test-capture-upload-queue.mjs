import assert from "node:assert/strict";
import { build } from "esbuild";
const compiled = await build({ entryPoints:["lib/capture-upload-queue.ts"], bundle:true, write:false, format:"esm", platform:"node" });
const { createCaptureUploadQueue } = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
{
  const barrier=deferred(), calls=[];let active=0,maxActive=0;
  const queue=createCaptureUploadQueue({current:()=>true,upload:async(value,subject)=>{
    active++;maxActive=Math.max(maxActive,active);calls.push([value.id,value.version,subject]);
    if(calls.length===1)await barrier.promise;
    active--;
  }});
  queue.enqueue({id:"chat",version:1},"person-a");
  queue.enqueue({id:"chat",version:2},"person-a");
  queue.enqueue({id:"chat",version:3},"person-a");
  queue.enqueue({id:"moments",version:1},"person-a");
  assert.equal(calls.length,1,"upload starts while capture can enqueue more");
  barrier.resolve();await queue.finish();
  assert.deepEqual(calls,[["chat",1,"person-a"],["chat",3,"person-a"],["moments",1,"person-a"]]);
  assert.equal(maxActive,1,"bounded network concurrency across both libraries");
}
{
  let attempts=0,errors=0;
  const barrier=deferred();
  const queue=createCaptureUploadQueue({current:()=>true,onError:()=>errors++,upload:async()=>{
    attempts++;if(attempts===1){await barrier.promise;throw Error("network");}
  }});
  queue.enqueue({id:"chat"},"person-a");barrier.resolve();
  await queue.finish();
  assert.equal(attempts,2,"final flush retries failed upload once");assert.equal(errors,1);
}
{
  let attempts=0;
  const queue=createCaptureUploadQueue({current:()=>true,upload:async()=>{attempts++;throw Error("offline");}});
  queue.enqueue({id:"chat"},"person-a");
  await assert.rejects(queue.finish(),/offline/);
  assert.equal(attempts,2,"persistent failure is surfaced, never loops");
}
{
  const barrier=deferred(),calls=[];let current=true;
  const queue=createCaptureUploadQueue({current:()=>current,upload:async(value)=>{calls.push(value.id);await barrier.promise;}});
  queue.enqueue({id:"chat"},"old-owner");
  queue.enqueue({id:"moments"},"old-owner");
  current=false;queue.stop();barrier.resolve();
  await assert.rejects(queue.finish(),{name:"AbortError"});
  queue.enqueue({id:"new"},"old-owner");
  assert.deepEqual(calls,["chat"],"logout stops all queued old-account uploads");
}
console.log("PASS live upload queue: overlap, latest-snapshot coalescing, bounded concurrency, recoverable failure, no retry loop, owner cancellation.");
