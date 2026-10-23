import assert from "node:assert/strict";
import { clearHistoryProgress, newHistoryProgress, readHistoryProgress, writeHistoryProgress, runHistoryImport } from "../lib/capture-history-import.ts";

class FakeStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
  clear() { this.data.clear(); }
}
const storage = new FakeStorage();
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
const owner = "synthetic-owner", friend = "合成联系人";
const fresh = () => newHistoryProgress(owner, friend);
const clone = value => structuredClone(value);
const notFound = () => Object.assign(new Error("synthetic missing job"), { status: 404, code: "JOB_NOT_FOUND" });

function makeBatch(body, total, { transcript = false, voice = false, account = "synthetic-account" } = {}) {
  if (body.voiceOnly) return {
    version: 1, kind: "chat", friend: body.friend, account, capturedAt: "2026-10-20T01:00:00Z", warnings: [],
    records: body.voiceIds.map(ref => ({ id: `wechat-db:voice-${ref.messageId}`, kind: transcript ? "text" : "other",
      sender: "合成发言人", senderRole: "other", at: "2026-10-20T00:00:00Z", text: transcript ? "合成语音文字" : "[语音]",
      source: { label: "合成语音", method: "wechat-local-db", accountId: account, ...ref,
        mediaKind: "voice", transcriptionStatus: transcript ? "visible-text" : "not-transcribed" } })),
    history: { version: 1, direction: body.direction, count: body.voiceIds.length, hasMore: false, nextCursor: null,
      snapshot: `voices_${body.voiceIds[0].messageId}`, complete: true },
  };
  let upper = total, lower = body.since ? Number(body.since.split("_")[1]) : 0, offset = 0;
  if (body.cursor) [, upper, lower, offset] = body.cursor.split("_").map((value, index) => index ? Number(value) : value);
  const count = Math.max(0, Math.min(body.pageSize, upper - lower - offset));
  const start = body.direction === "forward" ? lower + offset : upper - offset - count;
  const hasMore = offset + count < upper - lower;
  return { version: 1, kind: "chat", friend: body.friend, account, capturedAt: "2026-10-16T01:00:00Z", warnings: [],
    records: Array.from({ length: count }, (_, index) => {
      const number = start + index, isVoice = voice && number % 37 === 0;
      return { id: `wechat-db:synthetic-${number}`, kind: isVoice && !transcript ? "other" : "text", sender: "合成发言人",
        senderRole: "other", at: "2026-10-16T00:00:00Z", text: isVoice ? transcript ? `合成转写 ${number}` : "[语音]" : `合成原文 ${number}`,
        source: { label: "合成数据库", method: "wechat-local-db", accountId: account,
          ...(isVoice ? { mediaKind: "voice", transcriptionStatus: transcript ? "visible-text" : "not-transcribed" } : {}) } };
    }),
    history: { version: 1, direction: body.direction, count, hasMore,
      nextCursor: hasMore ? `c_${upper}_${lower}_${offset + count}` : null, snapshot: `sample_${upper}`, complete: !hasMore } };
}
class FakeBridge {
  total = 2703; jobs = new Map(); starts = []; calls = []; voice = false; hook;
  request = async (path, options = {}) => {
    this.calls.push({ path, body: clone(options.body) });
    if (options.signal?.aborted) throw new DOMException("cancelled", "AbortError");
    if (path === "/capture") {
      const body = clone(options.body), id = `job_${this.starts.length + 1}`;
      assert.equal(body.pageSize, body.includeVoice ? 100 : 500); assert.equal(body.mode, "background"); assert.equal(body.kind, "chat");
      assert.equal("limit" in body, false);
      this.starts.push(body);
      this.jobs.set(id, { id, body, reads: 0, cancelled: false,
        result: makeBatch(body, this.total, { voice: this.voice, transcript: true }),
        partial: makeBatch(body, this.total, { voice: this.voice }) });
      return { jobId: id };
    }
    const id = path.split("/")[2], job = this.jobs.get(id);
    if (!job) throw notFound();
    if (path.endsWith("/cancel")) { job.cancelled = true; return { status: "cancelled", partial: clone(job.partial), partialRevision: 1 }; }
    job.reads++;
    if (this.hook) {
      const custom = await this.hook(job);
      if (custom !== undefined) return clone(custom);
    }
    return clone(job.cancelled ? { status: "cancelled" } : this.voice && job.reads === 1 ?
      { status: "running", partial: job.partial, partialRevision: 1 } : { status: "completed", result: job.result });
  };
}
class FakeVault {
  rows = new Map(); accepted = [];
  accept = async (batch, interim) => {
    let added = 0, updatedVoice = 0;
    for (const row of batch.records) {
      const old = this.rows.get(row.id);
      if (!old) { this.rows.set(row.id, clone(row)); added++; }
      else if (row.source.transcriptionStatus === "visible-text" && old.source.transcriptionStatus !== "visible-text") {
        this.rows.set(row.id, clone(row)); updatedVoice++;
      }
    }
    this.accepted.push({ interim, ids: batch.records.map(row => row.id) });
    return { added, updatedVoice, total: this.rows.size, libraryId: `library:${batch.account}:${batch.friend}` };
  };
}
const run = (bridge, vault, progress = fresh(), extra = {}) => runHistoryImport({ progress, request: bridge.request,
  accept: vault.accept, includeVoice: bridge.voice, pollMs: 0, ...extra });
