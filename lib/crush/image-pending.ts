export type PendingImage={mediaId:string;msgid:string;consentAt:number;stamp:string;subjectId:string|null;expiresAt:number};
export function pendingImages(raw:string|undefined,fallbackExpiry=0,now=Date.now()):PendingImage[]{
  try{
    const data=JSON.parse(raw||"{}"),items=Array.isArray(data.entries)?data.entries:data.mediaId?[{...data,expiresAt:fallbackExpiry}]:[];
    return items.filter((v:PendingImage)=>v&&typeof v.mediaId==="string"&&typeof v.msgid==="string"&&typeof v.stamp==="string"&&Number.isFinite(v.consentAt)&&v.expiresAt>now).slice(0,8);
  }catch{return [];}
}
export function appendPendingImage(entries:PendingImage[],entry:PendingImage){
  if(entries.some(v=>v.msgid===entry.msgid))return entries;
  if(entries.length>=8)throw Error("IMAGE_PENDING_FULL");
  return [...entries,entry];
}
