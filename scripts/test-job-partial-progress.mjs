import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Synthetic in-memory jobs only: no network, production data or billing writes.
const source = readFileSync("lib/social-profile-jobs.mjs", "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replaceAll("export class ", "class ").replaceAll("export async function ", "async function ");
const billing = { reserves: 0, settlements: 0 };
const modelCalls = [];
class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
const { Job, route } = new Function("DurableObject", "app", "reserveCredits", "finishCreditTask", "CREDIT_PRICES", source + "\nreturn { Job: SocialProfileJobs, route: routeSocialProfileJob };")(
  DurableObject,
  { async fetch(request) { const body = await request.json(); modelCalls.push(body); return Response.json({ id: body.requestId, subjectId: body.subjectId, lines: [{ id: "0", speaker: "other", text: body.image }], decision: { judgment: "仅本图局部判断" } }); } },
  async () => { billing.reserves++; return { execute: true, status: "reserved" }; },
  async () => { billing.settlements++; },
  { analysisSmall: 1, analysisMedium: 2, analysisLarge: 3, profile: 1 }
);
class Storage {
  values = new Map(); mutations = 0; alarm = null;
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.mutations++; this.values.set(key, structuredClone(value)); }
  async delete(keys) { this.mutations++; for (const key of Array.isArray(keys) ? keys : [keys]) this.values.delete(key); }
  async list({ prefix }) { return new Map([...this.values].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])); }
  async transaction(fn) { return fn(this); }
  async setAlarm(value) { this.mutations++; this.alarm = value; }
}
const storage = new Storage(), otherStorage = new Storage();
const job = new Job({ storage }, {}), otherJob = new Job({ storage: otherStorage }, {});
const taskId = "11111111-1111-4111-8111-111111111111";
const url = "https://internal/api/miniapp/screenshot/batch?taskId=" + taskId;
const token = "a".repeat(64), otherToken = "b".repeat(64);
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), value => value.toString(16).padStart(2, "0")).join("");
const owners = new Map([[await hash(token), "owner-a"], [await hash(otherToken), "owner-b"]]);
const routedOwners = [];
const env = {
  MINIAPP_APPID: "synthetic", MINIAPP_APPSECRET: "synthetic",
  DB: { prepare() { return { bind(sessionHash) { return { async first() { const owner_id = owners.get(sessionHash); return owner_id ? { owner_id } : null; } }; } }; } },
  SOCIAL_PROFILE_JOBS: { idFromName(owner) { routedOwners.push(owner); return owner; }, get(owner) { return owner === "owner-a" ? job : otherJob; } }
};
const read = (bearer = token) => route(new Request(url, { headers: bearer ? { Authorization: "Bearer " + bearer } : {} }), env, {});
await job.fetch(new Request(url, { method: "POST", body: JSON.stringify({ ownerId: "owner-a", confirmed: true, images: ["图一", "图二"], selfSide: "right", sessionId: taskId, subjectId: "person-a" }) }));
assert.equal(billing.reserves, 1);
assert.equal((await (await read()).json()).partialResult, undefined, "no completed image means no fabricated checkpoint");
await job.alarm();
assert.equal(modelCalls.length, 1, "first alarm only processes the first image");
const checkpoint = await (await read()).json();
assert.equal(checkpoint.status, "queued");
assert.equal(checkpoint.completedCount, 1);
assert.equal(checkpoint.result, undefined, "checkpoint is never final result");
assert.equal(checkpoint.partialResult.entries.length, 1);
assert.equal(checkpoint.partialResult.entries[0].lines[0].text, "图一");
assert.equal(checkpoint.partialResult.entries[0].subjectId, "person-a");
assert.equal(billing.settlements, 0, "partial completion must not settle credits");
assert.ok((await storage.list({ prefix: "payload:" })).size, "partial completion keeps pending image payloads");
const mutations = storage.mutations, beforeBilling = { ...billing }, beforeAlarm = storage.alarm;
for (let index = 0; index < 3; index++) assert.deepEqual((await (await read()).json()).partialResult, checkpoint.partialResult);
assert.equal(storage.mutations, mutations, "GET must not mutate task, advance it, remove data or reschedule work");
assert.deepEqual(billing, beforeBilling, "repeated checkpoint polling does not reserve or settle credits");
assert.equal(modelCalls.length, 1, "checkpoint polling never runs models");
assert.equal(storage.alarm, beforeAlarm, "checkpoint polling leaves recovery alarm intact");
assert.equal((await read(null)).status, 401);
assert.equal((await read("c".repeat(64))).status, 401, "unknown session cannot inspect a checkpoint");
assert.equal((await read(otherToken)).status, 404, "another owner cannot inspect a valid task id");
assert.equal(routedOwners.at(-1), "owner-b", "routing uses authenticated owner, not a submitted owner");
const saved = await storage.get("job:" + taskId);
for (const status of ["queued", "running", "error"]) {
  await storage.put("job:" + taskId, { ...saved, status, failureStatus: 503 });
  assert.equal((await (await read()).json()).partialResult.entries.length, 1, status + " exposes committed entries only");
  for (const failureStatus of [401, 403, 409]) {
    await storage.put("job:" + taskId, { ...saved, status, failureStatus });
    assert.equal((await (await read()).json()).partialResult, undefined, status + " preserves authority/conflict guard " + failureStatus);
  }
}
await storage.put("job:" + taskId, { ...saved, kind: "profile", status: "running" });
assert.equal((await (await read()).json()).partialResult, undefined, "profile jobs do not gain chat checkpoint semantics");
await storage.put("job:" + taskId, { ...saved, expiresAt: Date.now() - 1 });
assert.equal((await read()).status, 404, "expired tasks expose no saved report");
await storage.put("job:" + taskId, saved);
await job.alarm();
const complete = await (await read()).json();
assert.equal(complete.status, "done");
assert.equal(complete.partialResult, undefined, "completed batch uses only the existing final-result contract");
assert.deepEqual(complete.result.entries.map(entry => entry.lines[0].text), ["图一", "图二"], "final result remains in screenshot order");
assert.equal(billing.reserves, 1);
assert.equal(billing.settlements, 1, "settlement still occurs exactly once at terminal completion");
assert.equal((await storage.list({ prefix: "payload:" })).size, 0, "terminal completion still releases raw images");
assert.equal((await storage.get("job:" + taskId)).authorization, undefined);
await read(); await job.alarm();
assert.equal(billing.settlements, 1);
assert.equal(modelCalls.length, 2, "completed checkpoint polling or alarms never rerun images");
console.log("PASS job partial progress: owner isolation, checkpoints, authority guards, read-only polling, terminal settlement and cleanup");