let passed = 0;
async function test(name, body) { storage.clear(); await body(); passed++; console.log(`ok ${passed} - ${name}`); }

await test("2,703 messages use six serial pages and save only checkpoint metadata", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(), updates = [], jobs = [];
  const result = await run(bridge, vault, fresh(), { onProgress: update => updates.push(update), onJob: id => jobs.push(id) });
  assert.equal(result.added, 2703); assert.equal(result.total, 2703); assert.equal(result.progress.count, 2703);
  assert.equal(result.progress.pages, 6); assert.equal(result.progress.complete, true); assert.equal(result.progress.pendingJob, null);
  assert.equal(bridge.starts.length, 6); assert.equal(new Set(vault.rows.keys()).size, 2703);
  assert.equal(jobs.at(-1), null); assert.equal(updates.at(-1).complete, true);
  const saved = readHistoryProgress(owner, friend);
  assert.deepEqual(saved, result.progress);
  const raw = [...storage.data.values()].join("");
  assert.doesNotMatch(raw, /合成原文|合成转写|records|Authorization|token/);
  assert.deepEqual(Object.keys(saved).sort(), ["version", "owner", "friend", "account", "direction", "cursor", "since", "snapshot", "count", "pages", "complete", "pendingJob"].sort());
});

await test("selected contact identity is sent on every history page", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault();
  const contact = { contactId: "synthetic-wxid-yaxin", accountKey: "synthetic-account-key" };
  await run(bridge, vault, fresh(), { contact });
  assert.equal(bridge.starts.length, 6);
  assert.ok(bridge.starts.every(body => body.contactId === contact.contactId && body.accountKey === contact.accountKey));
  assert.equal(readHistoryProgress(owner, friend).friend, friend);
  const raw = [...storage.data.values()].join("");
  assert.doesNotMatch(raw, /synthetic-wxid-yaxin|synthetic-account-key/);
});

await test("deleting a library checkpoint or clearing browser storage restores the full history", async () => {
  const firstBridge = new FakeBridge();
  await run(firstBridge, new FakeVault());
  assert.equal(readHistoryProgress(owner, friend).complete, true);
  writeHistoryProgress(newHistoryProgress(owner, "相邻联系人"));
  writeHistoryProgress(newHistoryProgress("another-owner", friend));

  clearHistoryProgress(owner, ` ${friend} `);
  clearHistoryProgress(owner, friend);
  assert.equal(readHistoryProgress(owner, friend), null);
  assert.ok(readHistoryProgress(owner, "相邻联系人"));
  assert.ok(readHistoryProgress("another-owner", friend));

  for (const clearBrowserStorage of [false, true]) {
    if (clearBrowserStorage) storage.clear();
    const plan = newHistoryProgress(owner, friend, readHistoryProgress(owner, friend));
    assert.equal(plan.direction, "backward");
    assert.equal(plan.since, null); assert.equal(plan.cursor, null);
    assert.equal(plan.snapshot, null); assert.equal(plan.pendingJob, null);
    assert.equal(plan.account, null); assert.equal(plan.count, 0); assert.equal(plan.pages, 0);
    const restoredBridge = new FakeBridge(), emptyVault = new FakeVault();
    const restored = await run(restoredBridge, emptyVault, plan);
    assert.equal(restoredBridge.starts[0].since, undefined);
    assert.equal(restoredBridge.starts[0].cursor, undefined);
    assert.equal(restoredBridge.starts.length, 6);
    assert.equal(restored.progress.complete, true);
    assert.equal(restored.added, 2703); assert.equal(emptyVault.rows.size, 2703);
  }
});

