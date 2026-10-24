// Real ReportPage, AccountPage, account store, session cache and desktop router.
// Only network data and the large report presentation subtree are synthetic.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';

const entry=`import React from 'react';import{createRoot}from'react-dom/client';
import ReportPage from './app/report/page';import AccountPage from './app/account/page';
import{installDesktopNavigation,useDesktopLocation,navigate}from'./desktop/app/frontend/navigation';
import{webAccountStore,announceAccountChange}from'./lib/web-account-session';
import{cachedReport}from'./lib/report-session-cache';
window.documentMarker=crypto.randomUUID();window.testClock=1792800000000;window.identity='owner-A';window.balance=50;window.reads=0;window.writes=0;window.pending=[];window.hold=false;
window.payload={reportId:'77777777-1111-4111-8111-111111111111',kind:'chat',freshness:{status:'current',added:0,checkedAt:0,newLibraries:0,profileChanged:false,analysisUpdated:false},report:{id:'77777777-1111-4111-8111-111111111111',summary:'Synthetic saved report',participants:{self:{name:'Me'},other:{name:'Fixture'}},personalConnection:{commonPoints:['Shared photography']},personalConnectionContext:{basis:'current-confirmed-material',computedAt:0},compatibilityContext:{basis:'current-confirmed-profile',methodVersion:'v1',computedAt:0}}};
const fixtureImageCharacters=Number(new URL(location.href).searchParams.get('imageCharacters'))||0;
if(fixtureImageCharacters){window.payload.report.image='data:image/png;base64,'+'A'.repeat(fixtureImageCharacters);window.payload.report.analysisScope='uploadedHistory';window.payload.entries=[{id:window.payload.reportId,image:window.payload.report.image}];}
window.fetch=async(path,options={})=>{if(options.method&&options.method!=='GET'){window.writes++;throw Error('unexpected mutation');}
 const url=new URL(String(path),location.href);let body={};
 if(url.pathname==='/api/web/report'){window.reads++;body={...window.payload,freshness:{...window.payload.freshness,checkedAt:window.reads*1000+2},report:{...window.payload.report,personalConnectionContext:{...window.payload.report.personalConnectionContext,computedAt:window.reads*1000},compatibilityContext:{...window.payload.report.compatibilityContext,computedAt:window.reads*1000+1}}};if(window.hold)return new Promise(resolve=>window.pending.push(status=>resolve(Response.json(status===200?body:{error:'请登录后继续。'},{status}))));}
 else if(url.pathname==='/api/web/account-context'||url.pathname==='/api/account/credits')body={account:{userId:window.identity,balance:window.balance,reserved:0,spent:0,features:[],entries:[],active:true},people:[],prices:{text:1},user:{name:'Synthetic account'}};
 else throw Error('unexpected read '+url.pathname);
 return Response.json(body);};
window.cacheState=()=>({revision:webAccountStore.getRevision(),cached:!!cachedReport(window.identity,window.payload.reportId),session:document.querySelector('[data-report-session]')?.getAttribute('data-report-session'),reads:window.reads});
window.changeOwner=async owner=>{window.identity=owner;announceAccountChange();await webAccountStore.refresh();};
window.refreshAccount=()=>webAccountStore.refresh({force:true});
window.navigate=navigate;installDesktopNavigation(new Set(['/report','/account']));
function App(){const url=useDesktopLocation(),path=new URL(url,location.origin).pathname;return path==='/account'?<AccountPage key="account"/>:<ReportPage key="report"/>;}
createRoot(document.getElementById('root')).render(<App/>);`;
const built=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'synthetic-network-and-content-only',setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:resolve('desktop/app/frontend/navigation.tsx')}));
 b.onLoad({filter:/web-analysis[\\/]ReportView\.tsx$/},()=>({loader:'tsx',contents:`import React from 'react';import{useReportSessionState}from'./ReportSessionState';
 export function ChatReport({report}){const[draft,setDraft]=useReportSessionState('synthetic-draft','original');return <section data-reader><p>{report.summary}</p><span data-common-points>{report.personalConnection?.commonPoints?.join(',')}</span><span data-method>{report.compatibilityContext?.methodVersion}</span><input aria-label="Draft" value={draft} onChange={e=>setDraft(e.target.value)}/><span data-image-length>{report.image?.length||0}</span></section>;}export const SocialReport=ChatReport;`}));
 b.onLoad({filter:/\.css$/},()=>({loader:'js',contents:'export default new Proxy({},{get:(_,key)=>String(key)});'}));
}}]});
const server=createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><div id="root"></div><script>${built.outputFiles[0].text}</script>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
// Date.now is replaced before modules initialize their default cache clock.
await page.evaluateOnNewDocument(()=>{Date.now=()=>window.testClock||1792800000000;});
const open=async(imageCharacters=0)=>{await page.goto(`http://127.0.0.1:${server.address().port}/report?id=77777777-1111-4111-8111-111111111111&imageCharacters=${imageCharacters}`);await page.waitForSelector('[data-reader]');await page.waitForFunction(()=>window.cacheState().cached);};
const account=async()=>{await page.evaluate(()=>window.dispatchEvent(new CustomEvent('chengzi:desktop-navigate',{detail:'/account'})));await page.waitForFunction(()=>location.pathname==='/account'&&document.body.textContent.includes('账户与积分'));};
const back=async()=>{await page.evaluate(()=>history.back());await page.waitForFunction(()=>location.pathname==='/report');};
try{
 await open();const first=await page.evaluate(()=>({marker:window.documentMarker,...window.cacheState()}));
 await account();await page.evaluate(async()=>{window.balance=49;await window.refreshAccount();window.hold=true;});
 assert.equal(await page.evaluate(()=>window.cacheState().revision),first.revision,'ordinary same-owner account refresh never increments session revision');
 await back();await page.waitForSelector('[data-report-session="restored"] [data-reader]',{timeout:1200});
 assert.equal(await page.evaluate(()=>window.documentMarker),first.marker,'native-route event plus global Back retain the same document');
 assert.doesNotMatch(await page.$eval('body',e=>e.innerText),/正在读取报告/);
 await page.evaluate(()=>{window.pending.splice(0).forEach(resolve=>resolve(200));window.hold=false;});
 await page.waitForFunction(()=>!document.querySelector('[data-report-refresh]'),{timeout:1500});
 assert.doesNotMatch(await page.$eval('body',el=>el.innerText),/这份报告有更新/,'each GET check time increases without pretending the content changed');
 await page.$eval('[aria-label="Draft"]',el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Keep my edited draft');el.dispatchEvent(new Event('input',{bubbles:true}));});

 // Reproduce long uninterrupted reading, then account and a slow report check.
 await page.evaluate(()=>{window.testClock+=4*60*60*1000;});await account();
 await page.evaluate(async()=>{await window.refreshAccount();window.hold=true;});
 const before=await page.evaluate(()=>window.cacheState());
 await back();await page.waitForFunction(()=>!!document.querySelector('[data-report-session]'));
 const after=await page.evaluate(()=>window.cacheState());
 console.log(JSON.stringify({scenario:'four-hour-same-owner-account-return',before,after}));
 assert.equal(after.session,'restored','long reading must return cached content before the held report API resolves');
 assert.equal(await page.$eval('[aria-label="Draft"]',el=>el.value),'Keep my edited draft');
 assert.equal(await page.evaluate(()=>window.documentMarker),first.marker);
 assert.doesNotMatch(await page.$eval('body',e=>e.innerText),/正在读取报告/);

 // A confirmed revocation must still remove even a restored cached report.
 await page.waitForFunction(()=>window.pending.length>0);await page.evaluate(()=>window.pending.splice(0).forEach(resolve=>resolve(401)));
 await page.waitForFunction(()=>!document.querySelector('[data-reader]'));
 assert.equal(await page.evaluate(()=>window.cacheState().cached),false,'server 401 clears the restored report');
 await open();await account();await page.evaluate(async()=>{await window.changeOwner('owner-B');window.hold=true;});await back();
 await page.waitForFunction(()=>document.querySelector('[data-report-session]')?.getAttribute('data-report-session')==='loading');
 assert.equal(await page.$('[data-reader]'),null,'another owner never sees the old cached report');
 assert.equal(await page.evaluate(()=>window.cacheState().cached),false);

 for(const change of ['personalConnection','methodVersion','conclusion','freshness']){
  await open();await page.$eval('[aria-label="Draft"]',el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Keep my edited draft');el.dispatchEvent(new Event('input',{bubbles:true}));});
  await account();await page.evaluate(change=>{if(change==='personalConnection')window.payload.report.personalConnection.commonPoints=['NEW shared hobby'];else if(change==='methodVersion')window.payload.report.compatibilityContext.methodVersion='NEW method';else if(change==='freshness')window.payload.freshness={...window.payload.freshness,status:'changed',added:3};else window.payload.report.summary='NEW conclusion';},change);
  await back();await page.waitForFunction(()=>document.querySelector('[data-report-refresh]')?.textContent.includes('查看更新后的报告'));
  assert.equal(await page.$eval('[aria-label="Draft"]',el=>el.value),'Keep my edited draft',change+' must not overwrite the reading draft');
  assert.doesNotMatch(await page.$eval('[data-reader]',el=>el.textContent),/NEW/,'real content update stays opt-in');
  if(change==='freshness')assert.doesNotMatch(await page.$eval('body',el=>el.innerText),/原有来源新增 3 条材料/,'new source state also waits for explicit update');
  await page.click('[data-report-refresh] button');await page.waitForFunction(change=>change==='freshness'?document.body.textContent.includes('原有来源新增 3 条材料'):document.querySelector('[data-reader]')?.textContent.includes('NEW'),{},change);
  assert.equal(await page.$eval('[aria-label="Draft"]',el=>el.value),'Keep my edited draft','explicit update also keeps the current editor draft');
 }

 // Normalization keeps both report and entries. A >5MB in-memory fixture must
 // retain its actual image strings; an optimization must not silently drop them.
 await open(2_600_000);await account();await page.evaluate(()=>{window.testClock+=4*60*60*1000;window.hold=true;});await back();
 await page.waitForSelector('[data-report-session="restored"] [data-reader]',{timeout:1200});
 assert.equal(await page.$eval('[data-image-length]',el=>Number(el.textContent)),2_600_000+'data:image/png;base64,'.length);
 assert.equal(await page.evaluate(()=>window.payload.entries[0].image.length),2_600_000+'data:image/png;base64,'.length);
 assert.equal(await page.evaluate(()=>window.writes),0);assert.deepEqual(errors,[]);
 console.log('PASS actual ReactDOM report/account Back: same-owner refresh, four-hour reading, blocked API immediate content/draft, changing check times, opt-in real content updates, same document, 401 purge, owner isolation and >5MB normalized image/entries preservation.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
