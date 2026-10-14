import { relationshipEvidenceReview, type RelationshipSourceReport, type RelationshipEvidenceReview } from "./relationship-evidence";
/** Read-only observations from this person's existing analyses. Never records a guessed outcome. */
type Point = {
  reportId: string; subjectId: string; signature?: string; summary?: string; nextStep?: string;
  updatedAt: number; eventStart?: string; eventEnd?: string; comparable?: boolean; estimated?: boolean;
  dimensions?: { label: string; value: number | null }[]; evidenceWindows?: string[];
};
export type AutomaticRelationshipUpdate = {
  status: "empty" | "first" | "compared" | "overlap" | "context";
  headline: string; note: string; count: number;
  current: { reportId: string; summary: string; nextStep: string; date: string } | null;
  previous: { reportId: string; summary: string; date: string } | null;
  changes: { label: string; before: number; after: number; text: string }[];
  evidenceReview?: RelationshipEvidenceReview;
};
const clean = (value: unknown, max = 400) => typeof value === "string" ? value.trim().slice(0, max) : "";
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(value);
const calendar = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
};
const dateRange = (point: Point) => {
  const start = calendar(point.eventStart), end = calendar(point.eventEnd);
  return start && end && start <= end ? { start, end } : { start: "", end: "" };
};
export function automaticRelationshipUpdate(data: Record<string, unknown>, subjectId: string, focusReportId = "", sourceReports?: RelationshipSourceReport[]): AutomaticRelationshipUpdate {
  const evidenceReview = sourceReports ? relationshipEvidenceReview(data, subjectId, focusReportId, sourceReports) : undefined;
  const empty: AutomaticRelationshipUpdate = { status: "empty", headline: evidenceReview?.cards.length ? "这次多了哪些具体线索" : "新聊天会接着这次分析", note: "补充同一人物的材料后，会自动整理其中的新线索。", count: 0, current: null, previous: null, changes: [], ...(evidenceReview ? { evidenceReview } : {}) };
  const raw = Array.isArray(data.relationshipHistory) ? data.relationshipHistory : [];
  const byReport = new Map<string, Point>();
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const input = value as Point;
    const p: Point = { ...input, signature: clean(input.signature, 300),
      dimensions: Array.isArray(input.dimensions) ? input.dimensions.filter(d => d && typeof d === "object") : [],
      evidenceWindows: Array.isArray(input.evidenceWindows) ? input.evidenceWindows.filter((key): key is string => typeof key === "string" && !!key.trim()) : [] };
    if (p.subjectId !== subjectId || !identifier(p.reportId) || !Number.isFinite(p.updatedAt) || !clean(p.summary)) continue;
    const old = byReport.get(p.reportId);
    if (!old || old.updatedAt < p.updatedAt) byReport.set(p.reportId, p);
  }
  const ordered = [...byReport.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  const focus = focusReportId ? ordered.find(p => p.reportId === focusReportId) : ordered.at(-1);
  if (!focus) return empty;
  // Opening an old report must not label later material as that report's "previous" evidence.
  const available = ordered.filter(p => p.updatedAt <= focus.updatedAt);
  const unique = available.filter((p, i, list) => !p.signature || list.findIndex(q => q.signature === p.signature) === i);
  const earlier = available.filter(p => p.reportId !== focus.reportId && (!p.signature || p.signature !== focus.signature));
  const { start, end } = dateRange(focus);
  const dated = earlier.filter(p => dateRange(p).end && start && dateRange(p).end < start)
    .sort((a, b) => dateRange(a).end.localeCompare(dateRange(b).end) || a.updatedAt - b.updatedAt);
  const previous = dated.at(-1) || earlier.at(-1);
  const result: AutomaticRelationshipUpdate = { ...empty, count: unique.length,
    status: previous ? "context" : "first", headline: previous ? "已结合前一次材料" : "这次的重点已留在档案里",
    current: { reportId: focus.reportId, summary: clean(focus.summary), nextStep: clean(focus.nextStep), date: start && end ? start === end ? start : `${start} 至 ${end}` : "" },
    previous: previous ? { reportId: previous.reportId, summary: clean(previous.summary), date: dateRange(previous).end } : null };
  if (!previous) return { ...result, note: "下次补充新聊天，会结合这次的重点继续分析。" };
  const previousRange = dateRange(previous);
  const overlap = !!focus.evidenceWindows?.some(key => previous.evidenceWindows?.includes(key)) ||
    Boolean(start && end && previousRange.start && previousRange.end && start <= previousRange.end && end >= previousRange.start);
  if (overlap) return { ...result, status: "overlap", headline: "材料有重叠，已保留前后依据", note: "重复或重叠的聊天不会被当成关系变好的证据。" };
  const canCompare = start && end && previousRange.end && previousRange.end < start &&
    focus.comparable === true && previous.comparable === true && focus.estimated === false && previous.estimated === false;
  if (!canCompare) return { ...result, note: "这里对照两次材料的判断；日期或分析范围不足时，暂不画升降趋势。" };
  const dimensions = Array.isArray(focus.dimensions) ? focus.dimensions : [];
  result.changes = dimensions.flatMap(d => {
    const before = previous.dimensions?.find(item => item?.label === d?.label)?.value, after = d?.value;
    if (!clean(d?.label, 40) || typeof before !== "number" || typeof after !== "number" || !Number.isFinite(before) || !Number.isFinite(after) || before < 0 || before > 100 || after < 0 || after > 100 || before === after) return [];
    return [{ label: clean(d.label, 40), before, after, text: `${d.label}：${before} → ${after}` }];
  }).slice(0, 3);
  return { ...result, status: "compared", headline: result.changes.length ? "这次材料里有这些变化" : "可比较的互动指标暂未明显变化",
    note: "变化来自两组已分析材料，反映可见互动，不代表对方内心或建议已经执行。" };
}
