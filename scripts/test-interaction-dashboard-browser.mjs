import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const origin=process.env.INTAKE_TEST_ORIGIN||'http://127.0.0.1:8798';
const owner='interaction-owner',subjectId='interaction-person',reportId='22222222-1111-4111-8111-111111111111',previousId='11111111-1111-4111-8111-111111111111',futureId='33333333-1111-4111-8111-111111111111';
const lines=[['other','你今天面试怎么样？'],['self','过了，谢谢你。周六一起看展？'],['other','太好了，你准备这么久值得的。周六两点展馆门口见。'],['self','不过我晚上想早点回家休息。'],['other','当然，没问题，看完我送你到地铁，之后你好好休息。'],['other','票订好了，我把电子票发给你了。']].map(([speaker,text],index)=>({id:'line-'+index,speaker,text}));
const dimensions=['主动延续','回应投入','关心体贴','自我开放','亲近表达','具体行动'].map((label,index)=>({key:'dim-'+index,label,value:60+index,status:'supported'}));
let report={id:reportId,subjectId,selfSide:'right',createdAt:'2026-01-08T12:00:00Z',lines,affinity:{value:70,valueScope:'full',dimensions},decision:{judgment:'有具体安排，也尊重回家节奏。',nextStep:'确认具体地点，之后结合实际见面情况了解。',replyOptions:[{text:'周六两点展馆门口见。',style:'自然',reason:'确认安排'}]}};
const points=[{reportId:previousId,subjectId,eventStart:'2026-01-01',eventEnd:'2026-01-01',score:0,sourceReportIds:[previousId]},{reportId,subjectId,eventStart:'2026-01-07',eventEnd:'2026-01-07',score:70,sourceReportIds:[reportId],connectPrevious:true,previousReportId:previousId},{reportId:futureId,subjectId,eventStart:'2026-02-01',eventEnd:'2026-02-01',score:90,sourceReportIds:[futureId],connectPrevious:true,previousReportId:reportId}];
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox'],defaultViewport:{width:1280,height:1000}});
const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],requests=[];
page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
page.on('request',async request=>{
 if(!request.url().startsWith(origin+'/api/'))return request.continue();const url=new URL(request.url());requests.push({path:url.pathname,method:request.method()});let response={};
 if(url.pathname==='/api/account/credits')response={account:{userId:owner,balance:100,active:true,features:['chat']},prices:{text:3}};
 else if(url.pathname==='/api/web/profile')response={enabled:true,paused:false,subjects:[{id:subjectId,label:'虚构互动测试人物'}],trends:[{subjectId,points}]};
 else if(url.pathname==='/api/web/report')response={reportId,kind:'chat',subjectId,report,totalCount:1};
 else if(url.pathname==='/api/web/relationship-feedback')response={subjectId,automatic:{status:'unavailable',changes:[],evidenceReview:{cards:[]}}};
 else if(url.pathname==='/api/web/report/list')response={reports:[]};
 await request.respond({status:200,contentType:'application/json',body:JSON.stringify(response)});
});
async function open(){await page.goto(origin+'/report?id='+reportId,{waitUntil:'networkidle0'});await page.waitForSelector('[role="tab"]');await page.$$eval('[role="tab"]',items=>items.find(item=>/互动仪表|好感信号/.test(item.textContent))?.click());await page.waitForSelector('#signals [data-interaction-dimension]');}
try{
 await open();await page.waitForFunction(()=>document.querySelector('#signals')?.textContent.includes('参考指标上升'));
 assert.equal(await page.$$eval('#signals [data-interaction-dimension]',items=>items.length),4);
 assert.match(await page.$eval('#signals svg[aria-label^="四类"]',el=>el.getAttribute('aria-label')),/共 7 次匹配/);
 assert.match(await page.$eval('[aria-label="本次样本与依据"]',el=>el.textContent),/可读原话 6 句.*对方 4 句/);
 assert.equal(await page.$$eval('#signals details',items=>items.length),1);assert.equal(await page.$eval('#signals details',el=>el.open),false);
 assert.equal(await page.$$eval('#signals svg[aria-label*="2026-"]',items=>items.length),1);
 const trendLabel=await page.$eval('#signals svg[aria-label*="2026-"]',el=>el.getAttribute('aria-label'));assert.match(trendLabel,/2026-01-01：互动参考指数 0/);assert.doesNotMatch(trendLabel,/2026-02-01/);
 assert.equal(await page.$eval('#signals details svg[role="img"]',el=>el.checkVisibility()),false,'original six dimensions are closed, not duplicated on the main view');
 assert.match(await page.$eval('[data-interaction-dimension="boundary"]',el=>el.textContent),/我：不过我晚上想早点回家休息。/);
 await page.click('#signals details summary');assert.equal(await page.$eval('#signals details svg[role="img"]',el=>el.checkVisibility()),true);await page.click('#signals details summary');
 await mkdir('.tmp/qa-interaction-dashboard',{recursive:true});await page.$eval('#signals',el=>el.scrollIntoView());await page.screenshot({path:'.tmp/qa-interaction-dashboard/desktop.png',fullPage:true});
 await page.setViewport({width:390,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'mobile has no horizontal overflow');
 await page.screenshot({path:'.tmp/qa-interaction-dashboard/mobile.png',fullPage:true});
 report={...report,lines:[{id:'risk-1',speaker:'other',text:'先给我转两千元。'},...lines]};await open();await page.waitForSelector('#signals [aria-label="优先处理的边界或风险"]');
 const order=await page.evaluate(()=>{const warning=document.querySelector('#signals [aria-label="优先处理的边界或风险"]'),donut=document.querySelector('#signals svg[aria-label^="四类"]');return warning.getBoundingClientRect().top<donut.getBoundingClientRect().top});assert.equal(order,true,'risk remains before positive behavioral counts');
 report={...report,lines:[],affinity:null};await open();assert.match(await page.$eval('#signals',el=>el.textContent),/本段暂缺可读的对方原话/);assert.equal(await page.$eval('[data-interaction-dimension="boundary"] header strong',el=>el.textContent),'—','unknown is not a zero score');
 assert.equal(requests.filter(row=>row.method!=='GET').length,0,'dashboard reads existing reports without analysis, fee or writes');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('interaction dashboard browser PASS: four unified cards, 7 cue-count denominator, closed model reference, dated 0→70 history without future node, boundary context, risk priority, desktop/mobile, no model/write requests');
}finally{await context.close();await browser.close();}
