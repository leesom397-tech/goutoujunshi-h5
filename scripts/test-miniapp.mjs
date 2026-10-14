import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadVoiceMemory, validVoiceSubjectId } from "../lib/miniapp-voice-memory.mjs";
const nativeRiskSignals={},nativeRisk={};
new Function("exports",readFileSync("miniapp/lib/relationship-risk.js","utf8"))(nativeRiskSignals);
new Function("exports","require",readFileSync("miniapp/lib/risk-aware-presentation.js","utf8"))(nativeRisk,()=>nativeRiskSignals);

const followupModule = { exports: {} };
new Function("module", "wx", readFileSync(resolve("miniapp/lib/followup-context.js"), "utf8"))(
  followupModule,
  { navigateTo() { assert.fail("report follow-up navigation must be explicitly exercised by its own tests"); } }
);
const followup = followupModule.exports;
const source = readFileSync(resolve("miniapp/pages/quick/index.js"), "utf8");
const localStyleSamples = new Function("require", "Page", "wx", source + "; return styleSamples;")(
  () => ({}), () => {}, {}
);
const localVisibleIntent = new Function("require", "Page", "wx", source + "; return visiblePossibleIntent;")(
  () => ({}), () => {}, {}
);
assert.equal(localVisibleIntent("你周日有空吗？", "未明确", "insufficient"), "可能在向你提问或确认信息");
assert.equal(localVisibleIntent("嗯", "难以判断", "insufficient"), "可能只是在简短回应你，暂看不出更多");
assert.equal(localVisibleIntent("不要联系我", "", "insufficient"), "可能在表达不想继续或需要边界");
const placeholderLines = [
  { speaker: "self", text: '[语音] 4"' },
  { speaker: "self", text: "[图片] 微信图片_虚构.jpg" },
  { speaker: "self", text: "【文件】 test.pdf" },
  { speaker: "other", text: "对方原话不能模仿我的语气。" },
];
assert.deepEqual(localStyleSamples(placeholderLines), { samples: [], eligible: false });
assert.equal(localStyleSamples([...placeholderLines, ...[
  "好呀，周日下午我应该有空，到时候再跟你说具体几点。",
  "行，那我到时候发你消息，看看在哪里碰头比较方便。",
  "想问下你周末有没有空，如果有空我们可以一起看展。"
].map(text => ({ speaker: "self", text }))]).eligible, true);
const markup = readFileSync(resolve("miniapp/pages/quick/index.wxml"), "utf8");
assert.match(markup, /<view wx:if="\{\{!result\.reportId && !busy && !backgroundPending\}\}" class="panel">/, "upload controls must not compete with a report or a pending background task");
assert.match(markup, /<block wx:if="\{\{image\}\}">/, "archive, side and consent controls should appear after selecting a screenshot");
assert.match(markup, /本轮判断/);
assert.match(markup, /互动指标/);
assert.match(markup, /result\.hasInteractionScore/);
assert.match(markup, /result\.interactionScore/);
assert.match(markup, /可能(?:的)?意思/);
assert.match(markup, /<signal-tags[^>]*note="\{\{item\.note\}\}"/,'per-line explanation must be passed to the expandable visual component');
assert.doesNotMatch(markup, /这张图怎么看|沟通作用|这句话代表什么/);
const fixturePrices = { analysisSmall: 20, analysisMedium: 35, analysisLarge: 50, text: 5, profile: 30 };
const validId = "11111111-1111-4111-8111-111111111111";
const sent = [];
let attempts = 0;
let ids = 0;
let networkNext = false;
let polls = 0;
let sessionSubjects = [{ id: "person-one", label: "阿青" }];
const report = {
  id: validId,
  decision: { judgment: "对方给出替代时间", nextStep: "确认周日时间", replyOptions: [
    { style: "闲聊", text: "周日再说吧", reason: "暂不落实", weight: 20 },
    { style: "自然承接", text: "周日下午怎么样？", reason: "确认时间", weight: 90 },
    { style: "轻量确认", text: "你周日有空吗？", reason: "确认日程", weight: 30 },
    { style: "直接邀请", text: "周日一起去吗？", reason: "落实活动", weight: 80 }
  ] },
  lines: [{ id: "line-one", speaker: "other", text: "周日倒是有空。" }],
  annotations: [{ lineId: "line-one", emotion: [{ label: "平静", probability: 0.8 }], intent: [{ label: "提供替代安排", probability: 0.9 }], note: "对方提供了另一个可行时间，至少愿意继续讨论安排。" }]
};
const api = {
  STORAGE: "lovetalk_mini_session_v1",
  async session() {
    return { token: "test-token", state: { subjects: sessionSubjects, screenshot: { enabled: false, selfSide: "ask" } } };
  },
  async request(path, method, body, token) {
    if (path === "/api/miniapp/credits") { assert.equal(method, "GET"); return { prices: fixturePrices }; }
    assert.equal(method, "POST");
    assert.equal(token, "test-token");
    sent.push({ path, body });
    if (path.endsWith("/link-ticket")) return { ticket: "a".repeat(64) };
    if (path.endsWith("/settings")) return { ok: true };
    if (path.endsWith("/screenshot")) {
      if (networkNext) { networkNext = false; throw Object.assign(new Error("timeout"), { network: true }); }
      if (++attempts === 1) throw new Error("临时断网");
      return report;
    }
    if (path.endsWith("/rewrite")) return { text: "周日下午见面行吗？", status: "adjusted", note: "已按本轮原话调整。" };
    throw new Error("unexpected route");
  },
  async newId() { ids++; return ids === 1 ? validId : "22222222-2222-4222-8222-222222222222"; },
  async waitForScreenshot(requestId, token) { assert.equal(token, "test-token"); assert.match(requestId, /^[a-f0-9-]{36}$/); polls++; return report; },
};
const navigation = [];
const wx = {
  chooseMedia(options) { options.success({ tempFiles: [{ tempFilePath: "/fake/chat.png", size: 1024 }] }); },
  getImageInfo(options) { options.success({ type: "png" }); },
  getFileSystemManager() { return { readFile(options) { options.success({ data: "aGVsbG8=" }); } }; },
  navigateTo(options) { navigation.push(options.url); },
  removeStorageSync() {},
  showModal(options) { options.success({ confirm: true }); },
};
let definition;
new Function("require", "Page", "wx", source)(
  id => { if(id==="../../lib/risk-aware-presentation")return nativeRisk; if (id === "../../lib/followup-context") return followup; assert.equal(id, "../../lib/api"); return api; },
  value => { definition = value; },
  wx
);
const page = {
  ...definition,
  data: structuredClone(definition.data),
  setData(next) { Object.assign(this.data, next); }
};
await page.refresh();
assert.equal(page.data.phase, "ready");
assert.equal(page.data.people[1].label, "阿青");
page.setData({ newPersonOpen: true, newPersonName: "旧对象", newPersonConsent: true });
page.choose();
await new Promise(resolve => setImmediate(resolve));
assert.equal(page.data.image, "/fake/chat.png");
assert.equal(page.data.newPersonOpen, false, "selecting another screenshot must close a stale new-person form");
assert.equal(page.data.newPersonName, "");
assert.equal(page.data.newPersonConsent, false);
assert.equal(page.data.side, "ask", "a new screenshot must not assume who is on the right");
assert.equal(page.data.archivePrompt, true, "selecting a screenshot should offer an optional person archive");
page.agree({ detail: { value: ["yes"] } });
page.personChange({ detail: { value: "1" } });
assert.equal(page.data.archivePrompt, false, "choosing an existing person dismisses the prompt");
page.choose();
await new Promise(resolve => setImmediate(resolve));
assert.equal(page.data.personIndex, 0, "a new screenshot must not silently inherit the previous person's archive");
assert.equal(page.data.archivePrompt, true, "a new screenshot must offer its own archive choice");
page.personChange({ detail: { value: "1" } });
await page.analyze();
assert.match(page.data.error, /哪侧气泡是你/);
assert.equal(sent.length, 0, "no image may be sent before the user identifies their side");
page.sideChange({ detail: { value: "1" } });
page.agree({ detail: { value: ["yes"] } });
await page.analyze();
assert.match(page.data.error, /临时断网/);
assert.ok(page.data.lastElapsedSeconds >= 1, "failed analyses retain a user-visible end-to-end duration");
assert.equal(page._elapsedTimer, null, "a failed analysis must clear its timer");
assert.equal(sent[0].path, "/api/miniapp/settings");
assert.equal(sent[1].body.subjectId, "person-one");
assert.equal(sent[1].body.image, "data:image/png;base64,aGVsbG8=");
const firstRequestId = sent[1].body.requestId;
await page.analyze();
assert.equal(sent[2].path, "/api/miniapp/screenshot");
assert.equal(sent[2].body.requestId, firstRequestId, "a network retry must be idempotent");
assert.equal(page.data.result.lines.length, 1);
assert.deepEqual(page.data.result.lines.map(item => item.lineNumber), [1], "line numbers should be computed before WXML renders them");
assert.equal(page.data.result.linesToggleLabel, "查看逐句解读 · 1 句");
assert.ok(page.data.result.durationSeconds >= 1, "successful analyses expose the total wait on this device");
assert.equal(page._elapsedTimer, null, "a successful analysis must clear its timer");
assert.equal(page.data.result.interactionScore, null, "missing score must not invent a numeric baseline");
assert.equal(page.data.result.hasInteractionScore, false);
assert.equal(page.data.result.interactionScoreLabel, "本轮可核对互动 · 1 句");
assert.match(page.data.result.lines[0].intents, /提供替代安排 90%/);
assert.equal(page.data.result.replies[0].text, "周日下午怎么样？");
assert.deepEqual(page.data.result.replies.map(item => item.rankLabel), ["本轮首选", "备选 2", "备选 3"]);
assert.equal(page.data.result.hasReplies, true, "screenshot reply visibility must be explicit for WXML");
assert.deepEqual(page.data.result.replies.map(item => item.weight), [90, 80, 30]);
page.report();
assert.equal(navigation[0], "/pages/report/index?id=" + validId);
page.setData({ result: { ...page.data.result, reportId: "-".repeat(36) } });
page.report();
assert.equal(navigation.length, 1, "malformed report IDs cannot open a report page");
sessionSubjects = [{ id: "person-two", label: "另一人" }, { id: "person-one", label: "阿青" }];
await page.refresh();
assert.equal(page.data.personIndex, 2, "a changed list order must preserve the selected person by ID");
assert.equal(page.data.people[page.data.personIndex].id, "person-one");
page.setData({ agreed: true });
page._requestId = validId;
page._sessionId = validId;
sessionSubjects = [{ id: "person-two", label: "另一人" }];
await page.refresh();
assert.equal(page.data.personIndex, 0, "a deleted person must not silently become another person");
assert.equal(page.data.result.reportId, "");
assert.equal(page.data.agreed, false);
assert.equal(page._requestId, null);
assert.equal(page._sessionId, null);
assert.match(page.data.error, /重新确认/);
sessionSubjects = [{ id: "person-one", label: "阿青" }];
await page.refresh();
page.personChange({ detail: { value: "1" } });
page.setData({ busy: true });
page.personChange({ detail: { value: "0" } });
assert.equal(page.data.personIndex, 1, "the subject cannot change while an analysis is running");
page.setData({ busy: false });
const multiQuickRequests = [];
let multiQuickIds = 0;
const multiQuickApi = {
  ...api,
  async newId() { multiQuickIds++; return `${String(multiQuickIds).padStart(8, "0")}-1111-4111-8111-111111111111`; },
  async request(path, method, body) {
    if (path === "/api/miniapp/credits") { assert.equal(method, "GET"); return { prices: fixturePrices }; }
    multiQuickRequests.push({ path, method, body });
    if (path.endsWith("/settings")) return { ok: true };
    if (path.endsWith("/screenshot")) return report;
    throw new Error("unexpected multi-image route");
  }
};
let multiQuickDefinition;
new Function("require", "Page", "wx", source)(
  id => id === "../../lib/risk-aware-presentation" ? nativeRisk : id === "../../lib/followup-context" ? followup : multiQuickApi, value => { multiQuickDefinition = value; }, wx
);
const multiQuickPage = { ...multiQuickDefinition, data: structuredClone(multiQuickDefinition.data), setData(next) { Object.assign(this.data, next); } };
await multiQuickPage.refresh();
const orderedImages = [{ path: "/fake/newer.png", type: "png", order: 1 }, { path: "/fake/older.png", type: "png", order: 2 }];
multiQuickPage.setData({ image: orderedImages[0].path, imageType: "png", images: orderedImages, imageCount: 2 });
multiQuickPage.moveImage({ currentTarget: { dataset: { index: 1, step: -1 } } });
assert.deepEqual(multiQuickPage.data.images.map(item => item.path), ["/fake/older.png", "/fake/newer.png"], "users can correct screenshot chronology before analysis");
multiQuickPage.sideChange({ detail: { value: "1" } });
multiQuickPage.agree({ detail: { value: ["yes"] } });
await multiQuickPage.analyze();
const screenshotCalls = multiQuickRequests.filter(item => item.path.endsWith("/screenshot"));
assert.equal(screenshotCalls.length, 2, "two chat screenshots are analyzed sequentially");
assert.notEqual(screenshotCalls[0].body.requestId, screenshotCalls[1].body.requestId, "each screenshot has its own idempotency key");
assert.equal(screenshotCalls[0].body.sessionId, screenshotCalls[1].body.sessionId, "a batch shares one temporary conversation context");
assert.deepEqual(multiQuickPage.data.result.lines.map(item => item.screenshotNumber), [1, 2], "line display retains screenshot chronology");
assert.equal(new Set(multiQuickPage.data.result.lines.map(item => item.id)).size, 2, "repeated line IDs from separate reports need unique WXML keys");
let interruptedCalls = 0;
const interruptedIds = [];
multiQuickApi.request = async (path, method, body) => {
    if (path === "/api/miniapp/credits") { assert.equal(method, "GET"); return { prices: fixturePrices }; }
  if (path.endsWith("/settings")) return { ok: true };
  if (path.endsWith("/screenshot")) {
    interruptedCalls++;
    interruptedIds.push(body.requestId);
    if (interruptedCalls === 2) throw new Error("第二张暂时失败");
    return report;
  }
  throw new Error("unexpected interrupted route");
};
const interruptedPage = { ...multiQuickDefinition, data: structuredClone(multiQuickDefinition.data), setData(next) { Object.assign(this.data, next); } };
await interruptedPage.refresh();
interruptedPage.setData({ image: "/fake/older.png", imageType: "png", images: [{ path: "/fake/older.png", type: "png", order: 1 }, { path: "/fake/newer.png", type: "png", order: 2 }], imageCount: 2 });
interruptedPage.sideChange({ detail: { value: "1" } });
interruptedPage.agree({ detail: { value: ["yes"] } });
await interruptedPage.analyze();
assert.equal(interruptedPage._batchResults.entries.length, 1, "successful earlier screenshots survive a later failure");
assert.equal(interruptedCalls, 2);
await interruptedPage.analyze();
assert.equal(interruptedCalls, 3, "retry should resume at failed screenshot, not reprocess the first");
assert.equal(interruptedIds[1], interruptedIds[2], "failed screenshot retains its idempotency key across retries");
assert.equal(interruptedPage.data.result.lines.length, 2);
const nativeReportSource = readFileSync(resolve("miniapp/pages/report/index.js"), "utf8");
let nativeReportDefinition;
new Function("require", "Page", "wx", nativeReportSource)(
  id => { if(id==="../../lib/risk-aware-presentation")return nativeRisk; if (id === "../../lib/followup-context") return followup; assert.equal(id, "../../lib/api"); return {
    STORAGE: api.STORAGE,
    session: api.session,
    async request(path, method, body, token) {
    if (path === "/api/miniapp/credits") { assert.equal(method, "GET"); return { prices: fixturePrices }; }
      assert.equal(path, "/api/miniapp/report?id=" + validId);
      assert.equal(method, "GET");
      assert.equal(token, "test-token");
      return { report };
    }
  }; },
  value => { nativeReportDefinition = value; }, {...wx,getStorageSync:()=>({token:'test-token',expiresAt:Date.now()+60000})}
);
const nativeReportPage = { ...nativeReportDefinition, data: structuredClone(nativeReportDefinition.data), setData(next) { Object.assign(this.data, next); } };
nativeReportPage._id = validId;
await nativeReportPage.refresh();
assert.equal(nativeReportPage.data.phase, "ready");
assert.deepEqual(nativeReportPage.data.report.lines.map(item => item.lineNumber), [1]);
assert.equal(nativeReportPage.data.report.linesLabel, "逐句解读 · 1 句");
assert.equal(nativeReportPage.data.report.affinity, null, "missing consented signal cannot become an invented six-dimensional score");
assert.deepEqual(nativeReportPage.data.report.replies.map(item => item.weight), [90, 80, 30]);
assert.deepEqual(nativeReportPage.data.report.replies.map(item => item.rankLabel), ["本轮首选", "备选 2", "备选 3"]);
assert.equal(nativeReportPage.data.report.hasReplies, true, "report reply visibility must be explicit for WXML");
report.affinity = { value: null, valueScope: "partial", contextCount: 5, dimensions: [{ key: "boundary", label: "边界", value: null }, { key: "investment", label: "投入", value: 0 }] };
await nativeReportPage.refresh();
assert.equal(nativeReportPage.data.report.affinity.scoreLabel, "总分待验证");
assert.deepEqual(nativeReportPage.data.report.affinity.dimensions.map(item => item.displayValue), ["待验证", "0"], "a genuine zero is not an unverified dimension");
assert.deepEqual(nativeReportPage.data.report.affinity.dimensions.map(item => item.width), [0, 0]);
assert.equal(nativeReportPage.data.report.affinity.radarReady, false, "partial dimensions must not render a misleading zero-filled radar");
report.affinity.value = 0;
await nativeReportPage.refresh();
assert.equal(nativeReportPage.data.report.affinity.scoreLabel, "已知维度参考指数 0/100");
report.affinity.dimensions = Array.from({ length: 6 }, (_, index) => ({ key: String(index), label: `维度${index + 1}`, value: index * 20 }));
await nativeReportPage.refresh();
assert.equal(nativeReportPage.data.report.affinity.radarReady, true, "radar requires all six real dimension values");
delete report.affinity;
nativeReportPage.toggleReply({ currentTarget: { dataset: { index: 0 } } });
assert.equal(nativeReportPage.data.report.replies[0].expanded, true);
nativeReportPage._id = "-".repeat(36);
await nativeReportPage.refresh();
assert.equal(nativeReportPage.data.phase, "error");
const webSource = readFileSync(resolve("miniapp/pages/web/index.js"), "utf8");
let webDefinition;
const titles = [];
new Function("Page", "wx", webSource)(
  value => { webDefinition = value; },
  { setNavigationBarTitle(value) { titles.push(value.title); } }
);
const webPage = { ...webDefinition, data: structuredClone(webDefinition.data), setData(next) { Object.assign(this.data, next); } };
webPage.onLoad({ entry: "report", id: validId });
assert.equal(webPage.data.src, "https://coach.lovetalk.love/crush?id=" + validId);
webPage.onLoad({ entry: "__proto__", id: "-".repeat(36) });
assert.equal(webPage.data.src, "https://coach.lovetalk.love/quick", "inherited property names cannot become routes");
assert.equal(titles.at(-1), "截图快判");
webPage.onLoad({ entry: "report", id: "-".repeat(36) });
assert.equal(webPage.data.src, "https://coach.lovetalk.love/crush", "malformed report IDs cannot be forwarded");
page._requestId = validId;
page._sessionId = validId;
page.sideChange({ detail: { value: "2" } });
assert.equal(page.data.side, "left");
assert.equal(page.data.result.reportId, "", "changing speaker side must clear the prior result");
assert.equal(page.data.result.interactionScore, null, "changing speaker side must clear the prior score");
assert.equal(page.data.agreed, false);
assert.equal(page._requestId, null, "changing speaker side must invalidate the prior request ID");
assert.equal(page._sessionId, null, "changing speaker side must start a fresh temporary context");
page.reset();
assert.equal(page.data.result.reportId, "");
assert.equal(page.data.image, "");
page.choose();
await new Promise(resolve => setImmediate(resolve));
assert.equal(page._sessionId, null, "choosing a new image must not reuse a prior temporary context");
assert.equal(page.data.side, "ask");
page.sideChange({ detail: { value: "2" } });
page.agree({ detail: { value: ["yes"] } });
report.decision.affinityPreview = { value: 72 };
networkNext = true;
await page.analyze();
assert.equal(polls, 1, "network timeout must recover the saved report by status lookup");
assert.equal(page.data.result.reportId, validId);
assert.equal(page.data.result.interactionScore, 72, "only an actual provided score may be displayed");
assert.equal(page.data.result.hasInteractionScore, true);
assert.equal(page.data.result.interactionScoreLabel, "综合互动参考 · 72/100");
assert.equal(page.data.progress, "");
assert.ok(page.data.result.durationSeconds >= 1);
assert.match(readFileSync(resolve("miniapp/pages/quick/index.wxml"), "utf8"), /已等待 \{\{elapsedSeconds\}\} 秒/);
page.setData({ result: { ...page.data.result, canPersonalize: true } });
await page.personalize({ currentTarget: { dataset: { index: 0 } } });
assert.equal(sent.at(-1).path, "/api/miniapp/rewrite");
assert.deepEqual(sent.at(-1).body, { reportId: validId, optionIndex: 1, styleReportIds: page.data.result.styleReportIds, confirmed: true, requestId: '22222222-2222-4222-8222-222222222222' });
assert.equal(page.data.result.replies[0].personalizedText, "周日下午见面行吗？");
assert.doesNotMatch(readFileSync(resolve("miniapp/pages/quick/index.wxml"), "utf8"), /关联已有账号/);

