// Operator-only, production Worker read-only API/account check. No customer messages.
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../outputs/wechat-callback-private.html",import.meta.url),"utf8");
const match=html.match(/<script[^>]*id="setup-data"[^>]*>([\s\S]*?)<\/script>/);
if(!match)throw Error("LOCAL_SETUP_NOT_FOUND");
const {WECHAT_CALLBACK_TOKEN:token}=JSON.parse(match[1]);
if(!token)throw Error("OPERATOR_TOKEN_NOT_FOUND");
try{
  const response=await fetch("https://coach.lovetalk.love/api/wechat/process",{
    method:"POST",headers:{"Content-Type":"application/json","X-Wechat-Queue-Token":token},
    body:JSON.stringify({kind:"wechat-account-diagnostic"}),signal:AbortSignal.timeout(35000),
  });
  const result=await response.json().catch(()=>({status:"unreadable"}));
  console.log(JSON.stringify({httpStatus:response.status,...result}));
  if(!response.ok||result.status!=="ok")process.exitCode=1;
}catch{console.log(JSON.stringify({status:"operator_request_timeout"}));process.exitCode=1;}
