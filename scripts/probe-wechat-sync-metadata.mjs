// Read-only operator probe. Never prints credentials, customer IDs or messages.
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
if(process.argv[2]!=="--metadata-only")throw Error("METADATA_ONLY_REQUIRED");
const root=new URL("../",import.meta.url);
const html=readFileSync(new URL("outputs/wechat-callback-private.html",root),"utf8");
const match=html.match(/<script[^>]*id="setup-data"[^>]*>([\s\S]*?)<\/script>/);
if(!match)throw Error("PRIVATE_SETUP_MISSING");
const config=JSON.parse(match[1]);
const secret=readFileSync(new URL("outputs/wechat-secret-private.txt",root),"utf8").match(/[A-Za-z0-9_-]{35,70}/)?.[0];
if(!secret)throw Error("PRIVATE_SECRET_MISSING");
const raw=execFileSync(process.execPath,["node_modules/wrangler/bin/wrangler.js","d1","execute","goutoujunshi-coach","--remote","--config","wrangler.coach.jsonc","--json","--command","SELECT open_kfid,cursor FROM coach_wechat_cursors ORDER BY updated_at DESC LIMIT 1"],{cwd:new URL("../",import.meta.url),encoding:"utf8",windowsHide:true,timeout:30000});
const row=JSON.parse(raw)[0]?.results?.[0];if(!row?.open_kfid)throw Error("NO_SAVED_CURSOR");
const auth=await fetch("https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid="+encodeURIComponent(config.WECHAT_CORP_ID)+"&corpsecret="+encodeURIComponent(secret),{signal:AbortSignal.timeout(15000)}).then(r=>r.json());
if(!auth.access_token)throw Error("WECHAT_AUTH_"+Number(auth.errcode));
const response=await fetch("https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token="+encodeURIComponent(auth.access_token),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cursor:row.cursor||undefined,open_kfid:row.open_kfid,voice_format:0,limit:100}),signal:AbortSignal.timeout(15000)});
const data=await response.json();
if(data.errcode!==0){console.log(JSON.stringify({status:"sync_error",code:Number(data.errcode)}));process.exitCode=1;}
else{
  const messages=(data.msg_list||[]).filter(m=>m.origin===3);
  const types=Object.fromEntries([...new Set(messages.map(m=>m.msgtype))].map(type=>[type,messages.filter(m=>m.msgtype===type).length]));
  console.log(JSON.stringify({status:"ok",newIncoming:messages.length,types,hasMore:!!data.has_more,cursorAdvanced:!!data.next_cursor&&data.next_cursor!==row.cursor,latestSendUtc:messages.length?new Date(Math.max(...messages.map(m=>(m.send_time||0)*1000))).toISOString():null,customerMessagesPrinted:0,databaseWrites:0}));
}
