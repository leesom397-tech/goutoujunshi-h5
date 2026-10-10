import { createHash } from "node:crypto";

type Line = { speaker?: string; text?: string; timestampRaw?: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalize = (value: string) => value.normalize("NFKC").replace(/[\s，。！？,.!?]/g, "");

/** Only explicit calendar dates qualify. Never substitute the upload date/year. */
export function explicitEventDate(raw: string): string {
  const match = raw.match(/(?:^|[^\d])(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日|\b|(?=\s))/);
  if (!match) return "";
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d)) return "";
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function relationshipMaterial(lines: Line[]) {
  const material = lines.map(line => `${line.speaker || ""}:${String(line.text || "").replace(/[\s，。！？,.!?]/g, "")}:${line.timestampRaw || ""}`).join("|");
  let currentDate = "";
  const entries = lines.filter(line => typeof line.text === "string" && line.text.trim()).map(line => {
    const raw = line.timestampRaw || "";
    const explicit = explicitEventDate(raw);
    if (explicit) currentDate = explicit;
    else if (raw && !/^\s*(?:上午|下午|晚上|凌晨|早上)?\s*\d{1,2}[:：]\d{2}(?::\d{2})?\s*$/.test(raw)) currentDate = "";
    const text = normalize(line.text || "");
    const clock = raw.match(/(?:上午|下午|晚上|凌晨|早上)?\s*\d{1,2}[:：]\d{2}(?::\d{2})?/)?.[0].replace(/\s/g, "") || "";
    return { key: `${currentDate || raw}:${clock}:${line.speaker || "unknown"}:${text}`, date: currentDate, length: text.length };
  });
  const dates = entries.map(line => line.date);
  const dateComplete = dates.length > 0 && dates.every(Boolean);
  const dayCounts = new Map<string, number>();
  for (const entry of entries) if (entry.date) dayCounts.set(entry.date, (dayCounts.get(entry.date) || 0) + 1);
  const eventDays = [...dayCounts].sort(([a], [b]) => a.localeCompare(b)).map(([date, messageCount]) => ({ date, messageCount }));
  // Adjacent three-message windows avoid matching greetings or isolated stock replies.
  // Hashes, not original messages, are retained in long-term history.
  const windows = entries.slice(2).map((_, i) => {
    const window = entries.slice(i, i + 3);
    return window.reduce((sum, line) => sum + line.length, 0) >= 30 ? hash(window.map(line => line.key).join("|")) : "";
  });
  return { signature: material ? hash(material) : "", materialVersion: 2,
    eventStart: dateComplete ? [...dates].sort()[0] : "",
    eventEnd: dateComplete ? [...dates].sort().at(-1)! : "",
    messageCount: entries.length,
    eventDays: eventDays.slice(0, 31), eventDayCount: eventDays.length, undatedMessageCount: entries.filter(entry => !entry.date).length,
    // Do not apply containment if metadata was truncated or any short window was excluded.
    windowsComplete: windows.length > 0 && windows.length <= 500 && windows.every(Boolean),
    evidenceWindows: [...new Set(windows.filter(Boolean))].slice(0, 500) };
}

export type TimelineRecord = {
  subjectId: string; reportId: string; signature?: string; updatedAt: number;
  score: number | null; comparable?: boolean; estimated?: boolean;
  summary?: string; nextStep?: string; dimensions?: ({ label: string; value: number | null } | null)[];
  eventStart?: string; eventEnd?: string; messageCount?: number; windowsComplete?: boolean;
  evidenceWindows?: string[]; materialVersion?: number;
  eventDays?: { date: string; messageCount: number }[]; eventDayCount?: number; undatedMessageCount?: number;
};

