// Verifies that person questions can retrieve the complete, synced chat
// archive through the same profile-context path as the other advice routes.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const load = (file, mocks = {}, cache = new Map()) => {
  const path = resolve(file); if (cache.has(path)) return cache.get(path);
  const exports = {}; cache.set(path, exports);
  const js = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("exports", "require", js)(exports, name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/") || name.startsWith(".")) {
      let next = name.startsWith("@/") ? resolve(name.slice(2)) : resolve(dirname(path), name);
      if (!/\.(?:ts|mjs|json)$/.test(next)) next += ".ts";
      return load(next, mocks, cache);
    }
    throw Error("Unexpected import: " + name);
  });
  return exports;
};

const sql = new DatabaseSync(":memory:");
for (const file of readdirSync("drizzle").filter(file => file.endsWith(".sql")).sort()) sql.exec(readFileSync("drizzle/" + file, "utf8"));
const db = { prepare(query) { return { args: [], bind(...args) { this.args = args; return this; }, async first() { return sql.prepare(query).get(...this.args) || null; }, async all() { return { results: sql.prepare(query).all(...this.args) }; } }; } };
const context = load("lib/profile-context.ts", { "@/db": { getD1: () => db } });
const questionDepth = load("lib/capture-question-depth.ts");
const owner = "capture-memory-owner", other = "capture-memory-other", subject = "11111111-1111-4111-8111-111111111111", foreignSubject = "22222222-2222-4222-8222-222222222222";
sql.prepare("INSERT INTO coach_profiles(owner_id,consent_at,paused,data,updated_at) VALUES(?,1,0,'{}',1)").run(owner);
sql.prepare("INSERT INTO coach_profiles(owner_id,consent_at,paused,data,updated_at) VALUES(?,1,0,'{}',1)").run(other);
for (const [id, who] of [[subject, owner], [foreignSubject, other]]) sql.prepare("INSERT INTO coach_subjects(id,owner_id,label,status,data,created_at,updated_at) VALUES(?,?,?,'active','{}',1,1)").run(id, who, who === owner ? "雅欣" : "另一个人");
const library = "cl_capture_memory_test";
sql.prepare("INSERT INTO coach_capture_libraries(id,owner_id,account,friend,kind,subject_id,epoch,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,1,0,?,?)").run(library, owner, "wx", "雅欣", "chat", subject, "2026-10-01T00:00:00.000Z", "2026-10-03T00:00:00.000Z");
const row = (id, role, at, text, kind = "text") => ({ localId: id, kind, sender: role === "self" ? "我" : "雅欣", senderRole: role, at, text, source: { label: "本机数据库", method: "wechat-local-db" }, firstCapturedAt: "2026-10-03T00:00:00.000Z", lastCapturedAt: "2026-10-03T00:00:00.000Z", imageCount: 0 });
const rows = [row("r1", "self", "2026-10-01T09:00:00.000Z", "周末一起看展吗？"), row("r2", "other", "2026-10-01T09:02:00.000Z", "好呀，周六下午可以。"), row("r3", "self", "2026-10-03T09:00:00.000Z", "上次看展的票我已经买好了。")];
rows.forEach(value => sql.prepare("INSERT INTO coach_capture_records(library_id,owner_id,epoch,local_id,digest,record_json,sort_known,sort_time,updated_at) VALUES(?,?,?,?,?,?,0,?,1)").run(library, owner, 1, value.localId, value.localId, JSON.stringify(value), Date.parse(value.at)));
const result = await context.loadProfileContext(owner, subject, "看展票买好了吗？", 2600);
assert.match(result, /已授权的完整聊天资料库摘要/);
assert.match(result, /看展的票我已经买好了/);
assert.match(result, /"total":3/);
assert.doesNotMatch(result, /另一个人/);
const excerpts = questionDepth.captureArchiveExcerpts(result);
assert(excerpts.some(line => line.includes("周末一起看展吗？")));
assert(excerpts.some(line => line.includes("看展的票我已经买好了。")));
assert.equal(questionDepth.needsCaptureHistoryAnswer("根据全部聊天，她对我的投入有变化吗？", excerpts, false), true);
assert.equal(questionDepth.needsCaptureHistoryAnswer("只给一句怎么回？", excerpts, false), false);
assert.equal(questionDepth.needsCaptureHistoryAnswer("结合之前全部聊天，这张图意味着什么？", excerpts, true, true), true);
assert.equal(questionDepth.needsCaptureHistoryAnswer("为什么建议这么回复？", excerpts, false), true);
const foreign = await context.loadProfileContext(other, foreignSubject, "看展", 2600);
assert.doesNotMatch(foreign, /看展的票我已经买好了/);
assert.ok(result.length <= 2600);
const beforeReport = await context.loadFullHistoryQuestionContext(owner, subject, "看展安排有哪些变化？");
assert.equal(beforeReport.status, "ready");
assert.equal(beforeReport.semanticStatus, "not-generated");
assert.match(beforeReport.context, /不要声称已逐条理解全部聊天/);
const reportId = "33333333-3333-4333-8333-333333333333";
const report = {analysisScope: "fullHistory", archiveSnapshot: {libraryId: library, epoch: 1, revision: 0, total: 3}, semanticHistory: {
  status: "complete", coverage: {analyzedText: 3}, summaryEvidenceIds: ["h1"], findings: [
    {id: "h1", claim: "给出了具体可用时间", alternative: "这不等于浪漫意愿", evidence: [{sourceId: "r2", senderRole: "other", at: rows[1].at, quote: "周六下午可以"}]},
    {id: "forged", claim: "捏造关系事实", evidence: [{sourceId: "foreign-message", senderRole: "other", quote: "我已经答应结婚"}]}
  ]
}};
sql.prepare("INSERT INTO coach_saved_reports(id,owner_id,kind,subject_id,status,result,created_at,updated_at) VALUES(?,?,'chat',?,'done',?,1,1)").run(reportId, owner, subject, JSON.stringify(report));
const withReport = await context.loadFullHistoryQuestionContext(owner, subject, "看展安排");
assert.equal(withReport.semanticStatus, "complete");
assert.match(withReport.context, /给出了具体可用时间/);
assert.doesNotMatch(withReport.context, /捏造关系事实|已经答应结婚/);
assert(questionDepth.captureArchiveExcerpts(withReport.context).some(line => line.includes("周六下午可以")));
sql.prepare("UPDATE coach_capture_libraries SET revision=1 WHERE id=?").run(library);
assert.equal((await context.loadFullHistoryQuestionContext(owner, subject, "看展")).semanticStatus, "partial", "modified source snapshot invalidates the old complete-coverage claim");
sql.prepare("UPDATE coach_profiles SET paused=1 WHERE owner_id=?").run(owner);
assert.equal((await context.loadFullHistoryQuestionContext(owner, subject, "看展")).status, "paused");
console.log("Capture memory context passed: owner/person scoped archive retrieval, query evidence, aggregate count, and bounded prompt.");
