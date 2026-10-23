'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {ORIGIN,trusted,external}=require('./policy.cjs');

// The virtual HTTPS origin preserves the account cookie and collector's origin
// binding. HTML, scripts, styles and navigation always come from the install.
const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob: https:; connect-src 'self' https: wss://coach.lovetalk.love http://127.0.0.1:17863 http://localhost:17863; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.mp4':'video/mp4','.webm':'video/webm','.pdf':'application/pdf'};
function safePath(url){
  let pathname;try{pathname=decodeURIComponent(new URL(url).pathname);}catch{return null;}
  if(pathname.includes('\\')||pathname.includes('\0')||pathname.includes(':')||pathname.split('/').some(part=>part==='..'||part.startsWith('.')))return null;
  return pathname;
}
const DATA_DESTINATIONS=new Set(['','image','audio','video']);
const EXTERNAL_DESTINATIONS=new Set(['image','audio','video','font']);
const AVATAR_PATH='/_desktop/contact-avatar';
const AVATAR_LIMIT=512*1024;
function avatarUrl(value){
  try{
    const url=new URL(value);
    if(value.length>2000||url.protocol!=='https:'||url.username||url.password||url.port||!/(^|\.)(qlogo|qpic)\.cn$/.test(url.hostname))return null;
    url.hash='';return url.href;
  }catch{return null;}
}
function rasterType(bytes){
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=6&&/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii')))return 'image/gif';
  if(bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp';
  return null;
}
async function fetchAvatar(request,fetchRemote){
  const params=new URL(request.url).searchParams;
  const url=avatarUrl(params.get('url')||'');
  if(!url||params.getAll('url').length!==1||[...params.keys()].some(key=>key!=='url')||!['GET','HEAD'].includes(request.method)||!['','image'].includes(request.destination||''))return denied();
  const controller=new AbortController();
  const abort=()=>controller.abort();request.signal?.addEventListener('abort',abort,{once:true});
  if(request.signal?.aborted)controller.abort();
  const timeout=setTimeout(abort,8000);timeout.unref?.();
  try{
    // protocol.handle drops destination and Sec-Fetch-* even for <img>. Use an
    // explicit, bounded raster-only route instead of allowing generic fetches.
    // Construct a fresh request so account cookies, auth and referrers cannot leak.
    const headers=new Headers({accept:'image/png,image/jpeg,image/webp,image/gif'});
    const remote=new Request(url,{method:'GET',headers,signal:controller.signal,referrer:'',referrerPolicy:'no-referrer'});
    const response=await fetchRemote(remote,{bypassCustomProtocolHandlers:true,redirect:'error',credentials:'omit',headers});
    if(response.status!==200||!response.body||Number(response.headers.get('content-length')||0)>AVATAR_LIMIT){void response.body?.cancel().catch(()=>{});return new Response('',{status:502});}
    const reader=response.body.getReader(),chunks=[];let length=0;
    try{
      while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>AVATAR_LIMIT){await reader.cancel();return new Response('',{status:502});}chunks.push(Buffer.from(value));}
    }finally{reader.releaseLock();}
    const bytes=Buffer.concat(chunks,length),type=rasterType(bytes);
    if(!type)return new Response('',{status:502});
    return new Response(request.method==='HEAD'?null:bytes,{headers:{'content-type':type,'content-length':String(length),'cache-control':'private, max-age=3600','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin','content-security-policy':"default-src 'none'; sandbox"}});
  }catch{return new Response('',{status:502});}
  finally{clearTimeout(timeout);request.signal?.removeEventListener('abort',abort);}
}
function denied(){return new Response('Request not allowed',{status:403,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});}
function within(root,file){const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
function apiPathIsCanonical(url,pathname){return new URL(url).pathname===pathname&&!pathname.includes('//')&&!pathname.endsWith('/');}
function createLocalApp({root,routes,fetchRemote,fetchFile}){
  root=fs.realpathSync(root);
  const knownRoutes=new Set(routes.map(route=>route==='/'?'/':route.replace(/\/$/,'')));
  if(!fs.existsSync(path.join(root,'index.html')))throw new Error('DESKTOP_FRONTEND_MISSING');
  return async request=>{
    const destination=request.destination||'';
    if(request.initiatorOrigin!==undefined&&request.initiatorOrigin!==ORIGIN)return denied();
    if(!trusted(request.url)){
      // Only inert HTTPS resources may leave the installed application's origin.
      // Never turn this handler into a generic remote HTML/script/API loader.
      if(!external(request.url)||!EXTERNAL_DESTINATIONS.has(destination)||!['GET','HEAD'].includes(request.method))return denied();
      try{return await fetchRemote(request,{bypassCustomProtocolHandlers:true,redirect:'error',credentials:'omit'});}
      catch{return new Response('',{status:502});}
    }
    const pathname=safePath(request.url);
    if(!pathname)return new Response('Invalid path',{status:400});
    if(pathname===AVATAR_PATH){
      if(new URL(request.url).pathname!==AVATAR_PATH)return denied();
      return fetchAvatar(request,fetchRemote);
    }
    if(pathname.startsWith('/api/')){
      if(!DATA_DESTINATIONS.has(destination))return denied();
      if(!apiPathIsCanonical(request.url,pathname))return new Response('Invalid API path',{status:400});
      if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.has('origin')&&request.headers.get('origin')!==ORIGIN)return denied();
      try{
        // Preserve upload streams, cookies, cancellation and idempotency headers.
        // Electron's protocol Request omits the browser-generated Origin even
        // for a same-origin POST. Restore only our fixed origin after the checks
        // above; the server's CSRF validation must remain enabled.
        const headers=new Headers(request.headers);headers.set('origin',ORIGIN);
        const response=await fetchRemote(request,{bypassCustomProtocolHandlers:true,redirect:'manual',credentials:'include',headers});
        if(response.status>=300&&response.status<400&&response.status!==304){void response.body?.cancel().catch(()=>{});return Response.json({error:'服务返回了无效跳转，请重试。'},{status:502});}
        if(/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test((response.headers.get('content-type')||'').trim())){void response.body?.cancel().catch(()=>{});return Response.json({error:'服务暂时不可用，请稍后重试。'},{status:502});}
        return response;
      }catch{return Response.json({error:'网络未连接，请联网后重试。'},{status:503});}
    }
    if(!['GET','HEAD'].includes(request.method))return new Response('',{status:405});
    const route=pathname==='/'?'/':pathname.replace(/\/$/,'');
    const relative=knownRoutes.has(route)?'index.html':pathname.slice(1);
    const file=path.resolve(root,relative);
    let resolved;
    try{resolved=fs.realpathSync(file);if(!within(root,file)||!within(root,resolved)||!TYPES[path.extname(file)]||!fs.statSync(resolved).isFile())resolved=null;}catch{resolved=null;}
    if(!resolved)return new Response('此页面未包含在当前安装版本中。',{status:404,headers:{'content-type':'text/plain; charset=utf-8'}});
    let content=null;
    try{if(request.method!=='HEAD')content=(await fetchFile(pathToFileURL(resolved).href)).body;}
    catch{return new Response('本地文件暂时不可读取。',{status:503});}
    return new Response(content,{headers:{'content-type':TYPES[path.extname(file)],'content-security-policy':CSP,'x-content-type-options':'nosniff','cache-control':'no-store','x-chengzi-ui-source':'installed'}});
  };
}
module.exports={createLocalApp,safePath,CSP};
