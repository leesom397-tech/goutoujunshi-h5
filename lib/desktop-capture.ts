import {captureMaterialRole} from "./capture-material";
/** Browser-safe capture contract. Original text, timestamps and source labels are retained verbatim. */
export type CaptureKind = "chat" | "moments";
export type CaptureRecordKind = "text" | "image" | "sticker" | "post" | "other";
export type CaptureImage = { mime: "image/png" | "image/jpeg" | "image/webp"; data: string; name: string };
export type CaptureSource = { label: string; materialRole?: import("./capture-material").CaptureMaterialRole; pinned?: boolean; [key: string]: unknown };
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
export type CaptureCoverage = { scope: "all-visible" | "requested-count"; complete: boolean; stopReason: "scanning" | "visible-end" | "requested-count" | "focus-unavailable" | "unreadable-posts" | "navigation-stalled"; recordCount: number; momentCount?: number; profileMaterialCount?: number; imageOmittedCount: number; unreadableCount: number };
export type CaptureBatch = { version: 1; kind: CaptureKind; friend: string; account: string; capturedAt: string; records: CaptureRecord[]; warnings: string[]; coverage?: CaptureCoverage };
export type CaptureNamespace = { ownerId: string; account: string; friend: string; kind: CaptureKind };
export type StoredCaptureRecord = CaptureRecord & { localId: string; namespace: string; firstCapturedAt: string; lastCapturedAt: string };
export type CaptureMerge = { added: number; repeated: number; updatedVoice: number; total: number; newRecords: StoredCaptureRecord[]; records: StoredCaptureRecord[] };
export const CAPTURE_LIMITS = { recordsPerBatch: 1000, textPerRecord: 30000, imageBytes: 5_000_000, batchImageBytes: 20_000_000, imagesPerRecord: 9 } as const;

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
    if (source.materialRole !== undefined && !["moment", "moments-cover", "profile-signature"].includes(source.materialRole) || source.pinned !== undefined && typeof source.pinned !== "boolean" || source.pinned === true && source.materialRole !== undefined && source.materialRole !== "moment") throw Error("朋友圈材料来源类型不正确。");
    if (source.databaseIdentity !== undefined) throw new Error("数据库关联凭据只能由本机原文核对生成，不能从导入材料指定。");
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
    return { ...(id ? { id } : {}), kind: row.kind as CaptureRecordKind, sender: field(row.sender, "说话人", 200), senderRole: senderRole as CaptureRecord["senderRole"], at: field(row.at, "原文时间", 120), text, ...(row.ocrTextVerified !== undefined ? { ocrTextVerified: row.ocrTextVerified as boolean } : {}), source, ...(images ? { images } : {}) };
  });
  if (value.warnings !== undefined && (!Array.isArray(value.warnings) || value.warnings.length > 100)) throw new Error("采集提示格式不正确。");
  let coverage: CaptureCoverage | undefined;
  if (value.coverage !== undefined) {
    const c = value.coverage;
    if (value.kind !== "moments" || !object(c) || !["all-visible", "requested-count"].includes(String(c.scope)) || typeof c.complete !== "boolean"
      || !["scanning", "visible-end", "requested-count", "focus-unavailable", "unreadable-posts", "navigation-stalled"].includes(String(c.stopReason))
      || [c.recordCount, c.imageOmittedCount, c.unreadableCount].some(count => !Number.isSafeInteger(count) || Number(count) < 0)
      || c.complete && c.stopReason !== "visible-end") throw Error("朋友圈采集范围信息不完整，请更新助手后重试。");
    coverage = { scope: c.scope as CaptureCoverage["scope"], complete: c.complete, stopReason: c.stopReason as CaptureCoverage["stopReason"], recordCount: Number(c.recordCount), imageOmittedCount: Number(c.imageOmittedCount), unreadableCount: Number(c.unreadableCount) };
    for (const key of ["momentCount", "profileMaterialCount"] as const) if (c[key] !== undefined) {
      if (!Number.isSafeInteger(c[key]) || Number(c[key]) < 0 || Number(c[key]) > coverage.recordCount) throw Error("朋友圈材料数量不正确。");
      coverage[key] = Number(c[key]);
    }
    if (coverage.momentCount !== undefined && coverage.profileMaterialCount !== undefined && coverage.momentCount + coverage.profileMaterialCount !== coverage.recordCount) throw Error("朋友圈材料数量不一致。");
  }
  return { version: 1, kind: value.kind as CaptureKind, account, friend, capturedAt, records, warnings: ((value.warnings || []) as unknown[]).map(item => field(item, "采集提示", 2000)), ...(coverage ? { coverage } : {}) };
}

/** Split a bounded bridge snapshot into normal storage batches before validation.
 * Validation stays at 1000 rows; all-visible capture is not silently truncated.
 * Validate every chunk before returning so malformed later rows cannot partially import.
 */
export function splitCaptureBatch(value: unknown): CaptureBatch[] {
  if (!object(value) || !Array.isArray(value.records)) throw Error("采集数据缺少原文记录。");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 32 * 1024 * 1024) throw Error("采集快照超过传输容量，已保存的材料仍可查看，请分次采集。");
  const batches: CaptureBatch[] = [];
  for (let offset = 0; offset < Math.max(1, value.records.length); offset += CAPTURE_LIMITS.recordsPerBatch) {
    const last = offset + CAPTURE_LIMITS.recordsPerBatch >= value.records.length;
    const coverage = object(value.coverage) && !last ? { ...value.coverage, complete: false, stopReason: "scanning" } : value.coverage;
    batches.push(validateCaptureBatch({ ...value, records: value.records.slice(offset, offset + CAPTURE_LIMITS.recordsPerBatch), ...(coverage ? { coverage } : {}) }));
  }
  return batches;
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

