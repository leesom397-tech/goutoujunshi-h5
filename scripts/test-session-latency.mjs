import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync("miniapp/lib/api.js", "utf8");
const key = "lovetalk_mini_session_v1";
function harness(cached) {
  const store = new Map(cached ? [[key, cached]] : []), requests = [], logins = [];
  const wx = {
    getStorageSync: k => store.get(k), setStorageSync: (k,v) => store.set(k,v), removeStorageSync: k => store.delete(k),
    request: value => requests.push(value), login: value => logins.push(value)
  };
  const module = { exports: {} };
  new Function("module", "wx", source)(module, wx);
  return { api: module.exports, store, requests, logins };
}
const cached = { token: "a".repeat(64), expiresAt: Date.now() + 86400000, state: { subjects: [{ id: "synthetic-a" }] } };
const h = harness(cached);
const fast = await h.api.session({ cacheFirst: true });
assert.equal(fast.cached, true, "home resolves while network callback has NOT fired");
assert.equal(h.requests.length, 1);
const fresh1 = h.api.session(), fresh2 = h.api.session();
assert.equal(fresh1, fresh2, "simultaneous callers share one promise");
assert.equal(h.requests.length, 1);
h.requests[0].success({ statusCode: 200, data: { linked: true, subjects: [{ id: "fresh-a" }] } });
assert.equal((await fresh1).state.subjects[0].id, "fresh-a");
assert.equal(h.logins.length, 0);
// Late refresh from a previous account must not overwrite a new account.
const swapped = harness(cached);
const old = swapped.api.session();
swapped.store.set(key, { ...cached, token: "b".repeat(64), state: { subjects: [{ id: "person-b" }] } });
swapped.requests[0].success({ statusCode: 200, data: { subjects: [{ id: "person-a" }] } });
await assert.rejects(old, /身份已变化/);
assert.equal(swapped.store.get(key).state.subjects[0].id, "person-b");
// No valid cache: only one wx.login and exchange, then one state request.
const cold = harness();
const first = cold.api.session({ cacheFirst: true }), second = cold.api.session();
assert.equal(first, second);
assert.equal(cold.logins.length, 1);
cold.logins[0].success({ code: "synthetic-code" });
await Promise.resolve();
assert.equal(cold.requests.length, 1);
cold.requests[0].success({ statusCode: 200, data: { linked: true, token: cached.token, expiresAt: cached.expiresAt } });
await Promise.resolve();
assert.equal(cold.requests.length, 2);
assert.equal(cold.api.session(), first, "call during first state load does not create another request");
cold.requests[1].success({ statusCode: 200, data: cached.state });
assert.equal((await first).token, cached.token);
// An expired token never provides the cache-first path.
const expired = harness({ ...cached, expiresAt: Date.now() - 1 });
const renewing = expired.api.session({ cacheFirst: true });
assert.equal(expired.logins.length, 1);
expired.logins[0].fail();
await assert.rejects(renewing, /微信登录未完成/);
// A revoked token must be removed; API auth is not bypassed by home cache.
const revoked = harness(cached);
const refresh = revoked.api.session();
revoked.requests[0].success({ statusCode: 401, data: { error: "expired" } });
await Promise.resolve();
assert.equal(revoked.store.has(key), false);
assert.equal(revoked.logins.length, 1);
revoked.logins[0].fail();
await assert.rejects(refresh, /微信登录未完成/);
console.log("PASS: cache-first home without network wait, shared refresh/login, cold-start hydration coalescing, expired/revoked credentials and cross-account late-response guards");
