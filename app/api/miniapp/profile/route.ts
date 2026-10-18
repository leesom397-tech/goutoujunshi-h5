import { relationshipMaterial, distinctRelationshipEvents, relationshipTrendPoints, latestRelationshipSignals } from "@/lib/relationship-timeline";
import { observedSignals } from "@/lib/relationship-history";
import { recoverProfileFields } from "@/lib/profile-fact-fields";
import { relationshipFit } from "@/lib/relationship-fit";
import { getD1 } from "@/db";
import { miniappOwner } from "@/lib/miniapp-auth";
import { deleteCrush } from "@/lib/crush/service";
import { cleanData, type SelfData } from "@/lib/profile";
import { cleanEditableProfilePatch, editableProfileDataSql } from "@/lib/profile-updates";
import { cleanManualSubject } from "@/lib/manual-subject";
import { cleanMomentsReport } from "@/lib/moments-report";
import { cleanCommunicationReading } from "@/lib/communication-reading";
import { interactionScore } from "@/lib/crush/interaction-score";
import { conversationEventMetadata, correctConversationEventDate, FeedbackError } from "@/lib/relationship-feedback";
import { projectPersonSavedAnalysis, savedFullHistorySignal } from "@/lib/person-saved-insights";
import { loadSubjectRelationshipContext } from "@/lib/relationship-context-server";
import { loadSelfArchiveMemory, correctSelfArchiveMemory, backfillSelfArchiveMemory } from "@/lib/self-archive-memory";
import { withCaptureHistoryPurge, CAPTURE_PURGE_UNAVAILABLE } from "@/lib/capture-history-purge";

export const runtime = "edge";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const label = (value: unknown) => typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 60 ? value.trim() : "";
const note = (value: unknown) => typeof value === "string" && value.trim().length <= 800 ? value.trim() : null;
const optionalNote = (value: unknown) => value == null ? "" : note(value);
const selfBasicLabels = { ageRange: "年龄", city: "常住地", education: "学历", occupation: "职业", relationshipStatus: "婚恋状态", childrenPlan: "婚育想法", lifestyle: "生活方式" } as const;
const selfBasicKeys = Object.keys(selfBasicLabels) as (keyof typeof selfBasicLabels)[];
const memoryProfileKeys = [...selfBasicKeys, "interests", "communicationStyle", "goals", "values", "boundaries", "preferredRelationship", "strengths"] as const;
const selfBasicKey = (field: string) => memoryProfileKeys.find(key => field === `selfBasic:${key}`);
const subjectBasicKey = (field: string) => [...memoryProfileKeys, "stage", "howMet"].find(key => field === "subjectBasic:" + key);
const safeProfileJson = "CASE WHEN json_valid(data) THEN CASE WHEN json_type(data)='object' THEN data ELSE '{}' END ELSE '{}' END";
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const fallbackDimensions = (report: Record<string, unknown>, base = 50) => {
  const lines = Array.isArray(report.lines) ? report.lines as Array<Record<string, unknown>> : [];
  const annotations = new Map((Array.isArray(report.annotations) ? report.annotations : []).map(item => [String((item as Record<string, unknown>)?.lineId || ""), item as Record<string, unknown>]));
  let questions = 0, replies = 0, invites = 0, boundaries = 0, otherLines = 0;
  for (const line of lines) {
    const text = typeof line.text === "string" ? line.text : "";
    const speaker = line.speaker === "other" ? "other" : line.speaker === "self" ? "self" : "";
    const annotation = annotations.get(String(line.id || ""));
    const key = Array.isArray(annotation?.intent) ? String((annotation.intent[0] as Record<string, unknown>)?.key || "") : "";
    if (speaker === "other") {
      otherLines++;
      if (/[？?]/.test(text) || ["ask", "clarify"].includes(key)) questions++;
      if (["invite", "invite_hint"].includes(key)) invites++;
      if (["refuse", "boundary"].includes(key)) boundaries++;
    }
    if (speaker === "self" && ["answer", "agree", "acknowledge", "continue"].includes(key)) replies++;
  }
  return [
    { label: "主动投入", value: clamp(base + questions * 8 + invites * 6) },
    { label: "回应承接", value: clamp(base + replies * 9) },
    { label: "沟通扩展", value: clamp(base + Math.min(otherLines, 5) * 5 + replies * 4) },
    { label: "邀约兑现", value: invites ? clamp(55 + invites * 10) : null },
    { label: "边界尊重", value: boundaries ? clamp(55 - boundaries * 15) : clamp(base + 15) },
    { label: "互惠稳定", value: clamp((base + questions * 5 + replies * 5 + (invites ? 10 : 0) - boundaries * 10)) }
  ];
};