const homeSource = readFileSync(resolve("miniapp/pages/home/index.js"), "utf8");
let homeDefinition;
const homeApi = {
  async session() { return { token: "test-token", state: {} }; }
};
new Function("require", "Page", "wx", homeSource)(
  id => id === "../../lib/api" ? homeApi : id === "../../lib/knowledge-stats" ? requireKnowledgeStats() : assert.fail("unexpected home module: " + id),
  value => { homeDefinition = value; }, wx
);
function requireKnowledgeStats() {
  const source = readFileSync(resolve("miniapp/lib/knowledge-stats.js"), "utf8");
  const output = { exports: {} };
  new Function("module", source)(output);
  return output.exports;
}
const homePage = { ...homeDefinition, data: structuredClone(homeDefinition.data), setData(next) { Object.assign(this.data, next); } };
await homePage.onShow();
assert.equal(homePage.data.loginState, "ready", "WeChat identity should connect without a button tap");
const homeMarkup = readFileSync(resolve("miniapp/pages/home/index.wxml"), "utf8");
assert.doesNotMatch(homeMarkup, /open-type="getPhoneNumber"/, "phone authorization must not be mistaken for required login");
assert.match(homeMarkup, /data-entry="quick"[^>]*bindtap="open"[^>]*>[\s\S]*?分析聊天截图/);
assert.match(homeMarkup, /data-entry="social-profile"[^>]*bindtap="open"[^>]*>[\s\S]*?分析社交资料/);
assert.equal((homeMarkup.match(/data-entry="social-profile"/g) || []).length, 1, "social-profile must have one home entry");
assert.doesNotMatch(homeMarkup, /NEW|action-index|单张 5 MB|单张 12 MB|不是 46 本书/, "home must not display upload limits or maintainer copy");
assert.match(homeMarkup, /结合聊天原话与已确认档案/);
assert.match(homeMarkup, /assets\/chengzi-orbit\.png/, "home must use the approved shared Orbit logo");
assert.match(homeMarkup, /assets\/relationship-daylight\.jpg/, "home must reference the original glass relationship artwork");
const homeArt = readFileSync(resolve("miniapp/assets/relationship-daylight.jpg"));
assert.equal(homeArt.subarray(0, 3).toString("hex"), "ffd8ff", "hero artwork must be a portable JPEG in the miniapp package");
assert.ok(homeArt.length < 250000, "hero artwork must remain small enough for the miniapp package");
const homeLogo = readFileSync(resolve("miniapp/assets/chengzi-orbit.png"));
assert.equal(homeLogo.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "new home logo must be a PNG");
assert.ok(homeLogo.length < 100000, "new home logo must be optimized for the miniapp package");
const archiveArt = readFileSync(resolve("miniapp/assets/profile-cards.png"));
assert.equal(archiveArt.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "archive artwork must be a PNG");
assert.match(homeMarkup, /assets\/ui-orbit\.png/, "home relationship card uses the same line icon system");
const homeStyles = readFileSync(resolve("miniapp/pages/home/index.wxss"), "utf8");
assert.match(homeStyles, /@keyframes home-appear/, "home entrance motion must be included in the native page");
homePage.toggleMotion();
assert.equal(homePage.data.motionPlaying, false, "decorative motion can be paused");
homePage.onHide();
assert.equal(homePage.data.motionVisible, false, "background pages pause decorative motion");
const knowledgeManifest = JSON.parse(readFileSync(resolve("lib/knowledge-manifest.generated.json"), "utf8"));
const publicHanCharacters = knowledgeManifest.documents.filter(item => item.category !== "core").reduce((total, item) => total + item.hanCharacters, 0);
assert.equal(homePage.data.knowledgeSources, knowledgeManifest.referenceDocuments, "home must show the generated count of public topic notes");
assert.equal(homePage.data.knowledgeWan, (publicHanCharacters / 10000).toFixed(1), "home must show the generated public Han character count");
assert.match(homeMarkup, /\{\{knowledgeWan\}\}[\s\S]*?万字[\s\S]*?系统整理的情感与关系知识[\s\S]*?\{\{knowledgeSources\}\}[\s\S]*?份主题指南/, "knowledge figures need a prominent and accurate label");
assert.match(homeMarkup, /长期关系跟踪/, "home should explain continuity without claiming a different model");
assert.doesNotMatch(homeMarkup, /通用 AI/, "home should not position its own model as an opponent");
assert.match(homeMarkup, /assets\/ui-book\.png/, "knowledge section uses the shared line icon system");
assert.match(homeMarkup, /查看知识库内容与来源/, "source examples should be available on demand");
assert.doesNotMatch(homeMarkup, /46本书|46份文献/, "topic notes must not be misrepresented as books or papers");
homePage.toggleSources();
assert.equal(homePage.data.showSources, true, "source examples should expand when requested");
homeDefinition.open({ currentTarget: { dataset: { entry: "archive" } } });
assert.equal(navigation.at(-1), "/pages/archive/index", "WeChat-only users must not need a web login to open the archive");
homeDefinition.open({ currentTarget: { dataset: { entry: "social-profile" } } });
assert.equal(navigation.at(-1), "/pages/social-profile/index", "profile screenshot analysis must have its own native page");
const socialSource = readFileSync(resolve("miniapp/pages/social-profile/index.js"), "utf8");
const socialRequests = [];
let socialDefinition;
new Function("require", "Page", "wx", socialSource)(
  id => id === "../../lib/risk-aware-presentation" ? nativeRisk : ({ async session() { return { token: "test-token" }; }, async request(path, method, body) {
    if (path === "/api/miniapp/credits") { assert.equal(method, "GET"); return { prices: fixturePrices }; }
    socialRequests.push({ path, method, body });
    if (path.endsWith("/social-profile")) return { kind: "profile", summary: "仅有自述资料", visibleFacts: [{ title: "兴趣", evidence: "第1张图", meaning: "自述" }], positives: [], cautions: [], hypotheses: [{ title: "重视兴趣", evidence: "第1张图", possibility: "可能重视共同话题", alternative: "也可能只是随手填写", verify: "聊聊真实体验" }], unknowns: ["实际相处"], questions: [] };
    if (method === "GET") return { enabled: false, subjects: [] };
    if (body.action === "consent") return { enabled: true, subjects: [] };
    if (body.action === "create") return { enabled: true, subjects: [{ id: validId, label: body.label }] };
    if (body.action === "import-social") return { enabled: true, subjects: [{ id: validId, label: "阿青" }] };
    throw new Error("unexpected social route");
  } }),
  value => { socialDefinition = value; }, wx
);
const socialPage = { ...socialDefinition, data: structuredClone(socialDefinition.data), setData(next) { Object.assign(this.data, next); } };
await socialPage.onShow();
socialPage.choose();
await new Promise(resolve => setTimeout(resolve, 0));
await socialPage.analyze();
assert.equal(socialRequests.length, 0, "profile image must not upload without per-image confirmation");
socialPage.agree({ detail: { value: ["yes"] } });
await socialPage.analyze();
assert.equal(socialRequests[0].path, "/api/miniapp/social-profile");
assert.equal(socialRequests[0].body.confirmed, true);
assert.equal(socialPage.data.result.hasHypotheses, true, "testable profile hypotheses must have their own section");
assert.deepEqual(socialPage.data.result.chart.map(item => item.count), [1, 0, 0, 1], "profile chart counts evidence categories rather than inventing ratings");
assert.equal(socialRequests.length, 1, "analysis must not create an archive automatically");
socialPage.labelInput({ detail: { value: "阿青" } });
await socialPage.createArchive();
assert.equal(socialRequests.length, 1, "archive must require separate consent");
socialPage.archiveAgree({ detail: { value: ["yes"] } });
await socialPage.createArchive();
assert.equal(socialRequests.at(-1).body.label, "阿青");
const togetherPage = { ...socialDefinition, data: structuredClone(socialDefinition.data), setData(next) { Object.assign(this.data, next); } };
await togetherPage.onShow();
togetherPage.setData({ result: { kind: "profile", visibleFacts: [{ title: "喜欢徒步", evidence: "第 1 张图写着徒步" }] } });
togetherPage.labelInput({ detail: { value: "阿青" } });
togetherPage.archiveAgree({ detail: { value: ["yes"] } });
togetherPage.archiveTogetherChange({ detail: { value: ["yes"] } });
await togetherPage.createArchive();
assert.equal(socialRequests.at(-1).body.action, "import-social", "simultaneous create-and-archive must import visible clues");
assert.equal(socialRequests.at(-1).body.subjectId, validId, "clues must belong to the newly created person");
assert.equal(togetherPage.data.people[togetherPage.data.personIndex].id, validId);
const selfImportRequests = [];
let selfImportDefinition;
new Function("require", "Page", "wx", socialSource)(
  id => id === "../../lib/risk-aware-presentation" ? nativeRisk : ({ async session() { return { token: "test-token", state: { subjects: [] } }; }, async request(path, method, body) {
    if (path === "/api/miniapp/credits") { assert.equal(method, "GET"); return { prices: fixturePrices }; }
    selfImportRequests.push({ path, method, body });
    if (method === "GET") return { enabled: false, paused: false, subjects: [] };
    if (body.action === "consent") return { enabled: true, paused: false, subjects: [] };
    if (body.action === "import-social") return { enabled: true, paused: false, subjects: [], facts: [] };
    throw new Error("unexpected self import request");
  } }),
  value => { selfImportDefinition = value; }, wx
);
const selfImportPage = { ...selfImportDefinition, data: structuredClone(selfImportDefinition.data), setData(next) { Object.assign(this.data, next); } };
selfImportPage.onLoad({ target: "self" });
await selfImportPage.onShow();
selfImportPage.setData({ result: { kind: "profile", visibleFacts: [{ title: "喜欢徒步", evidence: "第 1 张图写着徒步", meaning: "自述" }], profileBasics: [{ field: "city", value: "上海", evidence: "第 1 张图写着上海" }] } });
await selfImportPage.saveClues();
assert.equal(selfImportRequests.length, 0, "self archive still needs a separate explicit consent");
selfImportPage.archiveAgree({ detail: { value: ["yes"] } });
await selfImportPage.saveClues();
assert.deepEqual(selfImportRequests.map(item => item.body?.action || "GET"), ["GET", "consent", "import-social"], "consented self screenshot creates a self archive before importing clues");
assert.deepEqual(selfImportRequests.at(-1).body.basics, [{ field: "city", value: "上海", evidence: "第 1 张图写着上海" }]);
assert.deepEqual(selfImportRequests.at(-1).body.candidates, [{ title: "喜欢徒步", evidence: "第 1 张图写着徒步" }], "model interpretations must not be stored as confirmed facts");
assert.match(selfImportPage.data.archiveMessage, /已建立我的档案/);
assert.match(readFileSync(resolve("miniapp/pages/social-profile/index.wxml"), "utf8"), /基础信息和截图线索待逐条确认/);
let multiDefinition;
new Function("require", "Page", "wx", socialSource)(
  id => id === "../../lib/risk-aware-presentation" ? nativeRisk : ({ async session() { return { token: "test-token" }; }, async request(path, method, body) {
    if (path === "/api/miniapp/credits") { assert.equal(method, "GET"); return { prices: fixturePrices }; } socialRequests.push({ path, method, body }); return { summary: "两张资料已整理", visibleFacts: [], positives: [], cautions: [], unknowns: [], questions: [], nextMaterials: [] }; } }),
  value => { multiDefinition = value; },
  { ...wx,
    chooseMedia(options) { assert.equal(options.count, 9, "social profile picker should allow one batch of nine"); options.success({ tempFiles: Array.from({ length: 9 }, (_, index) => ({ tempFilePath: `/fake/large-${index}.png`, size: 12000000 })) }); },
    compressImage(options) { options.success({ tempFilePath: options.src + ".optimized" }); },
    getFileInfo(options) { options.success({ size: 1000000 }); },
    getFileSystemManager() { return { readFile(options) { options.success({ data: Buffer.from(options.filePath).toString("base64") }); } }; }
  }
);
const multiPage = { ...multiDefinition, data: structuredClone(multiDefinition.data), setData(next) { Object.assign(this.data, next); } };
await multiPage.onShow();
multiPage.choose();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(multiPage.data.imageCount, 9, "nine 12 MB originals must remain selectable after each compresses to 1 MB");
assert.equal(multiPage.data.images.reduce((total, item) => total + item.originalSize, 0), 108000000, "original size must still be checked separately per image");
assert.ok(multiPage.data.images.every(item => item.size <= 1500000), "large source images must be optimized before wx.request");
multiPage.agree({ detail: { value: ["yes"] } });
await multiPage.analyze();
const nineImageRequest = socialRequests.at(-1).body;
assert.equal(nineImageRequest.images.length, 9, "all nine images must be sent in a single analysis request");
assert.deepEqual(nineImageRequest.images.map(image => Buffer.from(image.split(",")[1], "base64").toString()), Array.from({ length: 9 }, (_, index) => `/fake/large-${index}.png.optimized`), "image order must match the picker order");
await assert.rejects(multiPage.prepareImage({ tempFilePath: "/fake/too-large.png", size: 12000001 }), /超过 12 MB/, "an individual original over 12 MB must still be rejected");
let oversizedPixelCompression;
let highPixelDefinition;
new Function("require", "Page", "wx", socialSource)(
  id => id === "../../lib/risk-aware-presentation" ? nativeRisk : ({ async session() { return { token: "test-token" }; } }),
  value => { highPixelDefinition = value; },
  { ...wx,
    getImageInfo(options) { options.success(options.src.endsWith(".optimized") ? { type: "png", width: 1200, height: 2600 } : { type: "png", width: 1000, height: 18000 }); },
    getFileInfo(options) { options.success({ size: 900000 }); },
    compressImage(options) { oversizedPixelCompression = options; options.success({ tempFilePath: options.src + ".optimized" }); }
  }
);
const highPixelPage = { ...highPixelDefinition, data: structuredClone(highPixelDefinition.data), setData(next) { Object.assign(this.data, next); } };
const highPixelImage = await highPixelPage.prepareImage({ tempFilePath: "/fake/tall-profile.png", size: 900000 });
assert.equal(oversizedPixelCompression.compressedHeight, 2600, "small-byte but oversized portrait images must be reduced by their long edge");
assert.equal(highPixelImage.size, 900000, "pixel reduction must preserve an otherwise valid image upload");
multiPage.agree({ detail: { value: ["yes"] } });
await multiPage.analyze();
assert.equal(socialRequests.at(-1).body.images.length, 9, "all nine compressed screenshots must be sent in one consented analysis request");
const batchRequests = [];
const denseProfileResult = {
  kind: "profile", summary: "资料待核实", coverage: "中".repeat(200), note: "中".repeat(200),
  visibleFacts: Array.from({ length: 8 }, () => ({ title: "中".repeat(32), evidence: "中".repeat(180), meaning: "中".repeat(180) })),
  positives: Array.from({ length: 3 }, () => ({ title: "中".repeat(32), evidence: "中".repeat(180), meaning: "中".repeat(180) })),
  cautions: Array.from({ length: 3 }, () => ({ title: "中".repeat(32), evidence: "中".repeat(180), meaning: "中".repeat(180) })),
  hypotheses: Array.from({ length: 3 }, () => ({ title: "中".repeat(40), evidence: "中".repeat(180), possibility: "中".repeat(220), alternative: "中".repeat(180), verify: "中".repeat(160) })),
  riskSignals: Array.from({ length: 3 }, () => ({ category: "中".repeat(32), evidence: "中".repeat(160), check: "中".repeat(150), level: "留意" })),
  fit: Array.from({ length: 4 }, () => ({ dimension: "中".repeat(24), selfNeed: "中".repeat(110), evidence: "中".repeat(150), reading: "中".repeat(130), status: "有线索" })),
  profileBasics: ["ageRange", "city", "education", "occupation", "relationshipStatus", "childrenPlan", "lifestyle"].map(field => ({ field, value: "中".repeat(90), evidence: "中".repeat(150) })),
  unknowns: Array.from({ length: 5 }, () => "中".repeat(90)), questions: Array.from({ length: 3 }, () => "中".repeat(120)), nextMaterials: Array.from({ length: 4 }, () => "中".repeat(100))
};
assert.ok(JSON.stringify(denseProfileResult).length > 12000, "dense first-batch reports must exercise the server's previous-result size boundary");
let batchChoices = 0;
let batchDefinition;
new Function("require", "Page", "wx", socialSource)(
  id => id === "../../lib/risk-aware-presentation" ? nativeRisk : ({ async session() { return { token: "test-token" }; }, async request(path, method, body) {
    if (path === "/api/miniapp/credits") { assert.equal(method, "GET"); return { prices: fixturePrices }; }
    batchRequests.push(body);
    return batchRequests.length === 1 ? denseProfileResult : { kind: "profile", summary: "资料待核实", visibleFacts: [], positives: [], cautions: [], unknowns: [], questions: [] };
  } }),
  value => { batchDefinition = value; },
  { ...wx, chooseMedia(options) {
    batchChoices++;
    options.success({ tempFiles: Array.from({ length: 4 }, (_, index) => ({ tempFilePath: `/fake/batch-${batchChoices}-${index}.png`, size: 1000000 })) });
  } }
);
const batchPage = { ...batchDefinition, data: structuredClone(batchDefinition.data), setData(next) { Object.assign(this.data, next); } };
await batchPage.onShow();
batchPage.choose();
await new Promise(resolve => setTimeout(resolve, 0));
batchPage.compareChange({ detail: { value: ["yes"] } });
batchPage.agree({ detail: { value: ["yes"] } });
await batchPage.analyze();
assert.equal(batchPage.data.totalCount, 4);
assert.equal(batchPage.data.canContinue, true);
batchPage.nextBatch();
assert.equal(batchPage.data.completedCount, 4);
assert.equal(batchPage.data.agreed, false, "the next batch needs fresh upload consent");
batchPage.choose();
await new Promise(resolve => setTimeout(resolve, 0));
batchPage.agree({ detail: { value: ["yes"] } });
await batchPage.analyze();
assert.equal(batchRequests[1].images.length, 4);
assert.equal(batchRequests[1].previousCount, 4);
assert.equal(batchRequests[1].previous.summary, "资料待核实");
assert.ok(JSON.stringify(batchRequests[1].previous).length <= 12000, "second batch must send an excerpt below the server limit, even after a dense report");
assert.equal(batchRequests[1].previous.riskSignals.length, 2, "prior evidenced warnings should remain available to the cumulative analysis");
assert.equal(batchRequests[1].previous.fit.length, 2, "prior self-fit clues should remain available to the cumulative analysis");
assert.equal(batchRequests[1].previous.coverage, undefined, "presentation-only fields must not be sent back as context");
assert.equal(batchPage.data.totalCount, 8, "four plus four screenshots must form one cumulative analysis");
assert.equal(batchPage.data.canContinue, true, "the ninth screenshot remains available as a final batch slot");
batchPage.data.busy = true;
batchPage.targetChange({ currentTarget: { dataset: { target: "self" } } });
assert.equal(batchPage.data.targetSelf, false, "target identity cannot change while an analysis is in flight");
batchPage.data.busy = false;
batchPage.data.people = [{ id: "", label: "暂不归档" }, { id: validId, label: "另一位对象" }];
batchPage.personChange({ detail: { value: "1" } });
assert.equal(batchPage.data.totalCount, 0, "switching people must never merge two people's screenshot batches");
assert.equal(batchPage.data.result, null);
assert.equal(batchPage._previousResult, null);
const privacyPage = { ...batchDefinition, data: structuredClone(batchDefinition.data), setData(next) { Object.assign(this.data, next); } };
privacyPage._token = "test-token";
await privacyPage.loadPrices();
assert.equal(privacyPage.data.pricesReady, true, "new paid-task fixture must have a confirmed current price");
privacyPage._previousResult = batchRequests[1].previous;
Object.assign(privacyPage.data, { completedCount: 4, compareSelf: false, images: [{ path: "/fake/privacy.png", type: "png" }], imageCount: 1, agreed: true });
await privacyPage.analyze();
assert.equal(batchRequests.at(-1).compareWithSelf, false);
assert.deepEqual(batchRequests.at(-1).previous.fit, [], "turning self-comparison off must remove prior self-fit clues from the next request");
const otherPersonId = "33333333-3333-4333-8333-333333333333";
let externallySelectedId = validId;
let returnedDefinition;
new Function("require", "Page", "wx", socialSource)(
  id => id === "../../lib/risk-aware-presentation" ? nativeRisk : ({ async session() { return { token: "test-token", state: { subjects: [{ id: validId, label: "阿青" }, { id: otherPersonId, label: "阿月" }] } }; }, currentSubject() { return externallySelectedId; } }),
  value => { returnedDefinition = value; }, wx
);
const returnedPage = { ...returnedDefinition, data: structuredClone(returnedDefinition.data), setData(next) { Object.assign(this.data, next); } };
await returnedPage.onShow();
returnedPage._previousResult = batchRequests[1].previous;
Object.assign(returnedPage.data, { completedCount: 4, totalCount: 4, result: denseProfileResult });
externallySelectedId = otherPersonId;
await returnedPage.onShow();
assert.equal(returnedPage.data.personIndex, 0, "global selection must not silently attach stranger screenshots to an existing person");
assert.equal(returnedPage.data.completedCount, 4, "an unrelated global selection must preserve the current batch");
assert.equal(returnedPage.data.result, denseProfileResult);
assert.equal(returnedPage._previousResult, batchRequests[1].previous);
homeDefinition.open({ currentTarget: { dataset: { entry: "chat" } } });
assert.equal(navigation.at(-1), "/pages/chat/index?mode=chat", "typed chat must stay native");
homeDefinition.open({ currentTarget: { dataset: { entry: "positioning" } } });
assert.equal(navigation.at(-1), "/pages/chat/index?mode=positioning", "relationship reflection must stay native");
const chatSource = readFileSync(resolve("miniapp/pages/chat/index.js"), "utf8");
const chatRequests = [];
let chatDefinition;
new Function("require", "Page", "wx", chatSource)(
  id => id === "../../lib/risk-aware-presentation" ? nativeRisk : id === "../../lib/followup-context" ? followup : ({ STORAGE: api.STORAGE, async newId() { return validId; }, async session() { return { token: "test-token", state: { subjects: [{ id: validId, label: "阿青" }] } }; },
    async request(path, method, body, token) {
    if (path === "/api/miniapp/credits") { assert.equal(method, "GET"); return { prices: fixturePrices }; } chatRequests.push({ path, method, body, token }); return { possibleIntent: "商量时间", evidence: "「周日有空」", nextStep: "确认周日几点", replies: [{ text: "周日几点合适？", weight: 90, reason: "承接时间", cost: "需要安排时间" }] }; } }),
  value => { chatDefinition = value; }, wx
);
const chatPage = { ...chatDefinition, data: structuredClone(chatDefinition.data), setData(next) { Object.assign(this.data, next); } };
chatPage.onLoad({ mode: "chat" });
await chatPage.refresh();
chatPage.selfInput({ detail: { value: "周日有空" } });
await chatPage.analyze();
assert.equal(chatRequests.length, 0, "typed chat must require separate consent");
chatPage.personChange({ detail: { value: "1" } });
chatPage.agree({ detail: { value: ["yes"] } });
await chatPage.analyze();
assert.deepEqual(chatRequests[0], { path: "/api/miniapp/text", method: "POST", body: { mode: "conversation", other: "", self: "周日有空", history: [], subjectId: validId, confirmed: true, requestId: validId }, token: "test-token" });
assert.equal(chatPage.data.messages.at(-1).replies[0].text, "周日几点合适？");
assert.equal(chatPage.data.messages.at(-1).replies[0].rankLabel, "本轮首选");
assert.equal(chatPage.data.messages.length, 2, "chat must show user and assistant turns");
const chatMarkup = readFileSync(resolve("miniapp/pages/chat/index.wxml"), "utf8");
assert.match(chatMarkup, /语音通话/);
assert.equal((chatMarkup.match(/<picker /g) || []).length, 1, "only one person picker");
const archiveSource = readFileSync(resolve("miniapp/pages/archive/index.js"), "utf8");
const archiveComparison = { exports: {} };
new Function("module", readFileSync(resolve("miniapp/lib/person-comparison.js"), "utf8"))(archiveComparison);
let archiveDefinition;
const archiveActions = [];
const archiveApi = {
  STORAGE: api.STORAGE, session: api.session,
  async request(path, method, body, token) {
    if (path === "/api/miniapp/credits") { assert.equal(method, "GET"); return { prices: fixturePrices }; }
    assert.equal(path, "/api/miniapp/profile");
    assert.equal(token, "test-token");
    if (method === "GET") return { enabled: false, paused: false, subjects: [] };
    archiveActions.push(body);
    return { enabled: true, paused: false, subjects: body.action === "create" ? [{ id: validId, label: body.label, notes: "" }] : [] };
  }
};
new Function("require", "Page", "wx", archiveSource)(
  id => { if (id === "../../lib/person-comparison") return archiveComparison.exports; if (id === "../../lib/radar") return { drawRadar() {} }; assert.equal(id, "../../lib/api"); return archiveApi; },
  value => { archiveDefinition = value; }, wx
);
const archivePage = { ...archiveDefinition, data: structuredClone(archiveDefinition.data), setData(next) { Object.assign(this.data, next); } };
await archivePage.refresh();
assert.equal(archivePage.data.enabled, false);
assert.equal(archivePage.data.hasSubjects, false);
archivePage.labelInput({ detail: { value: "阿青" } });
await archivePage.createFirst();
assert.equal(archiveActions.length, 0, "first archive creation must require explicit consent");
archivePage.firstConsentChange({ detail: { value: ["yes"] } });
await archivePage.createFirst();
assert.equal(archivePage.data.enabled, true);
assert.equal(archivePage.data.subjects[0].label, "阿青");
assert.equal(archivePage.data.hasSubjects, true);
assert.equal(archivePage.data.firstConsent, false);
assert.deepEqual(archiveActions.slice(0, 2), [{ action: "consent", enabled: true }, { action: "create", label: "阿青" }]);
const clueId = "22222222-2222-4222-8222-222222222222";
archivePage.apply({ enabled: true, paused: false, subjects: [{ id: validId, label: "阿青", notes: "" }], facts: [{ id: clueId, subjectId: validId, value: "对方说：「周日有空」", evidence: "周日有空", status: "pending" }] });
assert.equal(archivePage.data.pendingFacts[0].subjectLabel, "阿青");
assert.equal(archivePage.data.hasPendingFacts, true);
await archivePage.factDecision({ currentTarget: { dataset: { id: clueId, decision: "accept" } } });
assert.deepEqual(archiveActions.at(-1), { action: "fact-decide", id: clueId, decision: "accept" });
archivePage.apply({ enabled: true, paused: false, subjects: [{ id: validId, label: "阿青", notes: "" }], facts: [{ id: clueId, subjectId: validId, value: "对方说：「周日有空」", status: "accepted" }] });
archivePage.select({ currentTarget: { dataset: { id: validId } } });
assert.equal(archivePage.data.selectedFacts.length, 1);
assert.equal(archivePage.data.hasSelectedFacts, true);
assert.equal(archivePage.data.pendingFacts.length, 0);
assert.equal(archivePage.data.hasPendingFacts, false);
archivePage.close();
assert.equal(archivePage.data.hasSelectedFacts, false);
archivePage.apply({ enabled: true, paused: false, self: { city: "上海" }, subjects: [], facts: [{ id: clueId, subjectId: null, kind: "selfBasic:city", value: "上海", evidence: "第 1 张图写着上海", source: "本人资料截图", status: "accepted" }] });
assert.equal(archivePage.data.selfKnownCount, 1, "confirmed screenshot basics should count as filled self fields");
assert.equal(archivePage.data.hasSelfFacts, true, "confirmed self memories must be visible without opening the edit form");
assert.equal(archivePage.data.visibleSelfFacts[0].displayValue, "常住地 · 上海");
const secondPersonId = "33333333-3333-4333-8333-333333333333";
archivePage.apply({ enabled: true, paused: false, subjects: [
  { id: validId, label: "阿青", updatedAt: 2 },
  { id: secondPersonId, label: "小林", updatedAt: 3 }
], signals: [
  { subjectId: validId, reportId: clueId, score: 72, comparable: true },
  { subjectId: secondPersonId, reportId: validId, score: 85, comparable: false }
], facts: [] });
assert.equal(archivePage.data.rankedCount, 1, "only complete interaction signals enter ranking");
assert.deepEqual(archivePage.data.rankedSubjects.map(item => [item.label, item.rankLabel, item.scoreText]), [["阿青", "#1", "72"], ["小林", "—", "85"]]);
archivePage.select({ currentTarget: { dataset: { id: validId } } });
archivePage.openSelectedChat();
assert.equal(navigation.at(-1), "/pages/chat/index", "archive person must open the native chat flow");
archivePage.openSelectedReport();
assert.equal(navigation.at(-1), `/pages/report/index?id=${clueId}`, "archive evidence must open the linked report");
archivePage.openSelectedSocial();
assert.equal(navigation.at(-1), "/pages/social-profile/index?subjectId=" + validId, "archive entry explicitly identifies the selected person");
const archiveMarkup = readFileSync(resolve("miniapp/pages/archive/index.wxml"), "utf8");
assert.match(archiveMarkup, /确认这条/);
assert.match(archiveMarkup, /互动信号排行/);
assert.match(archiveMarkup, /<block wx:if="\{\{enabled\}\}">/, "the object list must only appear after archive consent");
assert.equal((archiveMarkup.match(/<block wx:else>/g) || []).length, 2, "loading/error and the comparison's two-person empty state have explicit alternatives");
assert.match(archiveMarkup, /comparison-empty[\s\S]*?<block wx:else>/, "comparison results are shown only after choosing at least two people");

