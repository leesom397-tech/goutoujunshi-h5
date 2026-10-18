import type { CaptureKind, CaptureSource, StoredCaptureRecord } from "./desktop-capture";

export type CloudMediaRef = { id: string; index: number; mime: "image/png" | "image/jpeg" | "image/webp"; name: string; bytes: number; chunks: number; sha256: string; status?: "uploading" | "ready" };
export type CloudCaptureRecord = Omit<StoredCaptureRecord, "namespace" | "images"> & { imageCount: number; media?: CloudMediaRef[]; seq?: number; order?: {known:boolean;time:number;sequence:number} };
export type CloudCaptureLibrary = {
  id: string; cloudId?: string; ownerId?: string; account: string; friend: string; kind: CaptureKind;
  createdAt: string; updatedAt: string; total: number; epoch: number; subjectId: string | null;
  warnings: string[]; reportLinks: { reportId: string; sourceIds: string[]; memorySourceIds?: string[]; createdAt: string }[];
  mediaIncluded: boolean; deleted?: boolean;
};
const object = (value: unknown): value is Record<string,unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number, required = false): string => {
  if (typeof value !== "string" || value.length > max || /\u0000/.test(value) || required && !value.trim()) throw Error("聊天记录字段不完整或超过长度限制。");
  return value;
};
const iso = (value: unknown) => { const result = text(value, 80, true); if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) throw Error("采集时间不正确。"); return result; };
// Explicit metadata only. A capture can carry local file paths and database access
// material; neither is part of the synchronizable record contract.
const sourceKeys = new Set(["label","method","accountId","sessionId","messageId","messageShard","idStability","timestampOrigin","mediaKind","transcriptionStatus","transcriptionSource","transcriptCapturedAt","voiceAvailability","durationSeconds","rawMediaLabel","atRaw","index","uiIndex","uiClass","order","capturedAt","videoTime","videoId","frameId","version","matchedBy","at","senderRole","id","recordId","localId","imageCount","imageType","previewUnavailable","cloudMediaUnavailable","materialRole","pinned"]);
function safeSource(input: unknown, depth = 0): CaptureSource {
  if (!object(input)) throw Error("聊天记录缺少来源。");
  const result: Record<string,unknown> = {};
  for (const [key,value] of Object.entries(input)) {
    if (sourceKeys.has(key)) {
      if (typeof value === "string") result[key] = text(value, key === "label" ? 500 : 2000);
      else if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || value === null) result[key] = value;
    } else if (depth === 0 && ["databaseIdentity","legacyUiSource"].includes(key) && object(value)) {
      result[key] = safeSource(value, depth + 1);
    } else if (depth === 1 && key === "anchors" && Array.isArray(value)) {
      result[key] = value.slice(0, 8).filter(item => typeof item === "string").map(item => text(item, 500));
    }
  }
  if(result.materialRole !== undefined && !["moment","moments-cover","profile-signature"].includes(String(result.materialRole)) || result.pinned !== undefined && typeof result.pinned !== "boolean" || result.pinned === true && result.materialRole !== undefined && result.materialRole !== "moment") throw Error("朋友圈材料来源类型不正确。");
  if (depth === 0) result.label = text(result.label, 500, true);
  return result as CaptureSource;
}
export function validateCloudCaptureRecord(value: unknown): CloudCaptureRecord {
  if (!object(value)) throw Error("聊天记录格式不正确。");
  if (!["text","image","sticker","post","other"].includes(String(value.kind)) || !["self","other","unknown"].includes(String(value.senderRole))) throw Error("聊天类型或说话人身份不正确。");
  const imageCount = value.imageCount ?? 0;
  if (!Number.isInteger(imageCount) || Number(imageCount) < 0 || Number(imageCount) > 9) throw Error("每条材料最多同步 9 张已导入图片。");
  return {
    localId: text(value.localId, 1200, true), ...(value.id ? { id: text(value.id, 300, true) } : {}),
    kind: value.kind as CloudCaptureRecord["kind"], sender: text(value.sender, 200), senderRole: value.senderRole as CloudCaptureRecord["senderRole"],
    at: text(value.at,120), text: text(value.text,30000), source: safeSource(value.source),
    firstCapturedAt: iso(value.firstCapturedAt), lastCapturedAt: iso(value.lastCapturedAt),
    imageCount: Number(imageCount), ...(value.ocrTextVerified === true ? { ocrTextVerified: true } : {}),
  };
}
export function sanitizeCloudCaptureRecord(value: StoredCaptureRecord | CloudCaptureRecord): CloudCaptureRecord {
  const row = value as StoredCaptureRecord & Partial<CloudCaptureRecord>;
  return validateCloudCaptureRecord({ ...row, imageCount: Math.max(row.images?.length || 0,row.imageCount || 0,Number(row.source.imageCount)||0) });
}
