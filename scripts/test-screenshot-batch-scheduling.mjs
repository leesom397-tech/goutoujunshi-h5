// Controlled synthetic model promises only: no network or production data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { setImmediate as flush } from "node:timers/promises";
import ts from "typescript";
import { mapBoundedTasks } from "../lib/bounded-task-pool.mjs";

const nativeRequire = createRequire(import.meta.url);
function load(file, mocks, cache = new Map()) {
  const path = resolve(file);
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} }; cache.set(path, module);
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = id => {
    if (id in mocks) return mocks[id];
    if (!id.startsWith(".") && !id.startsWith("@/")) return nativeRequire(id);
    let next = id.startsWith("@/") ? resolve(id.slice(2)) : resolve(dirname(path), id);
    if (!/\.[cm]?[jt]s$/.test(next)) next += ".ts";
    return load(next, mocks, cache);
  };
  new Function("require", "module", "exports", code)(require, module, module.exports);
  return module.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const transient = () => Object.assign(new Error("synthetic timeout"), { name: "TimeoutError" });

function screenshotRig(concurrency) {
  const calls = [], pending = new Map(), attempts = new Map(), timings = [];
  let active = 0, peak = 0, finished = false;
  const words = Array.from({ length: 40 }, (_, index) => "合成原话" + index);
  const module = load("lib/crush/screenshot.ts", {
    "@/lib/knowledge": { selectKnowledge: () => [] },
    "./provider": { normalizeQwenAnnotations: (rows, lines) => lines.map((line, index) => ({ lineId: line.id, emotion: [], intent: [], evidence: "limited", note: rows[index].note })) },
    "@/lib/qwen": {
      parseQwenJson: JSON.parse,
      qwenPublicError: (_error, fallback) => fallback,
      qwenChat: async (messages, options) => {
        const input = JSON.parse(messages.at(-1).content);
        assert.ok(Array.isArray(input.targetIndices), "no extra model pass is needed when the last bubble is self");
        const batch = input.targetIndices[0] / 5;
        const attempt = (attempts.get(batch) || 0) + 1; attempts.set(batch, attempt);
        const gate = deferred();
        pending.set(batch, { ...gate, indices: input.targetIndices });
        calls.push({ batch, attempt, options });
        active++; peak = Math.max(peak, active);
        try { return await gate.promise; } finally { active--; }
      }
    }
  });
  const result = module.readScreenshotFromQuick({ layout: "wechat-one-to-one", lines: words.map((word, index) => [index % 2 ? "right" : "left", "text", word]) }, "right", [], "合成档案", 26000, timing => timings.push(timing), concurrency)
    .then(value => ({ value }), error => ({ error })).finally(() => { finished = true; });
  const settle = (batch, error) => {
    const gate = pending.get(batch); assert.ok(gate, "batch " + batch + " must be running"); pending.delete(batch);
    if (error) gate.reject(error);
    else gate.resolve(JSON.stringify({ annotations: gate.indices.map(index => [[{ key: "calm", weight: 100 }], [{ key: "inform", weight: 100 }], "limited", "解释合成原话" + index]), observation: "仅本图可見原话", judgment: "本图暂时判断", nextStep: "等待反馈", replyOptions: [] }));
  };
  return { calls, pending, attempts, timings, words, result, settle, get active() { return active; }, get peak() { return peak; }, get finished() { return finished; } };
}