await test("voice partial, failed second page, reload and retry retain text without advancing early", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(); bridge.voice = true;
  let failed = false;
  bridge.hook = job => {
    if (!failed && job.body.cursor && job.reads === 2) {
      failed = true;
      return { status: "failed", partial: job.result, partialRevision: 2, error: { message: "synthetic ASR failed" } };
    }
  };
  await assert.rejects(run(bridge, vault), /ASR failed/);
  const checkpoint = readHistoryProgress(owner, friend);
  assert.equal(checkpoint.count, 100); assert.equal(checkpoint.pages, 1); assert.equal(checkpoint.pendingJob, null);
  assert.equal(vault.rows.size, 200);
  const pending = checkpoint.cursor, existingTranscripts = [...vault.rows.values()].filter(row => row.source.transcriptionStatus === "visible-text").length;
  assert.ok(existingTranscripts > 0);
  const result = await run(bridge, vault, newHistoryProgress(owner, friend, checkpoint));
  assert.equal(bridge.starts[2].cursor, pending); assert.equal(result.progress.count, 2703);
  assert.equal(result.added, 2503); assert.equal(vault.rows.size, 2703);
  assert.ok([...vault.rows.values()].filter(row => row.source.transcriptionStatus === "visible-text").length > existingTranscripts);
});

await test("abort after accepting voice partial cancels the worker and safely replays the page", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(), controller = new AbortController(); bridge.voice = true;
  await assert.rejects(run(bridge, vault, fresh(), { signal: controller.signal, accept: async (batch, interim) => {
    const accepted = await vault.accept(batch, interim); if (interim) controller.abort(); return accepted;
  } }), { name: "AbortError" });
  const stopped = readHistoryProgress(owner, friend);
  assert.equal(stopped.count, 0); assert.equal(stopped.pages, 0); assert.equal(stopped.cursor, null); assert.equal(stopped.pendingJob, null);
  assert.equal(vault.rows.size, 100); assert.ok(bridge.calls.some(call => call.path.endsWith("/cancel")));
  const result = await run(bridge, vault, newHistoryProgress(owner, friend, stopped));
  assert.equal(result.added, 2603); assert.equal(result.progress.count, 2703); assert.equal(vault.rows.size, 2703);
  assert.ok(result.updatedVoice > 0);
});

await test("completed snapshots trigger forward incremental reads and then a truthful empty page", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault();
  const full = await run(bridge, vault);
  bridge.total += 604;
  const plan = newHistoryProgress(owner, friend, full.progress);
  assert.equal(plan.direction, "forward"); assert.equal(plan.since, "sample_2703"); assert.equal(plan.count, 0);
  const delta = await run(bridge, vault, plan);
  assert.equal(bridge.starts[6].since, "sample_2703"); assert.equal(bridge.starts[6].direction, "forward");
  assert.equal(delta.added, 604); assert.equal(delta.progress.count, 604); assert.equal(delta.progress.pages, 2);
  assert.equal(delta.total, 3307);
  const empty = await run(bridge, vault, newHistoryProgress(owner, friend, delta.progress));
  assert.equal(empty.progress.count, 0); assert.equal(empty.added, 0); assert.equal(empty.progress.complete, true);
  const reset = newHistoryProgress(owner, friend, empty.progress, { forceFull: true });
  assert.equal(reset.since, null); assert.equal(reset.account, null); assert.equal(reset.direction, "backward");
});

