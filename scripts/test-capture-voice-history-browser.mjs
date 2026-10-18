import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

// A real browser/UI/IndexedDB run. Every API and loopback helper call is synthetic.
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798',owner='voice-history-owner',friend='合成语音分页人物',wechat='synthetic-wx-account';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const total=2705,voiceTotal=2703,out='outputs/capture-voice-history';await mkdir(out,{recursive:true});
const contacts={contactId:'synthetic-contact-a',accountKey:'synthetic-account-key'};
let phase='pause',releaseRefresh=false,lateAvailable=false;
const records=Array.from({length:total},(_,i)=>({id:'wechat-db:history-'+i,kind:i>0&&i<total-1?'other':'text',sender:i%2?friend:'我',senderRole:i%2?'other':'self',at:new Date(Date.UTC(2026,9,1,0,i)).toISOString(),text:i===0?'第一条文字必须保留。'.repeat(100):i===total-1?'最后一条文字必须保留。':'[语音]',source:{label:'合成数据库语音分页',method:'wechat-local-db',idStability:'stable',timestampOrigin:'wechat-create-time',accountId:wechat,sessionId:contacts.contactId,messageShard:'message_0.db',messageId:String(i),...(i>0&&i<total-1?{mediaKind:'voice',durationSeconds:6,transcriptionStatus:'not-transcribed',voiceAvailability:'available'}:{})}}));
const captures=[],jobs=new Map(),siteWrites=[],errors=[],blocked=[];
function makeBatch(body,converted='all'){
 const offset=body.cursor?Number(body.cursor.slice(2)):0,count=Math.max(0,Math.min(body.pageSize,total-offset)),start=total-offset-count,hasMore=offset+count<total;
 return{version:1,kind:'chat',friend:body.friend,account:wechat,capturedAt:'2026-10-18T00:00:00Z',warnings:[],records:records.slice(start,start+count).map((row,index)=>{
  if(!body.includeVoice||row.source.mediaKind!=='voice')return structuredClone(row);
  const failed=row.id==='wechat-db:history-2'&&!lateAvailable;
  if(converted!=='all'&&index>=converted)return structuredClone(row);
  return failed?{...row,source:{...row.source,transcriptionStatus:'failed',voiceAvailability:'transcribe-failed'}}:{...row,kind:'text',text:'第 '+row.source.messageId+' 条合成语音完整转写',source:{...row.source,transcriptionStatus:'visible-text',voiceAvailability:'transcribed',transcriptionSource:'local-audio-asr'}};
 }),history:{version:1,direction:body.direction,count,hasMore,nextCursor:hasMore?'c_'+(offset+count):null,snapshot:'s_'+total,complete:!hasMore}};
}
const bundle=await build({stdin:{contents:'export * from "./lib/desktop-capture-vault"; export {readHistoryProgress} from "./lib/capture-history-import";',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'HistoryVoiceVault',platform:'browser'});
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width:1440,height:950});page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
page.on('request',async r=>{try{
 const u=new URL(r.url()),bridge=u.hostname==='127.0.0.1'&&u.port==='17863';
 if(!bridge&&u.origin!==origin){if(['data:','blob:'].includes(u.protocol))return r.continue();blocked.push(u.origin+u.pathname);return r.abort();}
 if(!bridge&&!u.pathname.startsWith('/api/'))return r.continue();
 let value={},status=200;
 if(bridge){
  if(r.method()==='OPTIONS'){}
  else if(u.pathname==='/health')value={version:'1.2.6-test',ready:true,backgroundModelReady:true,capabilities:{chat:true,moments:true,backgroundChat:true,backgroundHistory:true,backgroundVoice:true,deferredVoice:true,momentsAllVisible:true}};
  else if(u.pathname==='/session')value={connected:true};
  else if(u.pathname==='/pair')value={token:'synthetic-token',expiresIn:28800};
  else if(u.pathname==='/contacts/search')value={accountKey:contacts.accountKey,contacts:[{contactId:contacts.contactId,label:friend,nickname:friend,wechatId:'fixture-a'},{contactId:'wrong-contact',label:friend+'另一个',nickname:friend,wechatId:'fixture-b'}]};
  else if(u.pathname==='/capture'){
   const body=JSON.parse(r.postData());assert.equal(body.contactId,contacts.contactId);assert.equal(body.accountKey,contacts.accountKey);assert.equal(body.friend,friend);assert.equal(body.mode,'background');assert.equal(body.pageSize,body.includeVoice?100:500);assert.equal('limit' in body,false);
   const id='history-job-'+(captures.length+1);captures.push(body);jobs.set(id,{id,body,reads:0,cancelled:false,phase});value={jobId:id};
  }else if(u.pathname.startsWith('/jobs/')){
   const id=u.pathname.split('/')[2],job=jobs.get(id);assert.ok(job,'known job '+id);
   if(u.pathname.endsWith('/cancel')){job.cancelled=true;value={status:'cancelled',partialRevision:2,partial:makeBatch(job.body,8)};}
   else{job.reads++;const offset=job.body.cursor?Number(job.body.cursor.slice(2)):0;
    const hold=job.body.includeVoice&&(job.phase==='pause'||phase==='refresh'&&offset===100&&!releaseRefresh);
    value=job.cancelled?{status:'cancelled'}:hold?{status:'running',progress:15,message:'正在补齐本页语音，已保留完成部分',partialRevision:1,partial:makeBatch(job.body,5)}:{status:'done',result:makeBatch(job.body)};
   }
  }else{status=404;value={error:{code:'NOT_FOUND',message:'未声明合成接口'}};}
 }else{
  if(r.method()!=='GET')siteWrites.push(u.pathname);
  if(u.pathname==='/api/auth/session')value={loggedIn:true,user:{id:owner}};
  else if(u.pathname==='/api/account/credits')value={account:{userId:owner,balance:1000,active:true},prices:{analysisSmall:3,profile:5}};
  else if(u.pathname==='/api/web/profile')value={enabled:true,paused:false,self:{},subjects:[],facts:[],signals:[],trends:[]};
  else if(u.pathname==='/api/web/capture/library')value={ownerId:owner,libraries:[]};
  else if(u.pathname==='/api/web/report/list')value={reports:[]};
 }
 await r.respond({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Private-Network':'true'},body:JSON.stringify(value)});
}catch(e){errors.push('mock: '+e.message);await r.abort().catch(()=>{});}});
const vault=()=>page.addScriptTag({content:bundle.outputFiles[0].text});
const snapshot=()=>page.evaluate(async({owner,friend})=>{const all=await HistoryVoiceVault.listCaptureLibraries(owner),summary=all.find(x=>x.friend===friend),library=summary?await HistoryVoiceVault.getCaptureLibrary(owner,summary.id):null;return{all:all.map(x=>({friend:x.friend,total:x.total})),id:library?.id,records:library?.records||[],links:library?.reportLinks||[],text:HistoryVoiceVault.readHistoryProgress(owner,friend),voice:HistoryVoiceVault.readHistoryProgress(owner+':voice',friend),job:JSON.parse(sessionStorage.getItem('chengzi-capture:'+owner+':job')||'null')};},{owner,friend});
const waitSnapshot=async predicate=>{const end=Date.now()+60000;let value;while(Date.now()<end){value=await snapshot();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,200));}throw Error('snapshot timeout '+JSON.stringify({rows:value?.records?.length,text:value?.text,voice:value?.voice,job:value?.job}));};
const click=async text=>{await page.waitForFunction(text=>[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===text&&!e.disabled&&e.checkVisibility()),{timeout:20000},text);await page.evaluate(text=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===text&&!e.disabled&&e.checkVisibility()).click(),text);};
async function statusTab(){await page.evaluate(()=>{const e=[...document.querySelectorAll('[aria-label="材料查看"] button')].find(e=>e.textContent.includes('导入情况与同步'));if(e&&e.getAttribute('aria-selected')!=='true')e.click();});}
try{
 await page.goto(origin+'/capture?method=desktop&kind=chat',{waitUntil:'networkidle0'});await vault();await page.$eval('#capture-code',e=>e.closest('details').open=true);await page.type('#capture-code','TESTCODE');await click('连接');await page.waitForSelector('input[placeholder="输入好友的备注或昵称"]');await page.type('input[placeholder="输入好友的备注或昵称"]',friend);await page.waitForSelector('[aria-label="选择要导入的微信联系人"] button');await page.evaluate(()=>[...document.querySelectorAll('[aria-label="选择要导入的微信联系人"] button')].find(e=>e.textContent.includes('fixture-a')).click());
 const textButton=await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('只')&&e.textContent.includes('聊天'))?.textContent.trim());assert.ok(textButton);await click(textButton);
 const partial=await waitSnapshot(s=>s.records.length===total&&s.voice?.pendingJob&&s.records.filter(r=>r.source.transcriptionStatus==='visible-text').length>=5);
 assert.equal(partial.text.complete,true);assert.equal(partial.text.pages,6);assert.equal(captures.filter(b=>!b.includeVoice).length,6);assert.equal(captures.filter(b=>b.includeVoice).length,1,'voice starts automatically once after text');const textCheckpoint=partial.text;
 const ids=partial.records.map(r=>r.localId).sort();const initialVoiceJob=partial.job.jobId;
 await page.evaluate(async({owner,friend,id})=>{const lib=await HistoryVoiceVault.getCaptureLibrary(owner,id);await HistoryVoiceVault.linkReportSources(owner,'synthetic-kept-report',{libraryId:id,sourceIds:lib.records.slice(0,2).map(r=>r.localId)});await HistoryVoiceVault.saveCaptureBatch(owner,{version:1,kind:'chat',friend:'无关人物',account:'synthetic-wx-account',capturedAt:'2026-10-18T00:00:00Z',warnings:[],records:[{id:'unrelated',kind:'text',sender:'对方',senderRole:'other',text:'其他人的原文不应被覆盖',at:'2026-10-01',source:{label:'合成',method:'uia'}}]});},{owner,friend,id:partial.id});
 assert.ok(await page.$eval('#capture-preview',e=>e.checkVisibility()),'voice enrichment keeps the report stage visible');assert.ok(await page.$eval('[data-voice-progress]',e=>e.checkVisibility()));
 await click('暂停补全');const paused=await waitSnapshot(s=>!s.job&&!s.voice.pendingJob&&s.records.filter(r=>r.source.transcriptionStatus==='visible-text').length===8);
 assert.equal(jobs.get(initialVoiceJob).cancelled,true);assert.equal(paused.voice.count,0,'cancel partial does not advance page cursor');assert.deepEqual(paused.text,textCheckpoint,'voice pause preserves text checkpoint');const pausedStarts=captures.length;await new Promise(r=>setTimeout(r,1800));assert.equal(captures.length,pausedStarts,'pause does not auto restart');
 phase='refresh';await statusTab();await click('后台补全语音');const holding=await waitSnapshot(s=>s.voice?.count===100&&s.voice.pendingJob&&s.records.filter(r=>r.source.transcriptionStatus==='visible-text').length>100);const pending=holding.voice.pendingJob;const beforeReload=captures.length;
 await page.reload({waitUntil:'networkidle0'});await vault();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='继续导入'&&!e.disabled));
 assert.equal(captures.length,beforeReload,'refresh does not create another helper task');assert.equal((await snapshot()).job.voiceHistory,true,'refresh retains voice job type');
 await click('继续导入');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='暂停导入'));assert.equal(captures.length,beforeReload,'resume polls the existing helper task');assert.equal((await snapshot()).voice.pendingJob,pending);
 releaseRefresh=true;phase='finish';const done=await waitSnapshot(s=>s.voice?.complete&&!s.job);
 assert.equal(done.records.length,total);assert.equal(done.records.filter(r=>r.source.transcriptionStatus==='visible-text').length,voiceTotal-1);assert.equal(done.voice.count,total);assert.equal(done.voice.pages,28);assert.deepEqual(done.text,textCheckpoint);assert.deepEqual(done.records.map(r=>r.localId).sort(),ids,'enrichment never creates duplicate messages');assert.equal(done.records.find(r=>r.id===records[0].id).text,records[0].text);assert.equal(done.records.find(r=>r.id===records.at(-1).id).text,records.at(-1).text);assert.ok(done.links.some(r=>r.reportId==='synthetic-kept-report'));assert.ok(done.all.some(r=>r.friend==='无关人物'&&r.total===1));
 const finishedStarts=captures.length;await new Promise(r=>setTimeout(r,1800));assert.equal(captures.length,finishedStarts,'completed voice does not loop');await page.screenshot({path:out+'/completed-first-pass.png',fullPage:true});
 lateAvailable=true;await statusTab();await click('后台补全语音');const recovered=await waitSnapshot(s=>s.voice?.complete&&!s.job&&s.records.filter(r=>r.source.transcriptionStatus==='visible-text').length===voiceTotal);
 const repeated=captures.slice(finishedStarts);assert.equal(repeated.length,28,'retry revisits all history including old failed voice');assert.ok(repeated.every(r=>r.includeVoice));assert.equal(repeated[0].since,undefined,'old failed voice is not skipped by incremental since');assert.equal(repeated[0].direction,'backward');assert.deepEqual(recovered.text,textCheckpoint);assert.deepEqual(recovered.records.map(r=>r.localId).sort(),ids);assert.equal(recovered.voice.count,total);
 const finalStarts=captures.length;await page.reload({waitUntil:'networkidle0'});await vault();await new Promise(r=>setTimeout(r,1800));assert.equal(captures.length,finalStarts,'reload of complete history remains idle');const final=await snapshot();assert.equal(final.records.filter(r=>r.source.transcriptionStatus==='visible-text').length,voiceTotal);assert.deepEqual(final.text,textCheckpoint);
 assert.deepEqual(siteWrites,[],'voice does not upload, analyze or charge');assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
 await writeFile(out+'/result.json',JSON.stringify({passed:true,voiceTotal,textPages:6,voicePages:28,captures:captures.length,pausedPartial:8,resumedJob:pending,records:final.records.length,siteWrites},null,2));
 console.log('PASS real-browser synthetic 2703 voices: six text pages, 28 voice pages, cancellation ACK partial, same-job refresh/resume, full retry of old failed voice, unchanged text checkpoint/source IDs/report links/other contact, no auto loop or paid writes.');
}catch(error){console.error(JSON.stringify({message:error.message,captures:captures.map(b=>({voice:b.includeVoice,cursor:b.cursor,since:b.since,size:b.pageSize})),errors,alerts:await page.$$eval('[role="alert"]',es=>es.map(e=>e.textContent)).catch(()=>[])}));await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});throw error;}finally{await context.close();await browser.close();}