const newPersonActions = [];
let archiveEnabled = false;
const newPersonApi = {
  STORAGE: api.STORAGE,
  async session() { return { token: "test-token", state: { subjects: [], screenshot: { enabled: false, selfSide: "ask" } } }; },
  async request(path, method, body, token) {
    if (path === "/api/miniapp/credits") { assert.equal(method, "GET"); return { prices: fixturePrices }; }
    assert.equal(path, "/api/miniapp/profile");
    assert.equal(token, "test-token");
    if (method === "GET") return { enabled: archiveEnabled, paused: false, subjects: [] };
    newPersonActions.push(body);
    if (body.action === "consent") { archiveEnabled = true; return { enabled: true, paused: false, subjects: [] }; }
    if (body.action === "create") return { enabled: true, paused: false, subjects: [{ id: validId, label: body.label }] };
    throw new Error("unexpected action");
  }
};
let newPersonDefinition;
new Function("require", "Page", "wx", source)(
  id => id === "../../lib/risk-aware-presentation" ? nativeRisk : id === "../../lib/followup-context" ? followup : newPersonApi,
  value => { newPersonDefinition = value; },
  wx
);
const newPersonPage = { ...newPersonDefinition, data: structuredClone(newPersonDefinition.data), setData(next) { Object.assign(this.data, next); } };
await newPersonPage.refresh();
await newPersonPage.openNewPerson();
assert.equal(newPersonPage.data.archiveReady, false);
newPersonPage.newPersonInput({ detail: { value: "刚认识的小林" } });
await newPersonPage.createPerson();
assert.match(newPersonPage.data.error, /同意启用关系档案/);
assert.equal(newPersonActions.length, 0, "an unknown person must never be archived without explicit consent");
newPersonPage.newPersonAgree({ detail: { value: ["yes"] } });
await newPersonPage.createPerson();
assert.deepEqual(newPersonActions, [{ action: "consent", enabled: true }, { action: "create", label: "刚认识的小林" }]);
assert.equal(newPersonPage.data.people[newPersonPage.data.personIndex].id, validId);
assert.equal(newPersonPage.data.newPersonOpen, false);
assert.equal(newPersonPage.data.agreed, false, "creating a subject must not imply screenshot consent");
assert.match(readFileSync(resolve("miniapp/pages/quick/index.wxml"), "utf8"), /新认识的人？新建档案/);
const quickMarkup = readFileSync(resolve("miniapp/pages/quick/index.wxml"), "utf8");
assert.equal((quickMarkup.match(/这是谁的聊天？/g) || []).length, 1, "screenshot archive choice should have one clear prompt");
assert.match(quickMarkup, /不保存就保持默认/);

