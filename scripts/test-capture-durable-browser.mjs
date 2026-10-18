import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

// Real React pages with synthetic, read-only responses. No collector, model,
// account mutation or credit operation is reached by this test.
const origin = process.env.INTAKE_TEST_ORIGIN || "http://127.0.0.1:8798";
const output = process.env.CAPTURE_BROWSER_OUTPUT || "D:/Temp/chengzi-capture-durable-browser";
const owner = "durable-browser-synthetic-owner", subjectId = "durable-browser-person";
const taskId = "11111111-2222-4333-8444-555555555555";
const bundled = await build({ entryPoints: ["data/public-report-cases.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { publicReports } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
const report = { ...publicReports.chat, id: taskId, reportId: taskId, subjectId };
const desktopUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const androidUA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_BIN || "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const results = [];

function job(status) {
  return { taskId, status, phase: status === "queued" ? "preparing" : status === "done" ? "complete" : "segments", totalCount: 675,
    completedText: status === "queued" ? 0 : status === "done" ? 675 : 260, completedImages: status === "queued" ? 0 : 2,
    error: status === "retrying" ? "分析服务暂时繁忙，正在继续同一任务。" : status === "error" ? "本次处理未完成，请稍后重试。" : "", creditTaskStatus: status === "error" ? "released" : "reserved" };
}
async function contextFor(width, android = false) {
  const context = await browser.createBrowserContext();
  await context.overridePermissions(origin, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  const page = await context.newPage(), errors = [], writes = [], statusReads = [];
  const fixture = { current: job("queued") };
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: android, hasTouch: android });
  await page.setUserAgent(android ? androidUA : desktopUA);
  await page.evaluateOnNewDocument(android => {
    Object.defineProperty(navigator, "platform", { get: () => android ? "Linux armv8l" : "Win32" });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => android ? 5 : 0 });
  }, android);
  page.on("pageerror", error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin !== origin && !url.protocol.startsWith("data") && !url.protocol.startsWith("blob")) {
      if (request.method() !== "GET") writes.push("external:" + url.pathname);
      return request.abort();
    }
    if (!url.pathname.startsWith("/api/")) return request.continue();
    if (request.method() !== "GET") writes.push(url.pathname);
    let value = {};
    if (url.pathname === "/api/auth/session") value = { loggedIn: true, user: { id: owner, name: "合成测试" } };
    if (url.pathname === "/api/account/credits") value = { account: { userId: owner, balance: 1000, active: true }, prices: { analysisSmall: 20, profile: 20 } };
    if (url.pathname === "/api/web/profile") value = { enabled: true, paused: false, self: {}, facts: [], subjects: [{ id: subjectId, label: "合成测试人物", updatedAt: Date.now() }] };
    if (url.pathname === "/api/web/capture/library") value = { ownerId: owner, libraries: [] };
    if (url.pathname === "/api/web/capture/analyze") { value = fixture.current; statusReads.push(fixture.current.status); }
    if (url.pathname === "/api/web/report/list") value = { reports: [], total: 0, page: 1, pageSize: 12 };
    if (url.pathname === "/api/web/report") value = { reportId: taskId, kind: "chat", subjectId, totalCount: 1, report, entries: [report] };
    return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
  });
  return { context, page, errors, writes, statusReads, fixture };
}
async function checkPanel(page, status) {
  await page.waitForSelector(`[data-capture-analysis="${status}"]`, { visible: true });
  const result = await page.$eval("[data-capture-analysis]", element => ({ text: element.textContent, link: element.querySelector("a")?.getAttribute("href"), progress: element.querySelector("progress") ? { value: element.querySelector("progress").value, max: element.querySelector("progress").max } : null }));
  if (["queued", "running", "retrying"].includes(status)) { assert.equal(result.progress.max, 675); assert.equal(result.progress.value, status === "queued" ? 0 : 260); assert.ok(result.text.includes("导入 675 条")); }
  if (status === "retrying") assert.ok(result.text.includes("同一任务"));
  if (status === "done") { assert.ok(result.text.includes("675 条已导入记录")); assert.equal(result.link, "/report?id=" + taskId); }
  if (status === "error") { assert.ok(result.text.includes("这次分析未完成")); assert.ok(result.text.includes("积分已退回")); assert.equal(result.link, undefined); }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  return result;
}
const isVisible = (page, selector) => page.$$eval(selector, elements => elements.some(element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden"; }));

try {
  for (const width of [1440, 390]) {
    const fixture = await contextFor(width, width === 390), { context, page, statusReads, writes, errors } = fixture;
    for (const path of ["/capture?method=computer&kind=chat&intent=person", "/relationship"]) {
      for (const status of ["queued", "running", "retrying", "done", "error"]) {
        fixture.fixture.current = job(status);
        await page.goto(origin + path, { waitUntil: "networkidle0", timeout: 60000 });
        await checkPanel(page, status);
        const before = statusReads.length;
        await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
        await checkPanel(page, status); assert.ok(statusReads.length > before, "Reload must restore through a GET");
        results.push({ width, path, status, reloadRestored: true });
      }
      fixture.fixture.current = job("running"); await page.goto(origin + path, { waitUntil: "networkidle0" }); await checkPanel(page, "running");
      fixture.fixture.current = job("done"); await page.evaluate(() => window.dispatchEvent(new Event("chengzi:capture-analysis"))); await checkPanel(page, "done");
      await page.screenshot({ path: `${output}/done-${path.startsWith("/capture") ? "capture" : "people"}-${width}.png`, fullPage: false });
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('[data-capture-analysis="done"] a')]);
      assert.equal(new URL(page.url()).pathname, "/report"); assert.equal(new URL(page.url()).searchParams.get("id"), taskId);
      await page.goto(origin + path, { waitUntil: "networkidle0" }); await checkPanel(page, "done");
      results.push({ width, path, completedFromPolling: true, leaveAndReturn: true, reportOpensWithoutSubmission: true });
    }
    fixture.fixture.current = {...job("running"),kind:"moments",totalCount:37,completedText:0,completedCaptions:24,completedImages:3};
    await page.goto(origin + "/relationship", {waitUntil:"networkidle0"});
    await page.waitForSelector('[data-capture-analysis="running"]');
    const momentsProgress=await page.$eval('[data-capture-analysis]',node=>({text:node.textContent,value:node.querySelector('progress').value,max:node.querySelector('progress').max,label:node.querySelector('progress').getAttribute('aria-label')}));
    assert.match(momentsProgress.text,/正在梳理全部朋友圈/);assert.match(momentsProgress.text,/24 条动态文字、3 张图片/);
    assert.equal(momentsProgress.value,24);assert.equal(momentsProgress.max,37);assert.equal(momentsProgress.label,"已核对的朋友圈文字");
    fixture.fixture.current={...fixture.fixture.current,status:"done",phase:"complete"};
    await page.reload({waitUntil:"networkidle0"});await page.waitForSelector('[data-capture-analysis="done"]');
    assert.match(await page.$eval('[data-capture-analysis]',node=>node.textContent),/完整朋友圈报告已保存/);
    results.push({width,momentsCaptionAndImageProgress:true});
    fixture.fixture.current = { status: "none" };
    await page.goto(origin + "/capture?method=computer&kind=chat&intent=person", { waitUntil: "networkidle0" });
    if (width === 390) {
      await page.waitForSelector('[data-mobile-handoff="true"]');
      assert.equal(await isVisible(page, 'a[download][href$=".exe"]'), false, "Android must not show a Windows download as the next step");
      assert.equal(await isVisible(page, '[data-tour="capture-friend"]'), false, "Android must not show the desktop contact form");
      assert.equal(await isVisible(page, "#capture-steps"), false);
      assert.equal(await page.$$eval("a", elements => elements.some(element => element.textContent.includes("先用截图分析") && element.getAttribute("href")?.startsWith("/analyze"))), true);
      const copyButton = await page.evaluateHandle(() => Array.from(document.querySelectorAll("button")).find(element => element.textContent === "复制到电脑继续的链接"));
      await copyButton.asElement().click();
      await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(element => element.textContent === "链接已复制"));
      assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes("/capture?method=computer"));
      await page.screenshot({ path: output + "/android-handoff-390.png", fullPage: true });
      results.push({ width, androidHandoff: true, noDesktopInstallerOrContactForm: true });
    } else assert.equal(await isVisible(page, 'a[download][href$=".exe"]'), true);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []); await context.close();
  }
  const narrow = await contextFor(390, false);
  narrow.fixture.current = { status: "none" };
  await narrow.page.goto(origin + "/capture?method=computer&kind=chat&intent=person", { waitUntil: "networkidle0" });
  assert.equal(await isVisible(narrow.page, 'a[download][href$=".exe"]'), true, "Narrow Windows window keeps desktop functionality");
  assert.equal(await narrow.page.$('[data-mobile-handoff="true"]'), null);
  assert.deepEqual(narrow.writes, []); assert.deepEqual(narrow.errors, []); await narrow.context.close();
  results.push({ width: 390, windowsUA: true, desktopImportAvailable: true });
  await writeFile(output + "/verification.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.length, output, writes: 0, results }));
} finally { await browser.close(); }
