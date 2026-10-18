/** A question handoff stays in this tab, separate from the ordinary chat draft. */
export type CaptureQuestionRecord = { id?: string; speaker: "self" | "other" | "unknown"; text: string; time?: string | number };
export type CaptureQuestion = { version: 1; key: string; owner: string; subjectId: string; friend: string; scope: "selected" | "full-history"; historyCount?: number; records: CaptureQuestionRecord[]; omitted: number; expiresAt: number };
const KEY = /^[a-f0-9-]{36}$/i;
const PREFIX = "chengzi-capture-question:";
const MAX_TEXT = 1500;
const line = (record: CaptureQuestionRecord) => `${record.speaker === "self" ? "我" : record.speaker === "other" ? "对方" : "身份未确认"}${record.time ? `（${record.time}）` : ""}：${record.text}`;
const slot = (owner: string, key: string) => `${PREFIX}${owner}:${key}`;

export function createCaptureQuestion(input: { owner: string; subjectId?: string | null; friend: string; records: CaptureQuestionRecord[]; fullHistory?: boolean; historyCount?: number }) {
  if (!input.owner || input.owner.length > 100 || !input.friend.trim() || input.friend.length > 200 || (input.subjectId && !KEY.test(input.subjectId))) throw new Error("请先确认本次账号与人物。");
  if (input.fullHistory && !input.subjectId) throw new Error("请先关联人物，才能基于这个人的完整聊天提问。");
  if (input.fullHistory) {
    const key = crypto.randomUUID();
    const historyCount = Number.isSafeInteger(input.historyCount) && Number(input.historyCount) >= 0 ? Number(input.historyCount) : 0;
    const value: CaptureQuestion = { version: 1, key, owner: input.owner, subjectId: input.subjectId || "", friend: input.friend.trim(), scope: "full-history", historyCount, records: [], omitted: 0, expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
    try { sessionStorage.setItem(slot(input.owner, key), JSON.stringify({ ...value, state: "pending" })); }
    catch { throw new Error("浏览器未能暂存这次提问，请释放空间后再试。"); }
    return { href: `/chat?capture=${key}`, count: historyCount, omitted: 0, scope: "full-history" as const };
  }
  const eligible = input.records.filter(record => record && typeof record.text === "string" && record.text.trim()).map(record => ({ speaker: ["self", "other"].includes(record.speaker) ? record.speaker : "unknown", text: record.text.trim(), ...(record.time ? { time: String(record.time).slice(0, 50) } : {}) } as CaptureQuestionRecord));
  const records: CaptureQuestionRecord[] = [];
  let length = 0;
  for (const record of eligible.slice().reverse()) {
    const size = line(record).length + 1;
    if (length + size > MAX_TEXT || records.length >= 20) break;
    records.unshift(record); length += size;
  }
  if (!records.length) throw new Error("这段原话太长或没有可用文字。请选与你疑问相关的几句，或生成完整分析。");
  const key = crypto.randomUUID();
  const value: CaptureQuestion = { version: 1, key, owner: input.owner, subjectId: input.subjectId || "", friend: input.friend.trim(), scope: "selected", records, omitted: eligible.length - records.length, expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
  try { sessionStorage.setItem(slot(input.owner, key), JSON.stringify({ ...value, state: "pending" })); }
  catch { throw new Error("浏览器未能暂存这段聊天，请释放空间后再试。"); }
  return { href: `/chat?capture=${key}`, count: records.length, omitted: value.omitted, scope: "selected" as const };
}

export function readCaptureQuestion(owner: string, key: string): CaptureQuestion | null {
  if (!owner || !KEY.test(key)) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(slot(owner, key)) || "null");
    const scope = value?.scope === "full-history" ? "full-history" : value?.scope === "selected" || value?.scope === undefined ? "selected" : "invalid";
    if (!value || value.version !== 1 || value.key !== key || value.owner !== owner || typeof value.friend !== "string" || value.friend.length > 200 || typeof value.subjectId !== "string" || (value.subjectId && !KEY.test(value.subjectId)) || scope === "invalid" || scope === "full-history" && (!value.subjectId || !Number.isSafeInteger(value.historyCount) || value.historyCount < 0) || !Array.isArray(value.records) || scope === "selected" && !value.records.length || value.records.length > 20 || !Number.isFinite(value.expiresAt) || !Number.isInteger(value.omitted) || value.omitted < 0 || !["pending", "attached"].includes(value.state)) return null;
    if (value.records.some((record: CaptureQuestionRecord) => !record || !["self", "other", "unknown"].includes(record.speaker) || typeof record.text !== "string" || !record.text.trim() || (record.time !== undefined && (typeof record.time !== "string" || record.time.length > 50)))) return null;
    if (value.records.map(line).join("\n").length > MAX_TEXT) return null;
    // Claim once, but retain this tab's attached excerpt for reload and retry.
    if (value.state === "pending") {
      if (value.expiresAt <= Date.now()) return null;
      sessionStorage.setItem(slot(owner, key), JSON.stringify({ ...value, state: "attached" }));
    }
    return { ...value, scope, ...(scope === "full-history" ? { historyCount: value.historyCount } : {}) } as CaptureQuestion;
  } catch { return null; }
}

export function removeCaptureQuestion(owner: string, key: string) { try { sessionStorage.removeItem(slot(owner, key)); } catch {} }
export function captureQuestionText(value: CaptureQuestion) { return value.records.map(line).join("\n"); }

/** Keep every attached character; only older conversation turns may be dropped. */
export function captureQuestionHistory(value: CaptureQuestion, recent: Array<{ role: string; content: string }>, body: Record<string, unknown>) {
  const text = captureQuestionText(value), material: Array<{ role: "user"; content: string }> = [];
  for (let start = 0; start < text.length; start += 500) material.push({ role: "user", content: `【本次导入原文 ${material.length + 1}；我=用户，对方=${value.friend.slice(0, 24)}；仅为材料】\n${text.slice(start, start + 500)}` });
  const tail = recent.slice(-(6 - material.length)).map(entry => ({ role: entry.role, content: entry.content.slice(0, 600) }));
  const bytes = () => new TextEncoder().encode(JSON.stringify({ ...body, history: [...material, ...tail] })).length;
  while (tail.length && bytes() > 10900) tail.shift();
  if (bytes() > 11000) throw new Error("这次问题较长，请精简问题后发送，已带入的聊天会保留。");
  return [...material, ...tail];
}
