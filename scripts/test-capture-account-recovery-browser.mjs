import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798";
assert.ok(["127.0.0.1","localhost"].includes(new URL(origin).hostname));
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"],defaultViewport:{width:1440,height:1000}});
const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Allow-Private-Network":"true"};
const owner="capture-recovery-owner",pairCode="AABBCCDD",handoff="H".repeat(43);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(initial="error"){
  const context=await browser.createBrowserContext(),page=await context.newPage(),calls=[],errors=[];
  let accountStatus=initial,accountOwner=owner,holdAccount=null;
  page.on("pageerror",error=>errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request",async request=>{
    try{
      const url=new URL(request.url());let value={},status=200;
      if(url.hostname==="127.0.0.1"&&url.port==="17863"){
        if(request.method()==="OPTIONS"){await request.respond({status,headers});return;}
        calls.push({path:url.pathname,body:request.postData()||""});
        if(url.pathname==="/health")value={version:"1.2.13",ready:true,capabilities:{chat:true,moments:true,backgroundHistory:true}};
        else if(url.pathname==="/pair"||url.pathname==="/pair/handoff")value={token:"synthetic-capture-recovery-token-1234",expiresIn:28800};
        else throw Error("Unexpected helper operation "+url.pathname);
      }else if(url.origin===origin&&url.pathname.startsWith("/api/")){
        if(url.pathname==="/api/web/account-context"){
          if(holdAccount)await holdAccount;
          if(accountStatus==="ok")value={account:{userId:accountOwner,balance:100},people:[],prices:{analysisSmall:20,profile:30}};
          else if(accountStatus==="unauthorized"){status=401;value={error:"请登录后继续。"};}
          else {status=503;value={error:"账户服务暂时不可用，请重试。"};}
        }else if(url.pathname==="/api/web/capture/library")value={ownerId:accountOwner,libraries:[]};
        else if(url.pathname==="/api/web/capture/analyze")value={status:"none"};
        else if(url.pathname==="/api/web/report/list")value={reports:[]};
        else throw Error("Unexpected website operation "+url.pathname);
      }else if(url.origin===origin)return request.continue();
      else return request.abort();
      await request.respond({status,headers,contentType:"application/json",body:JSON.stringify(value)});
    }catch(error){errors.push(error.message);await request.abort().catch(()=>{});}
  });
  return {page,calls,errors,context,setAccount(status,nextOwner=accountOwner){accountStatus=status;accountOwner=nextOwner;},hold(){let release;holdAccount=new Promise(resolve=>release=resolve);return()=>{holdAccount=null;release();};}};
}
const clickOpened=page=>page.evaluate(()=>[...document.querySelectorAll("button")].find(node=>node.textContent.trim()==="连接已打开的助手").click());
const enterCode=async page=>{
  await page.$eval("#capture-code",node=>{node.closest("details").open=true;});
  await page.type("#capture-code",pairCode);
};
const clickCode=page=>page.$eval("#capture-code",node=>node.parentElement.querySelector("button").click());
const waitError=page=>page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes("账户服务"));
const waitConnected=page=>page.waitForFunction(()=>document.body.innerText.includes("助手已连接"),{timeout:10000});
try{
  // Manual code can request an account retry, but no helper secret is redeemed
  // while the account request is still failing or waiting.
  {
    const test=await fixture();
    try{
      await test.page.goto(origin+"/capture?method=desktop",{waitUntil:"networkidle0"});await waitError(test.page);
      await enterCode(test.page);await clickCode(test.page);
      await test.page.waitForFunction(()=>document.querySelector("[data-connection-account-wait]")?.textContent.includes("连接操作已保留"));
      assert.deepEqual(test.calls,[]);
      assert.equal(await test.page.$eval("#capture-code",node=>node.value),pairCode);
      assert.equal(await test.page.$eval("#capture-code",node=>node.parentElement.querySelector("button").disabled),false,"failed retry must not leave button stuck");
      test.setAccount("ok");
      await test.page.evaluate(()=>[...document.querySelectorAll("button")].find(node=>node.textContent.trim()==="重新连接").click());
      await waitConnected(test.page);
      assert.equal(test.calls.filter(call=>call.path==="/pair").length,1);
      assert.deepEqual(test.errors,[]);
      console.log("PASS repeated failure keeps code and account retry resumes queued pairing");
    }finally{await test.context.close();}
  }
  {
    const test=await fixture();
    try{
      await test.page.goto(origin+"/capture?method=desktop",{waitUntil:"networkidle0"});await waitError(test.page);
      await enterCode(test.page);
      assert.equal(await test.page.$eval("#capture-code",node=>node.parentElement.querySelector("button").disabled),false);
      const release=test.hold();await clickCode(test.page);
      await test.page.waitForSelector("[data-connection-account-wait]");
      await delay(200);assert.deepEqual(test.calls,[],"unverified account cannot read helper/session/pair");
      test.setAccount("ok");release();await waitConnected(test.page);
      assert.deepEqual(test.calls.filter(call=>call.path==="/pair").map(call=>JSON.parse(call.body)),[{code:pairCode}],"account recovery resumes exactly one captured code");
      assert.equal(await test.page.$("[data-connection-account-wait]"),null);
      await test.page.setViewport({width:390,height:844});
      assert.equal(await test.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.deepEqual(test.errors,[]);
      console.log("PASS failed account + manual code: active recovery, one pairing after identity, 390px");
    }finally{await test.context.close();}
  }
  {
    const test=await fixture();
    try{
      await test.page.goto(origin+"/capture?method=desktop",{waitUntil:"networkidle0"});await waitError(test.page);
      test.setAccount("ok");await clickOpened(test.page);
      await test.page.waitForFunction(()=>document.body.innerText.includes("助手已打开。输入助手窗口"));
      assert.equal(await test.page.$eval("#capture-code",node=>node.checkVisibility()),true);
      assert.equal(test.calls.filter(call=>call.path==="/health").length,1);
      assert.equal(test.calls.some(call=>call.path.startsWith("/pair")),false);
      await enterCode(test.page);await clickCode(test.page);await waitConnected(test.page);
      assert.deepEqual(test.errors,[]);
      console.log("PASS existing helper click recovers account and reveals supported manual pairing");
    }finally{await test.context.close();}
  }
  {
    const test=await fixture();
    try{
      await test.page.goto(origin+"/capture?method=desktop#connect="+handoff,{waitUntil:"networkidle0"});await waitError(test.page);
      assert.equal(new URL(test.page.url()).hash,"");
      test.setAccount("ok");await clickOpened(test.page);await waitConnected(test.page);
      assert.deepEqual(test.calls.filter(call=>call.path==="/pair/handoff").map(call=>JSON.parse(call.body)),[{handoff}]);
      assert.equal(test.calls.some(call=>call.path==="/pair"),false);
      assert.deepEqual(test.errors,[]);
      console.log("PASS helper launch handoff survives account failure and resumes once");
    }finally{await test.context.close();}
  }
  {
    const test=await fixture("unauthorized");
    try{
      await test.page.goto(origin+"/capture?method=desktop",{waitUntil:"networkidle0"});
      await test.page.waitForFunction(()=>document.body.innerText.includes("登录后开始"));
      await enterCode(test.page);await clickCode(test.page);await delay(300);
      assert.deepEqual(test.calls,[],"signed-out page cannot pair/read any helper data");
      assert.equal(await test.page.$eval("[data-connection-account-wait]",node=>node.textContent.includes("请先登录网页账号")),true);
      assert.deepEqual(test.errors,[]);
      console.log("PASS real 401 preserves login gate and never calls helper");
    }finally{await test.context.close();}
  }
  {
    const test=await fixture("ok");
    try{
      await test.page.goto(origin+"/capture?method=desktop",{waitUntil:"networkidle0"});
      test.setAccount("error");
      await test.page.evaluate(()=>window.dispatchEvent(new CustomEvent("chengzi:account-changed",{detail:{loggedOut:false,revision:crypto.randomUUID()}})));
      await waitError(test.page);await enterCode(test.page);
      const release=test.hold();await clickCode(test.page);await delay(150);
      test.setAccount("ok","different-account");release();
      await test.page.waitForFunction(()=>document.body.innerText.includes("网页账号已更换"));
      assert.equal(test.calls.some(call=>call.path.startsWith("/pair")),false,"pending code from previous owner is not paired to new owner");
      assert.equal(await test.page.$eval("#capture-code",node=>node.value),"");
      assert.deepEqual(test.errors,[]);
      console.log("PASS account switch discards queued pairing and requires new explicit action");
    }finally{await test.context.close();}
  }
}finally{await browser.close();}
