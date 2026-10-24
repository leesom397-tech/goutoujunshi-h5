// Real React DOM + production projection; source/API boundaries are synthetic.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import puppeteer from 'puppeteer-core';

const entry=`import React from 'react';import{createRoot}from'react-dom/client';
import{ReplyAttentionOverview}from'./components/web-analysis/ReplyAttentionOverview';
import{computeReplyAttention}from'./lib/reply-attention';
const root=createRoot(document.getElementById('app'));
const row=(id,role,text,minute,source={})=>({localId:id,kind:'text',senderRole:role,text,at:'2026-10-24T10:'+String(minute).padStart(2,'0')+':00+08:00',source});
window.readyRows=[row('q','self','周六一起吃饭吗？',0),row('a','other','可以',1)];
window.emptyRows=[row('q','self','早上好',0),row('a','other','早上好',1)];
window.ready=computeReplyAttention(window.readyRows,{scope:'full-history'});
window.insufficient=computeReplyAttention(window.emptyRows,{scope:'full-history'});
window.baseReport={reportId:'report-A',analysisScope:'fullHistory',archiveSnapshot:{libraryId:'cloud-A',epoch:1,total:2},semanticHistory:{replyAttention:{...window.ready,rulesVersion:2}}};
window.oral=computeReplyAttention([...window.readyRows,row('invite','self','啥时候有空我带你去公园，就上次拍照那个地方。',2)],{scope:'full-history'});
window.currentOwner='owner-A';window.localMode=new URL(location.href).searchParams.get('local')||'none';window.cloudMode=new URL(location.href).searchParams.get('cloud')||'ready';
window.calls=[];window.localCalls=[];window.pending=[];window.localPending=[];
window.readSources=async(owner,id)=>{window.localCalls.push({owner,id});if(window.localMode==='hold')await new Promise(resolve=>window.localPending.push(resolve));if(window.localMode==='error')throw Error('blocked IDB');return window.localMode==='none'?null:{kind:'chat',libraryId:'local-A'};};
window.readLibrary=async(owner,id)=>{let records=window.localMode==='insufficient'?window.emptyRows:window.readyRows;
if(window.localMode==='mixed')records=records.map((r,i)=>({...r,source:{sessionId:i?'session-B':'session-A',accountId:'wx-A'}}));
if(window.localMode==='metadata')records=records.map((r,i)=>({...r,source:{sessionId:'session-A',...(i?{accountId:'wx-A'}:{})}}));
if(window.localMode==='missing-session')records=records.map((r,i)=>({...r,source:i?{sessionId:'session-A',accountId:'wx-A'}:{}}));
return{id,ownerId:window.localMode==='foreign'?'wrong-owner':owner,kind:'chat',records,cloud:{id:'cloud-A',epoch:1,total:window.localMode==='partial'?5:2}};};
window.testApi=async(path,body,signal)=>{
if(body!==undefined||!path.includes('/api/web/report/sentences?')||!path.includes('mode=attention'))throw Error('unexpected write/endpoint');
const call={path,aborted:signal.aborted};window.calls.push(call);signal.addEventListener('abort',()=>call.aborted=true,{once:true});
if(window.cloudMode==='pending')return new Promise(resolve=>window.pending.push({resolve,call}));
if(window.cloudMode==='401')throw Object.assign(Error('synthetic auth'),{status:401});
if(window.cloudMode==='error')throw Object.assign(Error('synthetic network'),{status:503});
if(window.cloudMode==='invalid')return{replyAttention:{...window.ready,rulesVersion:1}};
if(window.cloudMode==='malformed')return{replyAttention:{...window.ready,limitations:[{}]}};
if(window.cloudMode==='oral')return{replyAttention:window.oral,cost:0};
if(window.cloudMode==='mixed')return{replyAttention:computeReplyAttention(window.readyRows.map((r,i)=>({...r,libraryId:'cloud-A',source:i?{sessionId:'session-A',accountId:'wx-A'}:{}})),{scope:'full-history'})};
return{replyAttention:window.cloudMode==='insufficient'?window.insufficient:window.ready,sourceUpdated:true};};
window.render=(owner=window.currentOwner,report=window.baseReport)=>{window.currentOwner=owner;root.render(<ReplyAttentionOverview ownerId={owner} report={report}/>);};
window.unmount=()=>root.unmount();window.render();`;
const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',format:'iife',platform:'browser',plugins:[{name:'synthetic-IO-only',setup(b){
 b.onLoad({filter:/web-analysis[\\/]client\.tsx$/},()=>({contents:'export const api=(...args)=>window.testApi(...args);',loader:'js'}));
 b.onLoad({filter:/desktop-capture-vault\.ts$/},()=>({contents:'export const readReportSources=(...args)=>window.readSources(...args);export const getCaptureLibrary=(...args)=>window.readLibrary(...args);',loader:'js'}));
 b.onLoad({filter:/web-analysis[\\/]CaptureEvidence\.tsx$/},()=>({contents:'export const CaptureEvidence=()=>null;',loader:'js'}));
}}]});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text,css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
const server=createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;font-family:Arial,sans-serif}*{box-sizing:border-box}.wa-btn{display:inline-flex;align-items:center;min-height:44px;padding:9px 16px}${css}</style></head><body><div id="app"></div><script>${js}</script></body></html>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const executable=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&existsSync(p));
const browser=await puppeteer.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-gpu']});
const failures=[];let checks=0;
const page=await browser.newPage();page.on('pageerror',error=>failures.push(error.message));
const open=async(local='none',cloud='ready')=>{await page.goto(`http://127.0.0.1:${server.address().port}/?local=${local}&cloud=${cloud}`);};
const phase=async value=>page.waitForFunction(value=>document.querySelector('[data-reply-attention]')?.dataset.replyAttentionState===value,{},value);
const text=()=>page.$eval('body',node=>node.innerText);
try{
 for(const local of ['none','insufficient','mixed','metadata','missing-session','partial','foreign','error']){
  await open(local);await phase('ready');
  assert.equal(await page.evaluate(()=>window.calls.length),1,`${local} reaches cloud fallback`);
  assert.equal(await page.$eval('[data-reply-attention]',node=>node.dataset.replyAttentionSource),'cloud');
  assert.match(await text(),/周六一起吃饭吗/);checks++;
 }
 await open('ready');await phase('ready');assert.equal(await page.evaluate(()=>window.calls.length),0,'complete current local summary keeps fast path');
 assert.equal(await page.$eval('[data-reply-attention]',node=>node.dataset.replyAttentionSource),'local');checks++;
 await open('none','oral');await phase('ready');
 assert.equal(await page.evaluate(()=>window.baseReport.semanticHistory.replyAttention.rulesVersion),2,'fixture starts with a saved version-2 summary');
 assert.equal(await page.evaluate(()=>window.oral.rulesVersion),3);
 assert.equal(await page.evaluate(()=>window.calls.length),1,'old version-2 display upgrades through one free read');
 assert.match(await text(),/啥时候有空我带你去公园/);assert.match(await text(),/材料到这里，后续未知/);checks++;
 await open('hold');await phase('ready');assert.equal(await page.evaluate(()=>window.calls.length),1,'blocked IDB falls back within 800ms');
 await page.evaluate(()=>{window.localPending.forEach(resolve=>resolve());});await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(await page.$eval('[data-reply-attention]',node=>node.dataset.replyAttentionSource),'cloud','late IDB cannot override server result');checks++;
 await open('none','pending');await phase('loading');assert.match(await text(),/正在读取已保存的连续聊天/);checks++;
 await page.evaluate(()=>document.querySelector('button').click());await phase('cancelled');
 assert.equal(await page.evaluate(()=>window.calls[0].aborted),true);
 await page.evaluate(()=>window.pending[0].resolve({replyAttention:window.ready}));await new Promise(resolve=>setTimeout(resolve,50));
 await phase('cancelled');
 await page.evaluate(()=>{window.cloudMode='ready';document.querySelector('button').click();});await phase('ready');
 assert.equal(await page.evaluate(()=>window.calls.length),2,'cancel is recoverable with a fresh request');checks++;
 for(const cloud of ['insufficient','mixed','401','error','invalid','malformed']){
  await open('insufficient',cloud);await phase(cloud==='401'?'unauthorized':['insufficient','mixed'].includes(cloud)?'insufficient':'error');
  assert.ok((await text()).includes('最近的回应'),'failure never removes section');
  if(cloud==='mixed')assert.match(await text(),/含多份会话/,'actual source-context limitation remains visible');
  if(cloud==='401')assert.match(await page.$eval('a',node=>node.getAttribute('href')),/^\/login\?return_to=/);
  else{await page.evaluate(()=>{window.cloudMode='ready';document.querySelector('button').click();});await phase('ready');assert.equal(await page.evaluate(()=>window.calls.length),2);}
  checks++;
 }
 await open('none','pending');await phase('loading');await page.waitForFunction(()=>window.calls.length===1);
 await page.evaluate(()=>window.render('owner-B',{...window.baseReport,reportId:'report-B'}));await page.waitForFunction(()=>window.calls.length===2);
 assert.equal(await page.evaluate(()=>window.calls[0].aborted),true,'account/report switch cancels previous request');
 await page.evaluate(()=>window.pending[0].resolve({replyAttention:{...window.ready,headline:'OLD ACCOUNT PRIVATE'}}));await new Promise(resolve=>setTimeout(resolve,50));
 assert.doesNotMatch(await text(),/OLD ACCOUNT PRIVATE/);await phase('loading');
 await page.evaluate(()=>window.pending[1].resolve({replyAttention:{...window.ready,headline:'CURRENT ACCOUNT RESULT'}}));await phase('ready');assert.match(await text(),/CURRENT ACCOUNT RESULT/);checks++;
 await open('hold','ready');await phase('loading');await page.evaluate(()=>{window.localMode='none';window.render('owner-B',{...window.baseReport,reportId:'report-B'});});await phase('ready');
 await page.evaluate(()=>window.localPending.forEach(resolve=>resolve()));await new Promise(resolve=>setTimeout(resolve,60));
 assert.ok(await page.evaluate(()=>window.calls.every(call=>call.path.includes('report-B'))),'late previous-owner IDB must not start a cloud request under new session');checks++;
 await open('none','pending');await phase('loading');await page.waitForFunction(()=>window.calls.length===1);await page.evaluate(()=>window.unmount());
 assert.equal(await page.evaluate(()=>window.calls[0].aborted),true,'unmount cancels IO');await page.evaluate(()=>window.pending[0].resolve({replyAttention:window.ready}));checks++;
 await page.setViewport({width:390,height:900});await open('none','error');await phase('error');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'recovery controls fit mobile');checks++;
 assert.deepEqual(failures,[]);
 console.log(`PASS ${checks} actual ReactDOM reply-attention loading cases: local ready, local insufficient/mixed/partial, blocked IDB, cloud fallback, empty, auth, error, malformed version, retry, cancel, owner switch, unmount and mobile.`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
