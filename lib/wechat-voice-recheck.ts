import {getD1} from "@/db";
import {syncMessages,type Incoming} from "./wechat";
import {transcribeWechatVoice,voiceErrorCode} from "./wechat-asr";

// Operator-only: exact registered test message, no cursor writes, replies or transcript output.
export async function recheckWechatVoice(messageId:string,configuredKfId:string){
  if(!/^[A-Za-z0-9_-]{10,100}$/.test(messageId))return {status:"invalid_message"};
  const db=getD1(),start=Date.now();
  const scope=await db.prepare("SELECT i.id,i.open_kfid,i.external_userid,l.owner_id,p.consent_at FROM coach_wechat_inbox i JOIN coach_wechat_links l ON l.external_userid=i.external_userid AND l.open_kfid=i.open_kfid JOIN coach_profiles p ON p.owner_id=l.owner_id WHERE i.id=? AND i.open_kfid=? AND i.created_at>? AND p.consent_at IS NOT NULL AND p.paused=0").bind(messageId,configuredKfId,start-7200000).first<{id:string;open_kfid:string;external_userid:string;owner_id:string;consent_at:number}>();
  if(!scope)return {status:"message_not_available"};
  const id="voice-recheck:"+Math.floor(start/60000);
  const slot=await db.prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,1,?)").bind(id,start+120000).run();
  if(!slot.meta.changes)return {status:"rate_limited"};
  let stage="readback";
  try{
    let cursor="",source:Incoming|undefined;
    for(let page=0;page<10;page++){
      const data=await syncMessages("",cursor,scope.open_kfid);
      source=data.msg_list?.find(message=>message.msgid===messageId&&message.open_kfid===scope.open_kfid&&message.external_userid===scope.external_userid);
      if(source||!data.has_more||!data.next_cursor||data.next_cursor===cursor)break;
      cursor=data.next_cursor;
      if(Date.now()-start>30000)break;
    }
    if(!source)return {status:"source_not_available",elapsedMs:Date.now()-start};
    if(source.msgtype!=="voice"||!source.voice?.media_id)return {status:"no_audio",kind:source.msgtype,elapsedMs:Date.now()-start};
    const allowed=await db.prepare("SELECT p.consent_at FROM coach_wechat_links l JOIN coach_profiles p ON p.owner_id=l.owner_id WHERE l.owner_id=? AND l.external_userid=? AND l.open_kfid=? AND p.paused=0").bind(scope.owner_id,scope.external_userid,scope.open_kfid).first<{consent_at:number}>();
    if(allowed?.consent_at!==scope.consent_at)return {status:"permission_changed"};
    stage="transcribe";
    const voiceStart=Date.now(),transcript=await transcribeWechatVoice(source.voice.media_id);
    return {status:"ok",elapsedMs:Date.now()-start,voiceElapsedMs:Date.now()-voiceStart,textLength:transcript.text.length,speakerCount:transcript.speakerCount};
  }catch(error){return {status:"failed",stage,elapsedMs:Date.now()-start,code:voiceErrorCode(error)};}
}
