import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {mkdir} from 'node:fs/promises';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const output=process.env.QA_OUTPUT||'D:/Temp/chengzi-flow-qa';await mkdir(output,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox'],defaultViewport:{width:1440,height:1000}});
const context=await browser.createBrowserContext(),pages=[],calls=[],errors=[];
const owner='synthetic-connection-owner',subject='11111111-1111-4111-8111-111111111111',token='synthetic-session-token-'.repeat(2),handoff='A'.repeat(43);
let paired=false;
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Private-Network':'true'};
async function tab(label,scope=owner){
 const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(label+': '+e.message));
 await page.setRequestInterception(true);
 page.on('request',async request=>{
  const url=new URL(request.url());let value={},status=200;
  if(url.hostname==='127.0.0.1'&&url.port==='17863'){
   calls.push({tab:label,path:url.pathname,method:request.method(),body:request.postData()||'',authorization:request.headers().authorization||''});
   if(request.method()==='OPTIONS'){}
   else if(url.pathname==='/health')value={version:'1.2.6',ready:true,capabilities:{chat:true,moments:true,backgroundChat:true,backgroundHistory:true,momentsAllVisible:true,momentsContacts:true,personBundle:true,deferredVoice:true}};
   else if(url.pathname==='/pair/handoff'){
    assert.deepEqual(JSON.parse(request.postData()),{handoff});assert.equal(paired,false,'one-time handoff redeemed exactly once');paired=true;value={token,expiresIn:28800};
   }else if(url.pathname==='/session'){
    const valid=paired&&request.headers().authorization==='Bearer '+token;
    if(request.headers().authorization==='Bearer synthetic-stale-session')value={connected:false};
    else {status=valid?200:401;value=valid?{connected:true,expiresIn:28800}:{error:{code:'TOKEN_INVALID',message:'合成会话无效'}};}
   }else if(url.pathname==='/contacts/search')value={accountKey:'synthetic-wechat',contacts:[],message:'无匹配联系人'};
   else {status=500;errors.push('unexpected bridge '+url.pathname);}
  }else if(request.url().startsWith(origin+'/api/')){
   calls.push({tab:label,path:url.pathname,method:request.method(),body:request.postData()||'',authorization:request.headers().authorization||''});
   if(url.pathname==='/api/auth/session')value={loggedIn:true};
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
 await original.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='断开').click());await disconnected(original);
 await original.bringToFront();await delay(2400);
 assert.equal(await original.evaluate(()=>document.body.innerText.includes('助手已连接')),false,'explicit disconnect survives discovery and focus');
 await original.reload({waitUntil:'networkidle0'});await disconnected(original);await delay(2400);
 assert.equal(await original.evaluate(()=>document.body.innerText.includes('助手已连接')),false,'disconnect survives reload');
 const resumed=await tab('resumed');await resumed.goto(origin+'/capture?method=desktop',{waitUntil:'networkidle0'});await connected(resumed);
 await resumed.close();await helper.close();
 const clean=await tab('after-close');await clean.goto(origin+'/capture?method=desktop',{waitUntil:'networkidle0'});await disconnected(clean);await delay(2400);
 assert.equal(await clean.evaluate(()=>document.body.innerText.includes('助手已连接')),false,'closed tabs do not offer sessions');
 const stored=await original.evaluate(()=>Object.values(localStorage).join('\n'));assert.equal(stored.includes(token),false,'helper credential never enters localStorage');
 assert.equal(calls.some(c=>c.path.startsWith('/api/')&&(c.body.includes(token)||c.authorization.includes(token)||c.body.includes(handoff))),false,'credential never sent to website APIs');
 assert.equal(calls.some(c=>c.path==='/capture'||c.path.includes('/analyze')&&c.method==='POST'),false,'connection never starts private capture or paid analysis');
 assert.deepEqual(errors,[]);
 console.log('PASS browser helper 1.2.6 handoff: current tab auto-connect, complete person context in new tab, same-owner session validation, other-owner isolation, 1440/390 layout, disconnect/reload pause, closed-tab cleanup; no real capture/provider/API writes');
}finally{await context.close();await browser.close();}
