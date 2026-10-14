/** Reading progress stores positions and opaque IDs, never conversation text. */
export type ReportPanelPosition={offset:number;anchor?:string;anchorTop?:number};
export type ReportReadingPosition={version:1;active:string;seen:string[];panels:Record<string,ReportPanelPosition>;line?:{key:string;listTop:number};updatedAt:number};
type StorageLike=Pick<Storage,"getItem"|"setItem">;
const prefix="chengzi-report-reading-v2:";
export function reportReadingScope(owner:unknown,reportId:unknown,subjectId:unknown,kind:"chat"|"social"|"moments",example=false):string|undefined{
 if(example||typeof owner!=="string"||!owner||typeof reportId!=="string"||!reportId)return;
 return JSON.stringify([owner,String(subjectId||""),reportId,kind]);
}
export function reportLineKey(line:Record<string,any>,index:number):string{
 const value=String(line.id||index)+"|"+String(line.speaker||"")+"|"+String(line.text||"");let hash=2166136261;
 for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}
 return "line-"+(hash>>>0).toString(36);
}
export function readReportPosition(storage:StorageLike|undefined,scope:string|undefined):ReportReadingPosition|null{
 if(!storage||!scope)return null;
 try{
  const raw=JSON.parse(storage.getItem(prefix+scope)||"null");if(raw?.version!==1||typeof raw.active!=="string")return null;
  const panels:Record<string,ReportPanelPosition>={};
  if(raw.panels&&typeof raw.panels==="object")for(const [id,p] of Object.entries(raw.panels).slice(0,8)){
   const row=p as Record<string,unknown>;if(!row||typeof row.offset!=="number"||!Number.isFinite(row.offset))continue;
   panels[id]={offset:Math.max(-10000,Math.min(100000,row.offset)),...(typeof row.anchor==="string"&&/^line-[a-z0-9]+$/.test(row.anchor)?{anchor:row.anchor}:{}),...(typeof row.anchorTop==="number"&&Number.isFinite(row.anchorTop)?{anchorTop:Math.max(-5000,Math.min(10000,row.anchorTop))}:{})};
  }
  return {version:1,active:raw.active,seen:Array.isArray(raw.seen)?raw.seen.filter((v:unknown)=>typeof v==="string").slice(0,8):[],panels,...(raw.line&&typeof raw.line.key==="string"&&/^line-[a-z0-9]+$/.test(raw.line.key)?{line:{key:raw.line.key,listTop:typeof raw.line.listTop==="number"&&Number.isFinite(raw.line.listTop)?Math.max(0,Math.min(100000,raw.line.listTop)):0}}:{}),updatedAt:typeof raw.updatedAt==="number"?raw.updatedAt:0};
 }catch{return null;}
}
export function saveReportPosition(storage:StorageLike|undefined,scope:string|undefined,patch:Partial<Omit<ReportReadingPosition,"version"|"updatedAt">>):void{
 if(!storage||!scope)return;
 try{
  const old=readReportPosition(storage,scope)||{version:1 as const,active:"",seen:[],panels:{},updatedAt:0};
  storage.setItem(prefix+scope,JSON.stringify({...old,...patch,version:1,panels:{...old.panels,...patch.panels},updatedAt:Date.now()}));
 }catch{/* Storage can be unavailable; reading still works without persistence. */}
}
