// Read ONE explicitly scoped prototype test record; metadata only, no replies/models/storage.
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const messageId=process.argv[2];
if(!/^[A-Za-z0-9_-]{10,100}$/.test(messageId||""))throw Error("EXPLICIT_TEST_MESSAGE_REQUIRED");
const threshold=Date.now()-7200000;
const sql="SELECT COUNT(DISTINCT external_userid) n FROM coach_wechat_links; SELECT COUNT(DISTINCT external_userid) n FROM coach_wechat_inbox WHERE created_at>"+threshold+"; SELECT i.id,i.open_kfid,i.external_userid FROM coach_wechat_inbox i JOIN coach_wechat_links l ON l.external_userid=i.external_userid AND l.open_kfid=i.open_kfid JOIN coach_profiles p ON p.owner_id=l.owner_id WHERE p.consent_at>0 AND p.paused=0 AND i.id='"+messageId+"' AND i.created_at>"+threshold+";";
const result=JSON.parse(execFileSync(process.execPath,["node_modules/wrangler/bin/wrangler.js","d1","execute","goutoujunshi-coach","--remote","--config","wrangler.coach.jsonc","--json","--command",sql],{encoding:"utf8"}));
if(result[0].results[0].n!==1||result[1].results[0].n!==1||result[2].results.length!==1)throw Error("TEST_OWNER_SCOPE_NOT_UNIQUE");
const target=result[2].results[0];
const config=JSON.parse(readFileSync("outputs/wechat-callback-private.html","utf8").match(/<script[^>]*id="setup-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
const secret=readFileSync("outputs/wechat-secret-private.txt","utf8").match(/[A-Za-z0-9_-]{35,70}/)?.[0];
if(!secret)throw Error("LOCAL_WECHAT_CREDENTIAL_MISSING");
const tokenResponse=await fetch("https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid="+encodeURIComponent(config.WECHAT_CORP_ID)+"&corpsecret="+encodeURIComponent(secret),{signal:AbortSignal.timeout(15000)});
const token=await tokenResponse.json();if(!token.access_token)throw Error("WECHAT_AUTH_"+Number(token.errcode));
let cursor,source;
const deadline=AbortSignal.timeout(45000);
for(let page=0;page<10;page++){
  const response=await fetch("https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token="+encodeURIComponent(token.access_token),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cursor,open_kfid:target.open_kfid,voice_format:0,limit:100}),signal:AbortSignal.any([deadline,AbortSignal.timeout(15000)])});
  const data=await response.json();if(data.errcode!==0)throw Error("WECHAT_SYNC_"+Number(data.errcode));
  source=data.msg_list?.find(message=>message.msgid===messageId&&message.external_userid===target.external_userid&&message.open_kfid===target.open_kfid);
  if(source||!data.has_more||!data.next_cursor||data.next_cursor===cursor)break;
  cursor=data.next_cursor;
}
if(!source){console.log(JSON.stringify({found:false}));}
else{
  const items=source.merged_msg?.item||[],types={},paths=new Set();
  let placeholders=0,downloadable=0,malformed=0;
  function inspect(value,path,depth=0){
    if(!value||typeof value!=="object"||depth>8)return;
    for(const [key,child] of Object.entries(value)){
      if(!/^[A-Za-z0-9_]{1,50}$/.test(key))continue;
      const field=path+"."+key;paths.add(field);
      if(/^(?:media_id|url|download_url|audio_url)$/i.test(key)&&typeof child==="string"&&child.trim())downloadable++;
      inspect(child,field,depth+1);
    }
  }
  for(const item of items){
    const type=/^[a-z_]{1,30}$/.test(item.msgtype||"")?item.msgtype:"other";
    types[type]=(types[type]||0)+1;
    let content=item.msg_content;
    if(typeof content==="string"){try{content=JSON.parse(content);}catch{malformed++;continue;}}
    inspect(content,"msg_content");
    const text=content?.text?.content;
    if(typeof text==="string"&&/^(?:\[|【)语音(?:消息)?(?:\]|】)\s*\d*\s*(?:秒|["'″”’])?\s*$/u.test(text.trim()))placeholders++;
  }
  console.log(JSON.stringify({found:true,kind:source.msgtype,itemCount:items.length,types,voicePlaceholderCount:placeholders,nonemptyMediaOrUrlFields:downloadable,malformedContentCount:malformed,contentFieldPaths:[...paths].sort(),topLevelFields:Object.keys(source).filter(key=>/^[a-z_]{1,50}$/.test(key))}));
}
