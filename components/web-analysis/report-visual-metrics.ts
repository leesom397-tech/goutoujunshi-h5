import type { ChatActivityDay } from "@/lib/chat-activity";

const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const dateIsValid = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const DAY = 86_400_000;

export type VisualMetrics = {
  total: number; self: number; other: number; unknown: number;
  days: ChatActivityDay[]; startDate: string; endDate: string; spanDays: number;
  activeDays: number; dated: number; undated: number;
  starts: { self: number; other: number; unknown: number; gapHours: number | null } | null;
  replies: { self: number; other: number } | null;
};

/** Only measured chatActivity counts enter the visual. Scores and inferred dates are never substitutes. */
export function readReportVisualMetrics(report: unknown): VisualMetrics | null {
  const root = record(report);
  for (const candidate of [root.chatActivity, record(root.relationshipContext).activity]) {
    const row = record(candidate);
    if (!["messages", "self", "other", "unknown"].every(key => count(row[key])) || row.messages === 0 || row.self + row.other + row.unknown !== row.messages) continue;
    const rawDays = Array.isArray(row.days) ? row.days : [];
    const validDays = rawDays.every(day => dateIsValid(day?.date) && ["self", "other", "unknown", "total"].every(key => count(day[key])) && day.self + day.other + day.unknown === day.total);
    const uniqueDates = new Set(rawDays.map(day => day?.date)).size === rawDays.length;
    const rawDated = validDays ? rawDays.reduce((sum, day) => sum + day.total, 0) : 0;
    const countsFit = validDays && ["self", "other", "unknown"].every(key => rawDays.reduce((sum, day) => sum + day[key], 0) <= row[key]);
    const days: ChatActivityDay[] = validDays && uniqueDates && countsFit && rawDated <= row.messages ? rawDays.filter(day => day.total > 0).map(day => ({ ...day, voices: count(day.voices) ? day.voices : 0 })).sort((a, b) => a.date.localeCompare(b.date)) : [];
    const dated = days.reduce((sum, day) => sum + day.total, 0);
    const startDate = days[0]?.date || "", endDate = days.at(-1)?.date || "";
    const starts = record(row.starts), responses = record(row.responses);
    return {
      total: row.messages, self: row.self, other: row.other, unknown: row.unknown,
      days, startDate, endDate, spanDays: startDate ? Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY) + 1 : 0,
      activeDays: days.length, dated, undated: row.messages - dated,
      starts: ["self", "other", "unknown", "comparable"].every(key => count(starts[key])) && starts.comparable === starts.self + starts.other && starts.comparable > 0
        ? { self: starts.self, other: starts.other, unknown: starts.unknown, gapHours: typeof row.sessionGapHours === "number" && Number.isFinite(row.sessionGapHours) && row.sessionGapHours > 0 ? row.sessionGapHours : null } : null,
      replies: ["selfToOther", "otherToSelf", "comparableTurns"].every(key => count(responses[key])) && responses.comparableTurns === responses.selfToOther + responses.otherToSelf && responses.comparableTurns > 0
        ? { self: responses.otherToSelf, other: responses.selfToOther } : null,
    };
  }
  return null;
}

/** At most 28 actual calendar days. Zero means no imported message on that date. */
export function visualMetricsDays(metrics: VisualMetrics, requestedPage = 0) {
  if (!metrics.spanDays) return { days: [] as ChatActivityDay[], page: 0, pages: 0 };
  const pages = Math.ceil(metrics.spanDays / 28), page = Math.min(pages - 1, Math.max(0, Math.floor(requestedPage) || 0));
  const last = Date.parse(metrics.endDate) - page * 28 * DAY, first = Math.max(Date.parse(metrics.startDate), last - 27 * DAY);
  const byDate = new Map(metrics.days.map(day => [day.date, day]));
  const days = Array.from({ length: Math.round((last - first) / DAY) + 1 }, (_, index) => {
    const date = new Date(first + index * DAY).toISOString().slice(0, 10);
    return byDate.get(date) || { date, self: 0, other: 0, unknown: 0, total: 0, voices: 0 };
  });
  return { days, page, pages };
}
