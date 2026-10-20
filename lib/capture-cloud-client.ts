import { captureLibraryId, captureNamespaceKey, type CaptureImage, type StoredCaptureRecord } from "./desktop-capture";
import { cacheCloudCaptureLibrary, getCaptureLibrary, listCaptureLibraries, readReportSources, linkReportSources, setCaptureCloudState, type CaptureCloudState, type CaptureLibrary, type CaptureLibrarySummary, type CaptureReportSources } from "./desktop-capture-vault";
import { sanitizeCloudCaptureRecord, type CloudCaptureLibrary, type CloudCaptureRecord, type CloudMediaRef } from "./capture-cloud";

const endpoint = "/api/web/capture/library";
export type SyncedLibrarySummary = CaptureLibrarySummary & { cloudOnly?: boolean; cloudInfo?: CloudCaptureLibrary };
export type CaptureLibraryPreview = (library:CaptureLibrary)=>void;
export type CaptureSyncProgress = (done:number,total:number,phase:"records"|"images"|"reports")=>void;
type SyncOptions = {subjectId?:string;restore?:boolean;onProgress?:CaptureSyncProgress};
async function concurrentMap<T,R>(items:T[],work:(item:T,index:number)=>Promise<R>):Promise<R[]> {
  const results:R[]=new Array(items.length);let next=0,failed=false,failure:unknown;
  await Promise.all(Array.from({length:Math.min(3,items.length)},async()=>{
    while(!failed){const index=next++;if(index>=items.length)return;
      try{results[index]=await work(items[index],index);}catch(error){if(!failed){failed=true;failure=error;}}
    }
  }));
  if(failed)throw failure;return results;
}
export class CaptureCloudError extends Error {
  constructor(message: string, public status: number, public details: Record<string, any> = {}) { super(message); }
}
const identityChecks=new Map<string,Promise<void>>();
function confirmSameAccount(owner:string):Promise<void>{
  const current=identityChecks.get(owner);if(current)return current;
  const check=(async()=>{
    const response=await fetch("/api/account/credits",{credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(30000)});
    const value=await response.json().catch(()=>({})) as {account?:{userId?:unknown}};
    if(response.status===401||response.status===403||response.ok&&value.account?.userId!==owner)throw new CaptureCloudError("登录状态已变化，请回到原账号继续查看。",401);
    if(!response.ok)throw new CaptureCloudError("账号连接暂时不可用，已取回的文字仍可阅读，请重新打开这份聊天重试图片。",503);
  })().finally(()=>{if(identityChecks.get(owner)===check)identityChecks.delete(owner);});
  identityChecks.set(owner,check);return check;
}
async function request<T extends {ownerId?:string}>(owner: string, query = "", body?: Record<string, unknown>, method = "POST", retried=false): Promise<T> {
  const response = await fetch(endpoint + query, {
    method: body ? method : "GET", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30000),
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify({ ...body, expectedOwnerId: owner }) } : {}),
  });
  const result = await response.json().catch(() => ({ error: "同步服务暂时没有返回结果，请重试。" })) as Record<string,any>;
  if(!body&&!retried&&[401,502,503,504].includes(response.status)){
    await confirmSameAccount(owner);
    return request<T>(owner,query,undefined,method,true);
  }
  if (!response.ok) throw new CaptureCloudError(result.error || "聊天同步未完成，请重试。", response.status, result);
  if (result.ownerId !== owner) throw new CaptureCloudError("登录账号已变化，请回到原账号继续同步。", 409);
  return result as T;
}
export async function listCloudCaptureLibraries(owner: string): Promise<CloudCaptureLibrary[]> {
  const items: CloudCaptureLibrary[] = []; let cursor = "";
  do {
    const data = await request<{ownerId:string;libraries:CloudCaptureLibrary[];nextCursor?:string|null}>(owner, "?limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
    items.push(...data.libraries); const next = data.nextCursor ? String(data.nextCursor) : "";
    if (next && next === cursor) throw Error("聊天列表分页停滞，请刷新后重试。"); cursor = next;
  } while (cursor);
  return items;
}
function localId(ownerId: string, info: CloudCaptureLibrary) { return captureLibraryId({ ownerId, account:info.account, friend:info.friend, kind:info.kind }); }
function cloudState(info: CloudCaptureLibrary, prior?: CaptureCloudState): CaptureCloudState {
  return { ...prior, id: info.id, epoch: info.epoch, enabled: true, offline:false, retired:false, total: info.total, syncedAt: new Date().toISOString(), subjectId: info.subjectId || "" };
}
export async function listSyncedCaptureLibraries(owner: string): Promise<{libraries:SyncedLibrarySummary[];warning:string}> {
  const local = await listCaptureLibraries(owner);
  try {
    const remote = await listCloudCaptureLibraries(owner), byLocal = new Map(local.map(row => [row.id, row as SyncedLibrarySummary]));
    for (const info of remote) {
      const id = localId(owner, info), existing = byLocal.get(id);
      byLocal.set(id, existing ? { ...existing, cloud: cloudState(info, existing.cloud), cloudInfo: info } : {
        id, ownerId:owner, account:info.account, friend:info.friend, kind:info.kind, createdAt:info.createdAt, updatedAt:info.updatedAt,
        total:info.total, pending:Math.max(0,info.total-new Set((info.reportLinks || []).flatMap(row=>row.sourceIds)).size),
        warnings:info.warnings || [], reportLinks:info.reportLinks || [], cloud:cloudState(info), cloudOnly:true, cloudInfo:info,
      });
    }
    // A deleted remote library must not be resurrected by an old browser's background sync.
    const active = new Set(remote.map(row=>row.id));
    for (const item of local) if (item.cloud?.enabled && !active.has(item.cloud.id)) {
      const cloud = { ...item.cloud, enabled:false };
      await setCaptureCloudState(owner,item.id,cloud);
      byLocal.set(item.id,{...item,cloud});
    }
    return { libraries:[...byLocal.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)), warning:"" };
  } catch(error) {
    return { libraries:local, warning:error instanceof Error ? error.message : "云端聊天暂时无法读取，本机内容仍可使用。" };
  }
}
async function digest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,"0")).join("");
}
async function rowDigest(row: CloudCaptureRecord) { return digest(JSON.stringify({ ...row, firstCapturedAt:undefined, lastCapturedAt:undefined })); }
const bytesFromBase64 = (value:string) => Uint8Array.from(atob(value),character=>character.charCodeAt(0));
export async function loadCloudCaptureImage(owner:string, libraryId:string, media:CloudMediaRef): Promise<CaptureImage> {
  const parts:string[]=[];
  for(let chunk=0;chunk<media.chunks;chunk++) {
    const data=await request<{ownerId:string;data:string;chunkIndex:number;media:CloudMediaRef}>(owner,`?id=${encodeURIComponent(libraryId)}&mediaId=${encodeURIComponent(media.id)}&chunk=${chunk}`);
    if(data.chunkIndex!==chunk || data.media.sha256!==media.sha256)throw Error("图片来源不一致，已停止读取。");
    parts.push(data.data);
  }
  const data=parts.join("");
  if(await digest(bytesFromBase64(data))!==media.sha256)throw Error("图片下载不完整，请重试。");
  return {mime:media.mime,name:media.name,data};
}
function storedRecord(owner:string, info:CloudCaptureLibrary, row:CloudCaptureRecord):StoredCaptureRecord {
  const {imageCount,media,seq,order,...original}=row;
  return {...original,namespace:captureNamespaceKey({ownerId:owner,account:info.account,friend:info.friend,kind:info.kind}),source:{...row.source,imageCount,...(imageCount?{cloudMediaUnavailable:!media?.length}:{} )}};
}
export async function downloadCloudCaptureLibrary(owner:string, id:string, progress?:CaptureSyncProgress, preview?:CaptureLibraryPreview):Promise<CaptureLibrary> {
  let cursor="", info:CloudCaptureLibrary|null=null; const records:StoredCaptureRecord[]=[], mediaDigests:Record<string,string>={};
  const seenCursors=new Set<string>(),seenRecords=new Set<string>();
  const images:{record:StoredCaptureRecord;media:CloudMediaRef}[]=[];
  do {
    const data=await request<{ownerId:string;library:CloudCaptureLibrary;records:CloudCaptureRecord[];nextCursor?:string|null}>(owner,`?id=${encodeURIComponent(id)}&limit=500${cursor?"&cursor="+encodeURIComponent(cursor):""}`);
    if(!data.library||data.library.id!==id||!Number.isSafeInteger(data.library.total)||data.library.total<0||!Array.isArray(data.records)||data.records.length>500)throw Error("云端聊天分页格式不正确，未保存不完整材料。");
    if(info && (info.epoch!==data.library.epoch||info.account!==data.library.account||info.friend!==data.library.friend||info.kind!==data.library.kind||info.total!==data.library.total))throw Error("这份云端聊天已更新，请重新打开。"); info=data.library;
    for(const row of data.records) {
      if(!row||typeof row.localId!=="string"||!row.localId||seenRecords.has(row.localId))throw Error("云端聊天分页包含重复或无效编号，未保存不完整材料。");
      seenRecords.add(row.localId);
      const stored=storedRecord(owner,info,row);
      if(row.imageCount && row.media?.length===row.imageCount && row.media.every((media,index)=>media.index===index)) { stored.images=new Array(row.imageCount); for(const media of row.media)images.push({record:stored,media}); stored.source.cloudMediaUnavailable=true;stored.source.cloudMediaPending=true; }
      else if(row.imageCount)stored.source.cloudMediaUnavailable=true;
      records.push(stored);
    }
    progress?.(records.length,info.total,"records");
    const next=data.nextCursor?String(data.nextCursor):"";
    if(records.length>info.total||next&&(!data.records.length||seenCursors.has(next)))throw Error("聊天下载分页停滞或数量不一致，请重试。");
    if(next)seenCursors.add(next);cursor=next;
  }while(cursor);
  if(!info)throw Error("这份聊天尚未同步。");
  if(records.length!==info.total)throw Error("聊天数量发生变化，请重新打开，避免遗漏。");
  const cached=await getCaptureLibrary(owner,localId(owner,info));
  const reusable=cached?.cloud?.epoch===info.epoch&&!cached.cloud.retired?new Map(cached.records.map(row=>[row.localId,row])):new Map<string,StoredCaptureRecord>();
  const snapshot=()=>({account:info!.account,friend:info!.friend,kind:info!.kind,createdAt:info!.createdAt,updatedAt:info!.updatedAt,
    records:records.map(row=>{const count=Number(row.source.imageCount)||0,complete=!!row.images&&row.images.filter(Boolean).length===count;
      return {...row,...(complete?{images:[...row.images!]}:{images:undefined}),source:{...row.source,...(count?{cloudMediaPending:!complete&&row.source.cloudMediaPending===true,cloudMediaUnavailable:!complete}:{})}};}),
    warnings:info!.warnings||[],reportLinks:info!.reportLinks||[],cloud:{...cloudState(info!),digests:{},mediaDigests:{...mediaDigests}}});
  // Keep the complete text/voice transcript available even while pictures download.
  // A snapshot never exposes a sparse image list as complete material.
  let initial:CaptureLibrary|undefined;
  if(preview){initial=await cacheCloudCaptureLibrary(owner,snapshot());preview(initial);}
  let completedImages=0;progress?.(0,images.length,"images");
  try{await concurrentMap(images,async({record,media})=>{
    const key=JSON.stringify([record.localId,media.index]),prior=reusable.get(record.localId)?.images?.[media.index];
    const matches=prior&&cached?.cloud?.mediaDigests?.[key]===media.sha256&&await digest(bytesFromBase64(prior.data))===media.sha256;
    record.images![media.index]=matches?prior:await loadCloudCaptureImage(owner,id,media);
    mediaDigests[key]=media.sha256;progress?.(++completedImages,images.length,"images");
    if(preview&&initial&&record.images!.filter(Boolean).length===Number(record.source.imageCount)){
      const fresh=snapshot();const byId=new Map(fresh.records.map(row=>[row.localId,row]));
      // Preserve newer local transcripts/conflicts already resolved by the vault.
      preview({...initial,records:initial.records.map(row=>{const remote=byId.get(row.localId);return remote&&row.text===remote.text&&row.kind===remote.kind&&!row.source.cloudConflict?remote:row;}),cloud:fresh.cloud});
    }
  });}catch(error){
    // Keep verified, fully downloaded records when a later image fails. All
    // workers have settled, so a reopen can safely reuse these exact hashes.
    if(preview&&initial&&!(error instanceof CaptureCloudError&&[404,410].includes(error.status)))await cacheCloudCaptureLibrary(owner,snapshot());
    throw error;
  }
  const final=snapshot(),digests:Record<string,string>={};
  for(const row of final.records)digests[row.localId]=await rowDigest(sanitizeCloudCaptureRecord(row));
  return cacheCloudCaptureLibrary(owner,{...final,cloud:{...final.cloud,digests}});
}
export async function openSyncedCaptureLibrary(owner:string, item:SyncedLibrarySummary, progress?:CaptureSyncProgress, preview?:CaptureLibraryPreview):Promise<CaptureLibrary|null> {
  if(item.cloud?.enabled) {
    try{return await downloadCloudCaptureLibrary(owner,item.cloud.id,progress,preview);}
    catch(error){
      const unavailable=error instanceof TypeError || error instanceof DOMException&&["TimeoutError","AbortError","NetworkError"].includes(error.name) || error instanceof CaptureCloudError&&error.status>=500;
      const local=unavailable?await getCaptureLibrary(owner,item.id):null;
      if(local)return {...local,cloud:{...(local.cloud||item.cloud),offline:true}};
      throw error;
    }
  }
  return getCaptureLibrary(owner,item.id);
}
const syncing=new Map<string,Promise<CaptureLibrary>>();
export function syncCaptureLibrary(owner:string, library:CaptureLibrary, options:SyncOptions={}):Promise<CaptureLibrary> {
  const key=JSON.stringify([owner,library.id]), running=syncing.get(key);
  const signature=(value:CaptureLibrary)=>JSON.stringify([value.records.map(sanitizeCloudCaptureRecord),value.reportLinks]);
  const operation=(async()=>{
    if(running)await running.catch(()=>undefined);
    let snapshot=await getCaptureLibrary(owner,library.id);if(!snapshot)throw Error("本机聊天已删除，同步已停止。");
    for(let attempt=0;attempt<3;attempt++){
      const before=signature(snapshot),result=await performSync(owner,snapshot,{...options,restore:attempt===0&&options.restore});
      const latest=await getCaptureLibrary(owner,library.id);if(!latest)throw Error("本机聊天已删除，同步已停止。");
      if(signature(latest)===before)return {...latest,cloud:result.cloud};
      snapshot=latest;
    }
    throw Error("还有刚导入的新内容待同步，本机材料已保留。请稍后点击继续同步。");
  })().finally(()=>{if(syncing.get(key)===operation)syncing.delete(key);});
  syncing.set(key,operation);return operation;
}
async function performSync(owner:string, library:CaptureLibrary, options:SyncOptions):Promise<CaptureLibrary> {
  if(library.records.some(row=>row.source.cloudMediaPending===true))throw Error("图片仍在取回，请重新打开这份聊天完成下载后再同步。");
  if(library.ownerId!==owner)throw Error("账号已变化，未上传材料。");
  if(library.cloud?.retired)throw Error("这份旧的离线副本不会重新同步，请打开当前云端聊天。");
  let state=library.cloud; const digests={...(options.restore?{}:state?.digests||{})}, mediaDigests:Record<string,string>={...(options.restore?{}:state?.mediaDigests||{})};
  const pending:{record:CloudCaptureRecord;hash:string}[]=[];
  for(const row of library.records){const record=sanitizeCloudCaptureRecord(row),hash=await rowDigest(record);if(options.restore||digests[row.localId]!==hash)pending.push({record,hash});}
  const batches:typeof pending[]=[];let batch:typeof pending=[],size=0;
  for(const entry of pending){const bytes=new TextEncoder().encode(JSON.stringify(entry.record)).byteLength;if(batch.length&&(batch.length>=100||size+bytes>700000)){batches.push(batch);batch=[];size=0;}batch.push(entry);size+=bytes;}
  if(batch.length||!batches.length)batches.push(batch);
  let count=library.records.length-pending.length;
  for(const entries of batches){
    const body={
      action:"sync",requestId:crypto.randomUUID(),confirmed:true,...(state?{libraryId:state.id,expectedEpoch:state.epoch}:{}),...(options.restore?{restore:true}:{}),
      library:{account:library.account,friend:library.friend,kind:library.kind,createdAt:library.createdAt,updatedAt:library.updatedAt,...(options.subjectId!==undefined?{subjectId:options.subjectId||null}:{})},
      records:entries.map(entry=>entry.record),warnings:library.warnings,
    };
    type SyncResult={ownerId:string;library:CloudCaptureLibrary;conflicts?:number|unknown[]};
    let result:SyncResult;
    try{result=await request<SyncResult>(owner,"",body);}catch(error){
      const info=error instanceof CaptureCloudError&&error.status===409?error.details.library as CloudCaptureLibrary|undefined:undefined;
      if(!state&&info&&!info.deleted&&info.account===library.account&&info.friend===library.friend&&info.kind===library.kind){state=cloudState(info);result=await request<SyncResult>(owner,"",{...body,libraryId:state.id,expectedEpoch:state.epoch});}
      else throw error;
    }
    if(result.conflicts && (typeof result.conflicts==="number"?result.conflicts:result.conflicts.length))throw Error("部分原文与云端不同，已保留双方材料。请刷新后核对，未覆盖原文。");
    for(const entry of entries)digests[entry.record.localId]=entry.hash;
    state={...cloudState(result.library,state),digests,mediaDigests};await setCaptureCloudState(owner,library.id,state);
    count+=entries.length;options.onProgress?.(count,library.records.length,"records");
  }
  if(!state)throw Error("同步状态未建立，请重试。");
  const imageJobs=library.records.flatMap(row=>(row.images||[]).map((img,index)=>({row,index,img})));
  let completedImages=0,unflushedImages=0,saveAck:Promise<unknown>=Promise.resolve();options.onProgress?.(0,imageJobs.length,"images");
  const flushImages=()=>{
    if(!unflushedImages)return saveAck;
    unflushedImages=0;
    const acknowledged={...mediaDigests};
    saveAck=saveAck.then(async()=>{state={...state!,mediaDigests:acknowledged};await setCaptureCloudState(owner,library.id,state);});
    return saveAck;
  };
  try{await concurrentMap(imageJobs,async({row,index,img})=>{
    const hash=await digest(bytesFromBase64(img.data)),key=JSON.stringify([row.localId,index]);if(mediaDigests[key]===hash){options.onProgress?.(++completedImages,imageJobs.length,"images");return;}
    const chunks=Math.ceil(img.data.length/400000);
    for(let n=0;n<chunks;n++){
      const result=await request<{ownerId:string;ready:boolean}>(owner,"",{action:"sync-media",libraryId:state!.id,expectedEpoch:state!.epoch,localId:row.localId,index,mime:img.mime,name:img.name,sha256:hash,chunkIndex:n,chunkCount:chunks,data:img.data.slice(n*400000,(n+1)*400000)});
      if(n===chunks-1&&!result.ready)throw Error("图片尚未完整同步，请继续同步。");
    }
    // One IndexedDB library write used to clone every saved picture after
    // each individual upload. Batch ACKs, and flush settled workers on both
    // success and failure so retries reuse all verified uploads.
    mediaDigests[key]=hash;unflushedImages++;
    if(unflushedImages>=8)await flushImages();
    options.onProgress?.(++completedImages,imageJobs.length,"images");
  });}finally{await flushImages();await saveAck;}
  let completedReports=0;options.onProgress?.(0,library.reportLinks.length,"reports");
  for(const link of library.reportLinks){await request(owner,"",{action:"link-report",libraryId:state.id,expectedEpoch:state.epoch,...link});options.onProgress?.(++completedReports,library.reportLinks.length,"reports");}
  const current=await getCaptureLibrary(owner,library.id);if(!current)throw Error("本机材料已被删除，同步已停止。");
  return {...library,cloud:state};
}
/** Persist the local receipt first; cloud errors must never restart a paid analysis. */
export async function linkSyncedReportSources(owner:string,reportId:string,input:Parameters<typeof linkReportSources>[2]):Promise<{cloudError:string}>{
  await linkReportSources(owner,reportId,input);
  const library=await getCaptureLibrary(owner,input.libraryId);
  if(!library?.cloud?.enabled)return {cloudError:""};
  // The full-history path has already synchronized the complete library (and
  // its media) immediately before analysis. Re-running syncCaptureLibrary
  // here used to walk every image again just to attach a report link, making
  // the user wait through a second "逐张保存图片" pass. Link the report
  // against the verified cloud epoch directly; if that epoch changed, keep
  // the report and surface a non-blocking retry notice instead of re-uploading
  // all media in the critical path.
  try {
    await request(owner, "", {
      action: "link-report", confirmed: true, reportId,
      libraryId: library.cloud.id, expectedEpoch: library.cloud.epoch,
      sourceIds: input.sourceIds, memorySourceIds: input.memorySourceIds || [],
      createdAt: new Date().toISOString(),
    });
    return {cloudError:""};
  } catch {
    return {cloudError:"报告已保存，原文关联尚未同步完成。请回到已导入材料点击“继续同步”，无需重新分析。"};
  }
}
export async function deleteCloudCaptureLibrary(owner:string, library:CaptureLibrary):Promise<void>{
  if(!library.cloud)return;
  await request(owner,"?id="+encodeURIComponent(library.cloud.id),{confirmed:true,expectedEpoch:library.cloud.epoch},"DELETE");
  await setCaptureCloudState(owner,library.id,{...library.cloud,enabled:false,digests:{},mediaDigests:{}});
}
export async function readSyncedReportSources(owner:string,reportId:string):Promise<CaptureReportSources|null>{
  const local=await readReportSources(owner,reportId).catch(()=>null);
  if(local?.records.length&&![...local.records,...(local.memoryRecords||[])].some(row=>row.source.cloudMediaPending===true))return local;
  try{
    const data=await request<{ownerId:string;library:CloudCaptureLibrary;sourceIds:string[];memorySourceIds?:string[];records:CloudCaptureRecord[];memoryRecords?:CloudCaptureRecord[]}>(owner,"?reportId="+encodeURIComponent(reportId));
    const convert=async(row:CloudCaptureRecord)=>{const stored=storedRecord(owner,data.library,row);if(row.imageCount&&row.media?.length===row.imageCount&&row.media.every((media,index)=>media.index===index)){stored.images=[];for(const media of row.media)stored.images.push(await loadCloudCaptureImage(owner,data.library.id,media));stored.source.cloudMediaUnavailable=false;}else if(row.imageCount)stored.source.cloudMediaUnavailable=true;return stored;};
    return {libraryId:localId(owner,data.library),sourceIds:data.sourceIds,records:await concurrentMap(data.records,convert),memoryRecords:await concurrentMap(data.memoryRecords||[],convert),account:data.library.account,friend:data.library.friend,kind:data.library.kind};
  }catch(error){if(error instanceof CaptureCloudError&&error.status===404)return local;throw error;}
}
