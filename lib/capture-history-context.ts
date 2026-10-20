import type { CaptureMemoryContext, CaptureMemoryRow } from "./capture-analysis-input";

type ContextRecord = {localId:string;at:string;text:string;kind:string;senderRole:string;imageCount?:number;source?:Record<string,unknown>};

/** Preserve nearby turns for referents and topic boundaries. Visual summaries
 * remain tagged model observations; missing media never becomes a guessed image. */
export function attachCaptureContext(rows: readonly CaptureMemoryRow[], records: readonly ContextRecord[], visuals: readonly CaptureMemoryRow[], libraryId: string) {
  const positions = new Map(records.map((row,index)=>[row.localId,index]));
  const images = new Map<string,CaptureMemoryRow[]>();
  for(const row of visuals) if(row.sourceKind==="chat"&&row.libraryId===libraryId&&row.basis==="visual") {
    const key=row.sourceLocalId||row.localId;
    images.set(key,[...(images.get(key)||[]),row]);
  }
  return rows.map(row=>{
    if(row.sourceKind==="moments")return row;
    const index=positions.get(row.sourceLocalId||row.localId);
    if(index===undefined)return {...row,sourceKind:"chat" as const,libraryId};
    const anchorTime=Date.parse(row.at),context:CaptureMemoryContext[]=[];
    for(let i=Math.max(0,index-3);i<=Math.min(records.length-1,index+3);i++){
      const source=records[i],time=Date.parse(source.at);
      if(Number.isFinite(time)&&Number.isFinite(anchorTime)&&Math.abs(time-anchorTime)>6*3600_000)continue;
      if(i!==index&&source.text.trim()&&source.kind!=="image"&&!/^\s*[\[【](?:图片|语音|视频|表情)[\]】]\s*$/.test(source.text))
        context.push({sourceId:source.localId,at:source.at,role:source.senderRole,text:source.text.slice(0,420)});
      const readImages=images.get(source.localId)||[];
      for(const image of readImages.slice(0,2)) if(image.mediaId!==row.mediaId)
        context.push({sourceId:source.localId,at:source.at,role:source.senderRole,text:image.text.slice(0,420),basis:"visual",mediaId:image.mediaId});
      if((source.kind==="image"||Number(source.imageCount)>0)&&!readImages.length)
        context.push({sourceId:source.localId,at:source.at,role:source.senderRole,text:"这条消息含图片，但本次没有可读图像内容；不能据此确定人物、宠物或物品。",basis:"unavailable-media"});
    }
    return {...row,sourceKind:"chat" as const,libraryId,sequence:index,context:context.slice(0,12)};
  });
}

/** Keep each preview next to its own original conversation, instead of sending
 * all photos after thousands of unrelated text messages. No original is lost. */
export function orderedCaptureMemory(rows:readonly CaptureMemoryRow[],supplements:readonly CaptureMemoryRow[]){
  const groups=new Map<string,Array<CaptureMemoryRow&{inputOrder:number}>>();
  [...rows,...supplements].forEach((row,inputOrder)=>{
    const key=JSON.stringify([row.sourceKind||"chat",row.libraryId||""]);
    const group=groups.get(key)||[];group.push({...row,inputOrder});groups.set(key,group);
  });
  return [...groups.values()].flatMap(group=>group.sort((a,b)=>
    a.sequence!==undefined&&b.sequence!==undefined?a.sequence-b.sequence||a.inputOrder-b.inputOrder:a.inputOrder-b.inputOrder
  ).map(({inputOrder,...row})=>row));
}

/** Context already present in the segment is not repeated for every message.
 * Carry only boundary turns, unread-media notices and adjacent source gaps. */
export function segmentCaptureContext(rows:readonly CaptureMemoryRow[]){
  const originals=new Set(rows.filter(row=>!row.basis).map(row=>row.localId));
  const media=new Set(rows.map(row=>row.mediaId).filter(Boolean));
  const contexts=new Map<string,CaptureMemoryContext>();
  for(const row of rows)for(const context of row.context||[]){
    if(context.basis==="visual"?media.has(context.mediaId):!context.basis&&originals.has(context.sourceId))continue;
    const key=JSON.stringify([context.sourceId,context.mediaId,context.basis]);
    if(!contexts.has(key))contexts.set(key,{...context,text:context.text.slice(0,240)});
  }
  return [...contexts.values()];
}
