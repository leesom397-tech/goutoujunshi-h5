// Synthetic, operator-only end-to-end queue check. It never sends to WeChat,
// calls a model, reads a profile, or prints a secret.
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../outputs/wechat-callback-private.html",import.meta.url),"utf8");
const match=html.match(/<script[^>]*id="setup-data"[^>]*>([\s\S]*?)<\/script>/);
if(!match)throw Error("LOCAL_SETUP_NOT_FOUND");
const {WECHAT_CALLBACK_TOKEN:token}=JSON.parse(match[1]);
if(!token)throw Error("OPERATOR_TOKEN_NOT_FOUND");
const endpoint="https://coach.lovetalk.love/api/wechat/process";
async function post(kind,extra={}){
  const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","X-Wechat-Queue-Token":token},body:JSON.stringify({kind,...extra}),signal:AbortSignal.timeout(12000)});
  const data=await response.json().catch(()=>({status:"unreadable"}));
  return {httpStatus:response.status,data};
}
const started=await post("queue-probe-start");
if(started.httpStatus!==200){console.log(JSON.stringify({stage:"start",httpStatus:started.httpStatus,status:started.data.status}));process.exit(1);}
let result;
for(let i=0;i<12;i++){
  await new Promise(resolve=>setTimeout(resolve,1000));
  result=await post("queue-probe-status",{probeId:started.data.probeId});
  if(result.httpStatus!==200||result.data.lanes?.every(lane=>lane.status==="consumed"))break;
}
console.log(JSON.stringify({syntheticOnly:true,httpStatus:result?.httpStatus,status:result?.data?.status,lanes:result?.data?.lanes,customerReads:0,wechatReplies:0,modelCalls:0}));
if(result?.httpStatus!==200||!result.data.lanes?.every(lane=>lane.status==="consumed"))process.exitCode=1;
