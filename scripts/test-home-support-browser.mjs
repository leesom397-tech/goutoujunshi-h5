// Real page/navigation checks with synthetic accounts and intercepted APIs only.
import assert from "node:assert/strict";
import {mkdir,readFile} from "node:fs/promises";
import {resolve} from "node:path";
import puppeteer from "puppeteer-core";

const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798";
const release=JSON.parse(await readFile(new URL("../public/downloads/collector-release.json",import.meta.url),"utf8"));
const affinityHref="/analyze?mode=chat&focus=affinity";
const expectedFeatures=[
  ["好感探测器",affinityHref],["聊天解读","/analyze?mode=chat"],
  ["朋友圈与主页","/analyze?mode=moments"],["问成子","/chat"],
];
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
      assert.ok(links.includes(`/downloads/ChengziWeChatCollector-Setup-${release.version}.exe`),"current EXE download remains available");
      assert.ok(await page.$eval('[aria-label="主导航"] a[href="/support"]',el=>el.checkVisibility()),"persistent Download navigation");
    }
    try {
      await navigate("/workspace");
      await page.waitForSelector("[data-home-start]");
      await page.waitForSelector('[data-account-state="ready"]');
      assert.equal(await page.$$eval("[data-home-start]",els=>els.length),1,"one main home action");
      assert.equal(await page.$("[data-home-task]"),null,"old three-card home removed");
      const sizes=await page.$$eval('[data-home-start], [data-home-more] summary',els=>els.map(el=>Number.parseFloat(getComputedStyle(el).fontSize)));
      assert.ok(sizes.every(size=>size>=16),"opening controls remain readable");
      assert.equal(await page.$("dialog"),null,"home features never require opening a dialog");
      const choices=await page.$$eval("#home-more-ways [data-feature-entry]",els=>els.map(el=>({
        title:el.querySelector("strong").textContent,href:el.getAttribute("href"),visible:el.checkVisibility(),
        icon:!!el.querySelector(":scope > span svg"),
        titleSize:Number.parseFloat(getComputedStyle(el.querySelector("strong")).fontSize),
        captionSize:Number.parseFloat(getComputedStyle(el.querySelector("strong + span")).fontSize),
        height:el.getBoundingClientRect().height,
      })));
      assert.deepEqual(choices.map(row=>[row.title,row.href]),expectedFeatures,"four grouped tools remain visible with affinity included");
      assert.ok(choices.every(row=>row.visible&&row.icon&&row.titleSize>=18&&row.captionSize>=16&&row.height>=44),"every tool keeps its own icon and readable tap target");
      const alternatives=await page.$$eval("#home-more-ways nav a",els=>els.map(el=>({href:el.getAttribute("href"),visible:el.checkVisibility(),height:el.getBoundingClientRect().height})));
      for(const href of [affinityHref,"/analyze?mode=chat","/capture?kind=chat&method=video","/analyze?mode=moments","/analyze?mode=social","/chat","/voice"]){
        assert.ok(alternatives.some(value=>value.href===href&&value.visible&&value.height>=44),"nearby secondary route retained: "+href);
      }
      for(const href of ["/archive","/support"])assert.ok(await page.$eval(`[aria-label="主导航"] a[href="${href}"]`,el=>el.checkVisibility()),"global utility retained: "+href);
      assert.equal(await page.$$eval("#home-more-ways article",els=>els.length),4,"no empty fifth card");
      assert.equal(await page.$('#home-more-ways[hidden], #home-more-ways details, #home-more-ways button[aria-expanded]'),null,"no collapsed feature list");
      await fits();await shot("home");
      await page.click('[data-home-more] summary');
      await page.waitForFunction(()=>document.querySelector('[data-home-more]').open);
      const quick=await page.$$eval('[aria-label="更多方式快捷入口"] a',els=>els.map(el=>({href:el.getAttribute('href'),visible:el.checkVisibility(),height:el.getBoundingClientRect().height})));
      assert.deepEqual(quick.map(row=>row.href),expectedFeatures.map(row=>row[1]));
      assert.ok(quick.every(row=>row.visible&&row.height>=44),'click reveals real immediate actions');
      await fits();await page.screenshot({path:resolve(output,`more-ways-${width}.png`),fullPage:false});
      await page.click('[data-home-more] summary');
      assert.equal(await page.$eval('[data-home-more]',el=>el.open),false);
      await page.focus('[data-home-more] summary');await page.keyboard.press("Enter");
      await page.waitForFunction(()=>document.querySelector('[data-home-more]').open);
      // Native details remains operable without React hydration or hash scrolling.
      await page.setJavaScriptEnabled(false);
      await page.goto(origin+'/workspace',{waitUntil:'networkidle0'});
      await page.click('[data-home-more] summary');
      assert.equal(await page.$eval('[data-home-more]',el=>el.open),true);
      await page.setJavaScriptEnabled(true);
      await navigate('/workspace');
      assert.equal(await page.$eval("[data-home-start]",el=>el.textContent),"关系透视");
      assert.equal(await page.$eval('.web-nav-tools a[href="/relationship"]',el=>el.textContent),"关系透视");
      for(const task of [
        {href:affinityHref,params:{mode:"chat",focus:"affinity"}},
        {href:"/analyze?mode=chat",params:{mode:"chat"}},
      ]) {
        await navigate("/workspace");
        await page.waitForSelector("[data-home-start]");
        await page.waitForSelector('[data-account-state="ready"]');
        await page.$eval(`[data-feature-entry][href="${task.href}"]`,el=>el.scrollIntoView({block:"center",behavior:"instant"}));
        await page.click(`[data-feature-entry][href="${task.href}"]`);
        await page.waitForFunction(href=>location.pathname+location.search===href,{timeout:30000},task.href);
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
      assert.ok(defaults.some(el=>el.text==="好感探测器"&&el.href===affinityHref));
      assert.ok(defaults.some(el=>el.text==="帮助与下载"&&el.href==="/support"));
      await fits();await shot("quick-search");await page.click('[aria-label="关闭搜索"]');

      scenario="guest";
      await navigate("/support");
      await text(`版本 ${release.version}`);await downloadVisible();await fits();await shot("support-guest");
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
      console.log(`PASS ${width}: one home action; four grouped tools; native expandable shortcut menu with keyboard and JavaScript disabled; affinity/screenshot routes; guest EXE/persistent download; same-name subject/library grouping; 20s timeout and 503 recover; no analysis POST`);
    } catch(error) {
      console.error(`FAIL ${width}`,error,page.url(),errors,await page.$eval("body",el=>el.innerText).catch(()=>"(navigation in progress)"));
      await shot("failure").catch(()=>{});
      throw error;
    } finally {closed=true;await context.close();}
  }));
} finally {await browser.close();}