/** Read-time projection: source reports and feedback references are never deleted. */
export function distinctRelationshipEvents<T extends TimelineRecord>(records: T[]) {
  const byReport = new Map<string, T>();
  for (const item of records) {
    const key = `${item.subjectId}:${item.reportId}`;
    const old = byReport.get(key);
    // A live report may enrich old persisted history with dates/hashes without losing its advice.
    byReport.set(key, old ? { ...item, ...old, ...(item.materialVersion ? {
      materialVersion: item.materialVersion, eventStart: item.eventStart, eventEnd: item.eventEnd,
      messageCount: item.messageCount, evidenceWindows: item.evidenceWindows, windowsComplete: item.windowsComplete,
      eventDays: item.eventDays, eventDayCount: item.eventDayCount, undatedMessageCount: item.undatedMessageCount
    } : {}) } : { ...item });
  }
  const kept: Array<T & { sourceReportIds: string[]; overlapWith: string[] }> = [];
  for (const item of [...byReport.values()].sort((a, b) => a.updatedAt - b.updatedAt)) {
    const samePerson = kept.filter(old => old.subjectId === item.subjectId);
    const exact = samePerson.find(old => !!item.signature && item.signature === old.signature);
    const contained = samePerson.find(old => item.windowsComplete && (item.messageCount || 0) <= (old.messageCount || 0) && item.evidenceWindows?.length &&
      item.evidenceWindows.every(key => old.evidenceWindows?.includes(key)));
    const duplicate = exact || contained;
    if (duplicate) { duplicate.sourceReportIds.push(item.reportId); continue; }
    const overlapWith = samePerson.filter(old => item.evidenceWindows?.some(key => old.evidenceWindows?.includes(key))).map(old => old.reportId);
    kept.push({ ...item, sourceReportIds: [item.reportId], overlapWith });
  }
  // If a crop arrived first, a later complete copy replaces it only in this projection.
  // Restrict this to the same date range; a multi-day report must not absorb earlier events.
  return kept.filter(item => {
    const container = [...kept].sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0)).find(other => other !== item && other.subjectId === item.subjectId &&
      other.eventStart === item.eventStart && other.eventEnd === item.eventEnd &&
      (other.messageCount || 0) > (item.messageCount || 0) && item.windowsComplete && item.evidenceWindows?.length &&
      item.evidenceWindows.every(key => other.evidenceWindows?.includes(key)));
    if (!container) return true;
    container.sourceReportIds = [...new Set([...container.sourceReportIds, ...item.sourceReportIds])];
    return false;
  });
}

export function latestRelationshipSignals<T extends TimelineRecord>(records: T[]) {
  const latest = new Map<string, T>();
  for (const item of [...records].sort((a, b) => a.updatedAt - b.updatedAt)) {
    const previous = latest.get(item.subjectId);
    if (!previous || (item.eventEnd && (!previous.eventEnd || item.eventEnd >= previous.eventEnd)) || (!item.eventEnd && !previous.eventEnd)) latest.set(item.subjectId, item);
  }
  return [...latest.values()];
}

export function relationshipTrendPoints<T extends TimelineRecord>(records: T[]) {
  const distinct = distinctRelationshipEvents(records);
  const known = distinct.filter(item => item.eventStart && item.eventEnd).sort((a, b) => a.eventStart!.localeCompare(b.eventStart!) || a.updatedAt - b.updatedAt);
  const unknown = distinct.filter(item => !item.eventStart || !item.eventEnd).sort((a, b) => a.updatedAt - b.updatedAt);
  // Undated material is separate and cannot be presented as the latest relationship event.
  return [...known.slice(-8), ...unknown.slice(-3)].map((item, index, list) => {
    const previous = list[index - 1];
    const connected = Boolean(previous && previous.subjectId === item.subjectId && previous.eventEnd && item.eventStart &&
      previous.eventEnd < item.eventStart && previous.comparable && item.comparable && !previous.estimated && !item.estimated && !item.overlapWith.length);
    const changes = connected ? (item.dimensions || []).flatMap(dimension => {
      const before = previous.dimensions?.find(row => row?.label === dimension?.label);
      return dimension && typeof dimension.value === "number" && typeof before?.value === "number" && dimension.value !== before.value
        ? [`${dimension.label}：${before.value} → ${dimension.value}`] : [];
    }).slice(0, 3) : [];
    return { reportId: item.reportId, subjectId: item.subjectId, score: item.score, summary: item.summary || "",
      eventStart: item.eventStart || "", eventEnd: item.eventEnd || "", sourceReportIds: item.sourceReportIds,
      eventDays: item.eventDays || [], eventDayCount: item.eventDayCount || 0, undatedMessageCount: item.undatedMessageCount || 0,
      dayBreakdownLabel: (item.eventDayCount || 0) > 1 ? `含 ${item.eventDayCount} 个有日期的聊天日，评分对应整组材料` : "",
      label: item.eventStart ? (item.eventStart === item.eventEnd ? "聊天记录" : "跨日聊天") : "日期待确认",
      dateLabel: item.eventStart ? (item.eventStart === item.eventEnd ? item.eventStart : `${item.eventStart} 至 ${item.eventEnd}`) : "",
      recordedDateLabel: new Date(item.updatedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }),
      axisLabel: item.eventStart ? item.eventStart.slice(5).replace("-", "/") : "待定",
      connectPrevious: connected, previousReportId: connected ? previous.reportId : "", changes,
      changeSummary: changes.length ? `与 ${previous.eventEnd} 的聊天相比，分析指标变化：${changes.join("；")}` : item.overlapWith.length ? "含已记录的聊天，保留新增内容，不据此判断关系升降。" : "",
      width: item.score == null ? 0 : item.score, tone: "past" };
  });
}
