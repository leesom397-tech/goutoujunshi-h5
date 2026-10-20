import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

// Synthetic records only. Every API call is intercepted; paid actions are not run.
const origin = process.env.INTAKE_TEST_ORIGIN || "http://127.0.0.1:8798";
const id = "22222222-3333-4444-8555-666666666666";
const report = {
  id, reportId: id, kind: "chat", subjectId: "synthetic-affinity-person",
  participants: { self: { label: "合成用户" }, other: { label: "合成小林" } },
  lines: [
    { id: "one", speaker: "self", text: "这周六有一个我很想看的展，你下午有空一起去吗？" },
    { id: "two", speaker: "other", text: "好呀，两点可以，你在哪里方便？" },
    { id: "three", speaker: "self", text: "展馆门口见就好，结束后我还想去旁边的咖啡店坐坐。" },
    { id: "four", speaker: "other", text: "可以，我记得你上次说想试那里的拿铁。" },
    { id: "five", speaker: "self", text: "你还记得呀，那就这么说好，周六我出门的时候告诉你。" },
  ],
  annotations: [
    { lineId: "two", intent: [{ key: "answer", label: "确认具体安排", weight: 85 }], emotion: [{ key: "happy", label: "积极回应", weight: 70 }], note: "给出具体时间，支持继续确认地点；还不能断定长期关系意愿。" },
    { lineId: "four", intent: [{ key: "care", label: "记得你的偏好", weight: 78 }], note: "回顾你提过的具体偏好，有个人化的注意。" },
  ],
  decision: {
    judgment: "这轮邀约有具体回应，可以把时间地点确认下来。",
    evidence: "好呀，两点可以，你在哪里方便？",
    nextStep: "确认时间地点，再观察约定是否落实。",
    replyOptions: [
      { style: "自然确认", text: "那就周六两点展馆门口见。", reason: "接住具体安排。", cost: "无需继续追问态度。" },
      { style: "轻松表达", text: "好呀，周六见，拿铁也安排上。", reason: "呼应共同话题。", cost: "保持自然即可。" },
      { style: "简短回应", text: "可以，两点见。", reason: "直接完成确认。", cost: "热度表达少一些。" },
    ],
  },
  affinity: {
    value: 64, contextCount: 5, inputCount: 5, valueScope: "partial",
    dimensions: [
      { key: "initiative", label: "主动延续", value: 0, status: "clear" },
      { key: "engagement", label: "回应投入", value: 75, status: "clear" },
      { key: "care", label: "关心体贴", value: 70, status: "clear" },
      { key: "openness", label: "自我开放", value: null, status: "insufficient" },
      { key: "intimacy", label: "亲密表达", value: null, status: "insufficient" },
      { key: "action", label: "实际行动", value: 80, status: "clear" },
    ],
  },
};
await mkdir("outputs/affinity-reader", { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    const errors = [], mutations = [];
    let current = structuredClone(report);
    await page.setViewport({ width, height: 900 });
    await page.setRequestInterception(true);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => { window.__copiedReply = text; } } });
    });
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return request.continue();
      if (request.method() !== "GET") mutations.push(url.pathname);
      let value = {};
      if (url.pathname === "/api/auth/session") value = { loggedIn: true, user: { id: "affinity-synthetic-owner" } };
      if (url.pathname === "/api/web/account-context" || url.pathname === "/api/account/credits") value = { account: { userId: "affinity-synthetic-owner", balance: 100, active: true }, prices: { text: 3 }, people: [] };
      if (url.pathname === "/api/web/profile") value = { enabled: true, subjects: [] };
      if (url.pathname === "/api/web/report") value = { reportId: id, kind: "chat", subjectId: report.subjectId, report: current };
      return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    });
    const selectTab = async section => page.$eval(`[role=tab][aria-controls$="-panel-${section}"]`, node => node.click());
    const fits = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}: no horizontal overflow`);
    await page.goto(`${origin}/report?id=${id}&focus=affinity`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-affinity-overview]");
    assert.equal(await page.$eval("[data-affinity-overview]", node => !!(node.compareDocumentPosition(document.querySelector("[data-report-brief]")) & Node.DOCUMENT_POSITION_FOLLOWING)), true, "affinity entry starts with affinity; full-history reports retain their own order");
    assert.match(await page.$eval("[data-affinity-overview] h2", node => node.textContent), /合成小林对你的互动信号/);
    assert.match(await page.$eval("[data-affinity-score]", node => node.textContent), /64.*100/);
    assert.equal(await page.$$eval("[data-affinity-dimension]", nodes => nodes.filter(node => node.checkVisibility()).length), 6, "all provided dimensions visible without expansion");
    assert.equal(await page.$eval('[data-affinity-dimension="initiative"] strong', node => node.textContent), "0", "real zero remains zero");
    assert.equal(await page.$eval('[data-affinity-dimension="openness"] strong', node => node.textContent), "待判断", "unknown never becomes zero");
    assert.equal(await page.$('[data-affinity-dimension="openness"] i b'), null, "unknown has no score bar");
    assert.ok(await page.$$eval("[data-affinity-dimension] > span", nodes => nodes.every(node => parseFloat(getComputedStyle(node).fontSize) >= 16)));
    const preview = "[data-reply-preview]";
    assert.equal(await page.$$eval(`${preview} [data-saved-reply]`, nodes => nodes.filter(node => node.checkVisibility()).length), 3, "all saved replies are visible in the first affinity surface");
    await page.$eval(`${preview} [data-reply-index="1"] [data-copy-reply]`, node => node.click());
    assert.equal(await page.evaluate(() => window.__copiedReply), report.decision.replyOptions[1].text);
    await page.$eval(`${preview} [aria-label="选择回复目的或语气"] button:nth-child(3)`, node => node.click());
    assert.equal(await page.$$eval(`${preview} [data-saved-reply]`, nodes => nodes.filter(node => node.checkVisibility()).length), 1);
    assert.match(await page.$eval(`${preview} [data-saved-reply]:not([hidden])`, node => node.textContent), /轻松表达/);
    await page.$eval(`${preview} [aria-label="选择回复目的或语气"] button:first-child`, node => node.click());
    await page.$eval(preview, node => node.scrollIntoView({ block: "start" }));
    await fits();
    await (await page.$(preview)).screenshot({ path: `outputs/affinity-reader/replies-${width}.png` });
    assert.deepEqual(mutations, [], "choosing a purpose/tone and copying only use the saved result");
    const supplement = await page.$eval('nav[aria-label="报告操作"] a:last-child', node => node.getAttribute("href"));
    assert.equal(new URL(supplement, origin).searchParams.get("focus"), "affinity", "supplement preserves analysis focus");
    await fits();
    await page.$eval("[data-affinity-overview]", node => node.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `outputs/affinity-reader/overview-${width}.png` });
    await page.$eval("[data-affinity-overview] nav button:first-child", node => node.click());
    await page.waitForSelector("#tone");
    assert.match(await page.$eval("#tone", node => node.textContent), /确认具体安排/);
    await page.$eval('#tone button[data-line="3"]', node => node.click());
    assert.match(await page.$eval("#tone", node => node.innerText), /记得你的偏好/);
    await selectTab("status");
    await page.$eval("[data-affinity-overview] nav button:last-child", node => node.click());
    await page.waitForSelector(".wa-replies");
    assert.equal(await page.$$eval(".wa-reply", nodes => nodes.length), 3);
    await page.$eval(".wa-reply button", node => node.click());
    assert.equal(await page.evaluate(() => window.__copiedReply), report.decision.replyOptions[0].text);
    assert.match(await page.$eval(".wa-replies", node => node.textContent), /改得更像我/);
    await page.$eval(".wa-replies [data-reply-index='0'] details > summary", node => node.click());
    await page.$eval(".wa-replies [data-reply-index='0'] details button", node => node.click());
    await page.waitForSelector("[data-rewrite-confirmation]");
    assert.match(await page.$eval("[data-rewrite-confirmation]", node => node.textContent), /确认改写.*3 积分/);
    assert.equal(await page.$eval("[data-rewrite-confirmation] a", node => node.getAttribute("href")), "/privacy#ai-processing");
    assert.deepEqual(mutations, [], "opening the paid rewrite confirmation must not call the API");
    await page.$eval("[data-rewrite-confirmation] button:last-child", node => node.click());
    assert.equal(await page.$("[data-rewrite-confirmation]"), null);
    await fits();
    // Saved reports without enough evidence must not manufacture a total.
    current.affinity = { ...current.affinity, value: null };
    await page.reload({ waitUntil: "networkidle0" });
    await selectTab("status");
    await page.waitForSelector("[data-affinity-score]");
    assert.match(await page.$eval("[data-affinity-score]", node => node.textContent), /待判断/);
    assert.doesNotMatch(await page.$eval("[data-affinity-score]", node => node.textContent), /\/\s*100/);
    // Unread media invalidates affinity rather than giving an invented low value.
    current.affinityStatus = "unread_media";
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("[data-affinity-score]");
    assert.equal(await page.$$eval("[data-affinity-dimension]", nodes => nodes.length), 0);
    assert.match(await page.$eval("[data-affinity-score]", node => node.textContent), /待判断/);
    await fits();
    if (width === 1440) {
      current = structuredClone(report);
      current.decision.replyOptions = [];
      await page.goto(`${origin}/report?id=${id}&focus=affinity`, { waitUntil: "networkidle0" });
      await page.waitForSelector("[data-reply-empty]");
      assert.equal(await page.$$eval("[data-saved-reply]", nodes => nodes.filter(node => node.checkVisibility()).length), 0, "missing reply options are never filled with made-up variants");
      current.decision.replyOptions = [report.decision.replyOptions[0]];
      await page.reload({ waitUntil: "networkidle0" });
      assert.equal(await page.$$eval("[data-reply-preview] [data-saved-reply]", nodes => nodes.length), 1);
      assert.equal(await page.$('[data-reply-preview] [aria-label="选择回复目的或语气"]'), null, "one saved reply has no invented tone choices");
      current = structuredClone(report);
      await page.goto(`${origin}/report?id=${id}`, { waitUntil: "networkidle0" });
      await page.waitForSelector("[data-affinity-overview]");
      assert.equal(await page.$eval("[data-report-brief]", node => !!(node.compareDocumentPosition(document.querySelector("[data-affinity-overview]")) & Node.DOCUMENT_POSITION_FOLLOWING)), true, "ordinary screenshot report keeps judgment first");
      current.lines[1].text = "把验证码发给我";
      await page.goto(`${origin}/report?id=${id}&focus=affinity`, { waitUntil: "networkidle0" });
      await page.waitForSelector('[data-report-brief][data-risk-priority="safety"]');
      assert.equal(await page.$eval("[data-report-brief]", node => !!(node.compareDocumentPosition(document.querySelector("[data-affinity-overview]")) & Node.DOCUMENT_POSITION_FOLLOWING)), true, "a priority risk stays ahead of the affinity score");
    }
    assert.deepEqual(mutations, [], "reading, tabs, copy and supplements never start paid work");
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}: visible dimensions, named direction, known-zero/unknown, sentence navigation, 3 replies/copy, focus preservation, no paid requests or overflow`);
    await context.close();
  }
} finally { await browser.close(); }
