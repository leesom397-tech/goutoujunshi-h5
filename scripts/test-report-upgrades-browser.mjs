import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {build} from "esbuild";
import puppeteer from "puppeteer-core";
const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798",owner="report-upgrade-synthetic",subjectId="person-upgrade",reportId="22222222-2222-4222-8222-222222222222",previousId="11111111-1111-4111-8111-111111111111";
const compiled=await build({stdin:{contents:'export {computeChatActivity} from "./lib/chat-activity"; export {buildRelationshipDiagnosis} from "./lib/relationship-diagnosis";',resolveDir:process.cwd()},bundle:true,write:false,platform:"node",format:"esm"});
const {computeChatActivity,buildRelationshipDiagnosis}=await import("data:text/javascript;base64,"+Buffer.from(compiled.outputFiles[0].text).toString("base64"));
const records=Array.from({length:90},(_,i)=>({id:"source-"+i,localId:"source-"+i,kind:"text",source:{method:"wechat-local-db",idStability:"stable",accountId:"synthetic",sessionId:"synthetic",messageShard:"test",messageId:String(i),timestampOrigin:"wechat-create-time"},senderRole:i%2?"other":"self",text:i%2?"周六两点我可以。":"那我们一起确认时间。",at:"2026-10-"+String(1+Math.floor(i/10)).padStart(2,"0")+"T10:"+String(i%60).padStart(2,"0")+":00+08:00"}));
const activity=computeChatActivity(records),diagnosis=buildRelationshipDiagnosis(activity);
const semantic={status:"complete",coverage:{totalImported:90,receivedText:90,analyzedText:90,missingFromText:0,chunkCount:1,selectedLineCount:0},summary:"双方开始商量见面，实际落实仍要核对。",summaryEvidenceIds:["new"],actionEvidenceIds:["new"],trend:"待了解",action:"确认周六的时间和地点。",findings:[{id:"new",claim:"出现具体时间",evidence:[{sourceId:"source-3",senderRole:"other",quote:records[3].text,at:records[3].at}]}]};
const full={id:reportId,reportId,subjectId,analysisScope:"fullHistory",captureOrigin:true,lines:[],chatActivity:activity,semanticHistory:semantic,relationshipDiagnosis:diagnosis,decision:{judgment:semantic.summary,nextStep:semantic.action,replyOptions:[]}};
let report=full,feedback=null,posts=0;
const changes={status:"compared",previousId,actionChange:{before:"先问哪天方便。",after:"确认周六的时间和地点。",sources:[{reportId,sourceId:"source-3",quote:records[3].text,at:records[3].at}]},previousSummary:"还未提到具体时间。",currentSummary:semantic.summary,note:"只比较新增依据，不把表达变化当成关系已转变。",items:[{kind:"revised",title:"判断表述有更新",detail:"对方给出了可用时间。",sources:[{reportId,sourceId:"source-3",quote:records[3].text,at:records[3].at}]}]};
await mkdir("outputs/report-upgrades",{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"]});
try{for(const width of [1440,390]){
 const ctx=await browser.createBrowserContext(),page=await ctx.newPage(),errors=[];feedback=null;posts=0;report=full;
 await page.setViewport({width,height:950});page.on("pageerror",e=>errors.push(e.message));await page.setRequestInterception(true);
 page.on("request",request=>{const url=new URL(request.url());if(!url.pathname.startsWith("/api/"))return request.continue();let value={};
 if(url.pathname==="/api/auth/session")value={loggedIn:true,user:{id:owner}};
 if(url.pathname==="/api/account/credits")value={account:{userId:owner,balance:1000},prices:{}};
 if(url.pathname==="/api/web/profile")value={enabled:true,paused:false,self:{},subjects:[{id:subjectId,label:"合成测试人物",data:{}}]};
 if(url.pathname==="/api/web/report")value={reportId,kind:"chat",subjectId,totalCount:90,report};
 if(url.pathname==="/api/web/relationship-feedback"){
  if(request.method()==="POST"){posts++;const data=JSON.parse(request.postData());feedback={...data,recordedAt:Date.now(),revisionOf:feedback?.id||null};value={feedback};}
  else value={subjectId,versionChanges:changes,currentFeedback:{reportId,action:semantic.action,latest:feedback,revisionCount:feedback?1:0}};
 }
 if(url.pathname==="/api/web/capture/library")value={ownerId:owner,library:{id:"lib-chat",kind:"chat",friend:"合成测试"},sourceIds:records.map(r=>r.localId),records};
 return request.respond({status:200,contentType:"application/json",body:JSON.stringify(value)});
 });
 await page.goto(origin+"/report?id="+reportId,{waitUntil:"networkidle0"});await page.waitForSelector('[data-report-update="changed"]');
 assert.equal(await page.$$eval('[data-report-update="changed"]',n=>n.length),1);assert.equal(posts,0);
 await page.$eval("[data-report-update] summary",node=>node.click());
 assert.match(await page.$eval("[data-report-update]",node=>node.textContent),/先问哪天方便/);
 assert.equal(await page.$$eval("[data-report-update] blockquote",nodes=>nodes.length),1,"action and judgment share one exact evidence location");
 await page.$eval("[data-report-update] summary",node=>node.click());
 assert.match(await page.$eval('[data-report-update]',n=>n.textContent),/判断表述有更新/);
 assert.equal(await page.$eval('[data-report-update] a',n=>n.getAttribute("href")),"/report?id="+previousId);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:"outputs/report-upgrades/overview-"+width+".png",fullPage:true});
 await page.goto(origin+"/report?id="+reportId+"&focus=reply",{waitUntil:"networkidle0"});await page.waitForSelector('[data-reading-section="next"]:not([hidden])');
 await page.waitForSelector('section[aria-label="行动反馈"]');
 await page.evaluate(()=>[...document.querySelectorAll('section[aria-label="行动反馈"] button')].find(b=>b.textContent==="试过了").click());
 await page.type('textarea[aria-label="行动反馈补充"]',"我已确认周六见面");
 await page.evaluate(()=>[...document.querySelectorAll('section[aria-label="行动反馈"] button')].find(b=>b.textContent==="保存反馈").click());
 await page.waitForFunction(()=>document.querySelector('section[aria-label="行动反馈"]').textContent.includes("补充或纠正"));assert.equal(posts,1);
 await page.evaluate(()=>[...document.querySelectorAll('section[aria-label="行动反馈"] button')].find(b=>b.textContent==="补充或纠正").click());
 await page.evaluate(()=>[...document.querySelectorAll('section[aria-label="行动反馈"] button')].find(b=>b.textContent==="情况变了").click());
 await page.$eval('textarea[aria-label="行动反馈补充"]',node=>{node.focus();node.select();});await page.type('textarea[aria-label="行动反馈补充"]',"纠正：还没联系，对方先约了周末");
 await page.evaluate(()=>[...document.querySelectorAll('section[aria-label="行动反馈"] button')].find(b=>b.textContent==="保存纠正").click());
 await page.waitForFunction(()=>document.querySelector('section[aria-label="行动反馈"]').textContent.includes("补充或纠正"));assert.equal(posts,2);assert.equal(feedback.outcome,"changed");assert.ok(feedback.revisionOf);
 await page.reload({waitUntil:"networkidle0"});await page.waitForFunction(()=>document.querySelector('section[aria-label="行动反馈"]')?.textContent.includes("纠正：还没联系"));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:"outputs/report-upgrades/feedback-"+width+".png",fullPage:true});
 // An old report's 40-line signal may remain readable but must never imply 81-line coverage.
 report={id:reportId,subjectId,reportId,lines:Array.from({length:81},(_,i)=>({id:"shot-"+i,speaker:i%2?"self":"other",text:i===80?"Respect the other person's space.":"当次上传原话"+i})),affinity:{value:88,contextCount:40,boundaryApplied:true,valueScope:"partial",dimensions:[{key:"initiative",label:"主动性",value:75,status:"clear"},{key:"reciprocity",label:"回应",value:null,status:"insufficient"}]},decision:{judgment:"对方已经表达边界，先尊重当前决定。",nextStep:"先不继续推进。",evidence:"对方明确说暂时不发展恋爱。",replyOptions:[]}};
 await page.goto(origin+"/report?id="+reportId+"&focus=affinity",{waitUntil:"networkidle0"});await page.waitForSelector('[data-affinity-overview]');
 assert.match(await page.$eval('[data-affinity-scope]',n=>n.textContent),/40.*81.*仅覆盖局部/);
 assert.match(await page.$eval('[data-affinity-overview]',n=>n.textContent),/还不能判断：回应/);
 assert.match(await page.$eval('[data-affinity-overview] h2',n=>n.textContent),/边界/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:"outputs/report-upgrades/affinity-"+width+".png",fullPage:true});
 await page.goto(origin+"/report?id="+reportId+"&focus=intent",{waitUntil:"networkidle0"});await page.waitForSelector('[data-reading-section="change"]:not([hidden])');assert.equal(posts,2,"switching focus never starts analysis");
 assert.deepEqual(errors,[]);await ctx.close();
 }console.log("PASS 1440/390: comparison first view once, focus tabs, real coverage/unknown dimensions/boundaries, feedback save/revise/reload, no paid requests or horizontal overflow.");
}finally{await browser.close();}