async function state(owner: string,focusSubject?:string) {
  const db = getD1();
  const [profile, subjects, facts, savedReports] = await Promise.all([
    db.prepare("SELECT consent_at,paused,data FROM coach_profiles WHERE owner_id=?").bind(owner).first<{ consent_at: number | null; paused: number; data: string }>(),
    db.prepare("SELECT id,label,data,updated_at FROM coach_subjects WHERE owner_id=? AND status='active' ORDER BY updated_at DESC LIMIT 40").bind(owner).all<{ id: string; label: string; data: string; updated_at: number }>(),
    db.prepare("SELECT id,subject_id,field,value,source,evidence,status,event_meta FROM coach_facts WHERE owner_id=? AND (field IN ('recentEvent','profileClue','selfProfileClue') OR field LIKE 'selfBasic:%' OR field LIKE 'subjectBasic:%') AND status IN ('pending','accepted') ORDER BY created_at DESC LIMIT 200").bind(owner).all<{ id: string; subject_id: string | null; field: string; value: string; source: string; evidence: string; status: string; event_meta:string|null }>(),
    db.prepare("SELECT id,owner_id,subject_id,kind,status,result,summary,created_at FROM coach_saved_reports WHERE owner_id=? AND status='done' AND kind IN ('chat','moments','social') AND subject_id IS NOT NULL ORDER BY created_at DESC").bind(owner).all<{ id: string; owner_id: string; subject_id: string | null; kind: string; status: string; result: string | null; summary: string | null; created_at: number }>(),
  ]);
  const activeSources=profile?.consent_at&&!profile.paused?await db.prepare("SELECT id,epoch,subject_id FROM coach_capture_libraries WHERE owner_id=? AND deleted_at IS NULL").bind(owner).all<{id:string;epoch:number;subject_id:string|null}>():{results:[]};
  const visibleSavedReports=savedReports.results.filter(row=>{try{const value=JSON.parse(row.result||"{}"),snapshot=value.archiveSnapshot;return !snapshot||activeSources.results.some(source=>source.id===snapshot.libraryId&&source.epoch===snapshot.epoch&&source.subject_id===row.subject_id);}catch{return false;}});
  const signalRows = profile?.consent_at && !profile.paused ? await db.prepare(`
    SELECT subject_id, report_id, affinity, result, updated_at FROM (
      SELECT s.id AS subject_id, r.id AS report_id,
        CASE WHEN json_valid(r.result) THEN json_extract(r.result, '$.affinity') ELSE NULL END AS affinity,
        r.result,
        r.updated_at
      FROM coach_crush_reports r
      LEFT JOIN coach_crush_threads t ON t.id=r.thread_id AND t.owner_id=r.owner_id
      JOIN coach_subjects s ON s.id=COALESCE(t.subject_id,json_extract(CASE WHEN json_valid(r.result) THEN r.result ELSE '{}' END,'$.subjectId')) AND s.owner_id=r.owner_id AND s.status='active'
      WHERE r.owner_id=? AND r.status='done'
    ) AS signal_source ORDER BY updated_at ASC
  `).bind(owner).all<{ subject_id: string; report_id: string; affinity: string | null; result: string | null; updated_at: number }>() : null;
  const parsedSignals = (signalRows?.results || []).map(row => {
    let affinity: Record<string, unknown> = {};
    let report: Record<string, unknown> = {};
    try { report = row.result ? JSON.parse(row.result) as Record<string, unknown> : {}; } catch { /* Invalid report is not scored. */ }
    try {
      const embedded = row.affinity ? JSON.parse(row.affinity) : (report.affinity || (report.decision as Record<string, unknown> | undefined)?.affinityPreview);
      affinity = embedded && typeof embedded === "object" ? embedded as Record<string, unknown> : {};
    } catch { /* Invalid analysis is not scored. */ }
    let heuristic: { value: number; estimated: boolean } | null = null;
    if (typeof affinity.value !== "number" && report.lines && report.annotations) {
      try { heuristic = interactionScore(report as never); } catch { heuristic = null; }
    }
    const raw = typeof affinity.value === "number" ? affinity.value : heuristic?.value;
    const score = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? Math.round(raw) : null;
    const full = affinity.valueScope === "full" && score !== null;
    let dimensions = Array.isArray(affinity.dimensions) ? affinity.dimensions.slice(0, 6).map(item => {
      const value = item && typeof item === "object" && typeof (item as Record<string, unknown>).value === "number" && Number.isFinite((item as Record<string, unknown>).value) ? Math.max(0, Math.min(100, Math.round((item as Record<string, unknown>).value as number))) : null;
      const label = item && typeof item === "object" && typeof (item as Record<string, unknown>).label === "string" ? String((item as Record<string, unknown>).label).slice(0, 30) : "";
      return label ? { label, value } : null;
    }).filter(Boolean) : [];
    if (!dimensions.length && Array.isArray(report.lines)) dimensions = observedSignals(report as never).dimensions;
    const material = relationshipMaterial(Array.isArray(report.lines) ? report.lines : []);
    const decision = report.decision as Record<string, unknown> | undefined;
    return { ...material, subjectId: row.subject_id, reportId: row.report_id, signature: material.signature || row.report_id, score, comparable: full, estimated: !full,
      summary: typeof decision?.judgment === "string" ? decision.judgment : "", nextStep: typeof decision?.nextStep === "string" ? decision.nextStep : "",
      contextCount: typeof affinity.contextCount === "number" ? Math.max(0, Math.floor(affinity.contextCount)) : 0,
      dimensions, updatedAt: row.updated_at };
  });
  const persistentSignals = (profile?.consent_at&&!profile.paused?subjects.results.flatMap(subject => { try { const data = JSON.parse(subject.data); return Array.isArray(data.relationshipHistory) ? data.relationshipHistory.filter((point: Record<string, unknown>) => point.subjectId === subject.id) : []; } catch { return []; } }):[]) as typeof parsedSignals;
  const savedSignals=profile?.consent_at&&!profile.paused?visibleSavedReports.flatMap(row=>{const signal=savedFullHistorySignal(row,owner);return signal?[signal]:[];}):[];
  const allSignals=[...persistentSignals,...parsedSignals,...savedSignals];
  const distinctSignals = distinctRelationshipEvents(allSignals);
  const signals = latestRelationshipSignals(distinctSignals).map(({ evidenceWindows: _windows, ...signal }) => signal);
  const trends = Array.from(new Set(distinctSignals.map(item => item.subjectId))).map(subjectId => ({ subjectId, points: relationshipTrendPoints(allSignals.filter(item => item.subjectId === subjectId)) }));
  const contexts=new Map(await Promise.all(subjects.results.map(async item=>[item.id,profile?.consent_at&&!profile.paused?await loadSubjectRelationshipContext(owner,item.id,{includeActivity:item.id===focusSubject,db}):null] as const)));
  return {
    selfMemory: await loadSelfArchiveMemory(owner, db),
    enabled: !!profile?.consent_at,
    paused: !!profile?.paused,
    self: profile?.consent_at && !profile.paused ? (() => { try { return recoverProfileFields(JSON.parse(profile.data), facts.results, null) as SelfData; } catch { return {}; } })() : {},
    subjects: subjects.results.map(item => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(item.data) as Record<string, unknown>; } catch { /* Legacy invalid data is not shown. */ }
      data = recoverProfileFields(data, facts.results, item.id);
      const field = (key: string) => typeof data[key] === "string" ? data[key] as string : "";
      const own = (() => { try { return recoverProfileFields(JSON.parse(profile?.data || "{}"), facts.results, null); } catch { return {}; } })();
      const compatibility = relationshipFit(own, Object.fromEntries(selfBasicKeys.map(key => [key, field(key) || field("subjectBasic:" + key)])));
      return { relationshipContext:contexts.get(item.id)||null, avatar: field("avatar"), communicationReading: profile?.consent_at && !profile.paused ? cleanCommunicationReading(data.communicationReading) : null, momentsReport: profile?.consent_at && !profile.paused ? cleanMomentsReport(data.momentsReport) : null, savedAnalysis: profile?.consent_at && !profile.paused ? projectPersonSavedAnalysis(visibleSavedReports, item.id) : null, savedChatAnalysis: profile?.consent_at && !profile.paused ? projectPersonSavedAnalysis(visibleSavedReports, item.id, ["chat"]) : null, compatibility, id: item.id, label: item.label, notes: field("notes"), stage: field("stage"), howMet: field("howMet"), values: field("values"), boundaries: field("boundaries"), ageRange: (field("ageRange") || field("subjectBasic:ageRange")), city: (field("city") || field("subjectBasic:city")), education: (field("education") || field("subjectBasic:education")), occupation: (field("occupation") || field("subjectBasic:occupation")), relationshipStatus: (field("relationshipStatus") || field("subjectBasic:relationshipStatus")), childrenPlan: (field("childrenPlan") || field("subjectBasic:childrenPlan")), lifestyle: (field("lifestyle") || field("subjectBasic:lifestyle")), interests: field("interests"), strengths: field("strengths"), communicationStyle: field("communicationStyle"), goals: field("goals"), preferredRelationship: field("preferredRelationship"), updatedAt: item.updated_at };
    }),
    facts: facts.results.map(item => { const event=item.field==="recentEvent" ? conversationEventMetadata(item.event_meta) : null; return { id: item.id, subjectId: item.subject_id, kind: item.field, value: item.value, source: item.source, evidence: item.evidence, status: item.status === "accepted" ? "accepted" : "pending", eventTitle:event?.title||"", eventDate:event?.spokenDate||"" }; }),
    signals,
    signalHistory: profile?.consent_at && !profile.paused ? distinctSignals.slice(-80).map(item => ({
      subjectId: item.subjectId, reportId: item.reportId, dimensions: item.dimensions,
      score: item.score, estimated: item.estimated, updatedAt: item.updatedAt,
    })) : [],
    trends
  };
}

