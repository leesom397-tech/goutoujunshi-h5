// Share immutable image SHA-256 work between upload, download verification and
// local report-version checks. Never retain more than 128 MiB of base64 keys.
const MAX_BYTES=128*1024*1024,MAX_ENTRIES=512;
type Entry={promise:Promise<string>;bytes:number;settled:boolean};
const cache=new Map<string,Entry>();
let bytes=0,active=0;
const waiters:Array<()=>void>=[];
function trim(){for(const [key,entry] of cache){if(bytes<=MAX_BYTES&&cache.size<=MAX_ENTRIES)break;if(entry.settled){cache.delete(key);bytes-=entry.bytes;}}}
async function checksum(data:string):Promise<string>{
  if(active>=2)await new Promise<void>(resolve=>waiters.push(resolve));
  else active++;
  try{
    // Give input and rendering a turn before decoding each image. A large
    // library is processed in bounded image-sized steps, never a render loop.
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    const decoded=atob(data),input=new Uint8Array(decoded.length);
    for(let index=0;index<decoded.length;index++)input[index]=decoded.charCodeAt(index);
    const hash=await crypto.subtle.digest('SHA-256',input);
    return Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
  }finally{const next=waiters.shift();if(next)next();else active--;}
}
export function captureImageDigest(data:string):Promise<string>{
  const known=cache.get(data);
  if(known){cache.delete(data);cache.set(data,known);return known.promise;}
  const entry:Entry={promise:Promise.resolve(''),bytes:data.length,settled:false};
  entry.promise=checksum(data).then(hash=>{entry.settled=true;trim();return hash;},error=>{if(cache.get(data)===entry){cache.delete(data);bytes-=entry.bytes;}throw error;});
  cache.set(data,entry);bytes+=entry.bytes;trim();return entry.promise;
}
