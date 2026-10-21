import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import puppeteer from "puppeteer-core";

// The real report route, synthetic responses only. No analysis or customer writes.
const origin=process.env.INTAKE_TEST_ORIGIN||"http://127.0.0.1:8798";
const id="33333333-4444-4555-8666-777777777777",subject="report-usability-person",out="outputs/report-usability";
const longEvidence="这是浏览器回归使用的合成原话，用于确认长依据不会丢失，也不会改写原始内容。".repeat(7)+"【原话结尾保持完整】";
const options=[{style:"自然确认",text:"那就周六两点展馆门口见。",reason:"接住已确认的具体安排。",cost:"到时再核对是否落实。"},{style:"轻松回应",text:"好呀，周六见，拿铁也安排上。",reason:"呼应共同话题。"}];
const fixture={id,reportId:id,kind:"chat",subjectId:subject,participants:{self:{label:"合成用户"},other:{label:"合成小林"}},lines:[
 {id:"one",speaker:"self",text:"这周六有一个我很想看的展，你下午有空一起去吗？"},
 {id:"two",speaker:"other",text:longEvidence},
 {id:"three",speaker:"self",text:"展馆门口见就好，结束后我还想去旁边的咖啡店坐坐。"},
 {id:"four",speaker:"self",text:"你还记得呀，那就这么说好，周六我出门的时候告诉你。"},
 {id:"five",speaker:"other",text:"好呀，两点可以。"}],annotations:[],decision:{judgment:"可以先确认时间，再观察安排是否落实。",evidence:longEvidence,nextStep:"确认时间地点。",replyOptions:options}};
