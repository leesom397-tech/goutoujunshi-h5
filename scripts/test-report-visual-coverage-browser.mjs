import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798',owner='visual-coverage-owner',reportId='22222222-2222-4333-8444-555555555555';
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl1sAAAAASUVORK5CYII=';
const media={id:'media-1',index:0,mime:'image/png',name:'synthetic.png',bytes:Buffer.from(image,'base64').length,chunks:1,sha256:createHash('sha256').update(Buffer.from(image,'base64')).digest('hex'),status:'ready'};
const library={id:'moments-library',account:'test-account',friend:'测试人物',kind:'moments',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-18T00:00:00Z',total:2,epoch:1,subjectId:'visual-person',warnings:[],reportLinks:[],mediaIncluded:true};
const row={id:'stored-row',localId:'same-id-in-both-libraries',kind:'text',sender:'other',senderRole:'other',text:'周末爬山。',at:'2026-10-03',firstCapturedAt:'2026-10-18T00:00:00Z',lastCapturedAt:'2026-10-18T00:00:00Z',source:{method:'screen-capture'},imageCount:1,media:[media]};
const observation='画面可见山地步道和登山背包。';
const semantic={status:'complete',coverage:{totalImported:92,receivedText:92,analyzedText:92},summary:'材料显示有户外活动话题，关系意愿仍需结合互动核对。',summaryEvidenceIds:['visual-finding'],findings:[{id:'visual-finding',claim:'朋友圈有户外活动的可见线索',confidence:'中',evidence:[{sourceId:row.localId,libraryId:library.id,sourceKind:'moments',mediaId:media.id,basis:'visual',quote:observation,senderRole:'other',at:'2026-10-03'}]}],trend:'材料不足以判断关系变化',action:'从共同兴趣聊起，观察是否愿意继续交流。'};
const sourceCoverage=[{libraryId:'chat-library',kind:'chat',total:90,textRead:90,imagesExpected:0,imagesAvailable:0,imagesAnalyzed:0,imagesFailed:0,imagesMissing:0,status:'complete'},{libraryId:library.id,kind:'moments',total:2,textRead:2,imagesExpected:2,imagesAvailable:1,imagesAnalyzed:1,imagesFailed:0,imagesMissing:1,status:'partial',imageScope:'synced-preview'}];
const report={id:reportId,reportId,subjectId:'visual-person',kind:'chat',captureOrigin:true,analysisScope:'fullHistory',captureFormat:'full-history',semanticHistory:semantic,sourceCoverage,mediaEvidence:[{libraryId:library.id,sourceId:row.localId,mediaId:media.id,kind:'moments',at:'2026-10-03',speaker:'other',observation,basis:'visual'}],relationshipDiagnosis:{coverage:{total:90},relationship:{currentState:semantic.summary,trend:semantic.trend},decision:{recommendation:semantic.action},semanticHistory:semantic},decision:{judgment:semantic.summary,nextStep:semantic.action,evidence:observation,replyOptions:[]}};
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});await mkdir('outputs/report-reading',{recursive:true});
try{for(const width of [1440,390]){
 const context=await browser.createBrowserContext(),page=await context.newPage(),requests=[],errors=[];await page.setViewport({width,height:950});page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
 page.on('request',r=>{const u=new URL(r.url());if(!u.pathname.startsWith('/api/'))return r.continue();requests.push({method:r.method(),url:u.pathname+u.search});let data={};if(u.pathname==='/api/auth/session')data={loggedIn:true,user:{id:owner}};if(u.pathname==='/api/account/credits')data={account:{userId:owner,balance:1000,active:true},prices:{}};if(u.pathname==='/api/web/report')data={reportId,kind:'chat',subjectId:'visual-person',totalCount:92,report};if(['/api/profile','/api/web/profile'].includes(u.pathname))data={enabled:true,paused:false,self:{},subjects:[],facts:[],signals:[],trends:[]};if(u.pathname==='/api/web/capture/library'){
  if(u.searchParams.has('mediaId')){assert.equal(u.searchParams.get('id'),library.id);data={ownerId:owner,data:image,chunkIndex:0,media};}
  else if(u.searchParams.has('id')){assert.equal(u.searchParams.get('id'),library.id);data={ownerId:owner,library,records:[row],nextCursor:null};}
  else data={ownerId:owner,library:{...library,id:'chat-library',kind:'chat'},sourceIds:[row.localId],records:[{...row,text:'同编号聊天记录不能误当这张图片来源',imageCount:0,media:[]}]};
 }return r.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(origin+'/report?id='+reportId,{waitUntil:'networkidle0'});await page.waitForSelector('[data-report-brief]');
 assert.match(await page.$eval('[data-key-evidence]',e=>e.innerText),/图片可见内容/);assert.match(await page.$eval('[data-report-coverage]',e=>e.innerText),/90 条聊天 · 2 条朋友圈 · 已看 1 \/ 2 张图片/);
 await page.$eval('[data-key-evidence] [data-capture-evidence]',e=>e.click());await page.waitForSelector('[data-capture-evidence-dialog][open] [data-capture-record] img');
 const source=await page.$eval('[data-capture-evidence-dialog][open]',e=>e.innerText);assert.match(source,/原始朋友圈动态/);assert.match(source,/周末爬山/);assert.doesNotMatch(source,/同编号聊天记录/,'library identity prevents same-ID collision');
 assert.equal(await page.$$eval('[data-capture-record] img',e=>e.length),1,'verified image preview shown');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
 await page.$eval('[data-report-coverage] button',e=>e.click());await page.waitForSelector('dialog[open] [data-source-coverage]');
 assert.equal(await page.$$eval('dialog[open] [data-source-coverage]',e=>e.length),2);assert.match(await page.$eval('dialog[open]',e=>e.innerText),/1 张图片尚未同步/);assert.match(await page.$eval('dialog[open]',e=>e.innerText),/预览或采集画面/);
 assert.equal(await page.$eval('dialog[open] [data-visual-evidence] p',e=>e.innerText),observation);await page.screenshot({path:`outputs/report-reading/report-visual-coverage-${width}.png`,fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'));assert.ok(requests.some(r=>r.url.includes('id=moments-library')));
 console.log(`PASS ${width}: source coverage, partial images, visual label, precise library+source identity, original verified image, no paid/mutating requests`);await context.close();
}}finally{await browser.close();}