/** Snapshot made before conversion. The signature is diagnostic; full fields are compared too. */
export type VoiceOriginalSource = {
  localId: string; namespace: string; index: number; kind: "other"; id: string;
  sender: string; senderRole: CaptureRecord["senderRole"]; at: string; text: string;
  source: CaptureSource; signature: string;
};
export type VerifiedVoiceUpdate = {
  localId: string; text: string; verified: true; matchedAnchors: [string, string];
  originalSource: VoiceOriginalSource;
  source: { transcriptionSource: "wechat-native-transcript-copy"; [key: string]: unknown };
};
export type VerifiedVoiceUpdates = {
  libraryId: string; account: string; friend: string; capturedAt: string; updates: VerifiedVoiceUpdate[];
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (object(value)) return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
export function captureVoiceOriginalSource(record: StoredCaptureRecord, index: number): VoiceOriginalSource {
  if (!Number.isSafeInteger(index) || index < 0 || !voiceDescriptor(record)?.placeholder || record.senderRole === "unknown") throw Error("只能为已确认身份的原始语音建立补全凭据。");
  field(record.localId, "原文编号", 300, true); field(record.namespace, "原文归属", 1000, true);
  field(record.text, "原始语音标记", 2000, true);
  const source = sourceValue(record.source) as CaptureSource;
  for (const key of ["index", "uiIndex"]) if (source[key] !== undefined && (!Number.isSafeInteger(source[key]) || Number(source[key]) < 0)) throw Error("语音来源序号无效。");
  const snapshot = { localId: record.localId, namespace: record.namespace, index, kind: "other" as const, id: record.id || "", sender: record.sender, senderRole: record.senderRole, at: record.at, text: record.text, source };
  return { ...snapshot, signature: hash(canonical(snapshot)) };
}

/** Apply verified native transcripts only to their original rows; never append or reorder. */
export function applyVerifiedVoiceUpdatesToRecords(existing: StoredCaptureRecord[], input: unknown, namespace: CaptureNamespace): { records: StoredCaptureRecord[]; updatedVoice: number; repeated: number; total: number } {
  const key = captureNamespaceKey(namespace);
  if (!object(input) || namespace.kind !== "chat" || input.libraryId !== captureLibraryId(namespace) || input.account !== namespace.account || input.friend !== namespace.friend) throw Error("语音补全与当前账号、联系人或原文库不一致。");
  const capturedAt = field(input.capturedAt, "补全时间", 80, true);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt))) throw Error("语音补全时间无效。");
  if (!Array.isArray(input.updates) || !input.updates.length || input.updates.length > 100) throw Error("每批只能补全 1 至 100 条已核对语音。");
  const positions = new Map<string, number>();
  existing.forEach((row, index) => {
    if (row.namespace !== key || positions.has(row.localId)) throw Error("原文库归属或来源编号冲突。");
    positions.set(row.localId, index);
  });
  const records = existing.slice(); let updatedVoice = 0, repeated = 0;
  for (const value of input.updates) {
    if (!object(value) || value.verified !== true || !object(value.source) || value.source.transcriptionSource !== "wechat-native-transcript-copy" || !object(value.originalSource)) throw Error("仅接受已核验的微信原生语音文字。");
    const localId = field(value.localId, "原文编号", 300, true), index = positions.get(localId);
    if (index === undefined) throw Error("待补全的语音不在当前原文库中。");
    const current = records[index], original = value.originalSource;
    if (original.index !== index || original.localId !== localId || original.namespace !== key || original.kind !== "other" || !object(original.source)) throw Error("原语音位置或身份凭据已变化，请重新核对。");
    const snapshot = captureVoiceOriginalSource({ ...original, source: original.source } as unknown as StoredCaptureRecord, index);
    if (canonical(snapshot) !== canonical(original)) throw Error("原语音凭据不完整或签名不一致。");
    const savedOriginal = current.source.voiceOriginalSource;
    if (voiceDescriptor(current)?.placeholder) {
      if (canonical(captureVoiceOriginalSource(current, index)) !== canonical(snapshot)) throw Error("原语音内容或来源已变化，不能覆盖。");
    } else {
      if (!voiceDescriptor(current)?.visible || !object(savedOriginal) || canonical(savedOriginal) !== canonical(snapshot)
        || current.sender !== snapshot.sender || current.senderRole !== snapshot.senderRole || current.at !== snapshot.at || (current.id || "") !== snapshot.id) throw Error("这条原文不是可核验的原语音。");
      for (const name of ["label", "method", "index", "uiIndex", "atRaw", "order", "idStability", "upstreamCommit", "contentFingerprint", "uiClass"]) {
        if (canonical(current.source[name]) !== canonical(snapshot.source[name])) throw Error("已补全语音的原始来源信息发生变化。");
      }
    }
    const originalVoice = voiceDescriptor({ ...snapshot, source: snapshot.source } as CaptureRecord)!;
    const originalSeconds = Number(originalVoice.label.match(/\d+/)![0]);
    if (voiceDescriptor(current)?.key !== originalVoice.key) throw Error("原语音的说话人、时间或时长已变化。");
    if (value.source.rawMediaLabel !== undefined && value.source.rawMediaLabel !== originalVoice.label
      || value.source.durationSeconds !== undefined && value.source.durationSeconds !== originalSeconds
      || value.source.mediaKind !== undefined && value.source.mediaKind !== "voice"
      || value.source.transcriptionStatus !== undefined && value.source.transcriptionStatus !== "visible-text") throw Error("原生转写与原语音类型或时长不一致。");
    if (!Array.isArray(value.matchedAnchors) || value.matchedAnchors.length !== 2 || value.matchedAnchors.some(id => typeof id !== "string")) throw Error("需要语音前后两条原文依据。");
    const [left, right] = value.matchedAnchors.map(id => positions.get(id));
    if (left === undefined || right === undefined || !(left < index && index < right)) throw Error("前后原文依据没有夹住这条语音。");
    // A prior update in this same transaction can establish a new native-text
    // anchor. Missing or OCR-only voice bodies never identify another source.
    for (const anchor of [records[left], records[right]]) {
      const text = normalized(anchor.text);
      const voice = voiceDescriptor(anchor);
      const markedVoice = anchor.source.mediaKind === "voice" || anchor.source.uiClass === "mmui::ChatVoiceItemView";
      const nativeVoice = voice?.visible && anchor.source.transcriptionSource === "wechat-native-transcript-copy";
      if (anchor.kind !== "text" || markedVoice && !nativeVoice || text.length < 4 || records.filter(row => row.kind === "text" && normalized(row.text) === text).length !== 1) throw Error("前后原文依据必须是唯一、完整的文字消息或已核验的原生语音文字。");
    }
    const text = field(value.text, "语音文字", 20000, true);
    if (/^(?:语音|語音)\s*\d+["”]?秒$|^Audio\s*\d+["”]?sec$|^(?:正在转文字|转文字中|转换中|转写中|转换失败|转写失败|无法转换|Transcribing|Converting|Conversion failed)[.。…!！\s]*$/i.test(text.trim())) throw Error("语音占位或转换状态不能保存为正文。");
    if (voiceDescriptor(current)?.visible) {
      if (current.text !== text) throw Error("这条语音已有不同的文字，已保留原结果，请核对后处理。");
      repeated++; continue;
    }
    if (Number.isFinite(Date.parse(current.firstCapturedAt)) && Date.parse(capturedAt) < Date.parse(current.firstCapturedAt)) throw Error("补全时间早于原文采集时间。");
    records[index] = { ...current, kind: "text", text, lastCapturedAt: capturedAt,
      source: { ...current.source, mediaKind: "voice", rawMediaLabel: originalVoice.label, durationSeconds: originalSeconds, transcriptionStatus: "visible-text", transcriptionSource: "wechat-native-transcript-copy", transcriptCapturedAt: capturedAt, voiceOriginalSource: snapshot, voiceMatchedAnchors: [...value.matchedAnchors] } };
    updatedVoice++;
  }
  return { records, updatedVoice, repeated, total: records.length };
}

