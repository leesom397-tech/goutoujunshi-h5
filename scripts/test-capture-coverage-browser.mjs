import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import {build} from "esbuild";
const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798",owner="coverage-fixture-owner",out=path.resolve("outputs/capture-coverage");
fs.mkdirSync(out,{recursive:true});
const bundle=await build({entryPoints:["lib/desktop-capture-vault.ts"],bundle:true,write:false,format:"iife",globalName:"CoverageVault",platform:"browser"});
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"]});
try{
 for(const width of [1440,390]){
  const context=await browser.createBrowserContext(),page=await context.newPage(),writes=[],errors=[];
  await page.setViewport({width,height:1000});page.on("pageerror",e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on("request",async request=>{
   const url=new URL(request.url());if(!request.url().startsWith(origin+"/api/")&&!url.port.endsWith("17863"))return request.continue();
   if(request.method()!=="GET"||url.port==="17863")writes.push(url.pathname);
   let value={};
   if(url.pathname==="/api/auth/session")value={loggedIn:true,user:{id:owner}};
   if(url.pathname==="/api/account/credits")value={account:{userId:owner,balance:100,active:true},prices:{analysisSmall:3,profile:5}};
   if(url.pathname==="/api/web/profile")value={enabled:true,paused:false,subjects:[]};
   await request.respond({status:200,contentType:"application/json",body:JSON.stringify(value)});
  });
  await page.goto(origin+"/capture?method=desktop",{waitUntil:"networkidle0"});
  await page.waitForSelector('[aria-label="关闭操作引导"]',{visible:true});await page.click('[aria-label="关闭操作引导"]');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(async owner=>{
   const records=Array.from({length:500},(_,i)=>({id:"synthetic-"+i,kind:i<485?"text":i<490?"other":i<494?"image":i<497?"sticker":"other",text:i<475?"合成聊天 "+i:i<485?"身份待核对的有效原文 "+i:i<490?"[语音] 12秒":i<494?"[图片]":i<497?"[表情包]":"[视频]",sender:"合成好友",senderRole:i>=475&&i<485?"unknown":i%2?"self":"other",at:"",source:{label:"合成消息 "+i,method:"uia",order:"oldest-first"}}));
   await CoverageVault.saveCaptureBatch(owner,{version:1,kind:"chat",friend:"合成覆盖测试",account:"synthetic-wechat",capturedAt:"2026-10-15T12:00:00Z",records,warnings:[]});
  },owner);
  await page.reload({waitUntil:"networkidle0"});
  await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(button=>button.textContent.includes("合成覆盖测试")));
  await page.evaluate(()=>[...document.querySelectorAll("button")].find(button=>button.textContent.includes("合成覆盖测试")).click());
  await page.waitForSelector("[data-capture-coverage]");
  const text=await page.$eval("[data-capture-coverage]",node=>node.textContent.replace(/\s+/g," "));
  for(const phrase of ["已读文字 485 条","10 条身份待核对","未读语音 5 条","未读图片 4 条","未读表情包 3 条","其他未读 3 条"])assert.ok(text.includes(phrase),phrase+": "+text);
  await page.$eval("[data-capture-coverage]",node=>node.scrollIntoView({block:"center",behavior:"instant"}));await new Promise(r=>setTimeout(r,150));
  await page.screenshot({path:path.join(out,"coverage-"+width+".png")});
  await page.type('input[placeholder="搜索原文、时间或说话人"]',"[语音]");
  await page.waitForFunction(()=>document.querySelector('[aria-label="采集原文列表"]')?.textContent.includes("语音尚未转成文字"));
  assert.equal(await page.$eval('[aria-label="采集原文列表"]',node=>node.querySelectorAll("article").length),5);
  assert.ok(await page.$eval('[aria-label="采集原文列表"]',node=>node.textContent.includes("本次不分析其中内容")));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"no horizontal overflow");
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log("PASS "+width+": 500 stored versus 485 readable; unknown speakers retained; exact media counts; voice-specific notice; no uploads/capture/charges.");
  await context.close();
 }
}finally{await browser.close();}
