import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const reports=await Promise.all(['full-person','risk-person'].map(async name=>({name,report:{...JSON.parse(await readFile(`outputs/report-route-fixtures/${name}.json`,'utf8')),analysisQuestion:'panorama'}})));
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
await mkdir('outputs/global-report-sections',{recursive:true});
try {
 for(const width of [1440,390])for(const {name,report} of reports){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],writes=[];
  await page.setViewport({width,height:950});await page.setRequestInterception(true);page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const url=new URL(request.url());if(!url.pathname.startsWith('/api/'))return request.continue();if(request.method()!=='GET')writes.push(url.pathname);let value={};
   if(url.pathname==='/api/auth/session')value={loggedIn:true,user:{id:'global-report-qa'}};
   if(url.pathname==='/api/account/credits')value={account:{userId:'global-report-qa',balance:1000},prices:{}};
   if(url.pathname==='/api/web/account-context')value={account:{userId:'global-report-qa',balance:1000},people:[],prices:{},user:{name:'验收用户'},admin:false,meteringReady:true,meteringScope:'web',contact:'fixture'};
   if(url.pathname==='/api/web/profile')value={enabled:true,paused:false,self:{},subjects:[]};
   if(url.pathname==='/api/web/report')value={reportId:report.reportId,kind:'chat',subjectId:report.subjectId,totalCount:report.totalCount,report};
   if(url.pathname==='/api/web/relationship-feedback')value={subjectId:report.subjectId,versionChanges:{status:'first'},currentFeedback:{reportId:report.reportId,latest:null}};
   return request.respond({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await page.goto(`${origin}/report?id=${report.reportId}`,{waitUntil:'networkidle0'});await page.waitForSelector('[data-history-reading]');
  async function section(label,selector){await page.$$eval('[data-history-reading] [role=tab]',(buttons,label)=>buttons.find(button=>button.textContent.includes(label)).click(),label);await page.waitForSelector(selector);return page.$eval(selector,node=>node.textContent);}
  const riskText=await section('风险与边界','[data-history-risk-verification]');
  const risk=report.semanticHistory.riskAssessment;
  if(risk.items.length){assert.ok(riskText.includes(risk.items[0].meaning));assert.ok(riskText.includes(risk.items[0].resolution.reading));assert.ok(await page.$('[data-risk-response-paths]'));}
  else assert.ok(riskText.includes(risk.summary));
  await page.$eval('[data-history-reading]',node=>node.scrollIntoView({block:'start',behavior:'instant'}));
  await page.screenshot({path:`outputs/global-report-sections/${name}-risk-${width}.png`});
  if(name==='full-person'){
   const profileText=await section('人物解读','[data-profile-insights]');assert.ok(profileText.includes(report.semanticHistory.profileInsights[0].reading));
   const momentText=await section('朋友圈与图片','[data-history-moments]');assert.ok(momentText.includes(report.semanticHistory.sourceInsights.moments.summary));assert.ok(momentText.includes(report.mediaEvidence[0].observation));
   await page.$eval('[role=tab][aria-controls$="-panel-change"]',node=>node.click());await page.waitForSelector('[data-chat-activity]');
   assert.ok(await page.$eval('[data-chat-activity]',(node,count)=>node.textContent.includes(String(count)),report.chatActivity.messages),'full imported statistics survive rendering');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await context.close();
 }
 console.log('PASS global report desktop/mobile: risk interpretation and follow-up outcomes, personality, Moments/image evidence and complete activity data; no hidden goal requirement, paid writes or overflow.');
} finally {await browser.close();}
