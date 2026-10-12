import { captureLibraryId, mergeCaptureRecords, validateCaptureBatch, type CaptureNamespace, type StoredCaptureRecord } from "./desktop-capture";
export type { StoredCaptureRecord } from "./desktop-capture";

export type CaptureReportLink = { reportId: string; sourceIds: string[]; createdAt: string };
export type CaptureLibrary = CaptureNamespace & { id: string; createdAt: string; updatedAt: string; records: StoredCaptureRecord[]; warnings: string[]; reportLinks: CaptureReportLink[] };
export type CaptureLibrarySummary = Omit<CaptureLibrary, "records"> & { total: number; pending: number };
export type CaptureReportSources = { libraryId: string; sourceIds: string[]; records: StoredCaptureRecord[]; kind: CaptureNamespace["kind"]; friend: string; account: string };
type ReportSourceEntry = { id: string; ownerId: string; reportId: string; libraryId: string; sourceIds: string[]; createdAt: string };
const DB_NAME = "chengzi-desktop-capture-v1";
const LIBRARIES = "libraries", REPORTS = "reportSources";

function owner(value: string): string { if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error("请先登录，再读取自己的本机原文。"); return value; }
function reportKey(ownerId: string, reportId: string): string { owner(ownerId); if (typeof reportId !== "string" || !reportId.trim() || reportId.length > 300) throw new Error("报告编号不正确。"); return JSON.stringify([ownerId, reportId]); }
function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("当前环境不能保存本机原文，请使用支持本地存储的浏览器。"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const libraries = request.result.createObjectStore(LIBRARIES, { keyPath: "id" }); libraries.createIndex("ownerId", "ownerId");
      const reports = request.result.createObjectStore(REPORTS, { keyPath: "id" }); reports.createIndex("ownerId", "ownerId"); reports.createIndex("libraryId", "libraryId");
    };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
    request.onerror = () => reject(new Error("本机原文库无法打开，请允许站点使用本地存储。"));
    request.onblocked = () => reject(new Error("原文库正在更新，请关闭其他打开本站的旧页面后重试。"));
  });
}
async function read<T>(store: string, lookup: (value: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, "readonly"), request = lookup(transaction.objectStore(store)); let result: T;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error || new Error("读取本机原文失败。")); };
  });
}
export function pendingCaptureRecords(library: CaptureLibrary): StoredCaptureRecord[] {
  const analyzed = new Set((library.reportLinks || []).flatMap(link => link.sourceIds));
  return library.records.filter(record => !analyzed.has(record.localId));
}
export async function saveCaptureBatch(ownerId: string, input: unknown): Promise<{ library: CaptureLibrary; added: number; repeated: number; total: number; newRecords: StoredCaptureRecord[] }> {
  owner(ownerId);
  const batch = validateCaptureBatch(input), namespace: CaptureNamespace = { ownerId, account: batch.account, friend: batch.friend, kind: batch.kind }, id = captureLibraryId(namespace), db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LIBRARIES, "readwrite"), store = transaction.objectStore(LIBRARIES), request = store.get(id);
    let result: { library: CaptureLibrary; added: number; repeated: number; total: number; newRecords: StoredCaptureRecord[] }; let reason: unknown;
    request.onsuccess = () => {
      try {
        const existing = request.result as CaptureLibrary | undefined;
        if (existing && existing.ownerId !== ownerId) throw new Error("这份原文不属于当前账号。");
        const merged = mergeCaptureRecords(existing?.records || [], batch, namespace);
        const library: CaptureLibrary = { ...namespace, id, createdAt: existing?.createdAt || batch.capturedAt, updatedAt: batch.capturedAt, records: merged.records, warnings: batch.warnings, reportLinks: existing?.reportLinks || [] };
        store.put(library); result = { library, added: merged.added, repeated: merged.repeated, total: merged.total, newRecords: merged.newRecords };
      } catch (error) { reason = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(reason || transaction.error || new Error("保存本机原文失败，可能是本地空间不足。")); };
  });
}
export async function listCaptureLibraries(ownerId: string): Promise<CaptureLibrarySummary[]> {
  owner(ownerId);
  const libraries = await read<CaptureLibrary[]>(LIBRARIES, store => store.index("ownerId").getAll(ownerId));
  return libraries.filter(item => item.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(library => { const { records, ...metadata } = library; return { ...metadata, total: records.length, pending: pendingCaptureRecords(library).length }; });
}
export async function getCaptureLibrary(ownerId: string, libraryId: string): Promise<CaptureLibrary | null> {
  owner(ownerId); const result = await read<CaptureLibrary | undefined>(LIBRARIES, store => store.get(libraryId)); return result?.ownerId === ownerId ? result : null;
}
export async function getCaptureRecord(ownerId: string, libraryId: string, localId: string): Promise<StoredCaptureRecord | null> { return (await getCaptureLibrary(ownerId, libraryId))?.records.find(row => row.localId === localId) || null; }
export async function listPendingCaptureRecords(ownerId: string, libraryId: string): Promise<StoredCaptureRecord[]> { const library = await getCaptureLibrary(ownerId, libraryId); return library ? pendingCaptureRecords(library) : []; }
export async function linkReportSources(ownerId: string, reportId: string, input: { libraryId: string; sourceIds: string[] }): Promise<void> {
  const id = reportKey(ownerId, reportId);
  if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || input.sourceIds.length > 1000 || input.sourceIds.some(value => typeof value !== "string" || !value)) throw new Error("报告需要关联有效的本机原文编号。");
  const sourceIds = [...new Set(input.sourceIds)], db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([LIBRARIES, REPORTS], "readwrite"), libraries = transaction.objectStore(LIBRARIES), reports = transaction.objectStore(REPORTS); let reason: unknown;
    const libraryRequest = libraries.get(input.libraryId);
    libraryRequest.onsuccess = () => {
      try {
        const library = libraryRequest.result as CaptureLibrary | undefined;
        if (!library || library.ownerId !== ownerId) throw new Error("当前账号找不到这份本机原文。");
        const valid = new Set(library.records.map(row => row.localId));
        if (sourceIds.some(value => !valid.has(value))) throw new Error("报告中的部分原文编号不属于这份材料。");
        const linkRequest = reports.get(id);
        linkRequest.onsuccess = () => {
          try {
            const previous = linkRequest.result as ReportSourceEntry | undefined;
            if (previous && (previous.libraryId !== input.libraryId || JSON.stringify(previous.sourceIds) !== JSON.stringify(sourceIds))) throw new Error("这个报告已关联另一批原文，不能覆盖。");
            const createdAt = previous?.createdAt || new Date().toISOString();
            reports.put({ id, ownerId, reportId, libraryId: input.libraryId, sourceIds, createdAt } satisfies ReportSourceEntry);
            const reportLinks = (library.reportLinks || []).filter(link => link.reportId !== reportId);
            libraries.put({ ...library, reportLinks: [...reportLinks, { reportId, sourceIds, createdAt }] });
          } catch (error) { reason = error; transaction.abort(); }
        };
      } catch (error) { reason = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(reason || transaction.error || new Error("报告与本机原文关联失败，材料仍保留，可重试。")); };
  });
}
/** Source records follow report sourceIds order, not library order or guessed timestamp order. */
export async function readReportSources(ownerId: string, reportId: string): Promise<CaptureReportSources | null> {
  const id = reportKey(ownerId, reportId), entry = await read<ReportSourceEntry | undefined>(REPORTS, store => store.get(id));
  if (!entry || entry.ownerId !== ownerId) return null;
  const library = await getCaptureLibrary(ownerId, entry.libraryId);
  if (!library) return null;
  const byId = new Map(library.records.map(record => [record.localId, record]));
  return { libraryId: library.id, sourceIds: entry.sourceIds, records: entry.sourceIds.map(sourceId => byId.get(sourceId)).filter((record): record is StoredCaptureRecord => !!record), kind: library.kind, friend: library.friend, account: library.account };
}
export async function removeCaptureLibrary(ownerId: string, libraryId: string): Promise<void> {
  owner(ownerId); const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([LIBRARIES, REPORTS], "readwrite"), libraries = transaction.objectStore(LIBRARIES), reports = transaction.objectStore(REPORTS), request = libraries.get(libraryId);
    request.onsuccess = () => {
      const library = request.result as CaptureLibrary | undefined;
      if (!library || library.ownerId !== ownerId) return;
      libraries.delete(libraryId); const links = reports.index("libraryId").openCursor(libraryId);
      links.onsuccess = () => { const cursor = links.result; if (cursor) { if ((cursor.value as ReportSourceEntry).ownerId === ownerId) cursor.delete(); cursor.continue(); } };
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error || new Error("删除本机原文失败。")); };
  });
}
