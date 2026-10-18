import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {build} from "esbuild";
import puppeteer from "puppeteer-core";

// Synthetic saved reports only. All APIs are intercepted; no inference or paid actions run.
const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798",owner="history-reading-synthetic",subjectId="person-reading";
const reportId="44444444-4444-4444-8444-444444444444";
const compiled=await build({stdin:{contents:'export {computeChatActivity} from "./lib/chat-activity"; export {buildRelationshipDiagnosis} from "./lib/relationship-diagnosis";',resolveDir:process.cwd()},bundle:true,write:false,platform:"node",format:"esm"});
const {computeChatActivity,buildRelationshipDiagnosis}=await import("data:text/javascript;base64,"+Buffer.from(compiled.outputFiles[0].text).toString("base64"));
const records=Array.from({length:675},(_,i)=>({id:"chat-"+i,localId:"chat-"+i,kind:"text",source:{method:"wechat-local-db",idStability:"stable",accountId:"synthetic",sessionId:"synthetic",messageShard:"test",messageId:String(i),timestampOrigin:"wechat-create-time"},senderRole:i%2?"other":"self",text:i%2?"周六两点我可以，我们提前确定地点。":"我想慢慢了解，也希望见面时间可以提前说好。",at:"2026-09-"+String(1+Math.floor(i/25)).padStart(2,"0")+"T10:"+String(i%60).padStart(2,"0")+":00+08:00",imageCount:0}));
records[3].text="周六两点在展馆门口见吧，我去订票。";
records[5].text="昨天回家有点晚，但和你聊天很开心。";
records[7].text="我习惯先确认时间，你临时有事也可以提前告诉我。";
records[9].text="我暂时还想多了解彼此，不急着确定关系。";
const moments=Array.from({length:7},(_,i)=>({localId:"moment-"+i,kind:"text",senderRole:"other",text:["每周看一场展，给自己一点放慢的时间。","最近喜欢下班后走路，看见光线也会拍下来。","认真对待约好的时间，比临时惊喜更让我安心。","周末和老朋友见面，大家慢慢聊聊近况。","喜欢这次展览里安静的空间。","工作之外，也需要不被打扰的独处时间。","小计划完成了，给自己放一天假。"][i],at:`2026-09-${String(10+i).padStart(2,"0")}T17:00:00+08:00`,source:{method:"wechat-moments",messageId:String(i)},imageCount:0}));
const evidence=(record,kind="chat")=>({sourceId:record.localId,senderRole:record.senderRole,quote:record.text,at:record.at,libraryId:kind==="moments"?"lib-moments":"lib-chat",sourceKind:kind});
const findings=[
 {id:"f1",claim:"对方把见面意愿落实成了具体时间和行动",evidence:[evidence(records[3])],confidence:"中",alternative:"一次安排还不能证明长期稳定投入，需要继续看是否如约出现。"},
 {id:"f2",claim:"对方表达了聊天带来的愉快感受",evidence:[evidence(records[5])],confidence:"中",alternative:"愉快也可能发生在朋友之间，仍需结合后续主动和关系期待。"},
 {id:"f3",claim:"双方都倾向于提前说明安排",evidence:[evidence(records[7]),evidence(records[2])],confidence:"中"},
 {id:"f4",claim:"对方明确希望慢一点确认关系",evidence:[evidence(records[9])],confidence:"高"},
 ...moments.slice(0,4).map((item,i)=>({id:"m"+i,claim:["朋友圈反复出现看展与独处的生活主题","下班散步与摄影是当前可见兴趣","对方公开表达重视约好的时间","朋友圈也记录了已有朋友之间的联系"][i],evidence:[evidence(item,"moments")],confidence:"中"})),
];
const activity=computeChatActivity(records),diagnosis=buildRelationshipDiagnosis(activity);
const semantic={status:"complete",coverage:{totalImported:675,receivedText:682,analyzedText:682,missingFromText:0,chunkCount:4,selectedLineCount:0},summary:"有实际靠近的意愿，但关系期待还需要继续对齐。",explanation:"这段关系里，值得认真看的不是聊天次数本身，而是对方有没有把表达变成安排。对方提出了见面时间，并主动承担订票，这比单独一句聊得开心更能说明愿意投入。\n同时，对方也直接说还想慢慢了解。两条线索放在一起，比较稳妥的理解是愿意继续接触，但还没有承诺进入恋爱关系。你可以回应这次具体邀约，观察是否兑现以及见面后的联系，不用急着要求一个更确定的称呼。",summaryEvidenceIds:["f1","f2","f4"],actionEvidenceIds:["f1"],counterEvidenceIds:["f4"],confidence:"中",trend:"正在靠近，仍待确认",action:"确认这次见面的时间和地点，见面后再看双方是否继续主动。",observeWindow:"这次见面至随后一周",stopCondition:"若反复取消且不给替代安排，降低投入并重新核对期待。",unknowns:["这次邀约是否已经兑现","双方对关系节奏的实际期待"],alternatives:["当前的投入也可能出于朋友之间的欣赏，需要后续实际行动区分。"],findings,
 affinitySignals:[{direction:"support",signal:"有具体安排的靠近",meaning:"对方主动给出时间并提出订票，支持愿意继续见面的判断。",evidenceIds:["f1"],alternative:"尚未验证是否兑现。"},{direction:"counter",signal:"暂不确认关系的边界",meaning:"对方希望慢慢了解，所以现阶段不适合把积极互动直接理解成恋爱承诺。",evidenceIds:["f4"]}],
 profileInsights:[{dimension:"沟通方式",reading:"TA 会直接说明时间和安排，也会把暂时不想确定关系说清楚。对你来说，具体提问比反复猜测更有帮助。",evidenceIds:["f1","f4"],alternative:"这只是这段材料中的表达方式，不等于在所有关系中都如此。"},{dimension:"关系期待",reading:"目前更像希望保留了解空间，同时愿意见面。你表达了提前安排的偏好，可以从一次可兑现的见面开始对齐。",evidenceIds:["f3","f4"]}],
 sourceInsights:{moments:{summary:"这批动态围绕看展、散步、独处和朋友相聚展开，呈现出对日常节奏与具体体验的关注。它们可以提供自然话题，但不能证明恋爱意愿。",evidenceIds:["m0","m1","m3"],unknowns:["可见动态是否覆盖了全部生活安排"],crossSource:{summary:"朋友圈说重视约定，聊天也提出了明确时间，两处表达方向一致。是否真正兑现，还需要结合见面后的记录继续核对。",evidenceIds:["m2","f1"]}}}};
