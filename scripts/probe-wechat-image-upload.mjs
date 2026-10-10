// Upload a fixed fictional analysis card to WeChat media storage. Do not send
// any customer-service message or expose the returned media ID.
import {readFileSync} from "node:fs";
if(process.argv[2]!=="--synthetic-only")throw Error("SYNTHETIC_ONLY_FLAG_REQUIRED");
const page=Number(process.argv[3]||1);
if(!Number.isInteger(page)||page<1||page>3)throw Error("SYNTHETIC_PAGE_1_TO_3_REQUIRED");
const html=readFileSync(new URL("../outputs/wechat-callback-private.html",import.meta.url),"utf8");
const match=html.match(/<script[^>]*id="setup-data"[^>]*>([\s\S]*?)<\/script>/);
if(!match)throw Error("LOCAL_SETUP_NOT_FOUND");
const config=JSON.parse(match[1]),started=Date.now();
try{
  const response=await fetch("https://coach.lovetalk.love/api/wechat/process",{
    method:"POST",headers:{"Content-Type":"application/json","X-Wechat-Queue-Token":config.WECHAT_CALLBACK_TOKEN},
    body:JSON.stringify({kind:"card-upload-diagnostic",page}),signal:AbortSignal.timeout(40000),
  });
  const data=await response.json().catch(()=>({status:"unreadable"}));
  console.log(JSON.stringify({httpStatus:response.status,roundTripMs:Date.now()-started,result:data}));
  if(!response.ok||data.status!=="ok")process.exitCode=1;
}catch{console.log(JSON.stringify({status:"probe_failed",syntheticOnly:true,elapsedMs:Date.now()-started}));process.exitCode=1;}
