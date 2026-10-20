// Report -> question -> same saved report; all account/report APIs are synthetic.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798";
const id="77777777-1111-4111-8111-111111111111", owner="report-return-fixture", subject="88888888-1111-4111-8111-111111111111";
const bundle=await build({stdin:{contents:'export {reportReturnHref} from "./lib/report-return";',resolveDir:process.cwd(),loader:"ts"},bundle:true,format:"esm",write:false,platform:"node"});
const {reportReturnHref}=await import("data:text/javascript;base64,"+Buffer.from(bundle.outputFiles[0].text).toString("base64"));
assert.equal(reportReturnHref(null),"/reports");
assert.equal(reportReturnHref({reportId:id,returnTo:"//attacker.invalid/report?focus=reply"}),"/report?id="+id);
assert.equal(reportReturnHref({reportId:id,returnTo:"/report?id=other&focus=reply"}),"/report?id="+id+"&focus=reply");
assert.equal(reportReturnHref({reportId:id,returnTo:"/report?focus=script"}),"/report?id="+id);
await mkdir("outputs/report-return",{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"]});
try{
 for(const width of [1440,390,320]){
  const context=await browser.createBrowserContext(),page=await context.newPage(),writes=[],errors=[];
  let identity=owner;
  await page.setViewport({width,height:920});
  page.on("pageerror",error=>errors.push(error.message));
  page.on("dialog",dialog=>dialog.accept());
  await page.setRequestInterception(true);
  page.on("request",async request=>{
   const url=new URL(request.url());
   if(url.origin!==origin)return request.abort();
   if(!url.pathname.startsWith("/api/"))return request.continue();
   if(request.method()!=="GET")writes.push(url.pathname);
   let value={},status=200;
   if(url.pathname==="/api/web/account-context")value={account:{userId:identity,active:true,balance:100,features:["chat","analysis"]},people:[{id:subject,label:"合成人物"}],prices:{text:5,analysis:20,transcription:5}};
   else if(url.pathname==="/api/auth/session")value={loggedIn:true,user:{id:identity}};
   else if(url.pathname==="/api/account/credits")value={account:{userId:identity,active:true,balance:100},prices:{text:5}};
   else if(url.pathname==="/api/web/profile")value={enabled:true,subjects:[{id:subject,label:"合成人物"}]};
   else if(url.pathname==="/api/web/report")value={reportId:id,kind:"chat",subjectId:subject,createdAt:"2026-10-20T10:00:00Z",report:{id,reportId:id,subjectId:subject,lines:[],annotations:[],decision:{judgment:"合成报告内容",evidence:"周六两点见",nextStep:"确认地点"},participants:{other:{label:"合成人物"}}}};
   else if(url.pathname==="/api/web/relationship-feedback")value={subjectId:subject,currentFeedback:{reportId:id,latest:null},versionChanges:{items:[]}};
   else {status=501;value={error:"Unexpected synthetic API "+url.pathname};}
   await request.respond({status,contentType:"application/json",body:JSON.stringify(value)});
  });
  await page.goto(origin+"/chat",{waitUntil:"networkidle0"});
  await page.evaluate(({id,owner,subject})=>{
   sessionStorage.setItem("web-followup:return-fixture",JSON.stringify({accountId:owner,reportId:id,subjectId:subject,title:"合成报告",summary:"待核对的判断",returnTo:"/report?id="+id+"&focus=affinity",expiresAt:Date.now()+60_000}));
  },{id,owner,subject});
  await page.goto(origin+"/chat?context=return-fixture",{waitUntil:"networkidle0"});
  await page.waitForSelector("[data-report-return]");
  assert.equal(await page.$eval("[data-report-return]",el=>el.getAttribute("href")),"/report?id="+id+"&focus=affinity");
  assert.ok(await page.$eval("[data-report-return]",el=>el.getBoundingClientRect().top<innerHeight&&el.getBoundingClientRect().height>=44));
  assert.ok(await page.$eval("[data-report-return]",el=>parseFloat(getComputedStyle(el).fontSize)>=16));
  await page.evaluate(()=>{const spacer=document.createElement("div");spacer.style.height="1800px";spacer.dataset.syntheticLongConversation="true";document.querySelector("main").append(spacer);window.scrollTo({top:1200,behavior:"instant"});});
  await page.waitForFunction(()=>scrollY>1000&&document.querySelector("[data-page-navigation]").getBoundingClientRect().top>=0);
  assert.ok(await page.$eval("[data-report-return]",el=>{const box=el.getBoundingClientRect();return box.top>=0&&box.bottom<=100&&document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)?.closest("[data-report-return]")===el;}),"return remains visible and clickable halfway down a conversation");
  await page.screenshot({path:`outputs/report-return/question-${width}.png`,fullPage:true});
  await page.click("[data-report-return]");
  await page.waitForFunction(id=>location.pathname==="/report"&&new URLSearchParams(location.search).get("id")===id,{},id);
  assert.equal(new URL(page.url()).searchParams.get("focus"),"affinity");
  // Expired handoffs still provide a way back; changing person removes it.
  await page.evaluate(()=>{const row=JSON.parse(sessionStorage.getItem("web-followup:return-fixture"));row.expiresAt=Date.now()-1;sessionStorage.setItem("web-followup:return-fixture",JSON.stringify(row));});
  await page.goto(origin+"/chat?context=return-fixture",{waitUntil:"networkidle0"});
  await page.waitForSelector("[data-report-return]");
  await page.select("#chat-active-person","");
  await page.waitForFunction(()=>!document.querySelector("[data-report-return]"));
  identity="other-owner";
  await page.goto(origin+"/chat?context=return-fixture",{waitUntil:"networkidle0"});
  await page.waitForSelector('[data-account-state="ready"]');
  assert.equal(await page.$("[data-report-return]"),null,"another account cannot inherit the report link");
  assert.equal(await page.$eval("[data-page-back]",el=>el.getAttribute("href")),"/workspace");
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await context.close();
 }
 console.log("PASS report return: exact saved report/focus, expired context, person/account isolation, 1440/390/320, no paid request");
}finally{await browser.close();}
