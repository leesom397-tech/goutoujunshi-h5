// Actual ChatPage, account store, api(), restore/persistence and AnswerScope.
// Every network response is a synthetic fixture; no remote account/model calls.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
const owner='11111111-1111-4111-8111-111111111111',person='22222222-2222-4222-8222-222222222222',otherPerson='44444444-4444-4444-8444-444444444444';
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import ChatPage from './app/chat/page';import{webAccountStore,announceAccountChange}from'./lib/web-account-session';
window.fixtureOwner=sessionStorage.getItem('fixture-owner')||'${owner}';window.posts=[];window.pending=[];window.responseMode='ready';
window.coverage={scope:'all',status:'ready',total:3,included:2,omitted:1,subjects:[{id:'${person}',label:'合成甲',status:'details',reportCount:2,memoryCount:3,chatCount:40},{id:'${otherPerson}',label:'合成乙',status:'summary',reportCount:1,memoryCount:0,chatCount:12}],sources:[{id:'source-1',subjectId:'${person}',label:'合成甲的报告摘要',kind:'report',sourceId:'source-1'}],limitations:['合成丙的资料尚不可用。']};
window.fetch=async(path,options={})=>{const url=new URL(String(path),location.href);
 if(url.pathname==='/api/web/text'){const body=JSON.parse(options.body);window.posts.push(body);const result={possibleIntent:'综合回答已经返回',nextStep:'本次具体下一步',replies:[],...(body.contextScope==='all'?{peopleCoverage:window.coverage}:{})};
  if(window.responseMode==='hold')return new Promise(resolve=>window.pending.push(()=>resolve(Response.json(result))));
  if(window.responseMode==='fail')return Response.json({error:'合成网络故障'},{status:503});
  if(window.responseMode==='empty')return Response.json({peopleCoverage:{...window.coverage,status:'empty',total:0,included:0,omitted:0,subjects:[],sources:[],limitations:[]},charged:false});
  if(['paused','disabled','too-large','changed'].includes(window.responseMode))return Response.json({error:'资料暂不可用',charged:false,peopleCoverage:{...window.coverage,status:window.responseMode,included:0,subjects:[],sources:[]}},{status:409});
  return Response.json(result);}
 if(options.method&&options.method!=='GET')throw Error('unexpected write '+url.pathname);
 if(['/api/account/credits','/api/web/account-context'].includes(url.pathname))return Response.json({account:{userId:window.fixtureOwner,balance:100,active:true,features:['chat','analysis']},prices:{text:5,transcription:5},people:[{id:'${person}',label:'合成甲'},{id:'${otherPerson}',label:'合成乙'}]});
 if(url.pathname==='/api/auth/session')return Response.json({loggedIn:true,user:{id:window.fixtureOwner}});
 throw Error('unexpected endpoint '+url.pathname);};
