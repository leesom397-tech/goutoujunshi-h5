import type { CaptureRecord } from "./desktop-capture";

type Role = CaptureRecord["senderRole"];
export type ChatActivityRecord = Pick<CaptureRecord, "kind" | "senderRole" | "at" | "text" | "source"> & { id?: string; localId?: string };
export type ChatActivityOptions = { account?: string; sessionGapHours?: number; utcOffsetMinutes?: number };
export type ChatActivityDay = { date: string; self: number; other: number; unknown: number; total: number; voices: number };
export type ChatActivitySession = { startedAt: string; endedAt: string; messages: number; starter: Role; reason?: string; sourceIds: string[] };
export type ChatActivitySummary = {
  messages: number; self: number; other: number; unknown: number;
  voices: number; selfVoices: number; otherVoices: number; unknownVoices: number; unreadVoices: number;
  text: number; images: number; stickers: number; ignored: number; duplicates: number;
  sourceMode: "database" | "visible-records"; supplementalRecords: number;
  startDate: string | null; endDate: string | null; spanDays: number | null; activeDays: number;
  datedMessages: number; undatedMessages: number; preciseMessages: number; utcOffsetMinutes: number;
  days: ChatActivityDay[]; sessions: ChatActivitySession[]; sessionGapHours: number;
  starts: { self: number; other: number; unknown: number; comparable: number; selfPercent: number | null; otherPercent: number | null };
  responses: { selfToOther: number; otherToSelf: number; selfCoverage: number | null; otherCoverage: number | null; averageSelfReplyMinutes: number | null; averageOtherReplyMinutes: number | null; comparableTurns: number };
  reading: { title: string; text: string }[]; limitations: string[];
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const DAY = 86400000;
type Entry = { row: ChatActivityRecord; role: Role; voice: boolean; key: string; context: string; at: number | null; precise: boolean; date: string | null; conflict: boolean };

/** Strict calendar validation: JS Date silently normalizes February 30. */
function calendar(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number | null {
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  const value = Date.UTC(year, month - 1, day, hour, minute, second), date = new Date(value);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}
function isoTime(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match || calendar(...match.slice(1, 7).map(Number) as [number, number, number, number, number, number]) === null) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
function uiTime(value: string, offset: number): number | null {
  // Never derive a year from “昨天/周一/10月8日”, or use the capture date as the message date.
  const match = value.match(/^(\d{4})(?:年|-|\/)(\d{1,2})(?:月|-|\/)(\d{1,2})日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const timestamp = calendar(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  return timestamp === null ? null : timestamp - offset * 60000;
}
function identity(row: ChatActivityRecord, account?: string) {
  const source = row.source;
  const alias = object(source.databaseIdentity) ? source.databaseIdentity : null;
  const trustedAlias = alias && alias.version === 1 && alias.matchedBy === "unique-text-interval-v1" && alias.id === row.id
    && alias.senderRole === row.senderRole && Array.isArray(alias.anchors) && alias.anchors.length === 2 && alias.anchors.every(string);
  const candidate = source.method === "wechat-local-db" && source.idStability === "stable" ? source : trustedAlias ? alias : null;
  if (!candidate || !row.id || [candidate.accountId, candidate.sessionId, candidate.messageShard, candidate.messageId].some(value => !string(value)) || account && candidate.accountId !== account) return null;
  return { key: JSON.stringify([candidate.accountId, candidate.sessionId, candidate.messageShard, candidate.messageId]),
    context: JSON.stringify([candidate.accountId, candidate.sessionId]), at: candidate === alias ? String(alias.at || "") : row.at,
    precise: candidate === alias || source.timestampOrigin === "wechat-create-time", voice: candidate.mediaKind === "voice" };
}
function isVoice(row: ChatActivityRecord): boolean {
  return row.source.mediaKind === "voice" || row.source.uiClass === "mmui::ChatVoiceItemView"
    || row.kind === "other" && /^(?:\[语音\]|【语音】|语音(?:消息)?\s*\d+["”]?秒|\[Voice message\])$/i.test(row.text.trim());
}
function isMessage(row: ChatActivityRecord, voice: boolean): boolean {
  if (["screen-capture", "video-import"].includes(String(row.source.method)) || row.kind === "post") return false;
  if (["text", "image", "sticker"].includes(row.kind) || voice) return true;
  // “other” also contains system notices, which must not start a conversation.
  return ["video", "file", "location", "link"].includes(String(row.source.mediaKind))
    || /^\[(?:视频|文件|位置|链接|Video|File|Location)\]$/i.test(row.text.trim());
}
function entry(row: ChatActivityRecord, index: number, options: Required<Pick<ChatActivityOptions, "utcOffsetMinutes">> & ChatActivityOptions): Entry | null {
  const id = identity(row, options.account), voice = isVoice(row) || !!id?.voice;
  if (!isMessage(row, voice)) return null;
  let at: number | null = id?.precise ? isoTime(id.at) : null;
  const precise = at !== null;
  // legacyUiSource is retained only by our verified UI ↔ database merge.
  const legacy = object(row.source.legacyUiSource) ? row.source.legacyUiSource : null;
  if (at === null && row.source.method === "uia") at = uiTime(row.at, options.utcOffsetMinutes);
  if (at === null && legacy?.method === "uia" && string(legacy.at)) at = uiTime(legacy.at, options.utcOffsetMinutes);
  return { row, role: ["self", "other"].includes(row.senderRole) ? row.senderRole : "unknown", voice,
    key: id?.key || (row.localId ? "local:" + row.localId : "row:" + index), context: id?.context || "",
    at, precise, date: at === null ? null : new Date(at + options.utcOffsetMinutes * 60000).toISOString().slice(0, 10), conflict: false };
}

/** Deterministic counts over imported material; no sentiment model, network calls, or inferred missing dates. */
export function computeChatActivity(records: readonly ChatActivityRecord[], options: ChatActivityOptions = {}): ChatActivitySummary {
  const offset = Number.isInteger(options.utcOffsetMinutes) && Math.abs(options.utcOffsetMinutes!) <= 14 * 60 ? options.utcOffsetMinutes! : 480;
  const gap = Number.isFinite(options.sessionGapHours) && options.sessionGapHours! >= 1 && options.sessionGapHours! <= 48 ? options.sessionGapHours! : 6;
  const unique = new Map<string, Entry>(); let ignored = 0, duplicates = 0;
  const databaseRows = records.filter(row => identity(row, options.account));
  const usingDatabase = databaseRows.some(row => isMessage(row, isVoice(row)));
  let supplementalRecords = 0;
  records.forEach((row, index) => {
    const next = entry(row, index, { ...options, utcOffsetMinutes: offset });
    if (!next) { ignored++; return; }
    // Unmatched legacy screen rows may duplicate DB messages. Keep them in the
    // source library, but do not silently inflate this DB-based summary.
    if (usingDatabase && !identity(row, options.account)) { supplementalRecords++; return; }
    const previous = unique.get(next.key);
    if (!previous) { unique.set(next.key, next); return; }
    duplicates++;
    const conflict = previous.conflict || previous.role !== next.role || previous.at !== next.at || previous.voice !== next.voice;
    // Prefer an existing transcript over its older voice placeholder. No source text is changed.
    const selected = next.row.source.transcriptionStatus === "visible-text" && previous.row.source.transcriptionStatus !== "visible-text" ? next : previous;
    unique.set(next.key, { ...selected, conflict, ...(conflict ? { role: "unknown", at: null, date: null, precise: false } : {}) });
  });
  const all = [...unique.values()], days = new Map<string, ChatActivityDay>();
  const summary: ChatActivitySummary = { messages: all.length, self: 0, other: 0, unknown: 0, voices: 0, selfVoices: 0, otherVoices: 0, unknownVoices: 0,
    unreadVoices: 0, text: 0, images: 0, stickers: 0, ignored, duplicates, sourceMode: usingDatabase ? "database" : "visible-records", supplementalRecords, startDate: null, endDate: null, spanDays: null, activeDays: 0,
    datedMessages: 0, undatedMessages: 0, preciseMessages: 0, utcOffsetMinutes: offset, days: [], sessions: [], sessionGapHours: gap,
    starts: { self: 0, other: 0, unknown: 0, comparable: 0, selfPercent: null, otherPercent: null },
    responses: { selfToOther: 0, otherToSelf: 0, selfCoverage: null, otherCoverage: null, averageSelfReplyMinutes: null, averageOtherReplyMinutes: null, comparableTurns: 0 },
    reading: [], limitations: [] };
  for (const item of all) {
    summary[item.role]++;
    if (item.voice) { summary.voices++; summary[item.role === "self" ? "selfVoices" : item.role === "other" ? "otherVoices" : "unknownVoices"]++; if (item.row.kind !== "text" || item.row.source.transcriptionStatus !== "visible-text") summary.unreadVoices++; }
    else if (item.row.kind === "text") summary.text++;
    else if (item.row.kind === "image") summary.images++;
    else if (item.row.kind === "sticker") summary.stickers++;
    if (!item.date) { summary.undatedMessages++; continue; }
    summary.datedMessages++; if (item.precise) summary.preciseMessages++;
    const day = days.get(item.date) || { date: item.date, self: 0, other: 0, unknown: 0, total: 0, voices: 0 };
    day[item.role]++; day.total++; if (item.voice) day.voices++; days.set(item.date, day);
  }
  summary.days = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  summary.activeDays = summary.days.length;
  if (summary.days.length) {
    summary.startDate = summary.days[0].date; summary.endDate = summary.days.at(-1)!.date;
    summary.spanDays = Math.round((Date.parse(summary.endDate) - Date.parse(summary.startDate)) / DAY) + 1;
  }
  const exact = all.filter(item => item.precise).sort((a, b) => a.at! - b.at!);
  const contexts = new Set(exact.map(item => item.context));
  const incomplete = summary.preciseMessages !== summary.messages || contexts.size > 1;
  const groups: Entry[][] = [];
  for (const item of exact) {
    const current = groups.at(-1);
    if (!current || item.at! - current.at(-1)!.at! >= gap * 3600000) groups.push([item]); else current.push(item);
  }
  summary.sessions = groups.map((items, index) => {
    const first = items[0], firstRoles = new Set(items.filter(item => item.at === first.at).map(item => item.role));
    const reason = index === 0 ? "导入起点前是否还有消息未知" : incomplete ? "部分消息时间不完整，无法确认这一轮是谁先开口" : firstRoles.size !== 1 || first.role === "unknown" ? "开头同一时间出现双方消息，或说话人尚未确认" : undefined;
    return { startedAt: new Date(first.at!).toISOString(), endedAt: new Date(items.at(-1)!.at!).toISOString(), messages: items.length,
      starter: reason ? "unknown" : first.role, ...(reason ? { reason } : {}), sourceIds: items.map(item => item.row.localId || item.row.id || "").filter(Boolean) };
  });
  // A response is counted only when the next dated message in the same
  // conversation turn comes from the other person. This keeps message volume
  // separate from reply coverage and avoids treating consecutive self-messages
  // as a response.
  const selfReplyGaps: number[] = [], otherReplyGaps: number[] = [];
  let selfMessagesInTurns = 0, otherMessagesInTurns = 0;
  for (const items of groups) {
    for (const item of items) {
      if (item.role === "self") selfMessagesInTurns++;
      if (item.role === "other") otherMessagesInTurns++;
    }
    for (let index = 1; index < items.length; index++) {
      const previous = items[index - 1], current = items[index];
      if (previous.role === current.role || previous.role === "unknown" || current.role === "unknown" || previous.at === null || current.at === null) continue;
      const minutes = Math.round((current.at! - previous.at!) / 60000);
      if (minutes < 0 || minutes > gap * 60) continue;
      if (current.role === "other") { summary.responses.selfToOther++; selfReplyGaps.push(minutes); }
      else { summary.responses.otherToSelf++; otherReplyGaps.push(minutes); }
    }
  }
  summary.responses.comparableTurns = summary.responses.selfToOther + summary.responses.otherToSelf;
  summary.responses.selfCoverage = selfMessagesInTurns ? Math.round(summary.responses.otherToSelf / selfMessagesInTurns * 100) : null;
  summary.responses.otherCoverage = otherMessagesInTurns ? Math.round(summary.responses.selfToOther / otherMessagesInTurns * 100) : null;
  summary.responses.averageSelfReplyMinutes = selfReplyGaps.length ? Math.round(selfReplyGaps.reduce((sum, value) => sum + value, 0) / selfReplyGaps.length) : null;
  summary.responses.averageOtherReplyMinutes = otherReplyGaps.length ? Math.round(otherReplyGaps.reduce((sum, value) => sum + value, 0) / otherReplyGaps.length) : null;
  for (const session of summary.sessions) summary.starts[session.starter]++;
  summary.starts.comparable = summary.starts.self + summary.starts.other;
  if (summary.starts.comparable) { summary.starts.selfPercent = Math.round(summary.starts.self / summary.starts.comparable * 100); summary.starts.otherPercent = 100 - summary.starts.selfPercent; }
  if (summary.messages) summary.reading.push({ title: "聊得有多频繁", text: summary.spanDays === null ? "目前缺少可靠日期，只统计消息量，暂不判断联系频率。" : summary.spanDays < 2 ? `目前只看到 ${summary.activeDays} 天、${summary.datedMessages} 条有日期的消息，时间太短，还看不出日常联系节奏。` : `已导入材料横跨 ${summary.spanDays} 天，其中 ${summary.activeDays} 天有消息${summary.spanDays >= 7 ? `，平均每周约 ${(summary.activeDays / summary.spanDays * 7).toFixed(1)} 天留有记录` : ""}。这说明这段材料里的联系密度；未导入的聊天不在统计内。` });
  summary.reading.push({ title: "谁在重新开启聊天", text: summary.starts.comparable ? `可判断的 ${summary.starts.comparable} 轮中，你先开口 ${summary.starts.self} 次，TA 先开口 ${summary.starts.other} 次。${summary.starts.comparable < 3 ? "轮数还少，暂不概括长期主动性。" : summary.starts.other > summary.starts.self ? "这段材料里，TA 重新联系你更多；可以再结合是否认真回应、落实安排看投入。" : summary.starts.self > summary.starts.other ? "这段材料里，你更常重新开启聊天；还要看TA是否接住话题，不能只凭先开口次数判断冷淡。" : "双方都有重新开启聊天，发起次数相近；还要结合回应和行动判断关系。"}` : "还没有足够的完整时间与会话间隔，暂不能判断谁更常先开口。" });
  if (summary.voices) summary.reading.push({ title: "双方怎样表达", text: `你发了 ${summary.self} 条消息（含 ${summary.selfVoices} 条语音），TA 发了 ${summary.other} 条（含 ${summary.otherVoices} 条语音）。语音转成文字仍只算一条；发得多也可能是表达习惯，不能直接当作好感或付出程度。` });
  if (summary.responses.comparableTurns) summary.reading.push({ title: "回应是否接得住", text: `在有完整先后顺序的消息里，TA 接住你上一条后继续回应 ${summary.responses.selfToOther} 次，你接住 TA 后回应 ${summary.responses.otherToSelf} 次。回应覆盖率只反映这份材料里的可比较消息，不能单独代表好感。` });
  summary.limitations.push(`仅统计已导入材料；相邻消息间隔至少 ${gap} 小时划为新一轮，跨午夜本身不另起一轮。首轮不计入发起比例。`);
  if (supplementalRecords) summary.limitations.push(`${supplementalRecords} 条旧界面记录尚不能确认是否重复，已保留在原文库，未并入本次统计。`);
  if (summary.undatedMessages) summary.limitations.push(`${summary.undatedMessages} 条缺少可靠日期，未计入日期和趋势。`);
  if (summary.datedMessages > summary.preciseMessages) summary.limitations.push(`${summary.datedMessages - summary.preciseMessages} 条仅有界面日期标签；可以确认日期，不能可靠判断精确的会话间隔。`);
  if (contexts.size > 1) summary.limitations.push("混有不同账号或会话来源，暂不合并判断发起比例。");
  if (summary.unknown) summary.limitations.push(`${summary.unknown} 条说话人待确认，不归给任何一方。`);
  if (all.some(item => item.conflict)) summary.limitations.push("同一消息来源存在身份或时间冲突，相关记录只计一次，暂不用于发起判断。");
  return summary;
}

/** Counts the report charts can draw without a model score. Zero is a real count, not a missing chart. */
export function activityChart(summary: ChatActivitySummary) {
  const sided = Math.max(1, summary.self + summary.other);
  const share = (count: number) => Math.max(0, Math.min(100, Math.round(count / sided * 100)));
  const bars = [
    { key: "self", label: "我的消息", count: summary.self },
    { key: "other", label: "TA 的消息", count: summary.other },
    { key: "selfStart", label: "我先开口", count: summary.starts.self },
    { key: "otherStart", label: "TA 先开口", count: summary.starts.other },
    { key: "otherReply", label: "TA 接住", count: summary.responses.selfToOther },
    { key: "selfReply", label: "我接住", count: summary.responses.otherToSelf },
  ];
  const max = Math.max(1, ...bars.map(row => row.count));
  return {
    bars: bars.map(row => ({ ...row, value: Math.round(row.count / max * 100) })),
    dimensions: bars.map(row => ({ key: row.key, label: row.label, value: share(row.count), status: "ready" as const })),
  };
}
export function chatActivityTimeline(summary: ChatActivitySummary, maxBins = 30): Array<ChatActivityDay & { endDate: string }> {
  if (!summary.startDate || !summary.endDate || !summary.spanDays) return [];
  const width = Math.max(1, Math.ceil(summary.spanDays / Math.max(1, Math.min(60, Math.floor(maxBins) || 30))));
  const start = Date.parse(summary.startDate), bins = Array.from({ length: Math.ceil(summary.spanDays / width) }, (_, index) => ({ date: new Date(start + index * width * DAY).toISOString().slice(0, 10), endDate: new Date(Math.min(Date.parse(summary.endDate!), start + ((index + 1) * width - 1) * DAY)).toISOString().slice(0, 10), self: 0, other: 0, unknown: 0, total: 0, voices: 0 }));
  for (const day of summary.days) { const bin = bins[Math.floor((Date.parse(day.date) - start) / DAY / width)]; for (const key of ["self", "other", "unknown", "total", "voices"] as const) bin[key] += day[key]; }
  return bins;
}

/** A report can retain counts without retaining chat bodies, names or account IDs. */
export type ChatActivityMetadata = {
  id: number; context: number | null; origin: "database" | "visible" | "other";
  kind: "text" | "image" | "sticker" | "voice" | "media" | "ignored";
  role: Role; at: string; time: "message" | "label" | "unknown"; transcribed: boolean;
};
export const CHAT_ACTIVITY_UPLOAD_LIMIT = 20_000;
/** Full history stays available to computeChatActivity on this device. The
 * report endpoint receives a bounded projection, never a silent history slice. */
export function prepareChatActivityUpload(records: readonly ChatActivityRecord[], options: ChatActivityOptions = {}): { activityRecords: ChatActivityMetadata[]; notice: string } {
  if (records.length > CHAT_ACTIVITY_UPLOAD_LIMIT) return {
    activityRecords: [],
    notice: `完整 ${records.length.toLocaleString("zh-CN")} 条聊天的统计仍在本机展示；本次报告仅分析选中的文字，不附带全历史统计。`,
  };
  return { activityRecords: serializeChatActivityRecords(records, options), notice: "" };
}
export function serializeChatActivityRecords(records: readonly ChatActivityRecord[], options: ChatActivityOptions = {}): ChatActivityMetadata[] {
  if (records.length > CHAT_ACTIVITY_UPLOAD_LIMIT) throw new Error("全历史统计请在本机查看，单次报告最多接收 20000 条统计元数据。");
  const offset = Number.isInteger(options.utcOffsetMinutes) && Math.abs(options.utcOffsetMinutes!) <= 840 ? options.utcOffsetMinutes! : 480;
  const ids = new Map<string, number>(), contexts = new Map<string, number>();
  return records.map((row, index) => {
    const stable = identity(row, options.account), item = entry(row, index, { ...options, utcOffsetMinutes: offset });
    const key = stable?.key || (row.localId ? "local:" + row.localId : "row:" + index);
    if (!ids.has(key)) ids.set(key, ids.size);
    if (stable && !contexts.has(stable.context)) contexts.set(stable.context, contexts.size);
    const precise = !!item?.precise, dated = item?.at !== null && item?.at !== undefined;
    return { id: ids.get(key)!, context: stable ? contexts.get(stable.context)! : null,
      origin: stable ? "database" : row.source.method === "uia" ? "visible" : "other",
      kind: !item ? "ignored" : item.voice ? "voice" : ["text", "image", "sticker"].includes(row.kind) ? row.kind as "text" | "image" | "sticker" : "media",
      role: item?.role || "unknown", at: !dated ? "" : precise ? new Date(item!.at!).toISOString() : new Date(item!.at! + offset * 60000).toISOString().slice(0, 19).replace("T", " "),
      time: precise ? "message" : dated ? "label" : "unknown", transcribed: !!item?.voice && row.kind === "text" && row.source.transcriptionStatus === "visible-text" };
  });
}

/** Validate the client projection and recompute all counts on the server.
 * Metadata describes imported sources; it is not proof that a client is honest. */
export function parseChatActivityRecords(input: unknown): ChatActivityRecord[] {
  if (!Array.isArray(input) || input.length > CHAT_ACTIVITY_UPLOAD_LIMIT) throw new Error("聊天统计材料格式不正确或超过 20000 条。");
  const fields = new Set(["id", "context", "origin", "kind", "role", "at", "time", "transcribed"]);
  return input.map(value => {
    if (!object(value) || Object.keys(value).length !== fields.size || Object.keys(value).some(key => !fields.has(key))
      || !Number.isSafeInteger(value.id) || Number(value.id) < 0 || Number(value.id) >= CHAT_ACTIVITY_UPLOAD_LIMIT
      || value.context !== null && (!Number.isSafeInteger(value.context) || Number(value.context) < 0 || Number(value.context) >= CHAT_ACTIVITY_UPLOAD_LIMIT)
      || !["database", "visible", "other"].includes(String(value.origin)) || !["text", "image", "sticker", "voice", "media", "ignored"].includes(String(value.kind))
      || !["self", "other", "unknown"].includes(String(value.role)) || !["message", "label", "unknown"].includes(String(value.time))
      || typeof value.at !== "string" || value.at.length > 40 || typeof value.transcribed !== "boolean"
      || value.origin === "database" && value.context === null || value.origin !== "database" && value.context !== null
      || value.time === "message" && (value.origin !== "database" || isoTime(String(value.at)) === null)
      || value.time === "label" && uiTime(String(value.at), 480) === null || value.time === "unknown" && value.at !== ""
      || value.transcribed && value.kind !== "voice") throw new Error("聊天统计来源、时间或身份字段不正确。");
    const row = value as ChatActivityMetadata;
    const source: CaptureRecord["source"] = { label: "已导入聊天的统计元数据", method: row.origin === "database" ? "wechat-local-db" : row.origin === "visible" ? "uia" : "metadata",
      ...(row.origin === "database" ? { accountId: "activity-account", sessionId: "conversation-" + row.context, messageShard: "activity", messageId: String(row.id), idStability: "stable", timestampOrigin: row.time === "message" ? "wechat-create-time" : "unknown" } : {}),
      ...(row.origin === "database" && row.time === "label" ? { legacyUiSource: { method: "uia", at: row.at } } : {}),
      ...(row.kind === "voice" ? { mediaKind: "voice", transcriptionStatus: row.transcribed ? "visible-text" : "not-transcribed" } : row.kind === "media" ? { mediaKind: "file" } : {}) };
    return { ...(row.origin === "database" ? { id: "activity-" + row.id } : { localId: "activity-" + row.id }), senderRole: row.role, at: row.at, text: "",
      kind: row.kind === "voice" ? row.transcribed ? "text" : "other" : row.kind === "media" ? "other" : row.kind === "ignored" ? "post" : row.kind, source };
  });
}
