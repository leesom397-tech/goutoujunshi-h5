import type { CaptureLibrary } from "./desktop-capture-vault";
import { CAPTURE_MEMORY_LIMIT, type CaptureMemoryRow } from "./capture-analysis-input";

/** Keep one contact's exact text, newest first for limits and original order for reading. */
export function selectCaptureMemory(library: CaptureLibrary | null): CaptureMemoryRow[] {
  if (!library || library.kind !== "chat") return [];
  const eligible = library.records.filter(row => row.kind === "text" && row.senderRole !== "unknown" && row.text.trim() && row.text.length <= 6000);
  const isDatabase = (row: typeof eligible[number]) => row.source.method === "wechat-local-db" || !!row.source.databaseIdentity;
  // A database import is the preferred copy when a UI capture contains the
  // same message, but a confirmed UI-only message still belongs in the
  // relationship context. The old selector dropped every UI row as soon as a
  // single database row existed, which made the history count look complete
  // while silently omitting readable material.
  const signature = (row: typeof eligible[number]) => `${row.senderRole}\u0000${row.at.trim()}\u0000${row.text.replace(/\s+/g, " ").trim()}`;
  const databaseSignatures = new Set(eligible.filter(isDatabase).map(signature));
  const candidates = eligible.filter(row => isDatabase(row) || !databaseSignatures.has(signature(row)));
  const selected: CaptureMemoryRow[] = [], ids = new Set<string>();
  let chars = 0;
  for (const row of [...candidates].reverse()) {
    if (selected.length >= CAPTURE_MEMORY_LIMIT.records) break;
    if (ids.has(row.localId) || chars + row.text.length > CAPTURE_MEMORY_LIMIT.characters) continue;
    selected.push({ localId: row.localId, kind: "text", senderRole: row.senderRole as "self" | "other", at: row.at, text: row.text });
    ids.add(row.localId); chars += row.text.length;
  }
  return selected.reverse();
}
