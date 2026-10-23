import { imageFingerprint } from "./intake-preferences";
export type IntakeHistoryScope = {owner:string;subjectId:string;mode:string;targetSelf?:boolean;selfSide?:string};
export type AnalyzedImage = {owner:string;scope:string;hash:string;reportId:string;analyzedAt:number;expiresAt:number};
export type IntakeImageCheck = {fresh:File[];repeated:{file:File;index:number;reportId:string}[];unavailable:boolean};
export const INTAKE_HISTORY_TTL = 30*24*60*60*1000, INTAKE_HISTORY_SCOPE_LIMIT=500, INTAKE_HISTORY_OWNER_LIMIT=2000;
const uuid=/^[a-f0-9]{8}-[a-f0-9-]{27}$/i;
export const intakeHistoryKey = (scope:IntakeHistoryScope) => JSON.stringify([scope.owner,scope.mode,scope.targetSelf?'self':'other',scope.targetSelf?'':scope.subjectId,scope.mode==='chat'?scope.selfSide||'':'']);
function validScope(scope:IntakeHistoryScope){return !!scope.owner&&['chat','moments','social'].includes(scope.mode)&&(scope.targetSelf===true||!!scope.subjectId)&&(scope.mode!=='chat'||['left','right'].includes(scope.selfSide||''));}
const recordKey=(row:Pick<AnalyzedImage,'scope'|'hash'>)=>JSON.stringify([row.scope,row.hash]);
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('chengzi-analyzed-images',1);request.onupgradeneeded=()=>{const store=request.result.createObjectStore('images');store.createIndex('owner','owner');store.createIndex('scope','scope');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
let writes:Promise<unknown>=Promise.resolve();
const ownerVersions=new Map<string,number>();
async function withOwner<T>(owner:string,operation:(store:IDBObjectStore,rows:AnalyzedImage[])=>T):Promise<T>{
 const run=async()=>{const db=await database();return new Promise<T>((resolve,reject)=>{const tx=db.transaction('images','readwrite'),store=tx.objectStore('images'),rows:AnalyzedImage[]=[];let value:T;const cursor=store.index('owner').openCursor(IDBKeyRange.only(owner));cursor.onsuccess=()=>{const item=cursor.result;if(item){const row=item.value as AnalyzedImage;if(row.owner===owner){if(!Number.isFinite(row.expiresAt)||row.expiresAt<=Date.now())item.delete();else rows.push(row);}item.continue();}else{try{value=operation(store,rows);}catch(error){tx.abort();reject(error);}}};tx.oncomplete=()=>{db.close();resolve(value);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||new Error('Local history unavailable'));};});};const result=writes.then(run,run);writes=result.catch(()=>{});return result;
}
async function readScope(scope:IntakeHistoryScope):Promise<AnalyzedImage[]>{const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('images','readonly'),request=tx.objectStore('images').index('scope').getAll(IDBKeyRange.only(intakeHistoryKey(scope)));let rows:AnalyzedImage[]=[];request.onsuccess=()=>{rows=request.result||[];};tx.oncomplete=()=>{db.close();resolve(rows.filter(row=>row.owner===scope.owner&&row.scope===intakeHistoryKey(scope)&&/^[a-f0-9]{64}$/.test(row.hash)&&uuid.test(row.reportId)&&Number.isFinite(row.analyzedAt)&&row.analyzedAt<=Date.now()&&row.expiresAt>Date.now()&&row.expiresAt<=row.analyzedAt+INTAKE_HISTORY_TTL));};tx.onerror=()=>{db.close();reject(tx.error);};});}
/** Saves hashes and IDs only after a complete successful task. Failed/partial jobs never suppress uploads. */
export async function recordSuccessfulImages(scope:IntakeHistoryScope,files:File[],receipt:{status:string;reportId:string;partial?:boolean;incomplete?:boolean}):Promise<boolean>{
 if(!validScope(scope)||receipt.status!=='done'||receipt.partial!==false||receipt.incomplete===true||!uuid.test(receipt.reportId)||!files.length||files.length>9)return false;
 const version=ownerVersions.get(scope.owner)||0;
 try{const hashes=await Promise.all(files.map(imageFingerprint)),now=Date.now(),key=intakeHistoryKey(scope);return await withOwner(scope.owner,(store,rows)=>{if((ownerVersions.get(scope.owner)||0)!==version)return false;const added=[...new Set(hashes)].map(hash=>({owner:scope.owner,scope:key,hash,reportId:receipt.reportId,analyzedAt:now,expiresAt:now+INTAKE_HISTORY_TTL}));const keys=new Set(added.map(recordKey));const all=[...added,...rows.filter(row=>!keys.has(recordKey(row))).sort((a,b)=>b.analyzedAt-a.analyzedAt)];const counts=new Map<string,number>();let count=0;for(const row of all){const scoped=counts.get(row.scope)||0;if(count>=INTAKE_HISTORY_OWNER_LIMIT||scoped>=INTAKE_HISTORY_SCOPE_LIMIT){store.delete(recordKey(row));continue;}count++;counts.set(row.scope,scoped+1);if(keys.has(recordKey(row)))store.put(row,recordKey(row));}return true;});}catch{return false;}
}
/** A historical hash alone is never enough: the original report must still be readable in this scope. */
export async function checkAnalyzedImages(scope:IntakeHistoryScope,files:File[],options:{validateReport:(reportId:string)=>Promise<boolean>}):Promise<IntakeImageCheck>{
 const fallback={fresh:files,repeated:[],unavailable:false};if(!validScope(scope)||!files.length)return fallback;
 try{const [rows,hashes]=await Promise.all([readScope(scope),Promise.all(files.map(imageFingerprint))]);const byHash=new Map(rows.map(row=>[row.hash,row]));const matches=hashes.map(hash=>byHash.get(hash));const ids=[...new Set(matches.filter((row):row is AnalyzedImage=>!!row).map(row=>row.reportId))];let unavailable=false;const verified=new Set<string>();await Promise.all(ids.map(async id=>{try{if(await options.validateReport(id))verified.add(id);else unavailable=true;}catch{unavailable=true;}}));const repeated=files.flatMap((file,index)=>{const row=matches[index];return row&&verified.has(row.reportId)?[{file,index,reportId:row.reportId}]:[];});const skipped=new Set(repeated.map(row=>row.index));return{fresh:files.filter((_file,index)=>!skipped.has(index)),repeated,unavailable};}catch{return{...fallback,unavailable:true};}
}
export async function clearAnalyzedImagesOwner(owner:string){if(!owner)return;ownerVersions.set(owner,(ownerVersions.get(owner)||0)+1);await withOwner(owner,(store,rows)=>{for(const row of rows)store.delete(recordKey(row));}).catch(()=>{});}
/** Validate an authenticated report response; no report contents are persisted in the hash index. */
export function analyzedReportMatches(scope:IntakeHistoryScope,reportId:string,value:any):boolean{
 if(!value||!value.report||value.reportId!==reportId||value.kind!==scope.mode||value.partial===true||value.report.partial===true||value.report.incomplete===true)return false;
 const report=value.report;if(Number.isFinite(value.expiresAt)&&value.expiresAt<=Date.now()||Number.isFinite(report.expiresAt)&&report.expiresAt<=Date.now())return false;
 if(scope.targetSelf)return(value.targetSelf===true||report.targetSelf===true)&&(!value.subjectId&&!report.subjectId);
 if(value.targetSelf===true||report.targetSelf===true)return false;
 if((value.subjectId||report.subjectId)!==scope.subjectId||value.subjectId&&value.subjectId!==scope.subjectId||report.subjectId&&report.subjectId!==scope.subjectId)return false;
 const side=value.selfSide||report.selfSide;return scope.mode!=='chat'||!side||side===scope.selfSide;
}
