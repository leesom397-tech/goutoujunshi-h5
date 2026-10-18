import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798',owner='synthetic-risk-owner',reportId='eb0becd6-a153-4f5a-8fbf-814dcd880515',subjectId='synthetic-risk-person',libraryId='cl_'+'a'.repeat(64);
const bundle=await build({stdin:{contents:'export {fullHistoryRiskReview} from "./lib/relationship-risk";export {computeChatActivity} from "./lib/chat-activity";export {buildRelationshipDiagnosis} from "./lib/relationship-diagnosis";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const {fullHistoryRiskReview,computeChatActivity,buildRelationshipDiagnosis}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const records=Array.from({length:675},(_,i)=>({id:'source-'+i,localId:'source-'+i,kind:'text',senderRole:i%2?'self':'other',sender:i%2?'我':'对方',at:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),text:i===0?'把验证码发给我。':i===1?'我不会提供验证码。':'今天聊了日常安排。',imageCount:0,source:{method:'wechat-local-db',idStability:'stable',accountId:'synthetic-wx',sessionId:'synthetic-chat',messageShard:'fixture',messageId:String(i),timestampOrigin:'wechat-create-time'}}));
const activity=computeChatActivity(records),riskReview=fullHistoryRiskReview(records,libraryId),diagnosis=buildRelationshipDiagnosis(activity,'risk');
let report={id:reportId,reportId,subjectId,kind:'chat',analysisScope:'fullHistory',captureOrigin:true,captureFormat:'full-history',lines:[],chatActivity:activity,relationshipDiagnosis:diagnosis,riskReview,summary:'旧记录有需要核实的账户信息要求。',decision:{judgment:'旧记录有需要核实的账户信息要求。',nextStep:'确认这条历史要求的背景与之后的处理。',replyOptions:[]}};
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});await mkdir('outputs/full-history-risk',{recursive:true});
try{for(const width of [1440,390]){
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],writes=[],sourceRequests=[];await page.setViewport({width,height:950});await page.setRequestInterception(true);page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{const url=new URL(r.url());if(!url.pathname.startsWith('/api/'))return r.continue();if(r.method()!=='GET')writes.push(url.pathname);let value={};
  if(url.pathname==='/api/auth/session')value={loggedIn:true,user:{id:owner}};
  if(url.pathname==='/api/account/credits')value={account:{userId:owner,balance:1000,active:true},prices:{analysisSmall:3}};
  if(url.pathname==='/api/web/profile')value={enabled:true,self:{},subjects:[{id:subjectId,label:'合成人物',data:{}}],facts:[]};
  if(url.pathname==='/api/web/report')value={reportId,kind:'chat',subjectId,totalCount:675,report};
  if(url.pathname==='/api/web/capture/library'){sourceRequests.push(url.search);value={ownerId:owner,library:{id:libraryId,epoch:1,account:'synthetic-wx',friend:'合成人物',kind:'chat'},sourceIds:['source-0','source-1'],records:url.searchParams.has('id')?records:records.slice(0,2)};}
  return r.respond({status:200,contentType:'application/json',body:JSON.stringify(value)});
 });
 await page.goto(origin+'/report?id='+reportId,{waitUntil:'networkidle0'});await page.waitForSelector('[aria-label="全历史风险核实"]');
 assert.equal(await page.$$eval('[data-key-evidence] li',nodes=>nodes.length),1,'checked risk quote fills absent semantic evidence');assert.match(await page.$eval('[data-key-evidence]',e=>e.innerText),/把验证码发给我/);assert.doesNotMatch(await page.$eval('[data-report-brief]',e=>e.innerText),/暂未保留可引用/);
 await page.$eval('[data-key-evidence] button',e=>e.click());await page.waitForSelector('[data-capture-evidence-dialog][open] [data-capture-record]');assert.match(await page.$eval('[data-capture-evidence-dialog]',e=>e.innerText),/把验证码发给我/);await page.keyboard.press('Escape');
 assert.match(await page.$eval('[data-risk-review]',e=>e.innerText),/675 条可读聊天/);assert.equal(await page.$$eval('[data-risk-kind]',nodes=>nodes.length),1);assert.equal(await page.$$eval('[data-risk-kind] details[open]',nodes=>nodes.length),0);
 await page.$eval('[data-risk-kind] summary',e=>e.click());assert.match(await page.$eval('[data-risk-review]',e=>e.innerText),/随后一条我方回应/);assert.match(await page.$eval('[data-risk-review]',e=>e.innerText),/1 条表达/);
 const riskCopy=await page.$eval('[data-risk-review]',e=>e.innerText);assert.doesNotMatch(riskCopy,/2026-01-01T|\.000Z/,'ISO storage values are not displayed');assert.match(riskCopy,/2026\/1\/1 08:00:00/,'existing Chinese/Shanghai formatter used for original');assert.match(riskCopy,/2026\/1\/1 08:01:00/,'response time localized independently');assert.equal(report.riskReview.signals[0].sources[0].at,'2026-01-01T00:00:00.000Z','source timestamp unchanged');
 await page.screenshot({path:`outputs/full-history-risk/report-${width}.png`,fullPage:true});
 await page.evaluate(()=>[...document.querySelectorAll('[data-risk-review] button')].find(e=>e.textContent.includes('回看这条原话')).click());await page.waitForSelector('[data-capture-evidence-dialog][open] [data-capture-record]');
 assert.match(await page.$eval('[data-capture-evidence-dialog]',e=>e.innerText),/把验证码发给我/);assert.ok(sourceRequests.some(query=>new URLSearchParams(query).get('id')===libraryId),'exact library resolves early source');await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 const prior=report;report={...report,riskReview:fullHistoryRiskReview(records.slice(2),libraryId)};await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('[data-risk-state="clear"]');assert.match(await page.$eval('[data-risk-review]',e=>e.innerText),/未知|不能/);assert.equal(await page.$$eval('[data-risk-kind]',nodes=>nodes.length),0);
 report={...prior,semanticHistory:{summaryEvidenceIds:['normal'],findings:[{id:'normal',evidence:[{sourceId:'source-2',senderRole:'other',quote:'今天聊了日常安排。'}]}]}};await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('[data-key-evidence] li');const keyCopy=await page.$eval('[data-key-evidence]',e=>e.innerText);assert.match(keyCopy,/今天聊了日常安排/);assert.doesNotMatch(keyCopy,/把验证码发给我/,'existing semantic evidence remains primary, risk fallback does not displace it');report=prior;await context.close();
}console.log('PASS full-history risk 1440/390: bounded expandable evidence, exact original source and response, true count/date, no horizontal overflow, no writes, absent signal is unknown not safety guarantee.');}finally{await browser.close();}
