import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import ts from 'typescript';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';

// Production capture/cancel handlers, progress/status JSX and real IndexedDB.
// Only the local-helper transport/account setup is synthetic. No customer data,
// live helper, model, upload, credit or analysis endpoint is contacted.
const source=readFileSync('app/capture/page.tsx','utf8');
const file=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const handlers=[],names=new Set(['capture','cancel']);let status='',progress='';
function visit(node){
  if(ts.isFunctionDeclaration(node)&&names.has(node.name?.text))handlers.push(node.getText(file));
  if(ts.isJsxExpression(node)&&node.expression){
    const value=node.expression.getText(file);
    if(value.startsWith('showJobStatus && <div'))status=node.getText(file);
    if(value.startsWith('processingImport && <section'))progress=node.getText(file);
  }
  ts.forEachChild(node,visit);
}
visit(file);assert.equal(handlers.length,names.size);assert.ok(status&&progress);
const fixture=`
import React,{useRef,useState} from 'react';import{createRoot}from'react-dom/client';
import{Square,ArrowRight,RefreshCw,LoaderCircle}from'lucide-react';
import{runHistoryImport as actualRunHistoryImport,newHistoryProgress,readHistoryProgress,clearHistoryProgress}from'./lib/capture-history-import';
import{getCaptureLibrary,saveCaptureBatch}from'./lib/desktop-capture-vault';
import{captureLibraryId}from'./lib/desktop-capture';
import{WaitingProgress}from'./components/WaitingProgress';
import{getDesktopHost}from'./lib/desktop-host';
import ImportFlowVisual from'./components/ImportFlowVisual';
import{isMacMomentsCacheOnly,momentsRequestScope}from'./lib/capture-moments-outcome';
import{readCaptureMediaJob}from'./lib/capture-media-lane';
import styles from './app/capture/capture.module.css';import ui from './components/AuroraUI.module.css';
window.calls=[];window.mode=new URLSearchParams(location.search).get('mode');window.failures=0;window.allowRecovery=false;
let stallClock=Date.now();if(window.mode==='stalled')Date.now=()=>stallClock;
const runHistoryImport=options=>actualRunHistoryImport(window.mode==='stalled'?{...options,pollMs:0,idleTimeoutMs:2000}:options);
const owner='source-recovery-'+window.mode,friend='合成联系人',selectedContact={label:friend,contactId:'contact-id',accountKey:'account-key'};
const jobs=new Map();let nextJob=0;
const fixtureBatch=(body)=>{const start=body.cursor?500:0,count=body.cursor?220:500;return{version:1,kind:'chat',friend,account:'fixture-account',capturedAt:'2026-10-22T01:00:00Z',warnings:[],
records:Array.from({length:count},(_,i)=>({id:'wechat-db:fixture-'+(start+i),kind:'text',text:'合成原文 '+(start+i),sender:'合成联系人',senderRole:'other',at:'2026-10-22T00:00:00Z',source:{label:'合成数据库',method:'wechat-local-db',accountId:'fixture-account'}})),
history:{version:1,direction:'backward',count,hasMore:!body.cursor,nextCursor:body.cursor?null:'cursor_500',snapshot:'snapshot_720',complete:!!body.cursor}};};
class BridgeError extends Error{}
class CapturePairSourceError extends Error{}
const bridgeRequest=async(path,options={})=>{
  window.calls.push({path,body:options.body});if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(path==='/health')return{capabilities:{backgroundHistory:true,backgroundChat:true}};
  if(path==='/capture'){const id='job_'+(++nextJob);jobs.set(id,{body:options.body,reads:0});return{jobId:id};}
  const job=jobs.get(path.split('/')[2]);if(!job)throw Error('Unexpected fixture path '+path);job.reads++;
  if(path.endsWith('/cancel'))return{status:'cancelled'};
  if(window.mode==='stalled'&&!window.allowRecovery){stallClock+=1000;return{status:'running',message:'正在检查本机聊天与语音',progress:0};}
  if(job.body.cursor&&(!window.allowRecovery)&&(window.mode==='persistent'||window.mode==='cancel'||window.failures===0)){
    window.failures++;return{status:'failed',error:{code:'SOURCE_CHANGED',message:'微信聊天正在同步或更新，请稍后重新导入'},...(window.mode==='partial'?{partial:fixtureBatch(job.body),partialRevision:1}:{})};
  }
  return{status:'completed',result:fixtureBatch(job.body)};
};
const message=e=>e.message,stored=key=>JSON.parse(sessionStorage.getItem(key)||'null'),remember=(key,value)=>value===null?sessionStorage.removeItem(key):sessionStorage.setItem(key,JSON.stringify(value));
const no=()=>{},contactDisplayName=value=>value;
function Harness(){
  const generation=useRef(1),abort=useRef(null),mediaAbort=useRef(null),token=useRef('synthetic'),captureActive=useRef(false),personImporting=useRef(false),personStopped=useRef(false),revealReportAfterImport=useRef(false),currentLibrary=useRef(null);
  const mediaPanel=null;
  const [library,setLibrary]=useState(null),[busy,setBusy]=useState(false),[historyRunning,setHistoryRunning]=useState(false),[historyState,setHistoryState]=useState(null),[jobId,setJobId]=useState(''),[jobPhase,setJobPhase]=useState('idle'),[jobMessage,setJobMessage]=useState(''),[note,setNote]=useState(''),[error,setError]=useState(''),[importStage,setImportStage]=useState(''),[progressValue,setProgress]=useState(0);
  currentLibrary.current=library;
  const connected=true,receipt=null,kind='chat',personIntent=false,health={capabilities:{backgroundHistory:true,backgroundChat:true}},macCachedMoments=false,allVisibleMoments=false,analyzing=false,cloudBusy=false,personImport='idle',subjectBusy=false,currentMomentsAttempt=null,idleSeconds=0,relatedMomentCount=0,liveUploadNote='',transferNote='',cloudNote='',progressChat=library,progressVoice=null,importStartedAt=0,importSteps=['读取聊天','补齐语音和图片','完成上传'],importStep=0,importDetail='正在打开本机聊天数据。';
  const setShowAnalysis=no,setConsent=no,setVoiceEnriching=no,setHealth=no,setStats=no,setShowImportControls=no,setRelatedLoading=no,setRelatedError=no,setKind=no,updateMomentsAttempt=no,beginImportTiming=no,invalidateCaptureUploads=no,selectPending=no;
  const scopeKey=value=>'chengzi-capture:'+owner+':'+value,ensureImportSubject=async()=> 'synthetic-person';
  const connectionFailed=e=>setError(message(e)),enrichImportedVoices=async value=>value,enrichImportedImages=async value=>value;
  const accept=async(batch)=>{const result=await saveCaptureBatch(owner,batch);currentLibrary.current=result.library;setLibrary(result.library);return result;};
  ${handlers.join('\n')}
  const processingImport=!!importStage||busy&&!!jobId;
  const showJobStatus=!busy&&(!!jobId||jobPhase==='checking'||jobPhase==='failed'||jobPhase==='missing');
  const jobProgressValue=jobPhase==='running'&&progressValue<=0?undefined:progressValue;
  const jobStatusText=busy?note||jobMessage:jobMessage;
  window.state=()=>({busy,historyRunning,historyState,jobId,jobPhase,note,error,saved:library?.records.length||0,ids:library?.records.map(row=>row.id)||[],checkpoint:readHistoryProgress(owner,friend),returnedToReport:revealReportAfterImport.current});
  return <main className={ui.wrap}><h1>采集恢复回归 · {window.mode}</h1>
    {!busy&&jobPhase==='idle'&&<button className={ui.primary} onClick={()=>void capture()}>{historyState&&!historyState.complete?'继续导入全部聊天':'开始合成导入'}</button>}
    ${progress}
    ${status}
    {error&&<p role="alert">{error}</p>}
    {!busy&&note&&<p role="status">{note}</p>}
    <output data-saved>{library?.records.length||0}</output>
  </main>;
}
createRoot(document.getElementById('app')).render(<Harness/>);
`;
const built=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:'.tmp/source-recovery.js',format:'iife',platform:'browser',jsx:'automatic',logLevel:'silent',external:['/images/*']});
const js=built.outputFiles.find(file=>file.path.endsWith('.js')).text,css=built.outputFiles.find(file=>file.path.endsWith('.css')).text;
const html=`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#fffbf6;font:16px/1.7 system-ui,sans-serif}main{padding:24px;max-width:1100px;margin:auto}${css}</style></head><body><div id="app"></div><script>${js}</script></body></html>`;
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const out='outputs/capture-source-recovery';await mkdir(out,{recursive:true});
try{
  const page=await browser.newPage(),errors=[],network=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>network.push(request.url()));
  async function clickText(text){const element=await page.waitForFunction(text=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===text),{},text);await element.click();}
  for(const mode of ['recover','partial','persistent','cancel']){
    await page.setViewport({width:mode==='recover'||mode==='persistent'?1280:390,height:850});
    await page.goto(base+'/?mode='+mode);await clickText('开始合成导入');
    await page.waitForFunction(()=>window.state().note.includes('自动继续'));
    let state=await page.evaluate(()=>window.state());assert.equal(state.historyState.complete,false);assert.equal(state.checkpoint.cursor,'cursor_500');assert.equal(state.saved,mode==='partial'?720:500);assert.equal(state.returnedToReport,false);
    assert.ok(await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='暂停导入')),'pause remains available between jobs');
    await page.screenshot({path:out+'/'+mode+'-recovering.png'});
    if(mode==='cancel'){
      const began=Date.now();await clickText('暂停导入');await page.waitForFunction(()=>!window.state().busy);
      assert.ok(Date.now()-began<900);state=await page.evaluate(()=>window.state());
      assert.equal(state.saved,500);assert.equal(state.checkpoint.complete,false);assert.equal(state.checkpoint.pendingJob,null);
      assert.equal((await page.evaluate(()=>window.calls.filter(call=>call.path==='/capture'))).length,2);
      assert.match(state.note,/已暂停/);assert.equal(state.returnedToReport,false);
      await page.screenshot({path:out+'/cancelled.png'});continue;
    }
    if(mode==='persistent'){
      await page.waitForFunction(()=>!window.state().busy&&window.state().jobPhase==='failed');
      state=await page.evaluate(()=>window.state());assert.equal(state.saved,500);assert.equal(state.checkpoint.complete,false);assert.equal(state.checkpoint.pendingJob,null);assert.equal(state.returnedToReport,false);
      assert.match(await page.$eval('[data-job-phase="failed"]',node=>node.textContent),/已保存 500 条.*继续导入/);
      assert.equal((await page.evaluate(()=>window.calls.filter(call=>call.path==='/capture'))).length,4);
      await page.screenshot({path:out+'/persistent-continue.png'});
      await page.evaluate(()=>{window.allowRecovery=true;});await clickText('继续导入');
    }
    await page.waitForFunction(()=>window.state().checkpoint?.complete&&!window.state().busy);
    state=await page.evaluate(()=>window.state());assert.equal(state.saved,720);assert.equal(new Set(state.ids).size,720);assert.equal(state.checkpoint.count,720);assert.equal(state.checkpoint.pages,2);assert.equal(state.returnedToReport,true);
    const calls=await page.evaluate(()=>window.calls),starts=calls.filter(call=>call.path==='/capture');
    assert.equal(starts.filter(call=>!call.body.cursor).length,1);assert.ok(starts.slice(1).every(call=>call.body.cursor==='cursor_500'));
    assert.ok(calls.every(call=>call.path==='/health'||call.path==='/capture'||call.path.startsWith('/jobs/')),'recovery cannot call paid/analysis endpoints');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:out+'/'+mode+'-complete.png'});
  }
  await page.goto(base+'/?mode=stalled');await clickText('开始合成导入');
  await page.waitForFunction(()=>!window.state().busy&&window.state().error.includes('尚未返回聊天'));
  let stalled=await page.evaluate(()=>window.state());
  assert.equal(stalled.saved,0);assert.equal(stalled.jobId,'job_1');assert.equal(stalled.checkpoint.pendingJob,'job_1');
  assert.match(await page.$eval('[data-job-phase="running"]',node=>node.textContent),/没有新进展.*继续导入/);
  assert.equal((await page.evaluate(()=>window.calls.filter(call=>call.path==='/capture'))).length,1);
  assert.equal(await page.evaluate(()=>!!document.querySelector('[data-import-stage]')),false,'stalled import must exit the animated waiting shield');
  await page.screenshot({path:out+'/stalled-reconnect.png'});
  await page.evaluate(()=>{window.allowRecovery=true;});await clickText('继续导入');
  await page.waitForFunction(()=>window.state().checkpoint?.complete&&!window.state().busy);
  stalled=await page.evaluate(()=>window.state());assert.equal(stalled.saved,720);assert.equal(stalled.error,'');
  assert.equal((await page.evaluate(()=>window.calls.filter(call=>call.path==='/capture'))).length,2,'resume polls job_1 and starts only the final page');
  assert.deepEqual(errors,[]);assert.ok(network.every(url=>url.startsWith(base)));
  const result={passed:true,transport:'synthetic local helper',storage:'real Chrome IndexedDB',production:['capture handler','cancel handler','progress/status controls','history state machine'],checks:['500 rows then same-cursor retry','partial-page replay without duplicates','bounded failures and working Continue button','immediate pause during retry delay','zero-row stall exits animation and reconnects the same job','no completion before final page','no analysis/credits/network side effects'],viewports:[1280,390]};
  await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
