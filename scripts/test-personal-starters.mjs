import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const module = { exports: {} };
new Function("exports", ts.transpileModule(readFileSync("lib/personal-starters.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(module.exports);
const { personalConversationStarter: starter } = module.exports;
const self = { id: "self", side: "self", quote: "摄影", basis: "statement" };
const other = { id: "other", side: "other", quote: "喜欢摄影", basis: "statement" };
const point = { id: "common-photography", evidenceIds: ["self", "other"] };
assert.match(starter(point, [self, other]), /拍照/);
assert.equal(starter(point, [other]), "");
assert.equal(starter(point, [self]), "");
assert.equal(starter(point, [self, { ...other, basis: "observation" }]), "");
assert.equal(starter({ ...point, id: "difference-photography" }, [self, other]), "");
assert.equal(starter({ ...point, id: "topic-unknown" }, [self, other]), "");
assert.ok(starter({ id: "topic-photography", evidenceIds: ["other"] }, [other]));
for (const topic of ["photography", "art", "career", "travel", "outdoors", "exercise", "music", "reading", "film", "food", "coffee", "pets", "games", "craft", "quiet", "honesty", "growth", "planning", "expectation"]) {
  const line = starter({ id: `common-${topic}`, evidenceIds: ["self", "other"] }, [self, other]);
  assert.ok(line.endsWith("？"), topic);
  assert.doesNotMatch(line, /我也|我去过|你家|你的狗|我们一起|你一定|明天|周六/);
}
console.log("PASS personal starters: grounded topics, dual-sided common points, observations excluded, no invented experience or automatic invitation.");
