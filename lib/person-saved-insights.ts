import { cleanCommunicationReading } from "./communication-reading";
import { cleanMomentsReport } from "./moments-report";

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
};

const parse = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
};

const text = (value: unknown, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : "";

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
  return { reportId: row.id, createdAt: Number(row.created_at) || 0, kind: row.kind as "chat" | "moments" | "social", summary, moments, reading, diagnosis };
}

