import { applyVerifiedVoiceUpdatesToRecords, captureLibraryId, captureNamespaceKey, mergeCaptureRecords, validateCaptureBatch, type CaptureCoverage, type CaptureNamespace, type StoredCaptureRecord, type VerifiedVoiceUpdates } from "./desktop-capture";
export type { StoredCaptureRecord } from "./desktop-capture";

export type CaptureReportLink = { reportId: string; sourceIds: string[]; memorySourceIds?: string[]; createdAt: string };
export type CaptureCloudState = { id: string; epoch: number; revision?: number; enabled: boolean; syncedAt: string; total: number; subjectId?: string; digests?: Record<string,string>; mediaDigests?: Record<string,string>; metadataDigest?: string; reportDigests?: Record<string,string>; retired?: boolean; offline?: boolean };
export type CaptureLibrary = CaptureNamespace & { id: string; createdAt: string; updatedAt: string; records: StoredCaptureRecord[]; warnings: string[]; reportLinks: CaptureReportLink[]; coverage?: CaptureCoverage; cloud?: CaptureCloudState };
export type CaptureLibrarySummary = Omit<CaptureLibrary, "records"> & { total: number; pending: number };
export type CaptureReportSources = { libraryId: string; sourceIds: string[]; records: StoredCaptureRecord[]; memoryRecords?: StoredCaptureRecord[]; kind: CaptureNamespace["kind"]; friend: string; account: string };
type ReportSourceEntry = { id: string; ownerId: string; reportId: string; libraryId: string; sourceIds: string[]; memorySourceIds?: string[]; createdAt: string };
const DB_NAME = "chengzi-desktop-capture-v1";
const LIBRARIES = "libraries", REPORTS = "reportSources", SUMMARIES = "librarySummaries";

