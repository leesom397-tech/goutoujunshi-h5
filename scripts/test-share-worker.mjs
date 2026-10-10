// Unit test the actual service-worker POST handler without a personal account.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
const source=await readFile(new URL("../public/sw.js",import.meta.url),"utf8");
const events=new Map(),entries=new Map();let loggedIn=true,sessionCalls=0,ownerId="synthetic-owner";
const cache={
  async keys(){return [...entries.keys()].map(url=>new Request(url));},
  async match(key){return entries.get(typeof key==="string"?key:key.url)?.clone();},
  async put(key,response){entries.set(typeof key==="string"?key:key.url,response.clone());},
  async delete(key){return entries.delete(typeof key==="string"?key:key.url);},
};
const origin="https://coach.lovetalk.love";
const self={location:{origin},addEventListener(name,fn){events.set(name,fn);},skipWaiting:async()=>{},clients:{claim:async()=>{}}};
vm.runInNewContext(source,{self,caches:{open:async()=>cache},Request,Response,File,FormData,URL,crypto,Date,
  fetch:async url=>{assert.equal(new URL(url).pathname,"/api/auth/session");sessionCalls++;return Response.json(loggedIn?{loggedIn:true,user:{id:ownerId}}:{loggedIn:false,user:null});}
});
async function share(file){
  const form=new FormData();form.append("image",file);
  const request=new Request(origin+"/share-target",{method:"POST",body:form});
  let response;
  events.get("fetch")({request,respondWith(value){response=Promise.resolve(value);}});
  return response;
}
const image=new File([new Uint8Array(32).fill(7)],"fictional.png",{type:"image/png"});
let response=await share(image);
assert.equal(response.status,303);assert.match(response.headers.get("location"),/\/crush\?share=[a-f0-9-]{36}/);
let keys=await cache.keys();assert.equal(keys.length,1);
assert.equal((await cache.match(keys[0])).headers.get("X-Share-Owner"),"synthetic-owner");
loggedIn=false;response=await share(image);
assert.equal(response.status,303);assert.match(response.headers.get("location"),/share_error=login/);
assert.equal((await cache.keys()).length,1);
let cleanup;events.get("message")({data:{type:"prune-local-shares"},waitUntil(value){cleanup=Promise.resolve(value);}});
await cleanup;assert.equal((await cache.keys()).length,0,"logout must clear pending image");
loggedIn=true;await share(image);ownerId="different-owner";
events.get("message")({data:{type:"prune-local-shares"},waitUntil(value){cleanup=Promise.resolve(value);}});
await cleanup;assert.equal((await cache.keys()).length,0,"account switch must clear previous owner's image");
for(let i=0;i<5;i++)await share(image);
assert.equal((await cache.keys()).length,3,"keep at most three pending local images");
const before=sessionCalls;
response=await share(new File([new Uint8Array(32)],"bad.txt",{type:"text/plain"}));
assert.match(response.headers.get("location"),/share_error=invalid/);assert.equal(sessionCalls,before);
for(const key of await cache.keys())await cache.put(key,new Response(image,{headers:{"Content-Type":"image/png","X-Shared-At":String(Date.now()-16*60*1000),"X-Share-Owner":ownerId}}));
events.get("message")({data:{type:"prune-local-shares"},waitUntil(value){cleanup=Promise.resolve(value);}});
await cleanup;assert.equal((await cache.keys()).length,0);
console.log("PWA share worker: owner-bound, logout/account-switch/expiry cleanup, three-image cap and invalid file rejection passed.");
