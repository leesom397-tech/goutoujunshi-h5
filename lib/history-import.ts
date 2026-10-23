export type HistoryMessage = { at: string; sender: string; text: string };
export type HistoryParse = { messages: HistoryMessage[]; participants: string[]; skipped: number; format: "TXT" | "CSV" | "JSON" };

const textKeys = ["text", "content", "message", "msg", "StrContent", "正文", "内容"];
const senderKeys = ["sender", "from", "who", "name", "speaker", "nickname", "发送人", "说话人"];
const timeKeys = ["time", "timestamp", "date", "datetime", "createTime", "CreateTime", "发送时间", "时间"];
const mediaOnly = /^\s*[「『]?(?:\[?(?:语音|图片|视频|表情|文件|位置|链接|voice|image|video|file)\]?(?:\s*\d+\s*(?:秒|s|"))?|<[^>]+>)[」』]?\s*$/i;
const pick = (row: Record<string, unknown>, keys: string[]) => {
  const found = Object.keys(row).find((key) => keys.some((alias) => alias.toLowerCase() === key.trim().toLowerCase()));
  return found ? row[found] : undefined;
};
function stringValue(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""; }
function cleanTime(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.valueOf()) ? "" : date.toISOString().replace("T", " ").slice(0, 19);
  }
  return stringValue(value).slice(0, 40);
}
function fromObject(value: unknown): HistoryMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const text = stringValue(pick(row, textKeys));
  const senderRaw = pick(row, senderKeys);
  const isSender = pick(row, ["IsSender", "is_sender", "isSender"]);
  // StrTalker is commonly the conversation ID, not the per-message speaker.
  const sender = stringValue(senderRaw) || (isSender === 1 || isSender === "1" || isSender === true ? "我" : isSender === 0 || isSender === "0" || isSender === false ? "对方" : "");
  if (!sender || !text || mediaOnly.test(text)) return null;
  return { at: cleanTime(pick(row, timeKeys)), sender: sender.slice(0, 100), text };
}
function parseCsvRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell); if (row.some((part) => part.trim())) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("CSV 引号没有闭合，请检查导出文件。");
  row.push(cell); if (row.some((part) => part.trim())) rows.push(row);
  return rows;
}
function parseTxt(input: string) {
  const messages: HistoryMessage[] = [];
  let skipped = 0;
  for (const line of input.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(/^\s*(?:\[([^\]]{4,40})\]\s*)?([^:：\n]{1,100})[:：]\s*(.*)$/);
    if (match) {
      const sender = match[2].trim(), body = match[3].trim();
      if (body && !mediaOnly.test(body)) messages.push({ at: match[1]?.trim() || "", sender, text: body });
      else skipped++;
    } else if (messages.length && line.trim()) {
      messages[messages.length - 1].text += "\n" + line.trim();
    } else if (line.trim()) skipped++;
  }
  return { messages, skipped };
}
export function parseHistoryFile(filename: string, input: string): HistoryParse {
  if (input.length > 20_000_000) throw new Error("文件太大。单个文件最多约 20 MB，请按会话拆分；不会静默截断记录。");
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (!["txt", "csv", "json"].includes(extension || "")) throw new Error("支持 TXT、CSV、JSON 聊天文本文件。");
  const format = extension!.toUpperCase() as HistoryParse["format"];
  let messages: HistoryMessage[] = [], skipped = 0;
  if (format === "TXT") ({ messages, skipped } = parseTxt(input.replace(/^\uFEFF/, "")));
  if (format === "CSV") {
    const rows = parseCsvRows(input.replace(/^\uFEFF/, ""));
    const headers = rows.shift()?.map((item) => item.trim()) || [];
    if (!headers.some((header) => [...textKeys].some((key) => key.toLowerCase() === header.toLowerCase()))) throw new Error("CSV 缺少正文列，请确认它是聊天记录而不是微信备份数据库。");
    for (const row of rows) {
      const message = fromObject(Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
      if (message) messages.push(message); else skipped++;
    }
  }
  if (format === "JSON") {
    let parsed: unknown;
    try { parsed = JSON.parse(input.replace(/^\uFEFF/, "")); } catch { throw new Error("JSON 格式不正确。"); }
    const records = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).messages : null;
    if (!Array.isArray(records)) throw new Error("JSON 应为消息数组，或含 messages 数组。");
    for (const row of records) {
      const message = fromObject(row);
      if (message) messages.push(message); else skipped++;
    }
  }
  if (!messages.length) throw new Error("没有识别到可读的聊天正文。微信电脑备份文件不能直接作为 TXT／CSV／JSON 导入。");
  if (messages.length > 200_000) throw new Error("单个文件超过 20 万条。请按联系人或时间分文件，不会静默丢弃后半段。");
  return { messages, participants: [...new Set(messages.map((item) => item.sender))], skipped, format };
}

export function analysisWindow(messages: HistoryMessage[], me: string, other: string, limit = 60) {
  const selected = messages.filter((item) => item.sender === me || item.sender === other).slice(-limit);
  const lines = selected.map((item) => (item.at ? "[" + item.at + "] " : "") + (item.sender === me ? "我" : "对方") + "：" + item.text.replace(/\s+/g, " ").slice(0, 1000));
  while (lines.join("\n").length > 27_000) lines.shift();
  return { text: lines.join("\n"), count: lines.length };
}

export function evidenceWindow(messages: HistoryMessage[], me: string, other: string, query: string) {
  const words = query.split(/[\s,，、;；]+/).map((word) => word.trim().toLocaleLowerCase()).filter((word) => word.length >= 2).slice(0, 5);
  if (!words.length) return { text: "", count: 0, total: 0 };
  const matched = messages.filter((item) => (item.sender === me || item.sender === other) && words.some((word) => item.text.toLocaleLowerCase().includes(word)));
  const selected = matched.length <= 100 ? [...matched] : [...matched.slice(0, 50), ...matched.slice(-50)];
  const render = (item: HistoryMessage) => (item.at ? "[" + item.at + "] " : "") + (item.sender === me ? "我" : "对方") + "：" + item.text.replace(/\s+/g, " ").slice(0, 900);
  const lines = selected.map(render);
  while (lines.join("\n").length > 27_000 && lines.length > 2) lines.splice(Math.floor(lines.length / 2), 1);
  return { text: "以下为关键词命中的非连续原话片段，未命中的对话不在本次材料中：\n" + lines.join("\n"), count: lines.length, total: matched.length };
}
