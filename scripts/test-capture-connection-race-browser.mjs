import assert from 'node:assert/strict';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const bundle=await build({entryPoints:['lib/capture-connection-session.ts'],bundle:true,write:false,format:'iife',globalName:'SessionFixture',platform:'browser',logLevel:'silent'});
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const owner='connection-race-fixture',oldToken='synthetic-previous-session-123456',newToken='synthetic-new-session-987654321';
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Private-Network':'true'};
try{for(const lateStatus of [401,200]){
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],calls=[];let releaseOld,oldRequestSeen=false;
 try{
  page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
  page.on('request',async request=>{try{
   const url=new URL(request.url()),helper=url.hostname==='127.0.0.1'&&url.port==='17863';let value={},status=200;
   if(helper){
    calls.push(url.pathname);
    if(request.method()==='OPTIONS'){}
    else if(url.pathname==='/health')value={version:'1.2.6',ready:true,capabilities:{chat:true,moments:true}};
    else if(url.pathname==='/session'){
     assert.equal(request.headers().authorization,'Bearer '+oldToken);oldRequestSeen=true;
     await new Promise(resolve=>{releaseOld=resolve;});status=lateStatus;value=lateStatus===200?{connected:true,expiresIn:600}:{error:{code:'TOKEN_INVALID',message:'旧会话已撤销'}};
    }else if(url.pathname==='/pair'){assert.deepEqual(JSON.parse(request.postData()),{code:'AABBCCDD'});value={token:newToken,expiresIn:28800};}
    else throw Error('unexpected helper operation '+url.pathname);
   }else if(url.origin===origin&&url.pathname.startsWith('/api/')){
    if(url.pathname==='/api/web/account-context')value={account:{userId:owner,balance:100},people:[],prices:{analysisSmall:20,profile:30}};
    else if(url.pathname==='/api/auth/session')value={loggedIn:true};
    else if(url.pathname==='/api/account/credits')value={account:{userId:owner,balance:100},prices:{analysisSmall:20,profile:30}};
    else if(url.pathname==='/api/web/profile')value={enabled:true,subjects:[]};
    else if(url.pathname==='/api/web/capture/library')value={ownerId:owner,libraries:[]};
    else if(url.pathname==='/api/web/capture/analyze')value={status:'none'};
    else if(url.pathname==='/api/web/report/list')value={reports:[]};
    else throw Error('unexpected server operation '+url.pathname);
   }else if(url.origin===origin)return request.continue();else return request.abort();
   await request.respond({status,headers,contentType:'application/json',body:JSON.stringify(value)});
  }catch(error){errors.push(error.message);await request.abort().catch(()=>{});}});
  await page.goto(origin+'/capture?method=desktop',{waitUntil:'networkidle0'});await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(({owner,oldToken})=>SessionFixture.saveCaptureConnectionSession(owner,{token:oldToken,expiresAt:Date.now()+600000}),{owner,oldToken});
  await page.reload({waitUntil:'domcontentloaded'});
  for(let i=0;i<80&&!oldRequestSeen;i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(oldRequestSeen,true,'old automatic session restore is pending');
  await page.$eval('#capture-code',node=>node.closest('details').querySelector('summary').click());await page.type('#capture-code','AABBCCDD');
  await page.$eval('#capture-code',node=>node.parentElement.querySelector('button').click());
  await page.waitForFunction(()=>document.body.innerText.includes('助手已连接'),{timeout:5000});
  releaseOld();await new Promise(resolve=>setTimeout(resolve,700));
  assert.equal(await page.evaluate(owner=>JSON.parse(sessionStorage.getItem(`chengzi-capture:${owner}:connection`)).token,owner),newToken,'late old result must not overwrite tab token');
  await page.addScriptTag({content:bundle.outputFiles[0].text});assert.equal(await page.evaluate(owner=>SessionFixture.readCaptureConnectionSession(owner).then(value=>value?.token),owner),newToken,'late old result must not overwrite/delete cached grant');
  assert.equal(await page.evaluate(()=>document.body.innerText.includes('助手已连接')),true);assert.equal(await page.$('[role="alert"]'),null);
  assert.deepEqual(errors,[]);assert.equal(calls.filter(path=>path==='/pair').length,2,'one preflight and one explicit pairing request');
  console.log(`PASS delayed old /session ${lateStatus}: new manually paired token remains connected in sessionStorage and IndexedDB`);
 }finally{releaseOld?.();await context.close();}
}}finally{await browser.close();}
