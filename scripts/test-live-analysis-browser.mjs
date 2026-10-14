
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {mkdirSync} from 'node:fs';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const owner='live-fixture-owner',png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGkAAAAASUVORK5CYII=';
const entry=index=>({id:'00000000-0000-4000-8000-00000000000'+index,createdAt:Date.now(),lines:[{id:'a',speaker:'other',text:'周六三点见，我来订票。'},{id:'b',speaker:'self',text:'可以呀，那我们周六见。'}],decision:{judgment:'第'+index+'张：已经提出具体安排',evidence:'周六三点见，我来订票。',nextStep:'确认见面地点与时间。',replyOptions:[{text:'好的，周六见。',style:'自然',reason:'确认具体安排。'}]}});
mkdirSync('outputs/live-analysis',{recursive:true});
async function run(width){
 const context=await browser.createBrowserContext();const page=await context.newPage();await page.setViewport({width,height:1000});
 const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));let stage=0,taskId='',count=2;
 await page.setRequestInterception(true);page.on('request',async req=>{
  if(!req.url().startsWith(origin+'/api/'))return req.continue();
  const url=new URL(req.url()),body=req.method()==='POST'?JSON.parse(req.postData()||'{}'):null;let value={};
  if(body)posts.push({path:url.pathname,body});
  if(url.pathname==='/api/auth/session')value={loggedIn:true,user:{id:owner}};
  else if(url.pathname==='/api/account/credits')value={account:{userId:owner,balance:50,active:true},prices:{analysisSmall:3,analysisMedium:5,analysisLarge:8,profile:5}};
  else if(url.pathname==='/api/web/profile')value={enabled:true,paused:false,subjects:[]};
  else if(url.pathname==='/api/web/report/list')value={reports:[]};
  else if(url.pathname==='/api/web/screenshot/batch'){
   if(body?.uploadAction==='init'){taskId=body.taskId;count=body.imageCount;value={status:stage?'running':'uploading',imageCount:count,received:[]};}
   else if(body?.uploadAction==='part'){value={status:body.index===count-1?'running':'uploading',received:Array.from({length:body.index+1},(_,i)=>i),imageCount:count};}
   else if(stage===0)value={status:'running',phase:'text_analysis',imageCount:count,completedCount:0,recognizedCount:1,startedAt:Date.now()-6000,recognition:{index:0,requestId:'source1',revision:0,selfSide:'right',editable:false,lines:[{side:'left',kind:'text',text:'周六三点见，我来订票。'},{side:'right',kind:'sticker',text:'好的'}]}};
   else value={status:'running',phase:'text_analysis',imageCount:count,completedCount:stage,recognizedCount:Math.min(stage+1,count),partialResult:{entries:Array.from({length:stage},(_,i)=>entry(i+1)),partial:true,reportId:taskId}};
  }
  await req.respond({status:200,contentType:'application/json',body:JSON.stringify(value)});
 });
 try{
  await page.goto(origin+'/analyze?new=1',{waitUntil:'networkidle0'});
  await page.evaluate(png=>{const input=document.querySelector('input[aria-label="选择分析截图"]'),data=new DataTransfer();for(let i=0;i<3;i++)data.items.add(new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0)),String(i)],'test'+i+'.png',{type:'image/png'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));},png);
  await page.waitForSelector('.wa-image');
  await page.$$eval('[aria-label="选择我的气泡位置"] button',buttons=>buttons.find(x=>x.textContent.includes('右侧是我')).click());
  await page.waitForFunction(()=>!document.querySelector('.ax-submit').disabled);
  await page.click('.ax-consent input');await page.click('.ax-submit');
  await page.waitForSelector('[data-live-recognition]');
  assert.match(await page.$eval('[data-live-recognition]',e=>e.textContent),/周六三点见/);
  assert.equal(await page.$('#analysis-confirm'),null,'upload form leaves view while waiting');
  assert.equal(await page.$('[data-recognition-review]'),null,'ordinary OCR never prompts an extra review');
  stage=1;await page.waitForSelector('[data-live-result]');
  assert.match(await page.$eval('[data-live-result]',e=>e.textContent),/第1张：已经提出具体安排/);
  stage=2;await page.waitForFunction(()=>document.querySelectorAll('[aria-label="选择已完成截图"] button').length===2);
  await page.$$eval('[aria-label="选择已完成截图"] button',buttons=>buttons[1].click());
  assert.match(await page.$eval('[data-live-result]',e=>e.textContent),/第2张：已经提出具体安排/);
  await new Promise(r=>setTimeout(r,2800));
  assert.match(await page.$eval('[data-live-result]',e=>e.textContent),/第2张：已经提出具体安排/,'polling preserves selected result');
  await page.$eval('[data-live-analysis]',e=>e.scrollIntoView({block:'start',behavior:'instant'}));
  await page.screenshot({path:'outputs/live-analysis/live-'+width+'.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
  await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('[data-live-result]');
  const inits=posts.filter(x=>x.body.uploadAction==='init');assert.equal(inits.length,2);assert.equal(inits[0].body.taskId,inits[1].body.taskId,'reload resumes the same paid task');
  assert.equal(posts.filter(x=>x.body.uploadAction==='part').length,3,'restored running job does not reupload');
  assert.deepEqual(errors,[]);console.log('PASS live analysis '+width+': recognized transcript before result, committed partial findings/reply, stable selection, reload same task, no overflow');
 }finally{await context.close();}
}
try{await run(1440);await run(390);}finally{await browser.close();}
