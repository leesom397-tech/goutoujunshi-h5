import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

// A fully synthetic, isolated browser check: no account, database or model calls.
const output = path.resolve('.tmp/qa-conversation-memory');
await mkdir(output, { recursive: true });
const owner = 'synthetic-owner', subjectId = 'synthetic-person';
const items = [
  { id:'self-statement',target:'self',field:'selfBasic:occupation',label:'职业',value:'维修电脑',quote:'我平时维修电脑。',basis:'statement',conflict:false,status:'pending',sourceId:'source-1' },
  { id:'self-inference',target:'self',field:'selfProfileClue',label:'沟通习惯',value:'可能偏好直接沟通',quote:'你直接把情况说一下。',basis:'inference',conflict:false,status:'pending',sourceId:'source-2' },
  { id:'subject-statement',target:'subject',field:'profileClue',label:'时间安排',value:'工作日晚上更方便',quote:'我一般工作日晚上方便。',basis:'statement',conflict:false,status:'pending',sourceId:'source-3' },
  { id:'subject-conflict',target:'subject',field:'subjectBasic:city',label:'常住地',value:'杭州',quote:'我现在搬到杭州了。',basis:'statement',conflict:true,currentValue:'上海',status:'pending',sourceId:'source-4' },
];
let profile = { enabled:true,paused:false,facts:items.map(item=>({id:item.id,subjectId:item.target==='self'?null:subjectId,value:item.value,status:'pending'})) };
const initial = { ownerId:owner,subjectId,memory:{status:'pending',sourceCount:620,items} };
await build({
  stdin:{ contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ConversationMemoryReview} from './components/ConversationMemoryReview';const root=createRoot(document.getElementById('root'));window.renderMemory=props=>root.render(React.createElement(ConversationMemoryReview,props));window.renderMemory(${JSON.stringify(initial)});`,resolveDir:process.cwd(),loader:'tsx'},
  bundle:true,format:'iife',platform:'browser',outfile:path.join(output,'fixture.js'),minify:false,
  define:{'process.env.NODE_ENV':'"test"'},external:['/images/*'],logLevel:'silent',
});
const server=createServer(async (req,res)=>{
  try{
    if(req.url==='/fixture.js'||req.url==='/fixture.css'){res.writeHead(200,{'content-type':req.url.endsWith('.css')?'text/css':'application/javascript'});res.end(await readFile(path.join(output,req.url.slice(1))));return;}
    res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{font-family:system-ui;margin:20px;background:#fffaf5}*{box-sizing:border-box}#root{max-width:1100px;margin:auto}</style><div id="root"></div><script src="/fixture.js"></script></html>');
  }catch{res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox'],defaultViewport:{width:1280,height:900}});
const page=await browser.newPage(),calls=[],errors=[];
let failGet=false,failSave=false;
page.on('pageerror',error=>errors.push(error.message));
await page.setRequestInterception(true);
page.on('request',async request=>{
  if(!request.url().includes('/api/'))return request.continue();
  assert.equal(new URL(request.url()).pathname,'/api/web/profile','only existing profile endpoint is used');
  const body=request.method()==='POST'?JSON.parse(request.postData()):null;calls.push({method:request.method(),body});
  if((body&&failSave)||(!body&&failGet))return request.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'模拟网络暂不可用'})});
  if(body){assert.equal(body.expectedOwnerId,owner);if(body.action==='fact-decide-many'){for(const fact of profile.facts)if(body.ids.includes(fact.id))fact.status='accepted';}else if(body.action==='fact-decide'&&body.decision==='reject')profile.facts=profile.facts.filter(fact=>fact.id!==body.id);else assert.fail('unexpected mutation');}
  await request.respond({status:200,contentType:'application/json',body:JSON.stringify(profile)});
});
const clickText=async text=>page.$$eval('button',(buttons,text)=>buttons.find(button=>button.textContent.includes(text))?.click(),text);
const checked=()=>page.$$eval('[data-conversation-memory-row] input',inputs=>inputs.filter(input=>input.checked).map(input=>input.closest('[data-conversation-memory-row]').dataset.conversationMemoryRow));
const render=props=>page.evaluate(props=>window.renderMemory(props),props);
try{
  await page.goto(origin,{waitUntil:'networkidle0'});
  assert.equal(await page.$('[data-conversation-memory-row]'),null,'review remains compact by default');
  assert.match(await page.$eval('[data-conversation-memory]',el=>el.textContent),/620 条已导入文字/);
  await clickText('核对并保存');await page.waitForSelector('[data-conversation-memory-row] input:not(:disabled)');
  assert.deepEqual(await checked(),['self-statement','subject-statement'],'inference and conflicting statements are opt-in');
  assert.equal(calls.filter(call=>call.method==='POST').length,0,'opening never automatically accepts memory');
  assert.match(await page.$eval('[data-conversation-memory-row="subject-conflict"]',el=>el.textContent),/上海.*原资料不会被替换/);
  assert.equal(await page.$$eval('[data-conversation-memory-row] blockquote',items=>items.length),4,'every candidate carries its source quote');
  const readsBeforeReturn=calls.filter(call=>call.method==='GET').length;
  await page.evaluate(()=>{ const realNow=Date.now; Date.now=()=>realNow()+65_000; for(let i=0;i<6;i++){window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));} });
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(calls.filter(call=>call.method==='GET').length,readsBeforeReturn,'tab return never reloads the profile or interrupts the current selection');
  assert.deepEqual(await checked(),['self-statement','subject-statement']);
  await clickText('收起资料');await page.waitForFunction(()=>!document.querySelector('[data-conversation-memory-row]'));
  await clickText('核对并保存');await page.waitForSelector('[data-conversation-memory-row] input:not(:disabled)');
  assert.equal(calls.filter(call=>call.method==='GET').length,readsBeforeReturn+1,'explicitly reopening an older review checks the current facts once');
  await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
  await page.setViewport({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'mobile fits viewport');
  await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
  await clickText('保存选中的 2 条');await page.waitForFunction(()=>document.body.textContent.includes('已保存 2 条资料'));
  assert.deepEqual(calls.find(call=>call.method==='POST').body.ids,['self-statement','subject-statement']);
  assert.deepEqual(await checked(),[],'unconfirmed inference/conflict remain unchecked after save');
  await page.$eval('[data-conversation-memory-row="self-inference"] button[aria-label^="忽略"]',el=>el.click());
  await page.waitForFunction(()=>!document.querySelector('[data-conversation-memory-row="self-inference"]'));
  assert.match(await page.$eval('[data-conversation-memory]',el=>el.textContent),/关于我 0 条.*关于对方 1 条/);
  await page.reload({waitUntil:'networkidle0'});await clickText('核对并保存');
  assert.equal(await page.$('[data-conversation-memory-row="self-inference"]'),null,'deleted candidate is not revived by old report snapshot');
  assert.equal(await page.$$eval('[data-conversation-memory-row] input',items=>items.length),1,'accepted candidates are not offered for repeat confirmation');
  await page.click('[data-conversation-memory-row="subject-conflict"] input');failSave=true;
  await clickText('保存选中的 1 条');await page.waitForSelector('[role="alert"]');
  assert.match(await page.$eval('[role="alert"]',el=>el.textContent),/模拟网络/);
  failSave=false;await clickText('重新核对状态');await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));
  assert.deepEqual(await checked(),['subject-conflict'],'retry preserves explicit selection');
  await clickText('保存选中的 1 条');await page.waitForFunction(()=>document.body.textContent.includes('已保存 1 条资料'));
  profile.paused=true;await page.reload({waitUntil:'networkidle0'});
  assert.match(await page.$eval('[data-conversation-memory]',el=>el.textContent),/恢复档案/);
  assert.equal(await page.$('[data-conversation-memory-row]'),null,'paused profile has no actionable review');
  await render({...initial,memory:{status:'nothing_new',items:[]}});await page.waitForFunction(()=>!document.querySelector('[data-conversation-memory]'));
  failGet=true;profile.paused=false;await render(initial);await page.waitForSelector('[role="alert"]');
  await clickText('核对并保存');assert.equal(await page.$$eval('[data-conversation-memory-row] input',items=>items.every(item=>item.disabled)),true,'failed status lookup cannot accept stale candidates');
  failGet=false;profile.facts=items.map(item=>({id:item.id,subjectId:item.target==='self'?null:subjectId,value:item.value,status:'pending'}));
  profile.facts.find(item=>item.id==='self-statement').subjectId=subjectId;
  profile.facts.find(item=>item.id==='subject-statement').subjectId='another-person';
  await page.reload({waitUntil:'networkidle0'});await clickText('核对并保存');
  assert.equal(await page.$('[data-conversation-memory-row="self-statement"]'),null,'subject fact cannot be accepted as self information');
  assert.equal(await page.$('[data-conversation-memory-row="subject-statement"]'),null,'another person fact cannot be accepted for this person');
  assert.deepEqual(await checked(),[],'cross-target matches never become default selections');
  assert.deepEqual(errors,[]);
  const result={success:true,checks:['compact-first','speaker-separated','source-quote','statement-default-only','explicit-save','owner-guard','target-guard','reject','no-profile-reload-on-tab-return','refresh-on-explicit-review','refresh-current-status','preserve-selection-on-retry','paused-gate','empty-hidden','mobile-no-overflow'],postCount:calls.filter(call=>call.method==='POST').length};
  await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