function voiceDescriptor(record: CaptureRecord) {
  if (record.source.mediaKind !== "voice" && record.source.uiClass !== "mmui::ChatVoiceItemView") return null;
  const label = typeof record.source.rawMediaLabel === "string" ? record.source.rawMediaLabel : record.kind === "other" ? record.text : "";
  const head = label.trim().match(/^(?:(?:语音|語音)\d{1,5}"秒|Audio\d{1,5}"sec)/)?.[0];
  if (!head) return null;
  const seconds = Number(head.match(/\d+/)![0]);
  if (record.source.durationSeconds !== undefined && record.source.durationSeconds !== seconds) return null;
  return { label: head, key: JSON.stringify([normalized(record.sender), record.senderRole || "unknown", normalized(record.at), head]),
    visible: record.kind === "text" && record.source.transcriptionStatus === "visible-text" && !!record.text.trim(),
    placeholder: record.kind === "other" && record.source.transcriptionStatus !== "visible-text" };
}
function bodyKey(record: CaptureRecord): string {
  const voice = voiceDescriptor(record);
  // The thumbnail is only a view of a voice bubble; duration/type remain part of
  // its identity so identical transcripts do not collapse distinct messages.
  return JSON.stringify([...(captureMaterialRole(record.source)!=="moment"?[captureMaterialRole(record.source)]:[]),record.kind, normalized(record.sender), record.senderRole || "unknown", normalized(record.text), record.ocrTextVerified === true, voice ? ["voice", voice.label] : (record.images || []).map(item => [item.mime, item.data])]);
}
function sequenceKey(record: CaptureRecord): string { return JSON.stringify([normalized(record.at), bodyKey(record)]); }
/** Database identities must include the account, conversation and message shard.
 * Never use a display name, duration or local_id alone to attach a transcript. */
function databaseVoiceIdentity(record: CaptureRecord, account: string): string | null {
  const source = record.source;
  if (!record.id || source.method !== "wechat-local-db" || source.mediaKind !== "voice" || source.accountId !== account) return null;
  const fields = [source.accountId, source.sessionId, source.messageShard, source.messageId];
  if (fields.some(value => typeof value !== "string" || !value || value.length > 300)) return null;
  return JSON.stringify([record.id, ...fields, record.sender, record.senderRole, record.at, source.durationSeconds ?? null]);
}
function isDatabaseVoice(record: CaptureRecord): boolean { return record.source.method === "wechat-local-db" && record.source.mediaKind === "voice"; }
/** This alias is created only after matching an existing UI interval. Incoming
 * batches cannot supply it. Keeping it separate preserves native transcripts. */