const unlinkedApi = { ...api, async session() { throw new Error("微信身份暂时无法建立小程序账号，请稍后重试。"); } };
let unlinkedDefinition;
new Function("require", "Page", "wx", source)(
  id => id === "../../lib/risk-aware-presentation" ? nativeRisk : id === "../../lib/followup-context" ? followup : unlinkedApi,
  value => { unlinkedDefinition = value; },
  wx
);
const unlinked = { ...unlinkedDefinition, data: structuredClone(unlinkedDefinition.data), setData(next) { Object.assign(this.data, next); } };
await unlinked.refresh();
assert.equal(unlinked.data.phase, "error");
assert.match(unlinked.data.error, /微信身份/);
assert.equal(JSON.parse(readFileSync(resolve("miniapp/app.json"), "utf8")).pages.includes("pages/web/index"), false);
{
const chatSource = readFileSync(resolve("miniapp/pages/chat/index.js"), "utf8");
let chatDefinition, onVoiceStop, recorderStarts = 0, transcriptionCalls = 0;
const chatApi = { STORAGE: api.STORAGE, async newId() { return validId; },
  async session() { return { token: "test-token", state: { subjects: [] } }; },
  async readAudio() { return "UklGRg=="; },
  async request(path, method, body) {
    if (path === "/api/miniapp/credits") { assert.equal(method, "GET"); return { prices: fixturePrices }; }
    if (path === "/api/miniapp/transcribe") { transcriptionCalls++; assert.equal(body.confirmed, true); return { text: "我想聊聊关系" }; }
    throw Error("transcription must not auto-submit advice");
  }
};
new Function("require", "Page", "wx", chatSource)(id => id === "../../lib/risk-aware-presentation" ? nativeRisk : id === "../../lib/followup-context" ? followup : chatApi, value => { chatDefinition = value; }, {
  getRecorderManager() { return { onStop(callback) { onVoiceStop = callback; }, onError() {}, start() { recorderStarts++; }, stop() {} }; }
});
const chatPage = { ...chatDefinition, data: structuredClone(chatDefinition.data), setData(next) { Object.assign(this.data, next); } };
await chatPage.refresh();
chatPage.startVoice();
assert.equal(recorderStarts, 0, "microphone requires explicit consent");
chatPage.agree({ detail: { value: ["yes"] } });
chatPage.startVoice();
assert.equal(recorderStarts, 1);
await onVoiceStop({ duration: 1200, tempFilePath: "/fake/voice.wav", fileSize: 1000 });
assert.equal(transcriptionCalls, 1);
assert.equal(chatPage.data.self, "我想聊聊关系");
assert.equal(chatPage.data.result, null, "voice transcript stays an editable draft");
assert.match(readFileSync(resolve("miniapp/pages/chat/index.wxml"), "utf8"), /松开转文字/);
assert.equal(JSON.parse(readFileSync(resolve("miniapp/app.json"), "utf8")).pages.includes("pages/voice/index"), true);
const voiceSource = readFileSync(resolve("miniapp/pages/voice/index.js"), "utf8");
const voiceSubjectId = "123e4567-e89b-42d3-a456-426614174000";
assert.equal(validVoiceSubjectId(voiceSubjectId), true);
assert.equal(validVoiceSubjectId("../another-person"), false);
const voiceQueries = [];
const voiceDb = {
  prepare(sql) {
    voiceQueries.push(sql);
    return { bind(...args) {
      assert.equal(args[sql.includes("coach_subjects") ? 1 : 0], "owner-1", "voice memory must always be scoped to the signed-in owner");
      if (sql.includes("coach_subjects")) assert.equal(args[0], voiceSubjectId, "selected subject must be verified for this owner");
      if (sql.includes("coach_facts")) assert.equal(args[1], voiceSubjectId, "voice memory facts must stay scoped to the selected subject");
      return {
        async first() {
          if (sql.includes("coach_profiles")) return { consent_at: 1, paused: 0, data: "{}" };
          if (sql.includes("coach_subjects")) return { label: "阿青", data: JSON.stringify({ notes: "约好周日看展" }) };
          throw Error("unexpected first query");
        },
        async all() {
          assert.match(sql, /status='accepted'/, "pending facts must never enter the voice session");
          return { results: [{ field: "recentEvent", value: "已确认约好周日看展", evidence: "用户确认" }, { field: "chatMemory", value: "对方说周日有空" }] };
        }
      };
    } };
  }
};
const voiceMemory = await loadVoiceMemory(voiceDb, "owner-1", voiceSubjectId);
assert.match(voiceMemory.text, /阿青/);
assert.match(voiceMemory.text, /约好周日看展/);
assert.match(voiceMemory.text, /对方说周日有空/);
assert.equal(voiceQueries.length, 3, "voice memory must verify profile consent, subject ownership, and accepted facts");
assert.equal((await loadVoiceMemory(voiceDb, "owner-1", "bad")).status, 400);
const pausedVoiceDb = { prepare(sql) { assert.match(sql, /coach_profiles/, "paused archive must stop before subject data is read"); return { bind() { return { async first() { return { consent_at: 1, paused: 1, data: "{}" }; } }; } }; } };
assert.equal((await loadVoiceMemory(pausedVoiceDb, "owner-1", voiceSubjectId)).status, 403);
const foreignVoiceDb = { prepare(sql) { return { bind() { return { async first() { return sql.includes("coach_profiles") ? { consent_at: 1, paused: 0, data: "{}" } : null; } }; } }; } };
assert.equal((await loadVoiceMemory(foreignVoiceDb, "owner-1", voiceSubjectId)).status, 404, "an unowned subject must not enter the voice session");
assert.match(readFileSync(resolve("worker-entry.mjs"), "utf8"), /session:realtimeSession\(memory\?\.text\|\|"",env\)/, "selected memory and configured brand voice must reach the provider session instructions");
const echoFilterModule = { exports: {} };
new Function("module", readFileSync(resolve("miniapp/lib/echo-filter.js"), "utf8"))(echoFilterModule);
const { createEchoFilter } = echoFilterModule.exports;
const echoFilter = createEchoFilter();
const played = Float32Array.from({ length: 2400 }, (_, index) => Math.sin(index * 0.19) * 0.35);
echoFilter.addPlayback(played);
const echoed = Int16Array.from({ length: 640 }, (_, index) => Math.round(((played[Math.floor(index * 1.5)] || 0) * (1 - (index * 1.5 % 1)) + (played[Math.floor(index * 1.5) + 1] || 0) * (index * 1.5 % 1)) * 10000));
assert.equal(echoFilter.isEcho(echoed.buffer,0), false, "queued audio cannot filter speech before playback");
assert.equal(echoFilter.isEcho(echoed.buffer,0.1), true, "strong already-played model echo should be filtered");
const independentSpeech = Int16Array.from({ length: 640 }, (_, index) => Math.round(Math.sin(index * 0.071) * 9000));
assert.equal(echoFilter.isEcho(independentSpeech.buffer), false, "independent user speech must remain sendable");
const delayedEchoFilter = createEchoFilter();
delayedEchoFilter.addPlayback(played, 0.1);
delayedEchoFilter.addPlayback(Float32Array.from({ length: 48000 }, (_, index) => Math.sin(index * 0.047) * 0.35), 1.1);
assert.equal(delayedEchoFilter.isEcho(echoed.buffer, 0.2), true, "queued future audio must not evict the sound currently playing");
assert.equal(delayedEchoFilter.isEcho(independentSpeech.buffer, 0.2), false, "near-end speech stays available during a queued reply");
const queuedOnlyFilter = createEchoFilter();
queuedOnlyFilter.addPlayback(played, 2);
assert.equal(queuedOnlyFilter.isEcho(echoed.buffer, 0.2), false, "audio not yet played must not suppress the microphone");
delayedEchoFilter.reset();
assert.equal(delayedEchoFilter.isEcho(echoed.buffer, 0.2), false, "interrupted replies must not keep filtering later turns");
assert.match(voiceSource, /input_audio_buffer\.append/);
assert.match(voiceSource, /input_audio_buffer\.speech_started/);
assert.match(voiceSource, /source\.stop\(\)/);
assert.match(readFileSync(resolve("worker-entry.mjs"), "utf8"), /\/api\/miniapp\/voice-live/);
let voiceDefinition, voiceSocket, voiceRecorder, micStarts = 0, stoppedSources = 0, startedSources = 0, voiceFallbackUrl = "", lastVoiceChannel;
const voiceOrder = [];
const screenRequests = [];
const voiceWx = {
  createWebAudioContext() { voiceOrder.push("audio"); return { currentTime: 0, destination: {}, resume() {}, close() {}, createBuffer(_channels, samples) { lastVoiceChannel = new Float32Array(samples); return { getChannelData() { return lastVoiceChannel; } }; }, createBufferSource() { return { connect() {}, start() { startedSources++; }, stop() { stoppedSources++; } }; } }; },
  setKeepScreenOn({ keepScreenOn }) { screenRequests.push(keepScreenOn); },
  authorize({ scope, success }) { assert.equal(scope, "scope.record"); voiceOrder.push("authorize"); success(); },
  getRecorderManager() { voiceRecorder = { onFrameRecorded(callback) { this.frame = callback; }, onError() {}, start() { micStarts++; }, stop() {} }; return voiceRecorder; },
  connectSocket(options) { assert.equal(options.url, "wss://coach.lovetalk.love/api/miniapp/voice-live?requestId=" + validId); assert.equal(options.header.Authorization, "Bearer test-token"); voiceSocket = { events: {}, sent: [], onOpen(callback) { this.events.open = callback; }, onMessage(callback) { this.events.message = callback; }, onError(callback) { this.events.error = callback; }, onClose(callback) { this.events.close = callback; }, send(packet) { this.sent.push(packet); }, close() {} }; return voiceSocket; },
  arrayBufferToBase64(value) { return Buffer.from(value).toString("base64"); },
  base64ToArrayBuffer(value) { return Uint8Array.from(Buffer.from(value, "base64")).buffer; },
  navigateTo({ url }) { voiceFallbackUrl = url; },
};
new Function("require", "Page", "wx", voiceSource)(id => id === "../../lib/echo-filter" ? { createEchoFilter } : ({ BASE: "https://coach.lovetalk.love", async newId() { return validId; }, async session() { voiceOrder.push("session"); return { token: "test-token" }; } }), value => { voiceDefinition = value; }, voiceWx);
const voicePage = { ...voiceDefinition, data: structuredClone(voiceDefinition.data), setData(next) { Object.assign(this.data, next); } };
voicePage.selectAudioMode({ currentTarget: { dataset: { mode: "headphones" } } });
await voicePage.start();
assert.equal(voiceSocket, undefined, "live microphone requires explicit consent");
voicePage.agree({ detail: { value: ["yes"] } });
await voicePage.start();
assert.deepEqual(voiceOrder, ["audio", "authorize", "session"], "iOS audio must be opened in the tap and mic permission confirmed before starting a paid session");
assert.equal(micStarts, 0, "microphone waits for provider session confirmation");
voiceSocket.events.message({ data: JSON.stringify({ type: "session.updated" }) });
assert.equal(micStarts, 1);
assert.equal(voicePage.voiceStage, "talking", "connection must report the microphone phase before conversation starts");
assert.deepEqual(screenRequests, [true], "active voice should prevent automatic screen sleep");
voiceRecorder.frame({ frameBuffer: Uint8Array.from([1, 2]).buffer });
assert.equal(JSON.parse(voiceSocket.sent[0].data).type, "input_audio_buffer.append");
voiceSocket.events.message({ data: JSON.stringify({ type: "response.audio.delta", delta: Buffer.from([0, 0, 1, 0]).toString("base64") }) });
voiceSocket.events.message({ data: JSON.stringify({ type: "input_audio_buffer.speech_started" }) });
assert.equal(stoppedSources, 1, "new speech should interrupt queued audio");
voiceSocket.events.message({ data: JSON.stringify({ type: "response.audio.delta", delta: Buffer.from([0, 0, 1, 0]).toString("base64") }) });
voiceSocket.events.message({ data: JSON.stringify({ type: "response.audio_transcript.delta", delta: "旧回复" }) });
assert.equal(startedSources, 1, "late assistant audio must not restart while the user is speaking");
assert.equal(voicePage.data.assistant, "", "late assistant transcript must not obscure the new turn");
voiceSocket.events.message({ data: JSON.stringify({ type: "response.done" }) });
assert.equal(voicePage.data.status, "正在听你说话", "old response completion must not override the listening state");
voiceSocket.events.message({ data: JSON.stringify({ type: "input_audio_buffer.speech_stopped" }) });
voiceSocket.events.message({ data: JSON.stringify({ type: "response.audio.delta", delta: Buffer.from([0, 0, 1, 0]).toString("base64") }) });
assert.equal(startedSources, 2, "the next assistant turn should remain playable");
voicePage.end();
assert.equal(voicePage.data.phase, "idle");
assert.deepEqual(screenRequests, [true, false], "ending voice must release the screen-on request");
const quietPcm = Buffer.alloc(2);
quietPcm.writeInt16LE(3277);
voicePage.setData({ phase: "talking" });
voicePage.audio = voiceWx.createWebAudioContext();
voicePage.playPcm(quietPcm.toString("base64"));
assert.ok(lastVoiceChannel[0] > 0.1 && lastVoiceChannel[0] < 1, "quiet PCM should be amplified without clipping");
const loudPcm = Buffer.alloc(2);
loudPcm.writeInt16LE(32767);
voicePage.playPcm(loudPcm.toString("base64"));
assert.ok(lastVoiceChannel[0] < 1, "loud PCM must remain below clipping after the boost");
voicePage.end();
const speakerPage = { ...voiceDefinition, data: structuredClone(voiceDefinition.data), setData(next) { Object.assign(this.data, next); } };
speakerPage.agree({ detail: { value: ["yes"] } });
await speakerPage.start();
voiceSocket.events.message({ data: JSON.stringify({ type: "session.updated" }) });
voiceRecorder.frame({ frameBuffer: Uint8Array.from([1, 2]).buffer });
const sentBeforeReply = voiceSocket.sent.length;
voiceSocket.events.message({ data: JSON.stringify({ type: "response.created" }) });
voiceSocket.events.message({ data: JSON.stringify({ type: "response.audio.delta", delta: Buffer.from([0, 0, 1, 0]).toString("base64") }) });
voiceRecorder.frame({ frameBuffer: Uint8Array.from([1, 2]).buffer });
assert.equal(voiceSocket.sent.length, sentBeforeReply + 1, "speaker mode must preserve independent user speech during playback");
const stoppedBeforeEcho = stoppedSources;
voiceSocket.events.message({ data: JSON.stringify({ type: "input_audio_buffer.speech_started" }) });
assert.equal(stoppedSources, stoppedBeforeEcho + 1, "speaker mode must allow real user interruption");
voiceSocket.events.message({ data: JSON.stringify({ type: "response.done" }) });
voiceRecorder.frame({ frameBuffer: Uint8Array.from([1, 2]).buffer });
assert.equal(voiceSocket.sent.length, sentBeforeReply + 2, "speaker mode must not blanket-mute future turns");
speakerPage.end();
assert.deepEqual(screenRequests.slice(-2), [true, false], "speaker mode must release screen-on after a call");
let memoryUrl = "";
let memoryDefinition;
new Function("require", "Page", "wx", voiceSource)(
  id => id === "../../lib/echo-filter" ? { createEchoFilter } : ({ BASE: "https://coach.lovetalk.love", async newId() { return validId; }, async session() { return { token: "test-token" }; }, async request(path) { assert.equal(path, "/api/miniapp/profile"); return { enabled: true, paused: false, subjects: [{ id: voiceSubjectId, label: "阿青" }] }; } }),
  value => { memoryDefinition = value; },
  { ...voiceWx, connectSocket(options) { memoryUrl = options.url; return { onOpen() {}, onMessage() {}, onError() {}, onClose() {}, close() {} }; } }
);
const memoryPage = { ...memoryDefinition, data: structuredClone(memoryDefinition.data), setData(next) { Object.assign(this.data, next); } };
await memoryPage.onShow();
assert.equal(memoryPage.data.people[0].id, "", "voice must default to no archive memory");
memoryPage.personChange({ detail: { value: "1" } });
memoryPage.agree({ detail: { value: ["yes"] } });
await memoryPage.start();
assert.match(readFileSync(resolve("miniapp/pages/voice/index.wxml"), "utf8"), /所选人物档案交由/, "combined consent must explicitly include the selected archive");
assert.equal(memoryUrl, `wss://coach.lovetalk.love/api/miniapp/voice-live?subjectId=${voiceSubjectId}&profileConsent=1&requestId=${validId}`);
memoryPage.end();
let finishSession;
new Function("require", "Page", "wx", voiceSource)(id => id === "../../lib/echo-filter" ? { createEchoFilter } : ({ BASE: "https://coach.lovetalk.love", async newId() { return validId; }, session() { return new Promise(resolve => { finishSession = resolve; }); } }), value => { voiceDefinition = value; }, voiceWx);
const leavingPage = { ...voiceDefinition, data: structuredClone(voiceDefinition.data), setData(next) { Object.assign(this.data, next); } };
leavingPage.agree({ detail: { value: ["yes"] } });
voiceSocket = undefined;
const pendingStart = leavingPage.start();
await Promise.resolve();
leavingPage.onHide();
finishSession({ token: "test-token" });
await pendingStart;
assert.equal(voiceSocket, undefined, "leaving while wx.login is pending must not open a background socket");
assert.equal(leavingPage.data.phase, "idle");
new Function("require", "Page", "wx", voiceSource)(id => id === "../../lib/echo-filter" ? { createEchoFilter } : ({ BASE: "https://coach.lovetalk.love", async newId() { return validId; }, async session() { return { token: "test-token" }; } }), value => { voiceDefinition = value; }, voiceWx);
const rejectedVoice = { ...voiceDefinition, data: structuredClone(voiceDefinition.data), setData(next) { Object.assign(this.data, next); } };
rejectedVoice.agree({ detail: { value: ["yes"] } });
await rejectedVoice.start();
voiceSocket.events.open();
voiceSocket.events.close({ code: 1011 });
assert.equal(rejectedVoice.data.phase, "idle");
assert.match(rejectedVoice.data.error, /语音模型启动中断（连接代码 1011）/, "pre-session WebSocket close must be visible, not disguised as a normal end");
assert.equal(rejectedVoice.data.status, "通话未能启动或已中断");
new Function("require", "Page", "wx", voiceSource)(id => id === "../../lib/echo-filter" ? { createEchoFilter } : ({ BASE: "https://coach.lovetalk.love", async newId() { return validId; }, async session() { return { token: "test-token" }; } }), value => { voiceDefinition = value; }, voiceWx);
const gatewayFailure = { ...voiceDefinition, data: structuredClone(voiceDefinition.data), setData(next) { Object.assign(this.data, next); } };
gatewayFailure.agree({ detail: { value: ["yes"] } });
await gatewayFailure.start();
voiceSocket.events.open();
voiceSocket.events.message({ data: JSON.stringify({ type: "error", error: { code: "UPSTREAM_CLOSED_BEFORE_READY_1000" } }) });
assert.match(gatewayFailure.data.error, /UPSTREAM_CLOSED_BEFORE_READY_1000/, "client must show the gateway's safe provider-stage code");
assert.equal(gatewayFailure.data.phase, "idle");
assert.match(readFileSync(resolve("miniapp/pages/voice/index.wxml"), "utf8"), /改用打字咨询/);
gatewayFailure.openText();
assert.equal(voiceFallbackUrl, "/pages/chat/index?mode=chat", "failed live voice must offer a working native typed-advice fallback");
new Function("require", "Page", "wx", voiceSource)(id => id === "../../lib/echo-filter" ? { createEchoFilter } : ({ BASE: "https://coach.lovetalk.love", async newId() { return validId; }, async session() { assert.fail("denied microphone permission must not open a server session"); } }), value => { voiceDefinition = value; }, { ...voiceWx, authorize({ fail }) { fail({ errMsg: "authorize:fail auth deny" }); } });
const deniedVoice = { ...voiceDefinition, data: structuredClone(voiceDefinition.data), setData(next) { Object.assign(this.data, next); } };
voiceSocket = undefined;
deniedVoice.agree({ detail: { value: ["yes"] } });
await deniedVoice.start();
assert.equal(voiceSocket, undefined, "a denied microphone must not consume a voice handshake");
assert.match(deniedVoice.data.error, /麦克风权限未开启/);
}
for (const pageName of ["home", "quick", "archive", "chat", "report"]) {
  const pageMarkup = readFileSync(resolve(`miniapp/pages/${pageName}/index.wxml`), "utf8");
  assert.doesNotMatch(pageMarkup, /wx:(?:if|elif)="[^"]*\.length/, `${pageName}: calculate collection visibility in page data before WXML renders it`);
  assert.doesNotMatch(pageMarkup, /\{\{\s*(?:index|replyIndex)\s*\+\s*1/, `${pageName}: calculate display ordinals in page data before WXML renders them`);
}
console.log("Mini Program native flow passed: WeChat session, screenshot and archive flows, consented voice draft, and live-voice protocol wiring.");
