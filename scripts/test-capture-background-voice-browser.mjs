import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { build } from "esbuild";

// Entirely synthetic. No request can reach the real desktop helper, account,
// analysis API or any external host. Requires a local built preview to serve UI.
const origin = process.env.INTAKE_TEST_ORIGIN || "http://127.0.0.1:8798";
const base = new URL(origin);
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname), "Use a local preview only");
const owner = "background-voice-fixture-owner", friend = "虚构语音补全测试";
const out = path.resolve("outputs/capture-background-voice");
fs.mkdirSync(out, { recursive: true });
const beforeText = "这是合成材料中的第一条完整原文。".repeat(65);
const afterText = "这是合成材料中的最后一条完整原文。";
const firstVoice = "这是运行期间已经读出的第一条合成语音。";
const secondVoice = "这是手机同步后才转写出的第二条合成语音。";
const source = (index, voice = false) => ({ label: "合成原文 " + index, method: "wechat-local-db", order: "oldest-first", accountId: "synthetic-wechat-account", sessionId: "synthetic-friend-wxid", messageShard: "message_0.db", messageId: String(index),
  uiClass: voice ? "mmui::ChatVoiceItemView" : "mmui::ChatTextItemView",
  ...(voice ? { mediaKind: "voice", rawMediaLabel: '语音6"秒', durationSeconds: 6, transcriptionStatus: "not-transcribed", voiceAvailability: index === 3 ? "missing-local" : "available" } : {}) });
const rows = [
  { id: "fixture-before", kind: "text", text: beforeText, sender: friend, senderRole: "other", at: "2026-10-15 08:00:00", source: source(1) },
  { id: "fixture-voice-1", kind: "other", text: '语音6"秒', sender: "合成用户", senderRole: "self", at: "2026-10-15 08:01:00", source: source(2, true) },
  { id: "fixture-voice-2", kind: "other", text: '语音6"秒', sender: "合成用户", senderRole: "self", at: "2026-10-15 08:02:00", source: source(3, true) },
  { id: "fixture-after", kind: "text", text: afterText, sender: friend, senderRole: "other", at: "2026-10-15 08:03:00", source: source(4) },
];
let synchronized = false;
const batch = (converted) => ({ version: 1, kind: "chat", friend, account: "synthetic-wechat-account",
  capturedAt: `2026-10-15T08:0${converted + 4}:00Z`, warnings: [], records: rows.map((row, index) =>
    index > 0 && index <= converted ? { ...row, kind: "text", text: index === 1 ? firstVoice : secondVoice,
      source: { ...row.source, transcriptionStatus: "visible-text", transcriptionSource: "local-audio-asr", voiceAvailability: "transcribed" } } : synchronized && index === 2 ? { ...row, source: { ...row.source, voiceAvailability: "available" } } : row) });
const bundle = await build({ entryPoints: ["lib/desktop-capture-vault.ts"], bundle: true, write: false,
  format: "iife", globalName: "BackgroundVoiceVault", platform: "browser" });