function databaseAlias(record: CaptureRecord, account: string): CaptureRecord | null {
  const value = record.source.databaseIdentity;
  if (!object(value) || value.version !== 1 || value.matchedBy !== "unique-text-interval-v1" || value.accountId !== account
    || value.id !== record.id || value.senderRole !== record.senderRole || !Array.isArray(value.anchors) || value.anchors.length !== 2
    || value.anchors.some(item => typeof item !== "string" || !item)) return null;
  // Older cross-source aliases were persisted without `sender`. Keep those
  // records readable by binding the alias to the sender already stored on the
  // UI row. A sender supplied by a newer alias must still agree with that row;
  // accepting a changed sender would let a stale alias move a message between
  // participants while retaining the same database IDs.
  const sender = value.sender === undefined ? record.sender : value.sender;
  if ([value.id, value.sessionId, value.messageShard, value.messageId, value.at].some(item => typeof item !== "string" || !item)
    || typeof sender !== "string" || !sender || value.sender !== undefined && value.sender !== record.sender) return null;
  return { ...record, id: String(value.id), at: String(value.at), sender: String(sender),
    source: { label: record.source.label, method: "wechat-local-db", accountId: account, sessionId: value.sessionId,
      messageShard: value.messageShard, messageId: value.messageId, ...(value.mediaKind === "voice" ? { mediaKind: "voice", durationSeconds: value.durationSeconds } : {}) } };
}
function databaseRecordIdentity(record: CaptureRecord, account: string): string | null {
  const s = record.source;
  if (s.method !== "wechat-local-db" || s.accountId !== account || !record.id
    || [s.sessionId, s.messageShard, s.messageId].some(item => typeof item !== "string" || !item)) return null;
  return JSON.stringify([record.id, account, s.sessionId, s.messageShard, s.messageId, record.senderRole, record.at,
    s.mediaKind === "voice" ? "voice" : record.kind]);
}
function isVoiceRecord(record: CaptureRecord): boolean { return record.source.mediaKind === "voice" || record.source.uiClass === "mmui::ChatVoiceItemView"; }
function uiTimeMatches(old: StoredCaptureRecord, next: CaptureRecord): boolean {
  const raw = normalized(old.at);
  if (!raw) return true;
  const nextTime = Date.parse(next.at);
  if (!Number.isFinite(nextTime)) return false;
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return Date.parse(raw) === nextTime;
  const date = raw.match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?/);
  const clock = raw.match(/(?:\s|日)(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?/);
  // Nonempty, unrecognized UI dates are not evidence of the same message.
  if (!date || !clock) return false;
  const time = new Date(+date[1], +date[2] - 1, +date[3], +clock[1], +clock[2], +(clock[3] || 0));
  if (time.getFullYear() !== +date[1] || time.getMonth() !== +date[2] - 1 || time.getDate() !== +date[3]
    || +clock[1] > 23 || +clock[2] > 59 || +(clock[3] || 0) > 59) return false;
  return clock[3] ? time.getTime() === nextTime : Math.floor(time.getTime() / 60000) === Math.floor(nextTime / 60000);
}
function crossSourceCompatible(old: StoredCaptureRecord, next: CaptureRecord): boolean {
  if (old.source.method !== "uia" || old.source.databaseIdentity || old.id || old.senderRole === "unknown"
    || old.senderRole !== next.senderRole || !uiTimeMatches(old, next)) return false;
  if (isVoiceRecord(old) || isVoiceRecord(next)) {
    if (!isVoiceRecord(old) || !isVoiceRecord(next)) return false;
    const before = voiceDescriptor(old), seconds = next.source.durationSeconds;
    if (!before || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return false;
    const shown = Number(before.label.match(/\d+/)?.[0]);
    return Math.abs(shown - seconds) < 1; // UI rounds voice duration to whole seconds.
  }
  if (old.kind !== next.kind) return false;
  if (old.kind === "text") return normalized(old.text) === normalized(next.text);
  if (old.kind === "image" || old.kind === "sticker") return true;
  return old.kind === "other" && normalized(old.text) === normalized(next.text);
}
function edgeBodyMatches(old: CaptureRecord, next: CaptureRecord): boolean {
  if (isVoiceRecord(old)) return true;
  const before = normalized(old.text), after = normalized(next.text);
  if (before === after) return true;
  const label = old.kind === next.kind ? old.kind === "image" ? "图片" : old.kind === "sticker" ? "表情包" : "" : "";
  // These are the UI and DB spellings of the same media placeholder. Do not
  // treat an OCR result, caption, or any arbitrary media body as a placeholder.
  return !!label && [label, `[${label}]`].includes(before) && [label, `[${label}]`].includes(after);
}
function crossSourceMatches(existing: StoredCaptureRecord[], batch: CaptureBatch, matched: Map<number, number>, used: Set<number>) {
  const result = new Map<number, { old: number; anchors: [string, string] }>();
  if (batch.kind !== "chat" || batch.records.length < 2 || !batch.records.every(row => databaseRecordIdentity(row, batch.account)
    && row.source.idStability === "stable" && row.source.timestampOrigin === "wechat-create-time"
    && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.at) && Number.isFinite(Date.parse(row.at)))
    || new Set(batch.records.map(row => row.source.sessionId)).size !== 1) return result;
  const textKey = (row: CaptureRecord, minimum: number) => row.kind === "text" && !isVoiceRecord(row) && row.senderRole !== "unknown"
    && Array.from(normalized(row.text)).length >= minimum && (normalized(row.text).match(/[\p{L}\p{N}]/gu)?.length || 0) >= 4
    ? JSON.stringify([row.senderRole, normalized(row.text)]) : null;
  const occurrences = (rows: CaptureRecord[], minimum = 12) => {
    const map = new Map<string, number[]>();
    rows.forEach((row, index) => { const key = textKey(row, minimum); if (key) map.set(key, [...(map.get(key) || []), index]); });
    return map;
  };
  const oldKeys = occurrences(existing), nextKeys = occurrences(batch.records), anchors: Array<[number, number]> = [...matched];
  for (const [key, indexes] of nextKeys) {
    const old = oldKeys.get(key);
    if (indexes.length !== 1 || old?.length !== 1) continue;
    const ni = indexes[0], oi = old[0];
    if (!matched.has(ni) && !used.has(oi) && crossSourceCompatible(existing[oi], batch.records[ni])) anchors.push([ni, oi]);
  }
  anchors.sort((a, b) => a[0] - b[0]);
  // Crossing anchors indicate different/missing ordering. Never choose an arbitrary subsequence.
  if (anchors.length < 2 || anchors.some((item, index) => index && item[1] <= anchors[index - 1][1])) return result;
  // A globally unique, explicitly timed short text may close a bounded edge
  // interval after the conversation order has already been established. A lone
  // short reply, emoji, or voice duration cannot establish that order itself.
  const first = anchors[0], last = anchors[anchors.length - 1], edgeAnchors: Array<[number, number]> = [];
  const shortOld = occurrences(existing, 4), shortNext = occurrences(batch.records, 4);
  for (const [key, indexes] of shortNext) {
    const old = shortOld.get(key);
    if (indexes.length !== 1 || old?.length !== 1) continue;
    const ni = indexes[0], oi = old[0];
    if (matched.has(ni) || used.has(oi) || !existing[oi].at.trim() || Array.from(normalized(batch.records[ni].text)).length >= 12) continue;
    const before = ni < first[0] && oi < first[1] && first[0] - ni <= 80 && first[1] - oi <= 80;
    const after = ni > last[0] && oi > last[1] && ni - last[0] <= 80 && oi - last[1] <= 80;
    if ((before || after) && crossSourceCompatible(existing[oi], batch.records[ni])) edgeAnchors.push([ni, oi]);
  }
  const expanded = [...anchors, ...edgeAnchors].sort((a, b) => a[0] - b[0]);
  if (!expanded.some((item, index) => index && item[1] <= expanded[index - 1][1])) anchors.splice(0, anchors.length, ...expanded);
  for (let i = 0; i + 1 < anchors.length; i++) {
    const [leftNew, leftOld] = anchors[i], [rightNew, rightOld] = anchors[i + 1];
    const proof: [string, string] = [existing[leftOld].localId, existing[rightOld].localId];
    if (!matched.has(leftNew)) result.set(leftNew, { old: leftOld, anchors: proof });
    if (!matched.has(rightNew)) result.set(rightNew, { old: rightOld, anchors: proof });
    const n = rightNew - leftNew - 1, m = rightOld - leftOld - 1;
    if (!n || !m || n > 80 || m > 80) continue;
    const compatible = Array.from({ length: n }, (_, ni) => Array.from({ length: m }, (_, oi) =>
      !matched.has(leftNew + ni + 1) && !used.has(leftOld + oi + 1)
      && crossSourceCompatible(existing[leftOld + oi + 1], batch.records[leftNew + ni + 1])));
    const prefix = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    const suffix = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let ni = 0; ni < n; ni++) for (let oi = 0; oi < m; oi++) prefix[ni + 1][oi + 1] = Math.max(
      prefix[ni][oi + 1], prefix[ni + 1][oi], prefix[ni][oi] + (compatible[ni][oi] ? 1 : 0));
    for (let ni = n - 1; ni >= 0; ni--) for (let oi = m - 1; oi >= 0; oi--) suffix[ni][oi] = Math.max(
      suffix[ni + 1][oi], suffix[ni][oi + 1], suffix[ni + 1][oi + 1] + (compatible[ni][oi] ? 1 : 0));
    const length = prefix[n][m], ranks = new Map<number, Array<[number, number]>>();
    for (let ni = 0; ni < n; ni++) for (let oi = 0; oi < m; oi++) {
      if (!compatible[ni][oi] || prefix[ni][oi] + 1 + suffix[ni + 1][oi + 1] !== length) continue;
      const rank = prefix[ni][oi] + 1;
      ranks.set(rank, [...(ranks.get(rank) || []), [leftNew + ni + 1, leftOld + oi + 1]]);
    }
    // Every longest monotonic alignment has exactly one pair at each rank.
    // Bind only the unique pair shared by all alignments, retaining ambiguous
    // repeated media/voices and unmatched system rows as separate evidence.
    for (const options of ranks.values()) if (options.length === 1) {
      const [ni, oi] = options[0]; result.set(ni, { old: oi, anchors: proof });
    }
  }
  // A capture may start/end immediately beside its first/last long anchor.
  // Close that bounded edge only with one whole, unique, contiguous run. This
  // is deliberately stricter than the interior LCS: no missing or skipped row,
  // every UI timestamp explicit, and a long text plus two more text messages.
  const proven = new Map(matched);
  for (const [ni, value] of result) proven.set(ni, value.old);
  const provenOld = new Map([...proven].map(([ni, oi]) => [oi, ni]));
  const letters = (row: CaptureRecord) => row.kind === "text" && !isVoiceRecord(row)
    ? normalized(row.text).match(/[\p{L}\p{N}]/gu)?.length || 0 : 0;
  const longAnchors = anchors.filter(([ni, oi]) => proven.get(ni) === oi && textKey(existing[oi], 12) !== null);
  if (longAnchors.length) {
    const support = (start: number, end: number) => {
      const distinct = new Map(existing.slice(start, end).filter(row => letters(row) >= 2)
        .map(row => [JSON.stringify([row.senderRole, normalized(row.text)]), letters(row)]));
      const values = [...distinct.values()];
      return values.length >= 3 && values.reduce((sum, count) => sum + count, 0) >= 12;
    };
    const windows: Array<[number, number, number]> = [];
    const firstLong = longAnchors[0], lastLong = longAnchors[longAnchors.length - 1];
    let headEnd = firstLong[1] + 1;
    while (headEnd < Math.min(existing.length, 80) && !support(0, headEnd)) headEnd++;
    if (firstLong[1] > 0 && headEnd <= 80 && support(0, headEnd)
      && existing.slice(0, firstLong[1]).some((_, index) => !provenOld.has(index))) windows.push([0, headEnd, firstLong[1]]);
    if (existing.length - lastLong[1] <= 80 && support(lastLong[1], existing.length)
      && existing.some((_, index) => index > lastLong[1] && !provenOld.has(index))) windows.push([lastLong[1], existing.length, lastLong[1]]);
    for (const [start, end, longOld] of windows) {
      const length = end - start;
      if (!existing.slice(start, end).every(row => !!row.at.trim() && row.senderRole !== "unknown")) continue;
      const starts: number[] = [];
      for (let nextStart = 0; nextStart + length <= batch.records.length; nextStart++) {
        let valid = true;
        for (let offset = 0; offset < length; offset++) {
          const oi = start + offset, ni = nextStart + offset, old = existing[oi], next = batch.records[ni];
          if (proven.has(ni) && proven.get(ni) !== oi || provenOld.has(oi) && provenOld.get(oi) !== ni) { valid = false; break; }
          if (proven.get(ni) === oi) continue;
          if (!crossSourceCompatible(old, next) || !edgeBodyMatches(old, next)) { valid = false; break; }
        }
        if (valid) starts.push(nextStart);
        if (starts.length > 1) break;
      }
      if (starts.length !== 1) continue;
      const nextStart = starts[0], otherText = existing.findIndex((row, oi) => oi >= start && oi < end && oi !== longOld && letters(row) >= 2);
      if (otherText < 0) continue;
      const proof: [string, string] = [existing[Math.min(longOld, otherText)].localId, existing[Math.max(longOld, otherText)].localId];
      for (let offset = 0; offset < length; offset++) {
        const oi = start + offset, ni = nextStart + offset;
        if (!proven.has(ni)) { result.set(ni, { old: oi, anchors: proof }); proven.set(ni, oi); provenOld.set(oi, ni); }
      }
    }
  }
  return result;
}
function attachDatabaseAlias(old: StoredCaptureRecord, next: CaptureRecord, anchors: [string, string]): StoredCaptureRecord {
  const s = next.source;
  return { ...old, id: next.id, source: { ...old.source, databaseIdentity: { version: 1, matchedBy: "unique-text-interval-v1", anchors,
    id: next.id!, accountId: s.accountId, sessionId: s.sessionId, messageShard: s.messageShard, messageId: s.messageId,
    sender: next.sender, senderRole: next.senderRole, at: next.at, ...(isDatabaseVoice(next) ? { mediaKind: "voice", durationSeconds: s.durationSeconds } : {}) },
    ...(isDatabaseVoice(next) ? { voiceAvailability: old.kind === "text" ? "transcribed" : s.voiceAvailability } : {}) } };
}
function databaseVoiceSourceKey(record: CaptureRecord): string { const s = record.source; return JSON.stringify([s.accountId, s.sessionId, s.messageShard, s.messageId]); }
function validateDatabaseVoice(record: CaptureRecord, account: string): string {
  const identity = databaseVoiceIdentity(record, account);
  if (!identity) throw new Error("本机语音缺少完整的账号或消息来源编号。");
  const placeholder = /^(?:[\[【(]?(?:语音(?:消息)?|語音(?:訊息|消息)?|voice(?: message)?|audio(?: message)?)[\]】)]?)(?:\s*\d{1,5}\s*(?:秒|[“”"'′″]\s*(?:秒|sec)?|s(?:ec(?:ond)?s?)?))?$/iu;
  if (record.kind === "text") {
    if (record.source.transcriptionStatus !== "visible-text" || record.source.transcriptionSource !== "local-audio-asr"
      || record.source.voiceAvailability !== "transcribed" || !record.text.trim() || placeholder.test(record.text.trim())
      || /^(?:正在转文字|转文字中|转换中|转写中|转换失败|转写失败|无法转换|Transcribing|Converting|Conversion failed)[.。…!！\s]*$/i.test(record.text.trim())) throw new Error("本机语音正文必须是已完成的本机音频转写，不能保存占位或未核验文字。");
  } else if (record.kind !== "other" || !placeholder.test(record.text.trim())
    || !["not-visible", "not-transcribed", "pending", "failed"].includes(String(record.source.transcriptionStatus))
    || !["available", "missing-local", "decode-failed", "transcribe-failed"].includes(String(record.source.voiceAvailability))) throw new Error("本机语音占位与转写状态不一致，已保留原文。");
  return identity;
}
function absoluteTime(record: CaptureRecord, kind: CaptureKind): boolean {
  const value = normalized(record.at);
  const date = value.match(/(?:^|[^\d])(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日|\b|(?=\s|T))/);
  if (!date) return false;
  const parsed = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])));
  if (parsed.getUTCFullYear() !== Number(date[1]) || parsed.getUTCMonth() + 1 !== Number(date[2]) || parsed.getUTCDate() !== Number(date[3])) return false;
  return /(?:\s|T)\d{1,2}[:：]\d{2}/.test(value) || (kind === "moments" && (normalized(record.text).length >= 8 || !!record.images?.length));
}

