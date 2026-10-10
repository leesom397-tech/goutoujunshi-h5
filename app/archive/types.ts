import type { SelfData } from "@/lib/profile";
import type { relationshipFit } from "@/lib/relationship-fit";
import type { cleanCommunicationReading } from "@/lib/communication-reading";
import type { cleanMomentsReport } from "@/lib/moments-report";
import type { TimelineRecord, relationshipTrendPoints } from "@/lib/relationship-timeline";
import type { actionFeedbackCards, relationshipProgressEvents } from "@/lib/relationship-feedback";

export type MomentsReport = NonNullable<ReturnType<typeof cleanMomentsReport>>;
export type Reading = NonNullable<ReturnType<typeof cleanCommunicationReading>>;
export type Person = {
  id: string; label: string; avatar?: string; updatedAt: number;
  notes?: string; stage?: string; howMet?: string; values?: string; boundaries?: string;
  ageRange?: string; city?: string; education?: string; occupation?: string;
  relationshipStatus?: string; childrenPlan?: string; lifestyle?: string;
  compatibility?: ReturnType<typeof relationshipFit>;
  communicationReading?: Reading | null; momentsReport?: MomentsReport | null;
};
export type ArchiveFact = { id: string; subjectId: string | null; kind: string; value: string; source: string; evidence: string; status: "pending" | "accepted"; eventTitle?: string; eventDate?: string };
export type ArchiveState = { enabled: boolean; paused: boolean; self: SelfData & { avatar?: string; momentsReport?: MomentsReport | null }; subjects: Person[]; facts: ArchiveFact[]; signals: TimelineRecord[]; trends: { subjectId: string; points: ReturnType<typeof relationshipTrendPoints> }[] };
export type FeedbackState = { subjectId: string; cards: ReturnType<typeof actionFeedbackCards>; events: ReturnType<typeof relationshipProgressEvents> };
export const basicFields = [
  ["ageRange", "年龄或年龄段"], ["city", "常住地"], ["education", "学历"], ["occupation", "职业或学习状态"], ["relationshipStatus", "婚恋状态"], ["childrenPlan", "婚育想法"], ["lifestyle", "生活方式"],
] as const;
export const preferenceFields = [["preferredAgeRange", "希望的年龄范围"], ["distancePreference", "异地接受程度"], ["preferredRelationship", "想要的关系"], ["values", "看重的事"], ["boundaries", "不能接受的事"], ["goals", "眼下目标"]] as const;
export const personFields = [...basicFields, ["stage", "关系阶段"], ["howMet", "认识方式"], ["values", "明确表达的期待或价值观"], ["boundaries", "明确表达的边界"], ["notes", "备注与已确认经历"]] as const;
export async function archiveRequest<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(`/api/web/${path}`, { method: body === undefined ? "GET" : method, cache: "no-store", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(data?.error || "暂时无法完成，请重试。"), { status: response.status });
  return data as T;
}

/** API facts are newest first; confirmed manual values keep precedence. */
export function personDisplayData(person: Person, facts: ArchiveFact[]): Record<string, unknown> {
  const result: Record<string, unknown> = { ...person };
  const latest = new Map<string, ArchiveFact>();
  for (const fact of facts) {
    if (fact.subjectId !== person.id || !["accepted", "pending"].includes(fact.status) || !fact.kind.startsWith("subjectBasic:") || !fact.value.trim()) continue;
    const field = fact.kind.slice(13);
    if (!latest.has(field)) latest.set(field, fact);
  }
  for (const [field] of basicFields) {
    const fact = latest.get(field);
    if (!result[field] && fact) result[field] = fact.status === "pending" ? `待确认 · ${fact.value}` : fact.value;
  }
  return result;
}