await test("cancellation ACK persists voice text completed after the last poll without advancing the cursor", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(), controller = new AbortController(); bridge.voice = true;
  const request = async (path, options) => {
    if (path.endsWith("/cancel")) return { status: "cancelled", partial: structuredClone(bridge.jobs.get(path.split("/")[2]).result), partialRevision: 2 };
    return bridge.request(path, options);
  };
  await assert.rejects(run(bridge, vault, fresh(), { request, signal: controller.signal, accept: async (batch, interim) => {
    const accepted = await vault.accept(batch, interim); if (!controller.signal.aborted) controller.abort(); return accepted;
  } }), { name: "AbortError" });
  assert.ok([...vault.rows.values()].some(row => row.source.transcriptionStatus === "visible-text"));
  const stopped = readHistoryProgress(owner, friend);
  assert.equal(stopped.count, 0); assert.equal(stopped.cursor, null); assert.equal(stopped.pendingJob, null);
});

await test("owner, friend and bound WeChat accounts cannot reuse each other's checkpoints or batches", async () => {
  writeHistoryProgress(fresh());
  assert.equal(readHistoryProgress("other-owner", friend), null); assert.equal(readHistoryProgress(owner, "其他联系人"), null);
  assert.throws(() => newHistoryProgress("other-owner", friend, fresh()), /其他账号或联系人/);
  assert.throws(() => newHistoryProgress(owner, "其他联系人", fresh()), /其他账号或联系人/);
  for (const changed of ["account", "friend"]) {
    storage.clear(); const bridge = new FakeBridge(), vault = new FakeVault(), plan = fresh(); plan.account = "synthetic-account";
    bridge.hook = job => { const result = clone(job.result); result[changed] = "different"; return { status: "completed", result }; };
    await assert.rejects(run(bridge, vault, plan), /账号或联系人/);
    assert.equal(vault.rows.size, 0); assert.equal(readHistoryProgress(owner, friend).count, 0);
  }
});

await test("one missing job can reopen its current page, a second 404 never spins", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(), plan = fresh(); plan.pendingJob = "expired_job";
  const result = await run(bridge, vault, plan);
  assert.equal(result.added, 2703); assert.equal(bridge.starts.length, 6);
  storage.clear(); const bad = new FakeBridge(); bad.hook = () => { throw notFound(); };
  await assert.rejects(run(bad, new FakeVault(), plan), /missing job/);
  assert.equal(bad.starts.length, 1); assert.equal(readHistoryProgress(owner, friend).pendingJob, "job_1");
});

await test("unknown transport errors retain the live job and reload polls it without starting another", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(); let failed = false;
  bridge.hook = () => { if (!failed) { failed = true; throw new TypeError("synthetic network loss"); } };
  await assert.rejects(run(bridge, vault), /network loss/);
  const saved = readHistoryProgress(owner, friend);
  assert.equal(saved.pendingJob, "job_1"); assert.equal(bridge.starts.length, 1);
  const result = await run(bridge, vault, newHistoryProgress(owner, friend, saved));
  assert.equal(result.added, 2703); assert.equal(bridge.starts.length, 6);
});

await test("unchanged worker heartbeats stop waiting and reconnect the same task without duplicate jobs", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(), jobs = [], updates = [];
  const realNow = Date.now; let now = realNow(); Date.now = () => now;
  try {
    bridge.hook = () => { now += 1000; return { status: "running", progress: 0, message: "正在检查本机聊天与语音" }; };
    await assert.rejects(run(bridge, vault, fresh(), { idleTimeoutMs: 2000, onJob: id => jobs.push(id), onProgress: update => updates.push(update) }),
      error => error.code === "HISTORY_STALLED" && /尚未返回聊天.*同一任务/.test(error.message));
    assert.equal(bridge.starts.length, 1); assert.equal(vault.rows.size, 0);
    assert.deepEqual(jobs, ["job_1"], "polling must not reset the UI idle timer by re-announcing a live task");
    assert.equal(updates.length, 1, "repeated heartbeat messages are not new progress");
    assert.equal(updates[0].progress, 0);
    const saved = readHistoryProgress(owner, friend);
    assert.equal(saved.pendingJob, "job_1"); assert.equal(saved.count, 0); assert.equal(saved.cursor, null);
    assert.ok(!bridge.calls.some(call => call.path.endsWith("/cancel")), "a UI wait timeout must not silently cancel the helper");
    bridge.hook = undefined;
    const result = await run(bridge, vault, newHistoryProgress(owner, friend, saved));
    assert.equal(result.progress.complete, true); assert.equal(bridge.starts.length, 6);
    assert.equal(vault.rows.size, 2703); assert.equal(result.added, 2703);
  } finally { Date.now = realNow; }
});

