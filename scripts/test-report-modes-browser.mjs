import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

// All data is synthetic and every API request is intercepted: no AI or credit calls.
const origin = process.env.INTAKE_TEST_ORIGIN || "http://127.0.0.1:8798";
const owner = "report-modes-browser";
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtureDir = resolve(repoRoot, process.env.REPORT_ROUTE_FIXTURE_DIR || "outputs/report-route-fixtures");
// The ignored outputs directory is absent in a fresh checkout. Generate reports
// through the production-route harness with synthetic model/auth/storage inputs.
if (["full-person", "risk-person", "moments-only"].some(name => !existsSync(resolve(fixtureDir, `${name}.json`)))) {
  execFileSync(process.execPath, [resolve(repoRoot, "scripts/test-capture-durable-jobs.mjs")], {
    cwd: repoRoot,
    env: { ...process.env, REPORT_ROUTE_FIXTURE_DIR: fixtureDir },
    stdio: "inherit",
  });
}
const load = async name => JSON.parse(await readFile(resolve(fixtureDir, `${name}.json`), "utf8"));
const full = await load("full-person"), risk = await load("risk-person"), moments = await load("moments-only");
if (process.argv.includes("--fixtures-only")) {
  for (const report of [full, risk, moments]) assert.ok(report.reportId && report.semanticHistory && Array.isArray(report.sourceCoverage));
  console.log(`PASS self-contained synthetic report fixture preparation: ${fixtureDir}`);
  process.exit(0);
}
full.semanticHistory.findings.unshift(
  { id: "same-claim-other", subject: "other", claim: "主动确认安排", evidence: [{ sourceId: "synthetic-other", senderRole: "other", sourceKind: "chat", quote: "我周六两点可以，你呢？" }] },
  { id: "same-claim-self", subject: "self", claim: "主动确认安排", evidence: [{ sourceId: "synthetic-self", senderRole: "self", sourceKind: "chat", quote: "那我们展馆门口碰面。" }] },
);
const screenshot = {
  id: "11111111-2222-4333-8444-555555555555", reportId: "11111111-2222-4333-8444-555555555555", kind: "chat",
  subjectId: full.subjectId, participants: full.participants,
  lines: [
    { id: "one", speaker: "self", text: "周六下午一起看展吗？", screenshotNumber: 1 },
    { id: "two", speaker: "other", text: "好呀，下午两点可以。", screenshotNumber: 1 },
  ],
  annotations: [{ lineId: "two", intent: [{ key: "answer", label: "回应邀约", weight: 80 }], note: "对方给了具体时间，可以确认地点；这句话不能证明长期关系意愿。" }],
  decision: {
    judgment: "这次邀约得到具体回应，可以把时间地点定下来。",
    evidence: "好呀，下午两点可以。", nextStep: "确认见面地点，然后看约定能否落实。",
    replyOptions: [{ style: "自然确认", text: "好，那周六两点展馆门口见。", reason: "直接接住对方给出的时间，不额外加压。" }],
  },
  affinity: { value: 62, contextCount: 2, inputCount: 2, dimensions: [{ key: "response", label: "回应投入", value: 70, status: "supported" }] },
};
const empty = { ...screenshot, lines: [], annotations: [], affinity: undefined };
const partial = structuredClone(full);
partial.semanticHistory.coverage.analyzedText = partial.semanticHistory.coverage.receivedText - 1;
partial.sourceCoverage[0] = { ...partial.sourceCoverage[0], status: "partial", imagesExpected: (partial.sourceCoverage[0].imagesExpected || 0) + 2, imagesMissing: 2 };
const variants = [
  ["upload", screenshot], ["empty-upload", empty], ["full-history", full], ["partial", partial], ["risk", risk], ["moments", moments],
];
await mkdir("outputs/report-modes", { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
const results = [];
try {
  for (const width of [1440, 390]) for (const [name, report] of variants) {
    const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [], writes = [];
    await page.setViewport({ width, height: 950 });
    await page.setRequestInterception(true);
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return request.continue();
      if (request.method() !== "GET") writes.push(url.pathname);
      let value = {};
      if (url.pathname === "/api/auth/session") value = { loggedIn: true, user: { id: owner } };
      if (url.pathname === "/api/account/credits" || url.pathname === "/api/web/account-context") value = { account: { userId: owner, balance: 1000 }, prices: {}, people: [], user: { name: "合成用户" }, meteringReady: true };
      if (url.pathname === "/api/web/profile") value = { enabled: true, paused: false, self: {}, subjects: [] };
      if (url.pathname === "/api/web/report") value = { reportId: report.reportId, kind: "chat", subjectId: report.subjectId, totalCount: report.totalCount, report };
      if (url.pathname === "/api/web/relationship-feedback") value = { subjectId: report.subjectId, versionChanges: { status: "first" }, currentFeedback: { reportId: report.reportId, latest: null } };
      return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    });
    await page.goto(`${origin}/report?id=${report.reportId}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-report-mode]");
    const selector = key => `[data-report-reader] [role="tab"][aria-controls$="-panel-${key}"]`;
    const labels = await Promise.all(["status", "change", "next"].map(key => page.$eval(selector(key), node => node.querySelector("span").textContent)));
    assert.deepEqual(labels, name.includes("upload") ? ["好感信号", "逐句意图", "怎么回"] : name === "moments" ? ["朋友圈解读", "动态变化", "聊什么"] : ["整体判断", "关系变化", "行动建议"]);
    const scope = await page.$eval("[data-report-participants]", node => node.innerText);
    assert.ok(!scope.includes("正在分析"), "saved report must not claim it is still analyzing");
    assert.ok(scope.includes(name.includes("upload") ? "本次上传" : "本报告关联的全部资料"));
    assert.ok(scope.includes(report.participants.other.label));
    if (name === "partial") assert.ok(scope.includes(`文字已解读 ${partial.semanticHistory.coverage.analyzedText} / ${partial.semanticHistory.coverage.receivedText}`), "incomplete analysis remains visible in the top-level scope");
    assert.equal(await page.$("[data-history-entry]"), null, "no duplicate card navigation above the judgment");
    const fonts = await page.$$eval("[data-report-reader] > div [role=tab], [data-report-source-scope]", nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
    assert.ok(fonts.every(size => size >= 16), "primary navigation and scope are at least 16 px");
    await page.$eval("[data-report-participants]", node => node.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `outputs/report-modes/${name}-${width}.png` });
    if (name.includes("upload")) {
      assert.equal(await page.$("[data-history-reading]"), null);
      await page.$eval(selector("change"), node => node.click());
      await page.waitForSelector("#tone");
      if (name === "upload") {
        const text = await page.$eval("#tone", node => node.innerText);
        assert.match(text, /回应邀约/);
        assert.match(text, /好呀，下午两点可以/);
      } else assert.match(await page.$eval("#tone", node => node.innerText), /没有可解读的文字/);
      await page.$eval(selector("next"), node => node.click());
      assert.match(await page.$eval("[data-reading-section=next]", node => node.innerText), /周六两点展馆门口见/);
    } else {
      assert.equal(await page.$("[data-capture-sources]"), null, "source range is not repeated in a separate header");
      await page.click("[data-report-source-scope] [data-capture-evidence]");
      await page.waitForSelector("[data-capture-evidence-dialog][open]");
      assert.match(await page.$eval("[data-capture-evidence-dialog]", node => node.textContent), /原始.*记录|原始朋友圈动态/);
      await page.click('[data-capture-evidence-dialog] button[aria-label="关闭原始记录"]');
      if (name === "moments") {
        assert.ok(!scope.includes("与你"), "Moments-only report does not imply mutual interaction");
        assert.equal(await page.$("[data-reading-section=status] [data-report-visual-metrics]"), null);
        assert.ok(await page.$("[data-history-moments]"));
      } else {
        assert.ok(await page.$("[data-reading-section=status] [data-report-visual-metrics]"), "full-history metrics visible with initial judgment");
        assert.match(await page.$eval("[data-message-composition]", node => node.getAttribute("aria-label")), new RegExp(String(report.chatActivity.messages)));
        if (name === "full-history") {
          assert.ok(await page.$('[data-history-findings] [data-finding-id="same-claim-other"]'));
          assert.ok(await page.$('[data-history-findings] [data-finding-id="same-claim-self"]'), "same claim about different actors retains both evidence chains");
        }
        if (name === "risk") assert.ok(await page.$("[data-history-risk-verification]"), "risk evidence selected initially");
      }
      const details = await page.$("[data-report-coverage] > button");
      if (details) {
        await details.evaluate(node => node.scrollIntoView({ block: "center", behavior: "instant" }));
        await details.evaluate(node => node.addEventListener("click", () => { window.__testDetailOpenY = scrollY; }, { once: true, capture: true }));
        await details.click();
        const before = await page.evaluate(() => window.__testDetailOpenY);
        await page.waitForSelector("dialog[open]");
        assert.ok(await page.$eval("dialog[open]", node => node.textContent.includes("已导入")));
        if (name === "partial") assert.match(await page.$eval("dialog[open]", node => node.textContent), /部分材料待补齐|尚未同步可读内容/);
        await page.click('dialog[open] button[aria-label="关闭详情并返回报告"]');
        await page.waitForFunction(y => !document.querySelector("dialog[open]") && Math.abs(scrollY - y) < 3, { timeout: 3000 }, before).catch(async error => {
          console.error({ name, width, before, after: await page.evaluate(() => scrollY), modalOpen: !!await page.$("dialog[open]") });
          throw error;
        });
        assert.ok(Math.abs(await page.evaluate(() => scrollY) - before) < 3, "source details return to exact reading position");
      }
      await page.$eval(selector("change"), node => node.click());
      assert.equal(await page.$("[data-reading-section=change] #tone"), null, "full-history has no sampled sentence interpretation");
      await page.$eval(selector("next"), node => node.click());
      assert.ok(await page.$("[data-history-actions]"));
      assert.match(await page.$eval("[data-new-sentence-analysis]", node => node.textContent), /补充新聊天/);
      assert.match(await page.$eval("[data-new-sentence-analysis]", node => node.getAttribute("href")), /focus=intent/);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no horizontal overflow");
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    results.push({ name, width, labels, paidWrites: writes.length });
    await context.close();
  }
  console.log("PASS 12 synthetic report cases: upload/full-history/Moments scope, incomplete coverage preserved, named subjects with distinct evidence, risk-first reading, data charts, sentence/reply paths, readable navigation, source access and modal position, no paid calls or overflow.");
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