function orderingTime(record: CaptureRecord, kind: CaptureKind): number | null {
  if (!absoluteTime(record, kind)) return null;
  const value = normalized(record.at), date = value.match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})/)!;
  const clock = value.match(/(?:\s|T)(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?/);
  if (clock && (+clock[1] > 23 || +clock[2] > 59 || +(clock[3] || 0) > 59)) return null;
  return Date.UTC(+date[1], +date[2]-1, +date[3], +(clock?.[1] || 0), +(clock?.[2] || 0), +(clock?.[3] || 0));
}

/** Insert newly read rows around shared original-message anchors, never sort tied/unknown dates. */
function mergeCaptureOrder(records: StoredCaptureRecord[], previousCount: number, incoming: number[], kind: CaptureKind, backwardPage = false): StoredCaptureRecord[] {
  if (!previousCount || records.length === previousCount) return records;
  const anchors = incoming.filter(index => index < previousCount);
  // Conflicting source order cannot safely change the existing timeline.
  if (anchors.some((index, position) => position > 0 && index < anchors[position-1])) return records;
  if (!anchors.length) {
    const range = (start: number, end: number) => {
      let minimum = Infinity, maximum = -Infinity;
      for (let index = start; index < end; index++) {
        const time = orderingTime(records[index], kind);
        if (time === null) return null;
        minimum = Math.min(minimum, time); maximum = Math.max(maximum, time);
      }
      return { minimum, maximum };
    };
    const oldTimes = range(0, previousCount), newTimes = range(previousCount, records.length);
    if (oldTimes && newTimes) {
      // A backwards database page establishes the source order when the last
      // old message and the first retained message share the same timestamp.
      // UI-only windows still require a strictly earlier date or shared anchors.
      const before = kind === "chat" ? newTimes.maximum < oldTimes.minimum || backwardPage && newTimes.maximum === oldTimes.minimum : newTimes.minimum > oldTimes.maximum;
      if (before) return [...records.slice(previousCount), ...records.slice(0, previousCount)];
    }
    return records; // No reliable overlap/date: retain everything without guessing chronology.
  }
  const nextAnchor: Array<number | undefined> = []; let next: number | undefined;
  for (let i = incoming.length - 1; i >= 0; i--) { if (incoming[i] < previousCount) next = incoming[i]; nextAnchor[i] = next; }
  const insertions = new Map<number, StoredCaptureRecord[]>(), inserted = new Set<number>(); let previous: number | undefined;
  incoming.forEach((index, position) => {
    if (index < previousCount) { previous = index; return; }
    if (inserted.has(index)) return;
    inserted.add(index);
    const slot = nextAnchor[position] ?? (previous === undefined ? previousCount : previous + 1);
    const additions = insertions.get(slot) || []; additions.push(records[index]); insertions.set(slot, additions);
  });
  const ordered: StoredCaptureRecord[] = [];
  for (let index = 0; index <= previousCount; index++) { ordered.push(...(insertions.get(index) || [])); if (index < previousCount) ordered.push(records[index]); }
  return ordered;
}