await test("real worker progress keeps a long page alive without duplicate job announcements", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(), jobs = [];
  const realNow = Date.now; let now = realNow(); Date.now = () => now;
  try {
    bridge.hook = job => {
      now += 1000;
      if (job.reads < 7) return { status: "running", progress: job.reads * 10, message: "正在读取聊天", phase: "reading" };
    };
    const result = await run(bridge, vault, fresh(), { idleTimeoutMs: 2000, onJob: id => jobs.push(id) });
    assert.equal(result.progress.complete, true); assert.equal(result.added, 2703);
    assert.equal(jobs.filter(Boolean).length, 6); assert.equal(jobs.filter(id => id === null).length, 6);
  } finally { Date.now = realNow; }
});

await test("stalled page after an accepted partial keeps originals and resumes with its receipt", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault();
  const realNow = Date.now; let now = realNow(); Date.now = () => now;
  try {
    bridge.hook = job => { now += 1000; return { status: "running", progress: 30, partial: job.partial, partialRevision: 1, message: "已读到聊天" }; };
    await assert.rejects(run(bridge, vault, fresh(), { idleTimeoutMs: 2000 }), error => error.code === "HISTORY_STALLED" && /已保存 500 条/.test(error.message));
    const saved = readHistoryProgress(owner, friend);
    assert.equal(saved.pendingJob, "job_1"); assert.equal(saved.count, 0); assert.equal(saved.pages, 0);
    assert.equal(vault.rows.size, 500); assert.equal(vault.accepted.length, 1);
    bridge.hook = undefined;
    const result = await run(bridge, vault, newHistoryProgress(owner, friend, saved));
    assert.equal(result.progress.complete, true); assert.equal(result.added, 2203);
    assert.equal(vault.rows.size, 2703); assert.equal(bridge.starts.length, 6);
  } finally { Date.now = realNow; }
});

await test("IDB failure after a successful first page retains the second page cursor and completed job", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(); let accepts = 0;
  await assert.rejects(run(bridge, vault, fresh(), { accept: async (...args) => {
    accepts++; if (accepts === 2) throw new Error("synthetic IDB quota"); return vault.accept(...args);
  } }), /IDB quota/);
  const saved = readHistoryProgress(owner, friend);
  assert.equal(saved.count, 500); assert.equal(saved.cursor, "c_2703_0_500"); assert.equal(saved.pendingJob, "job_2");
  const result = await run(bridge, vault, newHistoryProgress(owner, friend, saved));
  assert.equal(result.added, 2203); assert.equal(bridge.starts.length, 6); assert.equal(result.progress.count, 2703);
});

await test("malformed counts, empty continuation, snapshot changes and moving partial pages fail before progress", async () => {
  const mutations = [batch => batch.history.count++, batch => { batch.records = []; batch.history.count = 0; },
    batch => batch.records[0].source.accountId = "different", batch => batch.records[0].id = batch.records[1].id,
    batch => batch.history.nextCursor = "bad token", batch => batch.history.complete = true];
  for (const mutate of mutations) {
    storage.clear(); const bridge = new FakeBridge(), vault = new FakeVault();
    bridge.hook = job => { const result = clone(job.result); mutate(result); return { status: "completed", result }; };
    await assert.rejects(run(bridge, vault)); assert.equal(vault.rows.size, 0); assert.equal(readHistoryProgress(owner, friend).count, 0);
  }
  storage.clear(); const bridge = new FakeBridge(), vault = new FakeVault();
  bridge.hook = job => { if (job.body.cursor) { const result = clone(job.result); result.history.snapshot = "changed_snapshot"; return { status: "completed", result }; } };
  await assert.rejects(run(bridge, vault)); assert.equal(vault.rows.size, 500); assert.equal(readHistoryProgress(owner, friend).count, 500);
  storage.clear(); const moving = new FakeBridge(), partialVault = new FakeVault(); moving.voice = true;
  moving.hook = job => { if (job.reads === 2) { const result = clone(job.result); result.records[0].id = "wechat-db:changed"; return { status: "completed", result }; } };
  await assert.rejects(run(moving, partialVault), /同一页/); assert.equal(partialVault.rows.size, 100);
  assert.equal(readHistoryProgress(owner, friend).count, 0);
});

