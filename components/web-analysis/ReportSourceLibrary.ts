import { loadCloudCaptureImage } from "@/lib/capture-cloud-client";
import { captureNamespaceKey, type StoredCaptureRecord } from "@/lib/desktop-capture";
import type { CaptureReportSources } from "@/lib/desktop-capture-vault";
import type { CloudCaptureLibrary, CloudCaptureRecord } from "@/lib/capture-cloud";

/** Resolve a cited record only inside its named library, including its verified image previews. */
export async function readReportLibrarySources(ownerId:string, libraryId:string, sourceIds:string[], signal:AbortSignal, previewOnly=false):Promise<CaptureReportSources>{
  if(!libraryId||!sourceIds.length||sourceIds.length>1000||sourceIds.some(id=>typeof id!=="string"||!id.trim()||id.length>1200||id.includes("\0")))throw Error("这条依据缺少有效的材料来源，无法定位原记录。");
  const needed=new Set(sourceIds),ids=[...needed],found=new Map<string,CloudCaptureRecord>(),seen=new Set<string>();
  type SourcePage={ownerId:string;library:CloudCaptureLibrary;records:CloudCaptureRecord[];nextCursor?:string|null;error?:string;sourceSelection?:{version:number;sourceIds:string[]}};
  let info:CloudCaptureLibrary|null=null;
  const base=`/api/web/capture/library?id=${encodeURIComponent(libraryId)}&limit=500`;
  async function page(query:string,exact=false):Promise<SourcePage>{
    const response=await fetch(base+query,{credentials:"same-origin",cache:"no-store",signal});
    // Some older deployments reject unknown query parameters instead of
    // ignoring them. Retry the ordinary page only for that bounded failure.
    if(exact&&[400,414].includes(response.status))return page("");
    const data=await response.json() as SourcePage;
    if(!response.ok)throw Error(data.error||"原始材料暂时无法读取，请稍后重试。");
    if(data.ownerId!==ownerId||data.library?.id!==libraryId||!Array.isArray(data.records))throw Error("材料来源已变化，请回到当前账号重新打开报告。");
    if(info&&(info.epoch!==data.library.epoch||info.revision!==data.library.revision||info.kind!==data.library.kind||info.account!==data.library.account||info.friend!==data.library.friend))throw Error("材料已更新，请重新打开依据。");
    info=data.library;
    return data;
  }
  function remember(data:SourcePage){
    for(const record of data.records)if(needed.has(record.localId))found.set(record.localId,record);
  }
  // Keep both the record count and URL size small; unusual long Unicode IDs
  // become their own request, without truncating the actual source identity.
  const batches:string[][]=[];
  for(const id of ids){const last=batches.at(-1);if(!last||last.length===12||encodeURIComponent(JSON.stringify([...last,id])).length>6000)batches.push([id]);else last.push(id);}
  for(const batch of batches){
    let data=await page("&sourceIds="+encodeURIComponent(JSON.stringify(batch)),true);
    if(Object.hasOwn(data,"sourceSelection")){
      const selection=data.sourceSelection;
      if(selection?.version!==1||!Array.isArray(selection.sourceIds)||JSON.stringify(selection.sourceIds)!==JSON.stringify(batch)||data.nextCursor||data.records.length>batch.length||new Set(data.records.map(record=>record.localId)).size!==data.records.length||data.records.some(record=>!batch.includes(record.localId)))throw Error("原文定位结果不一致，请重新打开依据。");
      remember(data);continue;
    }
    // No acknowledgement means a legacy cursor page, even when it contains
    // zero requested records. Walk the supplied cursors until all are found
    // or the original library really ends; never treat the first 500 as all.
    while(true){
      remember(data);if(found.size===needed.size)break;
      const next=String(data.nextCursor||"");if(!next)break;
      if(!data.records.length||seen.has(next))throw Error("材料读取未继续，请稍后重试。");
      seen.add(next);data=await page("&cursor="+encodeURIComponent(next));
    }
    break;
  }
  if(!info)throw Error("这份材料已不可用。");
  const library:CloudCaptureLibrary=info;
  const records:StoredCaptureRecord[]=[];
  for(const sourceId of ids){
    const record=found.get(sourceId);if(!record)continue;
    const {imageCount,media,seq,order,...original}=record;
    const images=[];
    let unavailable=false;
    const selected=previewOnly?(media||[]).slice(0,1):media||[];
    for(const ref of selected){if(signal.aborted)throw new DOMException("Cancelled","AbortError");try{images.push(await loadCloudCaptureImage(ownerId,libraryId,ref,signal));}catch(error){if(signal.aborted)throw error;unavailable=true;}}
    if(signal.aborted)throw new DOMException("Cancelled","AbortError");
    records.push({...original,namespace:captureNamespaceKey({ownerId,account:library.account,friend:library.friend,kind:library.kind}),...(images.length?{images}:{}),source:{...record.source,imageCount,...(imageCount?{cloudMediaUnavailable:unavailable||images.length<(previewOnly?Math.min(imageCount,1):imageCount)}:{})}});
  }
  return{libraryId,sourceIds:ids,records,account:library.account,friend:library.friend,kind:library.kind};
}
