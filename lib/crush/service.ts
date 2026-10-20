import {relationshipRiskReview} from "../relationship-risk";
import {personalizeReport} from "../personal-context-server";
import { getD1 } from "@/db";
import { clearSavedReports, PERMANENT_REPORT_EXPIRES_AT } from "@/lib/saved-reports.mjs";
import { recordRelationshipHistory } from "@/lib/relationship-history";
import { createHash } from "node:crypto";
import {assertReportSupplementCurrent,withReportSupplement,loadReportSupplement} from '../report-supplement.mjs';
import { parseChat, mergeChat } from "./parser";
import { classify, classifierStatus, RUBRIC_VERSION } from "./provider";
import {affinityJev} from "./affinity-jev";
import {jevFailure} from "./jev-client";
import {EVIDENCE_VERSION,readableChat,readableReport,unreadAnnotation,unreadMediaGuidance,unavailableMedia} from "./evidence";
import { CrushError, type ChatLine, type CrushResult, type Speaker, type LineAnnotation } from "./types";
export type CrushSettings = {consent_at:number|null;jev_consent_at:number|null;jev_full_consent_at:number|null;affinity_consent_at:number|null;image_consent_at?:number|null;image_self_side?:string;provider:"jev"|"qwen";updated_at:number};
export type Thread = {id:string;owner_id:string;subject_id:string|null;channel_key:string;data:string;self_label:string;draft:string;collecting:number;revision:number;lease_until:number;expires_at:number;voice_pending?:string;voice_pending_expires_at?:number;image_pending?:string;image_pending_expires_at?:number};
export type PreparedLines={model:string;lines:Array<{speaker:Speaker;text:string;annotation:Omit<LineAnnotation,"lineId">}>};
const retention=7*86400000;
export async function getSettings(owner:string) { return getD1().prepare("SELECT * FROM coach_crush_settings WHERE owner_id = ?").bind(owner).first<CrushSettings>(); }
export async function requireSettings(owner:string) {
  const settings=await getSettings(owner);
  if(!settings?.consent_at) throw new CrushError("请先在逐句分析页面开启聊天解读。",403);
  if(settings.provider==="jev" && !settings.jev_consent_at) throw new CrushError("请先确认允许第三方分类服务处理本次聊天文字。",403);
  return settings;
}
export async function getThread(owner:string,channelKey:string,subjectId:string|null=null):Promise<Thread> {
  const db=getD1(), now=Date.now();
  if(subjectId && !await db.prepare("SELECT id FROM coach_subjects WHERE id = ? AND owner_id = ?").bind(subjectId,owner).first()) throw new CrushError("这个对象不存在或已经删除。",404);
  await db.prepare("DELETE FROM coach_crush_threads WHERE owner_id = ? AND channel_key = ? AND expires_at <= ?").bind(owner,channelKey,now).run();
  await db.prepare("INSERT OR IGNORE INTO coach_crush_threads (id, owner_id, subject_id, channel_key, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(),owner,subjectId,channelKey,now,now+retention).run();
  const thread=await db.prepare("SELECT * FROM coach_crush_threads WHERE owner_id = ? AND channel_key = ? AND expires_at > ?").bind(owner,channelKey,now).first<Thread>();
  if(!thread)throw new CrushError("会话暂时无法建立。",503);
  return thread;
}
export async function reserveBudget(owner:string,mode:"deep"|"chat"="deep") {
  const db=getD1(),day=new Date().toISOString().slice(0,10),expires=Date.now()+2*86400000;
  const limits: Array<[string,number]>=mode==="chat"?[[owner+":chat:"+day,500],["global:chat:"+day,2000]]:[[owner+":"+day,30],["global:"+day,500]];
  for(const [id,limit] of limits) {
    await db.prepare("INSERT OR IGNORE INTO coach_crush_budget (id, uses, expires_at) VALUES (?, 0, ?)").bind(id,expires).run();
    const r=await db.prepare("UPDATE coach_crush_budget SET uses = uses + 1 WHERE id = ? AND uses < ?").bind(id,limit).run();
    if(!r.meta.changes)throw new CrushError(id.startsWith("global:")?"今天的分析服务较忙，请稍后再来。":mode==="chat"?"今天的对话量已达到当前试运行保护上限，请明天继续。":"今天的深度逐句分析已达到试运行上限，请明天继续。",429);
  }
}
function contextFor(all:ChatLine[],targets:ChatLine[]) {
  const first=all.findIndex(l=>l.id===targets[0].id),last=all.findIndex(l=>l.id===targets.at(-1)?.id);
  let lines=all.slice(Math.max(0,first-40),Math.min(all.length,last+3));
  while(lines.reduce((n,l)=>n+l.text.length,0)>12000 && lines[0]?.id!==targets[0].id)lines=lines.slice(1);
  return readableChat(lines);
}
export async function analyzeLines(owner:string,text:string,options:{sourceKey:string;channelKey:string;subjectId?:string|null;selfLabel?:string;plainSpeaker?:Speaker;threadId?:string;providerOverride?:"qwen";coverage?:CrushResult["coverage"];budgetMode?:"chat"|"deep";prepared?:PreparedLines;skipAffinity?:boolean;decision?:CrushResult["decision"];supplement?:Awaited<ReturnType<typeof loadReportSupplement>>}) {
  const db=getD1(),settings=await requireSettings(owner),now=Date.now();
  await assertReportSupplementCurrent(db,owner,options.supplement);
  const provider=options.providerOverride||settings.provider;
  const sourceKey=options.sourceKey.slice(0,160);
  const inputHash=createHash("sha256").update(JSON.stringify({text,subject:options.subjectId||null,self:options.selfLabel||"",speaker:options.plainSpeaker||"other",channel:options.channelKey,provider,rubric:RUBRIC_VERSION,...(options.supplement?{supplement:options.supplement.fingerprint}:{})})).digest("hex");
  const previous=await db.prepare("SELECT id, input_hash, status, result, updated_at FROM coach_crush_reports WHERE owner_id = ? AND source_key = ?").bind(owner,sourceKey).first<{id:string;input_hash:string;status:string;result:string;updated_at:number}>();
  if(previous) {
    if(previous.input_hash!==inputHash)throw new CrushError("材料或分析方式已改变，请重新提交本次分析。",409);
    if(previous.status==="done")return readableReport(JSON.parse(previous.result) as CrushResult);
    if(previous.status==="running" && now-previous.updated_at<330000)throw new CrushError("这段聊天正在分析，请稍后再查看。",409);
    await db.prepare("DELETE FROM coach_crush_reports WHERE id = ? AND owner_id = ? AND status != 'done'").bind(previous.id,owner).run();
  }
  const thread=options.threadId
    ? await db.prepare("SELECT * FROM coach_crush_threads WHERE id = ? AND owner_id = ? AND expires_at > ?").bind(options.threadId,owner,now).first<Thread>()
    : await getThread(owner,options.channelKey,options.subjectId||null);
  if(!thread)throw new CrushError("这段会话已清空或过期，请开启新聊天。",404);
  if(thread.subject_id!==(options.subjectId||null))throw new CrushError("请先选择这段记录对应的对象，或开启新聊天。",409);
  if(thread.subject_id&&!await db.prepare("SELECT id FROM coach_subjects WHERE id = ? AND owner_id = ?").bind(thread.subject_id,owner).first())throw new CrushError("对象已删除。",404);
  const incoming=parseChat(text,options.selfLabel ?? thread.self_label,options.plainSpeaker||"other");
  if(options.prepared&&(options.prepared.lines.length!==incoming.length||incoming.some((line,i)=>line.speaker!==options.prepared!.lines[i].speaker||line.text!==options.prepared!.lines[i].text)))throw new CrushError("截图结构与原文不一致，请重新发送清晰截图。",422);
  if(!readableChat(incoming).length)throw new CrushError(unreadMediaGuidance(incoming),400);
  const existing=JSON.parse(thread.data) as ChatLine[];
  const merged=mergeChat(existing,incoming);
  if(!merged.added.length) {
    const latest=await db.prepare("SELECT result FROM coach_crush_reports WHERE owner_id = ? AND thread_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1").bind(owner,thread.id).first<{result:string}>();
    if(latest){
      const saved=readableReport(JSON.parse(latest.result) as CrushResult);
      // A resend after deployment must not be stuck on a report whose score failed
      // in the old runtime. Reuse its annotations, refreshing only the opted-in signal.
      if(!options.skipAffinity&&settings.jev_consent_at&&settings.affinity_consent_at&&saved.affinityStatus!=="ready"){
        await reserveBudget(owner,"chat");
        try{saved.affinity=await affinityJev(readableChat(merged.all));saved.affinityStatus=saved.affinity?"ready":"insufficient";delete saved.affinityError;}
        catch(error){saved.affinity=null;saved.affinityStatus="unavailable";saved.affinityError=jevFailure(error);}
        saved.evidenceVersion=EVIDENCE_VERSION;
        const current=await requireSettings(owner);
        if(current.updated_at!==settings.updated_at)throw new CrushError("聊天处理授权已改变，本次评分已停止。",409);
        const update=await db.prepare("UPDATE coach_crush_reports SET result = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'done' AND EXISTS (SELECT 1 FROM coach_crush_threads WHERE id = ? AND owner_id = ? AND revision = ?)").bind(JSON.stringify(saved),Date.now(),saved.id,owner,thread.id,owner,thread.revision).run();
        if(!update.meta.changes)throw new CrushError("会话已清空或更新，请重新分析。",409);
      }
      return {...saved,...(options.decision?{decision:options.decision}:{}),duplicateCount:incoming.length};
    }
    throw new CrushError("这段记录没有新增内容。");
  }
  const revision=thread.revision+1,id=crypto.randomUUID();
  const lock=await db.prepare("UPDATE coach_crush_threads SET revision = ?, updated_at = ?, expires_at = ?, lease_until = ? WHERE id = ? AND owner_id = ? AND revision = ? AND lease_until < ?").bind(revision,now,now+retention,now+330000,thread.id,owner,thread.revision,now).run();
  if(!lock.meta.changes)throw new CrushError("这位对象的聊天正在分析，请等当前分析结束再追加。",409);
  try {
    await reserveBudget(owner,options.budgetMode||"deep");
    await db.prepare("INSERT INTO coach_crush_reports (id, owner_id, thread_id, source_key, input_hash, revision, status, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)").bind(id,owner,thread.id,sourceKey,inputHash,revision,now,now,now+retention).run();
    let affinityStatus:CrushResult["affinityStatus"]="disabled",affinityError:string|undefined;
    const affinityPending=!options.skipAffinity&&settings.jev_consent_at&&settings.affinity_consent_at?affinityJev(readableChat(merged.all)).then(signal=>{affinityStatus=signal?"ready":"insufficient";return signal;}).catch(error=>{affinityStatus="unavailable";affinityError=jevFailure(error);return null;}):Promise.resolve(null);
    const supported=readableChat(merged.added);
    const annotations:CrushResult["annotations"]=merged.added.filter(line=>unavailableMedia(line.text)).map(unreadAnnotation);
    let model="";
    if(options.prepared){
      model=options.prepared.model;
      for(const line of supported){const i=incoming.findIndex(item=>item.id===line.id);annotations.push({...options.prepared.lines[i].annotation,lineId:line.id});}
    }
    // Two bounded batches at a time, preserving order and waiting for both to settle
    // before releasing the lease. Avoid serial 20+20 second generation.
    for(let offset=0;!options.prepared&&offset<supported.length;offset+=32) {
      const batches=[supported.slice(offset,offset+16),supported.slice(offset+16,offset+32)].filter(batch=>batch.length);
      const settled=await Promise.allSettled(batches.map(async targets=>{
        const active=await requireSettings(owner);
        if(active.updated_at!==settings.updated_at)throw new CrushError("聊天处理设置已改变，本次分析已停止。",409);
        return classify(contextFor(merged.all,targets),targets,provider);
      }));
      const failed=settled.find(result=>result.status==="rejected");
      if(failed?.status==="rejected")throw failed.reason;
      for(const result of settled)if(result.status==="fulfilled"){annotations.push(...result.value.annotations);model=result.value.model;}
    }
    const affinity=await affinityPending;
    const current=await requireSettings(owner);
    if(current.updated_at!==settings.updated_at)throw new CrushError("聊天处理设置已改变，本次结果已停止保存。",409);
    if(!await db.prepare("SELECT id FROM coach_crush_threads WHERE id = ? AND owner_id = ? AND revision = ?").bind(thread.id,owner,revision).first()) throw new CrushError("会话已清空或更新，请重新分析。",409);
    const result:CrushResult={id,threadId:thread.id,subjectId:thread.subject_id,revision,provider,model,lines:merged.added,annotations,affinity,affinityStatus,affinityError,evidenceVersion:EVIDENCE_VERSION,decision:options.decision,readableLineCount:supported.length,unreadMediaCount:merged.added.length-supported.length,coverage:options.coverage,createdAt:now,expiresAt:PERMANENT_REPORT_EXPIRES_AT,latencyMs:Date.now()-now,duplicateCount:merged.duplicateCount};
    result.riskReview=relationshipRiskReview(result);
    result.personalConnection=await personalizeReport(owner,thread.subject_id,result);
    if(options.decision&&options.skipAffinity&&settings.jev_consent_at&&settings.affinity_consent_at)result.decision={...options.decision,affinityDeferred:true};
    Object.assign(result,withReportSupplement(result,options.supplement));
    await assertReportSupplementCurrent(db,owner,options.supplement);
    const parent=options.supplement;
    const results=await db.batch([
      db.prepare("UPDATE coach_crush_reports SET result = ?, status = 'done', updated_at = ?, expires_at = ? WHERE id = ? AND owner_id = ? AND status = 'running' AND (? IS NULL OR EXISTS (SELECT 1 FROM coach_saved_reports parent JOIN coach_subjects person ON person.id=parent.subject_id AND person.owner_id=parent.owner_id AND person.status='active' WHERE parent.id=? AND parent.owner_id=? AND parent.status='done' AND parent.subject_id=? AND parent.updated_at=?))").bind(JSON.stringify(result),Date.now(),PERMANENT_REPORT_EXPIRES_AT,id,owner,parent?.reportId||null,parent?.reportId||null,owner,parent?.subjectId||null,parent?.updatedAt||0),
      db.prepare("UPDATE coach_crush_threads SET data = ?, self_label = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM coach_crush_reports WHERE id = ? AND status = 'done')").bind(JSON.stringify(merged.all),options.selfLabel ?? thread.self_label,Date.now(),thread.id,owner,revision,id),
    ]);
    if(!results[0].meta.changes||!results[1].meta.changes)throw new CrushError("会话已删除，本次结果没有保存。",409);
    if (thread.subject_id) {
      try { await recordRelationshipHistory(owner, thread.subject_id, result); }
      catch { console.warn("relationship_history_save_failed", { reportId: id }); }
    }
    return result;
  } catch(error) {
    await db.prepare("UPDATE coach_crush_reports SET status = 'error', updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'running'").bind(Date.now(),id,owner).run();
    throw error;
  } finally {
    await db.prepare("UPDATE coach_crush_threads SET lease_until = 0 WHERE id = ? AND owner_id = ? AND revision = ?").bind(thread.id,owner,revision).run();
  }
}
export async function ownedReport(owner:string,id:string) {
  if(!/^[a-f0-9-]{36}$/.test(id))throw new CrushError("报告不存在。",404);
  const row=await getD1().prepare("SELECT r.result, t.subject_id, t.self_label FROM coach_crush_reports r LEFT JOIN coach_crush_threads t ON t.id = r.thread_id AND t.owner_id = r.owner_id WHERE r.id = ? AND r.owner_id = ? AND r.status = 'done'").bind(id,owner).first<{result:string;subject_id:string|null;self_label:string|null}>();
  if(!row)throw new CrushError("报告不存在或已删除。",404);
  const saved=JSON.parse(row.result);
  return readableReport({...saved,subjectId:row.subject_id||saved.subjectId||null,selfLabel:row.self_label||saved.selfLabel||"",expiresAt:PERMANENT_REPORT_EXPIRES_AT} as CrushResult);
}
// The one-time full-distribution consent is separate from the old six-message
// quick-look permission. Only readable text excerpts are sent to Jev; the
// original screenshot and relationship profile stay out of this request.
export async function enrichReportDistribution(owner:string,id:string){
  const settings=await requireSettings(owner);
  if(!settings.jev_full_consent_at)throw new CrushError("请先开启完整情绪与意图分布，并确认第三方处理范围。",403);
  if(!classifierStatus().jev)throw new CrushError("完整分类服务暂不可用，请稍后再试。",503);
  if(!/^[a-f0-9-]{36}$/.test(id))throw new CrushError("报告不存在。",404);
  const db=getD1(),now=Date.now();
  const row=await db.prepare("SELECT result FROM coach_crush_reports WHERE id=? AND owner_id=? AND status='done'").bind(id,owner).first<{result:string}>();
  if(!row)throw new CrushError("报告不存在、已删除或已过期。",404);
  const original=readableReport(JSON.parse(row.result) as CrushResult);
  if(original.provider==="jev")return original;
  const readable=readableChat(original.lines);
  if(!readable.length||readable.length>80)throw new CrushError("本报告可读文字需为 1–80 句；请分段分析。",400);
  await reserveBudget(owner,"chat");
  // Explicit allowlist: never forward timestamp, source metadata or future
  // ChatLine fields under the one-time authorization.
  const excerpt=original.lines.map(line=>({id:line.id,speaker:line.speaker,text:line.text.slice(0,160)}));
  const targets=readableChat(excerpt),interpreted:LineAnnotation[]=[];
  for(let start=0;start<targets.length;start+=16){
    const batches=[targets.slice(start,start+8),targets.slice(start+8,start+16)].filter(batch=>batch.length);
    const computed=await Promise.all(batches.map(batch=>classify(contextFor(excerpt,batch),batch,"jev")));
    for(const part of computed)interpreted.push(...part.annotations);
  }
  const active=await getSettings(owner);
  if(!active?.consent_at||active.jev_full_consent_at!==settings.jev_full_consent_at||active.updated_at!==settings.updated_at)throw new CrushError("完整分布授权已改变，本次结果未保存。",409);
  const byId=new Map(interpreted.map(annotation=>[annotation.lineId,annotation]));
  const prior=new Map(original.annotations.map(annotation=>[annotation.lineId,annotation]));
  const annotations=original.lines.map(line=>{
    const fresh=byId.get(line.id),old=prior.get(line.id);
    if(!fresh)return old||unreadAnnotation(line);
    const evidence:LineAnnotation["evidence"]=old?.evidence==="insufficient"||fresh.evidence==="insufficient"?"insufficient":old?.evidence==="limited"||fresh.evidence==="limited"?"limited":"sufficient";
    return {...fresh,evidence,note:old?.note&&old.evidence!=="insufficient"?old.note:fresh.note};
  });
  const updated:CrushResult={...original,provider:"jev",model:"jev-latest + "+original.model,annotations};
  const saved=await db.prepare("UPDATE coach_crush_reports SET result=?,updated_at=? WHERE id=? AND owner_id=? AND status='done' AND result=? AND EXISTS(SELECT 1 FROM coach_crush_settings WHERE owner_id=? AND consent_at IS NOT NULL AND jev_full_consent_at=?)").bind(JSON.stringify(updated),Date.now(),id,owner,row.result,owner,settings.jev_full_consent_at).run();
  if(!saved.meta.changes)throw new CrushError("报告或授权已更新，请重新打开后再试。",409);
  return updated;
}
export async function refreshReportAffinity(owner:string,id:string){
  const settings=await requireSettings(owner),result=await ownedReport(owner,id),db=getD1();
  if(!settings.jev_consent_at||!settings.affinity_consent_at)throw new CrushError("请先在微信设置里单独开启六维分析。",403);
  // Six-dimensional interaction signals use the opted-in seven-day chat,
  // independently of the optional long-term relationship profile.
  const thread=await db.prepare("SELECT data,revision,subject_id FROM coach_crush_threads WHERE id=? AND owner_id=? AND expires_at>?").bind(result.threadId,owner,Date.now()).first<{data:string;revision:number;subject_id:string|null}>();
  if(!thread||thread.revision!==result.revision)throw new CrushError("已有更新的聊天，请打开最新报告再计算六维图。",409);
  await reserveBudget(owner,"chat");
  try{result.affinity=await affinityJev(readableChat(JSON.parse(thread.data) as ChatLine[]));result.affinityStatus=result.affinity?"ready":"insufficient";delete result.affinityError;}
  catch(error){result.affinity=null;result.affinityStatus="unavailable";result.affinityError=jevFailure(error);}
  const current=await requireSettings(owner);
  if(current.updated_at!==settings.updated_at)throw new CrushError("分析授权已改变，本次评分停止保存。",409);
  if(result.decision)result.decision.affinityDeferred=false;
  const saved=await db.prepare("UPDATE coach_crush_reports SET result=?,updated_at=? WHERE id=? AND owner_id=? AND status='done' AND EXISTS(SELECT 1 FROM coach_crush_threads WHERE id=? AND owner_id=? AND revision=? AND subject_id IS ?) AND EXISTS(SELECT 1 FROM coach_crush_settings WHERE owner_id=? AND consent_at IS NOT NULL AND jev_consent_at IS NOT NULL AND affinity_consent_at IS NOT NULL)").bind(JSON.stringify(result),Date.now(),id,owner,result.threadId,owner,result.revision,thread.subject_id,owner).run();
  if(!saved.meta.changes)throw new CrushError("聊天已更新或删除，本次评分没有保存。",409);
  return result;
}
export async function deleteCrush(owner:string,subjectId?:string) {
  const db=getD1();
  await clearSavedReports(db,owner,subjectId);
  if(subjectId)return db.batch([
    db.prepare("DELETE FROM coach_crush_reports WHERE owner_id = ? AND (thread_id IN (SELECT id FROM coach_crush_threads WHERE owner_id = ? AND subject_id = ?) OR json_extract(CASE WHEN json_valid(result) THEN result ELSE '{}' END,'$.subjectId')=?)").bind(owner,owner,subjectId,subjectId),
    db.prepare("DELETE FROM coach_crush_threads WHERE owner_id = ? AND subject_id = ?").bind(owner,subjectId),
    db.prepare("UPDATE coach_wechat_outbox SET status = 'cancelled', payload = '{}' WHERE owner_id = ? AND status IN ('pending','sending')").bind(owner),
  ]);
  return db.batch([
    db.prepare("DELETE FROM coach_crush_reports WHERE owner_id = ?").bind(owner),
    db.prepare("DELETE FROM coach_crush_threads WHERE owner_id = ?").bind(owner),
    db.prepare("UPDATE coach_wechat_outbox SET status = 'cancelled', payload = '{}' WHERE owner_id = ? AND status IN ('pending','sending')").bind(owner),
  ]);
}
export async function cleanupCrush() {
  const db=getD1(),now=Date.now();
  await db.prepare("UPDATE coach_crush_threads SET advice_data=(SELECT json_group_array(json(value)) FROM json_each(coach_crush_threads.advice_data) WHERE json_extract(value,'$.receivedAt')>?) WHERE EXISTS (SELECT 1 FROM json_each(coach_crush_threads.advice_data) WHERE json_extract(value,'$.receivedAt')<=?)").bind(now-retention,now-retention).run();
  await db.prepare("UPDATE coach_crush_threads SET image_pending = '{}', image_pending_expires_at = 0 WHERE image_pending_expires_at > 0 AND image_pending_expires_at <= ?").bind(now).run();
  await db.prepare("UPDATE coach_crush_threads SET voice_pending = '{}', voice_pending_expires_at = 0 WHERE voice_pending_expires_at > 0 AND voice_pending_expires_at <= ?").bind(now).run();
  await db.prepare("UPDATE coach_crush_threads SET voice_pending = json_set(voice_pending, '$.entries', json((SELECT json_group_array(json(value)) FROM json_each(coach_crush_threads.voice_pending, '$.entries') WHERE json_extract(value, '$.expiresAt') > ?))) WHERE voice_pending_expires_at > ?").bind(now,now).run();
  await db.prepare("UPDATE coach_crush_threads SET data = (SELECT json_group_array(json(value)) FROM json_each(coach_crush_threads.data) WHERE COALESCE(json_extract(value,'$.receivedAt'),coach_crush_threads.updated_at) > ?) WHERE EXISTS (SELECT 1 FROM json_each(coach_crush_threads.data) WHERE COALESCE(json_extract(value,'$.receivedAt'),coach_crush_threads.updated_at) <= ?)").bind(now-retention,now-retention).run();
  await db.batch([
    db.prepare("DELETE FROM coach_crush_reports WHERE status != 'done' AND expires_at <= ?").bind(now),
    db.prepare("DELETE FROM coach_crush_threads WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM coach_crush_budget WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM coach_wechat_inbox WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM coach_wechat_outbox WHERE expires_at <= ?").bind(now),
  ]);
}
export {classifierStatus};
