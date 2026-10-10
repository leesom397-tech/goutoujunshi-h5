import {getD1} from "@/db";
import {sendWechatText,sendWechatImage,uploadWechatImage,WechatMediaUploadRejected,WechatSendUncertain,WechatSendRejected,type Incoming} from "@/lib/wechat";
import {ownedReport,requireSettings} from "./service";
import {CardRenderFailure,renderCard,renderCardsBatch} from "./card";
import {CrushError,type CrushResult} from "./types";
export function makeWechatReply(message:Incoming,owner:()=>string|null){
  let part=0;
  // Only this single inbound message can see these images. Never persist card
  // bytes, and recheck consent/report ownership before every upload and send.
  let renderedBatch:{reportId:string;pages:Uint8Array[]}|null=null;
  let batchAttempted=false;
  async function allowed(){
    const who=owner();if(!who)return true;
    const row=await getD1().prepare("SELECT p.consent_at, p.paused FROM coach_wechat_links l JOIN coach_profiles p ON p.owner_id = l.owner_id WHERE l.owner_id = ? AND l.external_userid = ? AND l.open_kfid = ?").bind(who,message.external_userid,message.open_kfid).first<{consent_at:number|null;paused:number}>();
    return !!row?.consent_at&&!row.paused;
  }
  async function deliver(payload:{type:"text";text:string;reportId?:string}|{type:"image";reportId:string;page:number}){
    if(++part>5)return false;
    const db=getD1(),id=message.msgid+":"+part,now=Date.now();
    if(!await allowed())return false;
    await db.prepare("INSERT OR IGNORE INTO coach_wechat_outbox (id, owner_id, open_kfid, external_userid, payload, status, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)").bind(id,owner(),message.open_kfid,message.external_userid,JSON.stringify(payload),now,now,now+7*86400000).run();
    const row=await db.prepare("SELECT status, payload FROM coach_wechat_outbox WHERE id = ?").bind(id).first<{status:string;payload:string}>();
    // A 'sending' row can have reached WeChat before a worker crash. Never auto-resend it.
    if(!row||row.status!=="pending")return row?.status==="sent";
    const saved=JSON.parse(row.payload) as typeof payload;
    let mediaId="",imageStage="load_report";
    if(saved.type==="image"){
      try{
        const who=owner();if(!who)return false;
        const settings=await requireSettings(who);
        const report=await ownedReport(who,saved.reportId);
        const subjectMatches=async()=>{
          const link=await db.prepare("SELECT subject_id FROM coach_wechat_links WHERE owner_id=? AND external_userid=? AND open_kfid=?").bind(who,message.external_userid,message.open_kfid).first<{subject_id:string|null}>();
          return !!link&&(link.subject_id||null)===(report.subjectId||null);
        };
        if(!await subjectMatches())throw Error("IMAGE_SCOPE_CHANGED");
        imageStage="render";
        let bytes:Uint8Array|undefined;
        if(saved.page===1&&report.lines.length>3&&!batchAttempted){
          batchAttempted=true;
          try{renderedBatch={reportId:report.id,pages:await renderCardsBatch(report)};}
          catch(error){console.warn("wechat_analysis_image_batch_fallback",{browserStatus:error instanceof CardRenderFailure?error.browserStatus:null});}
        }
        if(renderedBatch?.reportId===report.id)bytes=renderedBatch.pages[(saved.page||1)-1];
        if(!bytes){
          for(let attempt=0;attempt<3;attempt++){
            try{bytes=await renderCard(report,saved.page||1);break;}
            catch(error){
              // A failed session falls back to the existing single-page path.
              // No WeChat send has been claimed yet, so a render retry is safe.
              if(error instanceof CrushError&&error.status!==503)throw error;
              if(attempt===2)throw error;
              console.warn("wechat_analysis_image_render_retry",{browserStatus:error instanceof CardRenderFailure?error.browserStatus:null});
              await new Promise(resolve=>setTimeout(resolve,error instanceof CardRenderFailure&&error.browserStatus===429?1200*(attempt+1):350));
            }
          }
        }
        if(!bytes)throw Error("IMAGE_RENDER_EMPTY");
        if(!await allowed()||!await subjectMatches()||(await requireSettings(who)).updated_at!==settings.updated_at)throw Error("IMAGE_SCOPE_CHANGED");
        imageStage="upload";
        try{mediaId=await uploadWechatImage(bytes);}
        catch(error){
          // A media upload does not send to the customer. Retry only when the
          // outcome is transient; a definitive 4xx rejection is not helped.
          if(error instanceof WechatMediaUploadRejected&&error.httpStatus<500&&error.code!==-1)throw error;
          console.warn("wechat_analysis_image_upload_retry");
          mediaId=await uploadWechatImage(bytes);
        }
        imageStage="recheck";
        await ownedReport(who,saved.reportId);
        if(!await subjectMatches()||(await requireSettings(who)).updated_at!==settings.updated_at)throw Error("IMAGE_SCOPE_CHANGED");
      }catch(error){
        // Predefined stage only; never log chat content, media IDs, or error messages.
        const stage=imageStage==="render"&&error instanceof CardRenderFailure&&error.browserStatus===429?"render_429":imageStage;
        console.warn("wechat_analysis_image_failed",{stage});
        await db.prepare("UPDATE coach_wechat_outbox SET status = 'image_failed', payload = ?, updated_at = ? WHERE id = ? AND status = 'pending'").bind(JSON.stringify({stage}),Date.now(),id).run();
        return false; // Caller sends a readable text fallback with the authenticated report link.
      }
    }
    if(!await allowed())return false;
    if(saved.reportId){
      try{const who=owner();if(!who)return;await requireSettings(who);await ownedReport(who,saved.reportId);}
      catch{await db.prepare("UPDATE coach_wechat_outbox SET status = 'cancelled', payload = '{}' WHERE id = ? AND status = 'pending'").bind(id).run();return false;}
    }
    const claim=await db.prepare("UPDATE coach_wechat_outbox SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'pending'").bind(Date.now(),id).run();
    if(!claim.meta.changes)return false;
    try{
      if(saved.type==="text")await sendWechatText(message.external_userid,message.open_kfid,saved.text);
      else await sendWechatImage(message.external_userid,message.open_kfid,mediaId);
      await db.prepare("UPDATE coach_wechat_outbox SET status = 'sent', payload = '{}', updated_at = ? WHERE id = ? AND status = 'sending'").bind(Date.now(),id).run();
      return true;
    }catch(e){
      if(e instanceof WechatSendUncertain){
        await db.prepare("UPDATE coach_wechat_outbox SET status = 'unknown', payload = '{}', updated_at = ? WHERE id = ? AND status = 'sending'").bind(Date.now(),id).run();
        return false;
      }
      // Explicit API rejection will not succeed on an identical retry; do not block later inbox items.
      await db.prepare("UPDATE coach_wechat_outbox SET status = 'rejected', payload = ?, updated_at = ? WHERE id = ? AND status = 'sending'").bind(JSON.stringify(e instanceof WechatSendRejected?{errorCode:e.code,httpStatus:e.httpStatus}:{}),Date.now(),id).run();
      throw e;
    }
  }
  return {text:async(text:string,reportId?:string)=>{await deliver({type:"text",text,reportId});},image:(result:CrushResult,page=1)=>deliver({type:"image",reportId:result.id,page}),count:()=>part};
}
