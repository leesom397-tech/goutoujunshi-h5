import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";

// Exercise the actual handler shared by miniapp and cookie-authenticated web
// requests. A controlled D1 adapter records the update without touching accounts.
const original = { city: "上海", occupation: "教师", avatar: "existing-avatar", relationshipHistory: [{ reportId: "original-report", score: 62 }], communicationReading: { summary: "保留历史评价" } };
const updates = [];
const db = {
  prepare(sql) {
    return {
      bind(...values) {
        return {
          async first() {
            if (sql.startsWith("SELECT consent_at,paused FROM coach_profiles")) return { consent_at: 1, paused: 0 };
            if (sql.startsWith("SELECT data FROM coach_subjects")) return { data: JSON.stringify(original) };
            if (sql.startsWith("SELECT consent_at,paused,data FROM coach_profiles")) return { consent_at: null, paused: 1, data: "{}" };
            throw new Error(`Unexpected read: ${sql}`);
          },
          async all() { return { results: [] }; },
          async run() { updates.push({ sql, values }); return { meta: { changes: 1 } }; },
        };
      },
    };
  },
};
const compiled = ts.transpileModule(readFileSync("app/api/miniapp/profile/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const handlers = {};
const profileLibrary = {};
new Function("exports", ts.transpileModule(readFileSync("lib/profile.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(profileLibrary);
const profileUpdates = {};
new Function("require", "exports", ts.transpileModule(readFileSync("lib/profile-updates.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(() => profileLibrary, profileUpdates);
new Function("require", "exports", compiled)(name => {
  if (name === "@/db") return { getD1: () => db };
  if (name === "@/lib/miniapp-auth") return { miniappOwner: async () => ({ ownerId: "isolated-owner" }) };
  if (name === "@/lib/relationship-timeline") return { distinctRelationshipEvents: () => [], latestRelationshipSignals: () => [] };
  if (name === "@/lib/profile") return profileLibrary;
  if (name === "@/lib/profile-updates") return profileUpdates;
  return {};
}, handlers);
const id = "11111111-1111-4111-8111-111111111111";
async function save(extra) {
  return handlers.POST(new Request("https://example.test/api/web/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", id, label: "小林", notes: "备注", ...extra }) }));
}

assert.equal((await save({ city: "  杭州  ", occupation: "产品设计师", ageRange: "29 岁" })).status, 200);
let write = updates.at(-1), saved = JSON.parse(write.values[1]);
assert.equal(saved.city, "杭州");
assert.equal(saved.ageRange, "29 岁");
assert.equal(saved.occupation, "产品设计师");
assert.equal(saved.avatar, original.avatar);
assert.deepEqual(saved.relationshipHistory, original.relationshipHistory, "editing basic fields retains history and scores");
assert.deepEqual(saved.communicationReading, original.communicationReading, "editing fields retains insight evidence");
assert.equal(write.values.at(-1), "isolated-owner", "the update remains scoped to the authenticated owner");
assert.equal(write.values.at(-2), id);

assert.equal((await save({ stage: "正在了解" })).status, 200);
saved = JSON.parse(updates.at(-1).values[1]);
assert.equal(saved.city, "上海", "older miniapp save requests omit basics and must preserve them");
assert.equal(saved.occupation, "教师");
assert.equal(saved.stage, "正在了解");
const before = updates.length;
assert.equal((await save({ city: "城".repeat(101) })).status, 400);
assert.equal((await save({ ageRange: 29 })).status, 400);
assert.equal((await save({ education: null })).status, 400);
assert.equal(updates.length, before, "invalid basics are rejected before database mutation");
assert.equal((await save({ city: "" })).status, 200);
assert.equal(JSON.parse(updates.at(-1).values[1]).city, "", "an explicit empty value can clear a manual field");

// Execute the emitted self-profile update against SQLite so JSON retention is
// verified semantically, including the complete nested report and avatar.
assert.equal((await handlers.POST(new Request("https://example.test/api/web/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "self", data: { city: "杭州", goals: "认真了解" } }) }))).status, 200);
const ownUpdate = updates.at(-1), sqlite = new DatabaseSync(":memory:");
sqlite.exec("CREATE TABLE coach_profiles (owner_id TEXT, consent_at INTEGER, paused INTEGER, data TEXT, updated_at INTEGER)");
const momentsReport = { summary: "已归档的本人朋友圈", posts: [{ content: "原始内容", evidence: "图一" }] };
sqlite.prepare("INSERT INTO coach_profiles VALUES (?,1,0,?,1)").run("isolated-owner", JSON.stringify({ avatar: "original-self-avatar", momentsReport, city: "上海" }));
sqlite.prepare(ownUpdate.sql).run(...ownUpdate.values);
const ownSaved = JSON.parse(sqlite.prepare("SELECT data FROM coach_profiles WHERE owner_id=?").get("isolated-owner").data);
assert.equal(ownSaved.city, "杭州");
assert.equal(ownSaved.goals, "认真了解");
assert.equal(ownSaved.avatar, "original-self-avatar");
assert.deepEqual(ownSaved.momentsReport, momentsReport, "editing self details must not delete a paid moments analysis");
sqlite.exec("CREATE TABLE coach_subjects (id TEXT, owner_id TEXT, data TEXT)");
const personData = { ...original, ageRange: "29 岁", notes: "旧备注", ratings: { values: 3 }, actionFeedback: [{ outcome: "positive" }], momentsReport };
sqlite.prepare("INSERT INTO coach_subjects VALUES (?,?,?)").run(id, "isolated-owner", JSON.stringify(personData));
const validData = profileLibrary.cleanData({ notes: "新备注", avatar: "untrusted replacement", relationshipHistory: [], momentsReport: null }, "subject");
sqlite.prepare(`UPDATE coach_subjects SET data=${profileUpdates.editableProfileDataSql("subject")} WHERE id=? AND owner_id=?`).run(JSON.stringify(validData), id, "isolated-owner");
const preserved = JSON.parse(sqlite.prepare("SELECT data FROM coach_subjects WHERE id=?").get(id).data);
assert.equal(preserved.notes, "新备注");
assert.equal(preserved.ratings, undefined, "cleared editable values are removed");
for (const key of ["avatar", "relationshipHistory", "momentsReport", "actionFeedback", "ageRange", "city"]) assert.deepEqual(preserved[key], personData[key], `legacy editor preserves ${key}`);
sqlite.close();
console.log("PASS: web/miniapp basic edits, omitted field preservation, scoped writes, length/type rejection, avatar/history/insight preservation");