function owner(value: string): string { if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error("请先登录，再读取自己的本机原文。"); return value; }
function reportKey(ownerId: string, reportId: string): string { owner(ownerId); if (typeof reportId !== "string" || !reportId.trim() || reportId.length > 300) throw new Error("报告编号不正确。"); return JSON.stringify([ownerId, reportId]); }
function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("当前环境不能保存本机原文，请使用支持本地存储的浏览器。"));
  return new Promise((resolve, reject) => {
    let blocked=false;
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db=request.result;
      if(!db.objectStoreNames.contains(LIBRARIES)){
        const libraries = db.createObjectStore(LIBRARIES, { keyPath: "id" }); libraries.createIndex("ownerId", "ownerId");
        const reports = db.createObjectStore(REPORTS, { keyPath: "id" }); reports.createIndex("ownerId", "ownerId"); reports.createIndex("libraryId", "libraryId");
      }
      if(!db.objectStoreNames.contains(SUMMARIES)){
        const summaries=db.createObjectStore(SUMMARIES,{keyPath:"id"});summaries.createIndex("ownerId","ownerId");
        // One atomic migration. Existing originals and report attribution stay
        // untouched; later list reads never deserialize the image payloads.
        const cursor=request.transaction!.objectStore(LIBRARIES).openCursor();
        cursor.onsuccess=()=>{try{const entry=cursor.result;if(entry){summaries.put(librarySummary(entry.value));entry.continue();}}catch{request.transaction?.abort();}};
      }
    };
    request.onsuccess = () => { const db = request.result;if(blocked){db.close();return;} db.onversionchange = () => db.close(); resolve(db); };
    request.onerror = () => reject(new Error("本机原文库无法打开，请允许站点使用本地存储。"));
    request.onblocked = () => {blocked=true;reject(new Error("原文库正在更新，请关闭其他打开本站的旧页面后重试。"));};
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
  const analyzed = new Map<string, number[]>();
  for (const link of library.reportLinks || []) {
    const time = Date.parse(link.createdAt);
    for (const id of link.sourceIds) { const times = analyzed.get(id) || []; times.push(time); analyzed.set(id, times); }
  }
  return library.records.filter(record => {
    const links = analyzed.get(record.localId);
    if (!links) return true;
    if (record.kind !== "text" || record.source.mediaKind !== "voice" || record.source.transcriptionStatus !== "visible-text" || !record.text.trim()) return false;
    const at = typeof record.source.transcriptCapturedAt === "string" ? Date.parse(record.source.transcriptCapturedAt) : NaN;
    // An older report may have consumed only the voice placeholder. Keep its
    // original link; only a proven later transcript becomes pending again.
    return Number.isFinite(at) && links.every(time => Number.isFinite(time) && time < at);
  });
}
function librarySummary(library:CaptureLibrary):CaptureLibrarySummary {
  const {records,...metadata}=library;
  return {...metadata,total:records.length,pending:pendingCaptureRecords(library).length};
}
function putLibrary(store:IDBObjectStore,library:CaptureLibrary) {
  store.put(library);
  store.transaction.objectStore(SUMMARIES).put(librarySummary(library));
}
export async function saveCaptureBatch(ownerId: string, input: unknown): Promise<{ library: CaptureLibrary; added: number; repeated: number; updatedVoice: number; total: number; newRecords: StoredCaptureRecord[] }> {
  owner(ownerId);
  const batch = validateCaptureBatch(input), namespace: CaptureNamespace = { ownerId, account: batch.account, friend: batch.friend, kind: batch.kind }, id = captureLibraryId(namespace), db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([LIBRARIES,SUMMARIES], "readwrite"), store = transaction.objectStore(LIBRARIES), request = store.get(id);
    let result: { library: CaptureLibrary; added: number; repeated: number; updatedVoice: number; total: number; newRecords: StoredCaptureRecord[] }; let reason: unknown;
    request.onsuccess = () => {
      try {
        const existing = request.result as CaptureLibrary | undefined;
        if (existing && existing.ownerId !== ownerId) throw new Error("这份原文不属于当前账号。");
        // The merger validates the batch again and uses its bounded history
        // metadata to preserve ordering across pages with tied timestamps.
        const merged = mergeCaptureRecords(existing?.records || [], input, namespace);
        const library: CaptureLibrary = { ...namespace, id, createdAt: existing?.createdAt || batch.capturedAt, updatedAt: batch.capturedAt, records: merged.records, warnings: batch.warnings, reportLinks: existing?.reportLinks || [], ...((batch.coverage || existing?.coverage) ? {coverage:batch.coverage || existing?.coverage} : {}), ...(existing?.cloud ? { cloud: existing.cloud } : {}) };
        putLibrary(store,library); result = { library, added: merged.added, repeated: merged.repeated, updatedVoice: merged.updatedVoice, total: merged.total, newRecords: merged.newRecords };
      } catch (error) { reason = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(reason || transaction.error || new Error("保存本机原文失败，可能是本地空间不足。")); };
  });
}
export async function listCaptureLibraries(ownerId: string): Promise<CaptureLibrarySummary[]> {
  owner(ownerId);
  const libraries = await read<CaptureLibrarySummary[]>(SUMMARIES, store => store.index("ownerId").getAll(ownerId));
  return libraries.filter(item => item.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
/** Atomically enrich existing voice sources; report links and record IDs stay intact. */
export async function applyVerifiedVoiceUpdates(ownerId: string, input: VerifiedVoiceUpdates): Promise<{ library: CaptureLibrary; updatedVoice: number; repeated: number; total: number }> {
  owner(ownerId);
  if (!input || typeof input.libraryId !== "string" || !input.libraryId || input.libraryId.length > 1200) throw Error("语音补全需要有效的原文库编号。");
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([LIBRARIES,SUMMARIES], "readwrite"), store = transaction.objectStore(LIBRARIES), request = store.get(input.libraryId);
    let result: { library: CaptureLibrary; updatedVoice: number; repeated: number; total: number }; let reason: unknown;
    request.onsuccess = () => {
      try {
        const existing = request.result as CaptureLibrary | undefined;
        if (!existing || existing.ownerId !== ownerId || existing.id !== input.libraryId) throw Error("当前账号找不到这份语音原文库。");
        const namespace: CaptureNamespace = { ownerId, account: existing.account, friend: existing.friend, kind: existing.kind };
        const merged = applyVerifiedVoiceUpdatesToRecords(existing.records, input, namespace);
        const library = merged.updatedVoice ? { ...existing, records: merged.records, updatedAt: Date.parse(existing.updatedAt) > Date.parse(input.capturedAt) ? existing.updatedAt : input.capturedAt } : existing;
        if (merged.updatedVoice) putLibrary(store,library);
        result = { library, updatedVoice: merged.updatedVoice, repeated: merged.repeated, total: merged.total };
      } catch (error) { reason = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(reason || transaction.error || new Error("语音补全未保存，原始记录保持不变。")); };
  });
}
export async function getCaptureLibrary(ownerId: string, libraryId: string): Promise<CaptureLibrary | null> {
  owner(ownerId); const result = await read<CaptureLibrary | undefined>(LIBRARIES, store => store.get(libraryId)); return result?.ownerId === ownerId ? result : null;
}
export async function getCaptureRecord(ownerId: string, libraryId: string, localId: string): Promise<StoredCaptureRecord | null> { return (await getCaptureLibrary(ownerId, libraryId))?.records.find(row => row.localId === localId) || null; }
export async function listPendingCaptureRecords(ownerId: string, libraryId: string): Promise<StoredCaptureRecord[]> { const library = await getCaptureLibrary(ownerId, libraryId); return library ? pendingCaptureRecords(library) : []; }
export async function linkReportSources(ownerId: string, reportId: string, input: { libraryId: string; sourceIds: string[]; memorySourceIds?: string[] }): Promise<void> {
  const id = reportKey(ownerId, reportId);
  if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || input.sourceIds.length > 1000 || input.sourceIds.some(value => typeof value !== "string" || !value)) throw new Error("报告需要关联有效的本机原文编号。");
  // Whole-history semantic findings can cite more than the small profile-memory
  // set. Keep the local evidence drawer bounded, while allowing every cited
  // historical source from the report to be opened when it belongs to this
  // library.
  if (input.memorySourceIds && (!Array.isArray(input.memorySourceIds) || input.memorySourceIds.length > 128 || input.memorySourceIds.some(value => typeof value !== "string" || !value))) throw new Error("资料依据编号不正确。");
  const sourceIds = [...new Set(input.sourceIds)], db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([LIBRARIES, REPORTS,SUMMARIES], "readwrite"), libraries = transaction.objectStore(LIBRARIES), reports = transaction.objectStore(REPORTS); let reason: unknown;
    const libraryRequest = libraries.get(input.libraryId);
    libraryRequest.onsuccess = () => {
      try {
        const library = libraryRequest.result as CaptureLibrary | undefined;
        if (!library || library.ownerId !== ownerId) throw new Error("当前账号找不到这份本机原文。");
        const valid = new Set(library.records.map(row => row.localId));
        if (sourceIds.some(value => !valid.has(value))) throw new Error("报告中的部分原文编号不属于这份材料。");
        if (input.memorySourceIds?.some(value => !valid.has(value))) throw new Error("资料依据不属于这份材料。");
        const linkRequest = reports.get(id);
        linkRequest.onsuccess = () => {
          try {
            const previous = linkRequest.result as ReportSourceEntry | undefined;
            if (previous && (previous.libraryId !== input.libraryId || JSON.stringify(previous.sourceIds) !== JSON.stringify(sourceIds))) throw new Error("这个报告已关联另一批原文，不能覆盖。");
            const createdAt = previous?.createdAt || new Date().toISOString();
            const memorySourceIds = [...new Set([...(previous?.memorySourceIds || []), ...(input.memorySourceIds || [])])].filter(value => !sourceIds.includes(value));
            reports.put({ id, ownerId, reportId, libraryId: input.libraryId, sourceIds, memorySourceIds, createdAt } satisfies ReportSourceEntry);
            const reportLinks = (library.reportLinks || []).filter(link => link.reportId !== reportId);
            putLibrary(libraries,{ ...library, reportLinks: [...reportLinks, { reportId, sourceIds, memorySourceIds, createdAt }] });
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
  return { libraryId: library.id, sourceIds: entry.sourceIds, records: entry.sourceIds.map(sourceId => byId.get(sourceId)).filter((record): record is StoredCaptureRecord => !!record), memoryRecords: (entry.memorySourceIds || []).map(sourceId => byId.get(sourceId)).filter((record): record is StoredCaptureRecord => !!record), kind: library.kind, friend: library.friend, account: library.account };
}
export async function removeCaptureLibrary(ownerId: string, libraryId: string): Promise<void> {
  owner(ownerId); const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([LIBRARIES, REPORTS,SUMMARIES], "readwrite"), libraries = transaction.objectStore(LIBRARIES), reports = transaction.objectStore(REPORTS), request = libraries.get(libraryId);
    request.onsuccess = () => {
      const library = request.result as CaptureLibrary | undefined;
      if (!library || library.ownerId !== ownerId) return;
      libraries.delete(libraryId);transaction.objectStore(SUMMARIES).delete(libraryId); const links = reports.index("libraryId").openCursor(libraryId);
      links.onsuccess = () => { const cursor = links.result; if (cursor) { if ((cursor.value as ReportSourceEntry).ownerId === ownerId) cursor.delete(); cursor.continue(); } };
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error || new Error("删除本机原文失败。")); };
  });
}

/** Cloud metadata never changes the original material or its attribution. */
export async function disableMissingCaptureCloud(ownerId:string,libraryId:string,expected:CaptureCloudState):Promise<CaptureLibrarySummary|null> {
  owner(ownerId);const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction([LIBRARIES,SUMMARIES],"readwrite"),store=tx.objectStore(LIBRARIES),request=store.get(libraryId);
    let result:CaptureLibrarySummary|null=null,reason:unknown;
    request.onsuccess=()=>{
      try{
        const current=request.result as CaptureLibrary|undefined;
        if(!current||current.ownerId!==ownerId)return;
        // A list response is a snapshot. It cannot disable a library restored
        // or synchronized by another operation since that snapshot began.
        const next=JSON.stringify(current.cloud)===JSON.stringify(expected)?{...current,cloud:{...expected,enabled:false}}:current;
        if(next!==current)putLibrary(store,next);
        result=librarySummary(next);
      }catch(error){reason=error;tx.abort();}
    };
    tx.oncomplete=()=>{db.close();resolve(result);};
    tx.onerror=tx.onabort=()=>{db.close();reject(reason||tx.error||Error("同步状态暂时未更新，请重试。"));};
  });
}
export async function setCaptureCloudState(ownerId: string, libraryId: string, cloud: CaptureCloudState, receipt?: { expected?: CaptureCloudState; restore?: boolean }): Promise<CaptureCloudState> {
  owner(ownerId); const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LIBRARIES,SUMMARIES], "readwrite"), store = tx.objectStore(LIBRARIES), request = store.get(libraryId);
    let reason: unknown, saved = cloud;
    request.onsuccess = () => {
      const library = request.result as CaptureLibrary | undefined;
      if (!library || library.ownerId !== ownerId) { reason = Error("当前账号找不到这份聊天。"); tx.abort(); return; }
      if (receipt) {
        const current = library.cloud, expected = receipt.expected;
        // A response from an older request cannot revive a deleted library or
        // attach its ACKs to a restored cloud epoch. Check inside the same IDB
        // transaction as the write, including changes made by another tab.
        if (current?.retired || current && !current.enabled && !receipt.restore
          || expected && (!current || current.id !== expected.id || current.epoch !== expected.epoch)
          || !expected && current && (current.id !== cloud.id || current.epoch !== cloud.epoch)) {
          reason = Error("这份聊天的同步状态已变化，请重新打开后继续。"); tx.abort(); return;
        }
        if (current && current.epoch === cloud.epoch && current.id === cloud.id) {
          const merge = (prior: Record<string,string> = {}, incoming: Record<string,string> = {}, baseline: Record<string,string> = {}) => {
            const result = { ...prior };
            for (const [key,value] of Object.entries(incoming)) {
              // Preserve a receipt changed since this request started. A
              // subsequent pass can reconcile it against the current source.
              if (prior[key] === undefined || prior[key] === baseline[key] || prior[key] === value) result[key] = value;
            }
            return result;
          };
          const metadataChanged = current.metadataDigest !== expected?.metadataDigest && current.metadataDigest !== cloud.metadataDigest;
          saved = {
            ...current, ...cloud,
            total: Math.max(current.total, cloud.total),
            revision: current.revision===undefined&&cloud.revision===undefined?undefined:Math.max(current.revision||0,cloud.revision||0),
            syncedAt: current.syncedAt > cloud.syncedAt ? current.syncedAt : cloud.syncedAt,
            digests: merge(current.digests, cloud.digests, expected?.digests),
            mediaDigests: merge(current.mediaDigests, cloud.mediaDigests, expected?.mediaDigests),
            reportDigests: merge(current.reportDigests, cloud.reportDigests, expected?.reportDigests),
            ...(metadataChanged ? { metadataDigest:current.metadataDigest, subjectId:current.subjectId } : {}),
          };
        }
      }
      putLibrary(store,{ ...library, cloud:saved });
    };
    tx.oncomplete = () => { db.close(); resolve(saved); };
    tx.onerror = tx.onabort = () => { db.close(); reject(reason || tx.error || Error("同步状态未保存，请重试。")); };
  });
}

