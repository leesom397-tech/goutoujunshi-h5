/**
 * Browser regression for the complete person-import flow.
 * Run against the local app: INTAKE_TEST_ORIGIN=http://127.0.0.1:8798 node scripts/test-capture-steps-ui-browser.mjs
 * CHROME_BIN may override the Chrome executable. All account, collector, and API
 * traffic is synthetic; the rendered UI, IndexedDB, upload queue, and transitions
 * are real. No real WeChat data, billing, or remote report generation is used.
 * Screenshots are written to outputs/capture-steps-ui/.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";
const origin = process.env.INTAKE_TEST_ORIGIN || "http://127.0.0.1:8798";
const legacyImages = process.env.CAPTURE_TEST_LEGACY_IMAGES === "1";
const owner = "one-click-fixture", person = "11111111-1111-4111-8111-111111111111", wx = "fixture-wechat-account", friend = "合成验收人物", contactId = "fixture-contact";
const accountKey = createHash("sha256").update(wx).digest("hex");
const out = "outputs/capture-steps-ui";
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_BIN || "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"], defaultViewport: { width: 1366, height: 900 } });
const page = await browser.newPage(), errors = [], calls = [], jobs = /* @__PURE__ */ new Map(), cloud = /* @__PURE__ */ new Map();
let reportState = "running", activeReport = null, failStatus = false;
let voiceReleased = false, voiceDone = false, connected = false, requestCount = 0, earlyUploaded = false, momentsReleased = false, momentsUploaded = false;
let imagesDone=false;
const image={mime:"image/png",name:"synthetic.png",data:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGkAAAAASUVORK5CYII="};
page.on("pageerror", (e) => errors.push(e.message));
const rows = Array.from({ length: 513 }, (_, i) => ({ id: "wechat-db:fixture-" + i, kind: i < 13 ? "other" : "text", sender: i % 2 ? friend : "我", senderRole: i % 2 ? "other" : "self", at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), text: i < 13 ? "[语音]" : "真实浏览器中的合成测试 " + i, source: { label: "合成原文", method: "wechat-local-db", idStability: "stable", accountId: wx, sessionId: contactId, messageShard: "message_0.db", messageId: String(i + 1), localId: String(i + 1), ...i < 13 ? { mediaKind: "voice", durationSeconds: 3, transcriptionStatus: "not-transcribed", voiceAvailability: "missing-local" } : {} } }));
for(let i=13;i<18;i++){rows[i].kind="image";rows[i].text="[图片]";rows[i].source.previewUnavailable="image-key-unavailable";}
function chatBatch(body) {
  if(body.imageOnly){
    assert.equal(body.includeVoice,false);assert.equal(body.voiceOnly,undefined);assert.equal(body.cursor,undefined);assert.equal(body.since,undefined);
    const selected=rows.filter(row=>body.imageIds.some(ref=>ref.messageId===row.source.messageId));
    return{version:1,kind:"chat",friend,account:wx,capturedAt:new Date().toISOString(),warnings:[],records:selected.map((row,i)=>({...row,...(i<3?{images:[image]}:{}),source:{...row.source,mediaAvailability:i<3?"preview":"missing-local",previewUnavailable:i<3?undefined:"missing-local"}})),history:{version:1,direction:"backward",count:selected.length,hasMore:false,nextCursor:null,snapshot:"snapshot_images",complete:true}};
  }
  const offset = Number(body.cursor?.slice(2) || 0), selected = body.voiceOnly ? rows.filter((row) => body.voiceIds.some((ref) => ref.messageId === row.source.messageId)) : rows.slice(offset, offset + body.pageSize), more = !body.voiceOnly && offset + selected.length < rows.length;
  return { version: 1, kind: "chat", friend, account: wx, capturedAt: (/* @__PURE__ */ new Date()).toISOString(), warnings: [], records: selected.map((row) => body.voiceOnly ? { ...row, kind: "text", text: "这条是必须进入报告的语音 " + row.source.messageId, source: { ...row.source, transcriptionStatus: "visible-text", voiceAvailability: "transcribed", transcriptionSource: "local-audio-asr" } } : row), history: { version: 1, direction: body.direction || "backward", count: selected.length, hasMore: more, nextCursor: more ? "c_" + (offset + selected.length) : null, snapshot: "snapshot_" + (body.voiceOnly ? "voices" : "text"), complete: !more } };
}
const moments = () => ({ version: 1, kind: "moments", friend, account: wx, capturedAt: (/* @__PURE__ */ new Date()).toISOString(), warnings: [], records: Array.from({ length: 5 }, (_, i) => ({ id: "post-" + i, kind: "post", sender: friend, senderRole: "other", at: "2026-09-02", text: "朋友圈合成原文 " + i, source: { label: "朋友圈", method: "uia" } })), coverage: { scope: "all-visible", complete: true, stopReason: "visible-end", recordCount: 5, imageOmittedCount: 0, unreadableCount: 0 } });
const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Allow-Private-Network": "true" };
await page.setRequestInterception(true);
page.on("request", async (req) => {
  try {
    const u = new URL(req.url());
    let value = {}, status = 200;
    if (u.port === "17863") {
      if (req.method() === "OPTIONS") {
      } else if (u.pathname === "/health") value = { version: legacyImages?"1.2.13":"1.2.15", ready: true, backgroundModelReady: true, capabilities: { chat: true, moments: true, personBundle: true, momentsAllVisible: true, momentsContacts: true, backgroundChat: true, backgroundHistory: true, backgroundVoice: true, backgroundVoiceById: true,...(!legacyImages?{backgroundImagesById:true}:{}) } };
      else if (u.pathname === "/session") value = { connected };
      else if (u.pathname === "/pair") {
        connected = true;
        value = { token: "synthetic-token", expiresIn: 28800 };
      } else if (u.pathname === "/contacts/search") value = { accountKey, contacts: [{ contactId, label: friend, nickname: friend, wechatId: "fixture-account" }] };
      else if (u.pathname === "/capture") {
        const body = JSON.parse(req.postData());
        calls.push({ path: "capture", body });
        if (body.kind === "moments") assert.equal(voiceDone, true, "all voices finish before moments");
        if (body.kind === "moments") assert.equal(imagesDone, true, "missing images checked once before moments");
        const id = "job-" + ++requestCount;
        jobs.set(id, body);
        value = { jobId: id };
      } else if (u.pathname.startsWith("/jobs/")) {
        const body = jobs.get(u.pathname.split("/")[2]);
        assert.ok(body);
        if (body.cursor && !earlyUploaded) value = { status: "running", message: "等待重叠上传验收", progress: 10 };
        else if (body.voiceOnly && !voiceReleased) value = { status: "running", message: "正在转写语音 0 / 13", progress: 10 };
        else if (body.kind === "moments" && !momentsReleased) value = { status: "running", message: "继续采集朋友圈", progress: 20, partialRevision: 1, partial: { ...moments(), coverage: { ...moments().coverage, complete: false, stopReason: "scanning", recordCount: 2 }, records: moments().records.slice(0, 2) } };
        else {
          if (body.voiceOnly) voiceDone = true;
          if (body.imageOnly) imagesDone = true;
          value = { status: "done", result: body.kind === "moments" ? moments() : chatBatch(body) };
        }
      } else {
        status = 404;
        value = { error: "fixture missing bridge " + u.pathname };
      }
    } else if (u.origin === origin && u.pathname.startsWith("/api/")) {
      const body = req.method() === "POST" ? JSON.parse(req.postData() || "{}") : null;
      calls.push({ path: u.pathname, body });
      const credits = { account: { userId: owner, balance: 100, active: true }, prices: { analysisSmall: 30, profile: 30 } }, profile = { enabled: true, paused: false, subjects: [{ id: person, label: friend }] };
      if (u.pathname === "/api/auth/session") value = { loggedIn: true, user: { id: owner } };
      else if (u.pathname === "/api/account/credits") value = credits;
      else if (u.pathname === "/api/web/account-context") value = { account: credits.account, prices: credits.prices, people: [{ id: person, label: friend }], user: { name: "验收用户" }, admin: false, meteringReady: true, meteringScope: "web", contact: "fixture" };
      else if (u.pathname === "/api/web/profile") value = profile;
      else if (u.pathname === "/api/web/capture/subject") value = { subjectId: person, label: friend, created: false };
      else if (u.pathname === "/api/web/capture/library") {
        if (body?.action === "sync") {
          if (body.library.kind === "chat" && !voiceDone) earlyUploaded = true;
          if (body.library.kind === "moments" && !momentsReleased) momentsUploaded = true;
          let state = [...cloud.values()].find((v) => v.friend === body.library.friend && v.kind === body.library.kind);
          if (!state) {
            const id = "cl_" + (body.library.kind === "chat" ? "a" : "b").repeat(64);
            state = { ...body.library, id, epoch: 1, rows: /* @__PURE__ */ new Map(), reportLinks: [], warnings: [], deleted: false };
            cloud.set(id, state);
          }
          state.updatedAt=body.library.updatedAt;state.subjectId=body.library.subjectId;
          for (const row of body.records) state.rows.set(row.localId, row);
          value = { ownerId: owner, library: { ...state, rows: void 0, total: state.rows.size }, conflicts: [] };
        } else if(body?.action==="sync-media"){
          const state=cloud.get(body.libraryId);assert.ok(state);const row=state.rows.get(body.localId);assert.ok(row?.imageCount);
          row.media=[{id:"fixture-media-"+body.localId,index:0,mime:body.mime,name:body.name,sha256:body.sha256,chunks:1,bytes:Buffer.from(body.data,"base64").length,status:"ready"}];
          value={ownerId:owner,ready:true};
        } else if(u.searchParams.has("id")) {
          const state=cloud.get(u.searchParams.get("id"));assert.ok(state);
          const offset=Number(u.searchParams.get("cursor")||0),records=[...state.rows.values()].slice(offset,offset+500);
          value={ownerId:owner,library:{...state,rows:undefined,total:state.rows.size},records,nextCursor:offset+records.length<state.rows.size?String(offset+records.length):null};
        } else value = { ownerId: owner, libraries: [...cloud.values()].map((v) => ({ ...v, rows: void 0, total: v.rows.size })) };
      } else if (u.pathname === "/api/web/capture/analyze") {
        if (body) {
          assert.equal(body.confirmed, true);
          assert.equal(body.expectedTotal, 513);
          assert.equal(body.relatedSnapshots.length, 1);
          assert.equal(body.relatedSnapshots[0].expectedTotal, 5);
          const chat = [...cloud.values()].find((v) => v.kind === "chat");
          assert.equal([...chat.rows.values()].filter((r) => r.source.mediaKind === "voice" && r.source.transcriptionStatus === "visible-text").length, 13);
          assert.equal([...chat.rows.values()].filter(r=>r.kind==="image"&&r.imageCount===1&&r.media?.length===1).length,3,"repaired media uploaded once before analysis");
          activeReport={status:"running",phase:"segments",friend,totalCount:body.expectedTotal,completedText:200,taskId:body.requestId,libraryId:body.libraryId,subjectId:person,startedAt:Date.now(),primarySnapshot:{libraryId:body.libraryId,expectedTotal:body.expectedTotal,expectedEpoch:body.expectedEpoch},relatedSnapshots:body.relatedSnapshots};
          reportState="running";value=activeReport;
        } else {
          if(failStatus){status=503;value={error:"合成断网"};}
          else value=activeReport&&(!u.searchParams.has("libraryId")||u.searchParams.get("libraryId")===activeReport.libraryId)&&(!u.searchParams.has("taskId")||u.searchParams.get("taskId")===activeReport.taskId)?{...activeReport,status:reportState,phase:reportState==="done"?"complete":"segments",updatedAt:Date.now(),completedAt:reportState==="done"?Date.now():undefined,creditTaskStatus:reportState==="error"?"released":reportState==="done"?"settled":"reserved",error:reportState==="error"?"合成服务暂时不可用":""}:{status:"none"};
        }
      } else if (u.pathname === "/api/web/report/list") value = { reports: [] };
    } else return req.continue();
    await req.respond({ status, headers, contentType: "application/json", body: JSON.stringify(value) });
  } catch (e) {
    errors.push(e.message);
    await req.respond({ status: 500, headers, body: JSON.stringify({ error: e.message }) }).catch(() => {
    });
  }
});
const waitText = (text) => page.waitForFunction((text2) => document.body.innerText.includes(text2), { timeout: 6e4 }, text);
const click = async (text) => {
  await page.waitForFunction((text2) => [...document.querySelectorAll("button")].some((e) => !e.disabled && e.textContent.trim() === text2), { timeout: 3e4 }, text);
  await page.evaluate((text2) => [...document.querySelectorAll("button")].find((e) => !e.disabled && e.textContent.trim() === text2).click(), text);
};
flow: try {
  await page.goto(origin + "/capture?method=desktop&kind=chat", { waitUntil: "networkidle0", timeout: 9e4 });
  assert.equal(await page.$('input[placeholder="输入好友的备注或昵称"]'), null, "connection step has no competing person form");
  await page.screenshot({ path: out + "/01-connect-desktop.png", fullPage: true });
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: out + "/01-connect-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "connection mobile no overflow");
  await page.setViewport({ width: 1366, height: 900 });
  await page.evaluate(() => document.querySelector("#capture-code").closest("details").open = true);
  await page.type("#capture-code", "ABCDEF12");
  await click("连接");
  await page.waitForSelector('input[placeholder="输入好友的备注或昵称"]');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll("summary")].some((e) => e.getClientRects().length && e.textContent.includes("电脑上的聊天不全"))), false, "no long history help before selection");
  await page.type('input[placeholder="输入好友的备注或昵称"]', friend);
  await waitText("微信号：fixture-account");
  await page.evaluate(() => document.querySelector('[aria-label="选择要导入的微信联系人"] button').click());
  await page.waitForSelector("[data-selected-person]");
  assert.equal(await page.$eval("[data-selected-person]", (e) => e.innerText.includes("微信号：fixture-account")), true, "chosen contact identity retained");
  assert.equal(await page.evaluate(() => [...document.querySelectorAll("button")].some((e) => e.getClientRects().length && !e.closest("details:not([open])") && e.textContent.trim() === "导入这个人的全部聊天")), false, "chat-only alternative collapsed");
  await page.screenshot({ path: out + "/02-selected-desktop.png", fullPage: true });
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: out + "/02-selected-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "selected mobile no overflow");
  await page.setViewport({ width: 1366, height: 900 });
  await click("更换来源");
  assert.equal(await page.$eval("[data-selected-person]", (e) => !!e.getClientRects().length).catch(() => false), false, "source chooser replaces current form");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((e) => e.getClientRects().length && e.textContent.includes("电脑微信") && e.textContent.includes("连接助手")).click());
  await page.waitForSelector("[data-selected-person]");
  await click("导入这个人的全部资料");
  await waitText("正在转写语音");
  assert.equal(calls.filter((c) => c.path === "capture" && c.body.kind === "chat" && !c.body.voiceOnly && !c.body.imageOnly).length, 2, "text history scanned only once");
  assert.equal(calls.filter((c) => c.path === "capture" && c.body.voiceOnly).length, 1, "one bounded voice request");
  assert.equal(calls.find((c) => c.path === "capture" && c.body.voiceOnly).body.voiceIds.length, 13);
  assert.equal(earlyUploaded, true, "first page uploaded before remaining history and voices complete");
  assert.equal(await page.$eval("#capture-preview", (e) => !!e.getClientRects().length), false, "no ready/report controls while voices processing");
  assert.equal(calls.filter((c) => c.path === "/api/web/capture/analyze" && c.body).length, 0);
  await page.screenshot({ path: out + "/voice-progress.png", fullPage: true });
  voiceReleased = true;
  if(legacyImages){
    await waitText("请更新电脑助手后继续导入");
    await new Promise(resolve=>setTimeout(resolve,1500));
    assert.equal(calls.filter(c=>c.path==="capture"&&c.body.imageOnly).length,0,"old helper never receives an unsupported image request");
    assert.equal(calls.filter(c=>c.path==="capture").length,3,"old helper does not loop after one history and voice pass");
    assert.equal(calls.filter(c=>c.path==="/api/web/capture/analyze"&&c.body).length,0);
    await page.screenshot({path:out+"/old-helper-image-update.png",fullPage:true});
    console.log("PASS old helper image capability: explicit update message, saved chats kept, no unsupported capture/retry/charge.");
    break flow;
  }
  await waitText("继续采集朋友圈");
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 15e3;
    const poll = () => momentsUploaded ? resolve() : Date.now() > deadline ? reject(Error("Moments partial not uploaded during capture")) : setTimeout(poll, 50);
    poll();
  });
  const counts = await page.$eval('[data-import-stage="moments"]', (e) => e.innerText);
  assert.match(counts, /聊天\s*513/, "chat count remains visible during Moments");
  assert.match(counts, /语音转写\s*13\s*\/\s*13/, "voice progress remains completed");
  momentsReleased = true;
  await page.waitForSelector("#capture-confirm", { visible: true });
  assert.equal(calls.filter((c) => c.path === "capture").length, 5, "text x2 + voice x1 + images x1 + Moments x1, no repeated capture");
  assert.equal(calls.filter(c=>c.path==="capture"&&c.body.imageOnly).length,1,"terminal missing-local images never loop");
  assert.match(await page.$eval("#capture-confirm",e=>e.innerText),/聊天图片 3 \/ 5 条可读 · 2 条缺失/);
  assert.equal(calls.filter((c) => c.path === "/api/web/capture/analyze" && c.body).length, 0, "no charge before confirmation");
  assert.match(await page.$eval("#capture-confirm", (e) => e.innerText), /全部 513 条聊天 \+ 5 条朋友圈/);
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: out + "/03-fee-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "fee mobile no overflow");
  assert.equal(await page.$eval("#capture-confirm", (section) => {
    const action = [...section.querySelectorAll("button")].find((node) => node.textContent.includes("确认并生成报告"));
    const rect = action.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight - 90 && parseFloat(getComputedStyle(action).fontSize) >= 16;
  }), true, "fee, authorization, and readable primary action fit above the mobile navigation");
  await page.setViewport({ width: 1366, height: 900 });
  await click("返回上一步");
  await click("补充资料");
  await page.waitForSelector("[data-selected-person]");
  assert.equal(await page.$eval("[data-selected-person]", (e) => e.innerText.includes("fixture-account")), true, "supplement returns to same contact");
  await click("返回已保存的材料");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((e) => e.getClientRects().length && e.textContent.includes("生成完整关系报告")).click());
  await page.waitForSelector("#capture-confirm", { visible: true });
  const uploadedBeforeConfirm = calls.filter((c) => c.path === "/api/web/capture/library" && c.body?.action === "sync").length;
  await page.screenshot({ path: out + "/confirm.png", fullPage: true });
  await page.click("#capture-confirm input[type=checkbox]");
  await page.evaluate(() => {const action=[...document.querySelectorAll("#capture-confirm button")].find((e) => e.textContent.includes("确认并生成报告"));action.click();action.click();});
  await page.waitForSelector('[data-capture-analysis="running"]', { timeout: 6e4 });
  assert.equal(calls.filter((c) => c.path === "/api/web/capture/analyze" && c.body).length, 1, "one final report");
  assert.equal(calls.filter((c) => c.path === "/api/web/capture/library" && c.body?.action === "sync").length, uploadedBeforeConfirm, "confirm reuses the verified upload rather than syncing again");
  assert.equal(await page.$eval("#capture-preview", (e) => !!e.getClientRects().length), false, "one active analysis view");
  // Refresh while running restores the same task and cannot expose a second generate action.
  await page.reload({waitUntil:"networkidle0"});
  await page.waitForSelector('[data-capture-analysis="running"]',{timeout:30000});
  assert.equal(await page.$eval("#capture-preview",e=>!!e.getClientRects().length),false,"refresh keeps one running-task surface");
  assert.equal(calls.filter(c=>c.path==="/api/web/capture/analyze"&&c.body).length,1,"refresh never posts or charges");
  failStatus=true;
  await page.evaluate(()=>window.dispatchEvent(new Event("chengzi:capture-analysis")));
  await waitText("暂时连不上进度");
  assert.equal(await page.$eval("#capture-preview",e=>!!e.getClientRects().length),false,"progress connection failure cannot resurrect the generate button");
  failStatus=false;reportState="done";
  await page.evaluate(()=>window.dispatchEvent(new Event("chengzi:capture-analysis")));
  await page.waitForSelector('[data-capture-analysis="done"]',{visible:true});
  await waitText("查看已生成报告");
  assert.equal(await page.$$eval('[data-capture-analysis]',nodes=>nodes.filter(e=>e.getClientRects().length).length),1,"only one completed report surface");
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll("button")].some(e=>e.getClientRects().length&&e.textContent.includes("生成完整关系报告"))),false,"no primary generate button after completion");
  assert.match(await page.$eval('[data-capture-analysis="done"]',e=>e.innerText),/生成于/);
  await page.screenshot({path:out+"/04-complete-desktop.png",fullPage:true});
  await page.reload({waitUntil:"networkidle0"});
  await page.waitForSelector('[data-capture-analysis="done"]',{visible:true});
  await page.waitForFunction(()=>!document.body.innerText.includes("正在核对这位好友的朋友圈"));
  assert.equal(calls.filter(c=>c.path==="/api/web/capture/analyze"&&c.body).length,1,"done refresh does not resubmit analysis");
  await page.setViewport({width:390,height:844});
  await page.screenshot({path:out+"/04-complete-mobile.png",fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,"completed mobile no overflow");
  await page.setViewport({width:1366,height:900});
  await click("重新分析 / 调整重点");
  await page.waitForSelector("#capture-confirm",{visible:true});
  assert.equal(await page.$eval("#capture-confirm input[type=checkbox]",e=>e.checked),false,"reanalyze requires fresh explicit fee confirmation");
  assert.equal(calls.filter(c=>c.path==="/api/web/capture/analyze"&&c.body).length,1,"opening reanalysis does not post");
  await click("返回上一步");
  await page.evaluate(()=>[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.includes("导入详情")).click());
  assert.equal(await page.$eval('[data-cloud-sync]',e=>[...e.querySelectorAll("button")].some(button=>button.getClientRects().length)),false,"healthy imported material has no redundant manual sync action");
  await page.evaluate(()=>[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.includes("导入详情")).click());
  // Same-count voice/text corrections must be distinguishable from the report's frozen material.
  await page.evaluate(async(owner)=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("chengzi-desktop-capture-v1",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction("libraries","readwrite"),store=tx.objectStore("libraries"),read=store.index("ownerId").getAll(owner);read.onsuccess=()=>{for(const value of read.result)if(value.kind==="chat"){value.records[0].text="修正后的合成语音原文";value.updatedAt=new Date(Date.now()+60000).toISOString();store.put(value);}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  },owner);
  await page.reload({waitUntil:"networkidle0"});
  await waitText("这次有新增或更新的资料");
  assert.equal(calls.filter(c=>c.path==="/api/web/capture/analyze"&&c.body).length,1,"new material never regenerates or charges automatically");
  await page.screenshot({path:out+"/05-updated-material.png",fullPage:true});
  reportState="error";
  await page.evaluate(()=>window.dispatchEvent(new Event("chengzi:capture-analysis")));
  await page.waitForSelector('[data-capture-analysis="error"]',{visible:true});
  await waitText("本次积分已退回");
  await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(e=>e.getClientRects().length&&!e.disabled&&e.textContent.includes("重试生成完整报告")));
  await page.evaluate(()=>[...document.querySelectorAll("button")].find(e=>e.getClientRects().length&&!e.disabled&&e.textContent.includes("重试生成完整报告")).click());
  await page.waitForSelector("#capture-confirm",{visible:true});
  assert.equal(await page.$eval("#capture-confirm input[type=checkbox]",e=>e.checked),false,"failed retry requires explicit confirmation too");
  await page.click("#capture-confirm input[type=checkbox]");
  await page.evaluate(()=>{const action=[...document.querySelectorAll("#capture-confirm button")].find(e=>e.textContent.includes("确认并生成报告"));action.click();action.click();});
  await page.waitForSelector('[data-capture-analysis="running"]',{visible:true});
  assert.equal(calls.filter(c=>c.path==="/api/web/capture/analyze"&&c.body).length,2,"double-click on explicit retry makes only one new request");
  reportState="done";
  await page.evaluate(()=>window.dispatchEvent(new Event("chengzi:capture-analysis")));
  await page.waitForSelector('[data-capture-analysis="done"]',{visible:true});
  assert.equal(calls.filter(c=>c.path==="capture").length,5,"refresh/done/retry never restart WeChat collection");
  assert.deepEqual(errors, []);
  console.log("PASS capture flow: pipelined 513 chat + 13 voices + 5 Moments; no duplicate capture/upload/confirmation; running refresh and offline recovery; single done CTA; new same-count evidence; explicit fee-gated retry; double-click guards; desktop/mobile. Browser/IDB real, services synthetic.");
} finally {
  if (errors.length) console.error(errors);
  await page.screenshot({ path: out + "/last-state.png", fullPage: true }).catch(() => {
  });
  await browser.close();
}
