import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {existsSync,mkdirSync} from 'node:fs';
import puppeteer from 'puppeteer-core';
const report={id:'af750f19-0502-4d43-a382-04c3dfac3eb8',analysisScope:'fullHistory',archiveSnapshot:{libraryId:'cl_'+'a'.repeat(64),epoch:1,revision:1},participants:{other:{label:'合成小林'}},semanticHistory:{coverage:{receivedText:25}}};
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{HistorySentenceReader}from'./components/web-analysis/HistorySentenceReader';createRoot(document.getElementById('app')).render(<HistorySentenceReader report={${JSON.stringify(report)}}/>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',format:'iife',platform:'browser',plugins:[{name:'synthetic-boundaries',setup(b){
  b.onLoad({filter:/web-analysis[\\/]client\.tsx$/},()=>({contents:`export const api=(...args)=>window.testApi(...args);export const message=e=>e.message;`,loader:'js'}));
  b.onLoad({filter:/web-analysis[\\/]ReportSessionState\.tsx$/},()=>({contents:`export {useState as useReportSessionStateBase} from 'react';import {useState} from 'react';export const useReportSessionState=(key,initial)=>useState(initial);`,loader:'js'}));
  b.onLoad({filter:/web-analysis[\\/]CaptureEvidence\.tsx$/},()=>({contents:`export const CaptureEvidence=()=>null;`,loader:'js'}));
}}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const fixture=`window.calls=[];window.reads=[];window.cancelMode=false;window.pendingResolve=null;window.testAnnotations=[];
const lines=Array.from({length:25},(_,i)=>({id:'m'+i,sourceId:'m'+i,sourceKind:'chat',speaker:i%2?'self':'other',text:'合成原话第 '+(i+1)+' 句：下周一起去看那个展吧。',at:'2026-10-24 10:00'}));
const annotation=id=>({lineId:id,emotion:[{key:'happy',label:'开心',probability:.8},{key:'calm',label:'平静',probability:.2}],intent:[{key:'invite',label:'邀请',probability:1}],note:'这句话接住前面的活动话题，提出一次具体邀约。'});
const page=(offset,count=12,status)=>{const selected=lines.slice(offset,offset+count);const annotations=selected.filter(line=>window.testAnnotations.includes(line.id)).map(line=>annotation(line.id));return{offset,nextOffset:offset+selected.length,totalReadable:25,totalAnalyzed:window.testAnnotations.length,lines:selected,annotations,status:status|| (annotations.length===selected.length?'complete':annotations.length?'partial':'unread'),pageKey:'p'+offset+'_'+selected.length,cost:0};};
window.testApi=async(path,body)=>{if(!path.startsWith('/api/web/report/sentences'))throw Error('Unexpected endpoint');if(!body){const p=new URL(path,location.origin).searchParams;let offset=Number(p.get('offset')||0);if(p.has('before'))offset=Math.max(0,Math.min(25,Number(p.get('before')))-12);window.reads.push(Object.fromEntries(p));return page(offset,Number(p.get('count')||12));}window.calls.push(body);if(body.action==='cancel'){window.pendingResolve?.();return page(body.offset,body.count,'cancelling');}if(window.cancelMode){await new Promise(resolve=>window.pendingResolve=resolve);throw Error('本次补充已取消');}window.testAnnotations=[...new Set([...window.testAnnotations,...lines.slice(body.offset,body.offset+body.count).map(l=>l.id)])];return page(body.offset,body.count);};`;
const server=createServer((_req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:18px;background:#f6f4ec;font-family:Arial,'Microsoft YaHei',sans-serif}*{box-sizing:border-box}#app{max-width:1080px;margin:auto}${css}</style></head><body><div id="app"></div><script>${fixture}</script><script>${js}</script></body></html>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const executable=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&existsSync(p));
const browser=await puppeteer.launch({executablePath:executable,headless:true,args:['--no-sandbox','--disable-gpu']});
try{
  for(const width of [1440,390]){
    const tab=await browser.newPage();await tab.setViewport({width,height:1000});
    await tab.goto('http://127.0.0.1:'+server.address().port);await tab.waitForSelector('[data-history-sentence-reader] article');
    assert.equal(await tab.$$eval('article',nodes=>nodes.length),12);assert.match(await tab.$eval('body',node=>node.innerText),/第 14–25 句/);
    assert.equal(await tab.evaluate(()=>window.calls.length),0,'opening/reading does not initiate model work');
    await tab.$eval('article button',node=>node.click());assert.match(await tab.$eval('article',node=>node.innerText),/尚未逐句解读/);
    await tab.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='补充本页解读').click());
    await tab.waitForFunction(()=>document.body.innerText.includes('本页全部已解读'));
    assert.match(await tab.$eval('body',node=>node.innerText),/80%/);assert.match(await tab.$eval('body',node=>node.innerText),/100%/);
    assert.equal(await tab.evaluate(()=>window.calls.length),1);
    assert.deepEqual(await tab.evaluate(()=>({count:window.calls[0].count,offset:window.calls[0].offset,confirmed:window.calls[0].confirmed})),{count:12,offset:13,confirmed:true});
    await tab.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('更早的聊天')).click());
    await tab.waitForFunction(()=>document.body.innerText.includes('第 2–13 句'));
    await tab.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('更近的聊天')).click());
    await tab.waitForFunction(()=>document.body.innerText.includes('第 14–25 句'));
    assert.equal(await tab.evaluate(()=>window.calls.length),1,'paging returns saved readings without another model request');
    assert.equal(await tab.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
    mkdirSync('outputs/sentence-reader',{recursive:true});await tab.screenshot({path:'outputs/sentence-reader/reader-'+width+'.png',fullPage:true});
    await tab.reload();await tab.waitForSelector('article');
    await tab.evaluate(()=>{window.cancelMode=true;[...document.querySelectorAll('button')].find(b=>b.textContent==='补充本页解读').click();});
    await tab.waitForFunction(()=>document.body.innerText.includes('正在解读这'));
    await tab.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='停止').click());
    await tab.waitForFunction(()=>window.calls.some(call=>call.action==='cancel'));
    assert.equal(await tab.$$eval('article',nodes=>nodes.length),12,'cancel preserves the original readable page');
    assert.equal(await tab.evaluate(()=>window.calls[0].requestId===window.calls[1].requestId),true,'cancel uses the exact pending request');
    await tab.close();
  }
  console.log('PASS sentence reader: desktop/mobile real React UI, read-only entry, explicit free page supplement, visible percentages, cached pagination, cancellation preserves originals, no overflow');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
