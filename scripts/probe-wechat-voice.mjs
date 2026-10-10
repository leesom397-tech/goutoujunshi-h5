// Read-back of ONE explicit test message. No latest-user selection, replies or audio storage.
// Stop unless the prototype still has exactly one bound user and one recent sender.
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import ts from "typescript";
async function main(){
const [keyFile,messageId]=process.argv.slice(2);
if(!keyFile||!messageId||!/^[A-Za-z0-9_-]{10,100}$/.test(messageId))throw Error("EXPLICIT_TEST_MESSAGE_REQUIRED");
const sql="SELECT COUNT(DISTINCT external_userid) n FROM coach_wechat_links; SELECT COUNT(DISTINCT external_userid) n FROM coach_wechat_inbox WHERE created_at>"+(Date.now()-7200000)+"; SELECT i.id,i.open_kfid,i.external_userid FROM coach_wechat_inbox i JOIN coach_wechat_links l ON l.external_userid=i.external_userid AND l.open_kfid=i.open_kfid JOIN coach_profiles p ON p.owner_id=l.owner_id WHERE p.consent_at IS NOT NULL AND p.paused=0 AND i.id='"+messageId+"' AND i.created_at>"+(Date.now()-7200000)+";";
const result=JSON.parse(execFileSync(process.execPath,["node_modules/wrangler/bin/wrangler.js","d1","execute","goutoujunshi-coach","--remote","--config","wrangler.coach.jsonc","--json","--command",sql],{encoding:"utf8"}));
if(result[0].results[0].n!==1||result[1].results[0].n!==1||result[2].results.length!==1)throw Error("TEST_OWNER_SCOPE_NOT_UNIQUE");
const target=result[2].results[0];
const html=readFileSync("outputs/wechat-callback-private.html","utf8");
const config=JSON.parse(html.match(/<script[^>]*id="setup-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
if(process.argv.includes("--worker")){
  const response=await fetch("https://coach.lovetalk.love/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json","X-Wechat-Queue-Token":config.WECHAT_CALLBACK_TOKEN},body:JSON.stringify({kind:"voice-recheck",messageId}),signal:AbortSignal.timeout(60000)});
  console.log(JSON.stringify({stage:"worker-recheck",httpStatus:response.status,result:await response.json()}));
  return;
}
const secret=(readFileSync("outputs/wechat-secret-private.txt","utf8").match(/[A-Za-z0-9_-]{35,70}/)||[])[0];
if(!secret)throw Error("LOCAL_WECHAT_CREDENTIAL_MISSING");
const tokenResponse=await fetch("https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid="+encodeURIComponent(config.WECHAT_CORP_ID)+"&corpsecret="+encodeURIComponent(secret),{signal:AbortSignal.timeout(15000)});
const token=await tokenResponse.json();if(!token.access_token)throw Error("WECHAT_AUTH_"+Number(token.errcode));
const base="https://qyapi.weixin.qq.com/cgi-bin/",auth="?access_token="+encodeURIComponent(token.access_token);
let cursor,source;
for(let page=0;page<3;page++){
  const response=await fetch(base+"kf/sync_msg"+auth,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cursor,open_kfid:target.open_kfid,voice_format:0,limit:1000}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(data.errcode!==0)throw Error("WECHAT_SYNC_"+Number(data.errcode));
  source=(data.msg_list||[]).find(message=>message.msgid===messageId&&message.external_userid===target.external_userid&&message.open_kfid===target.open_kfid);
  if(source||!data.has_more||!data.next_cursor||data.next_cursor===cursor)break;
  cursor=data.next_cursor;
}
console.log(JSON.stringify({stage:"readback",found:Boolean(source),kind:source?.msgtype,hasAudio:Boolean(source?.voice?.media_id)}));
if(source?.msgtype!=="voice"||!source.voice?.media_id){process.exitCode=1;return;}
const downloaded=await fetch(base+"media/get"+auth+"&media_id="+encodeURIComponent(source.voice.media_id),{signal:AbortSignal.timeout(15000)});
const bytes=new Uint8Array(await downloaded.arrayBuffer());
const amr=new TextDecoder().decode(bytes.slice(0,9)).startsWith("#!AMR");
console.log(JSON.stringify({stage:"download",status:downloaded.status,byteCount:bytes.length,amr,ageSeconds:Math.round(Date.now()/1000-source.send_time)}));
if(!amr||bytes.length>2000000){process.exitCode=1;return;}
const keySource=readFileSync(keyFile,"utf8").replace(/^\uFEFF/,"");
const entry=keySource.split(/\r?\n/).find(line=>/^"?apiKey"?,/i.test(line));
const key=entry?.slice(entry.indexOf(",")+1).trim().replace(/^"|"$/g,"").replace(/""/g,'"')||(keySource.match(/sk-[A-Za-z0-9_-]{20,}/)||[])[0];
if(!key||!key.startsWith("sk-")&&!key.startsWith("apikey_"))throw Error("LOCAL_BAILIAN_KEY_NOT_FOUND");
const workspace=JSON.parse(readFileSync("wrangler.coach.jsonc","utf8")).vars.DASHSCOPE_WORKSPACE_ID;
const code=ts.transpileModule(readFileSync("lib/wechat-asr.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function("require","module","exports",code)(id=>id==="./wechat"?{getWechatMedia:async()=>({bytes,mime:"audio/amr"})}:{qwenKey:()=>key,qwenWorkspaceId:()=>workspace},module,module.exports);
const originalFetch=globalThis.fetch;let shape;
globalThis.fetch=async(...args)=>{
  const response=await originalFetch(...args),data=await response.clone().json().catch(()=>({}));
  shape={httpStatus:response.status,outerText:typeof data.output?.text==="string",sentenceText:typeof data.output?.sentence?.text==="string",nestedSentenceText:typeof data.output?.output?.sentence?.text==="string",sentenceCount:Array.isArray(data.output?.sentences)?data.output.sentences.length:0};
  return response;
};
const start=Date.now();
try{
  const transcript=await module.exports.transcribeWechatVoice(source.voice.media_id,AbortSignal.timeout(60000));
  console.log(JSON.stringify({stage:"transcribe",status:"ok",elapsedMs:Date.now()-start,textLength:transcript.text.length,speakerCount:transcript.speakerCount,shape}));
}catch(error){
  const message=error instanceof Error?error.message:"";
  console.log(JSON.stringify({stage:"transcribe",status:"failed",elapsedMs:Date.now()-start,code:/^WECHAT_[A-Z0-9_]+$/.test(message)?message:error.name==="TimeoutError"?"TIMEOUT":"NETWORK_OR_PARSE",shape}));
  process.exitCode=1;
}finally{globalThis.fetch=originalFetch;}
}
await main();
