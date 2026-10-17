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
const owner = "deferred-voice-fixture-owner", friend = "虚构语音补全测试";
const out = path.resolve("outputs/capture-deferred-voice");
fs.mkdirSync(out, { recursive: true });
const beforeText = "这是合成材料中的第一条完整原文。";
const afterText = "这是合成材料中的最后一条完整原文。";
const firstVoice = "这是运行期间已经读出的第一条合成语音。";
const secondVoice = "这是停止响应保留的第二条合成语音。";
const source = (index, voice = false) => ({ label: "合成原文 " + index, method: "uia", order: "oldest-first",
  uiClass: voice ? "mmui::ChatVoiceItemView" : "mmui::ChatTextItemView",
  ...(voice ? { mediaKind: "voice", rawMediaLabel: '语音6"秒', durationSeconds: 6, transcriptionStatus: "not-transcribed" } : {}) });
const rows = [
  { id: "fixture-before", kind: "text", text: beforeText, sender: friend, senderRole: "other", at: "2026-10-15 08:00:00", source: source(1) },
  { id: "fixture-voice-1", kind: "other", text: '语音6"秒', sender: "合成用户", senderRole: "self", at: "2026-10-15 08:01:00", source: source(2, true) },
  { id: "fixture-voice-2", kind: "other", text: '语音6"秒', sender: "合成用户", senderRole: "self", at: "2026-10-15 08:02:00", source: source(3, true) },
  { id: "fixture-after", kind: "text", text: afterText, sender: friend, senderRole: "other", at: "2026-10-15 08:03:00", source: source(4) },
];
const batch = (converted) => ({ version: 1, kind: "chat", friend, account: "synthetic-wechat-account",
  capturedAt: `2026-10-15T08:0${converted + 4}:00Z`, warnings: [], records: rows.map((row, index) =>
    index > 0 && index <= converted ? { ...row, kind: "text", text: index === 1 ? firstVoice : secondVoice,
      source: { ...row.source, transcriptionStatus: "visible-text", transcriptionSource: "wechat-native-transcript-copy" } } : row) });
const bundle = await build({ entryPoints: ["lib/desktop-capture-vault.ts"], bundle: true, write: false,
  format: "iife", globalName: "DeferredVoiceVault", platform: "browser" });
