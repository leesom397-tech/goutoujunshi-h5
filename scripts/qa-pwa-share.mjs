// Local-only browser check: a fictional screenshot enters the Android PWA
// share target, stays on device, and awaits rights/speaker confirmation.
import {spawn} from "node:child_process";
import {mkdtemp,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
const base=process.argv[2]||"http://127.0.0.1:8787";
if(!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base))throw Error("LOCAL_ONLY");
const fixture=await readFile(new URL("../outputs/wechat-screenshot-synthetic.png",import.meta.url));
const profile=await mkdtemp(join(tmpdir(),"lovetalk-share-qa-"));
const edge=spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",[
  "--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check",
  "--remote-debugging-port=0","--user-data-dir="+profile,"about:blank",
],{windowsHide:true,stdio:"ignore"});
const delay=ms=>new Promise(done=>setTimeout(done,ms));
let socket,serial=0;const pending=new Map();
function call(method,params={},sessionId){
  const id=++serial;return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error("CDP timeout: "+method));},12000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
}
try{
  let info;
  for(let i=0;i<50;i++){try{info=(await readFile(join(profile,"DevToolsActivePort"),"utf8")).trim().split(/\r?\n/);break;}catch{await delay(150);}}
  if(!info)throw Error("BROWSER_NOT_READY");
  socket=new WebSocket("ws://127.0.0.1:"+info[0]+info[1]);
  await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
  socket.addEventListener("message",event=>{const data=JSON.parse(event.data),item=pending.get(data.id);if(!item)return;clearTimeout(item.timer);pending.delete(data.id);if(data.error)item.reject(Error(data.error.message));else item.resolve(data.result);});
  const {targetId}=await call("Target.createTarget",{url:"about:blank"});
  const {sessionId}=await call("Target.attachToTarget",{targetId,flatten:true});
  const send=(method,params)=>call(method,params,sessionId);
  const evaluate=async expression=>(await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result.value;
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send("Page.addScriptToEvaluateOnNewDocument",{source:`(()=>{
    const previous=fetch.bind(globalThis);globalThis.__qaUploaded=0;
    globalThis.fetch=async(input,options={})=>{
      const url=new URL(typeof input==="string"?input:input.url,location.origin);
      if(url.pathname==="/api/auth/session")return Response.json({loggedIn:true,user:{id:"qa-user",name:"Synthetic User"}});
      if(url.pathname==="/api/profile")return Response.json({subjects:[]});
      if(url.pathname==="/api/crush/screenshot"){globalThis.__qaUploaded++;return Response.json({error:"no model call expected"},{status:500});}
      if(url.pathname==="/api/crush"&&(!options.method||options.method==="GET"))return Response.json({enabled:true,provider:"qwen",qwen:true,jev:false,imageEnabled:false,wechatConfigured:false,reports:[]});
      return previous(input,options);
    };
  })();`});
  await send("Page.navigate",{url:base+"/crush"});
  async function until(expression){for(let i=0;i<100;i++){if(await evaluate("Boolean("+expression+")"))return;await delay(100);}throw Error("UI_TIMEOUT: "+expression);}
  await until("navigator.serviceWorker?.controller && document.querySelector('#chat-input')");
  const bytes=Array.from(fixture),post=`(async()=>{
    const data=new FormData();data.append("image",new File([new Uint8Array(${JSON.stringify(bytes)})],"fictional.png",{type:"image/png"}));
    await fetch("/share-target",{method:"POST",body:data,redirect:"manual"});
    const cache=await caches.open("lovetalk-local-share-v1"),keys=await cache.keys();
    return keys.map(key=>key.url);
  })()`;
  const keys=await evaluate(post);
  if(keys.length)throw Error("LOGGED_OUT_SHARE_MUST_NOT_BE_CACHED");
  const token=crypto.randomUUID();
  await evaluate(`(async()=>{
    const cache=await caches.open('lovetalk-local-share-v1');
    await cache.put(new Request('/.local-shares/${token}'),new Response(new Uint8Array(${JSON.stringify(bytes)}),
      {headers:{'Content-Type':'image/png','X-Shared-At':String(Date.now()),'X-Share-Owner':'qa-user'}}));
  })()`);
  await send("Page.navigate",{url:base+"/crush?share="+token});
  await until("document.querySelector('.crush-screenshot img') && document.querySelector('.crush-screenshot input[type=checkbox]')");
  const result=await evaluate(`(async()=>({name:document.querySelector('.crush-screenshot p')?.textContent,
    rights:document.querySelector('.crush-screenshot input[type=checkbox]')?.checked,
    uploaded:globalThis.__qaUploaded,keys:await caches.open('lovetalk-local-share-v1').then(c=>c.keys()).then(k=>k.length),
    url:location.href}))()`);
  if(result.rights||result.uploaded||result.keys||result.url.includes("share="))throw Error("SHARE_CONSENT_OR_CLEANUP_FAILED: "+JSON.stringify(result));
  const wrongToken=crypto.randomUUID();
  await evaluate(`(async()=>{
    const cache=await caches.open('lovetalk-local-share-v1');
    await cache.put(new Request('/.local-shares/${wrongToken}'),new Response(new Uint8Array(${JSON.stringify(bytes)}),
      {headers:{'Content-Type':'image/png','X-Shared-At':String(Date.now()),'X-Share-Owner':'another-account'}}));
  })()`);
  await send("Page.navigate",{url:base+"/crush?share="+wrongToken});
  await until("document.querySelector('.crush-error')?.textContent.includes('账号')");
  const leftover=await evaluate("caches.open('lovetalk-local-share-v1').then(c=>c.keys()).then(k=>k.length)");
  if(leftover!==0)throw Error("CROSS_ACCOUNT_SHARE_NOT_DELETED");
  console.log(JSON.stringify({status:"ok",...result,fictionalOnly:true,modelCalls:0,loggedOutRejected:true,crossAccountRejected:true}));
  await call("Browser.close");
}finally{socket?.close();for(const item of pending.values())clearTimeout(item.timer);if(edge.exitCode===null)edge.kill();}
