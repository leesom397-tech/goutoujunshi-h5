import { getCaptureLibrary, type CaptureLibrary, type CaptureLibrarySummary } from "./desktop-capture-vault";
import { listSyncedCaptureLibraries, type SyncedLibrarySummary } from "./capture-cloud-client";
import type { ChatActivityRecord } from "./chat-activity";
import { mergeArchiveActivityPage, type ArchiveActivityPage } from "./archive-imported-activity-core";
export { mergeArchiveActivityPage } from "./archive-imported-activity-core";

export type ArchiveActivityLoaded = { records: ChatActivityRecord[]; total: number; updatedAt: string; friend: string; account: string; source: "local" | "cloud"; libraryId: string };

/** A local empty binding is meaningful: it deliberately clears an old person link. */
export function readExplicitCaptureBinding(owner: string, libraryId: string, store?: Pick<Storage, "getItem">): { explicit: boolean; subjectId: string } {
  try {
    const storage = store || (typeof localStorage !== "undefined" ? localStorage : null); if (!storage || !owner || !libraryId) return { explicit: false, subjectId: "" };
    const key = "chengzi-intake:v1:" + JSON.stringify([owner, "library", libraryId]);
    const value = JSON.parse(storage.getItem(key) || "null");
    return value && typeof value === "object" && typeof value.subjectId === "string" ? { explicit: true, subjectId: value.subjectId } : { explicit: false, subjectId: "" };
  } catch { return { explicit: false, subjectId: "" }; }
}

function activityRecord(value: unknown): ChatActivityRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.localId !== "string" || typeof row.kind !== "string" || typeof row.senderRole !== "string" || typeof row.at !== "string" || typeof row.text !== "string" || !row.source || typeof row.source !== "object") return null;
  return { ...row, id: row.localId } as ChatActivityRecord;
}

function explicitSubject(owner: string, item: SyncedLibrarySummary): { explicit: boolean; subjectId: string } { return readExplicitCaptureBinding(owner, item.id); }

async function loadOne(owner: string, selected: { item: SyncedLibrarySummary; binding: { explicit: boolean; subjectId: string } }): Promise<ArchiveActivityLoaded | null> {
  const local = await getCaptureLibrary(owner, selected.item.id);
  // Local records are already scoped by owner in the vault; explicit binding wins over cloud metadata.
  if (local && selected.binding.explicit) return { records: local.records.map(row => ({ ...row, id: row.localId })), total: local.records.length, updatedAt: local.updatedAt, friend: local.friend, account: local.account, source: "local", libraryId: local.id };
  if (local && selected.item.cloud?.enabled !== true) return { records: local.records.map(row => ({ ...row, id: row.localId })), total: local.records.length, updatedAt: local.updatedAt, friend: local.friend, account: local.account, source: "local", libraryId: local.id };
  if (local && !selected.item.cloudInfo) return { records: local.records.map(row => ({ ...row, id: row.localId })), total: local.records.length, updatedAt: local.updatedAt, friend: local.friend, account: local.account, source: "local", libraryId: local.id };
  const info = selected.item.cloudInfo; if (!info) return local ? { records: local.records.map(row => ({ ...row, id: row.localId })), total: local.records.length, updatedAt: local.updatedAt, friend: local.friend, account: local.account, source: "local", libraryId: local.id } : null;
  const state = { ownerId: owner, libraryId: info.id, epoch: info.epoch, revision: null as number | null, total: null as number | null, seen: new Set<string>(), cursors: new Set<string>(), records: [] as ChatActivityRecord[] };
  let cursor = "", meta = { total: info.total, updatedAt: info.updatedAt, friend: info.friend };
  for (;;) {
    const query = new URLSearchParams({ id: info.id, limit: "500" }); if (cursor) query.set("cursor", cursor);
    const response = await fetch(`/api/web/capture/library?${query}`, { credentials: "same-origin", cache: "no-store" }); if (!response.ok) throw new Error("云端聊天暂时无法取回，请刷新后重试。");
    const page = await response.json() as ArchiveActivityPage; const merged = mergeArchiveActivityPage(state, page, cursor); meta = merged; cursor = merged.nextCursor; if (!cursor) break;
  }
  if (state.total !== state.records.length) throw new Error("聊天资料数量发生变化，未展示不完整统计。");
  return { records: state.records, total: state.records.length, updatedAt: meta.updatedAt, friend: meta.friend, account: info.account, source: "cloud", libraryId: info.id };
}

export async function loadArchiveImportedActivity(owner: string, subjectId: string): Promise<ArchiveActivityLoaded | null> {
  const listed = await listSyncedCaptureLibraries(owner);
  const candidates = listed.libraries.filter(item => item.kind === "chat")
    .map(item => ({ item, binding: explicitSubject(owner, item) }))
    .filter(({ item, binding }) => binding.explicit ? binding.subjectId === subjectId : item.cloudInfo?.subjectId === subjectId)
    .sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt));
  if (!candidates.length) {
    if (listed.warning) throw new Error(listed.warning);
    return null;
  }
  const loaded: ArchiveActivityLoaded[] = [];
  for (const candidate of candidates) {
    const library = await loadOne(owner, candidate);
    if (library) loaded.push(library);
  }
  if (!loaded.length) return null;
  return {
    records: loaded.flatMap(item => item.records),
    total: loaded.reduce((count, item) => count + item.total, 0),
    updatedAt: loaded.map(item => item.updatedAt).sort().at(-1) || "",
    friend: loaded[0].friend,
    account: loaded.length === 1 ? loaded[0].account : "",
    source: loaded.every(item => item.source === "cloud") ? "cloud" : "local",
    libraryId: loaded.map(item => item.libraryId).join(","),
  };
}
