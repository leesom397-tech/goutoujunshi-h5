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
const out = path.resolve("outputs/capture-background-unavailable");
fs.mkdirSync(out, { recursive: true });
const beforeText = "这是合成材料中的第一条完整原文。".repeat(65);
const afterText = "这是合成材料中的最后一条完整原文。";
const firstVoice = "这是运行期间已经读出的第一条合成语音。";
const secondVoice = "这是停止响应保留的第二条合成语音。";
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
let cancelled = false, runningResponses = 0;
let helperState = "ready";
const unavailableMessage = "当前微信版本暂不支持后台读取，已保存的材料仍可查看。";
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
      else if (url.pathname === "/health") value = { version: "1.1.0-fixture", ready: helperState === "foreground", backgroundModelReady: false, message: "合成 Qt 界面不可读取", backgroundStatus: helperState === "ready" ? "ready" : "unavailable", backgroundMessage: helperState === "ready" ? "" : unavailableMessage,
        capabilities: { chat: helperState === "foreground", moments: false, deferredVoice: true, backgroundChat: helperState === "ready", backgroundVoice: helperState === "ready" } };
      else if (url.pathname === "/pair") value = { token: "synthetic-loopback-token", expiresIn: 28800 };
      else if (url.pathname === "/capture") {
        captures.push(JSON.parse(request.postData()));
        if (!captures.at(-1).includeVoice && captures.length > 1) synchronized = true;
        value = { jobId: captures.at(-1).includeVoice ? "fixture-voice" : "fixture-quick" };
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
  const libraries = await BackgroundVoiceVault.listCaptureLibraries(owner);
  if (libraries.length !== 1) return { libraries: libraries.length, records: [] };
  const library = await BackgroundVoiceVault.getCaptureLibrary(owner, libraries[0].id);
  return { libraries: 1, records: library.records.map(row => ({ id: row.id, localId: row.localId, kind: row.kind, text: row.text, status: row.source.transcriptionStatus, availability: row.source.voiceAvailability })) };
}, owner);

try {
  await page.goto(origin + "/capture?method=desktop", { waitUntil: "networkidle0", timeout: 45000 });
  await page.waitForSelector("#capture-code");
  if (await page.$('[aria-label="关闭操作引导"]')) await page.click('[aria-label="关闭操作引导"]');
  await loadVault();
  await page.evaluate(async ({owner,batch}) => BackgroundVoiceVault.saveCaptureBatch(owner,batch), {owner,batch:batch(0)});
  const initial = await snapshot();
  await page.reload({waitUntil:"networkidle0"}); await loadVault();
  if (await page.$('[aria-label="关闭操作引导"]')) await page.click('[aria-label="关闭操作引导"]');
  await page.type("#capture-code", "ABCDEFGH"); await click("连接");
  await page.waitForFunction(text => [...document.querySelectorAll("button")].some(el=>el.textContent.includes(text)&&!el.disabled),{},friend);
  await page.evaluate(text=>[...document.querySelectorAll("button")].find(el=>el.textContent.includes(text)).click(),friend);
  await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(el=>el.textContent.trim()==="后台补全语音"&&!el.disabled));
  helperState = "unavailable";
  await click("后台补全语音");
  await page.waitForFunction(text=>document.querySelector('[role="alert"]')?.textContent===text,{},unavailableMessage);
  assert.equal(await page.$eval('[role="alert"]',el=>el.textContent),unavailableMessage,"DB capability failure must precede the UI-ready error");
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll("button")].some(el=>el.textContent.trim()==="后台补全暂不可用"&&el.disabled)));
  assert.equal(await page.evaluate(()=>document.body.textContent.includes("已支持后台读取聊天")),false);
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll("button")].some(el=>el.textContent.trim()==="补全语音 · 需微信前台")),false,"DB sources must not fall back to foreground voice");
  assert.deepEqual(captures,[],"Unavailable capability must not launch capture");
  helperState = "foreground";
  await click("断开"); await page.type("#capture-code", "ABCDEFGH"); await click("连接");
  await page.waitForFunction(()=>document.body.textContent.includes("当前使用微信界面采集。采集期间需保持微信在前台"));
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll("button")].some(el=>el.textContent.trim()==="后台补全暂不可用"&&el.disabled)),"A readable UI cannot enable DB voice fallback");
  assert.equal(await page.evaluate(()=>document.body.textContent.includes("请下载并启动新版")),false);
  assert.deepEqual(await snapshot(),initial,"Capability changes preserve saved source records");
  assert.deepEqual(captures,[]);
  assert.deepEqual(siteWrites,[]);
  assert.deepEqual(blocked,[]);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(out,"unavailable.png")});
  fs.writeFileSync(path.join(out,"result.json"),JSON.stringify({passed:true,blockedCaptureRequests:captures.length,preservedRecords:initial.records.length,siteWrites,bridgeCalls},null,2));
  console.log("PASS unavailable background: history cannot imply capability; refresh capability failure precedes UI readiness; DB voice disabled without foreground fallback; foreground occupancy disclosed; saved sources preserved; no real account/helper/network access.");
} catch(error) { console.error(JSON.stringify({error:error.message,errors,captures,buttons:await page.$$eval("button",els=>els.map(e=>({text:e.textContent,disabled:e.disabled}))),alerts:await page.$$eval('[role="alert"]',els=>els.map(e=>e.textContent))})); await page.screenshot({path:path.join(out,"failure.png")}); throw error; } finally { await context.close(); await browser.close(); }
