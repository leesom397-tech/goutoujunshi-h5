export type CaptureAnalysisRow = { localId: string; kind: string; sender: string; senderRole: "self" | "other" | "unknown"; at: string; text: string; ocrTextVerified?: boolean; images: Array<{ mime: string; data: string; name: string }> };
export type CaptureAnalysisInput = { kind: "chat" | "moments"; friend: string; subjectId: string | null; requestId: string; records: CaptureAnalysisRow[] };
export const CAPTURE_ANALYSIS_LIMIT = { chat: 40, moments: 12 };
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
  if (!Array.isArray(v.records) || !v.records.length || v.records.length > CAPTURE_ANALYSIS_LIMIT[v.kind]) throw Error("本批材料数量不正确，请分批分析。");
  const str = (s: unknown, max: number) => typeof s === "string" && s.length <= max ? s.trim() : "";
  const friend = str(v.friend, 100);
  if (!friend) throw Error("请填写这份材料对应的好友。");
  const subjectId = v.subjectId ? str(v.subjectId, 36) : null;
  if (v.subjectId && !uuid.test(subjectId || "")) throw Error("人物编号不正确。");
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
    return { localId, kind: String(r.kind), sender: typeof r.sender === "string" ? r.sender : "", senderRole, at: typeof r.at === "string" ? r.at : "", text, ocrTextVerified: r.ocrTextVerified === true, images };
  });
  if (new Set(records.map(r => r.localId)).size !== records.length) throw Error("材料存在重复来源编号。");
  if (textSize > 24000 || imageBytes > 9_000_000 || imageCount > 9) throw Error("这批材料过多，请减少条目或图片后再分析。");
  if (v.kind === "chat" && records.reduce((size, r) => size + (captureReadableText(r) ? captureReadableText(r).length + 12 : 0), 0) > 12000) throw Error("本批聊天文字过长，请减少条目后再分析。");
  if (!records.some(r => v.kind === "moments" ? r.text.trim() || r.images.length : captureReadableText(r).trim())) throw Error("本批没有可读取的内容。图片聊天请使用截图分析。");
  return { kind: v.kind, requestId: v.requestId, friend, subjectId, records };
}