/** Cache a complete, authenticated cloud snapshot. Device-only images are retained. */
export async function cacheCloudCaptureLibrary(ownerId: string, input: Omit<CaptureLibrary, "id" | "ownerId">): Promise<CaptureLibrary> {
  owner(ownerId);
  const namespace: CaptureNamespace = { ownerId, account: input.account, friend: input.friend, kind: input.kind };
  const id = captureLibraryId(namespace), db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LIBRARIES, REPORTS,SUMMARIES], "readwrite"), store = tx.objectStore(LIBRARIES), request = store.get(id);
    let result: CaptureLibrary, reason: unknown;
    request.onsuccess = () => {
      try {
        let previous = request.result as CaptureLibrary | undefined;
        if (previous && previous.ownerId !== ownerId) throw Error("账号不匹配，未保存同步内容。");
        if(previous?.cloud && input.cloud && previous.cloud.epoch!==input.cloud.epoch){
          const retiredId=`${id}:retired:${previous.cloud.epoch}`;
          putLibrary(store,{...previous,id:retiredId,cloud:{...previous.cloud,enabled:false,retired:true}});
          for(const link of previous.reportLinks)tx.objectStore(REPORTS).put({id:reportKey(ownerId,link.reportId),ownerId,reportId:link.reportId,libraryId:retiredId,sourceIds:link.sourceIds,memorySourceIds:link.memorySourceIds||[],createdAt:link.createdAt} satisfies ReportSourceEntry);
          previous=undefined;
        }
        const byId = new Map((previous?.records || []).map(row => [row.localId, row]));
        const records = input.records.map(row => {
          const local = byId.get(row.localId); byId.delete(row.localId);
          // A local newer voice transcript must not be replaced by a stale cloud placeholder.
          if (local?.source.transcriptionStatus === "visible-text" && row.source.transcriptionStatus !== "visible-text" && local.source.mediaKind === "voice") return local;
          const upgrade=local?.kind==="other"&&local.source.mediaKind==="voice"&&row.kind==="text"&&row.source.mediaKind==="voice"&&row.source.transcriptionStatus==="visible-text"&&local.sender===row.sender&&local.senderRole===row.senderRole&&local.at===row.at&&(local.id||"")===(row.id||"");
          if(local&&!upgrade&&(local.text!==row.text||local.senderRole!==row.senderRole||local.sender!==row.sender||local.at!==row.at||local.kind!==row.kind))return {...local,source:{...local.source,cloudConflict:true}};
          return { ...row, namespace: captureNamespaceKey(namespace), ...(local?.images?.length && !row.images?.length ? { images: local.images } : {}), source: { ...(local?.source || {}), ...row.source } };
        });
        const links = new Map((previous?.reportLinks || []).map(link => [link.reportId, link]));
        for (const link of input.reportLinks || []) {
          const old=links.get(link.reportId);
          if(old&&JSON.stringify(old.sourceIds)!==JSON.stringify(link.sourceIds))throw Error("报告的原文关联有差异，已保留原有材料，请重新核对。");
          links.set(link.reportId,{...link,memorySourceIds:[...new Set([...(old?.memorySourceIds||[]),...(link.memorySourceIds||[])])]});
        }
        result = { ...input, ...namespace, id, records: [...records, ...byId.values()], reportLinks: [...links.values()], cloud: input.cloud ? { ...previous?.cloud, ...input.cloud } : previous?.cloud };
        putLibrary(store,result);
        for (const link of links.values()) tx.objectStore(REPORTS).put({ id: reportKey(ownerId, link.reportId), ownerId, reportId: link.reportId, libraryId: id, sourceIds: link.sourceIds, memorySourceIds: link.memorySourceIds || [], createdAt: link.createdAt } satisfies ReportSourceEntry);
      } catch (error) { reason = error; tx.abort(); }
    };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(reason || tx.error || Error("聊天下载未保存，本机材料保持不变。")); };
  });
}
