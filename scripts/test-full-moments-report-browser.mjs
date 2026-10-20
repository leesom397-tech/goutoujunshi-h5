import assert from "node:assert/strict";
import {readFile,mkdir} from "node:fs/promises";
import puppeteer from "puppeteer-core";
const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798";
const full=JSON.parse(await readFile("outputs/report-route-fixtures/full-person.json","utf8"));
const stats=JSON.parse(await readFile("outputs/moments-report/statistics.json","utf8"));
const library="synthetic-moments-library";
const findings=Array.from({length:5},(_,i)=>({id:`moment-fixture-${i}`,subject:"other",claim:`动态解读 ${i+1}：公开记录了公园或展览经历，可以作为具体话题线索。`,alternative:`解释 ${i+1}：公开展示不等于日常频率或对用户的态度。`,evidence:[{sourceKind:"moments",libraryId:library,sourceId:["a","b","g","e","f"][i],senderRole:"other",basis:"caption",materialRole:"moment",at:i<3?"2026-09-01":"",quote:`合成原文 ${i+1}：周末去了公园和展览。`}]}));
full.semanticHistory.findings=[...full.semanticHistory.findings.filter(f=>f.evidence.every(e=>e.sourceKind!=="moments")),...findings];
full.semanticHistory.sourceInsights.moments={status:"analyzed",summary:"动态保留了公园与展览线索，适合从真实活动细节展开了解。",evidenceIds:findings.map(f=>f.id),crossSource:{summary:"聊天与动态都提到散步，但不能直接认定同一次活动或共同邀约。",evidenceIds:[full.semanticHistory.findings[0].id,findings[0].id]},unknowns:["公开表达与实际相处习惯是否一致仍需核实。"]};
full.semanticHistory.actionPlan.steps.push({title:"从动态具体细节聊起",action:"问问那次展览最喜欢哪个作品。",why:"已有配文确实提到展览，这比泛泛评价更有具体回应空间。",evidenceIds:[findings[1].id],observeFor:"接下来一轮互动",stopWhen:"对方不想继续这个话题就停下。",reply:"你发的那个展里，最喜欢哪件作品？"});
full.momentsStatistics=stats;
full.sourceCoverage=[...full.sourceCoverage.filter(source=>source.kind==="chat"),{libraryId:library,kind:"moments",total:9,momentCount:7,profileMaterialCount:2,pinnedCount:1,coverCount:1,signatureCount:1,textRead:6,imagesExpected:3,imagesAvailable:3,imagesAnalyzed:3,status:"complete",imageScope:"synced-preview"}];
full.relatedSnapshots=[{libraryId:library,kind:"moments",total:9}];
full.profileMaterials=[{libraryId:library,sourceId:"cover",materialRole:"moments-cover",text:"[封面]"}, {libraryId:library,sourceId:"signature",materialRole:"profile-signature",text:"认真生活，慢慢了解。"}];
full.mediaEvidence=[{libraryId:library,sourceId:"a",mediaId:"frame-a",kind:"moments",materialRole:"moment",observation:"画面可见一条树荫步道。"}, {libraryId:library,sourceId:"c",mediaId:"frame-c",kind:"moments",materialRole:"moment",observation:"画面可见展馆中的艺术装置。"}, {libraryId:library,sourceId:"cover",mediaId:"frame-cover",kind:"moments",materialRole:"moments-cover",observation:"封面可见山间的天空。"}];
full.personalConnection=null;
await mkdir("outputs/moments-report",{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"]});
try{
  for(const width of [1440,390,320]){
    const context=await browser.createBrowserContext(),page=await context.newPage(),writes=[],errors=[];
    let report=structuredClone(full);
    await page.setViewport({width,height:1000});await page.setRequestInterception(true);
    page.on("pageerror",error=>errors.push(error.message));
    page.on("request",request=>{
      const url=new URL(request.url());if(!url.pathname.startsWith("/api/"))return request.continue();
      if(request.method()!=="GET")writes.push(url.pathname);
      let value={};
      if(url.pathname==="/api/auth/session")value={loggedIn:true,user:{id:"moments-ui-fixture"}};
      if(["/api/account/credits","/api/web/account-context"].includes(url.pathname))value={account:{userId:"moments-ui-fixture",balance:100},prices:{},people:[]};
      if(url.pathname==="/api/web/report")value={reportId:report.reportId,kind:report.captureKind==="moments"?"moments":"chat",subjectId:report.subjectId,report};
      if(url.pathname==="/api/web/profile")value={enabled:true,subjects:[]};
      if(url.pathname==="/api/web/relationship-feedback")value={versionChanges:{status:"first"},currentFeedback:{latest:null}};
      return request.respond({status:200,contentType:"application/json",body:JSON.stringify(value)});
    });
    const open=async()=>{await page.goto(`${origin}/report?id=${report.reportId}`,{waitUntil:"networkidle0"});await page.waitForSelector("[data-history-reading]");};
    const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${width}: no overflow`);
    try{
      await open();
      assert.ok(await page.$("[data-history-moments-overview] [data-moments-statistics]"));
      assert.match(await page.$eval("[data-history-moments-overview]",node=>node.innerText),/7 条动态/);
      assert.match(await page.$eval("[data-report-connection]",node=>node.innerText),/回应散步时你也喜欢的一个细节/,"action remains visible without personalConnection");
      assert.ok(await page.$("[data-report-connection] [data-history-action-overview] .wa-capture-evidence, [data-report-connection] [data-history-action-overview] button"));
      await (await page.$("[data-history-moments-overview]")).screenshot({path:`outputs/moments-report/overview-${width}.png`});
      await page.$eval("[data-history-moments-overview] > button",node=>node.click());
      await page.waitForSelector("[data-history-moments]");
      await page.waitForFunction(()=>document.querySelector('[aria-label="选择详细解读"]')?.getBoundingClientRect().top >= document.querySelector('[aria-label="报告阅读顺序"]').getBoundingClientRect().bottom);
      assert.equal(await page.$("[data-history-moments-overview]"),null,"overview does not duplicate an opened section");
      assert.equal(await page.$$eval("[data-moments-finding]",nodes=>nodes.filter(node=>node.checkVisibility()).length),5,"all saved interpretations are visible without paging");
      assert.equal(await page.$$eval("[data-moments-image-observation]",nodes=>nodes.length),2,"real image observations preserved, cover separated");
      assert.ok(await page.$('[data-moments-finding] [data-reading-kind="fact"]'));
      assert.ok(await page.$('[data-moments-finding] [data-reading-kind="inference"]'));
      assert.ok(await page.$('[data-moments-finding] [data-reading-kind="alternative"]'));
      assert.match(await page.$eval("[data-cross-source-reading]",node=>node.innerText),/聊天与动态.*不能直接认定/s);
      assert.match(await page.$eval("[data-moments-action]",node=>node.innerText),/问问那次展览最喜欢哪个作品.*接下来一轮互动.*不想继续/s);
      assert.match(await page.$eval("[data-history-profile-materials]",node=>node.innerText),/封面可见山间的天空.*认真生活，慢慢了解/s);
      assert.match(await page.$eval("[data-moments-statistics]",node=>node.innerText),/2 条日期不完整/);
      await page.$eval('[data-moments-month-chart] button[aria-label="2026-09，2 条动态"]',node=>node.click());
      assert.match(await page.$eval("[data-moments-month-evidence]",node=>node.innerText),/2026-09.*2 条动态.*核对本月原文/s);
      await fits();await page.screenshot({path:`outputs/moments-report/details-${width}.png`});
      if(width===1440){
        report={...structuredClone(full),reportId:crypto.randomUUID(),id:crypto.randomUUID(),momentsStatistics:undefined};
        await open();await page.$eval("[data-history-moments-overview] > button",node=>node.click());
        await page.waitForSelector("[data-moments-statistics-unavailable]");
        assert.equal(await page.$("[data-moments-month-chart]"),null,"old report has no invented chart");
        assert.equal(await page.$$eval("[data-moments-finding]",nodes=>nodes.length),5);
        report={...structuredClone(full),reportId:crypto.randomUUID(),captureKind:"moments",kind:"profile",chatActivity:null,archiveSnapshot:{libraryId:library,total:9},relatedSnapshots:[]};
        await open();await page.waitForSelector("[data-history-moments] [data-moments-statistics]");
        assert.match(await page.$eval("[data-report-participants]",node=>node.innerText),/完整朋友圈报告/);
        report={...structuredClone(full),reportId:crypto.randomUUID(),momentsStatistics:undefined,moments:{statistics:{total:3,classified:3,unclassified:0,copyTotal:3,content:[{label:"旅行",count:2,total:3,percent:67,evidence:"两条合成旅行动态"}],copy:[],selfie:{known:0,count:0,unknown:3,percent:null},scope:"原截图中的三条动态。"},posts:[]}};
        await open();await page.$eval("[data-history-moments-overview] > button",node=>node.click());
        await page.waitForSelector("[data-legacy-moments-statistics]");
        assert.match(await page.$eval("[data-legacy-moments-statistics]",node=>node.innerText),/3.*旅行.*原截图中的三条/s);
      }
      assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);await fits();
      console.log(`PASS ${width}: truthful overview/month charts, all 5 findings, 2 image observations, profile material separation, cross-source evidence, visible supported action, old-statistics compatibility; no paid API`);
    }catch(error){console.error(await page.$eval("body",node=>node.innerText));throw error;}
    finally{await context.close();}
  }
}finally{await browser.close();}