await test("storage corruption or unapproved fields never become a runnable checkpoint", async () => {
  writeHistoryProgress(fresh()); const [key] = storage.data.keys();
  storage.data.set(key, JSON.stringify({ ...fresh(), token: "must-never-persist" }));
  assert.equal(readHistoryProgress(owner, friend), null);
  assert.throws(() => writeHistoryProgress({ ...fresh(), records: ["private content"] }));
  storage.data.set(key, "bad json"); assert.equal(readHistoryProgress(owner, friend), null);
});

await test("521 voice references are handled once in bounded jobs without inherited history cursors", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(), plan = fresh(), updates = [];
  bridge.voice = true;
  plan.cursor = "old_cursor"; plan.snapshot = "old_snapshot"; plan.count = 3189; plan.pages = 7;
  const voiceIds = Array.from({ length: 521 }, (_, index) => ({ messageShard: "message_0.db", messageId: String(800000 + index), localId: String(index + 1) }));
  const seeded = makeBatch({ friend, direction: "backward", voiceOnly: true, voiceIds }, 0);
  await vault.accept(seeded, false);
  const result = await run(bridge, vault, plan, { voiceIds, onProgress: update => updates.push(update) });
  assert.equal(bridge.starts.length, 6); assert.equal(result.progress.count, 521); assert.equal(result.updatedVoice, 521);
  assert.deepEqual(bridge.starts.map(body => body.voiceIds.length), [100, 100, 100, 100, 100, 21]);
  assert.equal(bridge.starts.flatMap(body => body.voiceIds).length, 521);
  for (const body of bridge.starts) { assert.equal("cursor" in body, false); assert.equal("since" in body, false); }
  assert.equal(updates.at(-1).complete, true);
  assert.equal(updates.filter(update => update.complete).length, 1);
});

await test("voice responses outside the selected reference set fail before acceptance", async () => {
  for (const field of ["messageId", "messageShard", "localId", "mediaKind"]) {
    const bridge = new FakeBridge(), vault = new FakeVault(); bridge.voice = true;
    bridge.hook = job => { const result = clone(job.result); result.records[0].source[field] = "unexpected"; return { status: "completed", result }; };
    await assert.rejects(run(bridge, vault, fresh(), { voiceIds: [{ messageShard: "message_0.db", messageId: "800001", localId: "1" }] }), /范围之外/);
    assert.equal(vault.rows.size, 0);
  }
});

await test("voice requests reject duplicate refs and live unrelated history jobs", async () => {
  const bridge = new FakeBridge(), ref = { messageShard: "message_0.db", messageId: "1" }; bridge.voice = true;
  await assert.rejects(run(bridge, new FakeVault(), fresh(), { voiceIds: [ref, ref] }), /重复/);
  const plan = fresh(); plan.pendingJob = "old_history_job";
  await assert.rejects(run(bridge, new FakeVault(), plan, { voiceIds: [ref] }), /完整进度/);
  assert.equal(bridge.starts.length, 0);
});

await test("voice refresh resumes the same second batch without replaying the completed first batch", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(); bridge.voice = true;
  const voiceIds = Array.from({ length: 213 }, (_, i) => ({ messageShard: "message_0.db", messageId: String(800000+i) }));
  let interrupted = false;
  bridge.hook = job => {
    if (job.body.voiceIds[0].messageId === "800100" && job.reads === 1) {
      const partial = clone(job.partial); partial.records.splice(0, 5, ...clone(job.result.records.slice(0,5)));
      return { status: "running", partial, partialRevision: 1 };
    }
    if (!interrupted && job.body.voiceIds[0].messageId === "800100" && job.reads === 2) {
      interrupted = true; throw new TypeError("synthetic voice reconnect");
    }
  };
  await assert.rejects(run(bridge, vault, fresh(), { voiceIds }), /voice reconnect/);
  const saved = readHistoryProgress(owner, friend);
  assert.equal(saved.pendingJob, "job_2"); assert.equal(bridge.starts.length, 2);
  const result = await run(bridge, vault, saved, { voiceIds: voiceIds.slice(105) });
  assert.equal(bridge.starts.length, 3, "only the final 13 voices start a new job");
  assert.equal(bridge.starts[2].voiceIds[0].messageId, "800200");
  assert.equal(result.progress.count, 213); assert.equal(result.progress.pages, 3);
  assert.equal(vault.rows.size, 213);
  assert.ok([...vault.rows.values()].every(row => row.source.transcriptionStatus === "visible-text"));
});