/** Sort proven database messages in their own slots. Unresolved UI records
 * keep their relative order and positions; their dates are never guessed. */
function orderDatabaseRecords(records: StoredCaptureRecord[], account: string, prependAtSameTime: Set<string>): StoredCaptureRecord[] {
  type Timed = { record: StoredCaptureRecord; position: number; time: number };
  const groups = new Map<string, Timed[]>();
  records.forEach((record, position) => {
    const alias = databaseAlias(record, account), resolved = alias || record, source = resolved.source;
    if (!databaseRecordIdentity(resolved, account) || !alias && (source.idStability !== "stable" || source.timestampOrigin !== "wechat-create-time") ||
        !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(resolved.at)) return;
    const time = Date.parse(resolved.at);
    if (!Number.isFinite(time)) return;
    const context = JSON.stringify([account, source.sessionId]), rows = groups.get(context) || [];
    rows.push({ record, position, time }); groups.set(context, rows);
  });
  let result = records;
  const compare = (left: Timed, right: Timed) => left.time - right.time ||
    Number(prependAtSameTime.has(right.record.localId)) - Number(prependAtSameTime.has(left.record.localId)) || left.position - right.position;
  for (const rows of groups.values()) {
    if (rows.every((row, index) => !index || compare(rows[index - 1], row) <= 0)) continue;
    const sorted = [...rows].sort(compare);
    if (result === records) result = records.slice();
    rows.forEach((slot, index) => { result[slot.position] = sorted[index].record; });
  }
  return result;
}