const browser = await puppeteer.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox"], defaultViewport: { width: 1440, height: 1000 } });
const context = await browser.createBrowserContext(), page = await context.newPage();
const captures = [], siteWrites = [], bridgeCalls = [], blocked = [], errors = [];
let cancelled = false, runningResponses = 0, firstStage = 0, syncStage = 0, cachedStage = 0;
page.on("pageerror", error => errors.push(error.message));
await page.setRequestInterception(true);
page.on("request", async request => {
  try {
    const url = new URL(request.url());
    const bridge = url.hostname === "127.0.0.1" && url.port === "17863";
    if (!bridge && url.origin !== base.origin) {
      if (["data:", "blob:"].includes(url.protocol)) return request.continue();
      blocked.push(url.origin + url.pathname); return request.abort("blockedbyclient");
    }
    if (!bridge && !url.pathname.startsWith("/api/")) return request.continue();
    let value = {}, status = 200;
    if (bridge) {
      bridgeCalls.push({ path: url.pathname, method: request.method() });
      if (request.method() === "OPTIONS") value = {};
      else if (url.pathname === "/health") value = { version: "1.1.0-fixture", ready: false, backgroundMaxRows: 1000, backgroundModelReady: false, message: "合成 Qt 界面不可读取",
        capabilities: { chat: false, moments: false, deferredVoice: true, backgroundChat: true, backgroundVoice: true } };
      else if (url.pathname === "/pair") value = { token: "synthetic-loopback-token", expiresIn: 28800 };
      else if (url.pathname === "/capture") {
        captures.push(JSON.parse(request.postData()));
        value = { jobId: ["fixture-first", "fixture-sync", "fixture-cached"][captures.length - 1] || "unexpected-job" };
      } else if (url.pathname === "/jobs/fixture-sync/cancel") {
        cancelled = true;
        value = { status: "cancelled", partialRevision: 2, partial: batch(2), message: "合成任务已停止" };
      } else if (url.pathname === "/jobs/fixture-first") {
        runningResponses++;
        value = firstStage >= 2 ? { status: "completed", progress: 100, result: batch(1) }
          : { status: "running", progress: firstStage ? 70 : 25, message: "文字已导入，正在补全语音", partialRevision: firstStage + 1, partial: batch(firstStage) };
      } else if (url.pathname === "/jobs/fixture-sync") {
        runningResponses++;
        value = cancelled ? { status: "cancelled", partialRevision: 2, partial: batch(2) }
          : { status: "running", progress: syncStage ? 90 : 25, message: "正在补全新同步的语音", partialRevision: syncStage + 1, partial: batch(syncStage + 1) };
      } else if (url.pathname === "/jobs/fixture-cached") {
        runningResponses++;
        value = cachedStage ? { status: "completed", progress: 100, result: batch(2) }
          : { status: "running", progress: 25, message: "正在核对已缓存语音", partialRevision: 1, partial: batch(0) };
      } else { status = 404; value = { error: { message: "未声明的合成接口" } }; }
    } else {
      if (request.method() !== "GET") siteWrites.push(url.pathname);
      if (url.pathname === "/api/auth/session") value = { loggedIn: true, user: { id: owner } };
      else if (url.pathname === "/api/account/credits") value = { account: { userId: owner, balance: 100, active: true }, prices: { analysisSmall: 3, profile: 5 } };
      else if (url.pathname === "/api/web/profile") value = { enabled: true, paused: false, subjects: [] };
    }
    await request.respond({ status, contentType: "application/json", headers: {
      "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Allow-Private-Network": "true",
    }, body: JSON.stringify(value) });
  } catch (error) { errors.push("mock: " + error.message); }
});
const click = async (text) => {
  await page.waitForFunction(text => [...document.querySelectorAll("button")].some(el => el.textContent.trim() === text && !el.disabled), { timeout: 15000 }, text);
  assert.equal(await page.evaluate(text => {
    const el = [...document.querySelectorAll("button")].find(el => el.textContent.trim() === text && !el.disabled);
    if (!el) return false; el.click(); return true;
  }, text), true, "button " + text);
};
const loadVault = () => page.addScriptTag({ content: bundle.outputFiles[0].text });
const snapshot = () => page.evaluate(async owner => {
  const libraries = await BackgroundVoiceVault.listCaptureLibraries(owner);
  if (libraries.length !== 1) return { libraries: libraries.length, records: [] };
  const library = await BackgroundVoiceVault.getCaptureLibrary(owner, libraries[0].id);
  return { libraries: 1, reportLinks: library.reportLinks, records: library.records.map(row => ({ id: row.id, localId: row.localId, kind: row.kind, text: row.text, status: row.source.transcriptionStatus, availability: row.source.voiceAvailability })) };
}, owner);
const waitIdle = () => page.waitForFunction(() => ![...document.querySelectorAll("button")].some(el => el.textContent.trim() === "停止采集"));
const assertReading = async (readingTop, selection) => {
  assert.equal(await page.$eval('input[placeholder="搜索原文、时间或说话人"]', el => el.value), "合成", "Capture updates must preserve search");
  assert.equal(await page.$eval('[aria-label="采集原文列表"]', el => el.scrollTop), readingTop, "Capture updates must preserve reading position");
  assert.equal(await page.$$eval('[aria-label="采集原文列表"] input:checked', nodes => nodes.length), selection, "Capture updates must preserve selection");
};

