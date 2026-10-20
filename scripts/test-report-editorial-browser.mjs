import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

// These fixtures come from the synthetic durable-job harness, never real users.
const origin = process.env.INTAKE_TEST_ORIGIN || "http://127.0.0.1:8798";
const full = JSON.parse(await readFile("outputs/report-route-fixtures/full-person.json", "utf8"));
const generatedReport = structuredClone(full);
const risk = JSON.parse(await readFile("outputs/report-route-fixtures/risk-person.json", "utf8"));
const manifest = JSON.parse(await readFile("lib/knowledge-manifest.generated.json", "utf8"));
const known = manifest.documents[0];
const generated = "2026-10-20T01:32:00.000Z";
full.generatedAt = generated;
full.knowledgeSources = [{ label: known.label, anchor: known.anchor }, { label: "未经检索的模型虚构书名", anchor: "not-a-real-source" }];
const longReading = "从对话可以确认双方提出过见面的安排，但仅凭热情措辞不能证明关系已经确定。".repeat(12) + "这段完整推理的末尾仍应保留。";
const longQuote = "我之前说过周末可以一起看展，也会提前确认时间。".repeat(13) + "完整原话的末尾仍应保留。";
full.semanticHistory.explanation = longReading;
full.semanticHistory.findings[0].evidence[0].quote = longQuote;
full.semanticHistory.counterEvidenceIds = [full.semanticHistory.findings[1].id];
const libraryId = full.archiveSnapshot.libraryId;
full.recentSentenceAnalysis = {
  scope: "recent", totalReadable: full.semanticHistory.coverage.receivedText, sampleCount: 2,
  from: "2026-10-19T10:00:00.000Z", to: "2026-10-20T10:00:00.000Z", windowLabel: "2026年10月19日—20日",
  lines: [
    { id: "recent-self", speaker: "self", text: "周末一起看展吗？", sourceKind: "chat", sourceId: "recent-source-1", libraryId },
    { id: "recent-other", speaker: "other", text: "好呀，周日下午两点可以。", sourceKind: "chat", sourceId: "recent-source-2", libraryId },
  ],
  annotations: [{ lineId: "recent-other", emotion: [{ key: "happy", label: "积极回应", weight: 74 }], intent: [{ key: "answer", label: "确认邀约安排", probability: .83 }], note: "对方给出了时间；这是最近片段的解读，不能替代全量趋势。" }],
};
risk.generatedAt = generated;
const browser = await puppeteer.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
await mkdir("outputs/report-editorial", { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    const errors = [], writes = [];
    let report = risk;
    await page.setViewport({ width, height: 1000 });
    await page.setRequestInterception(true);
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return request.continue();
      if (request.method() !== "GET") writes.push(url.pathname);
      let value = {};
      if (url.pathname === "/api/auth/session") value = { loggedIn: true, user: { id: "editorial-synthetic-owner" } };
      if (url.pathname === "/api/account/credits" || url.pathname === "/api/web/account-context") value = { account: { userId: "editorial-synthetic-owner", balance: 100 }, prices: {}, people: [], meteringReady: true };
      if (url.pathname === "/api/web/profile") value = { enabled: true, subjects: [] };
      if (url.pathname === "/api/web/report") value = { reportId: report.reportId, kind: "chat", subjectId: report.subjectId, report };
      if (url.pathname === "/api/web/relationship-feedback") value = { subjectId: report.subjectId, versionChanges: { status: "first" }, currentFeedback: { reportId: report.reportId, latest: null } };
      return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    });
    const open = async () => {
      await page.goto(`${origin}/report?id=${report.reportId}`, { waitUntil: "networkidle0" });
      await page.waitForSelector("[data-history-reading]");
    };
    const fits = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}: no horizontal overflow`);
    await open();
    assert.match(await page.$eval("[data-report-generated-time]", node => node.textContent), /2026\/10\/20.*09:32/);
    assert.equal(await page.$$eval("[data-risk-review] [data-risk-category]", nodes => nodes.filter(node => node.tagName === "BUTTON").length), 3);
    assert.match(await page.$eval("[data-risk-summary-detail]", node => node.textContent), /验证码/);
    await page.$eval('[data-risk-category="expectation"]', node => node.click());
    assert.match(await page.$eval("[data-risk-summary-detail]", node => node.textContent), /短期|长期|关系/);
    await page.$eval("[data-risk-summary-detail] button", node => node.click());
    await page.waitForSelector("[data-history-risk-verification]");
    await page.waitForFunction(() => document.querySelector("[data-history-reading]")?.dataset.selectedRisk === "expectation");
    assert.match(await page.$eval("[data-history-risk-verification]", node => node.textContent), /后来有没有澄清/);
    assert.match(await page.$eval("[data-risk-verification-item] h3", node => node.textContent), /短期目标与你的长期期待/);
    assert.match(await page.$eval("[data-risk-response-paths] > p", node => node.textContent), /短期目标与你的长期期待/);
    await page.$eval('[aria-label="风险证据分页"] button', node => node.click());
    assert.match(await page.$eval("[data-risk-verification-item] h3", node => node.textContent), /验证码要求后来已更正/);
    assert.ok(await page.$$eval("[data-history-risk-verification] [data-named-evidence] > small", nodes => nodes.every(node => node.textContent.includes("聊天原话") && !node.textContent.includes("朋友圈动态"))), "old chat evidence with no sourceKind is not mislabeled as Moments");
    await fits();
    await page.screenshot({ path: `outputs/report-editorial/risk-${width}.png` });
    if (width === 1440) {
      report = generatedReport;
      await open();
      await page.$eval('[data-history-reading] [role=tablist]', node => [...node.querySelectorAll("button")].find(button => button.textContent.includes("最近逐句")).click());
      await page.waitForSelector("[data-history-recent-sentences]");
      assert.match(await page.$eval("[data-history-recent-sentences]", node => node.textContent), /最近 12 条逐句解读/);
      assert.match(await page.$eval("[data-history-recent-sentences]", node => node.textContent), /平静|开心/);
      assert.match(await page.$eval("[data-history-recent-sentences]", node => node.textContent), /80%/);
      assert.ok(generatedReport.recentSentenceAnalysis.annotations.every(annotation => Array.isArray(annotation.emotion) && Array.isArray(annotation.intent)), "serialized route data uses the actual UI schema");
    }
    report = full;
    await open();
    const statsBefore = await page.$eval("[data-message-composition]", node => node.getAttribute("aria-label"));
    assert.ok(statsBefore.includes(String(full.chatActivity.messages)), "full-history statistics still use all messages");
    assert.ok(await page.$("[data-history-moments-overview]"), "Moments has a visible report subsection");
    await page.$eval("[data-history-moments-overview] button", node => node.click());
    await page.waitForSelector("[data-history-moments]");
    assert.match(await page.$eval("[data-history-moments]", node => node.textContent), /朋友圈与图片/);
    assert.ok(await page.$("[data-moments-finding]"));
    await page.$eval('[data-history-reading] [role=tablist]', node => [...node.querySelectorAll("button")].find(button => button.textContent.includes("好感与推理")).click());
    await page.waitForSelector("[data-history-findings]");
    assert.ok(await page.$('[data-history-findings] [data-reading-kind="counter"]'));
    assert.ok(await page.$('[data-history-findings] [data-reading-kind="fact"]'));
    const excerpt = await page.$('[data-history-insights] [data-reading-kind="inference"] [data-report-excerpt] details');
    assert.ok(excerpt, "long reasoning is folded, not cut");
    assert.match(await excerpt.evaluate(node => node.parentElement.textContent), /这段完整推理的末尾仍应保留/);
    await excerpt.evaluate(node => node.querySelector("summary").scrollIntoView({ block: "center" }));
    const before = await excerpt.evaluate(node => node.querySelector("summary").getBoundingClientRect().top);
    await excerpt.evaluate(node => node.querySelector("summary").click());
    const expanded = await excerpt.evaluate(node => node.open);
    assert.equal(expanded, true);
    assert.ok(Math.abs(await excerpt.evaluate(node => node.querySelector("summary").getBoundingClientRect().top) - before) < 3, "expanding keeps the control in place");
    await excerpt.evaluate(node => node.querySelector("summary").click());
    assert.ok(Math.abs(await excerpt.evaluate(node => node.querySelector("summary").getBoundingClientRect().top) - before) < 3, "collapsing returns to the same reading location");
    await fits();
    await page.screenshot({ path: `outputs/report-editorial/reasoning-${width}.png` });
    await page.$eval('[data-history-reading] [role=tablist]', node => [...node.querySelectorAll("button")].find(button => button.textContent.includes("最近逐句")).click());
    await page.waitForSelector("[data-history-recent-sentences]");
    const sample = await page.$eval("[data-history-recent-sentences]", node => node.textContent);
    assert.match(sample, /最近 2 条逐句解读/);
    assert.ok(sample.includes(`全量已读 ${full.semanticHistory.coverage.receivedText} 条`));
    assert.match(sample, /确认邀约安排/);
    assert.match(sample, /83%/);
    assert.match(sample, /74%/);
    assert.equal(await page.$eval("[data-message-composition]", node => node.getAttribute("aria-label")), statsBefore, "sample never replaces full statistics");
    assert.equal(full.lines.length, 0, "fixture keeps sample out of global report.lines");
    await page.$eval("[data-method-references] summary", node => node.click());
    assert.match(await page.$eval("[data-method-references] a", node => node.getAttribute("href")), /^\/library#/);
    assert.doesNotMatch(await page.$eval("[data-method-references]", node => node.textContent), /未经检索/);
    await fits();
    await page.screenshot({ path: `outputs/report-editorial/recent-${width}.png` });
    if (width === 1440) {
      report = structuredClone(full);
      report.recentSentenceAnalysis.annotations = [{ lineId: "recent-other", emotion: "平静回应", intent: "确认邀约安排", note: "旧文本格式保留解读，不编造权重。" }];
      report.relationshipDiagnosis.claimActions = [
        { id: "claim-action:commitment", claim: "做出后续承诺", status: "待核对", action: "旧误判", claimEvidence: '第 785 句 · record:synthetic:785：“原来保安的话，我会去图书馆呢，因为我就住在旁边。”' },
        { id: "claim-action:meetup", claim: "想见面或一起安排", status: "待核对", action: "确认具体时间", claimEvidence: '第 786 句 · record:synthetic:786：“周末一起看展吗？”' },
      ];
      await open();
      await page.$eval('[data-history-reading] [role=tablist]', node => [...node.querySelectorAll("button")].find(button => button.textContent.includes("最近逐句")).click());
      assert.match(await page.$eval("[data-history-recent-sentences]", node => node.textContent), /平静回应/);
      assert.doesNotMatch(await page.$eval("[data-history-recent-sentences]", node => node.textContent), /\d+%/);
      await page.$eval('[aria-label="报告阅读顺序"]', node => [...node.querySelectorAll("button")].find(button => button.textContent.includes("关系变化")).click());
      const claims = await page.$eval('[data-reading-section="change"]', node => node.textContent);
      assert.doesNotMatch(claims, /旧误判|原来保安|record:synthetic/);
      assert.match(claims, /第 786 句：“周末一起看展吗？/);
      // Reset the saved reader chapter before testing other old-report states.
      await page.$eval('[aria-label="报告阅读顺序"]', node => node.querySelector("button").click());
      report = { ...full, generatedAt: undefined };
      await open();
      assert.match(await page.$eval("[data-report-generated-time]", node => node.textContent), /未记录生成时间/);
      report = structuredClone(full);
      report.semanticHistory.sourceInsights.moments = { status: "no_supported_insight", summary: "这些动态已读取，但不足以判断对方的长期关系期待。", evidenceIds: [], unknowns: ["对方目前期待怎样的关系仍需核实。"] };
      await open();
      await page.$eval("[data-history-moments-overview] button", node => node.click());
      await page.waitForSelector("[data-moments-synthesis]");
      assert.match(await page.$eval("[data-moments-synthesis]", node => node.textContent), /动态已读取.*不足以判断/);
      assert.match(await page.$eval("[data-history-moments]", node => node.textContent), /期待怎样的关系仍需核实/);
    }
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}: meaningful risk categories, Moments section, retained expandable evidence, fact/inference/counter colors, recent-only sentence weights, full statistics, real method links and saved time; no paid calls`);
    await context.close();
  }
} finally { await browser.close(); }
