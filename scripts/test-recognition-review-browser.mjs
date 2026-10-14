
import assert from 'node:assert/strict';import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798',owner='review-fixture',png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGkAAAAASUVORK5CYII=';
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const lines=[{side:'left',kind:'text',text:'这周有空一起喝咖啡吗？'},{side:'right',kind:'unread',text:''},{side:'left',kind:'image',text:''}];
const entry={id:'00000000-0000-4000-8000-000000000009',lines:[{id:'l1',speaker:'other',text:'这周有空一起喝咖啡吗？'}],decision:{judgment:'已完成单张判断',nextStep:'根据实际情况回应。',replyOptions:[]}};
async function scenario(cancel,responseLost=false){
 const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width:390,height:1000});const errors=[],posts=[];let taskId='',stage='uploading',count=1;page.on('pageerror',error=>errors.push(error.message));
 function state(){return {status:stage,taskId,imageCount:count,completedCount:cancel?1:0,...(cancel?{partialResult:{entries:[entry],reportId:taskId,partial:true}}:{}),...(stage==='awaiting_review'?{phase:'text_analysis',recognition:{index:0,requestId:'00000000-0000-4000-8000-000000000002',revision:0,selfSide:'right',lines,issues:[{kind:'unread',count:1}],editable:true,canContinue:true}}:{}),...(stage==='done'?{result:{reportId:taskId,entries:[{...entry,decision:{...entry.decision,judgment:'纠正原文后的完整判断'}}]}}:{})};}
 await page.setRequestInterception(true);page.on('request',async req=>{
  if(!req.url().startsWith(origin+'/api/'))return req.continue();const u=new URL(req.url()),body=req.method()==='POST'?JSON.parse(req.postData()||'{}'):null;if(body)posts.push({path:u.pathname,body});let value={};
  if(u.pathname==='/api/auth/session')value={loggedIn:true,user:{id:owner}};
  else if(u.pathname==='/api/account/credits')value={account:{userId:owner,balance:50,active:true},prices:{analysisSmall:3}};
  else if(u.pathname==='/api/web/profile')value={enabled:true,paused:false,subjects:[]};
  else if(u.pathname==='/api/web/report/list')value={reports:[]};
  else if(u.pathname==='/api/web/screenshot/batch'){
   if(body?.uploadAction==='init'){taskId=body.taskId;count=body.imageCount;}
   if(body?.uploadAction==='part')stage='awaiting_review';
   if(body?.reviewAction==='confirm')stage='done';
   if(body?.reviewAction==='cancel')stage='error';
   value=state();
  }
  await req.respond({status:responseLost&&body?.reviewAction==='confirm'?503:200,contentType:'application/json',body:JSON.stringify(responseLost&&body?.reviewAction==='confirm'?{error:'模拟确认成功后的响应丢失'}:value)});
 });
 try{
  await page.goto(origin+'/analyze?new=1',{waitUntil:'networkidle0'});
  await page.evaluate(png=>{const input=document.querySelector('input[aria-label="选择分析截图"]'),data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'test.png',{type:'image/png'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));},png);
  await page.waitForSelector('.wa-image');await page.$$eval('[aria-label="选择我的气泡位置"] button',buttons=>buttons.find(x=>x.textContent.includes('右侧是我')).click());await page.waitForFunction(()=>!document.querySelector('.ax-submit').disabled);await page.click('.ax-consent input');await page.click('.ax-submit');await page.waitForSelector('[data-recognition-review]');
  assert.equal(posts.filter(x=>x.body.uploadAction==='init')[0].body.reviewOnDoubt,true);
  await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('[data-recognition-review]');
  assert.equal(posts.filter(x=>x.body.uploadAction==='part').length,1,'refresh does not upload or OCR again');
  assert.match(await page.$eval('[data-recognition-review]',x=>x.textContent),/正在修改：第 2 句/);
  if(cancel){
   await page.$$eval('[data-live-analysis] button',buttons=>buttons.find(x=>x.textContent.includes('取消本次任务')).click());
   await page.waitForFunction(()=>document.body.textContent.includes('已完成单张判断')&&!document.querySelector('[data-live-analysis]'));
   assert.equal(posts.filter(x=>x.body.reviewAction==='cancel').length,1);
  }else{
   await page.select('[aria-label="当前句内容类型"]','text');await page.type('[aria-label="纠正当前句原话"]','周六下午可以。');
   await page.$$eval('[aria-label="识别原文，选择要修改的一句"] button',buttons=>buttons[2].click());
   await page.select('[aria-label="当前句内容类型"]','sticker');
   await page.screenshot({path:'outputs/live-analysis/review-390.png',fullPage:true});
   await page.$$eval('[data-recognition-review] button',buttons=>buttons.find(x=>x.textContent.includes('确认并继续分析')).click());
   await page.waitForFunction(()=>document.body.textContent.includes('纠正原文后的完整判断'));
   const confirms=posts.filter(x=>x.body.reviewAction==='confirm');assert.equal(confirms.length,1);assert.equal(confirms[0].body.lines[1].text,'周六下午可以。');assert.equal(confirms[0].body.lines[2].kind,'sticker');assert.equal(confirms[0].body.selfSide,'right');
  }
  const ids=posts.filter(x=>x.body.taskId).map(x=>x.body.taskId);assert.equal(new Set(ids).size,1);
  assert.equal(posts.filter(x=>x.path==='/api/web/settings').length,1,'review never changes consent/side again');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);console.log('PASS review '+(cancel?'cancel preserves partial':'correction reuses task')+': refresh, one upload, one settings write, same task identity');
 }finally{await context.close();}
}
try{await scenario(false);await scenario(true);await scenario(false,true);}finally{await browser.close();}