await test("a final partial containing all transcripts can still close its existing voice job", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(); bridge.voice = true;
  const voiceIds = [{ messageShard: "message_0.db", messageId: "800001" }];
  let interrupted = false;
  bridge.hook = job => {
    if (job.reads === 1) return { status: "running", partial: job.result, partialRevision: 1 };
    if (!interrupted) { interrupted = true; throw new TypeError("synthetic final reconnect"); }
  };
  await assert.rejects(run(bridge, vault, fresh(), { voiceIds }), /final reconnect/);
  assert.equal(vault.rows.get("wechat-db:voice-800001").source.transcriptionStatus, "visible-text");
  const result = await run(bridge, vault, readHistoryProgress(owner, friend), { voiceIds: [] });
  assert.equal(result.progress.complete, true); assert.equal(result.progress.pendingJob, null);
  assert.equal(bridge.starts.length, 1);
});

await test("a changing source after 500 rows resumes the same cursor automatically", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(), updates = [];
  let failed = false;
  bridge.hook = job => {
    if (!failed && job.body.cursor) { failed = true; return { status: "failed", error: { code: "SOURCE_CHANGED", message: "synthetic source update" } }; }
  };
  const result = await run(bridge, vault, fresh(), { onProgress: update => updates.push(update) });
  assert.equal(result.progress.complete, true); assert.equal(result.progress.count, 2703);
  assert.equal(result.added, 2703); assert.equal(vault.rows.size, 2703);
  assert.equal(bridge.starts.length, 7); assert.equal(bridge.starts.filter(body => !body.cursor).length, 1);
  assert.equal(bridge.starts[1].cursor, bridge.starts[2].cursor);
  assert.ok(updates.some(update => /已保存 500 条.*自动继续/.test(update.message)));
  assert.ok(bridge.calls.every(call => call.path === "/capture" || call.path.startsWith("/jobs/")), "recovery never requests analysis or credits");
});

await test("source-change retries are bounded and permanent cursor/account errors never restart", async () => {
  for (const code of ["SOURCE_CHANGED", "CURSOR_SOURCE_CHANGED", "ACCOUNT_CHANGED"]) {
    storage.clear(); const bridge = new FakeBridge(), vault = new FakeVault();
    bridge.hook = job => job.body.cursor ? { status: "failed", error: { code, message: "synthetic failure" } } : undefined;
    await assert.rejects(run(bridge, vault), error => error.code === code);
    const saved = readHistoryProgress(owner, friend);
    assert.equal(saved.count, 500); assert.equal(saved.pages, 1); assert.equal(saved.cursor, "c_2703_0_500");
    assert.equal(saved.snapshot, "sample_2703"); assert.equal(saved.pendingJob, null); assert.equal(saved.complete, false);
    assert.equal(vault.rows.size, 500); assert.equal(bridge.starts.length, code === "SOURCE_CHANGED" ? 4 : 2);
    assert.ok(bridge.starts.slice(1).every(body => body.cursor === saved.cursor));
  }
});

await test("capture rejection retries its unchanged page while polling errors retain the same worker", async () => {
  for (const duringPoll of [false, true]) {
    storage.clear(); const bridge = new FakeBridge(), vault = new FakeVault(), attempts = []; let failed = false;
    const request = async (path, options = {}) => {
      if (path === "/capture") attempts.push(clone(options.body));
      if (!failed && (duringPoll ? path === "/jobs/job_2" : path === "/capture" && options.body.cursor)) {
        failed = true; throw Object.assign(new Error("synthetic source update"), { code: "SOURCE_CHANGED" });
      }
      return bridge.request(path, options);
    };
    const result = await run(bridge, vault, fresh(), { request });
    assert.equal(result.progress.complete, true); assert.equal(vault.rows.size, 2703);
    assert.equal(bridge.starts.length, 6); assert.equal(attempts.length, duringPoll ? 6 : 7);
    if (!duringPoll) assert.equal(attempts[1].cursor, attempts[2].cursor);
  }
});

