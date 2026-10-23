import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { newHistoryProgress, readHistoryProgress, writeHistoryProgress, runHistoryImport } from "../lib/capture-history-import.ts";

// Exercise the actual page cleanup function with real history checkpoints.
// No live collector, customer records, network, uploads or billing are used.
const source = readFileSync("app/capture/page.tsx", "utf8");
const parsed = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let cleanup = "";
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "clearStoredJob") cleanup = node.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed); assert.ok(cleanup);
const compiled = ts.transpileModule(cleanup, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const memory = new Map(), jobs = new Map();
Object.defineProperty(globalThis, "localStorage", { value: {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: key => memory.delete(key),
}, configurable: true });
const owner = "synthetic-passive-owner", friend = "合成好友", scopeKey = name => `${owner}:${name}`;
const clearStoredJob = new Function("stored", "scopeKey", "owner", "readHistoryProgress", "writeHistoryProgress", "remember",
  `${compiled};return clearStoredJob;`)(key => jobs.get(key), scopeKey, owner, readHistoryProgress, writeHistoryProgress,
  (key, value) => value === null ? jobs.delete(key) : jobs.set(key, value));
let passed = 0;
for (const [suffix, media] of [["", {}], [":voice", { voiceHistory: true }], [":images", { imageOnly: true }]]) {
  memory.clear(); jobs.clear();
  const original = { ...newHistoryProgress(owner + suffix, friend), account: "fixture-account", cursor: "cursor_500", snapshot: "snapshot_501", count: 500, pages: 1, pendingJob: "failed_job" };
  writeHistoryProgress(original);
  jobs.set(scopeKey("job"), { jobId: "failed_job", history: true, friend, ...media, waitingPaused: true });
  clearStoredJob("failed_job");
  assert.deepEqual(readHistoryProgress(owner + suffix, friend), { ...original, pendingJob: null });
  assert.equal(jobs.has(scopeKey("job")), false);
  passed++;
}

// A delayed terminal callback for an old task cannot clear a newer UI job or
// an independently advanced checkpoint belonging to the same contact.
for (const newerUI of [true, false]) {
  memory.clear(); jobs.clear();
  const newer = { ...newHistoryProgress(owner, friend), pendingJob: "new_job" };
  writeHistoryProgress(newer);
  jobs.set(scopeKey("job"), { jobId: newerUI ? "new_job" : "failed_job", history: true, friend });
  clearStoredJob("failed_job");
  assert.deepEqual(readHistoryProgress(owner, friend), newer);
  if (newerUI) assert.equal(jobs.get(scopeKey("job")).jobId, "new_job");
  passed++;
}

memory.clear(); jobs.clear();
const original = { ...newHistoryProgress(owner, friend), account: "fixture-account", cursor: "cursor_500", snapshot: "snapshot_501", count: 500, pages: 1, pendingJob: "failed_job" };
writeHistoryProgress(original);
jobs.set(scopeKey("job"), { jobId: "failed_job", history: true, friend, waitingPaused: true });
clearStoredJob("failed_job");
const calls = [];
const resumed = await runHistoryImport({ progress: newHistoryProgress(owner, friend, readHistoryProgress(owner, friend)), pollMs: 0,
  request: async (path, options = {}) => {
    calls.push(path);
    if (path === "/capture") { assert.equal(options.body.cursor, "cursor_500"); return { jobId: "replacement_job" }; }
    assert.equal(path, "/jobs/replacement_job", "first Continue must not re-poll a known terminal task");
    return { status: "completed", result: { version: 1, kind: "chat", friend, account: "fixture-account", capturedAt: "2026-10-24T00:00:00Z", warnings: [],
      records: [{ id: "wechat-db:synthetic-501", kind: "text", text: "合成文字", sender: friend, senderRole: "other", at: "2026-10-24T00:00:00Z", source: { label: "合成数据库", method: "wechat-local-db", accountId: "fixture-account" } }],
      history: { version: 1, direction: "backward", count: 1, hasMore: false, nextCursor: null, snapshot: "snapshot_501", complete: true } } };
  }, accept: async () => ({ added: 1, updatedVoice: 0, total: 501, libraryId: "synthetic-library" }),
});
assert.deepEqual(calls, ["/capture", "/jobs/replacement_job"]);
assert.equal(resumed.progress.count, 501); assert.equal(resumed.progress.complete, true); passed++;
console.log(`PASS passive terminal cleanup: ${passed} cases; exact job match, all history owners, unchanged cursor/account/count, first-click continuation, no live requests.`);