const browser = await puppeteer.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox"], defaultViewport: { width: 1440, height: 1000 } });
const context = await browser.createBrowserContext(), page = await context.newPage();
const captures = [], siteWrites = [], bridgeCalls = [], blocked = [], errors = [];
let cancelled = false, runningResponses = 0;
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
      else if (url.pathname === "/health") value = { version: "fixture-deferred", ready: true,
        capabilities: { chat: true, moments: true, deferredVoice: true } };
      else if (url.pathname === "/pair") value = { token: "synthetic-loopback-token", expiresIn: 28800 };
      else if (url.pathname === "/capture") {
        captures.push(JSON.parse(request.postData()));
        value = { jobId: captures.length === 1 ? "fixture-quick" : "fixture-voice" };
      } else if (url.pathname === "/jobs/fixture-quick") value = { status: "completed", progress: 100, result: batch(0) };
      else if (url.pathname === "/jobs/fixture-voice/cancel") {
        cancelled = true;
        value = { status: "cancelled", partialRevision: 2, partial: batch(2), message: "合成任务已停止" };
      } else if (url.pathname === "/jobs/fixture-voice") {
        runningResponses++;
        value = cancelled ? { status: "cancelled", partialRevision: 2, partial: batch(2) }
          : { status: "running", progress: 40, message: "合成任务运行中，已有一条语音文字", partialRevision: 1, partial: batch(1) };
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
  const libraries = await DeferredVoiceVault.listCaptureLibraries(owner);
  if (libraries.length !== 1) return { libraries: libraries.length, records: [] };
  const library = await DeferredVoiceVault.getCaptureLibrary(owner, libraries[0].id);
  return { libraries: 1, records: library.records.map(row => ({ id: row.id, localId: row.localId, kind: row.kind, text: row.text, status: row.source.transcriptionStatus })) };
}, owner);

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
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].some(el => el.textContent.trim() === "停止采集"));
  assert.deepEqual(captures, [{ kind: "chat", friend, limit: 40, includeVoice: false }]);
  const initial = await snapshot(); assert.equal(initial.records.length, 4);
  assert.equal(initial.records.filter(row => row.kind === "other").length, 2);
  await new Promise(resolve => setTimeout(resolve, 1700));
  assert.equal(captures.length, 1, "Quick import must never launch voice conversion automatically");

  await click("补全语音 · 需微信前台");
  await page.waitForFunction(text => document.querySelector('[aria-label="采集原文列表"]')?.textContent.includes(text), { timeout: 20000 }, firstVoice);
  assert.deepEqual(captures[1], { kind: "chat", friend, limit: 40, includeVoice: true });
  assert.ok(runningResponses > 0); assert.equal(cancelled, false);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll("button")].some(el => el.textContent.trim() === "停止采集")), "Partial must display while job is running");
  const running = await snapshot();
  assert.equal(running.records.length, 4, "Partial upgrades original voice rather than duplicating it");
  assert.equal(running.records.find(row => row.id === "fixture-voice-1")?.text, firstVoice, "Running partial must already persist to IndexedDB");
  assert.equal(running.records.find(row => row.id === "fixture-voice-2")?.kind, "other");
  assert.deepEqual(running.records.map(row => row.localId), initial.records.map(row => row.localId));
  await new Promise(resolve => setTimeout(resolve, 1700));
  assert.equal((await snapshot()).records.length, 4, "Repeated partialRevision must not duplicate records");

  await click("停止采集");
  await page.waitForFunction(text => document.querySelector('[aria-label="采集原文列表"]')?.textContent.includes(text), { timeout: 15000 }, secondVoice);
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].some(el => el.textContent.trim() === "停止采集"));
  assert.equal(cancelled, true);
  const stopped = await snapshot();
  assert.equal(stopped.records.length, 4);
  assert.equal(stopped.records.filter(row => row.status === "visible-text").length, 2, "Cancellation partial preserves both converted voices");
  assert.deepEqual(stopped.records.map(row => row.localId), initial.records.map(row => row.localId));
  assert.equal(await page.evaluate(owner => sessionStorage.getItem(`chengzi-capture:${owner}:job`), owner), null);

  await page.reload({ waitUntil: "networkidle0" }); await loadVault();
  await page.waitForFunction(text => [...document.querySelectorAll("button")].some(el => el.textContent.includes(text)), {}, friend);
  await page.evaluate(text => [...document.querySelectorAll("button")].find(el => el.textContent.includes(text)).click(), friend);
  await page.waitForFunction(text => document.querySelector('[aria-label="采集原文列表"]')?.textContent.includes(text), {}, secondVoice);
  assert.deepEqual(await snapshot(), stopped, "Cancelled partial survives reload");
  await new Promise(resolve => setTimeout(resolve, 1700));
  assert.equal(captures.length, 2, "Reload must not restart capture or voice conversion");
  assert.deepEqual(siteWrites, [], "Capture must not analyze, upload or charge");
  assert.deepEqual(blocked, [], "No external network destination should be attempted");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(out, "cancelled-partial-persisted.png") });
  fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ passed: true, captures, runningResponses,
    persistedRecords: stopped.records.length, preservedVoiceTranscripts: 2, siteWrites, bridgeCalls }, null, 2));
  console.log("PASS deferred voice: quick includeVoice=false; no automatic conversion; explicit includeVoice=true; running partial shown and persisted; cancellation partial merged; IDs preserved; reload durable; no real WeChat/account/analysis requests.");
} catch (error) {
  await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  console.error(JSON.stringify({ captures, runningResponses, cancelled, errors, siteWrites, blocked,
    alert: await page.$$eval('[role="alert"]', nodes => nodes.map(node => node.textContent)).catch(() => []) }));
  throw error;
} finally { await context.close(); await browser.close(); }
