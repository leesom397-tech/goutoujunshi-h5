import { loadCloudCaptureImage } from "@/lib/capture-cloud-client";
import { captureNamespaceKey, type StoredCaptureRecord } from "@/lib/desktop-capture";
import type { CaptureReportSources } from "@/lib/desktop-capture-vault";
import type { CloudCaptureLibrary, CloudCaptureRecord } from "@/lib/capture-cloud";

/** Resolve a cited record only inside its named library, including its verified image previews. */
export async function readReportLibrarySources(ownerId:string, libraryId:string, sourceIds:string[], signal:AbortSignal):Promise<CaptureReportSources>{
  if(!libraryId||!sourceIds.length)throw Error("这条依据缺少材料来源，无法定位原记录。");
  const needed=new Set(sourceIds),found=new Map<string,CloudCaptureRecord>(),seen=new Set<string>();
  let cursor="",info:CloudCaptureLibrary|null=null;
  do{
    const response=await fetch(`/api/web/capture/library?id=${encodeURIComponent(libraryId)}&limit=500${cursor?"&cursor="+encodeURIComponent(cursor):""}`,{credentials:"same-origin",cache:"no-store",signal});
    const data=await response.json() as {ownerId:string;library:CloudCaptureLibrary;records:CloudCaptureRecord[];nextCursor?:string;error?:string};
    if(!response.ok)throw Error(data.error||"原始材料暂时无法读取，请稍后重试。");
    if(data.ownerId!==ownerId||data.library?.id!==libraryId||!Array.isArray(data.records))throw Error("材料来源已变化，请回到当前账号重新打开报告。");
    if(info&&(info.epoch!==data.library.epoch||info.kind!==data.library.kind||info.account!==data.library.account||info.friend!==data.library.friend))throw Error("材料已更新，请重新打开依据。");
    info=data.library;
    for(const record of data.records)if(needed.has(record.localId))found.set(record.localId,record);
    if(found.size===needed.size)break;
    const next=String(data.nextCursor||"");if(next&&(!data.records.length||seen.has(next)))throw Error("材料读取未继续，请稍后重试。");
    if(next)seen.add(next);cursor=next;
  }while(cursor);
  if(!info)throw Error("这份材料已不可用。");
  const records:StoredCaptureRecord[]=[];
  for(const sourceId of sourceIds){
    const record=found.get(sourceId);if(!record)continue;
    const {imageCount,media,seq,order,...original}=record;
    const images=[];
    let unavailable=false;
    for(const ref of media||[]){if(signal.aborted)throw new DOMException("Cancelled","AbortError");try{images.push(await loadCloudCaptureImage(ownerId,libraryId,ref));}catch{unavailable=true;}}
    records.push({...original,namespace:captureNamespaceKey({ownerId,account:info.account,friend:info.friend,kind:info.kind}),...(images.length?{images}:{}),source:{...record.source,imageCount,...(imageCount?{cloudMediaUnavailable:unavailable||images.length<imageCount}:{})}});
  }
  return{libraryId,sourceIds,records,account:info.account,friend:info.friend,kind:info.kind};
}
