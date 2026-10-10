// Operator-only recovery: request the deployed worker to sync its saved cursor.
// No user IDs, credentials or message bodies are written to stdout.
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
if(process.argv[2]!=="--recover-pending")throw Error("EXPLICIT_RECOVERY_FLAG_REQUIRED");
const root=new URL("../",import.meta.url);
const html=readFileSync(new URL("outputs/wechat-callback-private.html",root),"utf8");
const match=html.match(/<script[^>]*id="setup-data"[^>]*>([\s\S]*?)<\/script>/);
if(!match)throw Error("PRIVATE_SETUP_MISSING");
const config=JSON.parse(match[1]);
if(!/^[A-Za-z0-9]{32}$/.test(config.WECHAT_CALLBACK_TOKEN||""))throw Error("PRIVATE_TOKEN_INVALID");
const raw=execFileSync(process.execPath,["node_modules/wrangler/bin/wrangler.js","d1","execute","goutoujunshi-coach","--remote","--config","wrangler.coach.jsonc","--json","--command","SELECT open_kfid FROM coach_wechat_cursors ORDER BY updated_at DESC LIMIT 1"],{cwd:root,encoding:"utf8",windowsHide:true,timeout:30000});
const openKfId=JSON.parse(raw)[0]?.results?.[0]?.open_kfid;
if(!openKfId)throw Error("NO_SAVED_CURSOR");
const response=await fetch("https://coach.lovetalk.love/api/wechat/process",{
  method:"POST",headers:{"Content-Type":"application/json","X-Wechat-Queue-Token":config.WECHAT_CALLBACK_TOKEN},
  body:JSON.stringify({kind:"pull",token:"",openKfId}),
  signal:AbortSignal.timeout(30000)
});
console.log(JSON.stringify({status:response.ok?"recovery_requested":"recovery_failed",httpStatus:response.status,secretPrinted:false,messagePrinted:false}));
if(!response.ok)process.exitCode=1;