window.changeOwner=async owner=>{window.fixtureOwner=owner;sessionStorage.setItem('fixture-owner',owner);announceAccountChange();await webAccountStore.refresh();};
createRoot(document.getElementById('root')).render(<ChatPage/>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:resolve('desktop/app/frontend/navigation.tsx')}));
 b.onLoad({filter:/components[\\/]WebNav\.tsx$/},()=>({loader:'tsx',contents:'export function WebNav(){return null;}'}));
 b.onLoad({filter:/\.css$/},()=>({loader:'js',contents:'export default new Proxy({},{get:(_,key)=>String(key)});'}));
}}]});
const server=createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><div id="root"></div><script>'+bundle.outputFiles[0].text+'</script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
const input='.wa-composer>label.wa-field textarea[maxlength="1500"]',consent='.wa-composer>label.wa-check input',send='.wa-composer .wa-actions button.wa-primary';
const ready=async()=>{await page.waitForFunction(()=>document.querySelector('#chat-active-person')&&!document.querySelector('#chat-active-person').disabled);};
const fill=async(text='结合我已保存的几个人，应该怎么选择下一步？')=>{await page.$eval(input,(el,text)=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));},text);};
const submit=async()=>{if(!await page.$eval(consent,el=>el.checked))await page.click(consent);await page.click(send);};
const fresh=async(query='')=>{await page.goto(origin+'/chat');await page.evaluate(()=>{sessionStorage.clear();localStorage.clear();});await page.goto(origin+'/chat'+query);await ready();};
try{
 await fresh();assert.equal(await page.$eval('#chat-active-person',el=>el.value),'all');assert.match(await page.$eval('[aria-label="咨询范围"]',el=>el.textContent),/全部人物 · 整体咨询/);
 await fill();await submit();await page.waitForSelector('[data-people-coverage="ready"]');let posts=await page.evaluate(()=>window.posts);assert.equal(posts[0].contextScope,'all');assert.equal(posts[0].subjectId,null);
 await page.click('.chat-people-coverage>summary');assert.match(await page.$eval('.chat-people-coverage',el=>el.innerText),/2 \/ 3 位人物/);assert.match(await page.$eval('.chat-people-coverage',el=>el.innerText),/本次未包含 1 位/);assert.match(await page.$eval('.chat-people-coverage',el=>el.innerText),/摘要/);assert.doesNotMatch(await page.$eval('.chat-people-coverage',el=>el.innerText),/已读取全部原文/);
 await page.reload();await ready();await page.waitForSelector('[data-people-coverage="ready"]');assert.equal(await page.$eval('#chat-active-person',el=>el.value),'all','successful answer and actual coverage restore together');
 await fill('未发送的问题要保留');await page.select('#chat-active-person',person);assert.equal(await page.$eval(input,el=>el.value),'未发送的问题要保留');assert.equal(await page.$('.wa-chat-message'),null);assert.equal(await page.$eval(consent,el=>el.checked),false);
 await submit();await page.waitForSelector('.wa-chat-message[data-role="assistant"]');posts=await page.evaluate(()=>window.posts);assert.equal(posts.at(-1).subjectId,person);assert.equal(posts.at(-1).contextScope,undefined);assert.deepEqual(posts.at(-1).history,[]);assert.equal(posts.at(-1).opening,'');
 await page.select('#chat-active-person','none');await fill();await submit();await page.waitForSelector('.wa-chat-message[data-role="assistant"]');posts=await page.evaluate(()=>window.posts);assert.equal(posts.at(-1).subjectId,null);assert.equal(posts.at(-1).contextScope,undefined);

 // Reload a failed all-people request and recover exactly its original identity.
 await fresh();await fill();await page.evaluate(()=>window.responseMode='fail');await submit();await page.waitForFunction(()=>document.body.textContent.includes('重试本次提问'));const failed=await page.evaluate(()=>window.posts[0]);await page.reload();await ready();assert.equal(await page.$eval('#chat-active-person',el=>el.value),'all');await submit();await page.waitForSelector('[data-people-coverage="ready"]');assert.deepEqual(await page.evaluate(()=>window.posts[0]),failed);
 await fresh();await fill();await page.evaluate(()=>window.responseMode='fail');await submit();await page.waitForFunction(()=>document.body.textContent.includes('重试本次提问'));const oldRequest=await page.evaluate(()=>window.posts[0].requestId);await page.select('#chat-active-person','none');await page.evaluate(()=>window.responseMode='ready');await submit();await page.waitForSelector('.wa-chat-message[data-role="assistant"]');posts=await page.evaluate(()=>window.posts);assert.notEqual(posts.at(-1).requestId,oldRequest,'changing scope never reuses a paid request identity');assert.equal(posts.at(-1).contextScope,undefined);

 // An old unscoped draft is not reinterpreted as authorization for all people.
 await fresh();await page.evaluate(owner=>sessionStorage.setItem('chengzi-chat:'+owner,JSON.stringify({owner,subject:'',mode:'conversation',draft:'以前只聊自己的草稿',messages:[],contextKey:''})),owner);await page.reload();await ready();assert.equal(await page.$eval('#chat-active-person',el=>el.value),'none');assert.equal(await page.$eval(input,el=>el.value),'以前只聊自己的草稿');

 // Report and capture handoffs always stay on their person, even after all mode.
 for(const kind of ['report','capture']){
  await fresh();await fill('原整体草稿');const key='55555555-5555-4555-8555-555555555555';
  await page.evaluate(({owner,person,key,kind})=>{if(kind==='report')sessionStorage.setItem('web-followup:'+key,JSON.stringify({accountId:owner,subjectId:person,expiresAt:Date.now()+60000,title:'合成人物报告',summary:'单人报告摘要',question:'这位人物下一步怎么办？'}));else sessionStorage.setItem('chengzi-capture-question:'+owner+':'+key,JSON.stringify({version:1,key,owner,subjectId:person,friend:'合成甲',scope:'selected',records:[{speaker:'other',text:'仅这位人物的原话'}],omitted:0,expiresAt:Date.now()+60000,state:'pending'}));},{owner,person,key,kind});
  await page.goto(origin+'/chat?'+(kind==='report'?'context':'capture')+'='+key);await ready();assert.equal(await page.$eval('#chat-active-person',el=>el.value),person);await fill();await submit();await page.waitForSelector('.wa-chat-message[data-role="assistant"]');posts=await page.evaluate(()=>window.posts);assert.equal(posts[0].contextScope,undefined);assert.equal(posts[0].subjectId,person);assert.ok(posts[0].history.some(row=>row.content.includes(kind==='report'?'单人报告摘要':'仅这位人物的原话')));
  if(kind==='report')await page.click('details.reportPerson>summary');await page.select('#chat-active-person','all');await fill('重新整体比较几位人物');await submit();await page.waitForSelector('[data-people-coverage="ready"]');posts=await page.evaluate(()=>window.posts);assert.equal(posts.at(-1).contextScope,'all');assert.equal(posts.at(-1).subjectId,null);assert.deepEqual(posts.at(-1).history,[],'switching out of a handoff removes its report or quote context');assert.equal(posts.at(-1).opening,'');
 }
 for(const status of ['empty','paused','disabled','too-large','changed']){
  await fresh();await fill();await page.evaluate(status=>window.responseMode=status,status);await submit();await page.waitForSelector('[data-people-coverage="'+status+'"]');assert.equal(await page.$('.wa-chat-message[data-role="assistant"]'),null);assert.match(await page.$eval('.chat-people-coverage',el=>el.innerText),/未扣咨询积分/);assert.doesNotMatch(await page.$eval(send,el=>el.textContent),/重试本次/);assert.ok(await page.$eval(input,el=>el.value.length>0));
 }
 // Paid request results may arrive after account change; never render/store them.
 await fresh();await fill();await page.evaluate(()=>window.responseMode='hold');await submit();await page.waitForFunction(()=>window.pending.length===1);await page.evaluate(()=>window.changeOwner('owner-B'));await ready();await page.evaluate(()=>window.pending.splice(0).forEach(resolve=>resolve()));assert.equal(await page.$('.wa-chat-message'),null);assert.equal(await page.$eval(input,el=>el.value),'');assert.equal(await page.$eval('#chat-active-person',el=>el.value),'all');
 for(const preset of ['reply','needs']){await fresh('?preset='+preset);await fill();if(preset==='reply')await page.$eval('.wa-composer>label.wa-field:first-of-type textarea',el=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'周末有空吗');el.dispatchEvent(new Event('input',{bubbles:true}));});await submit();await page.waitForSelector('[data-people-coverage="ready"]');posts=await page.evaluate(()=>window.posts);assert.equal(posts[0].contextScope,'all');assert.equal(posts[0].mode,preset==='reply'?'chat':'positioning');}
 assert.deepEqual(errors,[]);console.log('PASS actual ChatPage: default all, exact request scope, source coverage, safe switching, legacy and failed-request restore, handoff isolation, free unavailable states, account-change race, all-mode presets.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
