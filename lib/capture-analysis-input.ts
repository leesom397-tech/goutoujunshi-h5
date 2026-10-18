export type CaptureAnalysisRow = { localId: string; kind: string; sender: string; senderRole: "self" | "other" | "unknown"; at: string; text: string; source?: import("./capture-material").CaptureMaterialMetadata; ocrTextVerified?: boolean; images: Array<{ mime: string; data: string; name: string }> };
export type CaptureMemoryRow = { localId: string; kind: "text"; senderRole: "self" | "other"; at: string; text: string; sourceLocalId?: string; sourceKind?: "chat" | "moments"; libraryId?: string; mediaId?: string; basis?: "visual" | "caption"; materialRole?: import("./capture-material").CaptureMaterialRole; pinned?: boolean };
export type RelatedCaptureSnapshot = { libraryId: string; kind: "moments"; expectedTotal: number; expectedEpoch: number };
export type CaptureAnalysisInput = { kind: "chat" | "moments"; friend: string; subjectId: string | null; requestId: string; question?: "panorama" | "attitude" | "trend" | "worth" | "next" | "risk"; analysisScope: "selected" | "fullHistory"; libraryId: string | null; expectedTotal: number | null; expectedEpoch: number | null; relatedSnapshots: RelatedCaptureSnapshot[]; records: CaptureAnalysisRow[]; photoPreviews: CaptureAnalysisRow[]; historyRecords: CaptureMemoryRow[]; activityRecords: ChatActivityRecord[] };
export const CAPTURE_ANALYSIS_LIMIT = { chat: 40, moments: 12 };
export const CAPTURE_MEMORY_LIMIT = { records: 1000, characters: 60000 };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function captureReadableText(row: { kind: string; text: string; ocrTextVerified?: boolean }): string {
  if (row.kind === "text") return row.text;
  if (row.kind !== "sticker" || row.ocrTextVerified !== true || /^[\s\[\]【】()（）]*(?:动画表情|表情包?|贴纸|sticker|emoji)[\s\[\]【】()（）]*$/iu.test(row.text)) return "";
  return row.text;
}
export function captureAnalysisInput(value: unknown): CaptureAnalysisInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("材料格式不正确。");
  const v = value as Record<string, unknown>;
  if (v.confirmed !== true) throw Error("请先确认本次材料与分析范围。");
  if (v.kind !== "chat" && v.kind !== "moments") throw Error("请选择聊天或朋友圈。");
  if (typeof v.requestId !== "string" || !uuid.test(v.requestId)) throw Error("分析编号无效。");
  const fullHistory = v.analysisScope === "fullHistory";
  if (v.analysisScope !== undefined && v.analysisScope !== "selected" && !fullHistory) throw Error("分析范围不正确。");
  if (!Array.isArray(v.records) || (fullHistory ? v.records.length !== 0 : !v.records.length || v.records.length > CAPTURE_ANALYSIS_LIMIT[v.kind])) throw Error(fullHistory ? "完整报告由已同步的整份材料生成，无需逐条勾选。" : "本批材料数量不正确，请分批分析。");
  const str = (s: unknown, max: number) => typeof s === "string" && s.length <= max ? s.trim() : "";
  const friend = str(v.friend, 100);
  if (!friend) throw Error("请填写这份材料对应的好友。");
  const subjectId = v.subjectId ? str(v.subjectId, 36) : null;
  if (v.subjectId && !uuid.test(subjectId || "")) throw Error("人物编号不正确。");
  const libraryId = fullHistory ? str(v.libraryId, 67) : null;
  const expectedTotal = fullHistory ? v.expectedTotal : null, expectedEpoch = fullHistory ? v.expectedEpoch : null;
  if (fullHistory && (!/^cl_[a-f0-9]{64}$/.test(libraryId || "") || !Number.isSafeInteger(expectedTotal) || Number(expectedTotal) < 1 || !Number.isSafeInteger(expectedEpoch) || Number(expectedEpoch) < 1)) throw Error("请先把这个人的完整材料同步到资料库，再生成报告。");
  if (fullHistory && (v.historyRecords !== undefined || v.activityRecords !== undefined)) throw Error("完整报告直接读取已同步的材料，请更新页面后重试。");
  if (v.relatedSnapshots !== undefined && (!fullHistory || !Array.isArray(v.relatedSnapshots))) throw Error("联合资料范围不正确。");
  const relatedSnapshots: RelatedCaptureSnapshot[] = ((v.relatedSnapshots || []) as unknown[]).map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("朋友圈资料范围不正确。");
    const row = raw as Record<string, unknown>;
    if (row.kind !== "moments" || typeof row.libraryId !== "string" || !/^cl_[a-f0-9]{64}$/.test(row.libraryId) || !Number.isSafeInteger(row.expectedTotal) || Number(row.expectedTotal) < 1 || !Number.isSafeInteger(row.expectedEpoch) || Number(row.expectedEpoch) < 1) throw Error("请先同步这份朋友圈再生成联合报告。");
    return {libraryId: row.libraryId, kind: "moments", expectedTotal: Number(row.expectedTotal), expectedEpoch: Number(row.expectedEpoch)};
  });
  if (relatedSnapshots.length > 20 || relatedSnapshots.length && (!subjectId || v.kind !== "chat")) throw Error("请把聊天与朋友圈关联到同一个人物；一次最多关联20份朋友圈资料。");
  if (new Set(relatedSnapshots.map(row=>row.libraryId)).size !== relatedSnapshots.length || relatedSnapshots.some(row=>row.libraryId===libraryId)) throw Error("联合资料有重复来源，请重新核对。");
  let imageBytes = 0, imageCount = 0, textSize = 0;
  const records = v.records.map((raw): CaptureAnalysisRow => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("原始条目格式不正确。");
    const r = raw as Record<string, unknown>;
    const localId = str(r.localId, 200);
    if (!localId || typeof r.text !== "string" || r.text.length > 6000 || /\u0000/.test(r.text)) throw Error("单条材料过长或缺少来源编号。");
    const text = r.text;
    if (!["text", "image", "sticker", "post", "other"].includes(String(r.kind))) throw Error("原始条目类型不正确。");
    const senderRole = r.senderRole === "self" || r.senderRole === "other" ? r.senderRole : "unknown";
    if (v.kind === "chat" && r.kind === "post") throw Error("朋友圈条目请使用朋友圈分析。");
    const readable = captureReadableText({ kind: String(r.kind), text, ocrTextVerified: r.ocrTextVerified === true });
    if (v.kind === "chat" && readable.trim() && senderRole === "unknown") throw Error("部分文字还没有确认是谁说的，请核对身份后再分析。");
    if (v.kind === "chat" && readable && ((r.kind === "sticker" ? "【表情包文字】" : "") + readable.replace(/[\r\n]+/g, " ").trim()).length > 1800) throw Error("单条聊天超过 1800 字，请拆成较短材料。");
    if (r.images !== undefined && !Array.isArray(r.images)) throw Error("图片格式不正确。");
    const images = (Array.isArray(r.images) ? r.images : []).map((image): { mime: string; data: string; name: string } => {
      if (!image || typeof image !== "object") throw Error("图片格式不正确。");
      const mime = str(image.mime, 20), data = str(image.data, 3_000_000);
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime) || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw Error("来源图片过大或格式不支持。");
      const head = atob(data.slice(0, 24));
      if (!(mime === "image/png" ? head.startsWith("\x89PNG\r\n\x1a\n") : mime === "image/jpeg" ? head.startsWith("\xff\xd8\xff") : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP")) throw Error("图片内容与格式不一致。");
      imageBytes += data.length; imageCount++;
      return { mime, data, name: str(image.name, 120) };
    });
    textSize += text.length;
    for (const [key, max] of [["sender", 200], ["at", 120]] as const) if (r[key] !== undefined && (typeof r[key] !== "string" || (r[key] as string).length > max)) throw Error("说话人或时间格式不正确。");
    const metadata = r.source && typeof r.source === "object" && !Array.isArray(r.source) ? r.source as Record<string,unknown> : {};
    if(metadata.materialRole !== undefined && !["moment","moments-cover","profile-signature"].includes(String(metadata.materialRole))) throw Error("材料来源角色不正确。");
    const source = v.kind === "moments" ? {materialRole:captureMaterialRole(metadata),pinned:captureMaterialRole(metadata)==="moment"&&metadata.pinned===true} : undefined;
    return { localId, kind: String(r.kind), sender: typeof r.sender === "string" ? r.sender : "", senderRole, at: typeof r.at === "string" ? r.at : "", text, ...(source?{source}:{}), ocrTextVerified: r.ocrTextVerified === true, images };
  });
  if (new Set(records.map(r => r.localId)).size !== records.length) throw Error("材料存在重复来源编号。");
  if (textSize > 24000 || imageBytes > 9_000_000 || imageCount > 9) throw Error("这批材料过多，请减少条目或图片后再分析。");
  if (v.kind === "chat" && records.reduce((size, r) => size + (captureReadableText(r) ? captureReadableText(r).length + 12 : 0), 0) > 12000) throw Error("本批聊天文字过长，请减少条目后再分析。");
  if (!fullHistory && !records.some(r => v.kind === "moments" ? r.text.trim() || r.images.length : captureReadableText(r).trim())) throw Error("本批没有可读取的内容。图片聊天请使用截图分析。");
  if (v.historyRecords !== undefined && (!Array.isArray(v.historyRecords) || v.kind !== "chat" || v.historyRecords.length > CAPTURE_MEMORY_LIMIT.records)) throw Error("资料参考范围过大或格式不正确。");
  let memoryCharacters = 0;
  const historyRecords = ((v.historyRecords || []) as unknown[]).map((raw): CaptureMemoryRow => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("资料参考原文格式不正确。");
    const r = raw as Record<string, unknown>, localId = str(r.localId, 200);
    if (!localId || r.kind !== "text" || !["self", "other"].includes(String(r.senderRole)) || typeof r.text !== "string" || !r.text.trim() || r.text.length > 6000 || /\u0000/.test(r.text) || typeof r.at !== "string" || r.at.length > 120 || r.images !== undefined) throw Error("资料参考须为已核对身份的文字或语音转写。");
    memoryCharacters += r.text.length;
    const selected = records.find(row => row.localId === localId);
    if (selected && (selected.text !== r.text || selected.senderRole !== r.senderRole || selected.at !== r.at || selected.kind !== "text")) throw Error("同一条原文的内容或身份不一致，请重新核对。");
    return { localId, kind: "text", senderRole: r.senderRole as "self" | "other", at: r.at, text: r.text };
  });
  if (new Set(historyRecords.map(row => row.localId)).size !== historyRecords.length || memoryCharacters > CAPTURE_MEMORY_LIMIT.characters) throw Error("资料参考存在重复编号或文字超出范围。");
  if (v.activityRecords !== undefined && v.kind !== "chat") throw Error("聊天统计仅用于聊天材料。");
  const activityRecords = v.activityRecords === undefined ? [] : parseChatActivityRecords(v.activityRecords);
  const question = ["panorama", "attitude", "trend", "worth", "next", "risk"].includes(String(v.question)) ? v.question as CaptureAnalysisInput["question"] : undefined;
  const photoPreviews = fullHistory && Array.isArray(v.photoPreviews) ? v.photoPreviews.slice(0, 4).map((raw): CaptureAnalysisRow => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("聊天照片格式不正确。");
    const r = raw as Record<string, unknown>;
    const localId = str(r.localId, 200);
    const images = (Array.isArray(r.images) ? r.images : []).slice(0, 1).map((image): { mime: string; data: string; name: string } => {
      if (!image || typeof image !== "object") throw Error("聊天照片格式不正确。");
      const mime = str((image as { mime?: unknown }).mime, 20), data = str((image as { data?: unknown }).data, 300_000);
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime) || !data) throw Error("聊天照片格式不支持。");
      return { mime, data, name: str((image as { name?: unknown }).name, 120) };
    });
    if (!localId || !images.length) throw Error("聊天照片缺少来源。");
    return { localId, kind: "image", sender: "", senderRole: r.senderRole === "self" ? "self" : "other", at: str(r.at, 120), text: "[图片]", images };
  }) : [];
  return { kind: v.kind, requestId: v.requestId, friend, subjectId, question, analysisScope: fullHistory ? "fullHistory" : "selected", libraryId, expectedTotal: fullHistory ? Number(expectedTotal) : null, expectedEpoch: fullHistory ? Number(expectedEpoch) : null, relatedSnapshots, records, photoPreviews, historyRecords, activityRecords };
}
import { parseChatActivityRecords, type ChatActivityRecord } from "./chat-activity";
import { captureMaterialRole } from "./capture-material";
