/* Run with Electron, never node --test. All traffic is loopback and synthetic. */
'use strict';
const {app,BrowserWindow,session,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https');
const {execFileSync}=require('node:child_process');
const {X509Certificate}=require('node:crypto');
const zlib=require('node:zlib');
const assert=require('node:assert/strict');
const {createLocalApp}=require('../local-app.cjs');
const {ORIGIN}=require('../policy.cjs');
const HOST=new URL(ORIGIN).hostname,PORT=443;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chengzi-http-integration-'));
app.setPath('userData',path.join(dir,'session'));
app.on('window-all-closed',()=>{}); // Recreate a window while checking cookie persistence.
app.commandLine.appendSwitch('host-resolver-rules',`MAP ${HOST} 127.0.0.1`);
let win,server,ses,streamTail=false,abortClosed=false,receivedMultipart,receivedType,receivedOrigin,remoteCalls=0;
const checks={},diagnostics=[];
const timers=new Set(),sockets=new Set();
const later=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);return timer;};
const pause=ms=>new Promise(resolve=>later(resolve,ms));
const watchdog=setTimeout(()=>{process.stdout.write(JSON.stringify({ok:false,error:'INTEGRATION_TIMEOUT',checks})+'\n');app.exit(2);},60000);

function certificate(){
  const python=process.env.CHENGZI_TEST_PYTHON||path.resolve(__dirname,'../../wechat-collector/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const script=`import json,datetime\nfrom cryptography import x509\nfrom cryptography.x509.oid import NameOID\nfrom cryptography.hazmat.primitives import hashes,serialization\nfrom cryptography.hazmat.primitives.asymmetric import rsa\nk=rsa.generate_private_key(public_exponent=65537,key_size=2048)\nn=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'${HOST}')])\nt=datetime.datetime.now(datetime.timezone.utc)\nc=x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(t-datetime.timedelta(minutes=2)).not_valid_after(t+datetime.timedelta(hours=1)).add_extension(x509.SubjectAlternativeName([x509.DNSName('${HOST}')]),critical=False).sign(k,hashes.SHA256())\nprint(json.dumps({'key':k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode(),'cert':c.public_bytes(serialization.Encoding.PEM).decode()}))`;
  return JSON.parse(execFileSync(python,['-c',script],{encoding:'utf8',windowsHide:true,timeout:15000}));
}
function reply(res,body,headers={}){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',...headers});res.end(JSON.stringify(body));}
function handle(req,res){
  assert.ok(['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress));
  const cookies=req.headers.cookie||'';
  if(req.url==='/api/login')return reply(res,{ok:true},{'set-cookie':['cz_session=synthetic-native; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600','cz_verified_session=synthetic-verified; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600','lt_next_session=synthetic-legacy; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600']});
  if(req.url==='/api/session')return reply(res,{native:cookies.includes('cz_session=synthetic-native'),verified:cookies.includes('cz_verified_session=synthetic-verified'),legacy:cookies.includes('lt_next_session=synthetic-legacy')});
  if(req.url==='/api/logout')return reply(res,{ok:true},{'set-cookie':['cz_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0','cz_verified_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0','lt_next_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0']});
  if(req.url==='/api/gzip'){
    const bytes=zlib.gzipSync(Buffer.from(JSON.stringify({message:'成子：中文语音与朋友圈 ✓'})));
    res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-encoding':'gzip','content-length':bytes.length});return res.end(bytes);
  }
  if(req.url==='/api/upload'){
    const parts=[];receivedType=req.headers['content-type'];receivedOrigin=req.headers.origin;
    req.on('data',part=>parts.push(part));req.on('end',()=>{receivedMultipart=Buffer.concat(parts);reply(res,{ok:true});});return;
  }
  if(req.url==='/api/stream'){
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store'});res.write('data: 第一段\n\n');
    later(()=>{streamTail=true;res.end('data: 第二段\n\n');},1500);return;
  }
  if(req.url==='/api/abort'){
    res.writeHead(200,{'content-type':'text/event-stream'});res.write('ready\n');
    res.on('close',()=>{abortClosed=true;});return;
  }
  res.writeHead(404,{'content-type':'application/json'});res.end('{}');
}
async function makeWindow(){
  win=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
  win.webContents.on('console-message',(_event,details)=>{if(details.level==='error'||details.level===3)diagnostics.push(String(details.message).slice(0,180));});
  await win.loadURL(ORIGIN+'/');
}
const js=source=>win.webContents.executeJavaScript(source);

async function run(){
  const cert=certificate(),fingerprint=new X509Certificate(cert.cert).fingerprint256;
  server=https.createServer(cert,handle);server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,'127.0.0.1',resolve);});
  ses=session.fromPartition('persist:synthetic-http-only');await ses.setProxy({mode:'direct'});
  ses.setCertificateVerifyProc((request,callback)=>{
    let allowed=false;
    try{allowed=request.hostname===HOST&&new X509Certificate(request.certificate.data).fingerprint256===fingerprint;}catch{}
    callback(allowed?0:-2);
  });
  ses.webRequest.onBeforeRequest((details,callback)=>{
    const url=new URL(details.url);
    callback({cancel:!(url.origin===ORIGIN&&url.protocol==='https:')});
  });
  const root=path.join(dir,'frontend');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><meta charset="utf-8"><title>合成 HTTP 检查</title>');
  ses.protocol.handle('https',createLocalApp({root,routes:['/'],fetchFile:url=>net.fetch(url),fetchRemote:(request,options)=>{
    remoteCalls++;
    if(new URL(request.url).pathname==='/api/upload')diagnostics.push('Protocol request Origin: '+String(request.headers.get('origin')));
    const target=new URL(request.url);target.port=String(PORT);
    const mapped=new Request(target.href,{method:request.method,headers:request.headers,signal:request.signal,
      ...(request.body?{body:request.body,duplex:'half'}:{})});
    return ses.fetch(mapped,options);
  }}));
  await makeWindow();
  checks.localOrigin=await js(`location.origin===${JSON.stringify(ORIGIN)} && isSecureContext`);
  await js(`fetch('/api/login',{method:'POST'}).then(r=>r.json())`);
  const identity=await js(`fetch('/api/session').then(r=>r.json())`);
  checks.multiCookie=identity.native&&identity.verified&&identity.legacy;
  checks.httpOnly=await js(`!document.cookie.includes('synthetic')`);
  await ses.cookies.flushStore();win.destroy();await makeWindow();
  checks.cookieAcrossWindow=Object.values(await js(`fetch('/api/session').then(r=>r.json())`)).every(Boolean);
  const other=session.fromPartition('isolated-synthetic-empty');checks.cookieIsolation=(await other.cookies.get({url:ORIGIN})).length===0;
  checks.gzip=await js(`fetch('/api/gzip').then(r=>r.json()).then(v=>v.message==='成子：中文语音与朋友圈 ✓')`);
  const boundary='ChengziSyntheticBoundary',prefix=`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="synthetic.wav"\r\nContent-Type: audio/wav\r\n\r\n`,suffix=`\r\n--${boundary}--\r\n`;
  const payload=Buffer.concat([Buffer.from(prefix),Buffer.from([0,1,2,127,128,254,255]),Buffer.from(suffix)]);
  await js(`fetch('/api/upload',{method:'POST',headers:{'content-type':${JSON.stringify('multipart/form-data; boundary='+boundary)},'x-request-id':'synthetic-stable'},body:new Uint8Array(${JSON.stringify([...payload])})}).then(r=>r.json())`);
  checks.multipart=receivedMultipart?.equals(payload)&&receivedType==='multipart/form-data; boundary='+boundary;
  checks.originPreserved=receivedOrigin===ORIGIN;
  if(!checks.originPreserved)diagnostics.push('Received synthetic Origin: '+String(receivedOrigin));
  const first=await js(`fetch('/api/stream').then(async r=>{window.syntheticReader=r.body.getReader();return new TextDecoder().decode((await window.syntheticReader.read()).value);})`);
  checks.streamFirstBeforeCompletion=first==='data: 第一段\n\n'&&!streamTail;
  checks.streamRest=await js(`window.syntheticReader.read().then(x=>new TextDecoder().decode(x.value)===${JSON.stringify('data: 第二段\n\n')})`);
  await js(`window.syntheticAbort=new AbortController();fetch('/api/abort',{signal:window.syntheticAbort.signal}).then(async r=>{window.syntheticAbortReader=r.body.getReader();await window.syntheticAbortReader.read();window.syntheticAbort.abort();return window.syntheticAbortReader.read().then(()=>false,e=>e.name==='AbortError');})`).then(value=>checks.rendererAbort=value);
  for(let n=0;n<30&&!abortClosed;n++)await pause(100);
  checks.upstreamAbort=abortClosed;
  await js(`fetch('/api/logout',{method:'POST'}).then(r=>r.json())`);
  checks.logout=Object.values(await js(`fetch('/api/session').then(r=>r.json())`)).every(value=>!value);
  checks.noRecursion=remoteCalls===9;
  assert.ok(Object.values(checks).every(Boolean),'INTEGRATION_CHECK_FAILED');
}

app.whenReady().then(run).then(()=>finish(0),error=>finish(1,error));
async function finish(code,error){
  clearTimeout(watchdog);for(const timer of timers)clearTimeout(timer);
  if(win&&!win.isDestroyed())win.destroy();
  if(ses){try{ses.protocol.unhandle('https');await ses.clearStorageData();}catch{}}
  for(const socket of sockets)socket.destroy();server?.close();
  const result={ok:code===0,checks,diagnostics,userDataUsed:false,realNetworkUsed:false,syntheticTlsPort:PORT,...(error?{error:error.code||error.name||'INTEGRATION_FAILED',detail:String(error.message||'').slice(0,180)}:{})};
  if(process.env.CHENGZI_HTTP_RECEIPT){fs.mkdirSync(path.dirname(process.env.CHENGZI_HTTP_RECEIPT),{recursive:true});fs.writeFileSync(process.env.CHENGZI_HTTP_RECEIPT,JSON.stringify(result,null,2));}
  process.stdout.write(JSON.stringify(result)+'\n');app.exit(code);
}
