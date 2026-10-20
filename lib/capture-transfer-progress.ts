/** Measured successful transfer only; never invent a completion estimate. */
export function captureTransferText(bytes:number,totalBytes:number,elapsedMs:number){
  if(bytes<=0||totalBytes<=0)return"";
  const size=(value:number)=>value>=1024*1024?`${(value/(1024*1024)).toFixed(1)} MB`:`${Math.ceil(value/1024)} KB`;
  const rate=elapsedMs>=1000?` · ${size(bytes/(elapsedMs/1000))}/秒`:"";
  return `本轮新增图片已传 ${size(bytes)} / ${size(totalBytes)}${rate}`;
}
