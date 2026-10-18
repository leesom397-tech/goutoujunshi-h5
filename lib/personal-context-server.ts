import { getD1 } from "@/db";
import { recoverProfileFields } from "./profile-fact-fields";
import { personalConnection, reportPersonalEvidence, uniquePersonalEvidence, type PersonalEvidence } from "./personal-context";
import { loadSelfArchiveMemory } from "./self-archive-memory";

const fields: Record<string, string> = { interests: "兴趣", strengths: "自述长处", lifestyle: "生活方式", communicationStyle: "沟通偏好", values: "在意的事", goals: "当前目标", preferredRelationship: "期待的关系", boundaries: "边界", relationshipStatus: "婚恋自述", occupation: "职业自述" };
function parse(value: unknown): Record<string, any> { try { const result = typeof value === "string" ? JSON.parse(value) : value; return result && typeof result === "object" && !Array.isArray(result) ? result : {}; } catch { return {}; } }
type ContextDb = ReturnType<typeof getD1>;
export async function loadPersonalContext(ownerId: string, subjectId?: string | null, database?: ContextDb) {
  const db = database || getD1();
  const profile = await db.prepare("SELECT consent_at,paused,data,updated_at FROM coach_profiles WHERE owner_id=?").bind(ownerId).first<{consent_at:number|null;paused:number;data:string;updated_at:number}>();
  if (!profile?.consent_at || profile.paused) return { authorized: false, self: {}, evidence: [] as PersonalEvidence[] };
  // Validate the selected identity before any historical records are considered.
  const subject = subjectId ? await db.prepare("SELECT id,data,updated_at FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(subjectId, ownerId).first<{id:string;data:string;updated_at:number}>() : null;
  const scopedSubject = subject?.id || null;
  const facts = await db.prepare("SELECT subject_id,field,value,status,evidence,event_meta,created_at FROM coach_facts WHERE owner_id=? AND status='accepted' AND (subject_id IS NULL OR subject_id=?) ORDER BY created_at DESC LIMIT 200").bind(ownerId, scopedSubject).all<{subject_id:string|null;field:string;value:string;status:string;evidence?:string;event_meta?:string|null;created_at?:number}>();
  const self = recoverProfileFields(parse(profile.data), facts.results || [], null);
  const evidence: PersonalEvidence[] = Object.entries(fields).flatMap(([field, label]) => typeof self[field] === "string" && self[field].trim() ? [{id:`self-profile:${field}`,side:"self",source:"self-profile",label:`你已确认保存的${label}`,quote:self[field],field,recordedAt:profile.updated_at,basis:field==="strengths"?"observation":"statement"} as PersonalEvidence] : []);
  try {
    const learned = await loadSelfArchiveMemory(ownerId, db);
    if (learned.status === "disabled") return {authorized:false,self:{},evidence:[] as PersonalEvidence[]};
    for (const memory of learned.summaries) for (const item of memory.items) {
      if (Object.hasOwn(self,item.field)) continue;
      evidence.push({id:memory.id+":"+item.id,side:"self",source:"self-profile",label:item.basis==="correction"?"你已纠正的本人自述":"此前聊天中你的明确自述（可纠正）",quote:item.basis==="correction"?item.value:item.quote,field:item.field,sourceId:item.sourceId,recordedAt:memory.updatedAt,basis:"statement"});
    }
  } catch { /* Older installations can still use confirmed profile fields. */ }
  for (const [index, fact] of (facts.results || []).entries()) {
    if (!/^(selfBasic:|subjectBasic:|selfProfileClue$|profileClue$)/.test(fact.field) || fact.status !== "accepted") continue;
    if (fact.subject_id && fact.subject_id !== scopedSubject) continue;
    const mine = fact.subject_id === null, metadata = parse(fact.event_meta), field = fact.field.split(":")[1] || metadata.field;
    const data = mine ? self : parse(subject?.data);
    const conflict = field && Object.hasOwn(data, field) && data[field] !== fact.value;
    const inferred = metadata.basis === "inference" || /^待验证推测/.test(fact.value);
    // Confirming a proposed inference keeps the inference label. It never turns
    // it into a stated preference or a proven common interest.
    const quote = fact.evidence || fact.value;
    if (!quote) continue;
    evidence.push({ id:`accepted-memory:${mine ? "self" : scopedSubject}:${index}`,side:mine ? "self" : "other",source:mine ? "self-profile" : "subject-profile",label:`${mine ? "你" : "该人物"}已确认保留的${inferred ? "待验证线索" : conflict ? "不同表述（现有资料保留）" : "原话"}`,quote,field,...(fact.subject_id ? {subjectId:fact.subject_id} : {}),...(typeof metadata.sourceId === "string" ? {sourceId:metadata.sourceId} : {}),...(typeof metadata.sourceReportId === "string" ? {reportId:metadata.sourceReportId} : {}),recordedAt:fact.created_at,basis:inferred || conflict || field === "strengths" ? "observation" : "statement" });
  }
  if (subject && scopedSubject) {
    const other = recoverProfileFields(parse(subject.data), facts.results || [], scopedSubject);
    for (const [field, label] of Object.entries(fields)) if (typeof other[field] === "string" && other[field].trim()) evidence.push({id:`subject-profile:${scopedSubject}:${field}`,side:"other",source:"subject-profile",label:`该人物档案 · ${label}`,quote:other[field],field,subjectId:scopedSubject,recordedAt:subject.updated_at,basis:field==="strengths"?"observation":"statement"});
    const [saved, chats] = await Promise.all([
      db.prepare("SELECT id,subject_id,result,created_at FROM coach_saved_reports WHERE owner_id=? AND subject_id=? AND status='done' ORDER BY created_at DESC LIMIT 8").bind(ownerId,scopedSubject).all<{id:string;subject_id:string;result:string;created_at:number}>(),
      db.prepare("SELECT r.id,r.result,r.created_at FROM coach_crush_reports r JOIN coach_crush_threads t ON t.id=r.thread_id AND t.owner_id=r.owner_id WHERE r.owner_id=? AND t.owner_id=? AND t.subject_id=? AND r.status='done' ORDER BY r.created_at DESC LIMIT 10").bind(ownerId,ownerId,scopedSubject).all<{id:string;result:string;created_at:number}>(),
    ]);
    for (const row of [...(saved.results || []), ...(chats.results || [])]) {
      const report = parse(row.result);
      // A wrong legacy association never turns a self-material report into target data.
      if (report.targetSelf === true || report.subjectId && report.subjectId !== scopedSubject) continue;
      evidence.push(...reportPersonalEvidence(report,{reportId:row.id,subjectId:scopedSubject,recordedAt:row.created_at}));
    }
  }
  // Revocation or a subject deletion during the reads invalidates this snapshot.
  const active = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(ownerId).first<{consent_at:number|null;paused:number}>();
  if (!active?.consent_at || active.paused || active.consent_at !== profile.consent_at) return {authorized:false,self:{},evidence:[] as PersonalEvidence[]};
  if (scopedSubject && !await db.prepare("SELECT id FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(scopedSubject,ownerId).first()) return {authorized:true,self,evidence:uniquePersonalEvidence(evidence.filter(item=>item.source==='self-profile'))};
  return {authorized:true,self,evidence:uniquePersonalEvidence(evidence)};
}

export async function personalizeReport(ownerId: string, subjectId: string | null | undefined, report: unknown) {
  const material=parse(report);
  if(material.targetSelf===true || material.compareWithSelf===false || material.subjectId && material.subjectId!==subjectId)return personalConnection(material,{rebuild:true});
  try {
    const context = await loadPersonalContext(ownerId, subjectId);
    return personalConnection(report,{evidence:context.evidence,rebuild:true});
  } catch {
    // Context is optional. A temporary archive read failure must not lose a paid
    // analysis; use only this report's confirmed messages, never other identities.
    console.warn("personal_context_unavailable");
    return personalConnection(report,{rebuild:true});
  }
}
