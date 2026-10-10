// Read the current Browser Run account ceiling. No user data or browser launch.
import {readFileSync} from "node:fs";
if(process.argv[2]!=="--read-only")throw Error("READ_ONLY_FLAG_REQUIRED");
const html=readFileSync(new URL("../outputs/wechat-callback-private.html",import.meta.url),"utf8");
const match=html.match(/<script[^>]*id="setup-data"[^>]*>([\s\S]*?)<\/script>/);
if(!match)throw Error("LOCAL_SETUP_NOT_FOUND");
const config=JSON.parse(match[1]);
const started=Date.now();
try{
  const response=await fetch("https://coach.lovetalk.love/api/wechat/process",{
    method:"POST",headers:{"Content-Type":"application/json","X-Wechat-Queue-Token":config.WECHAT_CALLBACK_TOKEN},
    body:JSON.stringify({kind:"capacity-diagnostic"}),signal:AbortSignal.timeout(15000)
  });
  const result=await response.json().catch(()=>({status:"unreadable"}));
  console.log(JSON.stringify({httpStatus:response.status,roundTripMs:Date.now()-started,result}));
  if(!response.ok||result.status!=="ok")process.exitCode=1;
}catch{
  console.log(JSON.stringify({status:"probe_failed",roundTripMs:Date.now()-started}));
  process.exitCode=1;
}
