// Only intercepted synthetic contacts. Never connects to a real helper.
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import puppeteer from "puppeteer-core";
const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798";
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"]});
await mkdir("outputs/contact-search",{recursive:true});
try{
 for(const width of (process.env.CONTACT_TEST_WIDTHS||"1440,390,320").split(",").map(Number)){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],searches=[];let connected=false,inflight=0,maxInflight=0,oldHelper=false;
  await page.setViewport({width,height:950});
  page.on("pageerror",e=>errors.push(e.message));await page.setRequestInterception(true);
  const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Allow-Private-Network":"true"};
  page.on("request",async req=>{
   try{
    const url=new URL(req.url());let value={};
    if(url.port==="17863"){
     if(req.method()==="OPTIONS"){}
     else if(url.pathname==="/health")value={version:"1.2.16",ready:true,capabilities:{chat:true,moments:true,backgroundChat:true,backgroundContacts:true,contactPagination:true}};
     else if(url.pathname==="/session")value={connected};
     else if(url.pathname==="/pair"){connected=true;value={token:"synthetic-contact-token",expiresIn:28800};}
     else if(url.pathname==="/contacts/search"){
      const body=JSON.parse(req.postData());searches.push(body);inflight++;maxInflight=Math.max(maxInflight,inflight);
      await new Promise(r=>setTimeout(r,body.query==="A"?1600:80));inflight--;
      const offset=body.offset||0;
      value={accountKey:"synthetic-current-account",contacts:body.query==="Aud"?[{contactId:"target",label:"Audrey",nickname:"Audrey",wechatId:"fixture-audrey"}]:Array.from({length:offset?2:20},(_,i)=>({contactId:"id-"+(offset+i),label:offset?"Aubrey "+i:"Au "+i,nickname:offset?"Aubrey "+i:"Au "+i})),hasMore:!offset,...(!oldHelper?{nextOffset:offset?null:20}:{})};
     }else throw Error("Unexpected real helper path "+url.pathname);
    }else if(url.origin===origin&&url.pathname.startsWith("/api/")){
     if(req.method()!=="GET")throw Error("Contact lookup must not write/charge: "+url.pathname);
     if(url.pathname==="/api/auth/session")value={loggedIn:true,user:{id:"search-fixture"}};
     else if(url.pathname==="/api/web/account-context"||url.pathname==="/api/account/credits")value={account:{userId:"search-fixture",balance:100,active:true},prices:{analysisSmall:10},people:[]};
     else if(url.pathname==="/api/web/profile")value={enabled:true,paused:false,subjects:[]};
     else if(url.pathname==="/api/web/capture/library")value={ownerId:"search-fixture",libraries:[]};
     else if(url.pathname==="/api/web/capture/analyze")value={status:"none"};
     else if(url.pathname==="/api/web/report/list")value={reports:[]};
    }else return req.continue();
    await req.respond({status:200,headers,contentType:"application/json",body:JSON.stringify(value)});
   }catch(e){errors.push(e.message);await req.respond({status:500,headers,body:JSON.stringify({error:e.message})}).catch(()=>{});}
  });
  await page.goto(origin+"/capture?method=desktop&kind=chat",{waitUntil:"networkidle0"});
  await page.$eval("#capture-code",el=>el.closest("details").open=true);await page.type("#capture-code","ABCDEF12");
  await page.evaluate(()=>[...document.querySelectorAll("button")].find(el=>el.textContent.trim()==="连接").click());
  const input='input[placeholder="输入好友的备注或昵称"]';
  await page.waitForSelector(input);await page.type(input,"A");
  while(!searches.length)await new Promise(r=>setTimeout(r,50));
  await page.type(input,"u");await new Promise(r=>setTimeout(r,300));await page.type(input,"d");
  await page.waitForFunction(()=>document.body.innerText.includes("fixture-audrey"),{timeout:15000}).catch(async e=>{console.error({width,searches,errors,input:await page.$eval(input,e=>e.value),text:(await page.$eval("body",e=>e.innerText)).slice(-3000)});await page.screenshot({path:`outputs/contact-search/failure-${width}.png`,fullPage:true});throw e;});
  assert.deepEqual(searches.map(row=>row.query),["A","Aud"],"intermediate Au is superseded, never queued behind A");
  assert.equal(maxInflight,1);
  await page.focus(input);await page.keyboard.press("Backspace");
  await page.waitForFunction(()=>document.body.innerText.includes("已显示 20 位"));
  await page.evaluate(()=>[...document.querySelectorAll("button")].find(el=>el.textContent==="加载更多联系人").click());
  await page.waitForFunction(()=>document.body.innerText.includes("找到 22 位"));
  assert.equal(await page.$$eval('[aria-label="选择要导入的微信联系人"] button',els=>els.length),22);
  assert.equal(searches.at(-1).offset,20);assert.equal(searches.at(-1).accountKey,"synthetic-current-account");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`outputs/contact-search/results-${width}.png`});
  oldHelper=true;await page.evaluate(()=>[...document.querySelectorAll("button")].find(el=>el.textContent.includes("刷新搜索")).click());
  await page.waitForFunction(()=>document.body.innerText.includes("更新助手，查看全部结果"));
  assert.equal(searches.at(-1).refresh,true);
  assert.deepEqual(errors,[]);await context.close();
  console.log(`PASS ${width}: latest-keyword search, 20+2 pagination, no parallel directory scans, update fallback, no capture/paid requests.`);
 }
}finally{await browser.close();}
