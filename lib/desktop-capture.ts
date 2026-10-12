/** Browser-safe capture contract. Original text, timestamps and source labels are retained verbatim. */
export type CaptureKind = "chat" | "moments";
export type CaptureRecordKind = "text" | "image" | "sticker" | "post" | "other";
export type CaptureImage = { mime: "image/png" | "image/jpeg" | "image/webp"; data: string; name: string };
export type CaptureSource = { label: string; [key: string]: unknown };
export type CaptureRecord = {
  /** Only use an ID supplied by the source which remains stable across captures; otherwise omit it. */
  id?: string;
  kind: CaptureRecordKind;
  sender: string;
  senderRole: "self" | "other" | "unknown";
  at: string;
  text: string;
  /** True only when image/sticker text was actually read and checked, never for a UI placeholder. */
  ocrTextVerified?: boolean;
  source: CaptureSource;
  images?: CaptureImage[];
};
export type CaptureBatch = { version: 1; kind: CaptureKind; friend: string; account: string; capturedAt: string; records: CaptureRecord[]; warnings: string[] };
export type CaptureNamespace = { ownerId: string; account: string; friend: string; kind: CaptureKind };
export type StoredCaptureRecord = CaptureRecord & { localId: string; namespace: string; firstCapturedAt: string; lastCapturedAt: string };
export type CaptureMerge = { added: number; repeated: number; total: number; newRecords: StoredCaptureRecord[]; records: StoredCaptureRecord[] };
export const CAPTURE_LIMITS = { recordsPerBatch: 1000, recordsPerLibrary: 20000, textPerRecord: 30000, imageBytes: 5_000_000, batchImageBytes: 20_000_000, imagesPerRecord: 9 } as const;

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function field(value: unknown, label: string, maximum: number, required = false): string {
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim()) || /\u0000/.test(value)) throw new Error(`${label}格式不正确或过长。`);
  return value;
}
function sourceValue(value: unknown, depth = 0): unknown {
  if (depth > 4) throw new Error("来源信息层级过多。");
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (typeof value === "string") return field(value, "来源信息", 2000);
  if (Array.isArray(value) && value.length <= 50) return value.map(item => sourceValue(item, depth + 1));
  if (object(value) && Object.keys(value).length <= 30) return Object.fromEntries(Object.entries(value).filter(([key]) => !["__proto__", "constructor", "prototype"].includes(key)).map(([key, item]) => [field(key, "来源字段", 80, true), sourceValue(item, depth + 1)]));
  throw new Error("来源信息必须是简短的普通数据。");
}
export function captureImageBytes(data: string): number { return data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0); }
function image(value: unknown): CaptureImage {
  if (!object(value) || !["image/png", "image/jpeg", "image/webp"].includes(String(value.mime))) throw new Error("采集图片仅支持 PNG、JPG、WebP。");
  const data = field(value.data, "图片内容", Math.ceil(CAPTURE_LIMITS.imageBytes / 3) * 4, true);
  if (data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || captureImageBytes(data) > CAPTURE_LIMITS.imageBytes) throw new Error("图片编码不正确，或单张超过 5 MB。");
  const head = atob(data.slice(0, 24));
  const valid = value.mime === "image/png" ? head.startsWith("\x89PNG\r\n\x1a\n") : value.mime === "image/jpeg" ? head.startsWith("\xff\xd8\xff") : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
  if (!valid) throw new Error("图片内容与声明格式不一致。");
  return { mime: value.mime as CaptureImage["mime"], data, name: field(value.name ?? "截图", "图片名称", 240, true) };
}
export function validateCaptureBatch(value: unknown): CaptureBatch {
  if (!object(value) || value.version !== 1 || !["chat", "moments"].includes(String(value.kind))) throw new Error("不支持这份采集数据的版本或类型。");
  const account = field(value.account, "微信账号", 200, true), friend = field(value.friend, "联系人", 200, true);
  const capturedAt = field(value.capturedAt, "采集时间", 80, true);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt))) throw new Error("采集时间必须是完整的 ISO 日期时间。");
  if (!Array.isArray(value.records) || value.records.length > CAPTURE_LIMITS.recordsPerBatch) throw new Error("每批最多 1000 条记录，请分批采集。");
  let imageBytes = 0;
  const records = value.records.map((row): CaptureRecord => {
    if (!object(row) || !["text", "image", "sticker", "post", "other"].includes(String(row.kind)) || !object(row.source)) throw new Error("记录类型或来源信息不正确。");
    const source = sourceValue(row.source) as CaptureSource;
    field(source.label, "原文来源", 500, true);
    if (row.images !== undefined && (!Array.isArray(row.images) || row.images.length > CAPTURE_LIMITS.imagesPerRecord)) throw new Error("单条记录最多携带 9 张图片。");
    const images = row.images === undefined ? undefined : (row.images as unknown[]).map(image);
    for (const item of images || []) imageBytes += captureImageBytes(item.data);
    if (imageBytes > CAPTURE_LIMITS.batchImageBytes) throw new Error("本批图片合计超过 20 MB，请分批采集。");
    const text = field(row.text, "原文", CAPTURE_LIMITS.textPerRecord);
    if (!text.trim() && !images?.length) throw new Error("记录需要原文或图片，不能只保存空条目。");
    const id = row.id === undefined || row.id === "" ? undefined : field(row.id, "来源编号", 300, true);
    const senderRole = row.senderRole ?? "unknown";
    if (!["self", "other", "unknown"].includes(String(senderRole))) throw new Error("说话人身份应为 self、other 或 unknown。");
    if (row.ocrTextVerified !== undefined && typeof row.ocrTextVerified !== "boolean") throw new Error("图片文字核验标记格式不正确。");
    return { ...(id ? { id } : {}), kind: row.kind as CaptureRecordKind, sender: field(row.sender, "说话人", 200), senderRole: senderRole as CaptureRecord["senderRole"], at: field(row.at, "原文时间", 120), text, ...(row.ocrTextVerified !== undefined ? { ocrTextVerified: row.ocrTextVerified } : {}), source, ...(images ? { images } : {}) };
  });
  if (value.warnings !== undefined && (!Array.isArray(value.warnings) || value.warnings.length > 100)) throw new Error("采集提示格式不正确。");
  return { version: 1, kind: value.kind as CaptureKind, account, friend, capturedAt, records, warnings: ((value.warnings || []) as unknown[]).map(item => field(item, "采集提示", 2000)) };
}

