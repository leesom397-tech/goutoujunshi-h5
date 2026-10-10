import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const fitSource = ts.transpileModule(readFileSync("lib/relationship-fit.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
new Function("exports", fitSource)(exports);
assert.equal(exports.ageInYears("1990年", 2026), 36);
assert.equal(exports.ageInYears("90年生", 2026), 36);
assert.equal(exports.ageInYears("36岁", 2026), 36);
assert.equal(exports.ageInYears("90后", 2026), null);
const fit = exports.relationshipFit({ ageRange: "1990年", city: "上海", occupation: "导演" }, { ageRange: "92年", city: "上海市", occupation: "主播" });
assert.equal(fit.fit.length, 6);
assert.equal(fit.coverage, 2, "same-city proximity is a clue, not a scored compatibility dimension");
assert.match(fit.fit[3].conclusion, /作品|拍摄/);
assert.deepEqual(fit.commonPoints.map(point => point.title), ["年龄阶段", "职业交集"], "only supported matching dimensions become common points");
assert.equal(exports.relationshipFit({}, {}).fitScore, null);
assert.equal(exports.relationshipFit({ city: "广东深圳" }, { city: "家乡惠州，现居深圳南山区" }).fit[1].status, "有线索");
assert.equal(exports.relationshipFit({ ageRange: "90后" }, { ageRange: "92年" }).fit[0].status, "匹配");

let handler = async () => Response.json({ summary: "测试结果", fit: [] });
const source = readFileSync("lib/social-profile-jobs.mjs", "utf8").replace(/^import .*;\r?\n/gm, "").replaceAll("export class ", "class ").replaceAll("export async function ", "async function ");
class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
// Task recovery uses synthetic credit dependencies; real charging is covered separately.
const Job = new Function("DurableObject", "app", "reserveCredits", "finishCreditTask", "CREDIT_PRICES", source + "\nreturn SocialProfileJobs;")(
  DurableObject, { fetch: (...args) => handler(...args) },
  async () => ({ execute: true, status: "reserved" }),
  async () => {},
  { analysisSmall: 1, analysisMedium: 2, analysisLarge: 3, profile: 1 }
);
class Storage {
  values = new Map(); alarm = null;
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.values.delete(key); }
  async list({ prefix }) { return new Map([...this.values].filter(([key]) => key.startsWith(prefix)).map(([key,value]) => [key, structuredClone(value)])); }
  async transaction(fn) { return fn(this); }
  async setAlarm(value) { this.alarm = value; }
}
const storage = new Storage();
let job = new Job({ storage }, {});
const id = "11111111-1111-4111-8111-111111111111";
const url = "https://internal/task?taskId=" + id;
const post = () => new Request(url, { method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify({ images: ["data:image/png;base64,aGVsbG8="], target: "self", confirmed: true }) });
assert.equal((await job.fetch(post())).status, 202);
assert.ok(storage.alarm, "a persisted alarm must be scheduled before acknowledging submission");
assert.equal((await (await job.fetch(post())).json()).taskId, id, "retry must reuse the same task");
job = new Job({ storage }, {}); // phone closed / object restarted
await job.alarm();
const result = await (await job.fetch(new Request(url))).json();
assert.equal(result.status, "done");
assert.equal(result.target, "self");
assert.equal(result.totalCount, 1);
assert.equal((await storage.list({ prefix: "payload:" })).size, 0, "temporary images must be removed after completion");
assert.equal((await storage.get("job:" + id)).authorization, undefined);
const secondId = "22222222-2222-4222-8222-222222222222";
handler = async () => new Response("error code: 522\n", { status: 522 });
await job.fetch(new Request("https://internal/task?taskId=" + secondId, { method: "POST", body: JSON.stringify({ images: ["image"], confirmed: true }) }));
await job.alarm();
const failed = await (await job.fetch(new Request("https://internal/task?taskId=" + secondId))).json();
assert.equal(failed.status, "error");
assert.doesNotMatch(failed.error, /Unexpected token|error code/);
assert.equal((await storage.list({ prefix: "payload:" })).size, 0);
const batchId = "33333333-3333-4333-8333-333333333333";
const calls = [];
handler = async request => { const body = await request.json(); calls.push(body); return Response.json({ id: body.requestId, lines: [], subjectId: body.subjectId }); };
const batchUrl = "https://internal/api/miniapp/screenshot/batch?taskId=" + batchId;
await job.fetch(new Request(batchUrl, { method: "POST", body: JSON.stringify({ images: Array.from({ length: 9 }, (_, i) => "image-" + i), confirmed: true, selfSide: "right", sessionId: batchId, subjectId: id }) }));
job = new Job({ storage }, {});
for (let index=0; index<9; index++) await job.alarm();
const batch = await (await job.fetch(new Request(batchUrl))).json();
assert.equal(batch.status, "done");
assert.equal(batch.result.entries.length, 9);
assert.deepEqual(calls.map(call => call.image), Array.from({ length: 9 }, (_, i) => "image-" + i));
assert.ok(calls.every(call => call.subjectId === id && call.selfSide === "right"));
assert.equal(new Set(calls.map(call => call.requestId)).size, 9);
assert.equal((await storage.list({ prefix: "payload:" })).size, 0);
console.log("PASS: all nine chat screenshots run sequentially in the persisted background job");
const uploadId = "44444444-4444-4444-8444-444444444444";
const uploadUrl = "https://internal/api/miniapp/screenshot/batch?taskId=" + uploadId;
const send = body => job.fetch(new Request(uploadUrl, { method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify(body) }));
const init = { uploadAction: "init", imageCount: 3, confirmed: true, selfSide: "right", sessionId: uploadId, subjectId: id };
assert.equal((await send(init)).status, 201);
assert.equal((await send({ ...init, subjectId: secondId })).status, 409, "same task cannot change the selected person");
assert.equal((await send({ uploadAction: "commit" })).status, 409, "incomplete uploads must not start analysis");
const images = ["data:image/png;base64,YQ==", "data:image/png;base64,Yg==", "data:image/png;base64,Yw=="];
await send({ uploadAction: "part", index: 0, image: images[0] });
await send({ uploadAction: "part", index: 2, image: images[2] });
job = new Job({ storage }, {});
assert.deepEqual((await (await job.fetch(new Request(uploadUrl))).json()).received, [0, 2], "server restart preserves accepted image positions");
const uploadedBefore = (await storage.list({ prefix: "upload:" })).size;
assert.equal((await send({ uploadAction: "part", index: 0, image: images[0] })).status, 200);
assert.equal((await storage.list({ prefix: "upload:" })).size, uploadedBefore, "retry of received image is idempotent");
assert.equal((await send({ uploadAction: "part", index: 0, image: images[1] })).status, 409, "same position cannot overwrite an accepted image");
assert.equal((await send({ uploadAction: "part", index: -1, image: images[1] })).status, 400);
await send({ uploadAction: "part", index: 1, image: images[1] });
assert.equal((await send({ uploadAction: "commit" })).status, 202);
assert.equal((await send({ uploadAction: "commit" })).status, 202);
const beforeCalls = calls.length;
job = new Job({ storage }, {});
for (let index=0; index<images.length+1; index++) await job.alarm();
assert.deepEqual(calls.slice(beforeCalls).map(call => call.image), images, "analysis must run once in original order, not upload arrival order");
assert.equal((await (await job.fetch(new Request(uploadUrl))).json()).status, "done");
assert.equal((await storage.list({ prefix: "upload:" })).size, 0);
assert.equal((await storage.get("job:" + uploadId)).parameters, undefined);
assert.equal((await storage.get("job:" + uploadId)).authorization, undefined);
console.log("PASS: resumable image receipts, immutable order, incomplete commit guard, restart, duplicate commit and cleanup");
console.log("PASS: age parsing, six-dimensional compatibility, durable resume, idempotent submission, temporary image cleanup, safe 522 handling");
