import { cleanCommunicationReading } from "./communication-reading";
import { cleanMomentsReport } from "./moments-report";
import { savedChatActivity } from "./relationship-context";
import type {TimelineRecord} from "./relationship-timeline";
import type { ChatActivitySummary } from "./chat-activity";

type SavedRow = {
  id: string;
  owner_id?: string | null;
  subject_id?: string | null;
  kind: string;
  status?: string | null;
  result?: string | null;
  summary?: string | null;
  created_at: number;
};

export type PersonSavedAnalysis = {
  reportId: string;
  createdAt: number;
  kind: "chat" | "moments" | "social";
  summary: string;
  moments: NonNullable<ReturnType<typeof cleanMomentsReport>> | null;
  reading: NonNullable<ReturnType<typeof cleanCommunicationReading>> | null;
  diagnosis: { relationship?: { currentState?: string; trend?: string; reciprocity?: string; risks?: string[] }; decision?: { recommendation?: string; observeWindow?: string; stopCondition?: string }; personalConnection?: { commonPoints?: unknown[]; fit?: string; friction?: string[] } } | null;
  activitySnapshot: Pick<ChatActivitySummary, "messages" | "self" | "other" | "unknown" | "activeDays" | "starts"> | null;
};

const parse = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
};

const text = (value: unknown, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : "";

/** Callers supply only libraries scoped to the authenticated owner. Historical
 * statistics may remain labelled saved after new imports, but removed, rebound,
 * or replaced source epochs must never reappear through a saved report. */
export function savedReportSourcesActive(report: Record<string, any>, subjectId: string | null, libraries: readonly { id: string; epoch: number; subject_id: string | null; revision?: number }[]) {
  if (report.relatedSnapshots !== undefined && !Array.isArray(report.relatedSnapshots)) return false;
  const snapshots = [...(report.archiveSnapshot ? [report.archiveSnapshot] : []), ...(report.relatedSnapshots || [])];
  return snapshots.every(snapshot => {
    if (!snapshot || typeof snapshot.libraryId !== "string" || !Number.isSafeInteger(snapshot.epoch)) return false;
    const source = libraries.find(item => item.id === snapshot.libraryId && item.subject_id === subjectId && item.epoch === snapshot.epoch);
    return !!source && (snapshot.revision === undefined || Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0 && (source.revision === undefined || source.revision >= snapshot.revision));
  });
}

function savedActivitySnapshot(payload: Record<string, unknown>, kind: string): PersonSavedAnalysis["activitySnapshot"] {
  if (kind !== "chat" || payload.analysisScope !== "fullHistory") return null;
  const activity = savedChatActivity(payload.chatActivity);
  if (!activity || activity.messages !== activity.self + activity.other + activity.unknown) return null;
  const starts = activity.starts;
  if (![starts.self, starts.other, starts.unknown, starts.comparable].every(value => Number.isSafeInteger(value) && value >= 0)
      || starts.comparable !== starts.self + starts.other) return null;
  return { messages: activity.messages, self: activity.self, other: activity.other, unknown: activity.unknown, activeDays: activity.activeDays,
    starts: { self: starts.self, other: starts.other, unknown: starts.unknown, comparable: starts.comparable,
      selfPercent: starts.comparable ? Math.round(starts.self / starts.comparable * 100) : null,
      otherPercent: starts.comparable ? 100 - Math.round(starts.self / starts.comparable * 100) : null } };
}

/** Full imports have no sentence annotations or romantic score, but their real
 * activity dates/counts must still reach the existing archive widgets. */
export function savedFullHistorySignal(row:SavedRow,owner:string): (TimelineRecord&{contextCount:number})|null {
  const report=parse(row.result),activity=savedChatActivity(report.chatActivity),semantic=report.semanticHistory as Record<string,unknown>|undefined,decision=report.decision as Record<string,unknown>|undefined;
  if(row.owner_id!==owner||!row.subject_id||row.status!=="done"||row.kind!=="chat"||report.analysisScope!=="fullHistory"||report.targetSelf===true||report.subjectId&&report.subjectId!==row.subject_id||!activity)return null;
  const snapshot=report.archiveSnapshot as Record<string,unknown>|undefined;
  const signature=snapshot?`full:${String(snapshot.libraryId)}:${snapshot.epoch}:${snapshot.revision}`:`report:${row.id}`;
  return{subjectId:row.subject_id,reportId:row.id,updatedAt:row.created_at,signature,materialVersion:3,score:null,comparable:false,estimated:false,summary:text(semantic?.summary)||text(report.summary)||text(decision?.judgment),nextStep:text(decision?.nextStep),contextCount:activity.messages,messageCount:activity.messages,eventStart:activity.startDate||"",eventEnd:activity.endDate||"",eventDays:activity.days.map(day=>({date:day.date,messageCount:day.total})),eventDayCount:activity.activeDays,undatedMessageCount:activity.undatedMessages,windowsComplete:false,evidenceWindows:[],dimensions:[{label:"TA 发起占比",value:activity.starts.otherPercent},{label:"我方发起占比",value:activity.starts.selfPercent}]};
}

/**
 * Read-only projection of completed saved reports onto one active person.
 * The subject id stored inside a report is checked as well as the SQL scope;
 * malformed, deleted, foreign, and target-self reports are ignored.
 */
export function projectPersonSavedAnalysis(rows: readonly SavedRow[], subjectId: string, kinds: readonly string[] = ["moments", "social"]): PersonSavedAnalysis | null {
  if (!subjectId) return null;
  const eligible = rows
    .filter(item => item && item.status === "done" && kinds.includes(item.kind) && item.subject_id === subjectId)
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0) || String(b.id).localeCompare(String(a.id)));
  const row = eligible.find(item => {
    if (!item.id) return false;
    const payload = parse(item.result);
    if (payload.targetSelf === true) return false;
    return payload.subjectId === undefined || payload.subjectId === subjectId;
  });
  if (!row) return null;
  const payload = parse(row.result);
  const momentsSource = payload.moments && typeof payload.moments === "object" ? payload.moments : payload;
  const moments = row.kind === "chat" ? null : cleanMomentsReport(momentsSource);
  const readingSource = payload.communicationReading ?? payload.reading;
  const reading = row.kind === "chat" ? null : cleanCommunicationReading(readingSource);
  const decision = payload.decision && typeof payload.decision === "object" ? payload.decision as Record<string, unknown> : {};
  const summary = text(row.summary) || text((momentsSource as Record<string, unknown>).summary) || text(payload.summary) || text(decision.judgment) || text(decision.judgement);
  const rawDiagnosis = payload.relationshipDiagnosis && typeof payload.relationshipDiagnosis === "object" ? payload.relationshipDiagnosis as Record<string, unknown> : null;
  const relationship = rawDiagnosis?.relationship && typeof rawDiagnosis.relationship === "object" ? rawDiagnosis.relationship as Record<string, unknown> : undefined;
  const diagnosisDecision = rawDiagnosis?.decision && typeof rawDiagnosis.decision === "object" ? rawDiagnosis.decision as Record<string, unknown> : undefined;
  const connection = rawDiagnosis?.personalConnection && typeof rawDiagnosis.personalConnection === "object" ? rawDiagnosis.personalConnection as Record<string, unknown> : undefined;
  const diagnosis = rawDiagnosis ? { relationship: relationship ? { currentState: text(relationship.currentState, 180), trend: text(relationship.trend, 30), reciprocity: text(relationship.reciprocity, 260), risks: Array.isArray(relationship.risks) ? relationship.risks.filter(value => typeof value === "string").slice(0, 5).map(value => text(value, 180)) : [] } : undefined,
    decision: diagnosisDecision ? { recommendation: text(diagnosisDecision.recommendation, 260), observeWindow: text(diagnosisDecision.observeWindow, 120), stopCondition: text(diagnosisDecision.stopCondition, 180) } : undefined,
    personalConnection: connection ? { commonPoints: Array.isArray(connection.commonPoints) ? connection.commonPoints.slice(0, 6) : [], fit: text(connection.fit, 220), friction: Array.isArray(connection.friction) ? connection.friction.filter(value => typeof value === "string").slice(0, 5).map(value => text(value, 180)) : [] } : undefined } : null;
  return { reportId: row.id, createdAt: Number(row.created_at) || 0, kind: row.kind as "chat" | "moments" | "social", summary, moments, reading, diagnosis, activitySnapshot: savedActivitySnapshot(payload, row.kind) };
}