await test("a saved normal partial survives source recovery without false duplicate rejection", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(); let failed = false;
  bridge.hook = job => {
    if (!failed && job.body.cursor) {
      failed = true; return { status: "failed", error: { code: "SOURCE_CHANGED" }, partial: job.partial, partialRevision: 1 };
    }
  };
  const result = await run(bridge, vault);
  assert.equal(result.progress.complete, true); assert.equal(result.progress.count, 2703);
  assert.equal(result.added, 2703); assert.equal(vault.rows.size, 2703); assert.equal(bridge.starts.length, 7);
  const partial = vault.accepted.findIndex(page => page.interim);
  assert.ok(partial >= 0); assert.deepEqual(vault.accepted[partial].ids, vault.accepted[partial + 1].ids);
  assert.equal([...storage.data.keys()].some(key => key.endsWith(":accepted-page")), false);
});

await test("reload resumes an accepted normal page using only a digest receipt", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(); let lost = false;
  bridge.hook = job => {
    if (job.id === "job_1" && job.reads === 1) return { status: "running", partial: job.partial, partialRevision: 1 };
    if (!lost) { lost = true; throw new TypeError("synthetic lost connection"); }
  };
  await assert.rejects(run(bridge, vault), /lost connection/);
  const saved = readHistoryProgress(owner, friend);
  assert.equal(vault.rows.size, 500); assert.equal(saved.count, 0); assert.equal(saved.pendingJob, "job_1");
  const receipt = [...storage.data].find(([key]) => key.endsWith(":accepted-page"))?.[1];
  assert.match(receipt, /^[a-f0-9]{64}$/);
  assert.doesNotMatch([...storage.data.values()].join(""), /wechat-db:|合成原文/);
  const result = await run(bridge, vault, newHistoryProgress(owner, friend, saved));
  assert.equal(result.progress.complete, true); assert.equal(result.progress.count, 2703);
  assert.equal(result.added, 2203); assert.equal(vault.rows.size, 2703); assert.equal(bridge.starts.length, 6);
});

await test("source recovery cannot change an already accepted page's identity", async () => {
  for (const polling of [false, true]) {
    storage.clear(); const bridge = new FakeBridge(), vault = new FakeVault(); let failed = false;
    bridge.hook = job => {
      if (job.id === "job_1" && job.reads === 1) return { status: "running", partial: job.partial, partialRevision: 1 };
      if (!failed) {
        failed = true;
        if (polling) throw Object.assign(new Error("source updating"), { code: "SOURCE_CHANGED" });
        return { status: "failed", error: { code: "SOURCE_CHANGED" } };
      }
      const changed = clone(job.result); changed.records[0].id = "wechat-db:changed-page";
      return { status: "completed", result: changed };
    };
    await assert.rejects(run(bridge, vault), /同一页的消息范围发生变化/);
    assert.equal(vault.rows.size, 500); assert.equal(vault.rows.has("wechat-db:changed-page"), false);
    assert.equal(readHistoryProgress(owner, friend).count, 0); assert.equal(readHistoryProgress(owner, friend).complete, false);
    assert.equal(bridge.starts.length, polling ? 1 : 2);
  }
});

await test("cancelling the source-recovery delay does not launch another page or mark it complete", async () => {
  const bridge = new FakeBridge(), vault = new FakeVault(), abort = new AbortController();
  bridge.hook = job => job.body.cursor ? { status: "failed", error: { code: "SOURCE_CHANGED" } } : undefined;
  const began = Date.now();
  await assert.rejects(run(bridge, vault, fresh(), { pollMs: 1000, signal: abort.signal,
    onProgress: update => { if (update.message.includes("自动继续")) abort.abort(); },
  }), error => error.name === "AbortError");
  assert.ok(Date.now() - began < 1000, "abort must interrupt the recovery delay immediately");
  const saved = readHistoryProgress(owner, friend);
  assert.equal(saved.count, 500); assert.equal(saved.complete, false); assert.equal(saved.pendingJob, null);
  assert.equal(bridge.starts.length, 2); assert.equal(vault.rows.size, 500);
});

console.log(`History import state machine: ${passed} tests passed; all messages and transports were synthetic.`);
