// Offline cryptographic checks. No real credentials, model calls or WeChat requests.
import assert from "node:assert/strict";
import {createCipheriv,createHash,randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve,dirname} from "node:path";
import ts from "typescript";
import {generateEncodingAesKey,validEncodingAesKey} from "./wechat-key-format.mjs";
const root=resolve("."),nativeRequire=createRequire(import.meta.url);
const env={WECHAT_CORP_ID:"ww0000000000000001",WECHAT_CALLBACK_TOKEN:randomBytes(16).toString("hex"),WECHAT_ENCODING_AES_KEY:randomBytes(32).toString("base64").replace(/=$/,"")};
const cache=new Map();
const background=[];
const mocks={"cloudflare:workers":{env,waitUntil(promise){background.push(promise);}},"@/db":{},"@/lib/coach":{},"@/lib/knowledge":{},"@/lib/profile-context":{},"@/lib/profile":{},"@/lib/qwen":{},"@/lib/crush/wechat":{},"@/lib/crush/outbox":{},"@/lib/crush/service":{}};
function load(file){
  const path=resolve(root,file);if(cache.has(path))return cache.get(path).exports;
  const loadedModule={exports:{}};cache.set(path,loadedModule);
  const source=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const require=id=>{
    if(id in mocks)return mocks[id];
    if(id.startsWith(".")||id.startsWith("@/")){
      let next=id.startsWith("@/")?resolve(root,id.slice(2)):resolve(dirname(path),id);
      if(!/\.[cm]?[jt]sx?$/.test(next))next+=".ts";
      return load(next);
    }return nativeRequire(id);
  };
  new Function("require","module","exports",source)(require,loadedModule,loadedModule.exports);return loadedModule.exports;
}
const wechat=load("lib/wechat.ts"),route=load("app/api/wechat/callback/route.ts");
function probe(receiver=env.WECHAT_CORP_ID,stamp=Math.floor(Date.now()/1000),payload="fictional-first-time-echo"){
  const echo=payload,body=Buffer.from(echo),length=Buffer.alloc(4);length.writeUInt32BE(body.length);
  const plain=Buffer.concat([randomBytes(16),length,body,Buffer.from(receiver)]),padding=32-plain.length%32;
  const key=Buffer.from(env.WECHAT_ENCODING_AES_KEY+"=","base64"),cipher=createCipheriv("aes-256-cbc",key,key.subarray(0,16));cipher.setAutoPadding(false);
  const encrypted=Buffer.concat([cipher.update(Buffer.concat([plain,Buffer.alloc(padding,padding)])),cipher.final()]).toString("base64"),timestamp=String(stamp),nonce=randomBytes(12).toString("hex");
  const signature=createHash("sha1").update([env.WECHAT_CALLBACK_TOKEN,timestamp,nonce,encrypted].sort().join("")).digest("hex");
  const url=new URL("https://test/api/wechat/callback");url.search=new URLSearchParams({msg_signature:signature,timestamp,nonce,echostr:encrypted}).toString();
  return {url,echo,encrypted};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log("PASS "+name);}
await test("generated operator AESKeys match the form and canonical 32-byte Base64",()=>{
  for(let i=0;i<1000;i++){
    const key=generateEncodingAesKey();assert.equal(validEncodingAesKey(key),true);assert.match(key,/^[A-Za-z0-9]{43}$/);
    assert.equal(Buffer.from(key+"=","base64").length,32);
  }
  assert.equal(validEncodingAesKey("A".repeat(42)+"+"),false);
  assert.equal(validEncodingAesKey("A".repeat(42)+"B"),false);
});
await test("callback readiness does not require API Secret or customer-service ID",()=>{
  assert.equal(wechat.wechatCallbackConfigured(),true);assert.equal(wechat.wechatConfigured(),false);assert.equal(wechat.wechatPublicConfig().configured,false);
});
await test("first-time signed encrypted GET returns the exact decrypted echo",async()=>{
  const p=probe(),r=await route.GET(new Request(p.url));assert.equal(r.status,200);assert.equal(await r.text(),p.echo);assert.equal(r.headers.get("Cache-Control"),"no-store");
});
await test("missing or forged signatures are rejected",async()=>{
  assert.equal((await route.GET(new Request("https://test/api/wechat/callback"))).status,403);
  const p=probe();p.url.searchParams.set("msg_signature","0".repeat(40));assert.equal((await route.GET(new Request(p.url))).status,403);
});
await test("expired timestamps and another corporation are rejected",async()=>{
  assert.equal((await route.GET(new Request(probe(env.WECHAT_CORP_ID,Math.floor(Date.now()/1000)-3600).url))).status,403);
  assert.equal((await route.GET(new Request(probe("ww0000000000000002").url))).status,403);
});
await test("message processing stays disabled until full setup",async()=>{
  const p=probe(),r=await route.POST(new Request(p.url,{method:"POST",body:"<xml><Encrypt><![CDATA["+p.encrypted+"]]></Encrypt></xml>"}));assert.equal(r.status,503);
});
await test("signed customer-service callback enqueues pull on the dedicated fast lane",async()=>{
  const jobs=[],heavyJobs=[],direct=[];
  env.WECHAT_KF_SECRET="fictional-secret";env.WECHAT_KF_ID="fictional-kf";
  env.WECHAT_PULL_QUEUE={async send(job){jobs.push(job);}};
  env.WECHAT_QUEUE={async send(job){heavyJobs.push(job);}};
  env.WECHAT_COORDINATOR={idFromName(key){return key;},get(key){return {async fetch(request){direct.push({key,job:JSON.parse(await request.text())});return new Response("ok");}};}};
  const p=probe(env.WECHAT_CORP_ID,Math.floor(Date.now()/1000),"<xml><Event>kf_msg_or_event</Event><Token>fictional-sync-token</Token><OpenKfId>fictional-kf</OpenKfId></xml>");
  const request=()=>new Request(p.url,{method:"POST",body:"<xml><Encrypt><![CDATA["+p.encrypted+"]]></Encrypt></xml>"});
  assert.equal((await route.POST(request())).status,200);
  assert.deepEqual(jobs,[{kind:"pull",token:"fictional-sync-token",openKfId:"fictional-kf"}]);
  assert.equal(heavyJobs.length,0);
  await Promise.all(background);
  assert.deepEqual(direct,[{key:"pull:fictional-kf",job:jobs[0]}]);
  delete env.WECHAT_PULL_QUEUE;
  assert.equal((await route.POST(request())).status,503);
  assert.equal(heavyJobs.length,0);
  assert.equal(direct.length,1);
  delete env.WECHAT_COORDINATOR;delete env.WECHAT_QUEUE;delete env.WECHAT_KF_SECRET;delete env.WECHAT_KF_ID;
});
await test("partial callback setup stays disabled",async()=>{
  const saved=env.WECHAT_ENCODING_AES_KEY;delete env.WECHAT_ENCODING_AES_KEY;
  assert.equal(wechat.wechatCallbackConfigured(),false);assert.equal((await route.GET(new Request("https://test/api/wechat/callback"))).status,503);env.WECHAT_ENCODING_AES_KEY=saved;
});
console.log(passed+" offline callback tests passed. No production secrets used.");
