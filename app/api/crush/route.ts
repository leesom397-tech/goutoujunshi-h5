import {getChatGPTUser} from "@/app/chatgpt-auth";
import {getD1} from "@/db";
import {wechatPublicConfig} from "@/lib/wechat";
import {replyAdvice} from "@/lib/crush/advice";
import {analyzeLines,classifierStatus,deleteCrush,enrichReportDistribution,getSettings,ownedReport} from "@/lib/crush/service";
import {CrushError} from "@/lib/crush/types";
import {qwenPublicError} from "@/lib/qwen";
export const runtime="edge";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
function failure(e:unknown){return json({error:e instanceof CrushError?e.message:qwenPublicError(e,"这次处理暂未完成，你的输入仍保留。")},e instanceof CrushError?e.status:503);}
export async function GET(request:Request){
  const user=await getChatGPTUser();if(!user)return json({error:"请先登录。"},401);
  try{
    const id=new URL(request.url).searchParams.get("id");
    if(id)return json(await ownedReport(user.userId,id));
    const s=await getSettings(user.userId);
    const reports=await getD1().prepare("SELECT r.id, r.created_at, r.thread_id, t.subject_id, s.label AS subject_label FROM coach_crush_reports r LEFT JOIN coach_crush_threads t ON t.id = r.thread_id AND t.owner_id = r.owner_id LEFT JOIN coach_subjects s ON s.id = t.subject_id AND s.owner_id = r.owner_id WHERE r.owner_id = ? AND r.status = 'done' ORDER BY r.created_at DESC LIMIT 10").bind(user.userId).all();
    return json({enabled:!!s?.consent_at,imageEnabled:!!(s?.consent_at&&s.image_consent_at),imageSelfSide:s?.image_self_side||"ask",quickJevEnabled:!!(s?.consent_at&&s.jev_consent_at),fullJevEnabled:!!(s?.consent_at&&s.jev_full_consent_at),affinityEnabled:!!(s?.consent_at&&s.jev_consent_at&&s.affinity_consent_at),provider:s?.provider||"qwen",...classifierStatus(),wechatConfigured:wechatPublicConfig().configured,reports:reports.results});
  }catch(e){return failure(e);}
}
export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return json({error:"请先登录后分析自己的聊天。"},401);
  if(!request.headers.get("content-type")?.includes("application/json"))return json({error:"格式不正确。"},415);
  if(Number(request.headers.get("content-length")||0)>60000)return json({error:"材料过长。"},413);
  let body:Record<string,unknown>;
  try{const raw=await request.text();if(raw.length>60000)return json({error:"材料过长。"},413);body=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=="object")throw Error();}
  catch{return json({error:"无法读取材料。"},400);}
  const owner=user.userId;
  try{
    if(body.action==="enableAll"){
      if(body.allowAll!==true||body.allowProfile!==true||body.selfSide!=="right"&&body.selfSide!=="left")throw new CrushError("请分别确认聊天分析、长期档案的授权范围和本人气泡位置。",403);
      if(!classifierStatus().jev)throw new CrushError("完整分类服务暂未接通，不能以全功能模式开启。",503);
      const now=Date.now();
      const db=getD1();
      await db.batch([
        db.prepare("INSERT INTO coach_profiles (owner_id, consent_at, paused, data, updated_at) VALUES (?, ?, 0, '{}', ?) ON CONFLICT(owner_id) DO UPDATE SET consent_at=excluded.consent_at, paused=0, updated_at=excluded.updated_at").bind(owner,now,now),
        db.prepare("INSERT INTO coach_crush_settings (owner_id, consent_at, jev_consent_at, jev_full_consent_at, affinity_consent_at, image_consent_at, image_self_side, provider, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'qwen', ?) ON CONFLICT(owner_id) DO UPDATE SET consent_at=excluded.consent_at, jev_consent_at=excluded.jev_consent_at, jev_full_consent_at=excluded.jev_full_consent_at, affinity_consent_at=excluded.affinity_consent_at, image_consent_at=excluded.image_consent_at, image_self_side=excluded.image_self_side, provider='qwen', updated_at=excluded.updated_at").bind(owner,now,now,now,now,now,body.selfSide,now),
      ]);
      return json({ok:true,enabled:true,profileEnabled:true,quickJevEnabled:true,fullJevEnabled:true,affinityEnabled:true,imageEnabled:true,imageSelfSide:body.selfSide});
    }
    if(body.action==="imageMapping"){
      const settings=await getSettings(owner);
      if(!settings?.consent_at)throw new CrushError("请先开启聊天解读。",403);
      const enabled=body.enabled===true,side=body.selfSide;
      if(enabled&&(body.allowImageProcessing!==true||!["right","left"].includes(String(side))))throw new CrushError("请单独同意图片发给阿里云百炼，并确认本人单聊截图哪侧是你。",403);
      const now=Date.now();
      await getD1().prepare("UPDATE coach_crush_settings SET image_consent_at=?,image_self_side=?,updated_at=? WHERE owner_id=? AND consent_at IS NOT NULL").bind(enabled?now:null,enabled?String(side):"ask",now,owner).run();
      if(!enabled)await getD1().prepare("UPDATE coach_crush_threads SET image_pending='{}',image_pending_expires_at=0 WHERE owner_id=?").bind(owner).run();
      return json({ok:true,imageEnabled:enabled,imageSelfSide:enabled?side:"ask"});
    }
    if(body.action==="settings"){
      if(body.enabled!==true)return json({error:"请选择开启或使用删除操作。"},400);
      const provider=body.provider==="jev"?"jev":"qwen";
      if(provider==="jev"&&(!classifierStatus().jev||body.allowJev!==true))throw new CrushError("第三方快判断尚未接通，或你还未确认允许它处理聊天文字。",403);
      const quickJev=body.quickJevConsent===true&&body.allowJev===true;
      if(quickJev&&!classifierStatus().jev)throw new CrushError("快判断服务暂未接通，请先使用千问文字解读。",503);
      const now=Date.now();
      await getD1().prepare("INSERT INTO coach_crush_settings (owner_id, consent_at, jev_consent_at, affinity_consent_at, provider, updated_at) VALUES (?, ?, ?, NULL, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET consent_at = excluded.consent_at, jev_consent_at = excluded.jev_consent_at, affinity_consent_at = NULL, provider = excluded.provider, updated_at = excluded.updated_at").bind(owner,now,provider==="jev"||quickJev?now:null,provider,now).run();
      return json({ok:true});
    }
    if(body.action==="quickJev"){
      const settings=await getSettings(owner);
      if(!settings?.consent_at)throw new CrushError("请先开启聊天解读。",403);
      const enabled=body.enabled===true;
      if(enabled&&(!classifierStatus().jev||body.allowJev!==true))throw new CrushError("第三方快判断尚未接通，或你还没有同意单独的数据处理说明。",403);
      const now=Date.now();
      await getD1().prepare("UPDATE coach_crush_settings SET jev_consent_at = ?, affinity_consent_at = CASE WHEN ? THEN affinity_consent_at ELSE NULL END, provider = 'qwen', updated_at = ? WHERE owner_id = ? AND consent_at IS NOT NULL").bind(enabled?now:null,enabled?1:0,now,owner).run();
      return json({ok:true,quickJevEnabled:enabled});
    }
    if(body.action==="fullJev"){
      const settings=await getSettings(owner);
      if(!settings?.consent_at)throw new CrushError("请先开启聊天解读。",403);
      const enabled=body.enabled===true;
      if(enabled&&(!classifierStatus().jev||body.allowJevFull!==true))throw new CrushError("请先确认完整分布的数据处理范围。",403);
      const now=Date.now();
      await getD1().prepare("UPDATE coach_crush_settings SET jev_full_consent_at=?,updated_at=? WHERE owner_id=? AND consent_at IS NOT NULL").bind(enabled?now:null,now,owner).run();
      return json({ok:true,fullJevEnabled:enabled});
    }
    if(body.action==="enrichDistribution"){
      if(typeof body.reportId!=="string")throw new CrushError("请选择本次报告。",400);
      return json(await enrichReportDistribution(owner,body.reportId));
    }
    if(body.action==="affinity"){
      const settings=await getSettings(owner);
      if(!settings?.consent_at||!settings.jev_consent_at)throw new CrushError("请先开启聊天解读和第三方快判断。",403);
      const enabled=body.enabled===true;
      if(enabled&&(!classifierStatus().jev||body.allowAffinity!==true))throw new CrushError("六维分析需要另行确认最多 40 条聊天文字的处理范围。",403);
      const now=Date.now();
      await getD1().prepare("UPDATE coach_crush_settings SET affinity_consent_at = ?, updated_at = ? WHERE owner_id = ? AND consent_at IS NOT NULL AND jev_consent_at IS NOT NULL").bind(enabled?now:null,now,owner).run();
      return json({ok:true,affinityEnabled:enabled});
    }
    if(body.action==="refreshAffinity"){
      if(typeof body.reportId!=="string")throw new CrushError("请选择本次报告。");
      const {refreshReportAffinity}=await import("@/lib/crush/service");
      return json(await refreshReportAffinity(owner,body.reportId));
    }
    if(body.action==="advice"){
      if(typeof body.reportId!=="string")throw new CrushError("请选择本次分析。");
      return json(await replyAdvice(owner,body.reportId,typeof body.question==="string"?body.question.trim().slice(0,500):undefined));
    }
    if(body.action!=="analyze"||typeof body.text!=="string"||typeof body.requestId!=="string"||!/^[a-f0-9-]{36}$/.test(body.requestId))throw new CrushError("请重新提交本次聊天。");
    if(body.subjectId!=null&&(typeof body.subjectId!=="string"||body.subjectId.length>100))throw new CrushError("对象无效。");
    if(body.selfLabel!=null&&(typeof body.selfLabel!=="string"||body.selfLabel.length>60))throw new CrushError("昵称过长。");
    if(body.sessionId!=null&&(typeof body.sessionId!=="string"||!/^[a-f0-9-]{36}$/.test(body.sessionId)))throw new CrushError("临时聊天无效。");
    if(body.threadId!=null&&(typeof body.threadId!=="string"||!/^[a-f0-9-]{36}$/.test(body.threadId)))throw new CrushError("聊天记录无效。");
    const subject=typeof body.subjectId==="string"?body.subjectId:null;
    const result=await analyzeLines(owner,body.text,{sourceKey:"web:"+body.requestId,channelKey:"web:"+(subject||(typeof body.sessionId==="string"?"temporary:"+body.sessionId:"default")),subjectId:subject,selfLabel:typeof body.selfLabel==="string"?body.selfLabel:"",plainSpeaker:body.speaker==="self"?"self":"other",threadId:typeof body.threadId==="string"?body.threadId:undefined});
    return json(result);
  }catch(e){return failure(e);}
}
export async function DELETE(){
  const user=await getChatGPTUser();if(!user)return json({error:"请先登录。"},401);
  try{
    await getD1().prepare("UPDATE coach_crush_settings SET consent_at = NULL, jev_consent_at = NULL, jev_full_consent_at = NULL, affinity_consent_at = NULL, image_consent_at=NULL, image_self_side='ask', updated_at = ? WHERE owner_id = ?").bind(Date.now(),user.userId).run();
    await deleteCrush(user.userId);return json({ok:true});
  }catch(e){return failure(e);}
}
