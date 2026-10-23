import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync('lib/login-request.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(exports);
const { createLoginRequest } = exports;
const fail = code => error => error.code === code;
let calls = 0;
const good = createLoginRequest({ fetcher: async (url, options) => {
  calls++; assert.equal(url, '/api/auth/login'); assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error');
  assert.deepEqual(JSON.parse(options.body), { username: 'synthetic-user', password: 'synthetic-password' });
  assert.ok(options.signal instanceof AbortSignal);
  return Response.json({ ok: true });
} });
await good.submit('synthetic-user', 'synthetic-password'); assert.equal(calls, 1);
for (const [status, code] of [[400,'credentials'], [401,'credentials'], [403,'server'], [429,'rate-limit'], [500,'server'], [503,'server']]) {
  let attempts = 0;
  const client = createLoginRequest({ fetcher: async () => { attempts++; return new Response('gateway HTML, not JSON', { status }); } });
  await assert.rejects(client.submit('u', 'p'), fail(code)); assert.equal(attempts, 1, 'never retries credentials automatically');
}
for (const response of [new Response('<html>proxy</html>'), Response.json({ ok: false }), Response.json({}), Response.json(null)]) {
  await assert.rejects(createLoginRequest({ fetcher: async () => response }).submit('u', 'p'), fail('invalid-response'));
}
await assert.rejects(createLoginRequest({ fetcher: async () => { throw new TypeError('private server failure'); } }).submit('u', 'p'), error => error.code === 'network' && !error.message.includes('private'));

let timeoutCalls = 0, timeoutSignal;
const slow = createLoginRequest({ timeoutMs: 20, fetcher: async (_url, options) => { timeoutCalls++; timeoutSignal = options.signal; return new Promise(() => {}); } });
await assert.rejects(slow.submit('u', 'p'), fail('timeout'));
assert.equal(timeoutCalls, 1); assert.equal(timeoutSignal.aborted, true);
const slowBody = createLoginRequest({ timeoutMs: 20, fetcher: async () => ({ ok: true, json: () => new Promise(() => {}) }) });
await assert.rejects(slowBody.submit('u', 'p'), fail('timeout'), 'deadline also covers stalled JSON body');

let pendingCalls = 0, pendingSignal, resolveFirst;
const pending = createLoginRequest({ fetcher: async (_url, options) => {
  pendingCalls++; pendingSignal = options.signal;
  return pendingCalls === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : Response.json({ ok: true });
} });
const first = pending.submit('u', 'p');
await assert.rejects(pending.submit('different-user', 'different-password'), fail('busy'));
assert.equal(pendingCalls, 1, 'duplicate submission never sends another request');
pending.cancel();
await assert.rejects(first, fail('cancelled'));
assert.equal(pendingSignal.aborted, true);
resolveFirst(Response.json({ ok: true }));
await pending.submit('u', 'p'); assert.equal(pendingCalls, 2, 'explicit retry after cancellation is allowed');
pending.cancel();
console.log('login request: bounded fetch/body, single submission, cancellation, explicit success and status-specific failures passed');
