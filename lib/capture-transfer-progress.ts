import {remainingTimeRange} from "./waiting-time";
/** Measured successful transfer only; the estimate applies only to this upload batch. */
export function captureTransferText(bytes:number,totalBytes:number,elapsedMs:number){
  if(![bytes,totalBytes,elapsedMs].every(Number.isFinite)||bytes<=0||totalBytes<=0||elapsedMs<0)return"";
  bytes=Math.min(bytes,totalBytes);
  const size=(value:number)=>value>=1024*1024?`${(value/(1024*1024)).toFixed(1)} MB`:`${Math.ceil(value/1024)} KB`;
  const rate=elapsedMs>=1000?` · ${size(bytes/(elapsedMs/1000))}/秒`:"";
  const remaining=bytes/totalBytes>=.05?remainingTimeRange(bytes,totalBytes-bytes,elapsedMs):null;
  return `本轮新增图片已传 ${size(bytes)} / ${size(totalBytes)}${rate}${remaining?` · 按当前速度，本轮约还需 ${remaining}`:""}`;
}
