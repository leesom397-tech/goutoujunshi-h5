// Functional tests against real built React pages with synthetic API responses.
// This launches a fresh, headless Edge profile and never touches production data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const base = "http://127.0.0.1:5191";
const browserProfile = await mkdtemp(join(tmpdir(), "chengzi-archive-qa-"));
const output = "outputs/web-archive";
await mkdir(output, { recursive: true });
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${browserProfile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, serial = 0, sessionId, acceptDialog = false, failNextDate = true;
const pendingCalls = new Map(), exceptions = [], writes = [], checks = [], dialogs = [];
const personId = "11111111-1111-4111-8111-111111111111", reportId = "33333333-3333-4333-8333-333333333333", factId = "44444444-4444-4444-8444-444444444444", eventId = "55555555-5555-4555-8555-555555555555";
const originalPerson = { id: personId, label: "合成人物小林", updatedAt: Date.now(), city: "杭州", occupation: "设计师", stage: "正在了解", notes: "合成备注", compatibility: { fit: [{ dimension: "见面距离", field: "city", selfNeed: "杭州", reading: "杭州", evidence: "已确认资料", conclusion: "同城，可安排轻量见面", status: "匹配", score: 90 }], fitScore: 90, fitSummary: "同城，可继续了解", coverage: 1, total: 6, commonPoints: [] } };
const state = { enabled: true, paused: false, self: { city: "杭州", preferredAgeRange: "25–35", preferredRelationship: "稳定关系", values: "真诚沟通", weights: { values: 4 } }, subjects: [structuredClone(originalPerson)], facts: [{ id: "66666666-6666-4666-8666-666666666666", subjectId: personId, kind: "subjectBasic:ageRange", value: "31岁", source: "最新截图", evidence: "最新明确自述", status: "pending" }, { id: factId, subjectId: personId, kind: "subjectBasic:occupation", value: "产品设计师", source: "合成截图", evidence: "图一 · 明确自述", status: "pending" }, { id: eventId, subjectId: personId, kind: "recentEvent", value: "周六一起喝咖啡吗？", source: "合成聊天", evidence: "合成原话", status: "accepted", eventTitle: "对方提出邀约", eventDate: "2026-10-05" }], signals: [{ subjectId: personId, reportId, score: 67, comparable: true, estimated: false, summary: "具体邀约值得继续确认", nextStep: "确认时间和地点", updatedAt: Date.now(), eventStart: "2026-10-05", eventEnd: "2026-10-05", dimensions: [{ label: "主动投入", value: 70 }, { label: "回应承接", value: 65 }, { label: "沟通扩展", value: 66 }, { label: "邀约兑现", value: null }, { label: "边界尊重", value: 80 }, { label: "互惠稳定", value: 60 }] }], trends: [] };
const feedback = { subjectId: personId, cards: [{ reportId, action: "确认时间和地点", suggestedAt: Date.now(), latest: null, revisions: [], outcomeLabel: "尚未反馈", revisionCount: 0, sourceSummary: "具体邀约值得继续确认", sourceAvailable: true, sourceEventStart: "2026-10-05", sourceEventEnd: "2026-10-05" }], events: [] };
function call(method, params = {}, sid) {
  const id = ++serial;
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { pendingCalls.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 20000); pendingCalls.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
}
const send = (method, params) => call(method, params, sessionId);
async function evaluate(expression) { const value = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (value.exceptionDetails) throw Error(`${value.exceptionDetails.text}: ${value.result.description}`); return value.result.value; }
async function until(expression, label) { for (let index = 0; index < 100; index++) { if (await evaluate(expression)) return; await delay(100); } throw Error(`Timed out: ${label}`); }
async function navigate(path) { await send("Page.navigate", { url: base + path }); await until(`document.readyState==='complete' && location.pathname===${JSON.stringify(path.split("?")[0])}`, path); await delay(400); }
async function visible(text) { await until(`document.body?.innerText.includes(${JSON.stringify(text)})`, text); }
async function click(text, selector = "button") { await evaluate(`(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(item=>item.textContent.trim()===${JSON.stringify(text)});if(!element)throw Error('Missing control: '+${JSON.stringify(text)});if(element.disabled)throw Error('Control disabled: '+${JSON.stringify(text)});element.click();})()`); await delay(60); }
async function field(label, value) { await evaluate(`(()=>{const wrapper=[...document.querySelectorAll('label')].find(item=>item.querySelector('span')?.textContent===${JSON.stringify(label)});const element=wrapper?.querySelector('input,textarea,select');if(!element)throw Error('Missing field: '+${JSON.stringify(label)});const proto=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));})()`); await delay(60); }
async function screenshot(name) { const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(`${output}/${name}.png`, Buffer.from(image.data, "base64")); }
async function captureWidths(name) {
  for (const width of [1280, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 960, deviceScaleFactor: 1, mobile: width === 390 });
    await evaluate("scrollTo(0,0)"); await delay(750);
    const size = await evaluate("({width:innerWidth,content:document.documentElement.scrollWidth})");
    assert.ok(size.content <= size.width + 1, `${name}: no horizontal overflow at ${width}px`);
    assert.equal(await evaluate("[...document.images].filter(image=>image.getAttribute(\"src\")?.includes(\"/visuals/\")).every(image=>image.complete&&image.naturalWidth>0)"), true, `${name}: hero images loaded`);
    await screenshot(`${name}-${width}`);
  }
}
function last(action) { return writes.filter(item => item.body.action === action).at(-1)?.body; }
async function respond(event) {
  const url = new URL(event.request.url), method = event.request.method, body = event.request.postData ? JSON.parse(event.request.postData) : {};
  let result, status = 200;
  if (method !== "GET") writes.push({ path: url.pathname, method, body });
  if (url.pathname === "/api/web/profile") {
    if (method === "POST") {
      if (body.action === "create-manual") { if (!state.subjects.some(person => person.id === body.id)) state.subjects.push({ id: body.id, label: body.label, updatedAt: Date.now(), ...body.data }); result = { createdSubjectId: body.id }; }
      if (body.action === "self") state.self = { ...state.self, ...body.data };
      if (body.action === "save") { const person = state.subjects.find(item => item.id === body.id); Object.assign(person, Object.fromEntries(Object.entries(body).filter(([key]) => !["action", "id"].includes(key)))); }
      if (body.action === "fact-decide") { const fact = state.facts.find(item => item.id === body.id); if (body.decision === "accept") fact.status = "accepted"; else state.facts = state.facts.filter(item => item.id !== body.id); }
      if (body.action === "event-date") { if (failNextDate) { failNextDate = false; status = 503; result = { error: "合成断线：日期暂未保存，请重试。" }; } else { const fact = state.facts.find(item => item.id === body.id); assert.equal(body.expectedDate, fact.eventDate); fact.eventDate = body.eventDate; } }
      if (body.action === "pause") state.paused = body.paused;
      if (body.action === "consent") { state.enabled = body.enabled; state.paused = !body.enabled; }
      if (body.action === "wipe") { assert.equal(body.confirm, "DELETE_MY_ARCHIVE"); state.subjects = []; state.facts = []; state.signals = []; state.trends = []; state.self = {}; state.enabled = false; }
      if (body.action === "delete") state.subjects = state.subjects.filter(item => item.id !== body.id);
    }
    result ||= state;
  } else if (url.pathname === "/api/web/relationship-feedback") {
    if (method === "POST") { const card = feedback.cards.find(item => item.reportId === body.reportId); const entry = { ...body, action: card.action, recordedAt: Date.now(), review: "已记录这次真实结果", revisionOf: card.latest?.id || null }; card.latest = entry; card.revisions.push(entry); card.outcomeLabel = "有积极反馈"; card.revisionCount = card.revisions.length; result = { feedback: entry, duplicate: false }; }
    else if (method === "DELETE") { const card = feedback.cards.find(item => item.reportId === body.reportId); card.latest = null; card.revisions = []; card.outcomeLabel = "尚未反馈"; result = { deleted: true }; }
    else result = feedback;
  } else if (url.pathname === "/api/web/avatar") { assert.match(body.avatar, /^data:image\/jpeg;base64,\/9j\//); assert.ok(body.avatar.length <= 48000); assert.equal(body.confirmed, true); (body.target === "self" ? state.self : state.subjects.find(item => item.id === body.subjectId)).avatar = body.avatar; result = { saved: true }; }
  else if (url.pathname === "/api/auth/session") result = { loggedIn: true, user: { id: "fixture-owner", name: "合成档案测试" } };
  else if (url.pathname === "/api/web/session") result = { linked: true, user: "合成档案测试", subjects: state.subjects };
  else if (url.pathname === "/api/account/credits") result = { account: { userId: "fixture-owner", balance: 100, features: ["analysis", "chat", "voice"] }, user: { name: "合成档案测试" } };
  else { await send("Fetch.continueRequest", { requestId: event.requestId }); return; }
  await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: status, responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "cache-control", value: "no-store" }], body: Buffer.from(JSON.stringify(result)).toString("base64") });
}
try {
  let info; for (let index = 0; index < 60; index++) { try { info = (await readFile(join(browserProfile, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/); break; } catch { await delay(100); } }
  if (!info) throw Error("Headless Edge failed to start");
  socket = new WebSocket(`ws://127.0.0.1:${info[0]}${info[1]}`); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", event => { const message = JSON.parse(event.data); if (message.method === "Fetch.requestPaused") void respond(message.params).catch(error => exceptions.push(String(error))); if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); if (message.method === "Page.javascriptDialogOpening") { dialogs.push({ message: message.params.message, accepted: acceptDialog }); void send("Page.handleJavaScriptDialog", { accept: acceptDialog }); acceptDialog = false; } const promise = pendingCalls.get(message.id); if (promise) { clearTimeout(promise.timer); pendingCalls.delete(message.id); message.error ? promise.reject(Error(message.error.message)) : promise.resolve(message.result); } });
  const target = await call("Target.createTarget", { url: "about:blank" }); sessionId = (await call("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
  await send("Page.enable"); await send("Runtime.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: `${base}/api/*`, requestStage: "Request" }] }); await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  await navigate("/person-new"); await visible("没有截图，也能建档。"); await captureWidths("person-new");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(item=>item.textContent.includes('保存并查看')).disabled"), true);
  await field("怎么称呼 TA · 必填", "  新建合成人物  ");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(item=>item.textContent.includes('保存并查看')).disabled"), true, "consent is required");
  await evaluate("document.querySelector('input[type=checkbox]').click()"); await click("保存并查看人物档案 →"); await until("location.pathname==='/archive'", "manual create redirect"); await visible("新建合成人物");
  assert.equal(last("create-manual").label, "新建合成人物"); assert.equal(last("create-manual").confirmed, true); assert.deepEqual(last("create-manual").data, {}); assert.match(last("create-manual").id, /^[a-f0-9-]{36}$/); checks.push("manual creation: required name/consent, optional blank defaults, UUID, redirect");

  await navigate("/archive?tab=self"); await visible("我的基础资料"); await captureWidths("archive-self"); await click("编辑资料"); await field("希望的年龄范围", "28–36"); await field("异地接受程度", "接受周边城市"); await field("想要的关系", "稳定、互相支持的关系"); await click("保存我的资料与偏好"); await visible("我的资料与偏好已更新。");
  assert.equal(last("self").data.preferredAgeRange, "28–36"); assert.equal(last("self").data.distancePreference, "接受周边城市"); assert.equal(last("self").data.preferredRelationship, "稳定、互相支持的关系"); assert.equal(last("self").data.city, "杭州"); assert.equal(last("self").data.weights.values, 4); checks.push("self editor: preferences changed, prior basic fields and weights preserved");

  await navigate(`/archive?subjectId=${personId}`); await visible("这段关系，现在怎么看"); await captureWidths("archive-person"); await click("人物资料"); await visible("待确认 · 31岁"); await click("编辑资料"); await field("职业或学习状态", "产品设计师"); await field("明确表达的边界", "不接受临时约见"); await click("保存人物资料"); await visible("人物资料已更新。"); assert.equal(last("save").occupation, "产品设计师"); assert.equal(last("save").boundaries, "不接受临时约见"); assert.equal(last("save").id, personId); checks.push("person editor: complete basics and boundaries scoped to selected person");
  await click("2 条资料待核对", "summary"); await evaluate("[...document.querySelectorAll('button')].filter(item=>item.textContent.trim()==='确认这条')[1].click()"); await visible("这条资料已确认。"); assert.equal(last("fact-decide").id, factId); assert.equal(last("fact-decide").decision, "accept"); checks.push("fact acceptance: explicit pending fact decision and refreshed accepted evidence");

  await click("更正聊天日期"); await field("聊天日期（未知可清空）", "2026-10-06"); await click("确认保存日期"); await visible("合成断线：日期暂未保存，请重试。"); const firstDate = last("event-date"); await click("确认保存日期"); await visible("已保存。"); assert.equal(last("event-date").requestId, firstDate.requestId, "failed date save retains request UUID"); assert.equal(last("event-date").eventDate, "2026-10-06"); assert.equal(last("event-date").expectedDate, "2026-10-05"); assert.equal(last("event-date").confirmed, true); checks.push("event correction: actual date, previous date guard, confirmed save, retry idempotency");

  await click("关系概览"); await visible("上次建议，后来怎么样？"); await click("记录结果"); await field("实际结果", "positive"); await field("补充一句（选填）", "实际见面聊得很舒服"); await field("实际发生日期（选填）", "2026-10-07"); await click("收起"); await click("记录结果"); assert.equal(await evaluate("[...document.querySelectorAll('textarea')].find(item=>item.value.includes('实际见面'))?.value"), "实际见面聊得很舒服", "feedback draft survives collapse"); await click("确认记下结果"); await visible("已记录这次真实结果");
  const feedbackWrite = writes.filter(item => item.path === "/api/web/relationship-feedback" && item.method === "POST").at(-1).body; assert.equal(feedbackWrite.subjectId, personId); assert.equal(feedbackWrite.reportId, reportId); assert.equal(feedbackWrite.eventDate, "2026-10-07"); assert.equal(feedbackWrite.outcome, "positive"); assert.equal(feedbackWrite.confirmed, true); checks.push("action feedback: draft retention, scoped report, outcome/date/note, revision display");

  await click("更新结果"); await click("还在等回应"); await until("[...document.querySelectorAll('button')].some(item=>item.textContent==='更新结果'&&!item.disabled)&&!document.querySelector('select')", "quick feedback saved");
  const quickWrite = writes.filter(item => item.path === "/api/web/relationship-feedback" && item.method === "POST").at(-1).body; assert.equal(quickWrite.outcome, "waiting"); assert.equal(quickWrite.note, "实际见面聊得很舒服"); assert.equal(quickWrite.eventDate, "2026-10-07");
  await click("反馈历史 · 2 次记录", "summary"); await visible("首次反馈"); await visible("更新反馈"); checks.push("quick feedback: one-tap outcome retains detail draft and complete initial/revision history");
  acceptDialog = true; await click("删除反馈"); await visible("记录结果"); const deletedFeedback = writes.filter(item => item.path === "/api/web/relationship-feedback" && item.method === "DELETE").at(-1).body; assert.equal(deletedFeedback.subjectId, personId); assert.equal(deletedFeedback.reportId, reportId); assert.equal(deletedFeedback.confirmed, true); checks.push("feedback deletion: explicit confirmation removes report-scoped revisions");

  await click("人物资料"); await click("选择 / 更换头像", "summary");
  await evaluate("(()=>{const canvas=document.createElement('canvas');canvas.width=600;canvas.height=300;const context=canvas.getContext('2d');context.fillStyle='#698a55';context.fillRect(0,0,600,300);context.fillStyle='#f7df8a';context.fillRect(150,70,190,160);canvas.toBlob(blob=>{const dt=new DataTransfer();dt.items.add(new File([blob],'synthetic-avatar.png',{type:'image/png'}));const input=document.querySelector('input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));},'image/png');})()");
  await until("[...document.querySelectorAll('button')].some(item=>item.textContent.includes('确认保存为')&&!item.disabled)", "avatar decoded");
  await evaluate("(()=>{const input=document.querySelector('input[type=range]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'20');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await click("确认保存为 TA 的头像"); await until("document.querySelector('img[alt=\"合成人物小林的头像\"]')?.src.startsWith('data:image/jpeg')", "saved avatar");
  const avatar = writes.filter(item => item.path === "/api/web/avatar").at(-1).body; assert.equal(avatar.subjectId, personId); assert.equal(avatar.target, "subject"); assert.match(avatar.avatar, /^data:image\/jpeg;base64,\/9j\//); assert.ok(avatar.avatar.length <= 48000); checks.push("avatar: synthetic upload, crop control, JPEG conversion, confirmed owner-specific save"); await screenshot("person-profile-mobile");

  await click("档案管理与隐私", "summary"); await click("暂停档案"); await visible("档案已暂停"); assert.equal(last("pause").paused, true); assert.equal(await evaluate("[...document.querySelectorAll('button')].find(item=>item.textContent==='编辑资料').disabled"), true); await click("恢复使用"); await visible("档案已恢复。"); assert.equal(last("pause").paused, false); checks.push("pause: edits disabled while paused, explicit resume restores controls");

  const beforeDelete = writes.length; await click("删除人物"); await delay(180); assert.equal(writes.length, beforeDelete, "dismissed person deletion must not mutate"); assert.equal(dialogs.at(-1).accepted, false); checks.push("destructive action: dismissed person delete has no request");
  acceptDialog = true; await click("删除全部档案与报告"); await visible("保存你主动填写和确认的资料"); assert.equal(last("wipe").confirm, "DELETE_MY_ARCHIVE"); assert.equal(dialogs.at(-1).accepted, true); assert.equal(state.subjects.length, 0); checks.push("archive wipe: explicit browser confirmation and bounded deletion token");

  const metric = await evaluate("({width:innerWidth,content:document.documentElement.scrollWidth,text:document.body.innerText})"); assert.ok(metric.content <= metric.width + 1, "no mobile horizontal overflow"); assert.ok(!/lovetalk/i.test(metric.text), "independent product brand"); assert.deepEqual(exceptions, [], "no uncaught browser exceptions");
  await writeFile(`${output}/qa.json`, JSON.stringify({ local: true, synthetic: true, checks, writes: writes.map(item => ({ ...item, body: item.body.avatar ? { ...item.body, avatar: `[JPEG ${item.body.avatar.length} chars]` } : item.body })), dialogs, exceptions }, null, 2)); console.log(`PASS: ${checks.length} archive/person/self/avatar/feedback functional flows, mobile layout, no uncaught exceptions.`);
} catch (error) { await writeFile(`${output}/failure.json`, JSON.stringify({ message: String(error), checks, exceptions, writes }, null, 2)); try { await screenshot("failure"); await writeFile(`${output}/failure.txt`, await evaluate("document.body.innerText")); } catch {} throw error; }
finally { if (socket?.readyState === 1) { try { await call("Browser.close"); } catch {} socket.close(); } edge.kill(); for (const item of pendingCalls.values()) clearTimeout(item.timer); }
