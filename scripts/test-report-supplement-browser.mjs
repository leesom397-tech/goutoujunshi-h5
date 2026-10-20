import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const id='11111111-1111-4111-8111-111111111111',parent='22222222-2222-4222-8222-222222222222';
const metadata={analysisScope:'supplement',generatedAt:'2026-10-21T04:00:00Z',supplementOf:{scope:'fullHistory',reportId:parent,generatedAt:'2026-10-20T03:00:00Z'}};
// Batch entries deliberately omit metadata: the persisted parent owns scope.
const report={id,lines:[],annotations:[],decision:{summary:'本次合成截图只有安排信息。',replyOptions:[]}};
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
try{
 for(const width of [1440,390,320]){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],writes=[];
  await page.setViewport({width,height:950});await page.setRequestInterception(true);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>{
   const url=new URL(request.url());if(!url.pathname.startsWith('/api/'))return request.continue();
   if(request.method()!=='GET')writes.push(url.pathname);
   let value={};
   if(url.pathname==='/api/auth/session')value={loggedIn:true,user:{id:'supplement-test'}};
   if(['/api/account/credits','/api/web/account-context'].includes(url.pathname))value={account:{userId:'supplement-test',balance:100},prices:{},people:[],meteringReady:true};
   if(url.pathname==='/api/web/profile')value={enabled:true,subjects:[]};
   if(url.pathname==='/api/web/report')value={reportId:id,kind:'chat',report:{...report,...metadata},entries:[report,{...report,id:parent}]};
   if(url.pathname==='/api/web/report/list')value={reports:[{id,kind:'chat',...metadata,createdAt:1792555200000,summary:'合成补充截图'}],total:1,page:1,pageSize:20};
   return request.respond({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await page.goto(`${origin}/report?id=${id}`,{waitUntil:'networkidle0'});
  await page.waitForSelector('[data-report-supplement]');
  assert.match(await page.$eval('[data-report-supplement]',e=>e.textContent),/补充解读.*不重新统计全部历史/);
  assert.match(await page.$eval('[data-report-supplement] time',e=>e.textContent),/2026\/10\/20.*11:00/);
  assert.equal(await page.$eval('[data-report-supplement] a',e=>e.getAttribute('href')),`/report?id=${parent}`);
  assert.match(await page.$eval('[data-report-participants]',e=>e.textContent),/补充解读/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.goto(`${origin}/reports`,{waitUntil:'networkidle0'});
  await page.waitForSelector(`a[href="/report?id=${id}"]`);
  assert.match(await page.$eval(`a[href="/report?id=${id}"]`,e=>e.textContent),/补充解读/);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log(`PASS ${width}: batch scope retained, parent date/exact return, list scope; no paid calls`);
  await context.close();
 }
}finally{await browser.close();}
