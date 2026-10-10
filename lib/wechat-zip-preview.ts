import { unzipSync } from "fflate";

const MAX_ZIP_BYTES = 5_000_000;
const MAX_TEXT_BYTES = 1_120_000;
const dateLine = /^\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}(?::\d{2})?$/u;

export type WechatZipPreview = {
  totalMessages: number;
  textMessages: number;
  voicePlaceholders: number;
  imageReferences: number;
  otherReferences: number;
  namedMessages: number;
  timedMessages: number;
  speakerLabels: string[];
  imageFiles: number;
  audioFiles: number;
  otherFiles: number;
};
type ZipMessage = { speaker: string; timestamp: string; body: string; kind: "voice" | "image" | "other" | "text" };

function filename(name: string): string {
  // Some WeChat ZIPs contain UTF-8 filename bytes without the ZIP UTF-8 flag.
  if (name.includes("聊天记录")) return name.replace(/\\/g, "/");
  if (![...name].every(char => char.charCodeAt(0) <= 255)) return name.replace(/\\/g, "/");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from([...name].map(char => char.charCodeAt(0)))).replace(/\\/g, "/"); }
  catch { return name.replace(/\\/g, "/"); }
}

function messageKind(value: string): "voice" | "image" | "other" | "text" {
  const body = value.trim().replace(/^·\s*/u, "");
  if (/^\[语音\](?:\s*\d+(?:\.\d+)?\s*(?:["'″”’]|秒|s))?\s*$/iu.test(body)) return "voice";
  if (/^\[图片\](?:\s+\S+)?\s*$/u.test(body)) return "image";
  if (/^\[(?:视频|文件|表情|位置)\]/u.test(body)) return "other";
  return "text";
}

function readWechatZip(bytes: Uint8Array): { preview: WechatZipPreview; messages: ZipMessage[] } {
  if (bytes.length < 22 || bytes.length > MAX_ZIP_BYTES || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("请选择 5 MB 内、由微信转发生成的 ZIP 文件。");
  }
  let entryCount = 0;
  let textEntries = 0;
  const attachments = { imageFiles: 0, audioFiles: 0, otherFiles: 0 };
  const files = unzipSync(bytes, { filter: entry => {
    if (++entryCount > 100) throw new Error("压缩包文件过多，暂不支持预览。");
    const name = filename(entry.name);
    if (/(^|\/)聊天记录\.txt$/iu.test(name)) {
      if (++textEntries > 1 || entry.originalSize > MAX_TEXT_BYTES || ![0, 8].includes(entry.compression)) {
        throw new Error("聊天文字文件过多、过大或压缩方式不支持。");
      }
      return true;
    }
    if (!name.endsWith("/")) {
      if (/\.(?:jpe?g|png|webp|gif)$/iu.test(name)) attachments.imageFiles++;
      else if (/\.(?:mp3|m4a|wav|amr|silk|ogg|aac)$/iu.test(name)) attachments.audioFiles++;
      else attachments.otherFiles++;
    }
    return false;
  } });
  const chat = Object.entries(files).find(([name]) => /(^|\/)聊天记录\.txt$/iu.test(filename(name)))?.[1];
  if (!chat) throw new Error("压缩包里没有找到“聊天记录.txt”。");
  if (chat.length > MAX_TEXT_BYTES) throw new Error("聊天文字过长，暂不支持预览。");
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(chat).replace(/^\uFEFF/u, ""); }
  catch { throw new Error("聊天记录.txt 不是可读取的 UTF-8 文字。"); }
  const preview: WechatZipPreview = {
    totalMessages: 0, textMessages: 0, voicePlaceholders: 0, imageReferences: 0, otherReferences: 0,
    namedMessages: 0, timedMessages: 0, speakerLabels: [], ...attachments,
  };
  const messages: ZipMessage[] = [];
  for (const block of content.split(/(?:\r?\n){2,}/u)) {
    const lines = block.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    const structured = lines.length >= 3 && /^·\S/u.test(lines[0]) && dateLine.test(lines[1]);
    const body = structured ? lines.slice(2).join(" ") : lines.join(" ");
    if (!body.trim()) continue;
    preview.totalMessages++;
    let label = "";
    if (structured) {
      label = lines[0].slice(1).trim().slice(0, 80);
      preview.namedMessages++;
      preview.timedMessages++;
      if (label && !preview.speakerLabels.includes(label)) preview.speakerLabels.push(label);
    }
    const kind = messageKind(body);
    messages.push({ speaker: label, timestamp: structured ? lines[1] : "", body, kind });
    if (kind === "voice") preview.voicePlaceholders++;
    else if (kind === "image") preview.imageReferences++;
    else if (kind === "other") preview.otherReferences++;
    else preview.textMessages++;
  }
  if (!preview.totalMessages) throw new Error("聊天记录.txt 没有可预览的消息。");
  return { preview, messages };
}

export function inspectWechatZip(bytes: Uint8Array): WechatZipPreview {
  return readWechatZip(bytes).preview;
}

export function extractWechatZipText(bytes: Uint8Array, selfLabel: string) {
  const { preview, messages } = readWechatZip(bytes);
  const cleanLabels = preview.speakerLabels.every(label => label.length <= 60 && !/[：:\r\n]/u.test(label));
  if (!cleanLabels || preview.speakerLabels.length !== 2 || !preview.speakerLabels.includes(selfLabel) ||
      preview.namedMessages !== preview.totalMessages || preview.timedMessages !== preview.totalMessages ||
      preview.textMessages !== preview.totalMessages || preview.imageFiles + preview.audioFiles + preview.otherFiles > 0 ||
      messages.some(message => message.body.length > 1800)) {
    throw new Error("这份 ZIP 不是完整的双人纯文字记录；不能直接转入分析。请先核对缺失媒体和双方身份。");
  }
  const otherLabel = preview.speakerLabels.find(label => label !== selfLabel)!;
  return {
    me: selfLabel,
    other: otherLabel,
    text: messages.map(message => `${message.timestamp} ${message.speaker}：${message.body}`).join("\n"),
  };
}
