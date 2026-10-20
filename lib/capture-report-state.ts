import type { CaptureLibrary } from "./desktop-capture-vault";
import { captureImageDigest } from "./capture-image-digest";

export type CaptureMaterialVersion = {libraryId:string;cloudId:string;epoch:number;total:number;updatedAt:string;contentKey?:string};
export async function captureMaterialVersion(library:CaptureLibrary):Promise<CaptureMaterialVersion> {
  // This local display key ignores collection timestamps and sync bookkeeping.
  // The server uses its own cryptographic snapshot for billing and reuse.
  let first=2166136261,second=5381;
  const add=(text:string)=>{for(let i=0;i<text.length;i++){first=Math.imul(first^text.charCodeAt(i),16777619);second=Math.imul(second,33)^text.charCodeAt(i);}};
  // Images use the same SHA cache as transport; progress/metadata renders never
  // rescan base64. Work is asynchronous even for an old local cache on refresh.
  const imageKeys=await Promise.all(library.records.map(async row=>Promise.all((row.images||[]).map(image=>captureImageDigest(image.data)))));
  for(const [index,row] of library.records.entries()){
    add(JSON.stringify([row.localId,row.kind,row.senderRole,row.at,row.text,row.source.mediaKind,row.source.transcriptionStatus,row.source.pinned,row.source.materialRole]));
    for(const key of imageKeys[index])add(key);
  }
  return {libraryId:library.id,cloudId:library.cloud?.id||"",epoch:library.cloud?.epoch||0,total:library.records.length,updatedAt:library.updatedAt,contentKey:`${first>>>0}:${second>>>0}`};
}
export function sameCaptureMaterial(version:CaptureMaterialVersion,current:CaptureMaterialVersion):boolean {
  return version.libraryId===current.libraryId&&version.cloudId===current.cloudId&&version.epoch===current.epoch&&version.total===current.total&&(version.contentKey&&current.contentKey?version.contentKey===current.contentKey:version.updatedAt===current.updatedAt);
}
export function captureMaterialChanged(primary:CaptureMaterialVersion,related:CaptureMaterialVersion[],currentPrimary:CaptureMaterialVersion,currentRelated:CaptureMaterialVersion[]):boolean {
  return !sameCaptureMaterial(primary,currentPrimary)||related.length!==currentRelated.length||related.some(version=>{
    const current=currentRelated.find(value=>value.libraryId===version.libraryId);
    return !current||!sameCaptureMaterial(version,current);
  });
}
export function captureReportDate(value:unknown):string {
  const date=new Date(typeof value==="number"||typeof value==="string"?value:"");
  return Number.isFinite(date.getTime())?date.toLocaleString("zh-CN",{hour12:false,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
}