const normalized = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
/** Non-security identifier. Deduplication also compares full canonical records, never hashes alone. */
function hash(value: string): string {
  let a = 2166136261, b = 2246822519;
  for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index); a = Math.imul(a ^ code, 16777619); b = Math.imul(b ^ code, 3266489917); }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
export function captureNamespaceKey(namespace: CaptureNamespace): string {
  field(namespace.ownerId, "登录账号", 200, true); field(namespace.account, "微信账号", 200, true); field(namespace.friend, "联系人", 200, true);
  if (!["chat", "moments"].includes(namespace.kind)) throw new Error("采集类型不正确。");
  return JSON.stringify([namespace.ownerId, namespace.account, namespace.friend, namespace.kind]);
}
export function captureLibraryId(namespace: CaptureNamespace): string { return "capture:" + captureNamespaceKey(namespace); }
function bodyKey(record: CaptureRecord): string { return JSON.stringify([record.kind, normalized(record.sender), record.senderRole || "unknown", normalized(record.text), record.ocrTextVerified === true, (record.images || []).map(item => [item.mime, item.data])]); }
function sequenceKey(record: CaptureRecord): string { return JSON.stringify([normalized(record.at), bodyKey(record)]); }
function absoluteTime(record: CaptureRecord, kind: CaptureKind): boolean {
  const value = normalized(record.at);
  const date = value.match(/(?:^|[^\d])(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日|\b|(?=\s|T))/);
  if (!date) return false;
  const parsed = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])));
  if (parsed.getUTCFullYear() !== Number(date[1]) || parsed.getUTCMonth() + 1 !== Number(date[2]) || parsed.getUTCDate() !== Number(date[3])) return false;
  return /(?:\s|T)\d{1,2}[:：]\d{2}/.test(value) || (kind === "moments" && (normalized(record.text).length >= 8 || !!record.images?.length));
}

