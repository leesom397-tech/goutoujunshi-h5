import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

// Inputs are saved by production route + DO + SQLite tests with synthetic transport.
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798',owner='report-goals-browser';
const risk=JSON.parse(await readFile('outputs/report-route-fixtures/risk-person.json','utf8'));
const connection=JSON.parse(await readFile('outputs/report-route-fixtures/full-person.json','utf8'));
const legacy={...risk,analysisVersion:1,semanticHistory:{...risk.semanticHistory,actionPlan:undefined,riskAssessment:undefined}};
const selfSource=risk.riskReview.signals[0].sources[0].response;
legacy.semanticHistory.findings=[...risk.semanticHistory.findings,{id:'legacy-self-only',claim:'测试用户自己的表达',evidence:[{...selfSource,senderRole:'self',sourceKind:'chat',libraryId:risk.archiveSnapshot.libraryId}]}];
legacy.semanticHistory.affinitySignals=[...(risk.semanticHistory.affinitySignals||[]),{direction:'support',signal:'不应把用户付出算作对方好感',meaning:'这条旧方向不明信号不能沿用。',evidenceIds:['legacy-self-only']}];
const unknown={...risk,participants:{version:1,self:{role:'self',label:'你'},other:{role:'other',label:'身份待确认'},identified:false,source:'unknown'}};
await mkdir('outputs/report-goals',{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',userDataDir:'D:/Temp/chengzi-report-goals-browser',args:['--no-sandbox']});
try{for(const width of [1440,390])for(const [name,report] of [['risk',risk],['legacy-risk',legacy],['unknown',unknown],['connection',{...connection,analysisQuestion:'next',participants:risk.participants}]]){
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],writes=[];
 await page.setViewport({width,height:950});await page.setRequestInterception(true);page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const url=new URL(request.url());if(!url.pathname.startsWith('/api/'))return request.continue();if(request.method()!=='GET')writes.push(url.pathname);let value={};
  if(url.pathname==='/api/auth/session')value={loggedIn:true,user:{id:owner}};
  if(url.pathname==='/api/account/credits')value={account:{userId:owner,balance:1000},prices:{}};
  if(url.pathname==='/api/web/profile')value={enabled:true,paused:false,self:{},subjects:[]};
  if(url.pathname==='/api/web/report')value={reportId:report.reportId,kind:report.reportKind||'chat',subjectId:report.subjectId,totalCount:report.totalCount,report};
  if(url.pathname==='/api/web/relationship-feedback')value={subjectId:report.subjectId,versionChanges:{status:'first'},currentFeedback:{reportId:report.reportId,latest:null}};
  return request.respond({status:200,contentType:'application/json',body:JSON.stringify(value)});
 });
 async function shot(label,selector){if(selector)await page.$eval(selector,node=>node.scrollIntoView({block:'start',behavior:'instant'}));await new Promise(resolve=>setTimeout(resolve,120));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`outputs/report-goals/${name}-${label}-${width}.png`});}
 async function tab(key){await page.$eval(`[role="tab"][aria-controls$="-panel-${key}"]`,node=>node.click());}
 await page.goto(origin+'/report?id='+report.reportId+'&focus=affinity',{waitUntil:'networkidle0'});await page.waitForSelector('[data-report-participants]');
 const identity=await page.$eval('[data-report-participants]',node=>node.textContent);
 if(name==='unknown'){assert.match(identity,/姓名待确认/);assert.ok(!identity.includes('合成对象林澈'));}
 else assert.match(identity,/合成对象林澈与你/);
 const tabs=await page.$$eval('[data-report-reader]>[role="tablist"] [role="tab"]',nodes=>nodes.map(node=>node.textContent).join('|'));
 if(name==='connection'){
  // The tablist may be wrapped by the reader's sticky navigation.
  assert.match(await page.$eval('[role="tab"][aria-controls$="-panel-status"]',node=>node.textContent),/TA的态度/);
  assert.match(await page.$eval('[role="tab"][aria-controls$="-panel-change"]',node=>node.textContent),/互动变化/);
  assert.match(await page.$eval('[data-open-affinity]',node=>node.textContent),/合成对象林澈对你的好感度/);
  await tab('next');assert.match(await page.$eval('[data-history-actions]',node=>node.textContent),/给你的行动 · 面对合成对象林澈/);await shot('action','[data-history-actions]');
 }else{
  for(const [key,label] of [['status','风险结论'],['change','证据核实'],['next','如何应对']])assert.match(await page.$eval(`[role="tab"][aria-controls$="-panel-${key}"]`,node=>node.textContent),new RegExp(label));
  assert.equal(await page.$$eval('[data-risk-review] [data-risk-category]',nodes=>nodes.length),0,'risk summary counts are passive, not dead buttons');
  if(name==='legacy-risk')assert.equal(await page.$eval('body',node=>node.textContent.includes('不应把用户付出算作对方好感')),false,'self-only legacy evidence is not another person’s affinity');
  await shot('conclusion','[data-report-brief]');await tab('change');await page.waitForSelector('[data-history-risk-verification]');
  const evidenceText=await page.$eval('[data-history-risk-verification]',node=>node.textContent);assert.match(evidenceText,/把验证码发给我/);assert.match(evidenceText,name==='unknown'?/对方说/:/合成对象林澈说/);
  if(name==='legacy-risk'){assert.match(evidenceText,/你说/);assert.match(evidenceText,/未保存后来是否已澄清/);}
  else assert.ok(evidenceText.includes(risk.semanticHistory.riskAssessment.items[0].resolution.reading));
  await page.$eval('[aria-label="风险证据分页"] button:last-child',node=>node.click());await new Promise(resolve=>setTimeout(resolve,100));
  assert.match(await page.$eval('[data-risk-verification-item]',node=>node.textContent),/短期/);assert.ok(await page.$eval('[data-history-risk-verification]',node=>Math.abs(node.getBoundingClientRect().top-120)<12),'pagination keeps the new evidence in view');
  if(await page.$('[data-chat-activity]'))assert.equal(await page.$eval('[data-chat-activity]',node=>!!node.closest('details')),true,'risk task emphasizes verification before statistics');
  await shot('evidence','[data-history-risk-verification]');await tab('next');await page.waitForSelector('[data-history-actions]');
  assert.match(await page.$eval('[data-history-actions]',node=>node.textContent),/给你的行动/);
  if(name==='legacy-risk'){
   const saved=await page.$eval('[data-saved-action]',node=>node.textContent);assert.ok(saved.includes(report.riskReview.signals[0].action));assert.match(saved,/把验证码发给我/);assert.ok(!saved.includes('结合下一次真实回应'));
  }else{
   await page.waitForSelector('[data-risk-response-paths]');const branch=report.semanticHistory.riskAssessment.items[0].verify.outcomes[0];const text=await page.$eval('[data-risk-response-paths]',node=>node.textContent);assert.ok(text.includes(branch.when)&&text.includes(branch.nextStep));
   await page.$eval('[aria-label="回应分支分页"] button:last-child',node=>node.click());const next=report.semanticHistory.riskAssessment.items[1].verify.outcomes[0];assert.ok((await page.$eval('[data-risk-response-paths]',node=>node.textContent)).includes(next.nextStep));
  }
  await shot('action',name==='legacy-risk'?'[data-history-actions]':'[data-risk-response-paths]');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await context.close();
}console.log('PASS 8 goal/identity cases at1440/390: risk/connection destinations, named evidence directions, post-event clarification, response branches, paged sources retain place, old factual risk report useful without generation, unknown identity honest, no writes/overflow.');}finally{await browser.close();}
