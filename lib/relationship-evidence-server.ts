import { getD1 } from "@/db";
import type { RelationshipSourceReport } from "./relationship-evidence";

type Row = { id: string; kind?: string; result: string; created_at: number; report_ids?: string };
type EvidenceDb = ReturnType<typeof getD1>;
const parse = (raw: unknown): Record<string, any> => { try { const value = typeof raw === "string" ? JSON.parse(raw) : raw; return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; } };
const entries = (row: Row) => { const result = parse(row.result); return Array.isArray(result.entries) ? result.entries : []; };
const contains = (row: Row, id: string) => entries(row).some(entry => entry?.id === id);
const valid = (row: Row, subjectId: string) => { const report = parse(row.result); return Object.keys(report).length > 0 && report.targetSelf !== true && report.target !== "self" && (!report.subjectId || report.subjectId === subjectId) && entries(row).every(entry => entry && entry.targetSelf !== true && entry.target !== "self" && (!entry.subjectId || entry.subjectId === subjectId)); };
const savedWhere = "owner_id=? AND subject_id=? AND status='done'";
const legacyFrom = "coach_crush_reports r JOIN coach_crush_threads t ON t.id=r.thread_id AND t.owner_id=r.owner_id";
const legacyWhere = "r.owner_id=? AND t.owner_id=? AND t.subject_id=? AND r.status='done'";