/** Conservative, order-aware merge. Ambiguous undated short replies are retained rather than erased. */
export function mergeCaptureRecords(existing: StoredCaptureRecord[], input: unknown, namespace: CaptureNamespace): CaptureMerge {
  const batch = validateCaptureBatch(input), key = captureNamespaceKey(namespace);
  const history = object(input) && object(input.history) ? input.history : null;
  const session = batch.records[0]?.source.sessionId;
  const backwardPage = history?.version === 1 && history.direction === "backward" && history.count === batch.records.length &&
    typeof history.snapshot === "string" && !!history.snapshot && typeof session === "string" &&
    batch.records.every(row => databaseRecordIdentity(row, namespace.account) && row.source.sessionId === session);
  if (batch.account !== namespace.account || batch.friend !== namespace.friend || batch.kind !== namespace.kind) throw new Error("这批材料与当前账号、联系人或类型不一致。");
  if (existing.some(row => row.namespace !== key)) throw new Error("不能合并其他账号或联系人的原文。");
  const records = existing.map(row => ({ ...row })), newRecords: StoredCaptureRecord[] = [];
  const matched = new Map<number, number>(), used = new Set<number>();
  const upgraded = new Set<number>(), refreshedVoice = new Set<number>();
  const databaseVoices = new Map<string, number>();
  const databaseVoiceIds = new Map<string, string>();
  const databaseSourceIds = new Map<string, string>();
  const databaseRows = new Map<string, number>(), databaseRowIds = new Map<string, string>();
  existing.forEach((row, index) => {
    const alias = databaseAlias(row, namespace.account);
    if (row.source.databaseIdentity && !alias) throw new Error("原文的数据库关联凭据发生变化，已保留原文。");
    const resolved = alias || row, recordIdentity = databaseRecordIdentity(resolved, namespace.account);
    if (recordIdentity) {
      if (databaseRows.has(recordIdentity) || databaseRowIds.has(row.id!)) throw new Error("数据库来源编号重复，请先核对原文库。");
      databaseRows.set(recordIdentity, index); databaseRowIds.set(row.id!, recordIdentity);
    }
    const identity = isDatabaseVoice(row) ? validateDatabaseVoice(row, namespace.account) : alias && isDatabaseVoice(alias) ? databaseVoiceIdentity(alias, namespace.account) : null;
    if (identity) {
      if (databaseVoices.has(identity)) throw new Error("本机语音来源编号重复，请先核对原文库。");
      databaseVoices.set(identity, index);
      if (databaseVoiceIds.has(row.id!) && databaseVoiceIds.get(row.id!) !== identity) throw new Error("本机语音编号对应多个来源，请先核对原文库。");
      databaseVoiceIds.set(row.id!, identity);
      const sourceKey = databaseVoiceSourceKey(resolved);
      if (databaseSourceIds.has(sourceKey)) throw new Error("同一条本机语音对应多个来源编号，请先核对原文库。");
      databaseSourceIds.set(sourceKey, row.id!);
    }
  });
  const incomingIds = new Map<string, number>(), incomingDatabaseSources = new Set<string>();
  batch.records.forEach(row => { if (row.id) incomingIds.set(row.id, (incomingIds.get(row.id) || 0) + 1); });
  batch.records.forEach((row, index) => {
    const recordIdentity = databaseRecordIdentity(row, namespace.account);
    if (recordIdentity && incomingIds.get(row.id!) !== 1) throw new Error("本次包含重复的数据库来源编号。");
    if (row.id && databaseRowIds.has(row.id) && recordIdentity !== databaseRowIds.get(row.id)) throw new Error("数据库消息来源发生冲突，已保留原文。");
    const identity = isDatabaseVoice(row) ? validateDatabaseVoice(row, namespace.account) : null, old = identity ? databaseVoices.get(identity) : undefined;
    if (identity) {
      const sourceKey = databaseVoiceSourceKey(row);
      if (incomingIds.get(row.id!) !== 1 || incomingDatabaseSources.has(sourceKey)) throw new Error("本次包含重复或冲突的语音来源编号，请重新检查材料。");
      incomingDatabaseSources.add(sourceKey);
      if (databaseSourceIds.has(sourceKey) && databaseSourceIds.get(sourceKey) !== row.id) throw new Error("同一条本机语音的来源编号发生变化，已保留原文。");
    }
    if (row.id && databaseVoiceIds.has(row.id) && identity !== databaseVoiceIds.get(row.id)) throw new Error("本机语音的账号、说话人或消息来源发生冲突，已保留原文。");
    if (old === undefined) {
      const same = recordIdentity ? databaseRows.get(recordIdentity) : undefined;
      if (same !== undefined && !identity) {
        if (row.kind === "text" && normalized(existing[same].text) !== normalized(row.text)) throw new Error("同一条数据库消息出现不同正文，已保留原文。");
        matched.set(index, same); used.add(same);
      }
      return;
    }
    const before = existing[old], previousText = before.kind === "text" && before.source.transcriptionStatus === "visible-text";
    const nextText = row.kind === "text" && row.source.transcriptionStatus === "visible-text";
    if (previousText && nextText && before.text !== row.text && !databaseAlias(before, namespace.account)) throw new Error("同一条语音已有不同的转写结果，已保留原文，请先核对。");
    if (used.has(old)) throw new Error("本次包含重复的语音来源编号，请重新检查材料。");
    matched.set(index, old); used.add(old);
    if (nextText && !previousText) upgraded.add(index);
    else if (!previousText) refreshedVoice.add(index);
    // A quick rescan may return a placeholder; retain the completed transcript.
  });
  const crossSource = crossSourceMatches(existing, batch, matched, used);
  for (const [index, match] of crossSource) {
    matched.set(index, match.old); used.add(match.old);
    if (isDatabaseVoice(batch.records[index]) && existing[match.old].kind !== "text" && batch.records[index].kind === "text") upgraded.add(index);
  }
  const oldBodies = existing.map(bodyKey), nextBodies = batch.records.map(bodyKey), oldKeys = existing.map(sequenceKey), nextKeys = batch.records.map(sequenceKey);
  const candidates = new Map<string, number[]>();
  oldKeys.forEach((value, index) => { const indexes = candidates.get(value) || []; indexes.push(index); candidates.set(value, indexes); });
  // Native source IDs identify a message. A changed body is a separate retained revision.
  const stable = new Map<string, number>();
  existing.forEach((row, index) => { if (row.id && !isDatabaseVoice(row)) stable.set(JSON.stringify([row.id, oldBodies[index]]), index); });
  batch.records.forEach((row, index) => { if (matched.has(index) || isDatabaseVoice(row)) return; const match = row.id ? stable.get(JSON.stringify([row.id, nextBodies[index]])) : undefined; if (match !== undefined) { matched.set(index, match); used.add(match); } });
  // Absolute timestamps allow matching repeated imports, preserving occurrence counts within each batch.
  batch.records.forEach((row, index) => {
    if (matched.has(index) || row.id || !absoluteTime(row, batch.kind)) return;
    const match = (candidates.get(nextKeys[index]) || []).find(old => !used.has(old) && !existing[old].id);
    if (match !== undefined) { matched.set(index, match); used.add(match); }
  });
  const equalAt = (incoming: number, old: number) => nextKeys[incoming] === oldKeys[old] && !(batch.records[incoming].id && existing[old].id && batch.records[incoming].id !== existing[old].id)
    && (!(isDatabaseVoice(batch.records[incoming]) || isDatabaseVoice(existing[old])) || matched.get(incoming) === old);
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
  // A new visible voice transcript enriches its original placeholder only when
  // surrounding original messages locate an equal-length sequence one-to-one.
  // Duration/time alone never identifies a voice, particularly within one minute.
  const anchors = new Map(matched);
  const nextOccurrences = new Map<string, number>();
  nextKeys.forEach(value => nextOccurrences.set(value, (nextOccurrences.get(value) || 0) + 1));
  batch.records.forEach((row, index) => {
    if (anchors.has(index) || voiceDescriptor(row) || normalized(row.text).length < 8 || nextOccurrences.get(nextKeys[index]) !== 1) return;
    const options = candidates.get(nextKeys[index]) || [];
    if (options.length !== 1 || used.has(options[0]) || voiceDescriptor(existing[options[0]])) return;
    anchors.set(index, options[0]);
  });
  const orderedAnchors = [...anchors].sort((a, b) => a[0] - b[0]);
  const boundaries = [[-1, -1], ...orderedAnchors, [batch.records.length, existing.length]];
  for (let boundary = 1; boundary < boundaries.length; boundary++) {
    const [leftNew, leftOld] = boundaries[boundary - 1], [rightNew, rightOld] = boundaries[boundary];
    const length = rightNew - leftNew - 1;
    if (!length || rightOld - leftOld - 1 !== length || rightOld <= leftOld) continue;
    const leftReal = leftNew >= 0, rightReal = rightNew < batch.records.length;
    if (!leftReal && !rightReal) continue;
    if ((!leftReal || !rightReal) && !(leftReal ? matched.has(leftNew) : matched.has(rightNew))) continue;
    if (leftReal && rightReal && !matched.has(leftNew) && !matched.has(rightNew) && normalized(batch.records[leftNew].text).length + normalized(batch.records[rightNew].text).length < 24) continue;
    let reliable = true;
    for (let offset = 1; offset <= length; offset++) {
      const nextIndex = leftNew + offset, oldIndex = leftOld + offset, next = batch.records[nextIndex], old = existing[oldIndex];
      const before = voiceDescriptor(old), after = voiceDescriptor(next);
      if (isDatabaseVoice(old) || isDatabaseVoice(next) || matched.has(nextIndex) || used.has(oldIndex) || !before?.placeholder || !after?.visible || before.key !== after.key || old.id && next.id && old.id !== next.id) { reliable = false; break; }
    }
    if (!reliable) continue;
    for (const [nextIndex, oldIndex] of [[leftNew, leftOld], [rightNew, rightOld]]) {
      if (nextIndex >= 0 && nextIndex < batch.records.length) { matched.set(nextIndex, oldIndex); used.add(oldIndex); }
    }
    for (let offset = 1; offset <= length; offset++) { const nextIndex = leftNew + offset; matched.set(nextIndex, leftOld + offset); used.add(leftOld + offset); upgraded.add(nextIndex); }
  }
  const stableAdded = new Map<string, number>(), incoming: number[] = [];
  batch.records.forEach((row, index) => {
    const nativeKey = row.id ? JSON.stringify([row.id, nextBodies[index]]) : "";
    const old = matched.get(index) ?? (nativeKey ? stableAdded.get(nativeKey) : undefined);
    if (old !== undefined) {
      const binding = crossSource.get(index);
      if (binding) records[old] = attachDatabaseAlias(records[old], row, binding.anchors);
      const alias = databaseAlias(records[old], namespace.account);
      if (alias) {
        if (isDatabaseVoice(row) && records[old].kind !== "text" && row.kind === "text") {
          const original = records[old], prior = original.source;
          const legacyUiSource = Object.fromEntries(Object.entries({ label: prior.label, method: "uia", at: original.at, text: original.text, sender: original.sender,
            uiClass: prior.uiClass, index: prior.index, uiIndex: prior.uiIndex, rawMediaLabel: prior.rawMediaLabel }).filter(([, value]) => value !== undefined));
          records[old] = { ...original, ...row, images: row.images?.length ? row.images : original.images,
            source: { ...row.source, legacyUiSource, transcriptCapturedAt: batch.capturedAt }, lastCapturedAt: batch.capturedAt };
        } else records[old] = { ...records[old], source: { ...records[old].source,
          ...(isDatabaseVoice(row) ? { voiceAvailability: records[old].kind === "text" ? "transcribed" : row.source.voiceAvailability } : {}) }, lastCapturedAt: batch.capturedAt };
        incoming.push(old); return;
      }
      records[old] = upgraded.has(index) || refreshedVoice.has(index) ? { ...records[old], ...row, images: row.images?.length ? row.images : records[old].images, source: { ...records[old].source, ...row.source, ...(upgraded.has(index) ? { transcriptCapturedAt: batch.capturedAt } : {}) }, lastCapturedAt: batch.capturedAt } : { ...records[old], ...(batch.kind === "moments" ? {source:{...records[old].source,...row.source}}:{}), lastCapturedAt: batch.capturedAt };
      incoming.push(old); return;
    }
    const localId = `record:${hash(key)}:${records.length + 1}:${hash(sequenceKey(row) + (row.id || ""))}`;
    const stored: StoredCaptureRecord = { ...row, localId, namespace: key, firstCapturedAt: batch.capturedAt, lastCapturedAt: batch.capturedAt };
    if (nativeKey) stableAdded.set(nativeKey, records.length);
    incoming.push(records.length); records.push(stored); newRecords.push(stored);
  });
  // Bound each incoming batch, not a person's accumulated history. IndexedDB
  // quota failures leave the last committed batch and history cursor intact.
  const ordered = mergeCaptureOrder(records, existing.length, incoming, batch.kind, backwardPage);
  // Only an entirely new backwards page establishes a tie order. Shared
  // anchors already located inserted rows precisely, so preserve their order.
  const prependAtSameTime = new Set(backwardPage && matched.size === 0 ? newRecords.map(row => row.localId) : []);
  return { added: newRecords.length, repeated: batch.records.length - newRecords.length, updatedVoice: upgraded.size, total: records.length, newRecords,
    records: batch.kind === "chat" ? orderDatabaseRecords(ordered, namespace.account, prependAtSameTime) : ordered };
}