/** Conservative, order-aware merge. Ambiguous undated short replies are retained rather than erased. */
export function mergeCaptureRecords(existing: StoredCaptureRecord[], input: unknown, namespace: CaptureNamespace): CaptureMerge {
  const batch = validateCaptureBatch(input), key = captureNamespaceKey(namespace);
  if (batch.account !== namespace.account || batch.friend !== namespace.friend || batch.kind !== namespace.kind) throw new Error("这批材料与当前账号、联系人或类型不一致。");
  if (existing.some(row => row.namespace !== key)) throw new Error("不能合并其他账号或联系人的原文。");
  const records = existing.map(row => ({ ...row })), newRecords: StoredCaptureRecord[] = [];
  const matched = new Map<number, number>(), used = new Set<number>();
  const oldBodies = existing.map(bodyKey), nextBodies = batch.records.map(bodyKey), oldKeys = existing.map(sequenceKey), nextKeys = batch.records.map(sequenceKey);
  const candidates = new Map<string, number[]>();
  oldKeys.forEach((value, index) => { const indexes = candidates.get(value) || []; indexes.push(index); candidates.set(value, indexes); });
  // Native source IDs identify a message. A changed body is a separate retained revision.
  const stable = new Map<string, number>();
  existing.forEach((row, index) => { if (row.id) stable.set(JSON.stringify([row.id, oldBodies[index]]), index); });
  batch.records.forEach((row, index) => { const match = row.id ? stable.get(JSON.stringify([row.id, nextBodies[index]])) : undefined; if (match !== undefined) { matched.set(index, match); used.add(match); } });
  // Absolute timestamps allow matching repeated imports, preserving occurrence counts within each batch.
  batch.records.forEach((row, index) => {
    if (matched.has(index) || row.id || !absoluteTime(row, batch.kind)) return;
    const match = (candidates.get(nextKeys[index]) || []).find(old => !used.has(old) && !existing[old].id);
    if (match !== undefined) { matched.set(index, match); used.add(match); }
  });
  const equalAt = (incoming: number, old: number) => nextKeys[incoming] === oldKeys[old] && !(batch.records[incoming].id && existing[old].id && batch.records[incoming].id !== existing[old].id);
  const runs: Array<{ incoming: number; old: number; length: number }> = [];
  for (let incoming = 0; incoming < batch.records.length; incoming++) {
    const all = candidates.get(nextKeys[incoming]) || [];
    // Highly repetitive windows are ambiguous; avoiding their collapse is preferable to losing messages.
    if (all.length > 200) continue;
    for (const old of all) {
      if (incoming > 0 && old > 0 && equalAt(incoming - 1, old - 1)) continue;
      let length = 0;
      while (incoming + length < batch.records.length && old + length < existing.length && equalAt(incoming + length, old + length)) length++;
      const rows = batch.records.slice(incoming, incoming + length);
      const anchor = rows.some((row, offset) => matched.get(incoming + offset) === old + offset || absoluteTime(row, batch.kind));
      const context = length >= 3 && new Set(nextKeys.slice(incoming, incoming + length)).size >= 2 && rows.reduce((sum, row) => sum + normalized(row.text).length, 0) >= 24 && rows.some(row => normalized(row.text).length >= 8);
      if ((length >= 2 && anchor) || context) runs.push({ incoming, old, length });
    }
  }
  runs.sort((a, b) => b.length - a.length || b.old - a.old || a.incoming - b.incoming);
  for (const run of runs) {
    let conflict = false;
    for (let offset = 0; offset < run.length; offset++) { const next = run.incoming + offset, old = run.old + offset; if ((matched.has(next) && matched.get(next) !== old) || (used.has(old) && matched.get(next) !== old)) { conflict = true; break; } }
    if (conflict) continue;
    for (let offset = 0; offset < run.length; offset++) { matched.set(run.incoming + offset, run.old + offset); used.add(run.old + offset); }
  }
  const stableAdded = new Map<string, number>();
  batch.records.forEach((row, index) => {
    const nativeKey = row.id ? JSON.stringify([row.id, nextBodies[index]]) : "";
    const old = matched.get(index) ?? (nativeKey ? stableAdded.get(nativeKey) : undefined);
    if (old !== undefined) { records[old] = { ...records[old], lastCapturedAt: batch.capturedAt }; return; }
    const localId = `record:${hash(key)}:${records.length + 1}:${hash(sequenceKey(row) + (row.id || ""))}`;
    const stored: StoredCaptureRecord = { ...row, localId, namespace: key, firstCapturedAt: batch.capturedAt, lastCapturedAt: batch.capturedAt };
    if (nativeKey) stableAdded.set(nativeKey, records.length);
    records.push(stored); newRecords.push(stored);
  });
  if (records.length > CAPTURE_LIMITS.recordsPerLibrary) throw new Error("本机该联系人原文库已达 2 万条，请先导出或清理旧材料。");
  return { added: newRecords.length, repeated: batch.records.length - newRecords.length, total: records.length, newRecords, records };
}