await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"]});
const checks=[];
try{
 for(const width of [1440,390,320]){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],writes=[];
  let owner="report-usability-owner",report=structuredClone(fixture);
  await page.setViewport({width,height:920});
  page.on("pageerror",error=>errors.push(error.stack||error.message));
  await page.evaluateOnNewDocument(()=>Object.defineProperty(navigator,"clipboard",{value:{writeText:async text=>{if(window.__denyClipboard)throw Error("synthetic clipboard denial");window.__copiedReply=text;}}}));
  await page.setRequestInterception(true);
  page.on("request",request=>{
   const url=new URL(request.url());if(url.origin!==origin)return request.abort();
   if(!url.pathname.startsWith("/api/"))return request.continue();
   if(request.method()!=="GET")writes.push(url.pathname);
   let value={};
   if(url.pathname==="/api/auth/session")value={loggedIn:true,user:{id:owner}};
   if(["/api/web/account-context","/api/account/credits"].includes(url.pathname))value={account:{userId:owner,active:true,balance:100},prices:{text:3},people:[]};
   if(url.pathname==="/api/web/profile")value={enabled:true,subjects:[]};
   if(url.pathname==="/api/web/report")value={reportId:report.id,subjectId:subject,kind:"chat",report};
   return request.respond({status:200,contentType:"application/json",body:JSON.stringify(value)});
  });
  const tab=section=>page.$eval(`[role=tab][aria-controls$="-panel-${section}"]`,node=>node.click());
  const board='[data-reading-section="next"] [data-reply-board]';
  const card=index=>`${board} [data-reply-index="${index}"]`;
  const edit=async(index,text)=>{await page.$eval(card(index)+' [data-edit-reply]',node=>node.click());await page.waitForSelector(card(index)+' textarea');await page.$eval(card(index)+' textarea',node=>{node.focus();node.select();});await page.keyboard.type(text);};
  const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${width}: no horizontal overflow`);
  await page.goto(origin+"/report?id="+id,{waitUntil:"networkidle0"});
  await page.waitForSelector('[data-key-evidence] button[aria-expanded="false"]');
  const evidence='[data-key-evidence] li:first-child';
  assert.equal(await page.$eval(evidence+' blockquote',node=>node.textContent),Array.from(longEvidence).slice(0,150).join("")+"…");
  await page.$eval(evidence+' button[aria-expanded]',node=>node.click());
  assert.equal(await page.$eval(evidence+' blockquote',node=>node.textContent),longEvidence);
  assert.equal(await page.$eval(evidence+' button[aria-expanded]',node=>node.getAttribute("aria-expanded")),"true");
  await fits();await (await page.$('[data-key-evidence]')).screenshot({path:`${out}/evidence-${width}.png`});
  await page.$eval(evidence+' button[aria-expanded]',node=>node.click());
  assert.ok(await page.$eval(evidence+' blockquote',node=>node.textContent.endsWith("…")));
  await tab("next");await page.waitForSelector(board);
  const draft="周六两点见，我会提前十分钟到。";
  await edit(0,draft);
  await page.$eval(card(0)+' [data-copy-reply]',node=>node.click());
  await page.waitForFunction(text=>window.__copiedReply===text,{},draft);
  assert.equal(await page.$eval(card(1)+' [data-reply-text]',node=>node.textContent),options[1].text);
  assert.equal(JSON.stringify(report),JSON.stringify(fixture),"manual edits never mutate the source report");
  await page.$eval(card(0)+' textarea',node=>{node.focus();node.select();});await page.keyboard.type("   ");
  assert.equal(await page.$eval(card(0)+' [data-copy-reply]',node=>node.disabled),true,"blank drafts cannot be copied");
  await page.$eval(`${board} [aria-label="选择回复目的或语气"] button:nth-child(3)`,node=>node.click());
  assert.equal(await page.$(board+' textarea'),null,"changing candidate discards the previous draft");
  await page.$eval(card(1)+' [data-copy-reply]',node=>node.click());
  await page.waitForFunction(text=>window.__copiedReply===text,{},options[1].text);
  await page.$eval(`${board} [aria-label="选择回复目的或语气"] button:first-child`,node=>node.click());
  assert.equal(await page.$eval(card(0)+' [data-reply-text]',node=>node.textContent),options[0].text);
  await edit(0,draft);
  await page.$eval(card(0)+' [data-copy-reply]',node=>node.click());
  await page.waitForFunction(selector=>document.querySelector(selector)?.textContent.includes('已复制'),{},card(0)+' [data-copy-reply]');
  await page.evaluate(()=>{window.__denyClipboard=true;});
  await page.$eval(card(0)+' [data-copy-reply]',node=>node.click());
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="alert"]')].some(node=>node.textContent.includes("复制没有完成")));
  assert.equal(await page.$eval(card(0)+' textarea',node=>node.value),draft,"copy denial retains the edited text");
  assert.doesNotMatch(await page.$eval(card(0)+' [data-copy-reply]',node=>node.textContent),/已复制/,'failed repeat copy clears an earlier success indicator');
  await page.waitForFunction(selector=>{const node=document.querySelector(selector);return node.selectionStart===0&&node.selectionEnd===node.value.length;},{timeout:3000},card(0)+' textarea');
  await page.evaluate(()=>{window.__denyClipboard=false;});
  await page.$eval(card(0)+' [data-copy-reply]',node=>node.click());
  await page.waitForFunction(()=>![...document.querySelectorAll('[role="alert"]')].some(node=>node.textContent.includes("复制没有完成")));
  await fits();await (await page.$(board)).screenshot({path:`${out}/replies-${width}.png`});
  const sizes=await page.$$eval(`${board} [data-edit-reply],${board} [data-copy-reply],${board} [data-reply-editor] button,[data-reader-start]`,nodes=>nodes.filter(node=>node.checkVisibility()).map(node=>node.getBoundingClientRect().height));
  assert.ok(sizes.every(height=>height>=44),"all added actions have 44px targets");
  assert.equal(await page.evaluate(text=>Object.values(localStorage).some(value=>value.includes(text)),draft),false,"manual drafts never enter persistent storage");
  await page.$eval(card(0)+' [data-reply-editor] button:last-child',node=>node.click());
  assert.equal(await page.$eval(card(0)+' [data-reply-text]',node=>node.textContent),options[0].text);
  await page.$eval(card(0)+' details > summary',node=>node.click());
  await page.$eval(card(0)+' details button',node=>node.click());
  await page.waitForSelector('[data-rewrite-confirmation]');
  assert.match(await page.$eval('[data-rewrite-confirmation]',node=>node.textContent),/确认改写.*3 积分/);
  assert.deepEqual(writes,[],"manual edit and opening paid confirmation never call any write API");
  await page.$eval('[data-rewrite-confirmation] button:last-child',node=>node.click());
  await page.$eval('[data-reader-start]',node=>node.scrollIntoView({block:"end",behavior:"instant"}));
  const before=await page.evaluate(()=>scrollY);assert.ok(before>200);
  assert.ok(await page.$eval('[data-reader-start]',node=>{const rect=node.getBoundingClientRect();return document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.closest('[data-reader-start]')===node;}),"scroll-to-end leaves the return action above the mobile navigation");
  await page.click('[data-reader-start]');
  try { await page.waitForFunction(()=>Math.abs(document.querySelector('[data-report-reader]').getBoundingClientRect().top-parseFloat(getComputedStyle(document.querySelector('[data-report-reader] [role="tablist"]').parentElement).top))<3,{timeout:5000}); }
  catch(error){console.log("Section return diagnostics",{errors,writes,...await page.evaluate(()=>{const root=document.querySelector('[data-report-reader]'),nav=root?.querySelector('[role="tablist"]')?.parentElement;return {url:location.href,scrollY,root:root?.getBoundingClientRect().toJSON(),nav:nav?.getBoundingClientRect().toJSON(),top:nav?getComputedStyle(nav).top:null,active:document.activeElement?.outerHTML?.slice(0,300),body:document.body.innerText.slice(0,400),storage:Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.includes('report-reading')))};})});await page.screenshot({path:out+'/failure.png'});throw error;}
  assert.ok(await page.evaluate(()=>document.activeElement?.getAttribute("aria-selected")==="true"),"return focuses the current tab");
  assert.ok(await page.evaluate(()=>scrollY)<before);
  await page.evaluate(()=>window.scrollBy({top:280,behavior:"instant"}));
  await new Promise(resolve=>setTimeout(resolve,150));const savedY=await page.evaluate(()=>scrollY);
  await page.reload({waitUntil:"networkidle0"});
  await page.waitForFunction(()=>document.querySelector('[data-reading-section="next"]')?.hidden===false);
  await page.waitForFunction(y=>Math.abs(scrollY-y)<8,{},savedY);
  await fits();
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  checks.push({width,longEvidence:true,manualEdit:true,candidateReset:true,blankBlocked:true,clipboardFallback:true,originalIntact:true,sectionReturn:true,readingPosition:true,paidRequests:0});
  await context.close();
 }
 await writeFile(out+"/qa.json",JSON.stringify({passed:true,synthetic:true,checks},null,2));
 console.log("PASS report usability: 1440/390/320, complete evidence, isolated manual drafts, empty/copy failure handling, 44px targets, chapter return and reading restoration; zero API writes.");
}finally{await browser.close();}
