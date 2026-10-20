// Exercises the real screenshot page with synthetic API responses; never calls a paid service.
import assert from "node:assert/strict";
import {mkdir, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import puppeteer from "puppeteer-core";

const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798";
const output=resolve("outputs/screenshot-entry");
await mkdir(output,{recursive:true});
const imagePath=resolve(output,"synthetic.png");
await writeFile(imagePath,Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGkAAAAASUVORK5CYII=","base64"));
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"]});
try {
  for(const width of [1440,390,320]) {
    const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],mutations=[];
    let owner="screenshot-fixture";
    const account=()=>({account:{userId:owner,balance:100,active:true},prices:{analysisSmall:3,analysisMedium:5,analysisLarge:8,profile:5},people:[{id:"person-a",label:"合成小林"}]});
    await page.setViewport({width,height:960});
    page.on("pageerror",e=>errors.push(e.message));
    await page.setRequestInterception(true);
    page.on("request",async request=>{
      const u=new URL(request.url());
      if(u.origin!==origin||!u.pathname.startsWith("/api/"))return request.continue();
      let value={};
      if(u.pathname==="/api/web/account-context")value=account();
      else if(u.pathname==="/api/account/credits")value=account();
      else if(u.pathname==="/api/auth/session")value={loggedIn:true,user:{id:owner}};
      else if(u.pathname==="/api/web/profile")value={enabled:true,subjects:account().people};
      else if(u.pathname==="/api/web/report/list")value={reports:[]};
      else if(u.pathname==="/api/web/screenshot/batch") {
        const body=request.method()==="POST"?JSON.parse(request.postData()):null;
        if(body)mutations.push(body);
        value=body?.uploadAction==="init"?{taskId:body.taskId,status:"uploading",imageCount:1,received:[]}
          :body?.uploadAction==="part"?{taskId:body.taskId,status:"uploading",imageCount:1,received:[0]}
          :{taskId:body?.taskId||u.searchParams.get("taskId"),status:"running",phase:"ocr",imageCount:1,completedCount:0};
      }
      await request.respond({status:200,contentType:"application/json",body:JSON.stringify(value)});
    });
    const text=value=>page.waitForFunction(value=>document.body.innerText.includes(value),{timeout:20000},value);
    const clickText=value=>page.evaluate(value=>{
      const button=[...document.querySelectorAll("button")].find(el=>el.textContent.trim()===value&&el.checkVisibility());
      if(!button||button.disabled)throw Error("Missing enabled button: "+value);
      button.click();
    },value);
    const fits=async()=>{
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`no horizontal overflow at ${width}`);
      assert.equal(await page.$eval(".ax-workspace",el=>getComputedStyle(el).gridTemplateColumns.split(" ").length),1,"one full working column");
    };
    try {
      await page.goto(origin+"/analyze?mode=chat&focus=affinity&new=1",{waitUntil:"networkidle0"});
      await page.waitForFunction(()=>document.querySelector("h1")?.textContent==="好感探测器");
      await page.waitForFunction(()=>document.querySelector('input[aria-label="选择分析截图"]')?.disabled===false);
      assert.match(await page.$eval(".ax-steps",el=>el.innerText),/选择截图.*确认费用.*查看结果/s);
      await fits();
      const chooser=page.waitForFileChooser();
      await page.click("#analysis-upload");
      await (await chooser).accept([imagePath]);
      await page.waitForSelector(".wa-image");
      assert.equal(await page.$("[data-source-picker]"),null,"main upload directly opens the file chooser");
      assert.equal(await page.$("#analysis-confirm"),null,"selecting files does not start or bill analysis");
      assert.equal(mutations.length,0);
      await fits();
      await page.screenshot({path:resolve(output,`selected-${width}.png`),fullPage:true});
      await page.click(".ax-next-link");
      await page.waitForSelector("#analysis-confirm");
      assert.equal(await page.$eval("#materials",el=>el.checkVisibility()),false);
      assert.equal(await page.$eval('[data-tour="analysis-person"]',el=>el.open),false,"optional archive is folded");
      assert.match(await page.$eval(".ax-order-summary",el=>el.innerText),/好感探测器.*1 张待分析.*3 积分/s);
      assert.equal(await page.$eval(".ax-submit",el=>el.disabled),true);
      await text("截图里哪侧是你");
      await clickText("右侧是我");
      await text("勾选材料授权后");
      assert.equal(mutations.length,0,"identity choice never starts paid work");
      await page.click(".ax-consent input");
      await page.waitForFunction(()=>!document.querySelector(".ax-submit").disabled);
      assert.match(await page.$eval(".ax-submit",el=>el.innerText),/开始好感探测 · 3 积分/);
      await page.screenshot({path:resolve(output,`confirmation-${width}.png`),fullPage:true});
      await clickText("返回修改材料");
      assert.equal(await page.$$eval(".wa-image",els=>els.length),1,"back preserves the selected image");
      await clickText("其他导入方式");
      await page.waitForSelector("[data-source-picker]");
      assert.match(await page.$eval("[data-source-picker]",el=>el.innerText),/聊天录屏/);
      await page.click('[aria-label="关闭来源选择"]');
      await page.click(".ax-next-link");
      await page.waitForSelector('#analysis-confirm [aria-label="选择我的气泡位置"] button[aria-pressed=true]');
      assert.equal(await page.$eval('[aria-label="选择我的气泡位置"] button[aria-pressed=true]',el=>el.textContent.includes("右侧是我")),true);
      await page.click(".ax-submit");
      await page.waitForFunction(()=>!!document.querySelector("[data-live-analysis]"));
      await new Promise(resolve=>setTimeout(resolve,200));
      assert.equal(mutations.filter(x=>x.uploadAction==="init").length,1);
      assert.equal(new Set(mutations.map(x=>x.taskId)).size,1,"one confirmed task");
      assert.equal(mutations[0].selfSide,"right");
      assert.equal(mutations[0].confirmed,true);

      // A new account has no queued task; social sources remain scoped.
      owner="screenshot-moments";
      await page.goto(origin+"/analyze?mode=moments&focus=affinity&new=1",{waitUntil:"networkidle0"});
      await text("朋友圈分析");
      await page.waitForFunction(()=>document.querySelector('input[aria-label="选择分析截图"]')?.disabled===false);
      await clickText("其他导入方式");
      await page.waitForSelector("[data-source-picker]");
      const sources=await page.$eval("[data-source-picker]",el=>el.innerText);
      assert.match(sources,/电脑采集朋友圈/);
      assert.doesNotMatch(sources,/聊天截图|聊天录屏|聊天文件/);
      await page.click('[aria-label="关闭来源选择"]');
      assert.equal(await page.$eval("h1",el=>el.textContent),"朋友圈分析","chat focus never mislabels a Moments page");

      // Invalid files are visibly explained at the current upload step.
      await page.evaluate(()=>{
        const data=new DataTransfer();data.items.add(new File(["invalid"],"bad.gif",{type:"image/gif"}));
        const input=document.querySelector('input[aria-label="选择分析截图"]');input.files=data.files;input.dispatchEvent(new Event("change",{bubbles:true}));
      });
      await text("有效 JPG 或 PNG");
      await fits();
      assert.deepEqual(errors,[]);
      console.log(`PASS ${width}: direct picker, one column, preserved materials, optional person, explicit fee/consent, one paid task, scoped alternate sources, visible file errors`);
    } catch(error) {
      console.error(await page.$eval("body",el=>el.innerText));
      await page.screenshot({path:resolve(output,`failure-${width}.png`),fullPage:true});
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
