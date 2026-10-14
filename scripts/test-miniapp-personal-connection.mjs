import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const shared = { exports: {} };
new Function("module", "exports", ts.transpileModule(readFileSync("lib/personal-context.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shared, shared.exports);
const native = { exports: {} }; let definition;
new Function("Component", "module", readFileSync("miniapp/components/personal-connection/index.js", "utf8"))(value => { definition = value; }, native);
const present = native.exports.presentConnection;
const evidence = [
  { id: "mine", side: "self", source: "self-profile", label: "我的兴趣", quote: "我喜欢摄影和看展" },
  { id: "theirs", side: "other", source: "social-profile", label: "主页兴趣栏", quote: "摄影和看展" },
];
const connection = shared.exports.personalConnection({}, { evidence });
const view = present(connection);
assert.equal(view.count, 2); assert.equal(view.common.length, 2);
assert.match(view.title, /共同点 · 2/);
for (const item of view.common) {
  assert.deepEqual(item.evidence.map(row => row.who), ["你", "对方"]);
  assert.ok(item.action.length > 0);
}
assert.equal(view.topics.length, 0, "do not repeat the same bilateral evidence as extra topics");
assert.equal(present(connection, true), null);
assert.equal(present({ ...connection, status: "self" }), null);
assert.equal(present(null), null, "old reports with no personal contract remain readable");
assert.equal(present({ ...connection, sources: [evidence[1]] }).count, 0, "one-sided data cannot enter the common count");
const oneSided = present(shared.exports.personalConnection({}, { evidence: [evidence[1]] }));
assert.equal(oneSided.count, 0); assert.ok(oneSided.topics.length > 0);
const different = present(shared.exports.personalConnection({}, { evidence: [evidence[0], { ...evidence[1], quote: "我不喜欢摄影，也不喜欢看展" }] }));
assert.equal(different.count, 0); assert.ok(different.differences.length > 0);
assert.ok(different.differences.every(item => item.alternative && item.action && item.evidence.length === 2));
const component = { setData(update) { this.data = update; } };
definition.observers["value,targetSelf"].call(component, connection, false);
assert.equal(component.data.connection.count, 2);
definition.observers["value,targetSelf"].call(component, null, false);
assert.equal(component.data.connection, null, "clearing/swapping reports clears prior personal details");
console.log("PASS miniapp personal connection: real shared contract, both-side count/source, usable actions, topic dedup, old/self reports hidden, source clearing.");
