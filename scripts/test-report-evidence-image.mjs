import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer-core';

// Isolated synthetic browser: no real account, material or production request.
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ReportEvidenceImage} from './components/web-analysis/ReportEvidenceImage';import {readReportLibrarySources} from './components/web-analysis/ReportSourceLibrary';import {loadCloudCaptureImage} from './lib/capture-cloud-client';const root=createRoot(document.getElementById('root'));Object.assign(window,{readReportLibrarySources,loadCloudCaptureImage,renderPreview:(props)=>root.render(React.createElement(ReportEvidenceImage,props))});`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',plugins:[{name:'synthetic-preview-context',setup(b){
  b.onResolve({filter:/^\.\/CaptureEvidence$/},()=>({path:'context',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useCaptureEvidenceContext=()=>window.evidenceContext;',loader:'js'}));
  b.onResolve({filter:/^\.\/ReportSourceLibrary$/},args=>args.importer.endsWith('ReportEvidenceImage.tsx')?{path:'source',namespace:'fixture-source'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture-source'},()=>({contents:'export const readReportLibrarySources=(...args)=>window.previewRead(...args);',loader:'js'}));
  b.onLoad({filter:/\.module\.css$/},()=>({contents:'export default {};',loader:'js'}));
}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'application/javascript':'text/html');res.end(req.url==='/fixture.js'?bundle.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']}),page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle0'});
  await page.evaluate(()=>{
    window.imageData='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=';
    window.evidenceContext={ownerId:undefined,visible:true,open:()=>{window.opened=true;}};
    window.pending=[];window.previewRead=(owner,library,ids,signal,preview)=>new Promise((resolve,reject)=>{pending.push({owner,library,ids,signal,preview,resolve,reject});});
    window.setPreview=(owner,source='source-a',visible=true)=>{evidenceContext={...evidenceContext,ownerId:owner,visible};renderPreview({libraryId:'library',sourceId:source});};
    window.complete=(index,data=imageData)=>pending[index].resolve({records:[{images:[{mime:'image/png',data}]}]});
    setPreview(undefined);
  });
  assert.equal(await page.$('[data-report-evidence-image]'),null);
  await page.evaluate(()=>setPreview('owner-a'));
  await page.waitForFunction(()=>pending.length===1);
  await page.evaluate(()=>complete(0));await page.waitForSelector('img');
  assert.equal(await page.evaluate(()=>pending[0].preview),true);
  await page.click('button');assert.equal(await page.evaluate(()=>opened),true);
  await page.evaluate(()=>setPreview('owner-a','source-b'));
  await page.waitForFunction(()=>pending.length===2);
  await page.evaluate(()=>setPreview('owner-b','source-b',false));
  await page.waitForFunction(()=>pending.length===3);
  assert.equal(await page.evaluate(()=>pending[1].signal.aborted),true);
  await page.evaluate(()=>{complete(1);complete(2);});await page.waitForSelector('img');
  assert.equal(await page.$eval('button',node=>node.disabled),true);
  await page.evaluate(()=>setPreview('owner-b','broken'));
  await page.waitForFunction(()=>pending.length===4);await page.evaluate(()=>complete(3,'AAAA'));
  await page.waitForFunction(()=>document.body.textContent.includes('点此重试'));
  await page.click('button');await page.waitForFunction(()=>pending.length===5);await page.evaluate(()=>complete(4));await page.waitForSelector('img');
  await page.evaluate(()=>{window.IntersectionObserver=undefined;setPreview('owner-c','fallback');});
  await page.waitForFunction(()=>pending.length===6);await page.evaluate(()=>complete(5));await page.waitForSelector('img');
  console.log('PASS evidence image: late owner, account/source changes abort old reads, disabled unavailable source action, broken image retry, observer fallback.');

  const data=await page.evaluate(async()=>{
    const owner='test-owner',libraryId='cl_'+'a'.repeat(64),bytes=Uint8Array.from(atob(imageData),ch=>ch.charCodeAt(0));
    const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    const ref={id:'cm_'+'b'.repeat(64),mime:'image/png',name:'test.png',bytes:bytes.length,chunks:1,sha256:sha,index:0,status:'ready'};
    const info={id:libraryId,account:'test-wechat',friend:'Test',kind:'moments',epoch:1,revision:1};
    const record={localId:'source',kind:'text',text:'合成图片来源',imageCount:2,media:[ref,{...ref,id:'cm_'+'c'.repeat(64)}],source:{}};
    const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
    let mediaReads=0;
    window.fetch=async(url)=>new URL(String(url),location.origin).searchParams.has('mediaId')?(mediaReads++,response({ownerId:owner,media:ref,data:imageData,chunkIndex:0})):response({ownerId:owner,library:info,records:[record]});
    const preview=await readReportLibrarySources(owner,libraryId,['source'],new AbortController().signal,true);
    let wrongOwner=false;window.fetch=async()=>response({ownerId:'different',library:info,records:[record]});
    try{await readReportLibrarySources(owner,libraryId,['source'],new AbortController().signal,true);}catch{wrongOwner=true;}
    let pages=0,revisionChanged=false;window.fetch=async()=>response({ownerId:owner,library:{...info,revision:++pages},records:pages===1?[{...record,localId:'unneeded'}]:[record],nextCursor:pages===1?'next':undefined});
    try{await readReportLibrarySources(owner,libraryId,['source'],new AbortController().signal,true);}catch{revisionChanged=true;}
    const controller=new AbortController();let chunkRequests=0,abortedUpstream=false,started;
    const ready=new Promise(resolve=>{started=resolve;});
    window.fetch=async(url,options)=>{
      const query=new URL(String(url),location.origin).searchParams;
      if(!query.has('mediaId'))return response({ownerId:owner,library:info,records:[{...record,media:[{...ref,chunks:3}]}]});
      chunkRequests++;
      if(chunkRequests===1)return response({ownerId:owner,media:ref,data:imageData.slice(0,20),chunkIndex:0});
      return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{abortedUpstream=true;reject(options.signal.reason);},{once:true});started();});
    };
    const reading=readReportLibrarySources(owner,libraryId,['source'],controller.signal,true).then(()=>'',error=>error.name);
    await ready;controller.abort();const abortName=await reading;
    const identityController=new AbortController();let identityStarted,identityAborted=false,materialRequests=0;
    const identityReady=new Promise(resolve=>{identityStarted=resolve;});
    window.fetch=async(url,options)=>{
      if(String(url).includes('/api/account/credits'))return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{identityAborted=true;reject(options.signal.reason);},{once:true});identityStarted();});
      materialRequests++;return new Response(JSON.stringify({error:'temporary'}),{status:503});
    };
    const recovery=loadCloudCaptureImage(owner,libraryId,ref,identityController.signal).then(()=>'',error=>error.name);
    await identityReady;identityController.abort();const identityAbortName=await recovery;
    return{imageCount:preview.records[0].images.length,unavailable:preview.records[0].source.cloudMediaUnavailable,mediaReads,wrongOwner,revisionChanged,chunkRequests,abortedUpstream,abortName,identityAborted,materialRequests,identityAbortName};
  });
  assert.deepEqual(data,{imageCount:1,unavailable:false,mediaReads:1,wrongOwner:true,revisionChanged:true,chunkRequests:2,abortedUpstream:true,abortName:'AbortError',identityAborted:true,materialRequests:1,identityAbortName:'AbortError'});
  const selection=await page.evaluate(async()=>{
    const owner='test-owner',libraryId='cl_'+'a'.repeat(64),info={id:libraryId,account:'test-wechat',friend:'Test',kind:'chat',epoch:1,revision:7};
    const record=id=>({localId:id,kind:'text',text:'合成原文 '+id,imageCount:0,media:[],source:{}}),response=value=>new Response(JSON.stringify({ownerId:owner,library:info,...value}),{status:200});
    const ids=Array.from({length:25},(_,index)=>'requested-'+index),batches=[];
    window.fetch=async url=>{const params=new URL(String(url),location.origin).searchParams,sourceIds=JSON.parse(params.get('sourceIds'));batches.push(sourceIds);return response({records:sourceIds.map(record),sourceSelection:{version:1,sourceIds},nextCursor:null});};
    const exact=await readReportLibrarySources(owner,libraryId,ids,new AbortController().signal,true);
    let legacyRequests=0;const legacyQueries=[];
    window.fetch=async url=>{const params=new URL(String(url),location.origin).searchParams;legacyQueries.push({cursor:params.get('cursor'),selected:params.has('sourceIds')});legacyRequests++;const cursor=Number(params.get('cursor')||0);return response({records:cursor===1000?[record('deep-source')]:Array.from({length:500},(_,n)=>record('other-'+(cursor+n))),nextCursor:cursor===1000?null:String(cursor+500)});};
    const legacy=await readReportLibrarySources(owner,libraryId,['deep-source'],new AbortController().signal,true);
    let rejectingRequests=0;
    window.fetch=async url=>{rejectingRequests++;const params=new URL(String(url),location.origin).searchParams;if(params.has('sourceIds'))return new Response('{"error":"unsupported query"}',{status:400});return response({records:params.has('cursor')?[record('after-legacy-page')]:[record('other')],nextCursor:params.has('cursor')?null:'next'});};
    const rejecting=await readReportLibrarySources(owner,libraryId,['after-legacy-page'],new AbortController().signal,true);
    let invalidSelection=false;
    window.fetch=async()=>response({records:[record('foreign-source')],sourceSelection:{version:1,sourceIds:['requested']},nextCursor:null});
    try{await readReportLibrarySources(owner,libraryId,['requested'],new AbortController().signal,true);}catch{invalidSelection=true;}
    let cyclic=false;window.fetch=async()=>response({records:[record('other')],nextCursor:'same'});
    try{await readReportLibrarySources(owner,libraryId,['requested'],new AbortController().signal,true);}catch{cyclic=true;}
    return{batches:batches.map(batch=>batch.length),exact:exact.records.map(row=>row.localId),ids,legacyRequests,legacy:legacy.records.map(row=>row.localId),legacyQueries,rejectingRequests,rejecting:rejecting.records.map(row=>row.localId),invalidSelection,cyclic};
  });
  assert.deepEqual(selection.batches,[12,12,1]);assert.deepEqual(selection.exact,selection.ids);
  assert.equal(selection.legacyRequests,3);assert.deepEqual(selection.legacy,['deep-source']);assert.deepEqual(selection.legacyQueries,[{cursor:null,selected:true},{cursor:'500',selected:false},{cursor:'1000',selected:false}]);
  assert.equal(selection.rejectingRequests,3);assert.deepEqual(selection.rejecting,['after-legacy-page']);assert.equal(selection.invalidSelection,true);assert.equal(selection.cyclic,true);
  assert.deepEqual(errors,[]);
  console.log('PASS cited image source: verified first preview, owner/revision guards, mid-chunk abort, abort during account-confirmation recovery.');
  console.log('PASS exact source lookup: 12-record bounded batches, legacy ignored/rejected parameter fallback beyond 1,000 records, mismatched acknowledgement and circular cursor rejection.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
