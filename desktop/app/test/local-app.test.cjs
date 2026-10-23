const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fileURLToPath}=require('node:url');
const {createLocalApp,safePath}=require('../local-app.cjs');
const {ORIGIN}=require('../policy.cjs');

function fixture(t,remote=async()=>{throw Error('unexpected network request');}){
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'chengzi-local-app-'));
  const root=path.join(parent,'frontend');fs.mkdirSync(root);
  fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><h1>成子本地</h1>');
  fs.mkdirSync(path.join(root,'assets'));fs.writeFileSync(path.join(root,'assets','app.js'),'console.log("local")');
  const fileRequests=[];
  const handler=createLocalApp({root,routes:['/','/capture','/history'],fetchRemote:remote,fetchFile:async url=>{
    fileRequests.push(url);return new Response(fs.readFileSync(fileURLToPath(url)));
  }});
  t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
  return {handler,root,parent,fileRequests};
}
function request(route,options={},destination=''){
  const value=new Request(route.startsWith('https:')?route:ORIGIN+route,options);
  Object.defineProperty(value,'destination',{value:destination});
  return value;
}

test('known SPA routes and assets always read installed bytes; HEAD reads no body',async t=>{
  const {handler,fileRequests}=fixture(t);
  for(const route of ['/','/capture?method=desktop','/history/']){
    const response=await handler(request(route));assert.equal(response.status,200);
    assert.match(await response.text(),/成子本地/);assert.equal(response.headers.get('x-chengzi-ui-source'),'installed');
    assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  }
  const js=await handler(request('/assets/app.js'));assert.match(await js.text(),/console/);
  const count=fileRequests.length;
  const head=await handler(request('/capture',{method:'HEAD'}));assert.equal(await head.text(),'');
  assert.equal(fileRequests.length,count);
});

test('unknown routes/assets and unsupported local mutations never fall back to network',async t=>{
  const {handler}=fixture(t);
  for(const route of ['/missing-page','/assets/missing.js','/config.env'])assert.equal((await handler(request(route))).status,404);
  assert.equal((await handler(request('/capture',{method:'POST',body:'data'}))).status,405);
});

test('reject unsafe encoded Windows paths and malformed encodings',async t=>{
  const {handler}=fixture(t);
  for(const route of ['/%00.js','/%5cWindows%5csecret.js','/C%3a/secret.js','/%2ehidden.js','/%E0%A4%A']){
    assert.equal(safePath(ORIGIN+route),null);assert.equal((await handler(request(route))).status,400);
  }
});

test('directory junctions cannot expose files outside the bundled frontend',async t=>{
  const {handler,root,parent}=fixture(t);
  const outside=path.join(parent,'private');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'secret.js'),'PRIVATE');
  fs.symlinkSync(outside,path.join(root,'escaped'),process.platform==='win32'?'junction':'dir');
  assert.equal((await handler(request('/escaped/secret.js'))).status,404);
});

test('API forwarding preserves request body, multipart boundary, identity and response stream',async t=>{
  const boundary='synthetic-boundary';const body='--'+boundary+'\r\nContent-Disposition: form-data; name="audio"; filename="语音.wav"\r\n\r\n\u0000\u0001\r\n--'+boundary+'--\r\n';
  let upstreamController,forwarded;
  const upstream=new Response(new ReadableStream({start(c){upstreamController=c;c.enqueue(new TextEncoder().encode('first'));}}),{
    status:202,headers:{'content-type':'application/json','x-request-id':'same-id','retry-after':'1','set-cookie':'cz_session=synthetic; HttpOnly; Secure; SameSite=Lax'}});
  const {handler}=fixture(t,async(req,options)=>{forwarded={req,options};return upstream;});
  const req=request('/api/import/transcribe',{method:'POST',headers:{'content-type':'multipart/form-data; boundary='+boundary,'origin':ORIGIN,'x-request-id':'same-id'},body});
  const response=await handler(req);
  assert.equal(forwarded.req,req);assert.equal(await forwarded.req.text(),body);
  assert.equal(forwarded.options.bypassCustomProtocolHandlers,true);assert.equal(forwarded.options.credentials,'include');
  assert.equal(forwarded.options.headers.get('origin'),ORIGIN);
  assert.equal(forwarded.options.redirect,'manual');assert.equal(response,upstream);
  assert.equal(response.headers.get('x-request-id'),'same-id');assert.match(response.headers.get('set-cookie'),/HttpOnly/);
  const reader=response.body.getReader();assert.equal(new TextDecoder().decode((await reader.read()).value),'first');
  upstreamController.enqueue(new TextEncoder().encode('second'));upstreamController.close();
  assert.equal(new TextDecoder().decode((await reader.read()).value),'second');assert.equal((await reader.read()).done,true);
});

