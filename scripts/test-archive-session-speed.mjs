import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import ArchivePage from './app/archive/page';
import{installDesktopNavigation,useDesktopLocation,navigate}from'./desktop/app/frontend/navigation';
import{webAccountStore,announceAccountChange}from'./lib/web-account-session';
import{api}from'./components/web-analysis/client';
import{createArchiveSessionCache,archiveSession}from'./lib/archive-session-cache';
window.createArchiveSessionCache=createArchiveSessionCache;window.archiveSession=archiveSession;
window.identity='owner-A';window.calls=[];window.hold=false;window.pending=[];window.fail=false;window.contextVersion='first-context';window.aborted=0;
window.fixture={enabled:true,paused:false,self:{city:'Fixture city'},subjects:[{id:'11111111-1111-4111-8111-111111111111',label:'Synthetic Alice',updatedAt:100,savedChatAnalysis:{reportId:'saved-report',createdAt:100,kind:'chat',summary:'Saved relationship judgment',activitySnapshot:{messages:441,self:250,other:191,unknown:0,activeDays:14,starts:{comparable:0,self:0,other:0}}}}],facts:[],signals:[],trends:[]};
window.fetch=async(path,options={})=>{const u=new URL(String(path),location.href);window.calls.push(u.pathname+u.search);
if(u.pathname==='/api/web/account-context')return Response.json({account:{userId:window.identity,balance:20},people:[],prices:{},user:{name:'Fixture'}});
if(u.pathname==='/api/account/credits'||u.pathname==='/api/web/profile'){
 const focused=u.pathname==='/api/web/profile'&&u.searchParams.get('detailOnly')==='1',person=window.fixture.subjects.find(row=>row.id===u.searchParams.get('subjectId'));
 const data=u.pathname==='/api/account/credits'?{account:{userId:window.identity}}:focused?{enabled:window.fixture.enabled,paused:!!window.detailPaused||window.fixture.paused,subjectId:person.id,subjectUpdatedAt:window.changedDetail?person.updatedAt+1:person.updatedAt,relationshipContext:window.noContext||window.detailPaused?null:{subjectId:window.wrongContext?'unrelated-person':person.id,testMarker:window.contextVersion,coverage:{activityStatus:'current'}}}:structuredClone(window.fixture);
 if(u.pathname==='/api/web/profile'&&!focused)for(const person of data.subjects)person.relationshipContext=null;
 if(focused&&window.detailFail)return Response.json({error:'Synthetic detail unavailable'},{status:503});
 if(focused&&window.detailTimeout)throw new DOMException('Synthetic timeout','TimeoutError');
 if((window.hold||focused&&window.holdDetail)&&(!options.method||options.method==='GET'))return new Promise((resolve,reject)=>{window.pending.push({url:u.pathname+u.search,finish:status=>resolve(Response.json(status===200?data:{error:'Synthetic unavailable'},{status}))});options.signal?.addEventListener('abort',()=>{window.aborted++;if(!window.ignoreAbort)reject(new DOMException('Synthetic abort','AbortError'));},{once:true});});
 if(window.fail)return Response.json({error:'Synthetic unavailable'},{status:503});if(window.holdAfterPost&&options.method==='POST'){window.hold=true;window.holdAfterPost=false;}return Response.json(data);}
throw Error('Unexpected request '+u.pathname);};
window.navigate=navigate;window.changeOwner=async owner=>{window.identity=owner;announceAccountChange();await webAccountStore.refresh();};window.profileMutation=()=>api('/api/web/profile',{action:'self',data:{city:'Synthetic new'}});
installDesktopNavigation(new Set(['/archive','/workspace']));
function App(){const p=new URL(useDesktopLocation(),location.origin).pathname;return p==='/archive'?<ArchivePage/>:<main>Other workspace</main>;}
createRoot(document.getElementById('root')).render(<App/>);`;
const built = await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'synthetic-archive-heavy-panels',setup(b){
  b.onResolve({filter:/^next\/navigation$/},()=>({path:resolve('desktop/app/frontend/navigation.tsx')}));
  b.onLoad({filter:/components[\\/](RelationshipJourney|ReportDetails|SelfChatMemory|QuickSelfProfile|ArchiveAvatar|PersonAvatarChoice|ArchiveImportedActivity|ArchiveComparison|ArchiveFeedback|ArchiveInsights)\.tsx$/},()=>({loader:'tsx',contents:`import React from 'react';const Empty=()=>null;export const SelfChatMemory=Empty,QuickSelfProfile=Empty,ArchiveAvatar=Empty,PersonAvatarChoice=Empty,ArchiveComparison=Empty,ArchiveFeedback=Empty,EventDateEditor=Empty,CommunicationReading=Empty,MomentsReportView=Empty;export const ArchiveImportedActivity=()=>{throw Error('Duplicate archive activity reader mounted')};export const RelationshipJourney=({context})=><section data-relationship-journey data-context={context.testMarker}>Timeline {context.testMarker}</section>;export const RelationshipSnapshot=({activity})=><span data-activity-snapshot>{activity?.messages} 条</span>;export const ReportDetails=({children})=><div>{children}</div>;`}));
  b.onLoad({filter:/\.css$/},()=>({loader:'js',contents:'export default new Proxy({},{get:(_,key)=>String(key)});'}));
}}]});
const server=createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><div id="root"></div><script>${built.outputFiles[0].text}</script>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const text=()=>page.$eval('body',e=>e.innerText);
const navigate=async path=>{await page.evaluate(path=>window.navigate(path),path);await page.waitForFunction(path=>location.pathname===path.split('?')[0],{},path);};
const settle=async status=>{await page.evaluate(status=>{window.pending.splice(0).forEach(item=>item.finish(status));window.hold=false;},status);};
const overviewPath='/archive?subjectId=11111111-1111-4111-8111-111111111111',selectedPath=overviewPath+'&section=trend';
const context=async value=>page.waitForFunction(value=>value==='none'?!document.querySelector('[data-relationship-journey]'):document.querySelector('[data-relationship-journey]')?.getAttribute('data-context')===value,{},value);
const click=async label=>{await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(item=>item.textContent.trim()===label),{},label);await page.evaluate(label=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===label).click(),label);};
const frames=async()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const detailCount=async()=>page.evaluate(()=>window.calls.filter(path=>path.includes('detailOnly=1')).length);
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/archive`);
  await page.waitForFunction(()=>document.body.innerText.includes('Synthetic Alice'));
  assert.equal(await page.evaluate(()=>window.calls.filter(p=>p==='/api/web/profile?listOnly=1').length),1);
  assert.equal(await page.evaluate(()=>window.calls.filter(p=>p==='/api/web/profile').length),0,'initial list skips the unused self-memory projection');
  assert.equal(await page.evaluate(()=>window.calls.filter(p=>p==='/api/account/credits').length),1);
  await navigate('/workspace');await page.evaluate(()=>window.hold=true);
  await navigate(overviewPath);
  await page.waitForSelector('[aria-label="人物关系概览"]',{timeout:1200});
  assert.doesNotMatch(await text(),/正在读取你的档案/,'cached selected person appears before either API resolves');
  await page.waitForFunction(()=>window.pending.length===2); // Base+owner run together; detail waits for the authoritative base.
  await settle(200);
  await frames();assert.equal(await detailCount(),0,'overview never reads full relationship context');
  assert.match(await text(),/Saved relationship judgment/);assert.match(await text(),/上次报告统计/);assert.match(await text(),/441 条/);
  await click('历程');
  await context('first-context');
  assert.equal(await detailCount(),1,'first timeline visit reads only one focused detail');
  await click('现状');await click('历程');await context('first-context');await frames();
  assert.equal(await detailCount(),1,'returning to the same fresh timeline reuses its context');

  // The previous detail is still within its 60-second reuse window. A fresh
  // base must invalidate it and trigger a new selected-person detail anyway.
  await navigate('/workspace');await page.evaluate(()=>{window.fixture.subjects[0].updatedAt=200;window.contextVersion='new-details';window.hold=true;});
  await navigate(selectedPath);await context('first-context');
  await page.waitForFunction(()=>window.pending.length===2);await settle(200);
  await context('new-details');
  assert.equal(await page.evaluate(()=>window.archiveSession('owner-A').value.subjects[0].updatedAt),200);

  // A linked source deletion need not update the subject timestamp. Hold the
  // new detail after the base arrives: the previous context must already be gone.
  await navigate('/workspace');await page.evaluate(()=>{window.contextVersion='sources-deleted';window.hold=true;});
  await navigate(selectedPath);await context('new-details');
  await page.waitForFunction(()=>window.pending.length===2);
  await page.evaluate(()=>window.pending.splice(0).forEach(item=>item.finish(200)));
  await context('none');
  await page.waitForFunction(()=>window.pending.some(item=>item.url.includes('subjectId=')));
  await settle(200);await context('sources-deleted');

  // A successful external mutation races an older selected-person response.
  // Releasing that older response last cannot restore it into the new archive.
  await navigate('/workspace');await page.evaluate(()=>{window.contextVersion='stale-detail';window.hold=true;});
  await navigate(selectedPath);await page.waitForFunction(()=>window.pending.length===2);
  await page.evaluate(()=>window.pending.splice(0).forEach(item=>item.finish(200)));
  await page.waitForFunction(()=>window.pending.some(item=>item.url.includes('subjectId=')));
  await page.evaluate(()=>{const held=window.pending.splice(0);window.oldDetail=held.filter(item=>item.url.includes('subjectId='));held.filter(item=>!item.url.includes('subjectId=')).forEach(item=>item.finish(200));window.fixture.subjects[0].updatedAt=300;window.contextVersion='after-mutation';});
  await page.evaluate(()=>window.profileMutation());
  await page.waitForFunction(()=>window.pending.length===2);await settle(200);await context('after-mutation');
  await page.evaluate(()=>window.oldDetail.forEach(item=>item.finish(200)));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await context('after-mutation');
  assert.equal(await page.evaluate(()=>window.archiveSession('owner-A').value.subjects[0].updatedAt),300);

  const cacheChecks=await page.evaluate(()=>{
    const cache=window.createArchiveSessionCache(),base=structuredClone(window.fixture),id=base.subjects[0].id;
    cache.bind('owner-A',1);cache.put('owner-A',1,cache.ticket(),base);
    const detail={...base,subjects:[{...base.subjects[0],relationshipContext:{testMarker:'verified'}}]};
    cache.put('owner-A',1,cache.ticket(),detail,id,1000);
    const beforeExpiry=cache.detailFresh(id,60999),expired=!cache.detailFresh(id,61000),clockReversed=!cache.detailFresh(id,999);
    const oldTicket=cache.ticket();cache.put('owner-A',1,cache.ticket(),{...base,self:{city:'new-base'},subjects:[{...base.subjects[0],relationshipContext:null}]});
    const oldDetailRejected=cache.put('owner-A',1,oldTicket,detail,id,2000)===null;
    const freshDetail={...detail,self:{city:'stale-self'},subjects:[...detail.subjects,{id:'removed',label:'Removed',updatedAt:1}]};
    cache.put('owner-A',1,cache.ticket(),freshDetail,id,2000);
    const focusedOnly=cache.get().self.city==='new-base'&&!cache.get().subjects.some(person=>person.id==='removed');
    const oldOwnerTicket=cache.ticket();cache.bind('owner-B',2);
    const oldOwnerRejected=cache.put('owner-A',1,oldOwnerTicket,detail,id,2000)===null&&cache.get()===null;
    const small=window.createArchiveSessionCache(2000);small.bind('owner-A',1);small.put('owner-A',1,small.ticket(),base);
    const oversized=small.put('owner-A',1,small.ticket(),{...freshDetail,subjects:[{...freshDetail.subjects[0],relationshipContext:{testMarker:'x'.repeat(3000)}},freshDetail.subjects[1]]},id,3000);
    const oversizedStillMerged=oversized.self.city===base.self.city&&!oversized.subjects.some(person=>person.id==='removed')&&small.get()===null;
    return{beforeExpiry,expired,clockReversed,oldDetailRejected,focusedOnly,oldOwnerRejected,oversizedStillMerged};
  });
  assert.deepEqual(cacheChecks,{beforeExpiry:true,expired:true,clockReversed:true,oldDetailRejected:true,focusedOnly:true,oldOwnerRejected:true,oversizedStillMerged:true});

  // Even a successful local POST must not acquire a new lease after its owner
  // recheck: another mutation can invalidate it during that await.
  await page.evaluate(()=>{window.holdAfterPost=true;const button=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='暂停档案');if(!button)throw Error('Missing actual archive action');button.click();});
  await page.waitForFunction(()=>window.pending.length===1&&window.pending[0].url==='/api/account/credits');
  await page.evaluate(()=>{window.fixture.subjects[0].updatedAt=400;window.contextVersion='after-owner-recheck';window.dispatchEvent(new Event('chengzi:profile-changed'));window.hold=false;window.pending.splice(0).forEach(item=>item.finish(200));});
  await context('after-owner-recheck');
  assert.equal(await page.evaluate(()=>window.archiveSession('owner-A').value.subjects[0].updatedAt),400);

  // A real >6M response is not memory-cached. Its new detail object must not
  // repeatedly retrigger the effect just because detailFresh remains false.
  await navigate('/workspace');
  const beforeLarge=await page.evaluate(()=>{window.fixture.self.large='x'.repeat(7_000_000);window.contextVersion='oversized-context';return window.calls.filter(path=>path.includes('subjectId=')).length;});
  await navigate(selectedPath);await context('oversized-context');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  assert.equal(await page.evaluate(()=>window.calls.filter(path=>path.includes('subjectId=')).length),beforeLarge+1,'oversized archive requests detail only once per load');
  await navigate('/workspace');
  const beforeNull=await page.evaluate(()=>{delete window.fixture.self.large;window.noContext=true;return window.calls.filter(path=>path.includes('subjectId=')).length;});
  await navigate(selectedPath);
  await page.waitForFunction(count=>window.calls.filter(path=>path.includes('subjectId=')).length===count+1,{},beforeNull);
  await page.waitForFunction(()=>document.body.innerText.includes('还没有关联的相处历程'));await context('none');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>window.calls.filter(path=>path.includes('subjectId=')).length),beforeNull+1,'null context does not cause repeated reads');
  await page.evaluate(()=>window.noContext=false);
  await click('重新读取历程');await context('oversized-context');

  // Only the selected timeline reads details. Failures are visible and a retry
  // cannot fall back to a second, duplicate paginated activity reader.
  await navigate('/workspace');await page.evaluate(()=>window.detailFail=true);await navigate(selectedPath);
  await page.waitForFunction(()=>document.body.innerText.includes('Synthetic detail unavailable'));
  await page.evaluate(()=>window.detailFail=false);await click('重新读取历程');await context('oversized-context');
  await navigate('/workspace');await page.evaluate(()=>window.detailTimeout=true);await navigate(selectedPath);
  await page.waitForFunction(()=>document.body.innerText.includes('连接暂时较慢'));
  await page.evaluate(()=>window.detailTimeout=false);await click('重新读取历程');await context('oversized-context');

  // A tab change aborts the pending read. Even a transport ignoring abort may
  // not overwrite the next attempt or hide its loading/error state.
  await navigate('/workspace');await page.evaluate(()=>{window.holdDetail=true;window.ignoreAbort=true;window.contextVersion='cancelled-detail';});await navigate(selectedPath);
  await page.waitForFunction(()=>window.pending.some(row=>row.url.includes('detailOnly=1')));
  await page.waitForFunction(()=>document.body.innerText.includes('正在读取这位人物的相处历程'));
  const aborts=await page.evaluate(()=>window.aborted);await click('现状');await page.waitForSelector('[aria-label="人物关系概览"]');
  await page.waitForFunction(count=>window.aborted>count,{},aborts);
  await page.evaluate(()=>{window.oldCancelled=window.pending.splice(0);window.holdDetail=false;window.contextVersion='after-cancel';});
  await click('历程');await context('after-cancel');
  await page.evaluate(()=>{window.oldCancelled.forEach(row=>row.finish(200));window.ignoreAbort=false;});await frames();await context('after-cancel');

  // A focused reply cannot replace the saved report or cross a changed person
  // version. Refreshing after that conflict obtains a new authoritative base.
  await navigate('/workspace');await page.evaluate(()=>window.changedDetail=true);await navigate(selectedPath);
  await page.waitForFunction(()=>document.body.innerText.includes('人物资料已变化'));
  await page.evaluate(()=>window.changedDetail=false);await click('重新读取历程');await context('after-cancel');
  await click('现状');assert.match(await text(),/Saved relationship judgment/);assert.match(await text(),/上次报告统计/);
  await navigate('/workspace');await page.evaluate(()=>window.wrongContext=true);await navigate(selectedPath);
  await page.waitForFunction(()=>document.body.innerText.includes('资料正在更新'));await context('none');
  await page.evaluate(()=>window.wrongContext=false);await click('重新读取历程');await context('after-cancel');
  await navigate('/workspace');await page.evaluate(()=>window.detailPaused=true);await navigate(selectedPath);
  await page.waitForFunction(()=>document.body.innerText.includes('恢复档案使用后'));await context('none');
  assert.equal(await page.evaluate(()=>window.archiveSession('owner-A').value.paused),true);
  await page.evaluate(()=>window.detailPaused=false);
  await navigate('/workspace');await page.evaluate(()=>window.fail=true);await navigate('/archive');
  await page.waitForFunction(()=>document.body.innerText.includes('Synthetic unavailable'));
  assert.match(await text(),/Synthetic Alice/,'transient refresh failure keeps the existing archive');
  assert.doesNotMatch(await text(),/档案暂时打不开/);
  await page.evaluate(()=>window.fail=false);await navigate('/workspace');await page.evaluate(()=>window.profileMutation());
  await page.evaluate(()=>window.hold=true);await navigate('/archive');
  await page.waitForFunction(()=>document.body.innerText.includes('正在读取你的档案'));
  assert.doesNotMatch(await text(),/Synthetic Alice/,'confirmed profile mutation invalidates the return cache');
  await settle(200);await page.waitForFunction(()=>document.body.innerText.includes('Synthetic Alice'));
  await navigate('/workspace');await page.evaluate(()=>{window.holdDetail=true;window.ignoreAbort=true;window.contextVersion='old-owner-context';});await navigate(selectedPath);
  await page.waitForFunction(()=>window.pending.some(row=>row.url.includes('detailOnly=1')));
  await page.evaluate(()=>{window.oldOwnerDetail=window.pending.splice(0);window.holdDetail=false;});
  await navigate('/workspace');await page.evaluate(()=>{window.fixture.subjects[0].label='Synthetic Bob';window.hold=true;});
  await page.evaluate(()=>window.changeOwner('owner-B'));await navigate('/archive');
  await page.waitForFunction(()=>document.body.innerText.includes('正在读取你的档案'));
  assert.doesNotMatch(await text(),/Synthetic Alice/,'another login never sees the old archive');
  await settle(200);await page.waitForFunction(()=>document.body.innerText.includes('Synthetic Bob'));
  await page.evaluate(()=>{window.oldOwnerDetail.forEach(row=>row.finish(200));window.ignoreAbort=false;});await frames();
  assert.equal(await page.evaluate(()=>window.archiveSession('owner-B').value.subjects[0].relationshipContext),null,'previous owner detail cannot populate the new owner cache');
  await navigate('/workspace');await page.evaluate(()=>window.hold=true);await navigate('/archive');
  await page.waitForFunction(()=>window.pending.length>=2);await settle(401);
  await page.waitForFunction(()=>document.body.innerText.includes('登录后查看你的档案'));
  assert.doesNotMatch(await text(),/Synthetic Bob/,'401 removes a cached archive');
  assert.deepEqual(errors,[]);
  console.log('PASS actual archive ReactDOM: saved overview without detail reads, on-demand focused timeline, no duplicate activity reader, cache return, retry/null/timeout/cancel, changed-person refresh, deleted-source purge, late result rejection, focused merge, bounded cache, mutation invalidation, account isolation and 401 purge.');
} catch(error) {console.error('Synthetic browser diagnostics:',errors,await text());throw error;} finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
