// Real /analyze UI + real IndexedDB. All account/report/analysis calls use synthetic fixtures.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {build} from 'esbuild';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGkAAAAASUVORK5CYII=';
const owner='integration-owner',subjectId='person-a',oldReportId='11111111-1111-4111-8111-111111111111';
const bundle=await build({entryPoints:['components/web-analysis/intake-history.ts'],bundle:true,write:false,format:'iife',globalName:'HistoryFixture',target:'es2022'});
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox'],defaultViewport:{width:1280,height:1100}});
async function scenario({reanalyze=false,missing=false,identity=false}){
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],requests=[],jobs=new Map();page.on('pageerror',error=>errors.push(error.message));
 await page.setRequestInterception(true);page.on('request',async request=>{
  if(!request.url().startsWith(origin+'/api/'))return request.continue();const url=new URL(request.url()),body=request.method()==='POST'?JSON.parse(request.postData()||'{}'):null;requests.push({path:url.pathname,method:request.method(),body});let value={},status=200;
  if(url.pathname==='/api/auth/session')value={loggedIn:true,user:{id:owner,name:'虚构测试账号'}};
  else if(url.pathname==='/api/account/credits')value={account:{userId:owner,balance:100,active:true},prices:{analysisSmall:3,analysisMedium:5,analysisLarge:8,profile:5}};
  else if(url.pathname==='/api/web/profile')value={enabled:true,paused:false,subjects:[{id:subjectId,label:'测试甲'},{id:'person-b',label:'测试乙'}]};
  else if(url.pathname==='/api/web/report/list')value={reports:[]};
  else if(url.pathname==='/api/web/report'){
   if(missing){status=404;value={error:'原报告已删除'};}
   else value={reportId:oldReportId,kind:'chat',subjectId,selfSide:'left',totalCount:3,report:{id:oldReportId,subjectId,selfSide:'left',lines:[{speaker:'other',text:'虚构的旧材料。'}],decision:{judgment:'虚构旧报告'}}};
  }else if(url.pathname==='/api/web/screenshot/batch'){
   const id=body?.taskId||url.searchParams.get('taskId');let job=jobs.get(id);
   if(body?.uploadAction==='init'){job={id,count:body.imageCount,subjectId:body.subjectId,side:body.selfSide,received:[]};jobs.set(id,job);}
   if(body?.uploadAction==='part'){assert.ok(job,'parts follow initialization');job.received.push(body.index);}
   if(job?.received.length===job?.count)value={status:'done',imageCount:job.count,totalCount:job.count,result:{reportId:id,subjectId:job.subjectId,entries:[{id,subjectId:job.subjectId,selfSide:job.side,createdAt:Date.now(),lines:[{id:'fixture-line',speaker:'other',text:'这是虚构的新增材料。'}],decision:{judgment:'本次新增材料已完成',nextStep:'根据完整上下文阅读',replySuggestions:[]}}]}};
   else value={status:'uploading',imageCount:job?.count||0,received:job?.received||[]};
  }else if(url.pathname==='/api/web/relationship-feedback')value={subjectId,automatic:{status:'empty',headline:'有新材料继续补充',note:'',count:0,current:null,previous:null,changes:[]}};
  await request.respond({status,contentType:'application/json',body:JSON.stringify(value)});
 });
 await page.evaluateOnNewDocument(({owner,subjectId})=>{if(localStorage.getItem('history-integration-seeded'))return;const key=(scope,value)=>'chengzi-intake:v1:'+JSON.stringify([owner,scope,value]);localStorage.setItem(key('last','chat'),JSON.stringify({subjectId}));localStorage.setItem(key('subject',subjectId),JSON.stringify({subjectId,selfSide:'left'}));localStorage.setItem(key('subject','person-b'),JSON.stringify({subjectId:'person-b',selfSide:'right'}));localStorage.setItem('history-integration-seeded','1');},{owner,subjectId});
 try{
  await page.goto(origin+'/analyze?mode=chat&new=1',{waitUntil:'networkidle0'});await page.waitForFunction(()=>document.body.textContent.includes('继续了解 测试甲'));
  assert.match(await page.$eval('[aria-label="当前分析人物"]',el=>el.textContent),/左侧是我/);
  if(identity){await page.$$eval('[aria-label="当前分析人物"] button',buttons=>buttons.find(button=>button.textContent==='换个人').click());await page.select('[aria-label="当前分析人物"] select','person-b');await page.waitForFunction(()=>document.body.textContent.includes('继续了解 测试乙'));assert.match(await page.$eval('[aria-label="当前分析人物"]',el=>el.textContent),/右侧是我/);assert.equal(requests.filter(item=>item.method==='POST').length,0);return;}
  await page.addScriptTag({content:bundle.outputFiles[0].text});const seeded=await page.evaluate(async({owner,subjectId,reportId,png})=>{const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));const files=[1,2,3].map(index=>new File([bytes,'fixture-'+index],'old-'+index+'.png',{type:'image/png'}));return HistoryFixture.recordSuccessfulImages({owner,subjectId,mode:'chat',selfSide:'left'},files,{status:'done',reportId,partial:false});},{owner,subjectId,reportId:oldReportId,png});assert.equal(seeded,true);
  await page.evaluate(png=>{const input=document.querySelector('input[type="file"][aria-label="选择分析截图"]'),files=new DataTransfer(),bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));for(let index=1;index<=4;index++)files.items.add(new File([bytes,'fixture-'+index],'renamed-'+index+'.png',{type:'image/png'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));},png);
  await page.waitForFunction(()=>document.querySelectorAll('.wa-image').length===4);
  if(missing)await page.waitForFunction(()=>/无法|暂未|未能/.test(document.body.textContent)&&/去重|重复/.test(document.body.textContent));
  else {await page.waitForFunction(()=>/1\s*张新材料/.test(document.body.textContent)&&/3\s*张已分析/.test(document.body.textContent));if(reanalyze){await page.$$eval('label',labels=>{const label=labels.find(label=>/重新分析/.test(label.textContent)&&label.querySelector('input[type="checkbox"]'));if(!label)throw Error('Missing optional reanalysis checkbox');label.querySelector('input').click();});}}
  const expectedCount=reanalyze||missing?4:1,expectedCost=expectedCount===1?3:5;
  await page.waitForFunction(cost=>{const button=document.querySelector('.ax-submit');return !!button&&!button.disabled&&button.textContent.includes(cost+' 积分');},{},expectedCost);
  assert.match(await page.$eval('.ax-submit',el=>el.textContent),new RegExp(expectedCost+' 积分'));
  assert.equal(requests.filter(item=>item.method==='POST').length,0,'selection, identity reuse and duplicate check never start paid work');
  await page.click('.ax-consent input[type="checkbox"]');await page.click('.ax-submit');await page.waitForFunction(()=>document.body.textContent.includes('本次新增材料已完成'));
  const inits=requests.filter(item=>item.path==='/api/web/screenshot/batch'&&item.body?.uploadAction==='init'),parts=requests.filter(item=>item.path==='/api/web/screenshot/batch'&&item.body?.uploadAction==='part');
  assert.equal(inits.length,1);assert.equal(inits[0].body.imageCount,expectedCount);assert.equal(inits[0].body.subjectId,subjectId);assert.equal(inits[0].body.selfSide,'left');assert.equal(inits[0].body.confirmed,true);assert.equal(parts.length,expectedCount);assert.deepEqual(parts.map(item=>item.body.index),Array.from({length:expectedCount},(_,i)=>i));
  if(expectedCount===1)assert.ok(Buffer.from(parts[0].body.image.split(',')[1],'base64').toString().endsWith('fixture-4'),'only the new fourth image is uploaded');
  assert.equal(errors.length,0,errors.join('\n'));
 }finally{await context.close();}
}
try{await scenario({identity:true});await scenario({});await scenario({reanalyze:true});await scenario({missing:true});console.log('PASS: real /analyze remembered person and side, 3/4 previously analyzed means 1 small-tier upload, explicit reanalysis means 4 medium-tier uploads, missing original report retains all files, no unconfirmed analysis requests.');}finally{await browser.close();}
