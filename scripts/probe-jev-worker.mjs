// Uses an existing local operator credential in memory. No credential output.
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../outputs/wechat-callback-private.html",import.meta.url),"utf8");
const match=html.match(/<script[^>]*id="setup-data"[^>]*>([\s\S]*?)<\/script>/);
if(!match)throw Error("LOCAL_SETUP_NOT_FOUND");
const config=JSON.parse(match[1]);
const response=await fetch("https://coach.lovetalk.love/api/wechat/process",{method:"POST",headers:{"Content-Type":"application/json","X-Wechat-Queue-Token":config.WECHAT_CALLBACK_TOKEN},body:JSON.stringify({kind:process.argv[2]==="deep"?"analysis-diagnostic":process.argv[2]==="asr"?"asr-diagnostic":process.argv[2]==="realtime"?"realtime-diagnostic":"provider-diagnostic"}),signal:AbortSignal.timeout(40000)});
console.log(JSON.stringify({httpStatus:response.status,result:await response.json()}));
