import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("lib/relationship-history.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const api = {};
new Function("exports", "require", js)(api, name => {
  if (name === "@/db") return { getD1() { throw new Error("unexpected database access"); } };
  if (name === "@/lib/relationship-timeline") return {};
  throw new Error(`Unexpected import ${name}`);
});
const signals = (...texts) => api.observedSignals({
  lines: texts.map((text, i) => ({ speaker: i % 2 ? "other" : "self", text })),
  decision: {}, createdAt: 1
});
for (const text of [
  "上次没见面", "上次见面没见成", "今天吃药很开心", "上次看了天气预报",
  "今天一起吃饭取消了", "如果上次见面就好了", "本来今天见面，临时取消了",
  "期待今天见面", "希望见到你很开心", "听说上次见面很开心",
  "她说上次见面很开心", "他说：见到你很开心", "“见到你很开心”这句话怎么回复",
  "今天和同事吃饭很开心", "明天见到你很开心", "上次见面？", "到家了，谢谢", "今天见面", "今天跟你吃饭"
]) {
  assert.equal(signals(text).completionCount, 0, text);
}
for (const text of ["今天见到你很开心", "上次见面聊得很愉快", "昨天跟你吃饭很开心", "见到你很开心"]) {
  const result = signals(text);
  assert.equal(result.completionCount, 1, text);
  assert.equal(result.stage, "出现见面回顾线索");
  assert.equal(result.meetingCountScope, "text_clues_not_events");
}
const mixed = signals("明天要不要一起吃饭？", "上次见面很开心");
assert.equal(mixed.invitationCount, 1);
assert.equal(mixed.completionCount, 1);
assert.equal(mixed.dimensions.find(item => item.label === "邀约兑现").value, null,
  "an unrelated past recap must not count as tomorrow's invitation fulfillment");
assert.equal(signals("上次见面很开心", "不要再联系我").stage, "明确退出信号");
assert.equal(signals("一起吃药", "周日见天气预报").invitationCount, 0);
const input = { lines: [{ speaker: "self", text: "上次没见面" }], decision: {}, createdAt: 1 };
const before = structuredClone(input);
api.observedSignals(input);
assert.deepEqual(input, before);
console.log("Observed signals: phrase boundaries, negation, planned/reported meetings and unlinked fulfillment passed.");
