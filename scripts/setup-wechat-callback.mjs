// Explicit operator tool: generates a LOCAL private handoff, configures existing
// Cloudflare secrets via stdin, then tests only the signed GET verification.
// No secrets in arguments/log output, and no real customer messages are sent.
import assert from "node:assert/strict";
import {createCipheriv,createHash,randomBytes} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve,relative} from "node:path";
import {generateEncodingAesKey,validEncodingAesKey} from "./wechat-key-format.mjs";

const root=resolve("."),file=resolve(root,"outputs/wechat-callback-private.html");
const callback="https://coach.lovetalk.love/api/wechat/callback";
const dataPattern=/<script id="setup-data" type="application\/json">([\s\S]*?)<\/script>/;
const action=process.argv[2];
function loadPrivate(allowLegacySymbols=false){
  const match=readFileSync(file,"utf8").match(dataPattern);
  if(!match)throw Error("PRIVATE_FILE_INVALID");
  const data=JSON.parse(match[1]);
  if(!/^ww[a-f0-9]{16}$/.test(data.WECHAT_CORP_ID)||! /^[A-Za-z0-9]{32}$/.test(data.WECHAT_CALLBACK_TOKEN)||!validEncodingAesKey(data.WECHAT_ENCODING_AES_KEY,allowLegacySymbols))throw Error("PRIVATE_FILE_INVALID");
  return data;
}
try {
  if(!["prepare","rotate-aes","configure","verify","verify-connected"].includes(action))throw Error("ACTION_REQUIRED");
  const config=JSON.parse(readFileSync(resolve(root,"wrangler.coach.jsonc"),"utf8"));
  if(config.name!=="goutoujunshi-coach")throw Error("WRONG_CHECKOUT");
  const ignored=spawnSync("git",["check-ignore","--quiet",relative(root,file)],{cwd:root,windowsHide:true,stdio:"ignore"});
  if(ignored.status!==0)throw Error("PRIVATE_PATH_NOT_IGNORED");
  if(action==="prepare"){
    const corpId=process.argv[3];if(!/^ww[a-f0-9]{16}$/.test(corpId||""))throw Error("CORP_ID_INVALID");
    if(existsSync(file)){
      if(loadPrivate().WECHAT_CORP_ID!==corpId)throw Error("PRIVATE_CORP_MISMATCH");
      console.log(JSON.stringify({status:"READY",file,reused:true}));
    }else{
      const data={WECHAT_CORP_ID:corpId,WECHAT_CALLBACK_TOKEN:randomBytes(16).toString("hex"),WECHAT_ENCODING_AES_KEY:generateEncodingAesKey()};
      const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>微信客服 · 本地私密配置</title><style>body{background:#f3f6f4;color:#163d30;font:16px/1.7 system-ui;padding:24px}main{max-width:760px;margin:auto;background:white;padding:28px;border-radius:18px}h1{font-size:24px}label{display:block;margin-top:20px;font-weight:600}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #adc4b8;border-radius:8px;font:16px monospace;background:#f8faf9}button{margin-top:8px;min-height:44px;padding:8px 20px;color:white;background:#127a50;border:0;border-radius:8px;cursor:pointer}.notice{padding:12px;background:#fff5dc;color:#6f5015;border-radius:8px}small{font-size:14px;color:#4c6a5b}</style><main><h1>微信客服 · 本地私密配置</h1><p class="notice">仅保存在你的电脑，包含敏感参数。不要截图、转发、上传知识库或发布到网站。</p><p>等待助手确认服务器已配置，再把下面的 Token 和 EncodingAESKey 替换到微信客服表单。回调 URL 保持不变。</p><label>回调 URL</label><input id="url" readonly><button data-copy="url">复制 URL</button><label>Token</label><input id="token" readonly><button data-copy="token">复制 Token</button><label>EncodingAESKey</label><input id="aes" readonly><button data-copy="aes">复制 EncodingAESKey</button><p id="status" aria-live="polite"></p><small>替换后点微信后台「完成」。成功后才会出现 API Secret；不要把 Secret 发到聊天或截图中。</small></main><script id="setup-data" type="application/json">${JSON.stringify(data)}</script><script>const data=JSON.parse(document.getElementById('setup-data').textContent);document.getElementById('url').value=${JSON.stringify(callback)};document.getElementById('token').value=data.WECHAT_CALLBACK_TOKEN;document.getElementById('aes').value=data.WECHAT_ENCODING_AES_KEY;for(const button of document.querySelectorAll('[data-copy]'))button.addEventListener('click',async()=>{const input=document.getElementById(button.dataset.copy);try{if(navigator.clipboard)await navigator.clipboard.writeText(input.value);else{input.select();if(!document.execCommand('copy'))throw Error('copy');}document.getElementById('status').textContent='已复制，请粘贴到微信后台对应字段。';}catch{input.select();document.getElementById('status').textContent='请按 Ctrl+C 手动复制已选中的内容。';}});</script></html>`;
      mkdirSync(resolve(root,"outputs"),{recursive:true});
      writeFileSync(file,html,{encoding:"utf8",mode:0o600,flag:"wx"});
      console.log(JSON.stringify({status:"READY",file,reused:false,scope:"local private artifact; not a public web page"}));
    }
  }
  if(action==="rotate-aes"){
    const data=loadPrivate(true),html=readFileSync(file,"utf8");
    data.WECHAT_ENCODING_AES_KEY=generateEncodingAesKey();
    writeFileSync(file,html.replace(dataPattern,()=>'<script id="setup-data" type="application/json">'+JSON.stringify(data)+'</script>'),{encoding:"utf8",mode:0o600});
    console.log(JSON.stringify({status:"LOCAL_AES_UPDATED",file,length:43,alphanumeric:true,tokenUnchanged:true,scope:"requires configure before use"}));
  }
  if(action==="configure"){
    const data=loadPrivate();
    const result=spawnSync(process.execPath,[resolve(root,"node_modules/wrangler/bin/wrangler.js"),"secret","bulk","--config","wrangler.coach.jsonc"],{cwd:root,input:JSON.stringify(data),encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:1024*1024,env:{...process.env,WRANGLER_LOG:"error",WRANGLER_SEND_METRICS:"false"}});
    if(result.status!==0)throw Error("SECRET_UPLOAD_FAILED");
    console.log(JSON.stringify({status:"CONFIGURED",names:Object.keys(data),scope:"callback handshake only; API Secret and customer-service ID still required"}));
  }
  if(action==="verify"||action==="verify-connected"){
    const data=loadPrivate(),echo="coach-callback-check-"+randomBytes(12).toString("hex"),body=Buffer.from(echo),length=Buffer.alloc(4);length.writeUInt32BE(body.length);
    const raw=Buffer.concat([randomBytes(16),length,body,Buffer.from(data.WECHAT_CORP_ID)]),padding=32-raw.length%32;
    const key=Buffer.from(data.WECHAT_ENCODING_AES_KEY+"=","base64"),cipher=createCipheriv("aes-256-cbc",key,key.subarray(0,16));cipher.setAutoPadding(false);
    const encrypted=Buffer.concat([cipher.update(Buffer.concat([raw,Buffer.alloc(padding,padding)])),cipher.final()]).toString("base64"),timestamp=String(Math.floor(Date.now()/1000)),nonce=randomBytes(16).toString("hex");
    const signature=createHash("sha1").update([data.WECHAT_CALLBACK_TOKEN,timestamp,nonce,encrypted].sort().join("")).digest("hex");
    const url=new URL(callback);url.search=new URLSearchParams({msg_signature:signature,timestamp,nonce,echostr:encrypted}).toString();
    const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200);assert.equal(await response.text(),echo);
    if(action==="verify-connected"){
      // Signed non-event payload: confirms full configuration without queueing
      // a fake WeChat notification or sending any customer message.
      const post=await fetch(url,{method:"POST",headers:{"Content-Type":"application/xml"},body:"<xml><Encrypt><![CDATA["+encrypted+"]]></Encrypt></xml>",redirect:"error",signal:AbortSignal.timeout(15000)});
      assert.equal(post.status,200);assert.equal(await post.text(),"success");
    }
    url.searchParams.set("msg_signature","0".repeat(40));
    const rejected=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(15000)});assert.equal(rejected.status,403);await rejected.body?.cancel();
    console.log(JSON.stringify({status:"PASS",signedGet:200,forgedGet:403,...(action==="verify-connected"?{signedNonEventPost:200}:{}),scope:"live callback handshake; WeChat customer message delivery NOT tested"}));
  }
}catch(error){
  const known=["ACTION_REQUIRED","WRONG_CHECKOUT","PRIVATE_PATH_NOT_IGNORED","CORP_ID_INVALID","PRIVATE_FILE_INVALID","PRIVATE_CORP_MISMATCH","SECRET_UPLOAD_FAILED"];
  console.error(JSON.stringify({status:"FAIL",code:known.includes(error?.message)?error.message:"SETUP_OR_VERIFICATION_FAILED"}));process.exitCode=1;
}
