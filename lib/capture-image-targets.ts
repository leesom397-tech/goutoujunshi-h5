import type { StoredCaptureRecord } from "./desktop-capture";

/** Called only from an explicitly requested contact import, never on library open. */
export function captureImageTargets(records: StoredCaptureRecord[]) {
  return records.filter(row => row.source.method === "wechat-local-db" && row.kind === "image" && !row.images?.length)
    .map(row => ({
      messageShard: String(row.source.messageShard || ""),
      messageId: String(row.source.messageId || ""),
      ...(row.source.localId ? { localId: String(row.source.localId) } : {}),
    }));
}

export function captureImageCoverage(records: StoredCaptureRecord[]) {
  const images = records.filter(row => row.kind === "image" && row.source.method === "wechat-local-db");
  const available = images.filter(row => row.images?.length).length;
  return { total: images.length, available, missing: images.length - available };
}
