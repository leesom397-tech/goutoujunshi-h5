import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const owner='synthetic-guided-owner',subject='11111111-1111-4111-8111-111111111111';
const contactSubject='33333333-3333-4333-8333-333333333333',accountKey='a'.repeat(64);let contactCreated=false;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGkAAAAASUVORK5CYII=';
const output=process.env.QA_OUTPUT||'D:/Temp/chengzi-flow-qa';await mkdir(output,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox'],userDataDir:output+'/capture-browser',defaultViewport:{width:1366,height:900}});
const context=await browser.createBrowserContext(),page=await context.newPage(),calls=[],errors=[];
let connected=false,jobPolls=0,remoteInfo=null;const remoteRows=new Map();
page.on('pageerror',e=>errors.push(e.message));
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Private-Network':'true'};
const posts=Array.from({length:2003},(_,i)=>({id:'moment-'+i,kind:'post',sender:'小欣（同事）',senderRole:'other',at:'2026-10-01',text:'合成动态 '+i,source:{label:'合成朋友圈',method:'uia'}}));
const batch={version:1,kind:'moments',friend:'小欣（同事）',account:'synthetic-wx',capturedAt:'2026-10-18T00:00:00Z',records:posts,warnings:[],coverage:{scope:'all-visible',complete:true,stopReason:'visible-end',recordCount:2003,imageOmittedCount:0,unreadableCount:0}};
await page.setRequestInterception(true);
page.on('request',async r=>{
  const u=new URL(r.url());let value={},status=200;
  if(u.port==='17863'){
    if(r.method()==='OPTIONS'){}
    else if(u.pathname==='/session')value={connected};
    else if(u.pathname==='/health')value={version:'1.2.5',ready:true,capabilities:{chat:true,moments:true,momentsAllVisible:true,momentsContacts:true,backgroundChat:true,backgroundHistory:true}};
    else if(u.pathname==='/pair'){connected=true;value={token:'synthetic-token',expiresIn:28800};}
    else if(u.pathname==='/contacts/search')value={accountKey,contacts:[{contactId:'wxid_internal_a',label:'小欣（同学）',nickname:'小欣',remark:'小欣（同学）',wechatId:'xiaoxin_school',avatarData:'data:image/png;base64,'+png},{contactId:'wxid_internal_b',label:'小欣（同事）',nickname:'小欣',remark:'小欣（同事）',wechatId:'xiaoxin_work',avatarData:'data:image/png;base64,'+png},{contactId:'wxid_internal_c',label:'小欣',nickname:'小欣',remark:''}]};
    else if(u.pathname==='/capture'){calls.push(JSON.parse(r.postData()));value={jobId:'synthetic-moments'};}
    else if(u.pathname.startsWith('/jobs/')){jobPolls++;value=jobPolls===1?{status:'running',message:'已读取 1001 条',partial:{...batch,records:posts.slice(0,1001),coverage:{...batch.coverage,complete:false,stopReason:'scanning',recordCount:1001}},partialRevision:1}:{status:'done',result:batch};}
    else throw Error('unexpected bridge '+u.pathname);
  }else if(r.url().startsWith(origin+'/api/')){
    if(r.method()!=='GET')calls.push({path:u.pathname,body:JSON.parse(r.postData()||'{}')});
    if(u.pathname==='/api/auth/session')value={loggedIn:true};
    else if(u.pathname==='/api/account/credits')value={account:{userId:owner,balance:100},prices:{analysisSmall:3,profile:5}};
    else if(u.pathname==='/api/web/profile')value={enabled:true,paused:false,subjects:[{id:subject,label:'合成人物'},...(contactCreated?[{id:contactSubject,label:'小欣（同事）'}]:[])]};
    else if(u.pathname==='/api/web/capture/subject'){const body=JSON.parse(r.postData());assert.equal(body.contact.contactId,'wxid_internal_b');assert.equal(body.contact.accountKey,accountKey);assert.equal(body.confirmed,true);assert.equal(body.consent,true);contactCreated=true;value={subjectId:contactSubject,created:true,label:'小欣（同事）',avatar:'data:image/png;base64,'+png};}
    else if(u.pathname==='/api/web/capture/library'){
      if(r.method()==='POST'){
        const body=JSON.parse(r.postData());
        assert.equal(body.action,'sync');
        for(const row of body.records)remoteRows.set(row.localId,row);
        remoteInfo={...body.library,id:'cl_'+'a'.repeat(64),epoch:1,revision:1,total:remoteRows.size,reportLinks:[],warnings:[],deleted:false};
        value={ownerId:owner,library:remoteInfo};
      }else value={ownerId:owner,libraries:remoteInfo?[remoteInfo]:[]};
    }
    else if(u.pathname==='/api/web/report/list')value={reports:[]};
  }else return r.continue();
  await r.respond({status,contentType:'application/json',headers,body:JSON.stringify(value)});
});
const contains=async text=>page.waitForFunction(text=>document.body.innerText.includes(text),{timeout:45000},text);
const click=async text=>{assert.equal(await page.evaluate(text=>{const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===text);if(!el||el.disabled)return false;el.click();return true;},text),true,'enabled button '+text);};
try{
  await page.goto(origin+'/capture?method=desktop&kind=moments',{waitUntil:'networkidle0',timeout:90000});
  await contains('下载 Windows 助手');
  assert.equal(await page.$('input[placeholder="输入好友的备注或昵称"]'),null,'contact selection waits for connection');
  await page.screenshot({path:output+'/connect-desktop.png',fullPage:true});
  await page.evaluate(()=>document.querySelector('#capture-code').closest('details').open=true);
  await page.type('#capture-code','ABCDEFGH');await click('连接');await contains('助手已连接');
  await page.type('input[placeholder="输入好友的备注或昵称"]','小欣');await contains('微信号：xiaoxin_work');
  const candidates=await page.$eval('[aria-label="选择要导入的微信联系人"]',e=>({text:e.innerText,images:e.querySelectorAll('img').length}));
  assert.equal(candidates.images,2);assert.doesNotMatch(candidates.text,/wxid_internal|识别码/);assert.match(candidates.text,/未读取到微信号/);
  await page.evaluate(()=>[...document.querySelectorAll('[aria-label="选择要导入的微信联系人"] button')].find(e=>e.textContent.includes('xiaoxin_work')).click());
  await contains('导入全部可见朋友圈');
  const layout=await page.$eval('aside[aria-label="导入操作"]',e=>({width:e.clientWidth,scroll:getComputedStyle(e.firstElementChild).overflowY}));
  assert.ok(layout.width>900,'operations occupy available desktop width');assert.notEqual(layout.scroll,'auto','no scroll trap around controls');
  await page.screenshot({path:output+'/contact-desktop.png',fullPage:true});
  await page.setViewport({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile has no horizontal scroll');
  await page.screenshot({path:output+'/contact-mobile.png',fullPage:true});
  await click('导入全部可见朋友圈');await contains('这份材料共保存');await contains('2003');
  const captureCall=calls.find(row=>row.kind==='moments');assert.equal(captureCall.allVisible,true);assert.equal(captureCall.contactId,'wxid_internal_b');assert.equal(captureCall.accountKey,accountKey);assert.equal(contactCreated,true);assert.equal(await page.$('dialog[open]'),null,'automatic contact profile never opens avatar choice');
  await page.waitForFunction(()=>!document.body.textContent.includes('已读取 1001 条'));
  await click('导入情况与同步');await contains('已采集到可见末尾');
  assert.equal(calls.filter(x=>x.path?.includes('analyze')).length,0,'capture never silently analyzes or charges');
  const bundle=await build({entryPoints:['lib/desktop-capture-vault.ts'],bundle:true,write:false,format:'iife',globalName:'vault',platform:'browser'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const persisted=await page.evaluate(async owner=>{const rows=await vault.listCaptureLibraries(owner);return{total:rows[0].total,coverage:rows[0].coverage};},owner);
  assert.equal(persisted.total,2003);assert.equal(persisted.coverage.complete,true);
  await page.evaluate(async({owner,subject})=>{const batch={version:1,kind:'chat',friend:'合成人物',account:'synthetic-wx',capturedAt:'2026-10-18T00:00:00Z',warnings:[],records:Array.from({length:675},(_,i)=>({id:String(i),kind:'text',sender:i%2?'合成人物':'我',senderRole:i%2?'other':'self',at:new Date(Date.UTC(2026,9,1,0,i)).toISOString(),text:'合成消息 '+i,source:{label:'合成聊天',method:'wechat-local-db'}}))};const result=await vault.saveCaptureBatch(owner,batch);localStorage.setItem('chengzi-intake:v1:'+JSON.stringify([owner,'library',result.library.id]),JSON.stringify({subjectId:subject}));}, {owner,subject});
  await page.setViewport({width:1366,height:900});await page.goto(origin+'/capture?method=library&kind=chat',{waitUntil:'networkidle0'});
  await contains('合成人物');await page.evaluate(()=>[...document.querySelectorAll('details button')].find(e=>e.textContent.includes('合成人物')).click());
  await contains('生成完整关系报告');
  assert.equal(await page.$eval('#capture-originals',e=>e.getBoundingClientRect().height),0,'raw history is opt-in, not a long list before the action');
  await page.screenshot({path:output+'/report-ready-desktop.png',fullPage:true});
  assert.doesNotMatch(await page.$eval('#capture-originals',e=>e.textContent),/最近待分析|已选 40/);
  assert.equal(await page.$$eval('#capture-originals input[type=checkbox]',e=>e.length),0,'full chat has no misleading subset checkboxes');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.includes('生成完整关系报告')).click());
  await contains('确认材料与费用');assert.match(await page.$eval('#capture-confirm',e=>e.innerText),/全部 675 条聊天/);
  assert.equal(await page.$eval('[aria-label="导入操作"]',e=>e.getBoundingClientRect().height),0,'confirmation replaces earlier operations');
  assert.match(await page.$eval('#capture-person',e=>e.innerText),/报告归入「合成人物」的档案/);assert.equal(await page.$('#capture-person input'),null,'confirmation never asks to manually create this imported person');
  await page.screenshot({path:output+'/report-confirm-desktop.png',fullPage:true});
  await page.setViewport({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>document.querySelector('#capture-confirm').scrollIntoView());await page.screenshot({path:output+'/report-confirm-mobile.png'});
  await page.click('[aria-label="返回报告准备"]');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.includes('基于全部聊天提问')).click());
  await page.waitForFunction(()=>location.pathname==='/chat');
  const handoff=await page.evaluate(owner=>{const key=Object.keys(sessionStorage).find(k=>k.startsWith('chengzi-capture-question:'+owner+':'));return JSON.parse(sessionStorage.getItem(key));},owner);
  assert.equal(handoff.scope,'full-history');assert.equal(handoff.historyCount,675);
  assert.equal(remoteRows.size,675,'asking first syncs every message to the selected person');assert.equal(remoteInfo.subjectId,subject);
  assert.deepEqual(errors,[]);
  console.log('PASS guided intake: connection gating, human-readable identity+avatars, 2003 moments with partial-save coverage, desktop/mobile single column, 675-record report confirmation and full-history question handoff; all APIs and WeChat mocked.');
}finally{await context.close();await browser.close();}