export async function GET(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  try { await backfillSelfArchiveMemory(identity.ownerId); } catch { console.warn("self_archive_memory_backfill_unavailable"); }
  return json(await state(identity.ownerId,new URL(request.url).searchParams.get("subjectId")||undefined));
}

export async function POST(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 160000) return json({ error: "资料过长。" }, 413);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "无法读取资料。" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || JSON.stringify(body).length > (body.action === "import-social" ? 48000 : body.action === "self" ? 6000 : 4000)) return json({ error: "资料过长或格式不正确。" }, 413);
  const owner = identity.ownerId, db = getD1(), now = Date.now();
  if (body.expectedOwnerId !== undefined && body.expectedOwnerId !== owner) {
    const account = typeof body.expectedOwnerId === "string" ? await db.prepare("SELECT public_id FROM coach_credit_accounts WHERE owner_id=?").bind(owner).first<{ public_id: string }>() : null;
    if (!account || body.expectedOwnerId !== account.public_id) return json({ error: "账号已变化，请刷新后再保存。" }, 409);
  }
  if (body.action === "correctSelfMemory" || body.action === "removeSelfMemory") {
    try { await correctSelfArchiveMemory(owner,body.memoryId,body.itemId,body.value,body.action === "removeSelfMemory",db); }
    catch(error) { return json({error:error instanceof Error ? error.message : "本人摘要暂时无法更新。"},400); }
  } else if (body.action === "consent") {
    if (body.enabled === true) {
      await db.prepare("INSERT INTO coach_profiles (owner_id,consent_at,paused,data,updated_at) VALUES (?,?,0,'{}',?) ON CONFLICT(owner_id) DO UPDATE SET consent_at=excluded.consent_at,paused=0,updated_at=excluded.updated_at").bind(owner,now,now).run();
    } else if (body.enabled === false) {
      await db.prepare("UPDATE coach_profiles SET consent_at=NULL,paused=1,updated_at=? WHERE owner_id=?").bind(now,owner).run();
    } else return json({ error: "请选择是否启用档案。" }, 400);
  } else if (body.action === "pause") {
    if (typeof body.paused !== "boolean") return json({ error: "暂停状态不正确。" }, 400);
    const result = await db.prepare("UPDATE coach_profiles SET paused=?,updated_at=? WHERE owner_id=? AND consent_at IS NOT NULL").bind(body.paused ? 1 : 0,now,owner).run();
    if (!result.meta.changes) return json({ error: "请先启用档案。" }, 403);
  } else if (body.action === "self") {
    const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{ consent_at: number | null; paused: number }>();
    if (!profile?.consent_at || profile.paused) return json({ error: "请先启用并恢复档案。" }, 403);
    let data: Record<string, unknown>;
    try { data = cleanEditableProfilePatch(body.data, "self"); } catch (error) { return json({ error: error instanceof Error ? error.message : "我的档案格式不正确。" }, 400); }
    await db.prepare(`UPDATE coach_profiles SET data=${editableProfileDataSql("self")},updated_at=? WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0`).bind(JSON.stringify(data),now,owner).run();
  } else if (body.action === "create-manual") {
    const name=label(body.label);
    if (!name || typeof body.id!=='string' || !idPattern.test(body.id) || body.confirmed!==true) return json({error:'请填写称呼并确认保存资料。'},400);
    let data: Record<string,string>;
    try { data=cleanManualSubject(body.data); } catch(error) { return json({error:error instanceof Error?error.message:'资料无效。'},400); }
    const profile=await db.prepare('SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?').bind(owner).first<{consent_at:number|null;paused:number}>();
    if(!profile?.consent_at || profile.paused) return json({error:'请先启用并恢复档案。'},403);
    const existing=await db.prepare('SELECT label,data,status FROM coach_subjects WHERE id=? AND owner_id=?').bind(body.id,owner).first<{label:string;data:string;status:string}>();
    const encoded=JSON.stringify(data);
    if(existing) {
      if(existing.status!=='active' || existing.label!==name || existing.data!==encoded) return json({error:'这次建档已处理，请返回人物列表核对后再编辑。'},409);
    } else {
      const count=await db.prepare('SELECT COUNT(*) AS n FROM coach_subjects WHERE owner_id=?').bind(owner).first<{n:number}>();
      if((count?.n||0)>=40) return json({error:'人物已达到上限，请先整理旧档案。'},409);
      await db.prepare("INSERT INTO coach_subjects (id,owner_id,label,status,data,created_at,updated_at) VALUES (?,?,?,'active',?,?,?)").bind(body.id,owner,name,encoded,now,now).run();
    }
    return json({createdSubjectId:body.id});
  } else if (body.action === "create") {
    const name = label(body.label);
    if (!name) return json({ error: "请填写对象代号或称呼，最多 60 字。" }, 400);
    const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{ consent_at: number | null; paused: number }>();
    if (!profile?.consent_at || profile.paused) return json({ error: "请先启用并恢复档案。" }, 403);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM coach_subjects WHERE owner_id=?").bind(owner).first<{ n: number }>();
    if ((count?.n || 0) >= 40) return json({ error: "对象已达到上限，请先整理旧档案。" }, 409);
    await db.prepare("INSERT INTO coach_subjects (id,owner_id,label,status,data,created_at,updated_at) VALUES (?,?,?,'active','{}',?,?)").bind(crypto.randomUUID(),owner,name,now,now).run();
  } else if (body.action === "save") {
    if (typeof body.id !== "string" || !idPattern.test(body.id)) return json({ error: "对象无效。" }, 400);
    const name = label(body.label), notes = optionalNote(body.notes), stage = optionalNote(body.stage), howMet = optionalNote(body.howMet), values = optionalNote(body.values), boundaries = optionalNote(body.boundaries);
    if (!name || [notes,stage,howMet,values,boundaries].some(value => value === null)) return json({ error: "称呼或档案字段格式不正确；每项最多 800 字。" }, 400);
    const basicChanges: Record<string, string> = {};
    for (const key of selfBasicKeys) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      if (typeof body[key] !== "string" || (body[key] as string).trim().length > 100) return json({ error: "基础资料每项最多 100 字。" }, 400);
      basicChanges[key] = (body[key] as string).trim();
    }
    const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{ consent_at: number | null; paused: number }>();
    if (!profile?.consent_at || profile.paused) return json({ error: "请先启用并恢复档案。" }, 403);
    const row = await db.prepare("SELECT data FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(body.id,owner).first<{ data: string }>();
    if (!row) return json({ error: "没有找到这个对象。" }, 404);
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(row.data) as Record<string, unknown>; } catch { /* Replace invalid legacy data. */ }
    const result = await db.prepare("UPDATE coach_subjects SET label=?,data=?,updated_at=? WHERE id=? AND owner_id=? AND status='active'").bind(name,JSON.stringify({ ...data, ...basicChanges, notes, stage, howMet, values, boundaries }),now,body.id,owner).run();
    if (!result.meta.changes) return json({ error: "没有找到这个对象。" }, 404);
  } else if (body.action === "event-date") {
    if(typeof body.id!=="string" || !idPattern.test(body.id) || body.confirmed!==true) return json({error:"请确认需要纠正的事件。"},400);
    const consent=await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{consent_at:number|null;paused:number}>();
    if(!consent?.consent_at || consent.paused) return json({error:"请先启用并恢复档案。"},403);
    const fact=await db.prepare("SELECT event_meta FROM coach_facts WHERE id=? AND owner_id=? AND field='recentEvent' AND status IN ('pending','accepted') AND EXISTS (SELECT 1 FROM coach_subjects s WHERE s.id=coach_facts.subject_id AND s.owner_id=coach_facts.owner_id AND s.status='active')").bind(body.id,owner).first<{event_meta:string|null}>();
    if(!fact) return json({error:"没有找到可修改的事件。"},404);
    let updated:string;
    try { updated=correctConversationEventDate(fact.event_meta||"",{id:body.requestId,date:body.eventDate,expectedDate:body.expectedDate},now); }
    catch(error) { if(error instanceof FeedbackError) return json({error:error.message},error.status); throw error; }
    if(updated!==fact.event_meta) {
      const result=await db.prepare("UPDATE coach_facts SET event_meta=? WHERE id=? AND owner_id=? AND event_meta=? AND status IN ('pending','accepted') AND EXISTS (SELECT 1 FROM coach_profiles WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0) AND EXISTS (SELECT 1 FROM coach_subjects s WHERE s.id=coach_facts.subject_id AND s.owner_id=coach_facts.owner_id AND s.status='active')").bind(updated,body.id,owner,fact.event_meta,owner).run();
      if(!result.meta.changes) return json({error:"事件已更新或档案状态变化，请刷新后再试。"},409);
    }
  } else if (body.action === "fact-decide-many") {
    const consent = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{ consent_at: number | null; paused: number }>();
    if (!consent?.consent_at || consent.paused) return json({ error: "请先启用并恢复档案。" }, 403);
    if (body.decision !== "accept" || !Array.isArray(body.ids)) return json({ error: "批量确认参数不正确。" }, 400);
    const ids = body.ids.filter((id): id is string => typeof id === "string" && idPattern.test(id)).slice(0, 80);
    if (!ids.length) return json({ error: "没有可确认的线索。" }, 400);
    const placeholders = ids.map(() => "?").join(",");
    const pending = await db.prepare(`SELECT id,subject_id,field,value FROM coach_facts WHERE owner_id=? AND status='pending' AND id IN (${placeholders}) AND (field IN ('recentEvent','profileClue','selfProfileClue') OR field LIKE 'selfBasic:%' OR field LIKE 'subjectBasic:%')`).bind(owner, ...ids).all<{ id: string; subject_id: string | null; field: string; value: string }>();
    const statements = pending.results.map(fact => {
      const basicKey = fact.subject_id === null ? selfBasicKey(fact.field) : subjectBasicKey(fact.field);
      const list = [db.prepare("UPDATE coach_facts SET status='accepted' WHERE id=? AND owner_id=? AND status='pending' AND EXISTS (SELECT 1 FROM coach_profiles p WHERE p.owner_id=coach_facts.owner_id AND p.consent_at IS NOT NULL AND p.paused=0) AND (subject_id IS NULL OR EXISTS (SELECT 1 FROM coach_subjects s WHERE s.id=coach_facts.subject_id AND s.owner_id=coach_facts.owner_id AND s.status='active'))").bind(fact.id, owner)];
      if (basicKey && fact.subject_id === null) list.push(db.prepare(`UPDATE coach_profiles SET data=json_set(${safeProfileJson}, '$.${basicKey}', ?),updated_at=? WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0 AND json_type(${safeProfileJson}, '$.${basicKey}') IS NULL AND EXISTS (SELECT 1 FROM coach_facts f WHERE f.id=? AND f.owner_id=? AND f.status='accepted')`).bind(fact.value, now, owner, fact.id, owner));
      if (basicKey && fact.subject_id !== null) list.push(db.prepare(`UPDATE coach_subjects SET data=json_set(CASE WHEN json_valid(data) AND json_type(data)='object' THEN data ELSE '{}' END, '$.${basicKey}', ?),updated_at=? WHERE id=? AND owner_id=? AND status='active' AND json_type(CASE WHEN json_valid(data) AND json_type(data)='object' THEN data ELSE '{}' END, '$.${basicKey}') IS NULL AND EXISTS (SELECT 1 FROM coach_profiles p WHERE p.owner_id=? AND p.consent_at IS NOT NULL AND p.paused=0) AND EXISTS (SELECT 1 FROM coach_facts f WHERE f.id=? AND f.owner_id=? AND f.status='accepted')`).bind(fact.value, now, fact.subject_id, owner, owner, fact.id, owner));
      return list;
    }).flat();
    if (statements.length) await db.batch(statements);
  } else if (body.action === "fact-decide") {
    if (typeof body.id !== "string" || !idPattern.test(body.id) || !["accept", "reject"].includes(String(body.decision))) return json({ error: "确认操作无效。" }, 400);
    const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{ consent_at: number | null; paused: number }>();
    if (!profile?.consent_at || profile.paused) return json({ error: "请先启用并恢复档案。" }, 403);
    const fact = await db.prepare("SELECT id,subject_id,field,value FROM coach_facts WHERE id=? AND owner_id=? AND (field IN ('recentEvent','profileClue','selfProfileClue') OR field LIKE 'selfBasic:%' OR field LIKE 'subjectBasic:%') AND status='pending'").bind(body.id,owner).first<{ id: string; subject_id: string | null; field: string; value: string }>();
    if (!fact) return json({ error: "这条线索已处理或不存在。" }, 404);
    if (fact.subject_id && !await db.prepare("SELECT id FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(fact.subject_id,owner).first()) return json({ error: "关联对象已删除。" }, 404);
    const basicKey = fact.subject_id === null ? selfBasicKey(fact.field) : subjectBasicKey(fact.field);
    const result = body.decision === "accept"
      ? (await db.batch([
        db.prepare("UPDATE coach_facts SET status='accepted' WHERE id=? AND owner_id=? AND status='pending' AND EXISTS (SELECT 1 FROM coach_profiles p WHERE p.owner_id=coach_facts.owner_id AND p.consent_at IS NOT NULL AND p.paused=0) AND (subject_id IS NULL OR EXISTS (SELECT 1 FROM coach_subjects s WHERE s.id=coach_facts.subject_id AND s.owner_id=coach_facts.owner_id AND s.status='active'))").bind(fact.id,owner),
        ...(basicKey && fact.subject_id === null ? [db.prepare(`UPDATE coach_profiles SET data=json_set(${safeProfileJson}, '$.${basicKey}', ?),updated_at=? WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0 AND json_type(${safeProfileJson}, '$.${basicKey}') IS NULL AND EXISTS (SELECT 1 FROM coach_facts f WHERE f.id=? AND f.owner_id=? AND f.status='accepted')`).bind(fact.value,now,owner,fact.id,owner)] : []),
        ...(basicKey && fact.subject_id !== null ? [db.prepare(`UPDATE coach_subjects SET data=json_set(CASE WHEN json_valid(data) AND json_type(data)='object' THEN data ELSE '{}' END, '$.${basicKey}', ?),updated_at=? WHERE id=? AND owner_id=? AND status='active' AND json_type(CASE WHEN json_valid(data) AND json_type(data)='object' THEN data ELSE '{}' END, '$.${basicKey}') IS NULL AND EXISTS (SELECT 1 FROM coach_profiles p WHERE p.owner_id=? AND p.consent_at IS NOT NULL AND p.paused=0) AND EXISTS (SELECT 1 FROM coach_facts f WHERE f.id=? AND f.owner_id=? AND f.status='accepted')`).bind(fact.value,now,fact.subject_id,owner,owner,fact.id,owner)] : []),
      ]))[0]
      : await db.prepare("DELETE FROM coach_facts WHERE id=? AND owner_id=? AND status='pending'").bind(fact.id,owner).run();
    if (!result.meta.changes) return json({ error: "这条线索已处理或不存在。" }, 404);
  } else if (body.action === "self-memory") {
    if (body.confirmed !== true || typeof body.text !== "string" || !body.text.trim() || body.text.length > 500) return json({error:"请确认内容属于你本人，且不超过 500 字。"},400);
    const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{ consent_at: number | null; paused: number }>();
    if (!profile?.consent_at || profile.paused) return json({error:"请先启用并恢复我的档案。"},403);
    const value = body.text.trim(), evidence = typeof body.evidence === "string" ? body.evidence.trim().slice(0,100) : "用户手动粘贴";
    const count = await db.prepare("SELECT COUNT(*) AS n FROM coach_facts WHERE owner_id=?").bind(owner).first<{n:number}>();
    if ((count?.n || 0) >= 200) return json({error:"记忆条目已达上限，请先整理档案。"},409);
    await db.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,confidence,status,created_at) SELECT ?,?,NULL,'selfProfileClue',?,'本人资料／待核对',?,'medium','pending',? WHERE NOT EXISTS (SELECT 1 FROM coach_facts WHERE owner_id=? AND subject_id IS NULL AND field='selfProfileClue' AND value=?)").bind(crypto.randomUUID(),owner,value,evidence,now,owner,value).run();
  } else if (body.action === "fact-delete") {
    if (typeof body.id !== "string" || !idPattern.test(body.id)) return json({error:"线索无效。"},400);
    const fact = await db.prepare("SELECT field,value,subject_id,status FROM coach_facts WHERE id=? AND owner_id=? AND (field IN ('recentEvent','profileClue','selfProfileClue') OR field LIKE 'selfBasic:%' OR field LIKE 'subjectBasic:%')").bind(body.id,owner).first<{field:string;value:string;subject_id:string|null;status:string}>();
    if (!fact) return json({error:"线索不存在。"},404);
    const basicKey = fact.subject_id === null ? selfBasicKey(fact.field) : subjectBasicKey(fact.field);
    const statements = [db.prepare("DELETE FROM coach_facts WHERE id=? AND owner_id=?").bind(body.id,owner)];
    if (basicKey && fact.status === "accepted" && fact.subject_id === null) statements.push(db.prepare(`UPDATE coach_profiles SET data=json_remove(${safeProfileJson}, '$.${basicKey}'),updated_at=? WHERE owner_id=? AND json_extract(${safeProfileJson}, '$.${basicKey}')=?`).bind(now,owner,fact.value));
    if (basicKey && fact.status === "accepted" && fact.subject_id !== null) statements.push(db.prepare(`UPDATE coach_subjects SET data=json_remove(CASE WHEN json_valid(data) AND json_type(data)='object' THEN data ELSE '{}' END, '$.${basicKey}'),updated_at=? WHERE id=? AND owner_id=? AND json_extract(CASE WHEN json_valid(data) AND json_type(data)='object' THEN data ELSE '{}' END, '$.${basicKey}')=?`).bind(now,fact.subject_id,owner,fact.value));
    await db.batch(statements);
  } else if (body.action === "import-social") {
    const targetSelf = body.target === "self";
    if (body.confirmed !== true || !targetSelf && (typeof body.subjectId !== "string" || !idPattern.test(body.subjectId))) return json({ error: "请先选择归档对象并确认范围。" }, 400);
    const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{ consent_at: number | null; paused: number }>();
    if (!profile?.consent_at || profile.paused) return json({ error: "请先启用并恢复档案。" }, 403);
    if (!targetSelf && !await db.prepare("SELECT id FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(body.subjectId,owner).first()) return json({ error: "没有找到这个对象。" }, 404);
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 8) : [];
    const basicRows = Array.isArray(body.basics) ? body.basics.slice(0, 11) : [];
    const seenBasics = new Set<string>();
    for (const item of basicRows) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const field = typeof row.field === "string" && [...selfBasicKeys, ...(!targetSelf ? ["stage", "howMet", "values", "boundaries"] : [])].includes(row.field) ? row.field : "";
      const value = typeof row.value === "string" ? row.value.trim().slice(0, 100) : "";
      const evidence = typeof row.evidence === "string" ? row.evidence.trim().slice(0, 180) : "";
      if (!field || !value || !evidence || seenBasics.has(field)) continue;
      seenBasics.add(field);
      const count = await db.prepare("SELECT COUNT(*) AS n FROM coach_facts WHERE owner_id=?").bind(owner).first<{n:number}>();
      if ((count?.n || 0) >= 200) return json({error:"记忆条目已达上限，请先整理档案。"},409);
      const subjectId = targetSelf ? null : body.subjectId as string;
      const factField = `${targetSelf ? "selfBasic" : "subjectBasic"}:${field}`;
      await db.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,confidence,status,created_at) SELECT ?,?,?,?,?,?,?, 'low','pending',? WHERE NOT EXISTS (SELECT 1 FROM coach_facts WHERE owner_id=? AND subject_id IS ? AND field=? AND value=? AND evidence=?)").bind(crypto.randomUUID(),owner,subjectId,factField,value,`${targetSelf ? "本人" : "对象"}资料截图／${selfBasicLabels[field as keyof typeof selfBasicLabels]}待确认`,evidence,now,owner,subjectId,factField,value,evidence).run();
    }
    for (const item of candidates) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string,unknown>;
      const title = typeof row.title === "string" ? row.title.trim().slice(0, 50) : "";
      const evidence = typeof row.evidence === "string" ? row.evidence.trim().slice(0, 180) : "";
      if (!title || !evidence) continue;
      const count = await db.prepare("SELECT COUNT(*) AS n FROM coach_facts WHERE owner_id=?").bind(owner).first<{n:number}>();
      if ((count?.n || 0) >= 200) break;
      await db.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,confidence,status,created_at) SELECT ?,?,?,?,?,? ,?,'low','pending',? WHERE NOT EXISTS (SELECT 1 FROM coach_facts WHERE owner_id=? AND subject_id IS ? AND field=? AND value=? AND evidence=?)").bind(crypto.randomUUID(),owner,targetSelf?null:body.subjectId,targetSelf?"selfProfileClue":"profileClue",title,targetSelf?"本人社交资料截图／待核对":"对方社交资料截图／待核对",evidence,now,owner,targetSelf?null:body.subjectId,targetSelf?"selfProfileClue":"profileClue",title,evidence).run();
    }
    const reading = !targetSelf ? cleanCommunicationReading(body.communicationReading || body.momentsReport) : null;
    if(reading) await db.prepare(`UPDATE coach_subjects SET data=json_set(${safeProfileJson}, '$.communicationReading', json(?)),updated_at=? WHERE owner_id=? AND id=? AND status='active'`).bind(JSON.stringify(reading),now,owner,body.subjectId).run();
    const moments = cleanMomentsReport(body.momentsReport);
    if (moments) {
      // Separate observation report: never promoted into confirmed personal facts.
      const table = targetSelf ? "coach_profiles" : "coach_subjects";
      const where = targetSelf ? "owner_id=? AND consent_at IS NOT NULL AND paused=0" : "owner_id=? AND id=? AND status='active'";
      await db.prepare(`UPDATE ${table} SET data=json_set(${safeProfileJson}, '$.momentsReport', json(?)),updated_at=? WHERE ${where}`).bind(JSON.stringify(moments),now,owner,...(targetSelf?[]:[body.subjectId])).run();
    }
  } else if (body.action === "delete-reading") {
    if(typeof body.subjectId !== "string" || !idPattern.test(body.subjectId)) return json({error:"人物无效。"},400);
    await db.prepare(`UPDATE coach_subjects SET data=json_remove(${safeProfileJson}, '$.communicationReading'),updated_at=? WHERE owner_id=? AND id=?`).bind(now,owner,body.subjectId).run();
  } else if (body.action === "delete-moments") {
    const self = body.target === "self";
    if (!self && (typeof body.subjectId !== "string" || !idPattern.test(body.subjectId))) return json({error:"人物编号无效。"},400);
    await db.prepare(`UPDATE ${self ? "coach_profiles" : "coach_subjects"} SET data=json_remove(${safeProfileJson}, '$.momentsReport', '$.communicationReading'),updated_at=? WHERE owner_id=?${self ? "" : " AND id=?"}`).bind(now,owner,...(self?[]:[body.subjectId])).run();
  } else if (body.action === "delete") {
    if (typeof body.id !== "string" || !idPattern.test(body.id)) return json({ error: "对象无效。" }, 400);
    const row = await db.prepare("SELECT id FROM coach_subjects WHERE id=? AND owner_id=?").bind(body.id,owner).first();
    const deleted = !row && await db.prepare("SELECT id FROM coach_saved_reports WHERE owner_id=? AND subject_id=? AND status='deleted' LIMIT 1").bind(owner,body.id).first();
    if (!row && !deleted) return json({ error: "没有找到这个对象。" }, 404);
    try { await withCaptureHistoryPurge(owner,async()=>{
    await deleteCrush(owner,body.id as string);
    await db.batch([
      db.prepare("UPDATE coach_wechat_links SET subject_id=NULL WHERE subject_id=? AND owner_id=?").bind(body.id,owner),
      db.prepare("DELETE FROM coach_facts WHERE subject_id=? AND owner_id=?").bind(body.id,owner),
      db.prepare("DELETE FROM coach_subjects WHERE id=? AND owner_id=?").bind(body.id,owner),
    ]);
    }); } catch(error) { if(error instanceof Error&&error.message===CAPTURE_PURGE_UNAVAILABLE)return json({error:CAPTURE_PURGE_UNAVAILABLE},503);throw error; }
  } else if (body.action === "wipe") {
    if (body.confirm !== "DELETE_MY_ARCHIVE") return json({ error: "请确认删除范围。" }, 400);
    try { await withCaptureHistoryPurge(owner,async()=>{
    await deleteCrush(owner);
    await db.batch([
      db.prepare("UPDATE coach_wechat_links SET subject_id=NULL WHERE owner_id=?").bind(owner),
      db.prepare("DELETE FROM coach_facts WHERE owner_id=?").bind(owner),
      db.prepare("DELETE FROM coach_subjects WHERE owner_id=?").bind(owner),
      db.prepare("DELETE FROM coach_profiles WHERE owner_id=?").bind(owner),
    ]);
    }); } catch(error) { if(error instanceof Error&&error.message===CAPTURE_PURGE_UNAVAILABLE)return json({error:CAPTURE_PURGE_UNAVAILABLE},503);throw error; }
  } else return json({ error: "不支持的操作。" }, 400);
  return json(await state(owner));
}