for (const concurrency of [2, 4]) {
  const rig = screenshotRig(concurrency);
  assert.deepEqual(rig.calls.map(call => call.batch), Array.from({ length: concurrency }, (_, index) => index));
  rig.settle(1); await flush();
  assert.ok(rig.pending.has(0), "slow first batch is still pending");
  assert.ok(rig.pending.has(concurrency), "a free slot starts the next batch without waiting for a slow first wave");
  while (rig.pending.size) { rig.settle(Math.max(...rig.pending.keys())); await flush(); }
  const { value, error } = await rig.result;
  assert.equal(error, undefined);
  assert.equal(rig.peak, concurrency, "strictly retains the configured concurrency ceiling");
  assert.equal(rig.active, 0);
  assert.deepEqual(value.prepared.lines.map(line => line.text), rig.words, "out-of-order completion never reorders quotes");
  assert.deepEqual(value.prepared.lines.map(line => line.speaker), rig.words.map((_, index) => index % 2 ? "self" : "other"));
  assert.deepEqual(rig.calls.map(call => call.batch), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(rig.calls.every(call => call.attempt === 1 && call.options.timeoutMs === 26000 && call.options.fast === true && call.options.json === true));
  assert.ok(rig.calls.every(call => call.options.maxTokens === (call.batch === 7 ? Math.max(3000, 5 * 230 + 1650) : 5 * 230 + 150)), "model output budgets are unchanged");
}

const retry = screenshotRig(4);
retry.settle(0, transient()); await flush();
assert.equal(retry.attempts.get(0), 2, "transient batch retries once within its occupied slot");
assert.equal(retry.calls.length, 5);
retry.settle(1); await flush();
assert.ok(retry.pending.has(4), "other slots progress while one batch retries");
while (retry.pending.size) { retry.settle(Math.max(...retry.pending.keys())); await flush(); }
assert.ok((await retry.result).value);
assert.equal(retry.peak, 4);
assert.equal(retry.attempts.get(0), 2);
assert.ok([...retry.attempts].every(([batch, count]) => count === (batch === 0 ? 2 : 1)), "successful batches never rerun");
assert.deepEqual(retry.timings.filter(timing => timing.index === 0).map(timing => [timing.attempt, timing.status]), [[1, "error"], [2, "ok"]]);

for (const concurrency of [2, 4]) {
  const failure = screenshotRig(concurrency);
  failure.settle(0, transient()); await flush();
  const exhausted = transient(); failure.settle(0, exhausted); await flush();
  assert.equal(failure.finished, false, "failure cannot escape while other model calls are in flight");
  const launched = failure.calls.length;
  while (failure.pending.size) {
    failure.settle(Math.min(...failure.pending.keys())); await flush();
    assert.equal(failure.calls.length, launched, "after final failure no new batch can start");
  }
  const outcome = await failure.result;
  assert.equal(outcome.error, exhausted);
  assert.equal(failure.active, 0, "fallback starts only after all in-flight work has settled");
  assert.equal(failure.attempts.get(0), 2, "retry exhaustion stays at two attempts");
  assert.equal(failure.peak, concurrency);
  await flush(); assert.equal(failure.calls.length, launched, "no background task continues dispatching after rejection");
}

const permanent = screenshotRig(2);
const denied = new Error("QWEN_AUTH_FAILED"); permanent.settle(0, denied); await flush();
assert.equal(permanent.attempts.get(0), 1, "non-retryable errors do not gain retries");
permanent.settle(1); await flush();
assert.equal((await permanent.result).error, denied);
assert.equal(permanent.calls.length, 2);
assert.deepEqual(await mapBoundedTasks([], 4, () => { throw new Error("must not run"); }), []);
await assert.rejects(mapBoundedTasks([0], 0, value => value), RangeError);
let synchronousCalls = 0;
await assert.rejects(mapBoundedTasks([0, 1, 2], 2, () => { synchronousCalls++; throw new Error("sync"); }), /sync/);
assert.equal(synchronousCalls, 1, "synchronous failure also closes dispatch");
let undefinedRejected = false;
try { await mapBoundedTasks([0], 1, () => Promise.reject()); } catch (error) { undefinedRejected = true; assert.equal(error, undefined); }
assert.ok(undefinedRejected, "undefined rejection is still a failure");
console.log("PASS screenshot batch scheduling: rolling 2/4-slot progress, strict bounds, ordered results, unchanged retries and fully drained failure");
