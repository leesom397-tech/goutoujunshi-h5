import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const output=process.env.QA_OUTPUT||'D:/Temp/chengzi-flow-qa';await mkdir(output,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox'],defaultViewport:{width:1440,height:1000}});
const context=await browser.createBrowserContext(),pages=[],calls=[],errors=[];
const owner='synthetic-connection-owner',subject='11111111-1111-4111-8111-111111111111',token='synthetic-session-token-'.repeat(2),handoff='A'.repeat(43);
let paired=false;
let failNextSession=false;
const sessions=await build({entryPoints:['lib/capture-connection-session.ts'],bundle:true,write:false,format:'iife',globalName:'SessionFixture',platform:'browser',logLevel:'silent'});
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Private-Network':'true'};
async function tab(label,scope=owner,localPermission){
 const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(label+': '+e.message));
 // Requests below are synthetic. Pin only the permission under test so newer
 // Chrome permission names do not turn a network-retry case into a permission case.
 if(localPermission)await page.evaluateOnNewDocument(state=>{
  window.__syntheticLocalPermission=state;
  const query=navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query=descriptor=>['loopback-network','local-network-access'].includes(descriptor.name)?Promise.resolve({state:window.__syntheticLocalPermission,onchange:null,addEventListener(){},removeEventListener(){},dispatchEvent(){return true;}}):query(descriptor);
 },localPermission);
 await page.setRequestInterception(true);
 page.on('request',async request=>{
  const url=new URL(request.url());let value={},status=200;
  if(url.hostname==='127.0.0.1'&&url.port==='17863'){
   calls.push({tab:label,path:url.pathname,method:request.method(),body:request.postData()||'',authorization:request.headers().authorization||''});
   if(request.method()==='OPTIONS'){}
   else if(url.pathname==='/health')value={version:'1.2.6',ready:true,capabilities:{chat:true,moments:true,backgroundChat:true,backgroundHistory:true,momentsAllVisible:true,momentsContacts:true,personBundle:true,deferredVoice:true}};
   else if(url.pathname==='/pair/handoff'){
    assert.deepEqual(JSON.parse(request.postData()),{handoff});assert.equal(paired,false,'one-time handoff redeemed exactly once');paired=true;value={token,expiresIn:28800};
   }else if(url.pathname==='/pair'){
    assert.deepEqual(JSON.parse(request.postData()),{code:'AABBCCDD'});paired=true;value={token,expiresIn:28800};
   }else if(url.pathname==='/session'){
    if(failNextSession){failNextSession=false;await request.abort('failed');return;}
    const valid=paired&&request.headers().authorization==='Bearer '+token;
    if(request.headers().authorization==='Bearer synthetic-stale-session')value={connected:false};
    else {status=valid?200:401;value=valid?{connected:true,expiresIn:28800}:{error:{code:'TOKEN_INVALID',message:'合成会话无效'}};}
   }else if(url.pathname==='/contacts/search')value={accountKey:'synthetic-wechat',contacts:[],message:'无匹配联系人'};
   else {status=500;errors.push('unexpected bridge '+url.pathname);}
  }else if(request.url().startsWith(origin+'/api/')){
   calls.push({tab:label,path:url.pathname,method:request.method(),body:request.postData()||'',authorization:request.headers().authorization||''});
   if(url.pathname==='/api/web/account-context')value={account:{userId:scope,balance:100},people:[{id:subject,label:'合成人物'}],prices:{analysisSmall:3,profile:5}};
   else if(url.pathname==='/api/auth/session')value={loggedIn:true};
   else if(url.pathname==='/api/account/credits')value={account:{userId:scope,balance:100},prices:{analysisSmall:3,profile:5}};
   else if(url.pathname==='/api/web/profile')value={enabled:true,paused:false,subjects:[{id:subject,label:'合成人物'}]};
   else if(url.pathname==='/api/web/capture/library')value={ownerId:scope,libraries:[]};
   else if(url.pathname==='/api/web/report/list')value={reports:[]};
   else if(url.pathname==='/api/web/capture/analyze')value={status:'none'};
  }else if(url.origin===origin)return request.continue();
  else return request.abort();
  await request.respond({status,contentType:'application/json',headers,body:JSON.stringify(value)});
 });
 return page;
}
const connected=page=>page.waitForFunction(()=>document.body.innerText.includes('助手已连接'),{timeout:30000});
const disconnected=page=>page.waitForFunction(()=>document.body.innerText.includes('下载 Windows 助手'),{timeout:30000});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 const original=await tab('original'),foreign=await tab('other-owner','synthetic-other-owner');
 const path='/capture?method=desktop&intent=person&subjectId='+subject+'&returnTo='+encodeURIComponent('/archive?subjectId='+subject)+'&contactSearch='+encodeURIComponent('合成人物')+'&focus=affinity';
 await original.goto(origin+path,{waitUntil:'networkidle0',timeout:90000});await disconnected(original);
 await original.waitForFunction(owner=>localStorage.getItem(`chengzi-capture:${owner}:connection-entry`)?.includes('intent=person'),{},owner);
 await foreign.goto(origin+'/capture?method=desktop',{waitUntil:'networkidle0',timeout:90000});await disconnected(foreign);
 const helper=await tab('helper');await helper.goto(origin+'/capture?method=desktop#connect='+handoff,{waitUntil:'networkidle0',timeout:90000});
 await connected(helper);await connected(original);
 assert.equal(original.url(),origin+path,'original tab keeps its location');
 const recovered=new URL(helper.url());
 for(const [key,value] of new URL(origin+path).searchParams)assert.equal(recovered.searchParams.get(key),value,'helper tab restores '+key);
 assert.equal(recovered.hash,'','handoff removed from URL');
 assert.equal(await helper.$eval('input[placeholder="输入好友的备注或昵称"]',e=>e.value),'合成人物','restored search populates actual control');
 assert.equal(await foreign.evaluate(()=>document.body.innerText.includes('助手已连接')),false,'different account never connects');
 assert.equal(await foreign.evaluate(()=>new URLSearchParams(location.search).has('subjectId')),false,'different account never restores navigation');
 assert.equal(calls.some(c=>c.tab==='other-owner'&&c.path==='/session'),false,'different account receives no credential to validate');
 assert.equal(calls.filter(c=>c.path==='/pair/handoff'&&c.method==='POST').length,1);
 assert.ok(calls.some(c=>c.tab==='original'&&c.path==='/session'&&c.authorization==='Bearer '+token),'original validates received session against bridge');
 assert.equal(calls.some(c=>c.tab==='original'&&c.path.startsWith('/pair')),false,'discovery does not rotate helper sessions');
 const stale=await tab('stale-session');
 await stale.evaluateOnNewDocument(owner=>sessionStorage.setItem(`chengzi-capture:${owner}:connection`,JSON.stringify({token:'synthetic-stale-session',expiresAt:Date.now()+60000})),owner);
 await stale.goto(origin+'/capture?method=desktop',{waitUntil:'networkidle0'});await connected(stale);
 assert.equal(await stale.evaluate(owner=>JSON.parse(sessionStorage.getItem(`chengzi-capture:${owner}:connection`)).token,owner),token,'connected:false clears old credential and continues discovery');
 await stale.close();
 await original.screenshot({path:output+'/helper-connected-desktop.png',fullPage:true});
 await original.setViewport({width:390,height:844});
 assert.equal(await original.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390px no horizontal overflow');
 await original.screenshot({path:output+'/helper-connected-mobile.png',fullPage:true});
 await original.evaluate(()=>[...document.querySelectorAll('summary')].find(e=>e.textContent==='助手设置').click());
 await original.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='断开助手连接').click());await disconnected(original);
 await original.bringToFront();await delay(2400);
 assert.equal(await original.evaluate(()=>document.body.innerText.includes('助手已连接')),false,'explicit disconnect survives discovery and focus');
 await original.reload({waitUntil:'networkidle0'});await disconnected(original);await delay(2400);
 assert.equal(await original.evaluate(()=>document.body.innerText.includes('助手已连接')),false,'disconnect survives reload');
 const resumed=await tab('resumed');await resumed.goto(origin+'/capture?method=desktop',{waitUntil:'networkidle0'});await connected(resumed);
 await resumed.close();await helper.close();
 const clean=await tab('after-close');await clean.goto(origin+path,{waitUntil:'networkidle0'});await connected(clean);
 assert.equal(clean.url(),origin+path,'recovery without a paired tab keeps the current person and source');
 assert.ok(calls.some(c=>c.tab==='after-close'&&c.path==='/session'&&c.authorization==='Bearer '+token),'cached existing grant revalidated without another capture tab');
 assert.equal(calls.some(c=>c.tab==='after-close'&&c.path.startsWith('/pair')),false,'cache recovery never creates a new session');
 await clean.addScriptTag({content:sessions.outputFiles[0].text});
 const expiry=await clean.evaluate(owner=>SessionFixture.readCaptureConnectionSession(owner).then(row=>row.expiresAt),owner);await clean.close();
 failNextSession=true;const retry=await tab('network-retry',owner,'granted');await retry.goto(origin+path,{waitUntil:'networkidle0'});await disconnected(retry);
 await retry.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('未能连接本机助手'));
 await retry.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='连接已打开的助手').click());await connected(retry);
 await retry.addScriptTag({content:sessions.outputFiles[0].text});
 assert.equal(await retry.evaluate(owner=>SessionFixture.readCaptureConnectionSession(owner).then(row=>row.expiresAt),owner),expiry,'network retry never extends existing session expiry');
 await retry.close();
 failNextSession=true;const permission=await tab('permission-prompt',owner,'prompt');await permission.goto(origin+path,{waitUntil:'networkidle0'});await disconnected(permission);
 await permission.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('浏览器尚未允许连接本机助手'));
 assert.match(await permission.$eval('[role="alert"]',element=>element.textContent),/本地网络访问.*选择允许.*再点击连接/,'permission failure explains the specific recoverable action');
 await permission.evaluate(()=>{window.__syntheticLocalPermission='granted';[...document.querySelectorAll('button')].find(button=>button.textContent==='连接已打开的助手').click();});await connected(permission);
 await permission.addScriptTag({content:sessions.outputFiles[0].text});
 assert.equal(await permission.evaluate(owner=>SessionFixture.readCaptureConnectionSession(owner).then(row=>row.expiresAt),owner),expiry,'permission recovery keeps the original session expiry');
 assert.equal(calls.some(c=>c.tab==='permission-prompt'&&c.path.startsWith('/pair')),false,'permission recovery does not force another pairing');
 await permission.evaluate(()=>SessionFixture.clearCaptureConnectionSessions());await disconnected(permission);await disconnected(original);
 const fresh=await tab('manual-existing');await fresh.setViewport({width:390,height:844});await fresh.goto(origin+path,{waitUntil:'networkidle0'});await disconnected(fresh);
 await fresh.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='连接已打开的助手').click());
 await fresh.waitForFunction(()=>document.body.innerText.includes('助手已打开。输入助手窗口的 8 位连接码'));
 assert.equal(await fresh.$eval('#capture-code',element=>element.checkVisibility()),true,'button exposes an actual supported 1.2.6 pairing path');
 assert.equal(calls.some(c=>c.tab==='manual-existing'&&c.path.startsWith('/pair')),false,'first-time health discovery does not fabricate pairing');
 await fresh.type('#capture-code','AABBCCDD');await fresh.evaluate(()=>document.querySelector('#capture-code').parentElement.querySelector('button').click());await connected(fresh);
 assert.equal(fresh.url(),origin+path,'manual code pairs on original page without helper restart or a second tab');
 assert.equal(calls.filter(c=>c.tab==='manual-existing'&&c.path==='/pair'&&c.method==='POST').length,1);
 assert.equal(await fresh.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390px manual connection layout');
 await fresh.addScriptTag({content:sessions.outputFiles[0].text});
 const oldGrant=await fresh.evaluate(owner=>new Promise((resolve,reject)=>{const request=indexedDB.open('chengzi-capture-connection:v1',1);request.onsuccess=()=>{const db=request.result,read=db.transaction('sessions').objectStore('sessions').get(owner);read.onsuccess=()=>{db.close();resolve(read.result);};read.onerror=reject;};}),owner);
 const dormant=await tab('dormant-old-tab');await dormant.goto(origin+'/workspace',{waitUntil:'networkidle0'});await dormant.evaluate(({owner,oldGrant})=>sessionStorage.setItem(`chengzi-capture:${owner}:connection`,JSON.stringify({...oldGrant.connection,revision:oldGrant.revision})),{owner,oldGrant});
 await fresh.evaluate(()=>SessionFixture.clearCaptureConnectionSessions());await disconnected(fresh);
 // Simulate an old IDB write finishing after logout; the nonsecret revision
 // marker must still prevent restoration when physical cleanup was delayed.
 await fresh.evaluate(({owner,oldGrant})=>new Promise(resolve=>{const request=indexedDB.open('chengzi-capture-connection:v1',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').put(oldGrant,owner);tx.oncomplete=()=>{db.close();resolve();};};}),{owner,oldGrant});
 const afterLogout=await tab('after-logout');await afterLogout.goto(origin+path,{waitUntil:'networkidle0'});await disconnected(afterLogout);await delay(2200);
 assert.equal(calls.some(c=>c.tab==='after-logout'&&c.path==='/session'),false,'logout removes persistent and live-tab recovery grants');
 await dormant.goto(origin+path,{waitUntil:'networkidle0'});await disconnected(dormant);await delay(2200);
 assert.equal(calls.some(c=>c.tab==='dormant-old-tab'&&c.path==='/session'),false,'a non-capture tab cannot restore its pre-logout sessionStorage grant');
 const stored=await original.evaluate(()=>Object.values(localStorage).join('\n'));assert.equal(stored.includes(token),false,'helper credential never enters localStorage');
 assert.equal(calls.some(c=>c.path.startsWith('/api/')&&(c.body.includes(token)||c.authorization.includes(token)||c.body.includes(handoff))),false,'credential never sent to website APIs');
 assert.equal(calls.some(c=>c.path==='/capture'||c.path.includes('/analyze')&&c.method==='POST'),false,'connection never starts private capture or paid analysis');
 assert.deepEqual(errors,[]);
 console.log('PASS helper 1.2.6: handoff, owner isolation, all paired tabs closed recovery, original TTL, network retry, local-network permission recovery, real existing-helper code pairing on current page, logout revocation, 1440/390; no private capture or paid calls');
}finally{await context.close();await browser.close();}
