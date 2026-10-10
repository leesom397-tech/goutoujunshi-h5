// Read-only release audit. A failing exit code identifies lost report content.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
let definition;
const id = "12345678-1234-4234-8234-123456789abc";
const original = { id, lines: [], decision: {
  judgment: "双方已约定周六见面。", possibleIntent: "对方在确认具体安排。",
  observation: "对方主动询问周六几点。", evidence: "原话：周六几点方便？",
  replyReview: "你给出了明确时间，回应清楚。", nextStep: "确认地点即可。"
} };
const api = { session: async () => ({ token: "synthetic" }), request: async () => ({ report: original }) };
new Function("require", "Page", "wx", readFileSync("miniapp/pages/report/index.js", "utf8"))(
  () => api, value => { definition = value; }, {getStorageSync:()=>({token:'synthetic',expiresAt:Date.now()+60000})});
const page = { ...definition, _id: id, data: structuredClone(definition.data), setData(value, done) { Object.assign(this.data, value); done?.(); } };
await page.refresh();
assert.equal(page.data.phase, "ready");
assert.equal(page.data.report.review, original.decision.replyReview);
assert.equal(page.data.report.observation, original.decision.observation);
page.toggleEvidence();
assert.equal(page.data.showEvidence, true);
const markup = readFileSync("miniapp/pages/report/index.wxml", "utf8");
const findings = [];
for (const field of ["review", "observation"]) {
  if (!new RegExp("\\breport\\." + field + "\\b").test(markup)) findings.push(`${field}: data reaches the page but has no template binding`);
}
const intentBindings = [...markup.matchAll(/\{\{([^}]*\breport\.possibleIntent\b[^}]*)\}\}/g)].map(match => match[1]);
if (!intentBindings.some(binding => !binding.includes("report.judgment ||"))) findings.push("possibleIntent: inaccessible when judgment exists, including after expanding evidence");
if (findings.length) {
  console.error("FAIL: report content completeness\n" + findings.map(item => "- " + item).join("\n"));
  process.exitCode = 1;
} else console.log("PASS: report review, observation and intent have template bindings (visual rendering still requires runtime verification)");