const full={id:reportId,reportId,subjectId,analysisScope:"fullHistory",captureOrigin:true,lines:[],chatActivity:activity,semanticHistory:semantic,relationshipDiagnosis:diagnosis,sourceCoverage:[{libraryId:"lib-chat",kind:"chat",total:675,textRead:675,imagesExpected:2,imagesAnalyzed:1,status:"partial"},{libraryId:"lib-moments",kind:"moments",total:7,textRead:7,imagesExpected:4,imagesAnalyzed:3,status:"partial"}],mediaEvidence:Array.from({length:4},(_,i)=>({mediaId:"image-"+i,sourceId:i===3?"chat-3":"moment-"+i,libraryId:i===3?"lib-chat":"lib-moments",kind:i===3?"chat":"moments",observation:["画面是一处展厅，墙面可见多幅画作。","画面显示河边步道和傍晚天空。","画面可见桌上放着两张展览门票。","聊天附图中可见展馆入口和预约时间。"][i],basis:"visual"})),decision:{judgment:semantic.summary,nextStep:semantic.action,replyOptions:[]}};
let report=full;
await mkdir("outputs/history-report-reading",{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",userDataDir:"D:/Temp/chengzi-history-report-browser",args:["--no-sandbox"]});
try{for(const width of [1440,390]){
 const ctx=await browser.createBrowserContext(),page=await ctx.newPage(),errors=[],requests=[];report=full;
 await page.setViewport({width,height:950});page.on("pageerror",e=>errors.push(e.message));await page.setRequestInterception(true);
 page.on("request",request=>{const url=new URL(request.url());if(!url.pathname.startsWith("/api/"))return request.continue();requests.push({path:url.pathname,method:request.method()});let value={};
  if(url.pathname==="/api/auth/session")value={loggedIn:true,user:{id:owner}};
  if(url.pathname==="/api/account/credits")value={account:{userId:owner,balance:1000},prices:{}};
  if(url.pathname==="/api/web/profile")value={enabled:true,paused:false,self:{},subjects:[{id:subjectId,label:"合成测试人物",data:{}}]};
  if(url.pathname==="/api/web/report")value={reportId,kind:"chat",subjectId,totalCount:675,report};
  if(url.pathname==="/api/web/relationship-feedback")value={subjectId,versionChanges:{status:"first"},currentFeedback:{reportId,latest:null}};
  if(url.pathname==="/api/web/capture/library"){
   const isMoments=url.searchParams.get("id")==="lib-moments",items=isMoments?moments:records;
   value={ownerId:owner,library:{id:isMoments?"lib-moments":"lib-chat",kind:isMoments?"moments":"chat",friend:"合成测试",account:"synthetic",epoch:1},sourceIds:items.map(r=>r.localId),records:items};
  }
  return request.respond({status:200,contentType:"application/json",body:JSON.stringify(value)});
 });
 const shot=async(label,selector)=>{if(selector)await page.$eval(selector,node=>node.scrollIntoView({block:"start",behavior:"instant"}));await new Promise(resolve=>setTimeout(resolve,200));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label+" must fit viewport");await page.screenshot({path:`outputs/history-report-reading/${label}-${width}.png`});};
 const select=async(name)=>{await page.evaluate(name=>[...document.querySelectorAll('[data-history-reading] [role="tab"]')].find(button=>button.textContent===name).click(),name);};
 await page.goto(origin+"/report?id="+reportId+"&focus=affinity",{waitUntil:"networkidle0"});await page.waitForSelector("[data-history-insights]");
 assert.equal(await page.$$eval('[data-history-insights] [data-history-findings] article',nodes=>nodes.length),3,"first three detailed findings visible");
 assert.equal(await page.$$eval('[data-history-insights] [data-history-findings] blockquote',nodes=>nodes.length),3,"original evidence directly readable");
 assert.match(await page.$eval("[data-history-insights]",node=>node.textContent),/对方明确希望慢一点确认关系/);
 assert.match(await page.$eval("[data-history-insights]",node=>node.textContent),/这段关系里，值得认真看的/);
 assert.equal(await page.$eval('[data-history-insights]',node=>!!node.closest("dialog,details")),false);
 assert.equal(await page.$$eval("[data-affinity-signals] article",nodes=>nodes.length),2);
 assert.equal(await page.$("[data-history-affinity]"),null,"do not invent a numeric score");
 assert.equal(await page.$$eval("[data-message-composition]",nodes=>nodes.length),1,"full-history lines=[] retains actual data chart");
 await shot("overview");await shot("reasoning","[data-history-reading]");
 await page.$eval('nav[aria-label="判断线索分页"] button:last-child',node=>node.click());
 assert.match(await page.$eval('[data-history-findings]',node=>node.textContent),/双方都倾向于提前说明安排/);
 assert.equal(await page.$$eval('[data-history-findings] article',nodes=>nodes.length),1);
 await select("人物解读");await page.waitForSelector("[data-profile-insights]");
 assert.match(await page.$eval("[data-profile-insights]",node=>node.textContent),/TA 会直接说明时间/);await shot("profile","[data-history-reading]");
 await select("朋友圈与图片");await page.waitForSelector("[data-history-moments]");
 assert.match(await page.$eval("[data-history-moments]",node=>node.textContent),/已导入 7 条朋友圈/);
 assert.match(await page.$eval("[data-history-moments]",node=>node.textContent),/图片已解读 4 \/ 6 张/);
 assert.equal(await page.$$eval("[data-moments-finding]",nodes=>nodes.length),3);
 assert.match(await page.$eval("[data-cross-source-reading]",node=>node.textContent),/是否真正兑现/);
 await shot("moments","[data-history-reading]");
 await page.$eval('[data-moments-finding] [data-capture-evidence]',node=>node.click());
 await page.waitForSelector('[data-capture-evidence-dialog][open] [data-capture-record="moment-0"]');
 assert.match(await page.$eval('[data-capture-evidence-dialog][open]',node=>node.textContent),/原始朋友圈动态/);
 await page.$eval('[data-capture-evidence-dialog][open] button[aria-label="关闭原始记录"]',node=>node.click());
 await page.$eval('nav[aria-label="朋友圈线索分页"] button:last-child',node=>node.click());
 assert.equal(await page.$$eval("[data-moments-finding]",nodes=>nodes.length),1);
 await page.$eval('nav[aria-label="图片解读分页"] button:last-child',node=>node.click());
 assert.match(await page.$eval('[data-history-images]',node=>node.textContent),/聊天附图中可见展馆入口/);
 await page.$eval('[role="tab"][aria-controls$="-panel-change"]',node=>node.click());await page.waitForSelector('[data-reading-section="change"]:not([hidden]) [data-chat-activity]');
 assert.equal(await page.$eval('[data-chat-activity]',node=>!!node.closest("dialog,details")),false,"full chart is shallow visible");
 assert.match(await page.$eval('[data-chat-activity]',node=>node.textContent),/675/);
 if(width>760)assert.equal(await page.$eval('[data-chat-activity]',node=>{const cards=[...node.querySelectorAll('h3')].slice(0,3).map(h=>h.parentElement.getBoundingClientRect());return Math.abs(cards[0].top-cards[2].top)<2&&cards[2].left>cards[0].right&&cards[1].top>=cards[0].bottom;}),true,"no empty desktop column beside charts");
 await shot("activity","[data-chat-activity]");
 // Older saved full reports gain the same reading paths without inventing new analysis.
 report={...full,sourceCoverage:[],mediaEvidence:[],semanticHistory:{...semantic,profileInsights:undefined,sourceInsights:undefined,affinitySignals:undefined,findings:findings.slice(0,4)}};
 await page.goto(origin+"/report?id="+reportId+"&focus=affinity",{waitUntil:"networkidle0"});await page.waitForSelector("[data-history-insights]");
 assert.match(await page.$eval("[data-history-insights]",node=>node.textContent),/支持与相反线索/);
 await select("人物解读");assert.match(await page.$eval("[data-profile-insights]",node=>node.textContent),/旧报告没有保存独立的人物解读/);
 await select("朋友圈与图片");assert.match(await page.$eval("[data-history-moments]",node=>node.textContent),/未导入朋友圈到这份报告/);
 assert.equal(await page.$("[data-history-images]"),null);await shot("legacy","[data-history-reading]");
 assert.equal(requests.some(request=>request.method!=="GET"),false,"reading never invokes analysis or charging");assert.deepEqual(errors,[]);await ctx.close();
 }console.log("PASS 1440/390: full-history lines=[] exposes reasoning, real signals, original quotes, bounded evidence pages, profile, Moments cross-source and image findings, exact Moments source, visible real activity charts; old reports remain honest; no paid writes/overflow.");
}finally{await browser.close();}
