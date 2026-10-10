// Local-only UI flow with mocked authentication and model responses. Uses a fresh Edge profile, never a personal browser session.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const base = process.argv[2] || 'http://127.0.0.1:5184';
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Local URL only: mock data must never run on production');
const profile = await mkdtemp(join(tmpdir(), 'coach-mobile-qa-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let socket;
const pending = new Map();
let serial = 0;
function call(method, params = {}, sessionId) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
try {
  let info;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { info = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); break; } catch { await delay(150); }
  }
  if (!info) throw new Error('Fresh browser did not become ready');
  socket = new WebSocket('ws://127.0.0.1:' + info[0] + info[1]);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => call(method, params, sessionId);
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
  await send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(()=>{});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{\nconst native=globalThis.fetch.bind(globalThis),reports=new Map(),threads=new Map();\nglobalThis.__qaSubmissions=[];globalThis.__qaImportSubmissions=[];\nglobalThis.fetch=async(input,options={})=>{\n  const url=new URL(typeof input===\"string\"?input:input.url,location.origin);\n  if(url.pathname===\"/api/profile\")return Response.json({enabled:true,paused:false,subjects:[],facts:[],self:{}});\n  if(url.pathname===\"/api/import/analyze\"){globalThis.__qaImportSubmissions.push(options.body);return Response.json({error:\"QA must not analyze ZIP automatically\"},{status:599});}\n  if(url.pathname!==\"/api/crush\")return native(input,options);\n  if(!options.method||options.method===\"GET\"){\n    if(url.searchParams.has(\"id\"))return reports.has(url.searchParams.get(\"id\"))?Response.json(reports.get(url.searchParams.get(\"id\"))):Response.json({error:\"报告不存在\"},{status:404});\n    return Response.json({enabled:true,provider:\"qwen\",qwen:true,jev:false,wechatConfigured:false,reports:[...reports.values()].map(r=>({id:r.id,thread_id:r.threadId,created_at:r.createdAt,subject_label:null}))});\n  }\n  const b=JSON.parse(options.body||\"{}\");\n  if(b.action===\"analyze\"){\n    globalThis.__qaSubmissions.push(b);\n    const thread=threads.get(b.sessionId)||crypto.randomUUID();threads.set(b.sessionId,thread);\n    const id=crypto.randomUUID(),now=Date.now();\n    const result={id,threadId:thread,subjectId:null,revision:1,provider:\"qwen\",model:\"mock-only\",createdAt:now,expiresAt:now+7*86400000,latencyMs:1,duplicateCount:0,lines:[{id:\"one\",speaker:\"other\",text:\"周六要加班，周日倒是有空。\"}],annotations:[{lineId:\"one\",emotion:[{key:\"calm\",label:\"平静\"}],intent:[{key:\"alternative\",label:\"提供替代安排\"}],evidence:\"limited\",note:\"主动提出替代时间，但不是恋爱意愿的证明。\"}]};\n    reports.set(id,result);return Response.json(result);\n  }\n  if(b.action===\"advice\")return Response.json({reply:\"那周日下午怎么样？\\n适用条件：对方愿意一起安排。\"});\n  return Response.json({ok:true});\n};\n})();"});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    const previous=globalThis.fetch;globalThis.__qaScreenshotSubmissions=[];globalThis.__qaRewriteSubmissions=[];
    globalThis.fetch=async(input,options={})=>{
      const url=new URL(typeof input==="string"?input:input.url,location.origin);
      if(url.pathname==="/api/crush/rewrite"){
        const body=JSON.parse(options.body||"{}");globalThis.__qaRewriteSubmissions.push(body);
        return Response.json({text:"周日下午见面行吗？",status:"adjusted",note:"已按本轮原话调整，请核对后再发送。"});
      }
      if(url.pathname!=="/api/crush/screenshot")return previous(input,options);
      const b=JSON.parse(options.body||"{}");globalThis.__qaScreenshotSubmissions.push(b);
      const id=crypto.randomUUID(),now=Date.now();
      return Response.json({id,threadId:b.threadId||crypto.randomUUID(),subjectId:b.subjectId,revision:1,provider:"qwen",model:"mock-vision-only",createdAt:now,expiresAt:now+7*86400000,latencyMs:1,duplicateCount:0,decision:{possibleIntent:"可能在邀请一起活动",evidence:"对方原话：「周日一起看展吧」",observation:"对方给出具体活动。",judgment:"对方提出了见面建议，仍需确认时间。",nextStep:"问周日下午是否方便",replyDraft:"周日下午怎么样？",replyOptions:globalThis.__qaScreenshotSubmissions.length===1?[{style:"轻量确认",text:"好呀，你周日方便吗？",reason:"保留空间，先确认对方日程。",cost:"不能马上确定见面细节。",weight:60},{style:"自然承接",text:"周日下午可以一起看展吗？",reason:"顺着对方的活动建议确认时间。",cost:"如果对方只是客套，推进会显得稍快。",weight:85}]:[],skipped:0},lines:[{id:"shot-1",speaker:"self",text:"好呀，周日见！我到时候提前告诉你具体位置。"},{id:"shot-2",speaker:"self",text:"我下午应该有空，可以问下你吗？"},{id:"shot-3",speaker:"self",text:"行，那我到时候发你消息。"},{id:"shot-4",speaker:"other",text:"周日一起看展吧"}],annotations:[{lineId:"shot-4",emotion:[{key:"positive",label:"友好"}],intent:[{key:"invite",label:"发出邀约"}],evidence:"limited",note:"可见原话提出一起活动"}]});
    };
  })();`});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    const previous=globalThis.fetch;globalThis.__qaQuick=[];
    globalThis.fetch=async(input,options={})=>{
      const url=new URL(typeof input==="string"?input:input.url,location.origin);
      if(url.pathname==="/api/crush/quick"){
        const b=JSON.parse(options.body||"{}");globalThis.__qaQuick.push(b);
        return Response.json({quick:"看见的：对方提出了周日。\\n暂判：可以顺着确认具体时间。\\n下一步：问周日下午是否方便。",contextCount:4,linkedToSubject:false});
      }
      if(url.pathname==="/api/crush"&&(!options.method||options.method==="GET")&&!url.searchParams.has("id"))
        return Response.json({enabled:true,provider:"qwen",qwen:true,jev:true,quickJevEnabled:false,wechatConfigured:false,reports:[]});
      return previous(input,options);
    };
  })();`});
  await send('Page.navigate',{url:base+'/crush'});
  async function until(expression){
    for(let i=0;i<70;i++){if(await evaluate('Boolean('+expression+')'))return;await delay(100);}
    throw Error('UI condition failed: '+expression);
  }
  await until('document.querySelector("#chat-input") && !document.querySelector("#chat-input").readOnly');
  const click=async label=>evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes('+JSON.stringify(label)+')).click()');
  await click('填入示例');
  await evaluate('document.querySelector(".crush-consent input[type=checkbox]").click()');
  await click('先看最新一句');
  await until('document.querySelector(".crush-quick-result")?.textContent.includes("周日") && globalThis.__qaQuick.length===1');
  if(!await evaluate('globalThis.__qaQuick[0].text.includes("周六") && globalThis.__qaQuick[0].speaker==="other"'))throw Error('Quick look received wrong speaker or text');
  await click('开始逐句解读');
  await until('document.querySelector(".crush-source").textContent.includes("深度解读") && document.querySelector(".crush-result-actions")');
  await click('保存分析图');
  await until('document.querySelector(".crush-image-preview img")?.naturalWidth > 0');
  const image=await evaluate('({width:document.querySelector(".crush-image-preview img").naturalWidth,height:document.querySelector(".crush-image-preview img").naturalHeight,url:document.querySelector(".crush-image-preview img").src,errors:document.querySelector(".crush-error")?.textContent})');
  if(image.width!==1300||image.errors)throw Error('Image generation failed: '+JSON.stringify(image));
  const b64=await evaluate('new Promise(async resolve=>{const blob=await fetch(document.querySelector(".crush-image-preview img").src).then(r=>r.blob());const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(",")[1]);reader.readAsDataURL(blob);})');
  const file=join(profile,'crush-card-browser-qa.jpg');await writeFile(file,Buffer.from(b64,'base64'));
  await click('我怎么回');await until('document.querySelector(".crush-advice")?.textContent.includes("周日下午")');
  await click('新聊天');await until('!document.querySelector(".crush-result-actions") && document.querySelector("#chat-input").value === ""');
  await click('填入示例');await click('开始逐句解读');
  await until('globalThis.__qaSubmissions.length === 2 && document.querySelector(".crush-result-actions")');
  if(!await evaluate('globalThis.__qaSubmissions[0].sessionId !== globalThis.__qaSubmissions[1].sessionId'))throw Error('New chat reused old temporary context');
  await click('新聊天');
  await evaluate('(()=>{const file=new File([Uint8Array.from([137,80,78,71,13,10,26,10])],"synthetic-qa.png",{type:"image/png"});const files=new DataTransfer();files.items.add(file);const input=document.querySelector("input[type=file]");input.files=files.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await until('document.querySelector(".crush-screenshot img")');
  if(!await evaluate('document.querySelector(".crush-screenshot select")?.value === ""'))throw Error('Crush screenshot assumed a speaker side');
  await click('解读这张截图');
  await until('document.querySelector(".crush-error")?.textContent.includes("哪侧气泡是你")');
  if(!await evaluate('globalThis.__qaScreenshotSubmissions.length===0'))throw Error('Crush uploaded before side confirmation');
  await evaluate('(()=>{const input=document.querySelector(".crush-screenshot select");input.value="right";input.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await evaluate('document.querySelectorAll(".crush-screenshot input[type=checkbox]").forEach(input=>input.click())');
  await click('解读这张截图');
  try{await until('globalThis.__qaScreenshotSubmissions.length===1 && document.querySelector(".decision-panel")?.textContent.includes("可能在邀请一起活动")');}
  catch(error){const state=await evaluate('({submitted:globalThis.__qaScreenshotSubmissions.length,error:document.querySelector(".crush-error")?.textContent,decision:document.querySelector(".decision-panel")?.textContent.slice(0,150),busy:document.querySelector(".crush-primary")?.textContent})');throw Error(error.message+': '+JSON.stringify(state));}
  const shot=await evaluate('({confirmed:globalThis.__qaScreenshotSubmissions[0].confirmed,side:globalThis.__qaScreenshotSubmissions[0].selfSide,hasImage:globalThis.__qaScreenshotSubmissions[0].image.startsWith("data:image/png;base64,"),subject:globalThis.__qaScreenshotSubmissions[0].subjectId})');
  if(!shot.confirmed||shot.side!=="right"||!shot.hasImage||shot.subject!==null)throw Error('Screenshot upload mapping failed: '+JSON.stringify(shot));
  const decision=await evaluate('({sections:[...document.querySelectorAll(".decision-section>span")].map(node=>node.textContent),options:[...document.querySelectorAll(".decision-option-head")].map(node=>node.textContent),disclosure:document.querySelector(".decision-option small")?.textContent})');
  if(decision.sections.join('|')!=="01 · 对方可能的意图|02 · 依据|03 · 军师建议"||decision.options.length!==2||!decision.options[0].includes("本轮首选")||!decision.options[0].includes("自然承接"))throw Error('Decision hierarchy or reply ranking failed: '+JSON.stringify(decision));
  if(!await evaluate('document.querySelector(".decision-option-text")?.textContent.includes("周日下午可以一起看展吗")'))throw Error('Highest-weight reply did not render first');
  if(!await evaluate('[...document.querySelectorAll(".decision-option>small")].some(node=>node.textContent.includes("不发送截图或长期档案"))'))throw Error('Cloud rewrite privacy disclosure missing');
  await evaluate('document.querySelector(".decision-option summary").click()');
  if(!await evaluate('document.querySelector(".decision-option details[open]")?.textContent.includes("如果对方只是客套")'))throw Error('Reply cost was not expanded');
  await click('更像我一点');
  await until('globalThis.__qaRewriteSubmissions.length===1 && document.querySelector(".decision-option-text")?.textContent.includes("周日下午见面行吗")');
  const rewrite=await evaluate('globalThis.__qaRewriteSubmissions[0]');
  if(!/^[a-f0-9-]{36}$/.test(rewrite.reportId))throw Error('Rewrite report ID invalid');
  if(rewrite.optionIndex!==0||rewrite.confirmed!==true||Object.keys(rewrite).sort().join(',')!=="confirmed,optionIndex,reportId")throw Error('Rewrite submitted unexpected material: '+JSON.stringify(rewrite));
  await click('新聊天');
  await evaluate('(()=>{const file=new File([Uint8Array.from([137,80,78,71,13,10,26,10])],"synthetic-empty-options.png",{type:"image/png"});const files=new DataTransfer();files.items.add(file);const input=document.querySelector("input[type=file]");input.files=files.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await until('document.querySelector(".crush-screenshot img")');
  await evaluate('(()=>{const input=document.querySelector(".crush-screenshot select");input.value="right";input.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await evaluate('document.querySelectorAll(".crush-screenshot input[type=checkbox]").forEach(input=>{if(!input.checked)input.click()})');
  await click('解读这张截图');
  await until('globalThis.__qaScreenshotSubmissions.length===2 && document.querySelector(".decision-options-empty")');
  if(!await evaluate('document.querySelector(".decision-options-empty")?.textContent.includes("不必为了发而发") && !document.querySelector(".decision-option")'))throw Error('No-reply state did not render safely');
  const metrics=await evaluate('({width:innerWidth,content:document.documentElement.scrollWidth})');
  if(metrics.content>metrics.width)throw Error('Authenticated flow overflowed');
  await send('Page.navigate',{url:base+'/quick'});
  await until('document.querySelector(".quick-page") && document.querySelector(".quick-picker") && !document.querySelector(".quick-picker").disabled');
  await evaluate('(()=>{const file=new File([Uint8Array.from([137,80,78,71,13,10,26,10])],"synthetic-quick.png",{type:"image/png"});const files=new DataTransfer();files.items.add(file);const input=document.querySelector(".quick-page input[type=file]");input.files=files.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await until('document.querySelector(".quick-picker.selected")');
  if(!await evaluate('document.querySelectorAll(".quick-field-row select")[1]?.value === ""'))throw Error('Quick screenshot assumed a speaker side');
  await click('看这张图怎么聊');
  await until('document.querySelector(".quick-error")?.textContent.includes("哪侧气泡是你")');
  if(!await evaluate('globalThis.__qaScreenshotSubmissions.length===0'))throw Error('Quick uploaded before side confirmation');
  await evaluate('(()=>{const input=document.querySelectorAll(".quick-field-row select")[1];input.value="right";input.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await evaluate('document.querySelectorAll(".quick-consents input[type=checkbox]").forEach(input=>{if(!input.checked)input.click()})');
  await click('看这张图怎么聊');
  await until('document.querySelector(".quick-result .decision-panel")?.textContent.includes("可能在邀请一起活动")');
  const quick=await evaluate('({sections:[...document.querySelectorAll(".quick-result .decision-section>span")].map(node=>node.textContent),first:document.querySelector(".quick-result .decision-option-head")?.textContent,options:document.querySelectorAll(".quick-result .decision-option").length,content:document.documentElement.scrollWidth,width:innerWidth,submitted:globalThis.__qaScreenshotSubmissions.length})');
  if(quick.sections.join('|')!=="01 · 对方可能的意图|02 · 依据|03 · 军师建议"||!quick.first.includes("自然承接")||quick.options!==2||quick.content>quick.width||quick.submitted!==1)throw Error('Quick H5 result failed: '+JSON.stringify(quick));
  await send('Page.navigate',{url:base+'/crush?share_error=invalid'});
  await until('document.body.textContent.includes("分享的文件不是 5 MB")');
  const shareError=await evaluate('({notice:document.body.textContent.includes("分享的文件不是 5 MB"),cleanUrl:location.pathname==="/crush"&&!location.search})');
  if(!shareError.notice||!shareError.cleanUrl)throw Error('Share error notice did not survive URL cleanup');
  console.log(JSON.stringify({flow:'quick look, full report, on-device JPEG, advice, fresh temporary session, screenshot upload, weighted ranking, reply details, cloud rewrite request, no-reply state, quick H5 entry, share-error notice',...metrics,image:{width:image.width,height:image.height,file},screenshot:shot,quick,shareError,backend:'mocked test data only; no real user or model call'}));
  await call('Browser.close');
} finally {
  socket?.close();
  for (const item of pending.values()) clearTimeout(item.timer);
  if (edge.exitCode === null) edge.kill();
}
