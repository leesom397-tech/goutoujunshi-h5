import assert from 'node:assert/strict';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useLayoutEffect} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {CaptureAnalysisStatus} from './components/CaptureAnalysisStatus';
const root=createRoot(document.getElementById('app'));window.requests=[];window.commits=[];
let props={owner:'owner-a',libraryId:'library-a',subjectId:'person-a',initialJob:{status:'done',taskId:'task-a',libraryId:'library-a',subjectId:'person-a',friend:'Synthetic Person A',kind:'chat',totalCount:13,phase:'complete'}};
function App(){useLayoutEffect(()=>{window.commits.push(document.getElementById('app').textContent);});return <CaptureAnalysisStatus {...props}/>}
window.changeStatus=next=>{props={...props,...next};flushSync(()=>root.render(<App/>));};root.render(<App/>);
`},bundle:true,write:false,outfile:'.tmp/status-scope-preview.js',format:'iife',platform:'browser',jsx:'automatic',logLevel:'silent',plugins:[{name:'synthetic-status-api',setup(builder){builder.onResolve({filter:/web-analysis\/client$/},args=>args.importer.endsWith('CaptureAnalysisStatus.tsx')?{path:'status-api',namespace:'fixture'}:undefined);builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export function api(url){return new Promise(resolve=>window.requests.push({url,resolve}));}`}));}}]});
const js=result.outputFiles.find(file=>file.path.endsWith('.js')).text;
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setContent(`<main id="app"></main><script>${js}</script>`);
 await page.waitForFunction(()=>document.body.textContent.includes('Synthetic Person A'));
 await page.evaluate(()=>window.changeStatus({owner:'owner-b',libraryId:'library-b',subjectId:'person-b',initialJob:null}));
 assert.equal(await page.evaluate(()=>window.commits.at(-1).includes('Synthetic Person A')),false,'owner switch must hide the old name in the commit before passive effect cleanup');
 await page.waitForFunction(()=>window.requests.length===2);
 await page.evaluate(()=>window.requests[0].resolve({status:'done',taskId:'task-a',libraryId:'library-a',subjectId:'person-a',friend:'Late Owner A',kind:'chat',totalCount:13,phase:'complete'}));
 await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(await page.evaluate(()=>document.getElementById('app').textContent.includes('Late Owner A')),false,'late old-owner response cannot reappear');
 await page.evaluate(()=>window.requests[1].resolve({status:'done',taskId:'task-b',libraryId:'library-b',subjectId:'person-b',friend:'Synthetic Person B',kind:'chat',totalCount:4,phase:'complete'}));
 await page.waitForFunction(()=>document.getElementById('app').textContent.includes('Synthetic Person B'));
 await page.evaluate(()=>window.changeStatus({subjectId:'person-c',initialJob:{status:'done',taskId:'task-b',libraryId:'library-b',subjectId:'person-b',friend:'Wrong Person Seed',kind:'chat',totalCount:4,phase:'complete'}}));
 assert.equal(await page.evaluate(()=>window.commits.at(-1).includes('Synthetic Person B')),false,'subject change must hide old result before polling');
 await page.waitForFunction(()=>window.requests.length===3);
 assert.equal(await page.evaluate(()=>document.getElementById('app').textContent.includes('Wrong Person Seed')),false,'wrong-subject seed is rejected even for the same library');
 await page.evaluate(()=>window.requests[2].resolve({status:'none'}));
 await page.evaluate(()=>window.changeStatus({owner:'',initialJob:null}));
 assert.equal(await page.$eval('#app',el=>el.textContent),'','logout leaves no person or task status');
 assert.deepEqual(errors,[]);
 console.log('PASS report-status owner/subject switch without stale commit, late-response isolation, seed validation, and logout.');
}finally{await browser.close();}
