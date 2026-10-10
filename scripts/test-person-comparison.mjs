import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { buildPersonComparison, comparisonSelection } from "../lib/person-comparison.mjs";
const loadedMini = { exports: {} };
new Function("module", readFileSync("miniapp/lib/person-comparison.js", "utf8"))(loadedMini);
const mini = loadedMini.exports;
const source = readFileSync("lib/person-comparison.mjs", "utf8");
assert.equal(readFileSync("miniapp/lib/person-comparison.js", "utf8"), source.replaceAll("export function ", "function ") + "\nmodule.exports = { comparisonSelection, buildPersonComparison };\n", "web and miniapp use identical comparison rules");
const state = { enabled: true, paused: false, self: { preferredRelationship: "稳定关系", boundaries: "尊重独处时间", values: "诚实" },
  subjects: [ { id: "a", label: "合成人物 A", stage: "认识中", city: "杭州", updatedAt: Date.UTC(2026, 9, 1), compatibility: { fitScore: null, coverage: 0, total: 6, fitSummary: "资料尚不足", fit: [{ field: "city", status: "有线索", selfNeed: "杭州", reading: "杭州", score: null, conclusion: "同城不计分", evidence: "双方档案" }] } }, { id: "b", label: "合成人物 B", updatedAt: 1e100 }, { id: "c", label: "合成人物 C" }, { id: "d", label: "合成人物 D" } ],
  facts: [ { id: "pending-city", subjectId: "b", kind: "subjectBasic:city", value: "深圳", status: "pending", evidence: "尚未核对截图", source: "资料截图" }, { id: "b-job", subjectId: "b", kind: "subjectBasic:occupation", value: "设计师", status: "accepted", evidence: "对方明确写出", source: "简介截图", eventDate: "2026-09-20" }, { id: "foreign", subjectId: "foreign", kind: "subjectBasic:city", value: "不能显示的城市", status: "accepted" } ],
  signals: [ { subjectId: "a", reportId: "a-dated", score: 65, comparable: true, estimated: false, eventStart: "2026-09-24", eventEnd: "2026-09-24", updatedAt: Date.UTC(2026, 9, 1), summary: "已有互动依据", nextStep: "确认下次见面时间" }, { subjectId: "a", reportId: "a-upload", score: 99, comparable: true, updatedAt: Date.UTC(2026, 9, 8), summary: "无日期材料不是最近互动" }, { subjectId: "b", reportId: "b-partial", score: 60, comparable: true, estimated: true, updatedAt: Date.UTC(2026, 9, 2) } ],
  trends: [ { subjectId: "a", points: [{ subjectId: "a", reportId: "a-dated", eventStart: "2026-09-24", eventEnd: "2026-09-24", connectPrevious: true, dateLabel: "2026-09-24", changeSummary: "与 2026-09-20 的聊天相比，回应承接：60 → 65" }, { subjectId: "a", reportId: "undated", connectPrevious: false, changeSummary: "上传较晚不能自动替代有日期的趋势" }] } ] };
if (process.argv.includes("--write-fixture")) { mkdirSync(".tmp", { recursive: true }); writeFileSync(".tmp/miniapp-comparison-fixture.json", JSON.stringify(state, null, 2)); }
assert.deepEqual(comparisonSelection(state.subjects, ["b", "a", "foreign", "b", "d", "c"]), ["b", "a", "d"], "selection keeps user order, removes foreign/deleted/duplicate IDs, caps at three");
const before = JSON.stringify(state), view = buildPersonComparison(state, ["b", "a"]);
assert.equal(JSON.stringify(state), before, "comparison cannot mutate stored archive data");
assert.deepEqual(mini.buildPersonComparison(state, ["b", "a"]), view);
assert.equal(view.ready, true); assert.deepEqual(view.people.map(person => person.id), ["b", "a"]);
const row = key => view.rows.find(item => item.key === key).cells;
assert.equal(row("city")[0].text, "未提供", "pending clue cannot become a confirmed field");
assert.equal(row("city")[1].text, "杭州");
assert.equal(row("occupation")[0].text, "设计师"); assert.match(row("occupation")[0].source, /已确认.*简介截图.*2026-09-20.*对方明确写出/);
assert.match(row("pending")[0].text, /待核对：深圳/); assert.equal(row("pending")[0].caution, true);
assert.match(row("verify")[0].text, /深圳/); assert.match(row("verify")[1].source, /想要的关系/);
assert.match(row("interaction")[0].text, /片段参考，暂不可比较/);
assert.match(row("interaction")[1].text, /65 \/ 100/); assert.equal(row("interaction")[1].reportId, "a-dated");
assert.match(row("interaction")[1].source, /材料日期 2026-09-24.*保存于 2026-10-01/);
assert.equal(row("trend")[0].text, "尚无连续可比记录"); assert.match(row("trend")[1].text, /回应承接：60 → 65/);
assert.match(row("fit")[1].text, /未提供可用适配分数.*\n有可计分资料 0 \/ 6/);
assert.doesNotMatch(row("fit")[1].text, /^0 \/ 100/);
assert.match(row("fit:city")[1].text, /同城不计分/);
assert.match(view.people[0].updated, /日期未提供/, "malformed timestamp cannot crash the list");
assert.doesNotMatch(JSON.stringify(view), /不能显示的城市|无日期材料不是最近互动|上传较晚不能/);
assert.equal(buildPersonComparison(state, ["a"]).ready, false);
assert.deepEqual(buildPersonComparison({ ...state, subjects: [] }, view.ids).ids, []);

// Execute the actual miniapp list controls without a simulator or API requests.
let page;
new Function("require", "Page", "wx", readFileSync("miniapp/pages/archive/index.js", "utf8"))(
  path => path.endsWith("person-comparison") ? mini : {}, value => { page = value; }, { navigateTo() { throw Error("selection must not navigate or fetch"); } });
const instance = { ...page, data: JSON.parse(JSON.stringify(page.data)), _lastState: state, setData(value, callback) { Object.assign(this.data, value); callback?.(); } };
instance.updateComparison(state);
for (const id of ["b", "a", "c", "d", "foreign"]) instance.changeComparison({ currentTarget: { dataset: { id } } });
assert.deepEqual(instance.data.comparisonIds, ["b", "a", "c"]); assert.equal(instance.data.comparisonWidth, "1390rpx");
instance.changeComparison({ currentTarget: { dataset: { id: "a" } } });
assert.deepEqual(instance.data.comparisonIds, ["b", "c"]);
instance.updateComparison({ ...state, subjects: state.subjects.filter(person => person.id !== "b") });
assert.deepEqual(instance.data.comparisonIds, ["c"]); assert.equal(instance.data.comparison.ready, false);
instance.toggleComparison(); assert.equal(instance.data.showComparison, true);
instance.toggleComparisonDetails(); assert.equal(instance.data.comparisonDetailed, true);
assert.doesNotMatch(source, /fetch\(|api\.|request\(|localStorage|sessionStorage|sort\([^\n]*(?:fitScore|score)/, "read-only comparison never calls a model or ranks people by scores");
console.log("PASS person comparison: shared rules, current archive scope, unknowns/pending/source dates, partial metrics, read-only and actual miniapp selection lifecycle");
