import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox'],defaultViewport:{width:1280,height:900}});
const context=await browser.createBrowserContext(),page=await context.newPage(),captures=[],writes=[];
let rejectPair=true;
await page.setRequestInterception(true);
page.on('request',async request=>{
 const url=new URL(request.url());if(!request.url().startsWith(origin+'/api/')&&!request.url().startsWith('http://127.0.0.1:17863/'))return request.continue();
 let value={},status=200;
 if(url.port==='17863'){
  if(request.method()==='OPTIONS')value={};
  else if(url.pathname==='/health')value={version:'1.0.1',ready:true,capabilities:{chat:true,moments:true}};
  else if(url.pathname==='/pair'){if(rejectPair){status=410;value={error:{code:'PAIR_CODE_EXPIRED',message:'连接码已过期，请在本机助手刷新连接码。'}};}else value={token:'synthetic-loopback-token',expiresIn:28800};}
  else if(url.pathname==='/capture'){captures.push(JSON.parse(request.postData()));value={jobId:'synthetic-job-'+captures.length};}
  else if(url.pathname.startsWith('/jobs/'))value={status:'failed',error:{code:'TEST_STOP',message:'合成测试已停止，没有读取微信。'}};
 }else{
  if(request.method()!=='GET')writes.push(url.pathname);
  if(url.pathname==='/api/account/credits')value={account:{userId:'capture-limit-owner',balance:100,active:true},prices:{analysisSmall:3,profile:5}};
  else if(url.pathname==='/api/web/profile')value={enabled:true,paused:false,subjects:[]};
 }
 await request.respond({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Private-Network':'true'},body:JSON.stringify(value)});
});
const click=async text=>{assert.equal(await page.evaluate(text=>{const el=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===text);if(!el||el.disabled)return false;el.click();return true;},text),true,'button '+text);};
try{
 await page.goto(origin+'/capture',{waitUntil:'networkidle0'});await page.waitForSelector('#capture-code');
 if(await page.$('[aria-label="关闭操作引导"]'))await page.click('[aria-label="关闭操作引导"]');
 await page.evaluate(()=>{[...document.querySelectorAll('label')].find(el=>el.textContent.startsWith('这次读取')).querySelector('select').id='test-capture-limit';});
 assert.equal(await page.$eval('#test-capture-limit',el=>el.value),'40');
 assert.match(await page.$eval('#test-capture-limit option[value="500"]',el=>el.textContent),/尽量读取更多.*最多 500/);
 await page.type('#capture-code','ABCDEFGH');await click('连接');await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('连接码已过期'));
 rejectPair=false;await click('连接');await page.waitForFunction(()=>document.body.textContent.includes('已连接本机助手'));
 await page.type('input[placeholder="填写准确的好友备注或昵称"]','虚构唯一好友');await page.select('#test-capture-limit','500');await click('开始采集聊天');await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('合成测试已停止'));
 assert.deepEqual(captures[0],{kind:'chat',friend:'虚构唯一好友',limit:500});
 await click('朋友圈');assert.match(await page.$eval('#test-capture-limit option[value="50"]',el=>el.textContent),/尽量读取更多.*最多 50/);await page.select('#test-capture-limit','50');await click('开始采集朋友圈');await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('合成测试已停止'));
 assert.deepEqual(captures[1],{kind:'moments',friend:'虚构唯一好友',limit:50});assert.deepEqual(writes,[],'limit selection/capture must not analyze or charge');
 console.log('PASS capture page: default40, honest500/50options, exact limit forwarded, structured expired-code feedback, no analysis/fee requests; loopback fully mocked, no real WeChat');
}finally{await context.close();await browser.close();}