try {
  await page.goto(origin + "/capture?method=desktop", { waitUntil: "networkidle0", timeout: 45000 });
  await page.waitForSelector("#capture-code");
  if (await page.$('[aria-label="关闭操作引导"]')) await page.click('[aria-label="关闭操作引导"]');
  await loadVault();
  await page.type("#capture-code", "ABCDEFGH"); await click("连接");
  await page.waitForFunction(() => document.body.textContent.includes("已连接本机助手"));
  await page.type('input[placeholder="填写准确的好友备注或昵称"]', friend);
  await click("快速导入聊天");
  await page.waitForFunction(text => document.querySelector('[aria-label="采集原文列表"]')?.textContent.includes(text), { timeout: 20000 }, beforeText);
  assert.deepEqual(captures, [{ kind: "chat", friend, limit: 40, includeVoice: true, mode: "background" }]);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll("button")].some(el => el.textContent.trim() === "停止采集")), "Text must already be visible while the same one-click job transcribes audio");
  assert.equal(await page.evaluate(() => document.querySelector("details")?.open), false, "Sync guide is optional and collapsed");
  assert.ok(await page.evaluate(() => document.querySelector("[data-capture-coverage]")?.textContent.includes("待手机同步 1 条")), "Missing local audio must be distinct from unread voice");
  const initial = await snapshot(); assert.equal(initial.records.length, 4);
  assert.equal(initial.records.filter(row => row.kind === "other").length, 2);
  // Seed a pre-existing report using only the local synthetic vault. An audio
  // upgrade must keep this link and the original source IDs intact.
  await page.evaluate(async owner => {
    const summaries = await BackgroundVoiceVault.listCaptureLibraries(owner);
    const library = await BackgroundVoiceVault.getCaptureLibrary(owner, summaries[0].id);
    await BackgroundVoiceVault.linkReportSources(owner, "synthetic-existing-report", {
      libraryId: library.id, sourceIds: library.records.slice(0, 2).map(row => row.localId) });
  }, owner);
  const linked = await snapshot();
  await page.type('input[placeholder="搜索原文、时间或说话人"]', "合成");
  await page.evaluate(() => { document.querySelector('[aria-label="采集原文列表"]').scrollTop = 160; });
  const readingTop = await page.$eval('[aria-label="采集原文列表"]', el => el.scrollTop);
  const selection = await page.$$eval('[aria-label="采集原文列表"] input:checked', nodes => nodes.length);
  assert.ok(readingTop > 100);
  firstStage = 1;
  await page.waitForFunction(text => document.querySelector('[aria-label="采集原文列表"]')?.textContent.includes(text), { timeout: 20000 }, firstVoice);
  await assertReading(readingTop, selection);
  assert.ok(runningResponses > 0); assert.equal(cancelled, false);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll("button")].some(el => el.textContent.trim() === "停止采集")), "Partial must display while job is running");
  const running = await snapshot();
  assert.equal(running.records.length, 4, "Partial upgrades original voice rather than duplicating it");
  assert.equal(running.records.find(row => row.id === "fixture-voice-1")?.text, firstVoice, "Running partial must already persist to IndexedDB");
  assert.equal(running.records.find(row => row.id === "fixture-voice-2")?.kind, "other");
  assert.deepEqual(running.records.map(row => row.localId), initial.records.map(row => row.localId));
  assert.deepEqual(running.reportLinks, linked.reportLinks);
  await new Promise(resolve => setTimeout(resolve, 1700));
  assert.equal((await snapshot()).records.length, 4, "Repeated partialRevision must not duplicate records");
  firstStage = 2;
  await waitIdle();
  await assertReading(readingTop, selection);
  const completed = await snapshot();
  assert.equal(completed.records.filter(row => row.status === "visible-text").length, 1, "First import completes available voice automatically");
  assert.equal(completed.records.find(row => row.id === "fixture-voice-2")?.availability, "missing-local", "Missing audio must not receive invented text");
  assert.equal(captures.length, 1, "One click must use one job for both text and audio");
  assert.deepEqual(completed.reportLinks, linked.reportLinks);

  await click("同步缺少的语音");
  assert.equal(await page.evaluate(() => document.querySelector("details")?.open), true);
  // Simulate the user actually synchronizing the phone, not merely clicking a
  // button. The next partial still has an untranslated voice until ASR finishes.
  synchronized = true;
  await click("已同步，重新检查");
  await page.waitForFunction(() => document.querySelector("[data-capture-coverage]")?.textContent.includes("本机可转写 1 条"));
  assert.deepEqual(captures[1], { kind: "chat", friend, limit: 40, includeVoice: true, mode: "background" });
  const synced = await snapshot();
  assert.equal(synced.records.length, 4);
  assert.equal(synced.records.find(row => row.id === "fixture-voice-2")?.kind, "other");
  assert.equal(synced.records.find(row => row.id === "fixture-voice-2")?.availability, "available");
  assert.equal(await page.evaluate(() => document.querySelector("[data-capture-coverage]")?.textContent.includes("待手机同步")), false);
  await assertReading(readingTop, selection);
  syncStage = 1;
  await page.waitForFunction(text => document.querySelector('[aria-label="采集原文列表"]')?.textContent.includes(text), { timeout: 15000 }, secondVoice);

  await click("停止采集");
  await waitIdle();
  assert.equal(cancelled, true);
  const stopped = await snapshot();
  assert.equal(stopped.records.length, 4);
  assert.equal(stopped.records.filter(row => row.status === "visible-text").length, 2, "Cancellation partial preserves both converted voices");
  assert.deepEqual(stopped.records.map(row => row.localId), initial.records.map(row => row.localId));
  assert.deepEqual(stopped.reportLinks, linked.reportLinks);
  assert.equal(await page.evaluate(owner => sessionStorage.getItem(`chengzi-capture:${owner}:job`), owner), null);

  // Re-importing cached material first emits raw DB placeholders. Known text
  // must remain visible, and the finished result must not duplicate records.
  await click("快速导入聊天");
  await page.waitForFunction(() => document.body.textContent.includes("正在核对已缓存语音"));
  assert.deepEqual(captures[2], { kind: "chat", friend, limit: 40, includeVoice: true, mode: "background" });
  assert.deepEqual(await snapshot(), stopped, "Raw re-import partial must preserve existing transcripts and report links");
  await assertReading(readingTop, selection);
  cachedStage = 1;
  await waitIdle();
  assert.deepEqual(await snapshot(), stopped, "Cached re-import must not duplicate or downgrade messages");
  await assertReading(readingTop, selection);

  await page.reload({ waitUntil: "networkidle0" }); await loadVault();
  await page.waitForFunction(text => [...document.querySelectorAll("button")].some(el => el.textContent.includes(text)), {}, friend);
  await page.evaluate(text => [...document.querySelectorAll("button")].find(el => el.textContent.includes(text)).click(), friend);
  await page.waitForFunction(text => document.querySelector('[aria-label="采集原文列表"]')?.textContent.includes(text), {}, secondVoice);
  assert.deepEqual(await snapshot(), stopped, "One-click transcripts and prior report sources survive reload");
  await new Promise(resolve => setTimeout(resolve, 1700));
  assert.equal(captures.length, 3, "Reload must not restart capture or voice conversion");
  assert.deepEqual(siteWrites, [], "Capture must not analyze, upload or charge");
  assert.deepEqual(blocked, [], "No external network destination should be attempted");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(out, "one-click-voice-persisted.png") });
  fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ passed: true, captures, runningResponses,
    persistedRecords: stopped.records.length, preservedVoiceTranscripts: 2, siteWrites, bridgeCalls }, null, 2));
  console.log("PASS background voice: UI ready=false bypassed only with background caps; one click saves text then audio in the same job; missing audio stays untranslated until sync; cached re-import preserves transcripts/report sources/reading; cancellation durable; no analysis or real account requests.");
} catch (error) {
  await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  console.error(JSON.stringify({ captures, runningResponses, cancelled, errors, siteWrites, blocked,
    alert: await page.$$eval('[role="alert"]', nodes => nodes.map(node => node.textContent)).catch(() => []) }));
  throw error;
} finally { await context.close(); await browser.close(); }
