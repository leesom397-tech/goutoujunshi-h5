// Local return routes, sticky controls and nested report context. No real API writes.
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {build} from "esbuild";
import puppeteer from "puppeteer-core";
const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798";
const id="77777777-1111-4111-8111-111111111111";
const compiled=await build({stdin:{contents:'export * from "./lib/page-navigation";',resolveDir:process.cwd(),loader:"ts"},bundle:true,format:"esm",platform:"node",write:false});
const {localPageReturn,pageBackLink}=await import("data:text/javascript;base64,"+Buffer.from(compiled.outputFiles[0].text).toString("base64"));
for(const value of ["https://outside.invalid","//outside.invalid","/\\outside.invalid","javascript:alert(1)","/unknown","/report\u0000","/%2f%2foutside.invalid"])assert.equal(localPageReturn(value),"");
assert.equal(pageBackLink("/capture").href,"/relationship");
assert.equal(pageBackLink("/voice").href,"/chat");
assert.equal(pageBackLink("/report").href,"/reports");
assert.equal(pageBackLink("/chat",new URLSearchParams({returnTo:"//outside.invalid"}).toString()).href,"/workspace");
assert.equal(pageBackLink("/capture",new URLSearchParams({returnTo:"/report?id="+id+"&focus=reply"}).toString()).href,"/report?id="+id+"&focus=reply");
await mkdir("outputs/page-navigation",{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"]});
try{
 for(const width of (process.env.NAV_TEST_WIDTHS||"1440,390,320").split(",").map(Number)){
  const context=await browser.createBrowserContext(),page=await context.newPage(),writes=[],errors=[];
  await page.setViewport({width,height:900});
  page.on("pageerror",error=>errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request",async request=>{
   const url=new URL(request.url());
   if(url.origin!==origin)return request.abort();
   if(!url.pathname.startsWith("/api/"))return request.continue();
   if(request.method()!=="GET")writes.push(url.pathname);
   let value={};
   if(url.pathname==="/api/web/account-context")value={account:{userId:"navigation-fixture",active:true,balance:100},people:[],prices:{analysis:20}};
   else if(url.pathname==="/api/auth/session")value={loggedIn:true,user:{id:"navigation-fixture"}};
   else if(url.pathname==="/api/web/profile")value={enabled:true,subjects:[]};
   else if(url.pathname==="/api/web/report/list")value={reports:[]};
   else if(url.pathname==="/api/web/capture/library")value={ownerId:"navigation-fixture",libraries:[]};
   else if(url.pathname==="/api/web/capture/analyze")value={status:"none"};
   await request.respond({status:200,contentType:"application/json",body:JSON.stringify(value)});
  });
  for(const [path,expected] of [["/relationship","/workspace"],["/support","/workspace"],["/import","/workspace"],["/analyze?mode=social","/workspace"],["/capture?method=library&returnTo="+encodeURIComponent("/report?id="+id),"/report?id="+id]]){
   await page.goto(origin+path,{waitUntil:"networkidle0"});
   await page.waitForSelector("[data-page-back]");
   assert.equal(await page.$eval("[data-page-back]",el=>el.getAttribute("href")),expected);
   assert.ok(await page.$eval("[data-page-back]",el=>el.getBoundingClientRect().height>=44&&parseFloat(getComputedStyle(el).fontSize)>=16));
   await page.evaluate(()=>{const spacer=document.createElement("div");spacer.style.height="1800px";document.querySelector("main")?.append(spacer);window.scrollTo({top:1000,behavior:"instant"});});
   await page.waitForFunction(()=>scrollY>900);
   const sticky=await page.$eval("[data-page-back]",el=>{const box=el.getBoundingClientRect();return box.top>=0&&box.bottom<=100&&document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)?.closest("[data-page-back]")===el;});
   if(!sticky){
    console.log(await page.$eval("[data-page-back]",el=>({box:el.getBoundingClientRect().toJSON(),scrollY,ancestors:[el,el.parentElement,el.parentElement.parentElement,document.body,document.documentElement].map(node=>({name:node.tagName,cls:node.className,position:getComputedStyle(node).position,overflow:getComputedStyle(node).overflow,box:node.getBoundingClientRect().toJSON()}))})));
    await page.screenshot({path:`outputs/page-navigation/failed-${width}.png`});
   }
   assert.ok(sticky,"sticky back above content: "+path+" "+width);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:`outputs/page-navigation/${new URL(path,origin).pathname.slice(1)}-${width}.png`,fullPage:false});
  }
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);await context.close();
 }
 console.log("PASS page navigation: safe local fallback, contextual report return, readable 44px+ targets, sticky clickable return at 1440/390/320, no real writes.");
}finally{await browser.close();}
