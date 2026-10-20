// Real page/navigation checks with synthetic accounts and intercepted APIs only.
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import puppeteer from "puppeteer-core";

const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798";
const output=resolve("outputs/home-support");
await mkdir(output,{recursive:true});
const owner="home-support-fixture";
const subjectA="11111111-1111-4111-8111-111111111111";
const subjectB="22222222-2222-4222-8222-222222222222";
const reportA="33333333-3333-4333-8333-333333333333";
const reportB="44444444-4444-4444-8444-444444444444";
const people=[
  {id:subjectA,label:"同名小林",city:"杭州",stage:"朋友介绍",updatedAt:Date.parse("2026-10-20"),savedChatAnalysis:{reportId:reportA,kind:"chat",createdAt:Date.parse("2026-10-20")}},
  {id:subjectB,label:"同名小林",city:"上海",stage:"同事",updatedAt:Date.parse("2026-10-19"),savedChatAnalysis:{reportId:reportB,kind:"chat",createdAt:Date.parse("2026-10-19")}},
];
function library(subjectId,kind,total,key) {
  return {id:"cl_"+key.repeat(64),account:"synthetic-wechat",friend:"同名小林 · #"+(subjectId===subjectA?"0123456789abcdef":"fedcba9876543210"),subjectId,kind,total,epoch:1,revision:1,createdAt:"2026-10-01T00:00:00Z",updatedAt:"2026-10-20T00:00:00Z",warnings:[],reportLinks:[],deleted:false};
}
const libraries=[library(subjectA,"chat",75,"a"),library(subjectA,"moments",13,"b"),library(subjectB,"chat",42,"c"),library(subjectB,"moments",7,"d")];
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"]});
try {
  // Independent contexts make the genuine 20-second timeout checks run together.
  const widths=process.env.HOME_TEST_WIDTHS?process.env.HOME_TEST_WIDTHS.split(",").map(Number):[1440,390,320];
  await Promise.all(widths.map(async width=>{
    const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],calls=[];
    let scenario="healthy",closed=false;
    await page.setViewport({width,height:1000});
    await page.evaluateOnNewDocument(()=>Object.defineProperty(navigator,"platform",{get:()=>"Win32"}));
    page.on("pageerror",error=>errors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request",async request=>{
      try {
        const url=new URL(request.url());
        if(url.origin!==origin||!url.pathname.startsWith("/api/"))return request.continue();
        calls.push({path:url.pathname,method:request.method(),scenario});
        let value={},status=200;
        const account={account:{userId:owner,balance:100,active:true},prices:{analysisSmall:3,analysisMedium:5,analysisLarge:8,profile:5},people,user:{name:"合成验收用户"}};
        if(url.pathname==="/api/web/account-context") {
          if(scenario==="timeout")return; // Browser AbortSignal must end this read.
          if(scenario==="unavailable"){status=503;value={error:"账号校验暂时不可用",code:"AUTH_IDENTITY_UNAVAILABLE"};}
          else if(scenario==="guest"){status=401;value={error:"请登录"};}
          else value=account;
        } else if(url.pathname==="/api/auth/session")value={loggedIn:scenario!=="guest",user:{id:owner}};
        else if(url.pathname==="/api/account/credits")value=account;
        else if(url.pathname==="/api/web/profile")value={enabled:true,paused:false,subjects:people};
        else if(url.pathname==="/api/web/workspace")value={archive:{enabled:true,paused:false,pendingFacts:0,selfReady:false},people:[],reports:[],peopleTotal:0,total:0,page:1,pageSize:5};
        else if(url.pathname==="/api/web/report/list")value={reports:[]};
        else if(url.pathname==="/api/web/capture/library")value={ownerId:owner,libraries};
        else if(url.pathname==="/api/web/capture/analyze")value={status:"none"};
        else if(url.pathname==="/api/web/report") {
          const id=url.searchParams.get("id"),subjectId=id===reportA?subjectA:subjectB;
          value={reportId:id,kind:"chat",subjectId,totalCount:1,report:{id,reportId:id,subjectId,selfSide:"right",lines:[{id:"line-1",speaker:"other",text:"周六下午两点一起看展。"}],annotations:[],decision:{judgment:"对方提出了明确的见面安排。",evidence:"周六下午两点一起看展。",nextStep:"确认地点，再观察是否兑现。",replyOptions:[]}}};
        }
        await request.respond({status,contentType:"application/json",body:JSON.stringify(value)});
      } catch(error) { if(!closed)errors.push(error.message); }
    });
    const text=value=>page.waitForFunction(value=>document.body.innerText.includes(value),{timeout:30000},value);
    const fits=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`no horizontal overflow at ${width} ${page.url()}`);
    const shot=name=>page.screenshot({path:resolve(output,`${name}-${width}.png`),fullPage:true});
    const navigate=path=>page.goto(origin+path,{waitUntil:"domcontentloaded",timeout:60000});
    async function downloadVisible() {
      const links=await page.$$eval('a[download]',els=>els.filter(el=>el.checkVisibility()).map(el=>el.getAttribute("href")));
      assert.ok(links.includes("/downloads/ChengziWeChatCollector-Setup-1.2.13.exe"),"current EXE download remains available");
      assert.ok(await page.$eval('[aria-label="主导航"] a[href="/support"]',el=>el.checkVisibility()),"persistent Download navigation");
    }
    try {
      await navigate("/workspace");
      await page.waitForSelector("[data-home-start]");
      await page.waitForSelector('[data-account-state="ready"]');
      assert.equal(await page.$$eval("[data-home-start]",els=>els.length),1,"one main home action");
      assert.equal(await page.$("[data-home-task]"),null,"old three-card home removed");
      assert.equal(await page.$("[data-feature-entry]"),null,"specialized tools stay out of the opening");
      const sizes=await page.$$eval('[data-home-start], button[aria-controls="home-more-ways"]',els=>els.map(el=>Number.parseFloat(getComputedStyle(el).fontSize)));
      assert.ok(sizes.every(size=>size>=16),"opening controls remain readable");
      await fits();await shot("home");
      const openMore=async()=>{
        await page.click('button[aria-controls="home-more-ways"]');
        await page.waitForSelector("#home-more-ways[open]");
        assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),"hidden","opening locks background scroll");
        const bounds=await page.$eval("#home-more-ways",el=>{const rect=el.getBoundingClientRect();return {left:rect.left,right:rect.right,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth};});
        assert.ok(bounds.left>=0&&bounds.right<=width+1&&bounds.scrollWidth<=bounds.clientWidth+1,"dialog fits without horizontal scrolling");
      };
      const closedMore=async()=>{
        await page.waitForFunction(()=>!document.querySelector("#home-more-ways[open]")&&document.documentElement.style.overflow!=="hidden",{timeout:5000});
        assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute("aria-controls")),"home-more-ways","closing returns keyboard focus to its trigger");
        assert.notEqual(await page.evaluate(()=>document.documentElement.style.overflow),"hidden","closing restores background scroll");
      };
      await openMore();
      const choices=await page.$$eval("[data-feature-entry]",els=>els.map(el=>({text:el.innerText,href:el.getAttribute("href")})));
      assert.ok(choices.some(el=>el.text.includes("好感探测器")&&el.href==="/analyze?mode=chat&focus=affinity"),"affinity remains an explicit secondary choice");
      assert.ok(choices.some(el=>el.text.includes("截图分析")&&el.href==="/analyze?mode=chat"));
      assert.ok(choices.some(el=>el.href==="/support"),"helper support remains in more options");
      await shot("more-ways");
      await page.keyboard.press("Escape");await closedMore();
      await openMore();await page.click('[aria-label="关闭更多方式"]');await closedMore();
      if(width<=390){
        await page.setViewport({width,height:680});
        await openMore();
        const backgroundScroll=await page.evaluate(()=>scrollY);
        assert.ok(await page.$eval("#home-more-ways",el=>el.scrollHeight>el.clientHeight),"short mobile viewport has a scrollable options sheet");
        const box=await page.$eval("#home-more-ways",el=>{const rect=el.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};});
        await page.mouse.move(box.x,box.y);await page.mouse.wheel({deltaY:450});
        await page.waitForFunction(()=>document.querySelector("#home-more-ways").scrollTop>0);
        assert.equal(await page.evaluate(()=>scrollY),backgroundScroll,"scrolling options does not move the home page");
        await fits();await shot("more-ways-scrolled");
        await page.keyboard.press("Escape");await closedMore();
        await page.setViewport({width,height:1000});
      }
      for(const task of [
        {href:"/analyze?mode=chat&focus=affinity",params:{mode:"chat",focus:"affinity"}},
        {href:"/analyze?mode=chat",params:{mode:"chat"}},
      ]) {
        await navigate("/workspace");
        await page.waitForSelector("[data-home-start]");
        await page.waitForSelector('[data-account-state="ready"]');
        await openMore();
        await page.click(`[data-feature-entry][href="${task.href}"]`);
        await page.waitForFunction(()=>location.pathname==="/analyze",{timeout:30000});
        const next=new URL(page.url());
        for(const [key,value] of Object.entries(task.params))assert.equal(next.searchParams.get(key),value);
        if(!task.params.focus)assert.equal(next.searchParams.has("focus"),false,"screenshot entry has no unintended affinity focus");
      }
      await navigate("/workspace");await page.waitForSelector("[data-home-start]");await page.waitForSelector('[data-account-state="ready"]');
      await page.click("[data-home-start]");
      await page.waitForFunction(()=>location.pathname==="/relationship");
      await page.waitForFunction(()=>document.querySelectorAll("[data-person-entry]").length===2);
      await page.waitForSelector('[aria-label="搜索功能、人物与报告"]');
      await page.click('[aria-label="搜索功能、人物与报告"]');
      await page.waitForSelector(".quick-search-dialog[open]");
      const defaults=await page.$$eval(".quick-search-results a",els=>els.map(el=>({text:el.textContent,href:el.getAttribute("href")})));
      assert.ok(defaults.some(el=>el.text==="好感探测器"&&el.href==="/analyze?mode=chat&focus=affinity"));
      assert.ok(defaults.some(el=>el.text==="帮助与下载"&&el.href==="/support"));
      await fits();await shot("quick-search");await page.click('[aria-label="关闭搜索"]');

      scenario="guest";
      await navigate("/support");
      await text("版本 1.2.13");await downloadVisible();await fits();await shot("support-guest");
      assert.equal(new URL(page.url()).pathname,"/support","downloads do not redirect to login");

      scenario="healthy";
      await navigate("/relationship");
      await page.waitForFunction(()=>document.querySelectorAll("[data-person-entry]").length===2);
      const entries=await page.$$eval("[data-person-entry]",els=>els.map(el=>({
        text:el.innerText,
        primary:el.querySelector(":scope > a").getAttribute("href"),
        links:[...el.querySelectorAll("nav a")].map(a=>({text:a.textContent,href:a.getAttribute("href")})),
      })));
      for(const [subjectId,reportId,chatCount,momentsCount] of [[subjectA,reportA,75,13],[subjectB,reportB,42,7]]) {
        const entry=entries.find(row=>row.primary==="/report?id="+reportId);
        assert.ok(entry,"primary opens that subject's existing report");
        assert.match(entry.text,new RegExp(`${chatCount} 条聊天`));
        assert.match(entry.text,new RegExp(`${momentsCount} 条朋友圈`));
        assert.match(entry.text,/同名人物/);
        const update=entry.links.find(link=>link.text.includes("补充／更新"));
        const href=new URL(update.href,origin);
        assert.equal(href.pathname,"/capture");
        assert.equal(href.searchParams.get("subjectId"),subjectId);
        assert.equal(href.searchParams.get("kind"),"chat");
        const chat=libraries.find(row=>row.subjectId===subjectId&&row.kind==="chat");
        assert.equal(href.searchParams.get("libraryId"),"capture:"+JSON.stringify([owner,chat.account,chat.friend,chat.kind]),"update retains exact original library namespace");
        assert.ok(entry.links.some(link=>new URL(link.href,origin).pathname==="/analyze"&&new URL(link.href,origin).searchParams.get("subjectId")===subjectId));
      }
      await downloadVisible();await fits();await shot("same-name-people");
      await page.$eval(`[data-person-entry] > a[href="/report?id=${reportA}"]`,el=>el.scrollIntoView({block:"center",behavior:"instant"}));
      await page.click(`[data-person-entry] > a[href="/report?id=${reportA}"]`);
      await page.waitForFunction(id=>location.pathname==="/report"&&new URLSearchParams(location.search).get("id")===id,{},reportA);
      assert.equal(calls.filter(call=>call.method==="POST"&&/analyze|screenshot|rewrite/.test(call.path)).length,0,"browsing and updates never initiate analysis");

      for(const failure of ["unavailable","timeout"]) {
        scenario=failure;
        await navigate("/relationship");
        await page.waitForSelector('a[download]');
        await downloadVisible();
        await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(el=>el.textContent==="重新连接"),{timeout:30000});
        assert.doesNotMatch(await page.$eval("#saved-people",el=>el.innerText),/正在读取已有资料/,"failure cannot leave a permanent loading state");
        await downloadVisible();await fits();await shot(`account-${failure}`);
        assert.equal(new URL(page.url()).pathname,"/relationship","service failure is not a forced login");
      }
      scenario="healthy";
      await page.evaluate(()=>[...document.querySelectorAll("button")].find(el=>el.textContent==="重新连接").click());
      await page.waitForFunction(()=>document.querySelectorAll("[data-person-entry]").length===2);
      assert.deepEqual(errors,[]);
      console.log(`PASS ${width}: one home action; secondary affinity/screenshot routes; modal focus/Escape/scroll; guest EXE/persistent download; same-name subject/library grouping; 20s timeout and 503 recover; no analysis POST`);
    } catch(error) {
      console.error(`FAIL ${width}`,page.url(),errors,await page.$eval("body",el=>el.innerText));
      await shot("failure").catch(()=>{});
      throw error;
    } finally {closed=true;await context.close();}
  }));
} finally {await browser.close();}
