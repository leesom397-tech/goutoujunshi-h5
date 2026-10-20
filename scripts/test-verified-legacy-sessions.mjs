import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { readWebIdentity } from "../lib/request-identity.mjs";
import { currentIdentityScope, withWebIdentityScope } from "../lib/web-identity-state.mjs";
import { authCookie, digest, nativeSession, nativeLogin, nativeLogout, upgradeVerifiedLegacyResponse } from "../lib/web-native-auth.mjs";

const sql = new DatabaseSync(":memory:");
for (const name of ["0017_web_accounts", "0021_verified_legacy_sessions", "0021_verified_legacy_sessions"])
  sql.exec(readFileSync(`drizzle/${name}.sql`, "utf8"));
const env = { DB: { prepare(query) { let args = []; return {
  bind(...values) { args = values; return this; },
  async first() { return sql.prepare(query).get(...args) || null; },
  async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } }; },
}; } } };
const origin = "https://coach.example.test", upstreamFetch = globalThis.fetch;
let calls = 0, status = 200, unavailable = false;
const cookie = name => `lt_next_session=synthetic_${name}_session_token_123456789`;
const get = (name, extra = {}, path = "/api/web/account-context") => new Request(origin + path, { headers: { Cookie: cookie(name), ...extra } });
const count = () => sql.prepare("SELECT COUNT(*) AS n FROM coach_web_legacy_sessions").get().n;
const localCookie = response => response.headers.getSetCookie().find(value => /^cz_verified_session=[a-f0-9]{64};/.test(value))?.split(";")[0];
const directCookie = response => response.headers.getSetCookie().find(value => /^cz_session=[a-f0-9]{64};/.test(value))?.split(";")[0];
globalThis.fetch = async (url, options) => {
  calls++;
  if (unavailable) throw Error("synthetic upstream outage");
  if (String(url).endsWith("/logout")) return Response.json({ ok: true });
  if (String(url).endsWith("/login")) {
    const input = JSON.parse(options.body);
    if (input.password !== "synthetic-correct-password") return Response.json({ logged_in: false }, { status: 401 });
    return Response.json({ logged_in: true, user: input.username }, { headers: { "Set-Cookie": cookie(input.username) + "; HttpOnly" } });
  }
  if (status !== 200) return Response.json({ logged_in: false }, { status });
  const name = /synthetic_(.*?)_session_token/.exec(options.headers.Cookie)?.[1];
  return Response.json(name ? { logged_in: true, user: name } : { logged_in: false });
};
async function route(request, options = {}) {
  return withWebIdentityScope(authCookie(request), async () => {
    const identity = await readWebIdentity(request.headers, env);
    if (!identity) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (options.beforeUpgrade) await options.beforeUpgrade(identity);
    const result = Response.json({ owner: identity.ownerId }, { status: options.status || 200, headers: { "X-Fixture": "kept" } });
    return upgradeVerifiedLegacyResponse(request, result, env, currentIdentityScope()?.verifiedLegacyIdentity);
  });
}
const logout = (Cookie) => nativeLogout(new Request(origin + "/api/auth/logout", { method: "POST", headers: { Origin: origin, Cookie } }), env);
try {
  const first = await route(get("alice"));
  const migrated = localCookie(first);
  assert.match(migrated, /^cz_verified_session=[a-f0-9]{64}$/);
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  assert.equal(first.headers.get("X-Fixture"), "kept");
  assert.deepEqual(await first.json(), { owner: "lovetalk:alice" });
  assert.ok(first.headers.getSetCookie().some(value => /HttpOnly; SameSite=Lax; Max-Age=604800; Secure/.test(value)));
  assert.ok(first.headers.getSetCookie().some(value => value.startsWith("lt_next_session=;") && value.includes("Max-Age=0")));
  const token = migrated.split("=")[1], row = sql.prepare("SELECT * FROM coach_web_legacy_sessions WHERE token_hash=?").get(await digest(token));
  assert.equal(row.owner_id, "lovetalk:alice");
  assert.equal(row.source_cookie_hash, await digest(cookie("alice").split("=")[1]));
  assert.equal(row.expires_at - row.created_at, 7 * 86400000);
  assert.ok(!JSON.stringify(row).includes(token), "raw local token is never stored");
  unavailable = true;
  const before = calls;
  assert.equal((await readWebIdentity(new Headers({ Cookie: migrated }), env)).ownerId, "lovetalk:alice");
  assert.equal(calls, before, "verified local session works while the old account service is offline");
  assert.equal(await readWebIdentity(new Headers({ Cookie: "cz_session=invalid; " + migrated }), env), null, "invalid explicit-login cookie cannot downgrade to a migrated identity");
  assert.equal(await readWebIdentity(new Headers({ Cookie: migrated + "; " + migrated }), env), null, "duplicate migrated cookies are rejected");
  unavailable = false;

  for (const failure of [401, 403, 503]) {
    status = failure;
    const before = count(), response = await route(get("rejected"));
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(count(), before);
    assert.equal(response.status, failure === 503 ? 503 : 401);
  }
  status = 200;
  for (const extra of [{ Origin: "https://other.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
    const request = get("cross_site", extra), response = Response.json({ ok: true });
    assert.equal(await upgradeVerifiedLegacyResponse(request, response, env, { ownerId: "lovetalk:cross_site", displayName: "cross_site" }), response);
    assert.equal(response.headers.get("Set-Cookie"), null);
  }
  for (const responseStatus of [302, 400, 401, 503]) {
    const response = await route(get("status_" + responseStatus), { status: responseStatus });
    assert.equal(response.headers.get("Set-Cookie"), null, "only successful 2xx reads upgrade");
  }
  // An old request waiting at the upgrade boundary must not resurrect logout.
  const late = await route(get("late_logout"), { beforeUpgrade: async () => assert.equal((await logout(cookie("late_logout"))).status, 200) });
  assert.equal(localCookie(late), undefined);
  const afterLogoutCalls = calls;
  assert.equal(await readWebIdentity(new Headers({ Cookie: cookie("late_logout") }), env), null);
  assert.equal(calls, afterLogoutCalls, "revoked old source never falls back to upstream");

  // A response already issued before logout can arrive late; its token is dead.
  const issued = localCookie(await route(get("issued_before_logout")));
  await logout(cookie("issued_before_logout"));
  assert.equal(await nativeSession(new Headers({ Cookie: issued }), env), null);

  // Switching accounts cannot be overwritten by a late automatic-upgrade cookie.
  let switched;
  const oldResponse = await route(get("old_account"), { beforeUpgrade: async () => {
    switched = await nativeLogin(new Request(origin + "/api/auth/login", {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie("old_account") },
      body: JSON.stringify({ username: "new_account", password: "synthetic-correct-password", accountType: "existing" }),
    }), env);
    assert.equal(switched.status, 200);
  } });
  assert.equal(localCookie(oldResponse), undefined, "old source is atomically rejected after switching");
  const currentCookie = directCookie(switched);
  assert.match(currentCookie, /^cz_session=[a-f0-9]{64}$/);
  assert.equal((await nativeSession(new Headers({ Cookie: currentCookie + "; " + migrated }), env)).ownerId, "lovetalk:new_account", "explicit login takes precedence even if an older upgrade response arrives");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM coach_web_users").get().n, 0, "migration never creates a same-name native user");

  await logout(migrated);
  assert.equal(await nativeSession(new Headers({ Cookie: migrated }), env), null);
  assert.equal(await readWebIdentity(new Headers({ Cookie: cookie("alice") }), env), null, "logout using the migrated cookie also revokes its original source");
  const expiring = localCookie(await route(get("expired")));
  sql.prepare("UPDATE coach_web_legacy_sessions SET expires_at=0 WHERE owner_id=?").run("lovetalk:expired");
  assert.equal(await readWebIdentity(new Headers({ Cookie: expiring + "; " + cookie("expired") }), env), null, "expired local token cannot downgrade to old upstream cookie");
  console.log("PASS: verified legacy owner retained; secure hashed seven-day local sessions survive upstream outage; invalid/401/403/503/CSRF cannot issue; logout and account-switch races revoke sources; late cookies cannot replace explicit login; expiry and native-account priority preserved.");
} finally { globalThis.fetch = upstreamFetch; sql.close(); }
