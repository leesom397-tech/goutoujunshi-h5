import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798',out='outputs/relationship-entry-speed';
await mkdir(out,{recursive:true});
const bundled=await build({stdin:{contents:`import * as vault from './lib/desktop-capture-vault';window.QAVault=vault;`,loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife'});
const owner='entry-speed-a',reportId='11111111-1111-4111-8111-111111111111';
const cloud={id:'cl_'+'a'.repeat(64),account:'synthetic-wx',friend:'合成测试好友',kind:'chat',epoch:1,total:75,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-20T00:00:00Z',warnings:[],reportLinks:[{reportId,sourceIds:['source-0'],createdAt:'2026-10-20T00:00:00Z'}]};
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
try{for(const width of [1440,390,320]){
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],writes=[],held=[];
 let hold=true,currentOwner=owner,accountReads=0;
 await page.setViewport({width,height:950});
 await page.evaluateOnNewDocument(mobile=>Object.defineProperty(navigator,'platform',{get:()=>mobile?'iPhone':'Win32'}),width<700);
 page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
 const reply=(r,data)=>r.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
 page.on('request',async r=>{const u=new URL(r.url());if(!u.pathname.startsWith('/api/'))return r.continue();if(r.method()!=='GET')writes.push(u.pathname);
   if(u.pathname==='/api/web/account-context'){accountReads++;return reply(r,{account:{userId:currentOwner,balance:100,active:true},prices:{},people:[]});}
   if(u.pathname==='/api/web/capture/analyze')return reply(r,{status:'none'});
   if(u.pathname==='/api/web/capture/library'){const data={ownerId:currentOwner,libraries:currentOwner===owner?[cloud]:[]};if(hold){held.push({r,data});return;}return reply(r,data);}
   return reply(r,{});
 });
 try{
   await page.goto(origin+'/support',{waitUntil:'networkidle0'});await page.addScriptTag({content:bundled.outputFiles[0].text});
   await page.evaluate(async({owner,cloud})=>{await QAVault.cacheCloudCaptureLibrary(owner,{...cloud,records:Array.from({length:75},(_,i)=>({localId:'source-'+i,kind:'text',sender:'我',senderRole:'self',text:'合成原文'+i,source:{label:'合成数据'},firstCapturedAt:cloud.createdAt,lastCapturedAt:cloud.updatedAt})),cloud:{id:cloud.id,epoch:1,enabled:true,total:75,syncedAt:cloud.updatedAt}});},{owner,cloud});
   await page.goto(origin+'/relationship',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('[data-person-entry]')?.textContent.includes('75 条聊天'));
   assert.equal(held.length,1,'cloud request remains pending while the local person is already usable');
   const primary=await page.$eval('nav[aria-label="开始分析"] a',e=>({href:e.getAttribute('href'),text:e.innerText}));
   assert.match(primary.href,width<700?/^\/analyze\?mode=chat/:/^\/capture/);
   if(width<700)assert.equal(await page.$('[aria-label="微信助手下载"] a[download]'),null,'phone does not promote Windows exe as its primary next step');
   const href=await page.$eval('[data-person-entry]>a',e=>e.getAttribute('href'));
   assert.equal(new URL(href,origin).searchParams.get('returnTo'),'/relationship','report can return to the source screen');
   hold=false;for(const item of held.splice(0))await reply(item.r,item.data);
   await page.waitForFunction(()=>!document.querySelector('button[aria-label="刷新已保存的人物"]').disabled);
   await page.type('input[aria-label="搜索已保存的人物"]','合成');hold=true;
   await page.$eval('button[aria-label="刷新已保存的人物"]',e=>e.scrollIntoView({behavior:'instant',block:'center'}));
   assert.ok(await page.$eval('button[aria-label="刷新已保存的人物"]',e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'refresh button is not obscured by navigation');
   await page.click('button[aria-label="刷新已保存的人物"]');
   await page.waitForFunction(()=>document.querySelector('button[aria-label="刷新已保存的人物"]').disabled);
   assert.equal(await page.$$eval('[data-person-entry]',es=>es.length),1,'refresh never blanks existing cards');
   assert.equal(await page.$eval('input[aria-label="搜索已保存的人物"]',e=>e.value),'合成','refresh retains search');
   await page.waitForFunction(()=>document.querySelector('[data-account-state="ready"]'));
   assert.ok(accountReads>=2,'explicit refresh also refreshes screenshot-only people and report summaries');
   assert.ok(await page.$eval('[data-person-entry]>a',e=>e.checkVisibility()),'report stays usable during refresh');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'fits viewport');
   await page.screenshot({path:`${out}/entry-${width}.png`,fullPage:true});
   // Change identity while the old cloud read is still pending.
   currentOwner='entry-speed-b';hold=false;
   await page.evaluate(()=>window.dispatchEvent(new CustomEvent('chengzi:account-changed',{detail:{revision:crypto.randomUUID()}})));
   await page.waitForFunction(()=>document.body.innerText.includes('还没有保存人物'));
   for(const item of held.splice(0))await reply(item.r,item.data);
   await page.waitForFunction(()=>!document.querySelector('button[aria-label="刷新已保存的人物"]').disabled);
   assert.equal(await page.$$eval('[data-person-entry]',es=>es.length),0,'late old-account material cannot reappear');
   assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
   console.log(`PASS ${width}: local preview before cloud, preserved refresh/search, correct device entry, report return, owner switch isolation`);
 }finally{for(const item of held.splice(0))await reply(item.r,item.data).catch(()=>{});await context.close();}
}}finally{await browser.close();}
