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
import{createArchiveSessionCache}from'./lib/archive-session-cache';
window.createArchiveSessionCache=createArchiveSessionCache;
window.identity='owner-A';window.calls=[];window.hold=false;window.pending=[];window.fail=false;window.contextVersion='first-context';
window.fixture={enabled:true,paused:false,self:{city:'Fixture city'},subjects:[{id:'11111111-1111-4111-8111-111111111111',label:'Synthetic Alice',updatedAt:100}],facts:[],signals:[],trends:[]};
window.fetch=async(path,options={})=>{const u=new URL(String(path),location.href);window.calls.push(u.pathname+u.search);
if(u.pathname==='/api/web/account-context')return Response.json({account:{userId:window.identity,balance:20},people:[],prices:{},user:{name:'Fixture'}});
if(u.pathname==='/api/account/credits'||u.pathname==='/api/web/profile'){
 const data=u.pathname==='/api/account/credits'?{account:{userId:window.identity}}:structuredClone(window.fixture);
 if(u.pathname==='/api/web/profile')for(const person of data.subjects)person.relationshipContext=!window.noContext&&u.searchParams.get('subjectId')===person.id?{testMarker:window.contextVersion}:null;
 if(window.hold&&(!options.method||options.method==='GET'))return new Promise(resolve=>window.pending.push({url:u.pathname+u.search,finish:status=>resolve(Response.json(status===200?data:{error:'Synthetic unavailable'},{status}))}));
 if(window.fail)return Response.json({error:'Synthetic unavailable'},{status:503});if(window.holdAfterPost&&options.method==='POST'){window.hold=true;window.holdAfterPost=false;}return Response.json(data);}
throw Error('Unexpected request '+u.pathname);};
window.navigate=navigate;window.changeOwner=async owner=>{window.identity=owner;announceAccountChange();await webAccountStore.refresh();};window.profileMutation=()=>api('/api/web/profile',{action:'self',data:{city:'Synthetic new'}});
installDesktopNavigation(new Set(['/archive','/workspace']));
function App(){const p=new URL(useDesktopLocation(),location.origin).pathname;return p==='/archive'?<ArchivePage/>:<main>Other workspace</main>;}
createRoot(document.getElementById('root')).render(<App/>);`;
const built = await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'synthetic-archive-heavy-panels',setup(b){
  b.onResolve({filter:/^next\/navigation$/},()=>({path:resolve('desktop/app/frontend/navigation.tsx')}));
  b.onLoad({filter:/components[\\/](RelationshipJourney|ReportDetails|SelfChatMemory|QuickSelfProfile|ArchiveAvatar|PersonAvatarChoice|PersonOverview|ArchiveImportedActivity|ArchiveComparison|ArchiveFeedback|ArchiveInsights)\.tsx$/},()=>({loader:'tsx',contents:`import React from 'react';const Empty=()=>null;export const RelationshipJourney=Empty,SelfChatMemory=Empty,QuickSelfProfile=Empty,ArchiveAvatar=Empty,PersonAvatarChoice=Empty,ArchiveImportedActivity=Empty,ArchiveComparison=Empty,ArchiveFeedback=Empty,EventDateEditor=Empty,CommunicationReading=Empty,MomentsReportView=Empty;export const PersonOverview=({person})=><section data-person-overview data-context={person.relationshipContext?.testMarker||'none'} data-updated={person.updatedAt}>{person.label}</section>;export const ReportDetails=({children})=><div>{children}</div>;`}));
  b.onLoad({filter:/\.css$/},()=>({loader:'js',contents:'export default new Proxy({},{get:(_,key)=>String(key)});'}));
}}]});
const server=createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><div id="root"></div><script>${built.outputFiles[0].text}</script>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const text=()=>page.$eval('body',e=>e.innerText);
const navigate=async path=>{await page.evaluate(path=>window.navigate(path),path);await page.waitForFunction(path=>location.pathname===path.split('?')[0],{},path);};
const settle=async status=>{await page.evaluate(status=>{window.pending.splice(0).forEach(item=>item.finish(status));window.hold=false;},status);};
const selectedPath='/archive?subjectId=11111111-1111-4111-8111-111111111111';
const context=async value=>page.waitForFunction(value=>document.querySelector('[data-person-overview]')?.getAttribute('data-context')===value,{},value);
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/archive`);
  await page.waitForFunction(()=>document.body.innerText.includes('Synthetic Alice'));
  assert.equal(await page.evaluate(()=>window.calls.filter(p=>p==='/api/web/profile').length),1);
  assert.equal(await page.evaluate(()=>window.calls.filter(p=>p==='/api/account/credits').length),1);
  await navigate('/workspace');await page.evaluate(()=>window.hold=true);
  await navigate('/archive?subjectId=11111111-1111-4111-8111-111111111111');
  await page.waitForSelector('[data-person-overview]',{timeout:1200});
  assert.doesNotMatch(await text(),/正在读取你的档案/,'cached selected person appears before either API resolves');
  await page.waitForFunction(()=>window.pending.length===2); // Base+owner run together; detail waits for the authoritative base.
  await settle(200);
  await context('first-context');

  // The previous detail is still within its 60-second reuse window. A fresh
  // base must invalidate it and trigger a new selected-person detail anyway.
  await navigate('/workspace');await page.evaluate(()=>{window.fixture.subjects[0].updatedAt=200;window.contextVersion='new-details';window.hold=true;});
  await navigate(selectedPath);await context('first-context');
  await page.waitForFunction(()=>window.pending.length===2);await settle(200);
  await context('new-details');
  assert.equal(await page.$eval('[data-person-overview]',element=>element.getAttribute('data-updated')),'200');

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
  assert.equal(await page.$eval('[data-person-overview]',element=>element.getAttribute('data-context')),'after-mutation');
  assert.equal(await page.$eval('[data-person-overview]',element=>element.getAttribute('data-updated')),'300');

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
  assert.equal(await page.$eval('[data-person-overview]',element=>element.getAttribute('data-updated')),'400');

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
  await context('none');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>window.calls.filter(path=>path.includes('subjectId=')).length),beforeNull+1,'null context does not cause repeated reads');
  await page.evaluate(()=>window.noContext=false);
  await navigate('/workspace');await page.evaluate(()=>window.fail=true);await navigate('/archive');
  await page.waitForFunction(()=>document.body.innerText.includes('Synthetic unavailable'));
  assert.match(await text(),/Synthetic Alice/,'transient refresh failure keeps the existing archive');
  assert.doesNotMatch(await text(),/档案暂时打不开/);
  await page.evaluate(()=>window.fail=false);await navigate('/workspace');await page.evaluate(()=>window.profileMutation());
  await page.evaluate(()=>window.hold=true);await navigate('/archive');
  await page.waitForFunction(()=>document.body.innerText.includes('正在读取你的档案'));
  assert.doesNotMatch(await text(),/Synthetic Alice/,'confirmed profile mutation invalidates the return cache');
  await settle(200);await page.waitForFunction(()=>document.body.innerText.includes('Synthetic Alice'));
  await navigate('/workspace');await page.evaluate(()=>{window.fixture.subjects[0].label='Synthetic Bob';window.hold=true;});
  await page.evaluate(()=>window.changeOwner('owner-B'));await navigate('/archive');
  await page.waitForFunction(()=>document.body.innerText.includes('正在读取你的档案'));
  assert.doesNotMatch(await text(),/Synthetic Alice/,'another login never sees the old archive');
  await settle(200);await page.waitForFunction(()=>document.body.innerText.includes('Synthetic Bob'));
  await navigate('/workspace');await page.evaluate(()=>window.hold=true);await navigate('/archive');
  await page.waitForFunction(()=>window.pending.length>=2);await settle(401);
  await page.waitForFunction(()=>document.body.innerText.includes('登录后查看你的档案'));
  assert.doesNotMatch(await text(),/Synthetic Bob/,'401 removes a cached archive');
  assert.deepEqual(errors,[]);
  console.log('PASS actual archive ReactDOM: immediate cached person, parallel base/owner, changed-person refresh, deleted-source purge, late detail rejection, focused merge, 60s expiry, mutation invalidation, account isolation and 401 purge.');
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
