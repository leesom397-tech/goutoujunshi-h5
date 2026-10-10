import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const js = ts.transpileModule(readFileSync("app/api/miniapp/session/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness() {
  const identity = deferred(), subjects = deferred(), settings = deferred(), phone = deferred();
  const started = [], exports = {};
  const db = { prepare(sql) { return { bind(...args) {
    const name = sql.includes("coach_subjects") ? "subjects" : "phone";
    const read = () => { started.push({ name, args }); return (name === "subjects" ? subjects : phone).promise; };
    return { all: read, first: read };
  } }; } };
  const dependencies = {
    "@/db": { getD1: () => db },
    "@/lib/miniapp-auth": { miniappOwner: () => identity.promise },
    "@/lib/crush/service": { getSettings(owner) { started.push({ name: "settings", args: [owner] }); return settings.promise; } }
  };
  new Function("exports", "require", js)(exports, name => dependencies[name]);
  return { route: exports, identity, subjects, settings, phone, started };
}
const h = harness();
const pending = h.route.GET(new Request("https://local/api/miniapp/session"));
assert.equal(h.started.length, 0, "no owner data is read before authentication resolves");
h.identity.resolve({ ownerId: "synthetic-owner", openId: "synthetic-openid" });
await Promise.resolve();
assert.deepEqual(h.started, [
  { name: "subjects", args: ["synthetic-owner"] },
  { name: "settings", args: ["synthetic-owner"] },
  { name: "phone", args: ["synthetic-openid", "synthetic-owner"] }
], "all three reads start before any one finishes and keep ownership predicates");
h.phone.resolve({ phone_last4: "1234", phone_verified_at: 1 });
h.settings.resolve({ consent_at: 1, image_consent_at: 1, image_self_side: "right" });
h.subjects.resolve({ results: [{ id: "person-a", label: "合成人物" }] });
const response = await pending;
assert.equal(response.headers.get("Cache-Control"), "no-store");
assert.deepEqual(await response.json(), { linked: true, subjects: [{ id: "person-a", label: "合成人物" }], phone: { verified: true, masked: "****1234" }, screenshot: { enabled: true, selfSide: "right" } });
const denied = harness();
const unauthorized = denied.route.GET(new Request("https://local/api/miniapp/session"));
denied.identity.resolve(null);
assert.equal((await unauthorized).status, 401);
assert.equal(denied.started.length, 0, "anonymous requests never query subjects/settings/phone");
console.log("PASS: authenticated session reads overlap, owner predicates remain, response contract/no-store preserved, anonymous reads denied");