/** Reads existing reports locally in the application's database. No model request or new archive write. */
export async function loadRelationshipEvidence(ownerId: string, subjectId: string, focusId = "", database?: EvidenceDb) {
  const db = database || getD1();
  const empty = (authorized = false, validFocus = false) => ({ authorized, validFocus, reports: [] as RelationshipSourceReport[], data: {} as Record<string, unknown>, cutoff: 0 });
  const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(ownerId).first<{ consent_at: number | null; paused: number }>();
  if (!profile?.consent_at || profile.paused) return empty();
  const subject = await db.prepare("SELECT id,data FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(subjectId, ownerId).first<{ id: string; data: string }>();
  if (!subject) return empty(true);
  let focus: Row | null = null, focusTable: "saved" | "legacy" = "saved";
  if (focusId) {
    focus = await db.prepare(`SELECT id,kind,result,created_at,report_ids FROM coach_saved_reports WHERE ${savedWhere} AND id=?`).bind(ownerId, subjectId, focusId).first<Row>();
    if (!focus) {
      focus = await db.prepare(`SELECT r.id,r.result,r.created_at FROM ${legacyFrom} WHERE ${legacyWhere} AND r.id=?`).bind(ownerId, ownerId, subjectId, focusId).first<Row>();
      if (focus) focusTable = "legacy";
    }
    // Some older member rows have been compacted, but their complete batch is still saved.
    if (!focus) focus = await db.prepare(`SELECT id,kind,result,created_at,report_ids FROM coach_saved_reports WHERE ${savedWhere} AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(report_ids) THEN report_ids ELSE '[]' END) WHERE value=?) ORDER BY created_at ASC LIMIT 1`).bind(ownerId, subjectId, focusId).first<Row>();
    if (!focus || !valid(focus, subjectId) || !Number.isFinite(focus.created_at)) return empty(true);
  }
  const embeddedFocus = focus && focus.id !== focusId ? entries(focus).find(entry => entry?.id === focusId) : null;
  if (focus && focus.id !== focusId && (!embeddedFocus || !Number.isFinite(embeddedFocus.createdAt))) return empty(true);
  const cutoff = embeddedFocus && Number.isFinite(embeddedFocus.createdAt) ? embeddedFocus.createdAt : focus?.created_at ?? Date.now();
  const [saved, legacy] = await Promise.all([
    db.prepare(`SELECT id,kind,result,created_at,report_ids FROM coach_saved_reports WHERE ${savedWhere} AND created_at<=? ORDER BY created_at DESC,id DESC LIMIT 12`).bind(ownerId, subjectId, cutoff).all<Row>(),
    db.prepare(`SELECT r.id,r.result,r.created_at FROM ${legacyFrom} WHERE ${legacyWhere} AND r.created_at<=? AND NOT EXISTS (SELECT 1 FROM coach_saved_reports s,json_each(CASE WHEN json_valid(s.report_ids) THEN s.report_ids ELSE '[]' END) member WHERE s.owner_id=? AND s.subject_id=? AND s.status='done' AND s.created_at<=? AND member.value=r.id) ORDER BY r.created_at DESC,r.id DESC LIMIT 12`).bind(ownerId, ownerId, subjectId, cutoff, ownerId, subjectId, cutoff).all<Row>(),
  ]);
  const selected = new Map<string, { row: Row; table: "saved" | "legacy" }>();
  for (const row of saved.results || []) if (valid(row, subjectId) && !(focusTable === "legacy" && contains(row, focusId))) selected.set(row.id, { row, table: "saved" });
  for (const row of legacy.results || []) if (!selected.has(row.id) && valid(row, subjectId)) selected.set(row.id, { row, table: "legacy" });
  // The focus itself is retained even if twelve simultaneous imports filled the page.
  if (focus && !selected.has(focus.id) && (focusTable === "saved" || ![...selected.values()].some(({row}) => entries(row).some(entry => entry.id === focus!.id)))) selected.set(focus.id, { row: focus, table: focusTable });
  const bounded = [...selected.values()].sort((a,b)=>b.row.created_at-a.row.created_at).slice(0,12);
  if (focus && !bounded.some(item=>item.row.id===focus.id)) { if (bounded.length===12) bounded.pop(); const selectedFocus=selected.get(focus.id); if(selectedFocus)bounded.push(selectedFocus); }
  const checked = await Promise.all(bounded.map(async ({ row, table }) => {
    // Re-check deletion/reassociation after the reads; stale material is never returned.
    const current = table === "saved"
      ? await db.prepare(`SELECT id,kind,result,created_at,report_ids FROM coach_saved_reports WHERE ${savedWhere} AND id=?`).bind(ownerId, subjectId, row.id).first<Row>()
      : await db.prepare(`SELECT r.id,r.result,r.created_at FROM ${legacyFrom} WHERE ${legacyWhere} AND r.id=?`).bind(ownerId, ownerId, subjectId, row.id).first<Row>();
    if (!current || current.result !== row.result || current.created_at !== row.created_at || !valid(current, subjectId)) return null;
    const originalEntries = entries(row), scopedEntries = embeddedFocus && row.id === focus?.id ? originalEntries.filter(entry=>entry?.id===focusId) : focusId && row.id!==focus?.id ? originalEntries.filter(entry=>Number.isFinite(entry.createdAt)&&entry.createdAt<=cutoff) : originalEntries;
    if (originalEntries.length && !scopedEntries.length) return null;
    const report = parse(row.result);
    return { id: row.id, kind: row.kind || "chat", createdAt: embeddedFocus && row.id===focus?.id ? cutoff : row.created_at, report: originalEntries.length ? {...report,entries:scopedEntries} : report, entries: scopedEntries } as RelationshipSourceReport;
  }));
  const reports = checked.filter((report): report is RelationshipSourceReport => report !== null);
  const active = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(ownerId).first<{ consent_at: number | null; paused: number }>();
  if (!active?.consent_at || active.paused || active.consent_at !== profile.consent_at) return empty();
  const stillSubject = await db.prepare("SELECT id,data FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(subjectId, ownerId).first<{ id: string; data: string }>();
  if (!stillSubject) return empty(true);
  if (focusId && !reports.some(report => report.id === focusId || report.entries?.some(entry => entry.id === focusId))) return empty(true);
  return { authorized: true, validFocus: true, reports, data: parse(stillSubject.data), cutoff };
}
