import { pendingCaptureRecords, type CaptureLibrary } from "./desktop-capture-vault";
import { CAPTURE_ANALYSIS_LIMIT, captureReadableText } from "./capture-analysis-input";
import type { StoredCaptureRecord } from "./desktop-capture";

const visualSource = (row: StoredCaptureRecord) => ["screen-capture", "video-import"].includes(String(row.source.method));

/** Choose the latest eligible chat window, then return it in the original oldest-first order. */
export function selectPendingCaptureRecords(library: CaptureLibrary, issue: (rows: StoredCaptureRecord[]) => string = () => ""): StoredCaptureRecord[] {
  const pending = pendingCaptureRecords(library);
  const onlyFrames = pending.length > 0 && pending.every(visualSource);
  const limit = onlyFrames ? 9 : CAPTURE_ANALYSIS_LIMIT[library.kind];
  // Visual frames retain their explicit capture/recording order, including mixed visual imports.
  const newestFirst = library.kind === "chat" && !pending.some(visualSource);
  const candidates = newestFirst ? [...pending].reverse() : pending;
  const selected: StoredCaptureRecord[] = [];
  for (const row of candidates) {
    if (selected.length >= limit) break;
    if (library.kind === "chat" && !visualSource(row) && !captureReadableText(row).trim()) continue;
    if (issue([...selected, row])) continue;
    selected.push(row);
  }
  const ids = new Set(selected.map(row => row.localId));
  return pending.filter(row => ids.has(row.localId));
}
