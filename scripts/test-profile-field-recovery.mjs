import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const exports = {};
const compiled = ts.transpileModule(readFileSync("lib/profile-fact-fields.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
new Function("exports", compiled)(exports);
const { recoverProfileFields } = exports;
const basic = ["ageRange", "city", "education", "occupation", "relationshipStatus", "childrenPlan", "lifestyle"];
const facts = basic.map((field, i) => ({ status: "accepted", subject_id: "person-a", kind: "subjectBasic:" + field, value: "合成资料" + i }));
facts.push(
  { status: "accepted", subject_id: "person-b", kind: "subjectBasic:values", value: "另一个人的价值观" },
  { status: "pending", subject_id: "person-a", kind: "subjectBasic:values", value: "未经确认" },
  { status: "rejected", subject_id: "person-a", kind: "subjectBasic:boundaries", value: "已拒绝" },
  { status: "accepted", subject_id: null, kind: "selfBasic:city", value: "本人城市" },
  { status: "accepted", subject_id: "person-a", kind: "subjectBasic:unsupported", value: "未知字段" },
  { status: "accepted", subjectId: "person-a", value: "关系阶段：见过一次面" },
  { status: "accepted", subject_id: "person-a", value: "认识方式: 朋友介绍" }
);
const before = structuredClone(facts);
const stored = { city: "手填城市", notes: "保留备注", socialProfileTask: "transient-task" };
const restored = recoverProfileFields(stored, facts, "person-a");
for (const field of basic) assert.equal(restored[field], field === "city" ? "手填城市" : "合成资料" + basic.indexOf(field));
assert.equal(restored.stage, "见过一次面");
assert.equal(restored.howMet, "朋友介绍");
assert.equal(restored.notes, "保留备注");
assert.equal(restored.values, undefined);
assert.equal(restored.boundaries, undefined);
assert.equal(restored.unsupported, undefined);
assert.equal(restored.socialProfileTask, undefined);
assert.deepEqual(recoverProfileFields(restored, facts, "person-a"), restored, "projection is idempotent");
assert.deepEqual(recoverProfileFields({}, facts, null), { city: "本人城市" }, "self profile excludes other people");
assert.deepEqual(recoverProfileFields({}, facts, "person-b"), { values: "另一个人的价值观" });
assert.deepEqual(recoverProfileFields({}, facts, "unknown"), {});
assert.deepEqual(recoverProfileFields({city:""},facts,null),{city:""},"an explicit clear is not revived from accepted facts");
assert.deepEqual(recoverProfileFields({city:null},facts,null),{city:null},"legacy explicitly empty values stay empty; only absent keys recover");
assert.deepEqual(facts, before, "projection never rewrites source memories");
assert.deepEqual(stored, { city: "手填城市", notes: "保留备注", socialProfileTask: "transient-task" }, "stored object is not mutated");
console.log("PASS: seven basic fields, accepted-only recovery, self/person isolation, legacy labels, manual-value preservation, idempotency and no source mutation");
