import { getD1 } from "@/db";
import { cleanConversationProfileCandidates, type ConversationMemoryLine, type ConversationProfileMemory, type ConversationProfileMemoryItem } from "./conversation-profile-memory";

type Database = ReturnType<typeof getD1>;
type Scope = { consentAt: number; subjectId: string | null } | null;
const parse = (value: unknown): Record<string, unknown> => { try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };
type SavedFact = {id:string;status:string;event_meta:string|null;value:string;evidence:string};
const equivalentFact = "owner_id=? AND subject_id IS ? AND field=? AND (value=? OR (CASE WHEN json_valid(event_meta) THEN json_extract(event_meta,'$.sourceId') END=? AND CASE WHEN json_valid(event_meta) THEN json_extract(event_meta,'$.field') END=?))";
export async function conversationMemoryScope(owner: string, subjectId: string | null, db: Database = getD1()): Promise<Scope> {
  const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{consent_at:number|null;paused:number}>();
  if (!profile?.consent_at || profile.paused) return null;
  if (subjectId && !await db.prepare("SELECT id FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(subjectId,owner).first()) return null;
  return { consentAt: profile.consent_at, subjectId };
}
export function emptyConversationMemory(status: ConversationProfileMemory["status"], sourceCount = 0): ConversationProfileMemory {
  return { status, pendingCount: 0, selfCount: 0, subjectCount: 0, sourceCount, items: [] };
}
export async function saveConversationProfileMemory(owner: string, sourceReportId: string, raw: unknown, lines: ConversationMemoryLine[], scope: Scope, db: Database = getD1()): Promise<ConversationProfileMemory> {
  if (!scope) return emptyConversationMemory("disabled", lines.length);
  const active = await conversationMemoryScope(owner, scope.subjectId, db);
  if (!active || active.consentAt !== scope.consentAt) return emptyConversationMemory("disabled", lines.length);
  const candidates = cleanConversationProfileCandidates(raw, lines).filter(item => item.target === "self" || !!scope.subjectId);
  if (!candidates.length) return emptyConversationMemory("nothing_new", lines.length);
  const own = await db.prepare("SELECT data FROM coach_profiles WHERE owner_id=?").bind(owner).first<{data:string}>();
  const person = scope.subjectId ? await db.prepare("SELECT data FROM coach_subjects WHERE owner_id=? AND id=? AND status='active'").bind(owner,scope.subjectId).first<{data:string}>() : null;
  const items: ConversationProfileMemoryItem[] = [];
  for (const candidate of candidates) {
    const subjectId = candidate.target === "self" ? null : scope.subjectId;
    const field = candidate.basis === "statement" ? `${candidate.target === "self" ? "selfBasic" : "subjectBasic"}:${candidate.field}` : candidate.target === "self" ? "selfProfileClue" : "profileClue";
    const value = candidate.basis === "inference" ? `待验证推测 · ${candidate.label}：${candidate.value}` : candidate.value;
    const data = parse(candidate.target === "self" ? own?.data : person?.data);
    const hasCurrent = Object.hasOwn(data, candidate.field);
    const currentValue = typeof data[candidate.field] === "string" ? String(data[candidate.field]) : "";
    const conflict = candidate.basis === "statement" && hasCurrent && currentValue !== value;
    const metadata = JSON.stringify({ version: 1, kind: "conversation-profile", sourceReportId, sourceId: candidate.sourceId, sourceAt: candidate.sourceAt, speaker: candidate.target === "self" ? "self" : "other", basis: candidate.basis, field: candidate.field, conflict });
    const existing = await db.prepare(`SELECT id,status,event_meta,value,evidence FROM coach_facts WHERE ${equivalentFact} LIMIT 1`).bind(owner,subjectId,field,value,candidate.sourceId,candidate.field).first<SavedFact>();
    let fact = existing;
    if (!fact) {
      const id = crypto.randomUUID();
      const saved = await db.prepare(`INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,event_meta,confidence,status,created_at) SELECT ?,?,?,?,?,?,?,?,'medium','pending',? WHERE NOT EXISTS (SELECT 1 FROM coach_facts WHERE ${equivalentFact}) AND (SELECT COUNT(*) FROM coach_facts WHERE owner_id=?)<200 AND EXISTS (SELECT 1 FROM coach_profiles WHERE owner_id=? AND consent_at=? AND paused=0) AND (? IS NULL OR EXISTS (SELECT 1 FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'))`)
        .bind(id,owner,subjectId,field,value,`导入聊天 · ${candidate.target === "self" ? "本人" : "对方"}${candidate.basis === "statement" ? "自述／待核对" : "线索／待验证"}`,candidate.quote,metadata,Date.now(),owner,subjectId,field,value,candidate.sourceId,candidate.field,owner,owner,scope.consentAt,scope.subjectId,scope.subjectId,owner).run();
      if (saved.meta.changes) fact = { id, status: "pending", event_meta: metadata, value, evidence: candidate.quote };
      else fact = await db.prepare(`SELECT id,status,event_meta,value,evidence FROM coach_facts WHERE ${equivalentFact} LIMIT 1`).bind(owner,subjectId,field,value,candidate.sourceId,candidate.field).first<SavedFact>();
    }
    if (!fact || !["pending", "accepted"].includes(fact.status)) continue;
    const sameSource = parse(fact.event_meta).sourceId === candidate.sourceId;
    const keptValue = sameSource ? fact.value : value, keptConflict = candidate.basis === "statement" && hasCurrent && currentValue !== keptValue;
    items.push({ ...candidate, value:keptValue, ...(sameSource ? {quote:fact.evidence} : {}), id: fact.id, sourceReportId, status: fact.status as "pending" | "accepted", conflict:keptConflict, ...(keptConflict ? {currentValue} : {}) });
  }
  // Do not return a stale enabled view if the user paused while writes ran.
  const final = await conversationMemoryScope(owner,scope.subjectId,db);
  if (!final || final.consentAt !== scope.consentAt) return emptyConversationMemory("disabled",lines.length);
  const pending = items.filter(item => item.status === "pending");
  return {status:pending.length ? "pending" : "nothing_new",pendingCount:pending.length,selfCount:pending.filter(item=>item.target==="self").length,subjectCount:pending.filter(item=>item.target==="subject").length,sourceCount:lines.length,items};
}
