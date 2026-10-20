// Synthetic responses only. Confirms that changed prices never silently resume paid work.
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import {ANALYSIS_PRICES, ANALYSIS_PRICE_VERSION, screenshotPrice} from "../lib/analysis-pricing.mjs";

const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798";
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"]});
async function addImages(page,count) {
  await page.evaluate(async count=>{
    const transfer=new DataTransfer();
    for(let i=0;i<count;i++){
      const canvas=document.createElement("canvas");canvas.width=40;canvas.height=40;
      const ctx=canvas.getContext("2d");ctx.fillStyle=`rgb(${25+i*23},${90+i*7},130)`;ctx.fillRect(0,0,40,40);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
      transfer.items.add(new File([blob],`fixture-${i}.png`,{type:"image/png"}));
    }
    const input=document.querySelector('input[aria-label="选择分析截图"]');
    input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));
  },count);
  await page.waitForFunction(count=>document.querySelectorAll(".wa-image").length===count,{},count);
}
async function clickText(page,text) {
  await page.evaluate(text=>{
    const button=[...document.querySelectorAll("button")].find(el=>el.textContent.trim()===text&&el.checkVisibility());
    if(!button||button.disabled)throw Error("Missing enabled button: "+text);button.click();
  },text);
}
try {
  for(const [mode,count] of [["chat",1],["chat",2],["moments",4],["social",7]]) {
    const context=await browser.createBrowserContext(),page=await context.newPage(),mutations=[],errors=[];
    const owner=`pricing-fixture-${mode}-${count}`,quote=screenshotPrice(count);
    const updatedQuote={...quote,version:"synthetic-next-price-version",amount:quote.amount+2};
    await page.setViewport({width:390,height:900});
    await page.setRequestInterception(true);page.on("pageerror",e=>errors.push(e.message));
    page.on("request",async request=>{
      const url=new URL(request.url());
      if(url.origin!==origin||!url.pathname.startsWith("/api/"))return request.continue();
      let status=200,value={};
      if(["/api/web/account-context","/api/account/credits"].includes(url.pathname))value={account:{userId:owner,balance:100,active:true},prices:{...ANALYSIS_PRICES,profile:30},people:[]};
      else if(url.pathname==="/api/auth/session")value={loggedIn:true,user:{id:owner}};
      else if(url.pathname==="/api/web/report/list")value={reports:[]};
      else if(["/api/web/screenshot/batch","/api/web/social-profile"].includes(url.pathname)){
        const body=request.method()==="POST"?JSON.parse(request.postData()):null;
        if(body)mutations.push(body);
        if(body?.uploadAction==="init"){
          if(body.priceConfirmation?.version!==updatedQuote.version||body.priceConfirmation?.amount!==updatedQuote.amount){
            status=409;value={code:"PRICE_CONFIRMATION_REQUIRED",error:"本次费用已更新，请确认后开始。",quote:updatedQuote};
          } else value={taskId:body.taskId,status:"uploading",imageCount:count,received:[]};
        } else if(body?.uploadAction==="part")value={taskId:body.taskId,status:"uploading",imageCount:count,received:[body.index]};
        else value={taskId:body?.taskId||url.searchParams.get("taskId"),status:"running",phase:"ocr",imageCount:count,completedCount:0};
      }
      await request.respond({status,contentType:"application/json",body:JSON.stringify(value)});
    });
    try{
      await page.goto(`${origin}/analyze?mode=${mode}&new=1`,{waitUntil:"networkidle0"});
      await page.waitForFunction(()=>document.querySelector('input[aria-label="选择分析截图"]')?.disabled===false);
      await addImages(page,count);
      await page.click(".ax-next-link");await page.waitForSelector("#analysis-confirm");
      assert.match(await page.$eval(".ax-order-summary",el=>el.innerText),new RegExp(`${count} 张待分析.*${quote.amount} 积分`,"s"));
      if(mode==="chat")await clickText(page,"右侧是我");
      await page.click(".ax-consent input");await page.waitForFunction(()=>!document.querySelector(".ax-submit").disabled);
      assert.equal(mutations.length,0,"material, identity, and consent choices never send a paid request");
      await page.click(".ax-submit");await page.waitForSelector("[data-price-confirmation]");
      assert.equal(await page.$("[data-live-analysis]"),null,"only one current state remains visible");
      assert.match(await page.$eval("[data-price-confirmation]",el=>el.innerText),new RegExp(`${updatedQuote.amount} 积分`));
      assert.deepEqual(mutations[0].priceConfirmation,{version:ANALYSIS_PRICE_VERSION,amount:quote.amount});
      await new Promise(resolve=>setTimeout(resolve,600));
      assert.equal(mutations.length,1,"409 pauses before upload/commit and never automatically confirms a higher price");
      const taskId=mutations[0].taskId;
      if(mode==="chat"&&count===1){
        // An old stored task without a version must also stop at the new quote.
        await page.evaluate(owner=>new Promise((resolve,reject)=>{
          const open=indexedDB.open("chengzi-web-uploads",1);
          open.onerror=reject;open.onsuccess=()=>{
            const db=open.result,tx=db.transaction("tasks","readwrite"),store=tx.objectStore("tasks"),get=store.get(owner);
            get.onsuccess=()=>{const saved=get.result;delete saved.parameters.priceConfirmation;store.put(saved,owner);};
            tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;
          };
        }),owner);
        await page.reload({waitUntil:"networkidle0"});await page.waitForSelector("[data-price-confirmation]");
        assert.equal(mutations.length,2);assert.equal(mutations[1].priceConfirmation,undefined);
        await new Promise(resolve=>setTimeout(resolve,400));
        assert.equal(mutations.length,2,"restored legacy task does not bypass explicit price confirmation");
      }
      const expectedInits=mutations.length+1;
      await clickText(page,`确认 ${updatedQuote.amount} 积分并继续`);
      await page.waitForFunction(()=>!!document.querySelector("[data-live-analysis]"));
      for(let i=0;i<40&&!mutations.some(x=>x.uploadAction==="commit");i++)await new Promise(resolve=>setTimeout(resolve,50));
      const inits=mutations.filter(x=>x.uploadAction==="init");
      assert.equal(inits.length,expectedInits);
      assert.deepEqual(inits.at(-1).priceConfirmation,{version:updatedQuote.version,amount:updatedQuote.amount});
      assert.equal(new Set(mutations.map(x=>x.taskId)).size,1);assert.equal(inits.at(-1).taskId,taskId);
      assert.equal(mutations.filter(x=>x.uploadAction==="part").length,count);
      assert.equal(mutations.filter(x=>x.uploadAction==="commit").length,1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      assert.deepEqual(errors,[]);
      console.log(`PASS ${mode}/${count}: displayed ${quote.amount}, 409 pauses, explicit ${updatedQuote.amount} confirmation, same task, one upload, no real API`);
    }catch(error){console.error(await page.$eval("body",el=>el.innerText));throw error;}
    finally{await context.close();}
  }
}finally{await browser.close();}