test('API body cancellation remains connected to original request',async t=>{
  const controller=new AbortController();let received;
  const {handler}=fixture(t,async req=>{received=req;return new Response('{}');});
  const req=request('/api/web/report',{signal:controller.signal});await handler(req);
  controller.abort();assert.equal(received.signal.aborted,true);
});

test('API document, iframe, executable and worker destinations are never fetched',async t=>{
  const {handler}=fixture(t);
  for(const destination of ['document','iframe','frame','script','worker','sharedworker','serviceworker','object','embed','style']){
    assert.equal((await handler(request('/api/web/report',{},destination))).status,403);
  }
});

test('API fetch and binary media remain allowed, including native sec-fetch-site none',async t=>{
  const {handler}=fixture(t,async(_req,options)=>{assert.equal(options.headers.get('origin'),ORIGIN);return new Response('{}',{headers:{'content-type':'application/json'}});});
  for(const destination of ['','image','audio','video']){
    assert.equal((await handler(request('/api/web/report',{headers:{origin:ORIGIN,'sec-fetch-site':'none'}},destination))).status,200);
  }
  assert.equal((await handler(request('/api/auth/login',{method:'POST',body:'{}'}))).status,200);
});

test('API rejects foreign or opaque initiators and cross-site origins',async t=>{
  const {handler}=fixture(t);
  for(const origin of ['https://untrusted.invalid','null']){
    const req=request('/api/web/report');Object.defineProperty(req,'initiatorOrigin',{value:origin});
    assert.equal((await handler(req)).status,403);
  }
  for(const headers of [{origin:'https://untrusted.invalid'},{'sec-fetch-site':'cross-site'}])assert.equal((await handler(request('/api/web/report',{headers}))).status,403);
});

test('API rejects noncanonical paths before forwarding',async t=>{
  const {handler}=fixture(t);
  for(const route of ['/api/%77eb/report','/api//web/report','/api/web/report/','/api/web%2freport'])assert.equal((await handler(request(route))).status,400);
});

test('redirects and HTML errors are rejected and cancel upstream bodies',async t=>{
  let response,cancelled=0;
  const {handler}=fixture(t,async()=>response);
  for(const [status,type] of [[302,'text/plain'],[307,'application/json'],[200,'Text/HTML; charset=utf-8'],[500,'application/xhtml+xml']]){
    response=new Response(new ReadableStream({cancel(){cancelled++;}}),{status,headers:{'content-type':type,location:'https://untrusted.invalid'}});
    assert.equal((await handler(request('/api/web/report'))).status,502);
  }
  assert.equal(cancelled,4);
  response=new Response(null,{status:304});assert.equal((await handler(request('/api/web/report'))).status,304);
});

test('network failures produce a sanitized response without request data',async t=>{
  const {handler}=fixture(t,async()=>{throw Error('PRIVATE_CREDENTIAL');});
  const response=await handler(request('/api/auth/login',{method:'POST',body:'PRIVATE_PASSWORD'}));
  assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/PRIVATE/);
});

test('external hosts accept only inert HTTPS resources without credentials',async t=>{
  let options,calls=0;
  const {handler}=fixture(t,async(_req,value)=>{calls++;options=value;return new Response('image');});
  for(const destination of ['','document','script','worker'])assert.equal((await handler(request('https://assets.invalid/x',{},destination))).status,403);
  assert.equal((await handler(request('https://assets.invalid/avatar.png',{},'image'))).status,200);
  assert.equal(calls,1);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
  assert.equal((await handler({url:'https://user@assets.invalid/x',method:'GET',destination:'image'})).status,403);
});
