import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";

// Real browser + real IndexedDB + production merge/sync/state-machine code.
// The bridge and cloud transports contain synthetic records only, in memory.
const built = await build({ stdin: { contents: `import * as capture from './lib/desktop-capture';import * as vault from './lib/desktop-capture-vault';import * as cloud from './lib/capture-cloud-client';import * as historyImport from './lib/capture-history-import';import * as activity from './lib/chat-activity';Object.assign(window,{capture,vault,cloud,historyImport,activity});`,
  resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent" });
const server = createServer((request, response) => {
  response.setHeader("content-type", request.url === "/fixture.js" ? "application/javascript" : "text/html");
  response.end(request.url === "/fixture.js" ? built.outputFiles[0].text : '<!doctype html><meta charset="utf-8"><script src="/fixture.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"], protocolTimeout: 180_000 });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    Object.assign(window, { total: 21503, owner: "large-synthetic-owner", account: "large-synthetic-account", friend: "大样本合成联系人", at: "2026-10-16T00:00:00Z", jobs: new Map(), starts: [] });
    window.check = (value, message) => { if (!value) throw new Error(message); };
    window.row = (index, transcript = false) => {
      const voice = index % 997 === 0;
      return { id: `wechat-db:synthetic-large-${index}`, kind: voice && !transcript ? "other" : "text", sender: index % 2 ? friend : "我",
        senderRole: index % 2 ? "other" : "self", at: new Date(Date.UTC(2020, 0, 1) + Math.floor(index / 3) * 60_000).toISOString(),
        text: voice ? transcript ? `合成语音转写 ${index}` : "[语音]" : `合成完整历史正文 ${index}`,
        source: { label: "合成本地数据库", method: "wechat-local-db", accountId: account, sessionId: "synthetic-target", messageShard: `message_${index % 3}.db`, messageId: String(100_000 + index), localId: String(index),
          idStability: "stable", timestampOrigin: "wechat-create-time", order: "oldest-first", senderVerified: true,
          ...(voice ? { mediaKind: "voice", durationSeconds: 5, rawMediaLabel: "语音5秒", transcriptionStatus: transcript ? "visible-text" : "not-transcribed",
            voiceAvailability: transcript ? "transcribed" : "available", ...(transcript ? { transcriptionSource: "local-audio-asr", machineTranscribed: true, transcriptVerifiedByUser: false } : {}) } : {}) } };
    };
    window.batch = (offset, size = 500, transcript = false) => {
      const count = Math.min(size, total - offset), start = total - offset - count, more = offset + count < total;
      return { version: 1, kind: "chat", friend, account, capturedAt: at, warnings: [], records: Array.from({ length: count }, (_, index) => row(start + index, transcript)),
        history: { version: 1, direction: "backward", count, hasMore: more, complete: !more, nextCursor: more ? `cursor_${offset + count}` : null, snapshot: "large_synthetic_snapshot" } };
    };
    window.bridge = async (path, options = {}) => {
      if (path === "/capture") {
        check(options.body.pageSize === 500, "page is bounded");
        const id = `job_${starts.length + 1}`, offset = options.body.cursor ? Number(options.body.cursor.split("_")[1]) : 0;
        starts.push(options.body); jobs.set(id, batch(offset)); return { jobId: id };
      }
      const value = jobs.get(path.split("/")[2]); check(!!value, "known synthetic job");
      return { status: "completed", result: value };
    };
  });
  const imported = await page.evaluate(async () => {
    const began = performance.now();
    const result = await historyImport.runHistoryImport({ progress: historyImport.newHistoryProgress(owner, friend), request: bridge, pollMs: 0,
      accept: async value => { const accepted = await vault.saveCaptureBatch(owner, value); return { ...accepted, libraryId: accepted.library.id }; } });
    window.library = await vault.getCaptureLibrary(owner, result.libraryId);
    check(library.records.length === total, "real IndexedDB retains every row above 20,000");
    check(new Set(library.records.map(record => record.id)).size === total, "stable IDs remain unique");
    check(library.records.every((record, index) => record.id === `wechat-db:synthetic-large-${index}`), "backward pages preserve chronological evidence order");
    check((await vault.listCaptureLibraries(owner))[0].total === total, "summary count remains exact");
    check(await vault.getCaptureLibrary("foreign-owner", library.id) === null, "large library still enforces owner isolation");
    const summary = activity.computeChatActivity(library.records, { account });
    check(summary.messages === total && summary.self + summary.other + summary.unknown === total, "full local activity has no 20,000-row cap");
    const upload = activity.prepareChatActivityUpload(library.records, { account });
    check(upload.activityRecords.length === 0 && upload.notice.includes("21,503"), "large history upload is explicitly omitted, never silently sampled");
    check(activity.prepareChatActivityUpload(library.records.slice(0, 500), { account }).activityRecords.length === 500, "bounded reports keep the verified metadata protocol");
    return { count: result.progress.count, pages: result.progress.pages, added: result.added, statsMessages: summary.messages, ms: Math.round(performance.now() - began) };
  });
  assert.deepEqual([imported.count, imported.pages, imported.added, imported.statsMessages], [21503, 44, 21503, 21503]);
  console.log(`PASS 21,503 records across 44 pages: real IndexedDB + ordered merge + full local statistics (${imported.ms} ms)`);

  const replayed = await page.evaluate(async () => {
    const original = new Map(library.records.map(row => [row.id, row.localId])), sourceIds = [library.records[0].localId, library.records.at(-1).localId];
    await vault.linkReportSources(owner, "large-synthetic-report", { libraryId: library.id, sourceIds });
    const value = batch(500, 500, true), expected = value.records.filter(row => row.source.mediaKind === "voice").length;
    const enriched = await vault.saveCaptureBatch(owner, { ...value, capturedAt: "2026-10-16T01:00:00Z" });
    check(enriched.added === 0 && enriched.updatedVoice === expected, "voice rescan enriches the same source");
    const replay = await vault.saveCaptureBatch(owner, batch(500));
    check(replay.added === 0 && replay.updatedVoice === 0, "replayed placeholders do not downgrade transcripts");
    check(replay.library.records.every(row => original.get(row.id) === row.localId), "21k replay preserves every evidence localId");
    check(JSON.stringify((await vault.readReportSources(owner, "large-synthetic-report")).sourceIds) === JSON.stringify(sourceIds), "large history replay preserves report links");
    window.library = replay.library;
    return { total: replay.total, updatedVoice: enriched.updatedVoice };
  });
  assert.equal(replayed.total, 21503); assert.ok(replayed.updatedVoice > 0);
  console.log("PASS voice rescan and cancelled-page replay preserve all 21,503 evidence IDs and existing report links");

  await page.evaluate(() => {
    Object.assign(window, { remote: new Map(), cloudId: "cl_" + "a".repeat(64), uploadSizes: [], downloads: 0 });
    window.info = () => ({ id: cloudId, account, friend, kind: "chat", createdAt: at, updatedAt: at, total: remote.size, epoch: 1,
      subjectId: null, warnings: [], reportLinks: library.reportLinks, mediaIncluded: true });
    window.fetch = async (url, options = {}) => {
      const query = new URL(String(url), location.origin).searchParams, body = options.body ? JSON.parse(options.body) : null;
      let result;
      if (body?.action === "sync") {
        check(body.records.length <= 100, "cloud writes stay bounded at 100"); uploadSizes.push(body.records.length);
        for (const row of body.records) remote.set(row.localId, row);
        result = { ownerId: owner, library: info(), conflicts: [] };
      } else if (body?.action === "link-report") result = { ownerId: owner, library: info(), linked: true };
      else if (query.get("id") === cloudId) {
        downloads++; const start = Number(query.get("cursor")?.split("_")[1] || 0), rows = [...remote.values()].slice(start, start + 500);
        result = { ownerId: owner, library: info(), records: rows, nextCursor: start + rows.length < remote.size ? `page_${start + rows.length}` : null };
      } else throw new Error("unexpected synthetic cloud request");
      return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
    };
  });
  const uploaded = await page.evaluate(async () => {
    const began = performance.now();
    const synced = await cloud.syncCaptureLibrary(owner, library);
    check(synced.cloud.total === total && remote.size === total, "all rows upload without a hidden library limit");
    check(Object.keys((await vault.getCaptureLibrary(owner, library.id)).cloud.digests).length === total, "every uploaded row is acknowledged");
    return { count: remote.size, batches: uploadSizes.length, max: Math.max(...uploadSizes), ms: Math.round(performance.now() - began) };
  });
  assert.deepEqual([uploaded.count, uploaded.batches, uploaded.max], [21503, 216, 100]);
  console.log(`PASS synthetic cloud sync: all 21,503 records in 216 acknowledged uploads (${uploaded.ms} ms)`);

  const downloaded = await page.evaluate(async () => {
    const began = performance.now(), expected = new Map(library.records.map(row => [row.localId, [row.id, row.text]]));
    await vault.removeCaptureLibrary(owner, library.id);
    const restored = await cloud.downloadCloudCaptureLibrary(owner, cloudId);
    check(restored.records.length === total && restored.records.every(row => JSON.stringify(expected.get(row.localId)) === JSON.stringify([row.id, row.text])), "another-device download restores all original IDs and text");
    check((await vault.getCaptureLibrary(owner, restored.id)).records.length === total, "download persists the complete library");
    check((await vault.readReportSources(owner, "large-synthetic-report")).sourceIds.length === 2, "cross-device evidence links remain readable");
    return { count: restored.records.length, pages: downloads, ms: Math.round(performance.now() - began) };
  });
  assert.deepEqual([downloaded.count, downloaded.pages], [21503, 44]);
  console.log(`PASS synthetic cross-device download: 44 pages restore every record and report link (${downloaded.ms} ms)`);

  const corruptions = await page.evaluate(async () => {
    const originalFetch = fetch, one = [...remote.values()][0], results = [];
    for (const mode of ["duplicate", "empty-page", "cycle", "identity-change"]) {
      let calls = 0, rejected = false;
      window.fetch = async () => {
        calls++; check(calls < 5, "corrupt pagination must not loop");
        const records = mode === "empty-page" ? [] : [{ ...one, localId: mode === "duplicate" ? "same" : "item-" + calls }];
        const library = { ...info(), total: 3, ...(mode === "identity-change" && calls === 2 ? { friend: "different-friend" } : {}) };
        return new Response(JSON.stringify({ ownerId: owner, library, records, nextCursor: mode === "cycle" && calls === 3 ? "page_1" : "page_" + calls }));
      };
      try { await cloud.downloadCloudCaptureLibrary(owner, cloudId); } catch { rejected = true; }
      results.push({ mode, rejected, calls });
    }
    window.fetch = originalFetch;
    check((await vault.getCaptureLibrary(owner, library.id)).records.length === total, "failed downloads preserve the complete local library");
    return results;
  });
  assert.ok(corruptions.every(result => result.rejected && result.calls < 5));
  console.log("PASS corrupt cloud pages reject duplicate IDs, zero progress, cursor cycles and changed identity without replacing local history");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
