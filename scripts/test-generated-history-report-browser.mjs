import assert from "node:assert/strict";
import {readFile,mkdir} from "node:fs/promises";
import {build} from "esbuild";
import puppeteer from "puppeteer-core";

// Run test-capture-durable-jobs.mjs first: these are saved production-route
// results, generated through the DO and SQLite with synthetic model transport.
const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798",owner="generated-report-reader";
const names=["full-person","chat-only-210-194","moments-only"];
const fixtures=await Promise.all(names.map(async name=>({name,report:JSON.parse(await readFile(`outputs/report-route-fixtures/${name}.json`,"utf8"))})));
const compiled=await build({stdin:{contents:'export {computeChatActivity} from "./lib/chat-activity";',resolveDir:process.cwd()},bundle:true,write:false,platform:"node",format:"esm"});
const {computeChatActivity}=await import("data:text/javascript;base64,"+Buffer.from(compiled.outputFiles[0].text).toString("base64"));
const dates=["2026-05-26","2026-06-03","2026-07-10","2026-07-20","2026-08-08","2026-09-09","2026-10-02","2026-10-18"];
const sparseRecords=Array.from({length:201},(_,i)=>({id:"sparse-"+i,localId:"sparse-"+i,kind:"text",senderRole:i%2?"self":"other",text:"合成互动原话",at:dates[Math.min(7,Math.floor(i/26))]+`T10:${String(i%60).padStart(2,"0")}:00+08:00`,source:{method:"wechat-local-db",idStability:"stable",accountId:"synthetic",sessionId:"synthetic",messageShard:"sparse",messageId:String(i),timestampOrigin:"wechat-create-time"}}));
fixtures.push({name:"sparse-dates",report:{...fixtures[1].report,chatActivity:computeChatActivity(sparseRecords)}});
await mkdir("outputs/generated-report-reading",{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",userDataDir:"D:/Temp/chengzi-generated-report-browser",args:["--no-sandbox"]});
try{for(const width of [1440,390])for(const {name,report} of fixtures){
 const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],writes=[];
 const reportId=report.reportId||report.id,subjectId=report.subjectId,semantic=report.semanticHistory,momentOnly=report.captureKind==="moments";
 await context.overridePermissions(origin,["clipboard-read","clipboard-write","clipboard-sanitized-write"]);await page.setViewport({width,height:950});page.on("pageerror",error=>errors.push(error.message));await page.setRequestInterception(true);
 page.on("request",request=>{const url=new URL(request.url());if(!url.pathname.startsWith("/api/"))return request.continue();if(request.method()!=="GET")writes.push(url.pathname);let value={};
  if(url.pathname==="/api/auth/session")value={loggedIn:true,user:{id:owner}};
  if(url.pathname==="/api/account/credits")value={account:{userId:owner,balance:1000},prices:{}};
  if(url.pathname==="/api/web/profile")value={enabled:true,paused:false,self:{},subjects:[{id:subjectId,label:"合成测试人物",data:{}}]};
  if(url.pathname==="/api/web/report")value={reportId,kind:report.reportKind||"chat",subjectId,totalCount:report.totalCount,report};
  if(url.pathname==="/api/web/relationship-feedback")value={subjectId,versionChanges:{status:"first"},currentFeedback:{reportId,latest:null}};
  if(url.pathname==="/api/web/capture/library"){
   const library=report.sourceCoverage.find(row=>row.libraryId===url.searchParams.get("id"))||report.sourceCoverage[0];
   const original=semantic.findings.flatMap(finding=>finding.evidence).filter(row=>(row.libraryId||report.sourceCoverage[0].libraryId)===library.libraryId);
   const records=[...new Map(original.map(row=>[row.sourceId,{localId:row.sourceId,kind:"text",senderRole:row.senderRole,at:row.at,text:row.quote,source:{method:"wechat-local-db",messageId:row.sourceId},imageCount:0}])).values()];
   value={ownerId:owner,library:{id:library.libraryId,kind:library.kind,friend:"合成测试",account:"synthetic",epoch:1},sourceIds:records.map(row=>row.localId),records};
  }
  return request.respond({status:200,contentType:"application/json",body:JSON.stringify(value)});
 });
 async function shot(label,selector){if(selector)await page.$eval(selector,node=>node.scrollIntoView({block:"start",behavior:"instant"}));await new Promise(resolve=>setTimeout(resolve,150));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name}:${label} viewport`);await page.screenshot({path:`outputs/generated-report-reading/${name}-${label}-${width}.png`});}
 await page.goto(`${origin}/report?id=${reportId}&focus=affinity`,{waitUntil:"networkidle0"});await page.waitForSelector("[data-history-entry]");
 assert.equal(await page.$eval('[data-history-entry]',node=>node.getBoundingClientRect().top<innerHeight),true,"named destinations are on the first screen");
 assert.match(await page.$eval('[data-new-sentence-analysis]',node=>node.getAttribute('href')),new RegExp(`subjectId=${subjectId}.*focus=intent`));
 assert.equal(await page.$('#tone'),null,"full history must not fabricate sentence analysis");
 if(momentOnly){assert.equal(await page.$('[data-open-affinity]'),null);assert.match(await page.$eval('h1',node=>node.textContent),/朋友圈/);assert.match(await page.$eval('[data-capture-sources]',node=>node.textContent),/全部已导入 3 条动态/);}
 else {assert.match(await page.$eval('[data-open-affinity]',node=>node.textContent),new RegExp(String(report.affinity.value)));assert.equal(await page.$$eval('[data-history-affinity-dimensions] article',nodes=>nodes.length),6);}
 await shot("entry");
 await page.$eval('[data-open-moments]',node=>node.click());await page.waitForSelector('[data-history-moments]');
 if(name==="chat-only-210-194"||name==="sparse-dates"){
  assert.match(await page.$eval('[data-history-moments]',node=>node.textContent),/当前报告没有收到这个人的朋友圈/);
  const link=new URL(await page.$eval('[data-import-moments]',node=>node.getAttribute('href')),origin);assert.equal(link.searchParams.get('kind'),'chat');assert.equal(link.searchParams.get('libraryId'),report.archiveSnapshot.libraryId);assert.equal(link.searchParams.get('subjectId'),subjectId);assert.equal(link.searchParams.get('returnTo'),'/report?id='+reportId);assert.equal(await page.$('[data-moments-synthesis]'),null);
 }else {
  assert.match(await page.$eval('[data-history-moments]',node=>node.textContent),/已导入 3 条朋友圈/);
  assert.match(await page.$eval('[data-history-moments]',node=>node.textContent),/图片已解读 3 \/ 3 张/);
  assert.ok(await page.$('[data-moments-synthesis]'));assert.ok(await page.$('[data-history-images]'));
  if(!momentOnly)assert.ok(await page.$('[data-cross-source-reading]'));
 }
 await shot("moments","[data-history-reading]");
 await page.$eval('[role="tab"][aria-controls$="-panel-change"]',node=>node.click());await page.waitForSelector('[data-history-changes]');
 if(semantic.changeInsights?.length){assert.match(await page.$eval('[data-change-insight]',node=>node.textContent),new RegExp(semantic.changeInsights[0].meaning));assert.match(await page.$eval('[data-change-insight]',node=>node.textContent),/之前.*后来/s);}
 if(momentOnly)assert.equal(await page.$('[data-chat-activity]'),null,"Moments must not display fictional chat charts");
 else {assert.ok(await page.$('[data-chat-activity]'));assert.equal(await page.$eval('[data-chat-activity]',node=>!!node.closest('dialog,details')),false);if(!report.chatActivity.starts.comparable)assert.match(await page.$eval('[data-chat-activity]',node=>node.textContent),/双方留下了多少消息/);}
 if(name==="sparse-dates"){
  assert.equal(report.chatActivity.activeDays,8);assert.equal(report.chatActivity.spanDays,146);
  assert.equal(await page.$eval('[data-chat-activity]',node=>node.textContent.includes('201')),true);
  assert.equal(await page.$$eval('[data-chat-activity] [aria-label="按日期查看消息数量"] button',nodes=>nodes.reduce((sum,node)=>sum+Number(node.getAttribute('aria-label').match(/，(\d+)条消息/)[1]),0)),201,"all sparse dates represented, no silent 40-line subset");
 }
 await shot("change","[data-history-changes]");
 await page.$eval('[role="tab"][aria-controls$="-panel-next"]',node=>node.click());await page.waitForSelector('[data-history-actions]');
 const plan=semantic.actionPlan.steps[0],actionText=await page.$eval('[data-action-step]',node=>node.textContent);
 for(const field of ['action','why','observeFor','advanceWhen','stopWhen'])assert.ok(actionText.includes(plan[field]),`${name} ${field} shown`);
 if(plan.reply){assert.equal(await page.$eval('[data-report-quick-reply] blockquote',node=>node.textContent),plan.reply);await page.bringToFront();await page.$eval('[data-report-quick-reply]',node=>node.scrollIntoView({block:'center',behavior:'instant'}));await new Promise(resolve=>setTimeout(resolve,200));await page.click('[data-report-quick-reply] button');await page.waitForFunction(()=>document.querySelector('[data-report-quick-reply] button').textContent.includes('已复制')||document.querySelector('[data-report-quick-reply] [role="alert"]'),{timeout:5000});assert.match(await page.$eval('[data-report-quick-reply] button',node=>node.textContent),/已复制/);assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),plan.reply);}
 await shot("next","[data-history-actions]");
 assert.deepEqual(writes,[],"report reading/copy do not create paid jobs");assert.deepEqual(errors,[]);await context.close();
 }console.log("PASS 8 generated report scenarios: real route+DO persisted chat/Moments contracts, shallow entries, actual six-dimensional score, accurate missing Moments, grounded before/after/action/reply, no fake sentence analysis/chat graphs; sparse 8 dates/146 days preserves 201 messages; no writes/overflow.");
}finally{await browser.close();}
