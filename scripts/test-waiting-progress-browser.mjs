import assert from 'node:assert/strict';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
const output='outputs/waiting-speed-qa';await mkdir(output,{recursive:true});
const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {WaitingProgress} from './components/WaitingProgress';
let elapsed=0;const realNow=Date.now;Date.now=()=>realNow()+elapsed;const startedAt=Date.now()-203000,root=createRoot(document.getElementById('app'));
let work={completed:0,total:10,reuseKey:0},offline=false;window.parentRenders=0;
function App(){window.parentRenders++;return <section><h1>正在梳理全部聊天</h1><p>已核对 208 条聊天、124 条动态文字</p><WaitingProgress startedAt={startedAt} phaseStartedAt={startedAt+180000} phaseKey="synthetic-task:segments" steps={['核对资料','读取图片','梳理上下文','生成报告']} step={2} work={work} offline={offline} detail={offline?'正在自动重连，原任务已保留。':'正在逐组核对上下文，完成后自动生成报告。'}/></section>}
window.updateWaiting=(patch,delta=0)=>{elapsed+=delta;work={...work,...patch};root.render(<App/>);};window.setOffline=value=>{offline=value;root.render(<App/>);};root.render(<App/>);
`},bundle:true,write:false,outfile:'.tmp/waiting-preview.js',format:'iife',platform:'browser',jsx:'automatic',logLevel:'silent'});
const js=result.outputFiles.find(file=>file.path.endsWith('.js')).text,css=result.outputFiles.find(file=>file.path.endsWith('.css')).text;
const html=`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#fffbf6;color:#355b4d;font:16px/1.7 system-ui,sans-serif}section{max-width:920px;margin:40px auto;padding:24px;background:#f2f7f3;border:1px solid #d7e5de;border-radius:20px}h1{font-size:24px;margin:0}p{margin:10px 0}@media(max-width:600px){section{margin:16px;padding:20px}}${css}</style></head><body><main id="app"></main><script>${js}</script></body></html>`;
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox'],defaultViewport:{width:1280,height:760}});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent(html,{waitUntil:'load'});
  await page.waitForSelector('[data-waiting-progress]');
  assert.match(await page.$eval('[data-waiting-progress]',el=>el.textContent),/3 分/);
  const parentRenders=await page.evaluate(()=>window.parentRenders);
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert.equal(await page.evaluate(()=>window.parentRenders),parentRenders,'timer ticks must not rerender the material-heavy parent');
  await page.evaluate(()=>window.updateWaiting({completed:1},12000));
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal((await page.$eval('[data-waiting-progress]',el=>el.textContent)).includes('约还需'),false,'one batch is insufficient to estimate');
  await page.evaluate(()=>window.updateWaiting({completed:2},12000));
  await page.waitForFunction(()=>document.querySelector('[data-waiting-progress]').textContent.includes('约还需'));
  await page.screenshot({path:output+'/desktop.png'});
  await page.setViewport({width:375,height:700});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile layout must not overflow');
  await page.screenshot({path:output+'/mobile.png'});
  await page.evaluate(()=>window.updateWaiting({completed:5,reuseKey:3}));
  await page.waitForFunction(()=>!document.querySelector('[data-waiting-progress]').textContent.includes('约还需'));
  await page.evaluate(()=>window.setOffline(true));
  await page.waitForFunction(()=>document.querySelector('[data-waiting-progress]').textContent.includes('自动重连'));
  assert.equal((await page.$eval('[data-waiting-progress]',el=>el.textContent)).includes('约还需'),false,'offline status cannot retain a stale estimate');
  assert.deepEqual(errors,[]);
  await writeFile(output+'/result.json',JSON.stringify({timerParentIsolation:true,measuredRange:true,cacheReuseResetsEstimate:true,offlineRemovesEstimate:true,mobileOverflow:false},null,2));
  console.log('PASS real React timer isolation, measured phase ETA, cache-reuse reset, offline recovery text, and 375px mobile layout.');
}finally{await browser.close();}
