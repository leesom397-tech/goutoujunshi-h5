import type { CaptureConnection } from "./capture-connection-discovery";

const DATABASE="chengzi-capture-connection:v1",STORE="sessions",REVOCATION="chengzi-capture:session-revocation";
const MAX_SESSION_MS=8*60*60_000;
export const captureConnectionRevision=()=>{try{return localStorage.getItem(REVOCATION)||"";}catch{return "";}};
const valid=(value:unknown,now=Date.now()):value is CaptureConnection=>!!value&&typeof value==="object"&&typeof (value as CaptureConnection).token==="string"&&/^[A-Za-z0-9_-]{20,128}$/.test((value as CaptureConnection).token)&&Number.isFinite((value as CaptureConnection).expiresAt)&&(value as CaptureConnection).expiresAt>now&&(value as CaptureConnection).expiresAt<=now+MAX_SESSION_MS;

async function sessionStore<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T|undefined>{
  if(typeof indexedDB==="undefined")return;
  return new Promise(resolve=>{
    let settled=false,db:IDBDatabase|undefined;
    const done=(value?:T)=>{if(settled)return;settled=true;clearTimeout(timer);db?.close();resolve(value);};
    const timer=setTimeout(()=>done(),2500),opening=indexedDB.open(DATABASE,1);
    opening.onupgradeneeded=()=>{if(!opening.result.objectStoreNames.contains(STORE))opening.result.createObjectStore(STORE);};
    opening.onerror=()=>done();opening.onblocked=()=>done();
    opening.onsuccess=()=>{
      db=opening.result;if(settled){db.close();return;}
      try{const transaction=db.transaction(STORE,mode),request=operation(transaction.objectStore(STORE));let result:T;
        request.onsuccess=()=>{result=request.result;};transaction.oncomplete=()=>done(result);transaction.onerror=()=>done();transaction.onabort=()=>done();
      }catch{done();}
    };
  });
}

/** Only already paired credentials; never obtains a new token from the helper.
 * Owner scoped, bounded by the original helper expiry, revalidated via /session. */
export async function readCaptureConnectionSession(owner:string,isCurrent:()=>boolean=()=>true):Promise<CaptureConnection|null>{
  if(!owner||!isCurrent())return null;
  const saved=await sessionStore<{owner:string;connection:CaptureConnection;revision?:string}>("readonly",store=>store.get(owner));
  if(!isCurrent())return null;
  if(saved?.owner===owner&&(saved.revision||"")===captureConnectionRevision()&&valid(saved.connection))return saved.connection;
  if(saved)await forgetCaptureConnectionSession(owner,isCurrent);
  return null;
}
export async function saveCaptureConnectionSession(owner:string,connection:CaptureConnection,isCurrent:()=>boolean=()=>true):Promise<void>{
  if(!owner||!valid(connection)||!isCurrent())return;
  const revision=captureConnectionRevision();
  await sessionStore("readwrite",store=>isCurrent()?store.put({owner,connection:{token:connection.token,expiresAt:connection.expiresAt},revision},owner):store.get(owner));
}
export async function forgetCaptureConnectionSession(owner:string,isCurrent:()=>boolean=()=>true):Promise<void>{
  if(owner&&isCurrent())await sessionStore("readwrite",store=>isCurrent()?store.delete(owner):store.get(owner));
}

/** Logout revokes cached browser credentials in every open tab. No helper data is read. */
export async function clearCaptureConnectionSessions():Promise<void>{
  // This tombstone rejects old grants even when IDB is blocked or an older
  // transaction completes after logout. It contains no credential or identity.
  localStorage.setItem(REVOCATION,crypto.randomUUID());
  try{window.dispatchEvent(new Event(REVOCATION));}catch{}
  try{for(const key of Object.keys(sessionStorage))if(key.startsWith("chengzi-capture:")&&key.endsWith(":connection"))sessionStorage.removeItem(key);}catch{}
  await sessionStore("readwrite",store=>store.clear());
}
export function watchCaptureConnectionRevocation(revoke:()=>void):()=>void{
  const storage=(event:StorageEvent)=>{if(event.key===REVOCATION)revoke();};
  window.addEventListener("storage",storage);window.addEventListener(REVOCATION,revoke);
  return()=>{window.removeEventListener("storage",storage);window.removeEventListener(REVOCATION,revoke);};
}
