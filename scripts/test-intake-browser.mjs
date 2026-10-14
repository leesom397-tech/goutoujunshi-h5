import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"],defaultViewport:{width:1280,height:1000}});
const origin = process.env.INTAKE_TEST_ORIGIN || "http://127.0.0.1:8798";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGkAAAAASUVORK5CYII=";
let owner="intake-owner-a", resume=false; const submitted=[];
const context=await browser.createBrowserContext(), page=await context.newPage(), failures=[];
page.on("pageerror",error=>failures.push(error.message));
await page.setRequestInterception(true);
page.on("request",async request=>{
  if(!request.url().startsWith(origin+"/api/")){await request.continue();return;}
  const path=new URL(request.url()).pathname;
  let value={};
  if(path==="/api/account/credits")value={account:{userId:owner,balance:100},prices:{analysisSmall:3,analysisMedium:5,analysisLarge:8,profile:5}};
  else if(path==="/api/web/profile")value={enabled:true,paused:false,subjects:[{id:"person-a",label:owner==="intake-owner-a"?"测试甲":"另一账号人物"},{id:"person-b",label:"测试乙"}]};
  else if(path==="/api/web/report/list")value={reports:[]};
  else if(path==="/api/web/screenshot/batch"){
    if(request.method()==="POST")submitted.push(JSON.parse(request.postData()||"{}"));
    value=resume?{status:"done",imageCount:1,totalCount:1,result:{entries:[{id:"saved-entry",selfSide:"left",lines:[{speaker:"other",text:"周六见。"}],decision:{judgment:"已恢复的报告",evidence:"虚构材料",nextStep:"按约见面",replySuggestions:[]}}],reportId:"11111111-1111-4111-8111-111111111111"}}:{status:"running",phase:"ocr",imageCount:1,completedCount:0};
  }
  await request.respond({status:200,contentType:"application/json",body:JSON.stringify(value)});
});
await page.evaluateOnNewDocument(()=>{
  const key=(scope,value)=>"chengzi-intake:v1:"+JSON.stringify(["intake-owner-a",scope,value]);
  if(!localStorage.getItem("intake-fixture-ready")){
    localStorage.setItem(key("last","chat"),JSON.stringify({subjectId:"person-a"}));
    localStorage.setItem(key("subject","person-a"),JSON.stringify({subjectId:"person-a",selfSide:"left"}));
    localStorage.setItem(key("subject","person-b"),JSON.stringify({subjectId:"person-b",selfSide:"right"}));
    localStorage.setItem("intake-fixture-ready","1");
  }
});
async function images(rows){await page.evaluate((rows)=>{const input=document.querySelector('input[type="file"][aria-label="选择分析截图"]'),data=new DataTransfer();for(const row of rows){data.items.add(new File([Uint8Array.from(atob(row.data),c=>c.charCodeAt(0)),row.extra||""],row.name,{type:"image/png"}));}input.files=data.files;input.dispatchEvent(new Event("change",{bubbles:true}));},rows);}
async function textContains(text){await page.waitForFunction(text=>document.body.textContent.includes(text),{},text);}
try{
  await page.goto(origin+"/analyze?new=1",{waitUntil:"networkidle0"});
  await textContains("继续了解 测试甲");
  assert.match(await page.$eval('section[aria-label="当前分析人物"]',e=>e.textContent),/左侧是我/);
  await images([{name:"same.png",data:png},{name:"copy.png",data:png},{name:"same.png",data:png,extra:"different bytes"}]);
  await page.waitForFunction(()=>document.querySelectorAll(".wa-images .wa-image").length===2);
  await textContains("已跳过 1 张完全相同");
  await images([{name:"renamed.png",data:png}]);await textContains("已跳过 1 张完全相同");
  assert.equal(await page.$$eval(".wa-images .wa-image",e=>e.length),2);
  await page.$$eval('section[aria-label="当前分析人物"] button',buttons=>buttons.find(button=>button.textContent==="换个人").click());
  await page.select('section[aria-label="当前分析人物"] select',"person-b");
  await textContains("继续了解 测试乙");
  assert.match(await page.$eval('[aria-label="选择我的气泡位置"] button[aria-pressed="true"]',e=>e.textContent),/右侧是我/);
  owner="intake-owner-b";await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(()=>!document.querySelector('section[aria-label="当前分析人物"]')&&!document.querySelector(".wa-image"));
  await images([{name:"new.png",data:png}]);await page.waitForSelector(".wa-image");
  assert.equal(await page.$$eval('[aria-label="选择我的气泡位置"] button[aria-pressed="true"]',e=>e.length),0,"account switch cannot leak a remembered side");
  owner="intake-owner-a";resume=true;
  await page.evaluate(async png=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("chengzi-web-uploads",1);r.onupgradeneeded=()=>r.result.createObjectStore("tasks");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction("tasks","readwrite");tx.objectStore("tasks").put({owner:"intake-owner-a",taskId:"11111111-1111-4111-8111-111111111111",path:"/api/web/screenshot/batch",mode:"chat",parameters:{confirmed:true,selfSide:"left",subjectId:"person-a"},expiresAt:Date.now()+60000,files:[new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],"saved.png",{type:"image/png"})]},"intake-owner-a");tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();},png);
  await page.goto(origin+"/analyze?new=1",{waitUntil:"networkidle0"});await textContains("已恢复的报告");
  assert.equal(submitted.length,1,"recovery reuses one task without another upload or charge request");
  assert.equal(submitted[0].taskId,"11111111-1111-4111-8111-111111111111");
  assert.equal(submitted[0].uploadAction,"init");
  assert.equal(failures.length,0,failures.join("\n"));
  console.log("intake browser: remembered person/side, exact duplicate, account switch, and same-task recovery passed");
}finally{await context.close();await browser.close();}
