import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const module=await build({stdin:{contents:'export {computeChatActivity} from "./lib/chat-activity"; export {projectRelationshipContext} from "./lib/relationship-context";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const {computeChatActivity,projectRelationshipContext}=await import('data:text/javascript;base64,'+Buffer.from(module.outputFiles[0].text).toString('base64'));
const owner='journey-owner',person='journey-person',other='unrelated-person',reportId='11111111-2222-4333-8444-555555555555';
const records=Array.from({length:90},(_,i)=>({id:'source-'+i,localId:'source-'+i,kind:'text',text:'合成测试聊天',senderRole:i%2?'other':'self',at:`2026-10-${String(1+Math.floor(i/10)).padStart(2,'0')}T${String(10+i%10).padStart(2,'0')}:00:00+08:00`,source:{method:'wechat-local-db',idStability:'stable',accountId:'wx-test',sessionId:'session-test',messageShard:'test',messageId:String(i),timestampOrigin:'wechat-create-time'}}));
const activity=computeChatActivity(records),judgment='愿意协商具体安排，见面结果仍待核对。';
const reports=[{id:reportId,owner_id:owner,subject_id:person,kind:'chat',status:'done',created_at:Date.UTC(2026,9,18),result:{subjectId:person,analysisScope:'fullHistory',chatActivity:activity,semanticHistory:{findings:[{id:'f1',claim:'双方约定见面时间',evidence:[{sourceId:'source-0',at:'2026-10-01',senderRole:'self',quote:'我周六两点可以。self is part of this quote.'},{sourceId:'source-1',at:'2026-10-01',senderRole:'other',quote:'好，到时见。'}]},{id:'f2',claim:'表达了需要但日期待确认',evidence:[{sourceId:'source-11',at:'昨天',senderRole:'other',quote:'有变化我们提前沟通。'}]}]}}},{id:'moments-report',owner_id:owner,subject_id:person,kind:'moments',status:'done',created_at:Date.UTC(2026,9,18),result:{moments:{posts:[{sourceId:'post-1',date:'2026-10-03',content:'周末在山里走了走。'}]}}},{id:'foreign-report',owner_id:owner,subject_id:other,kind:'chat',status:'done',created_at:Date.UTC(2026,9,18),result:{lines:[{id:'foreign-line',speaker:'other',sourceAt:'2026-10-01',text:'其他人物的私密约会不应出现'}]}}];
const relationshipContext=projectRelationshipContext({ownerId:owner,subjectId:person,reports,activity,activityStatus:'current'});
const missing=projectRelationshipContext({ownerId:owner,subjectId:'empty-person',reports:[]});
const state={enabled:true,paused:false,self:{city:'杭州',values:'认真沟通',preferredRelationship:'稳定关系'},subjects:[{id:person,label:'测试人物',updatedAt:Date.now(),city:'杭州',values:'提前沟通',relationshipContext,savedChatAnalysis:{reportId,createdAt:Date.now(),summary:judgment,diagnosis:{relationship:{currentState:judgment},decision:{recommendation:'确认具体地点，观察能否按约落实。'}}}},{id:'empty-person',label:'未有材料的人物',updatedAt:Date.now(),relationshipContext:missing}],facts:[],signals:[],trends:[]};
await mkdir('outputs/report-reading',{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
try{
 for(const width of [1440,390]){
  const context=await browser.createBrowserContext(),page=await context.newPage(),writes=[],errors=[],reads=[];
  await page.setViewport({width,height:950});page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',r=>{const u=new URL(r.url());if(!u.pathname.startsWith('/api/'))return r.continue();if(r.method()!=='GET')writes.push(u.pathname);else reads.push(u.pathname+u.search);let body={};if(u.pathname==='/api/auth/session')body={loggedIn:true,user:{id:owner}};if(u.pathname==='/api/account/credits')body={account:{userId:owner,balance:1000,active:true},prices:{}};if(['/api/profile','/api/web/profile'].includes(u.pathname))body=state;if(u.pathname==='/api/web/relationship-feedback')body={subjectId:person,cards:[],events:[],automatic:null};return r.respond({status:200,contentType:'application/json',body:JSON.stringify(body)});});
  await page.goto(origin+'/archive?subjectId='+person,{waitUntil:'networkidle0'});
  await page.waitForSelector('[data-relationship-snapshot]');
  assert.ok(reads.includes('/api/web/profile?subjectId='+person),'selected person requests current all-history statistics');
  assert.equal((await page.$eval('body',e=>e.innerText)).split(judgment).length-1,1,'current judgment rendered once');
  assert.match(await page.$eval('[data-relationship-snapshot]',e=>e.textContent),/90 条/);
  await page.screenshot({path:`outputs/report-reading/archive-current-${width}.png`,fullPage:true});
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='历程').click());
  await page.waitForSelector('[data-relationship-activity-chart]');
  assert.equal(await page.$$eval('[aria-label="双方按日期的消息数量"] button',e=>e.length),9,'nine actual chat dates');
  assert.doesNotMatch(await page.$eval('[data-relationship-journey]',e=>e.innerText),/其他人物的私密约会/,'person isolation');
  await page.$eval('[aria-label="双方按日期的消息数量"] button',e=>e.click());
  assert.match(await page.$eval('[data-relationship-journey]',e=>e.innerText),/我 5 条 · 对方 5 条/);
  assert.equal(await page.$$eval('[data-journey-event]',e=>e.length),1,'date filters events');
  await page.$eval('[data-journey-event] button',e=>e.click());await page.waitForSelector('dialog[open]');
  const detail=await page.$eval('dialog[open]',e=>e.innerText);assert.match(detail,/我周六两点可以。self is part of this quote./);assert.match(detail,/好，到时见。/);assert.doesNotMatch(detail,/other|unknown/,'speaker labels translated');
  assert.ok((await page.$$eval('dialog[open] a',e=>e.map(a=>a.getAttribute('href')))).includes('/report?id='+reportId),'source links to report');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  await page.evaluate(()=>[...document.querySelectorAll('[data-relationship-journey] button')].find(e=>e.textContent==='查看完整历程').click());
  assert.equal(await page.$$eval('[data-journey-event]',e=>e.length),2,'chat and moments in same dated history');
  await page.evaluate(()=>[...document.querySelectorAll('[aria-label="时间线日期范围"] button')].find(e=>e.textContent.includes('日期待确认')).click());
  assert.match(await page.$eval('[data-journey-event]',e=>e.innerText),/日期待确认/);assert.doesNotMatch(await page.$eval('[data-journey-event]',e=>e.innerText),/2026-10-18/,'upload date is never event date');
  await page.evaluate(()=>[...document.querySelectorAll('[aria-label="时间线日期范围"] button')].find(e=>e.textContent.includes('日期已知')).click());
  await page.screenshot({path:`outputs/report-reading/archive-journey-${width}.png`,fullPage:true});
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='双方资料').click());
  assert.match(await page.$eval('body',e=>e.innerText),/我们之间/);assert.match(await page.$eval('body',e=>e.innerText),/稳定关系/);assert.equal(await page.$('[data-relationship-journey]'),null);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'fits viewport');
  await page.screenshot({path:`outputs/report-reading/archive-profiles-${width}.png`,fullPage:true});
  await page.goto(origin+'/archive?subjectId=empty-person&section=trend',{waitUntil:'networkidle0'});
  await page.waitForSelector('[data-relationship-journey]');assert.equal(await page.$('[data-relationship-activity-chart]'),null,'no empty decorative chart');
  assert.ok(await page.$eval('[data-relationship-journey]',e=>e.getBoundingClientRect().height<480),'missing data is compact');
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'reading is free and read-only');
  console.log(`PASS ${width}: current all-history stats, dated two-person bars, date filter, original sources, unknown dates, cross-source history, person isolation, three sections, compact missing-data state`);
  await context.close();
 }
}finally{await browser.close();}
