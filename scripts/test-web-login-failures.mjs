import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { nativeLogin, nativeRegister, nativeSession } from '../lib/web-native-auth.mjs';

const sql = new DatabaseSync(':memory:');
for (const name of ['0017_web_accounts', '0021_verified_legacy_sessions']) sql.exec(readFileSync(new URL(`../drizzle/${name}.sql`, import.meta.url), 'utf8'));
let failQuery = null, sequence = 0, upstream;
const privateValue = 'SYNTHETIC_PRIVATE_VALUE_NEVER_LOG_THIS';
const env = { DB: { prepare(query) {
  if (failQuery?.test(query)) throw new Error(privateValue);
  let values = [];
  return {
    bind(...args) { values = args; return this; },
    async first() { return sql.prepare(query).get(...values) || null; },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } }; },
  };
} } };
const origin = 'https://coach.example.test';
const request = (body = {}, headers = {}) => new Request(`${origin}/api/auth/login`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.99', ...headers },
  body: JSON.stringify({ username: `synthetic_failure_${++sequence}`, password: privateValue, ...body }),
});
const originalFetch = globalThis.fetch, originalWarn = console.warn, diagnostics = [];
globalThis.fetch = async () => upstream();
console.warn = (...args) => diagnostics.push(args);
const countSessions = () => sql.prepare('SELECT COUNT(*) AS n FROM coach_web_legacy_sessions').get().n;

async function fails(run, { status = 503, phase, errorClass, upstreamStatus = status, retryAfter } = {}) {
  const before = diagnostics.length, beforeSessions = countSessions();
  const response = await run();
  assert.equal(response.status, status);
  assert.equal(response.headers.get('set-cookie'), null, 'an unavailable provider never creates a browser session');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(countSessions(), beforeSessions);
  assert.equal(diagnostics.length, before + 1);
  const [tag, raw] = diagnostics.at(-1), log = JSON.parse(raw), body = await response.json();
  assert.equal(tag, '[web_auth_login]');
  assert.deepEqual(Object.keys(log).sort(), ['elapsedMs', 'errorClass', 'phase', 'requestId', 'status'].sort());
  assert.equal(log.phase, phase);
  assert.equal(log.errorClass, errorClass);
  assert.equal(log.status, upstreamStatus);
  assert.match(log.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(log.requestId, body.requestId);
  assert.ok(Number.isFinite(log.elapsedMs) && log.elapsedMs >= 0);
  assert.equal(JSON.stringify([diagnostics, body]).includes(privateValue), false, 'credentials and thrown error text never enter diagnostics or responses');
  if (retryAfter) assert.equal(response.headers.get('retry-after'), retryAfter);
}

try {
  for (const name of ['TimeoutError', 'AbortError']) {
    upstream = () => { throw new DOMException(privateValue, name); };
    await fails(() => nativeLogin(request(), env), { phase: 'legacy_fetch', errorClass: 'upstream_timeout' });
  }
  upstream = () => { throw new TypeError(privateValue); };
  await fails(() => nativeLogin(request(), env), { phase: 'legacy_fetch', errorClass: 'upstream_network' });
  for (const status of [500, 502, 503]) {
    upstream = () => new Response(`<html>${privateValue}</html>`, { status });
    await fails(() => nativeLogin(request(), env), { phase: 'legacy_status', errorClass: 'upstream_server', upstreamStatus: status });
  }
  upstream = () => new Response(null, { status: 302, headers: { Location: `https://invalid.example/${privateValue}` } });
  await fails(() => nativeLogin(request(), env), { phase: 'legacy_status', errorClass: 'upstream_redirect', upstreamStatus: 302 });
  for (const [value, retryAfter] of [['45', '45'], ['999999', '900'], [privateValue, '30']]) {
    upstream = () => new Response(privateValue, { status: 429, headers: { 'Retry-After': value } });
    await fails(() => nativeLogin(request(), env), { status: 429, phase: 'legacy_status', errorClass: 'upstream_rate_limit', retryAfter });
  }
  for (const status of [200, 401]) {
    upstream = () => new Response(`<html>${privateValue}</html>`, { status });
    await fails(() => nativeLogin(request(), env), { phase: 'legacy_json', errorClass: 'upstream_non_json', upstreamStatus: status });
  }
  upstream = () => ({ status: 200, ok: true, async json() { throw new DOMException(privateValue, 'AbortError'); } });
  await fails(() => nativeLogin(request(), env), { phase: 'legacy_json', errorClass: 'upstream_timeout', upstreamStatus: 200 });
  for (const body of [null, [], { logged_in: true, user: 'synthetic_account' }, { logged_in: true, user: { privateValue } }]) {
    upstream = () => Response.json(body);
    await fails(() => nativeLogin(request(), env), { phase: 'legacy_verify', errorClass: 'upstream_contract', upstreamStatus: 200 });
  }
  upstream = () => Response.json({ error: privateValue }, { status: 404 });
  await fails(() => nativeLogin(request(), env), { phase: 'legacy_verify', errorClass: 'upstream_status', upstreamStatus: 404 });
  for (const status of [200, 401, 403]) {
    upstream = () => Response.json({ logged_in: false, error: privateValue }, { status });
    const before = diagnostics.length, response = await nativeLogin(request(), env);
    assert.equal(response.status, 401);
    assert.equal(diagnostics.length, before, 'ordinary incorrect credentials do not create operational failure logs');
    assert.equal((await response.text()).includes(privateValue), false);
  }
  for (const [query, phase] of [[/INSERT INTO coach_web_auth_attempts/, 'rate_limit'], [/SELECT id,username,password_salt/, 'native_lookup']]) {
    failQuery = query;
    await fails(() => nativeLogin(request(), env), { phase, errorClass: 'local_failure' });
  }
  failQuery = /INSERT INTO coach_web_legacy_sessions/;
  upstream = () => Response.json({ logged_in: true, user: 'synthetic_verified' }, { headers: { 'Set-Cookie': 'lt_next_session=synthetic_valid_token_123456789; HttpOnly' } });
  await fails(() => nativeLogin(request(), env), { phase: 'legacy_session', errorClass: 'local_failure' });
  failQuery = null;
  const response = await nativeLogin(request(), env);
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('cz_session='))?.split(';')[0];
  assert.match(cookie, /^cz_session=[a-f0-9]{64}$/);
  assert.equal((await nativeSession(new Headers({ Cookie: cookie }), env)).ownerId, 'lovetalk:synthetic_verified', 'the verified upstream identity, not the entered name, owns the session');
  const nativeName = 'synthetic_native';
  assert.equal((await nativeRegister(request({ username: nativeName, agree: true }), env)).status, 200);
  failQuery = /INSERT INTO coach_web_sessions/;
  await fails(() => nativeLogin(request({ username: nativeName }), env), { phase: 'native_session', errorClass: 'local_failure' });
  assert.equal(new Set(diagnostics.map(([, raw]) => JSON.parse(raw).requestId)).size, diagnostics.length);
} finally {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  sql.close();
}
console.log('PASS: login failures distinguish network/timeouts, provider status/schema and local session phases; rate limits remain 429; only verified identities receive sessions; diagnostics contain no credentials, cookies, usernames or upstream/error text.');
