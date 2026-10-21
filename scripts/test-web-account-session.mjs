import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createWebAccountStore } from '../lib/web-account-store.mjs';
import * as pricing from '../lib/analysis-pricing.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const value = owner => ({ account: { userId: owner, balance: 50 }, people: [{ id: `${owner}-person`, label: '测试人物' }], prices: { text: 1 }, user: { name: owner } });
function harness() {
  let time = 1_000;
  const requests = [];
  const store = createWebAccountStore({ request: () => { const read = deferred(); requests.push(read); return read.promise; }, now: () => time });
  return { store, requests, advance: ms => { time += ms; } };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

const h = harness();
const first = h.store.refresh(), duplicate = h.store.refresh();
assert.equal(first, duplicate, 'multiple components share the initial request');
await tick(); assert.equal(h.requests.length, 1);
h.requests[0].resolve(value('a')); await first;
const initial = h.store.getSnapshot();
for (let i = 0; i < 8; i++) await h.store.refresh();
assert.equal(h.requests.length, 1, 'returning to the tab does not restart recent identity reads');
h.advance(60_001);
const silent = h.store.refresh(); await tick();
assert.equal(h.store.getSnapshot().loading, false, 'background refresh never locks the page');
assert.equal(h.store.getSnapshot().account, initial.account);
h.requests[1].resolve(value('a')); await silent;
assert.equal(h.store.getSnapshot().people, initial.people, 'unchanged people retain reference, avoiding dependent import reloads');
assert.equal(h.store.getSnapshot().account, initial.account);
h.advance(60_001); const offline = h.store.refresh(); await tick();
h.requests[2].reject(Object.assign(Error('offline'), { status: 503 })); await offline;
assert.equal(h.store.getSnapshot().account, initial.account);
assert.equal(h.store.getSnapshot().error, '', 'transient background failure does not become an auth gate');
assert.equal(h.store.getSnapshot().refreshError, 'offline');
assert.equal(h.store.getSnapshot().unauthorized, false);
const revoked = h.store.refresh({ force: true }); await tick();
h.requests[3].reject(Object.assign(Error('expired'), { status: 401 })); await revoked;
assert.equal(h.store.getSnapshot().account, null); assert.deepEqual(h.store.getSnapshot().people, []);
assert.equal(h.store.getSnapshot().unauthorized, true, 'real server revocation clears account data');

const swapped = harness();
const old = swapped.store.refresh(); await tick();
swapped.store.invalidate(); const fresh = swapped.store.refresh(); await tick();
swapped.requests[1].resolve(value('b')); await fresh;
swapped.requests[0].resolve(value('a')); await old;
assert.equal(swapped.store.getSnapshot().account.account.userId, 'b', 'late previous-account result cannot restore old data');
swapped.advance(60_001); const logoutPending = swapped.store.refresh(); await tick();
swapped.store.invalidate({ loggedOut: true }); swapped.requests[2].resolve(value('b')); await logoutPending;
assert.equal(swapped.store.getSnapshot().account, null);
assert.equal(swapped.store.getSnapshot().unauthorized, true, 'logout invalidates in-flight refresh');

const changed = harness();
const stale = changed.store.refresh(); await tick();
const afterMutation = changed.store.refresh({ force: true }), afterOtherMutation = changed.store.refresh({ force: true });
assert.equal(afterMutation, afterOtherMutation);
changed.requests[0].resolve(value('a')); await stale; await tick();
assert.equal(changed.requests.length, 2, 'mutation refresh runs once after an older request');
changed.requests[1].resolve({ ...value('a'), account: { userId: 'a', balance: 49 } }); await afterMutation;
assert.equal(changed.store.getSnapshot().account.account.balance, 49);

const obsolete = harness();
const obsoleteRead = obsolete.store.refresh(); await tick();
const obsoleteQueued = obsolete.store.refresh({ force: true });
obsolete.store.invalidate({ loggedOut: true });
obsolete.requests[0].resolve(value('a')); await obsoleteRead; await obsoleteQueued;
assert.equal(obsolete.requests.length, 1, 'a queued previous-account mutation cannot restart identity checks after logout');
assert.equal(obsolete.store.getSnapshot().unauthorized, true);

const routeSource = ts.transpileModule(readFileSync('app/api/web/account-context/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function routeHarness() {
  const identity = deferred(), credits = deferred(), subjects = deferred(), queries = [], started = [];
  const db = { prepare(sql) { return { bind(...args) { queries.push({ sql, args }); return { all() { started.push('subjects'); return subjects.promise; } }; } }; } };
  const dependencies = {
    '@/lib/analysis-pricing.mjs': pricing,
    'cloudflare:workers': { env: {} }, '@/db': { getD1: () => db },
    '@/lib/request-identity.mjs': { webOwner: () => identity.promise },
    '@/lib/account-credits.mjs': { readCreditAccount(database, owner) { assert.equal(database, db); started.push(['credits', owner]); return credits.promise; }, CREDIT_PRICES: { text: 1 }, isCreditAdmin: () => false },
  };
  const exports = {};
  new Function('exports', 'require', routeSource)(exports, name => { assert.ok(dependencies[name], `unexpected heavyweight dependency ${name}`); return dependencies[name]; });
  return { route: exports.GET, identity, credits, subjects, queries, started };
}
const route = routeHarness();
const responsePromise = route.route(new Request('https://local/api/web/account-context'));
assert.deepEqual(route.started, [], 'no account data queried before authentication');
route.identity.resolve({ ownerId: 'a', displayName: '甲' }); await tick();
assert.deepEqual(route.started, [['credits', 'a'], 'subjects'], 'credits and lightweight subjects run concurrently');
assert.deepEqual(route.queries[0].args, ['a']);
assert.match(route.queries[0].sql, /s\.owner_id=\?/); assert.match(route.queries[0].sql, /p\.owner_id=s\.owner_id/);
assert.match(route.queries[0].sql, /p\.consent_at IS NOT NULL AND p\.paused=0/);
assert.doesNotMatch(route.queries[0].sql, /coach_facts|relationshipHistory|SELECT\s+r\.result/);
assert.match(route.queries[0].sql, /r\.owner_id=s\.owner_id AND r\.subject_id=s\.id/, 'report metadata remains owner scoped');
assert.match(route.queries[0].sql, /l\.epoch=json_extract/, 'retired report snapshots do not resurface');
route.credits.resolve({ userId: 'a', balance: 50 }); route.subjects.resolve({ results: value('a').people });
const response = await responsePromise, body = await response.json();
assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(body.account.userId, 'a'); assert.deepEqual(body.people, value('a').people.map(person => ({ ...person, savedAnalysis: null, savedChatAnalysis: null })));
const anonymous = routeHarness(); const denied = anonymous.route(new Request('https://local/api/web/account-context'));
anonymous.identity.resolve(null); assert.equal((await denied).status, 401); assert.deepEqual(anonymous.started, []);

const sessionSource = ts.transpileModule(readFileSync('lib/web-account-session.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const windowEvents = new EventTarget(), documentEvents = new EventTarget(); documentEvents.hidden = false;
const sessionRequests = [], saved = new Map(), sessionExports = {};
let sessionTime = 1_000;
const sessionDependencies = {
  './web-account-store.mjs': { createWebAccountStore: options => createWebAccountStore({ ...options, now: () => sessionTime }) },
  './web-api-request.mjs': { fetchWebJson() { const read = deferred(); sessionRequests.push(read); return read.promise; } },
};
new Function('exports', 'require', 'window', 'document', 'localStorage', 'crypto', sessionSource)(sessionExports, key => sessionDependencies[key], windowEvents, documentEvents, { setItem: (key, text) => saved.set(key, text), getItem: key => saved.get(key) ?? null }, crypto);
const unwatch1 = sessionExports.watchAccountSession(), unwatch2 = sessionExports.watchAccountSession(); await tick();
assert.equal(sessionRequests.length, 1, 'two watchers install one shared request');
sessionRequests[0].resolve({ response: Response.json({}), data: value('a') }); await tick(); await tick();
windowEvents.dispatchEvent(new Event('focus')); documentEvents.dispatchEvent(new Event('visibilitychange')); await tick();
assert.equal(sessionRequests.length, 1, 'focus plus visibilitychange coalesce without a reload');
for (let i = 0; i < 6; i++) {
  sessionTime += 15 * 60_000;
  windowEvents.dispatchEvent(new Event('focus')); documentEvents.dispatchEvent(new Event('visibilitychange')); windowEvents.dispatchEvent(new Event('pageshow')); await tick();
}
assert.equal(sessionRequests.length, 1, 'returning from WeChat after long idle does not reauthenticate an unchanged account');
assert.equal(sessionExports.webAccountStore.getSnapshot().loading, false);
const remoteLogout = new Event('storage'); Object.assign(remoteLogout, { key: 'chengzi:account-revision', newValue: JSON.stringify({ loggedOut: true }) });
saved.set('chengzi:account-revision', remoteLogout.newValue);
windowEvents.dispatchEvent(remoteLogout);
assert.equal(sessionExports.webAccountStore.getSnapshot().account, null);
assert.equal(sessionExports.webAccountStore.getSnapshot().unauthorized, true);
const remoteLogin = new Event('storage'); Object.assign(remoteLogin, { key: 'chengzi:account-revision', newValue: JSON.stringify({ loggedOut: false }) });
saved.set('chengzi:account-revision', remoteLogin.newValue);
windowEvents.dispatchEvent(remoteLogin); await tick();
sessionRequests[1].resolve({ response: Response.json({}), data: value('b') }); await tick(); await tick();
assert.equal(sessionExports.webAccountStore.getSnapshot().account.account.userId, 'b', 'another tab login loads only current owner');
const oldLoginRevision = sessionExports.webAccountStore.getRevision();
saved.set('chengzi:account-revision', JSON.stringify({ loggedOut: true, revision: 'missed-while-suspended' }));
windowEvents.dispatchEvent(new Event('pageshow'));
assert.equal(sessionExports.webAccountStore.getSnapshot().unauthorized, true, 'restored pages reconcile missed logout without a network request');
assert.equal(sessionRequests.length, 2);
saved.set('chengzi:account-revision', JSON.stringify({ loggedOut: false, revision: 'new-account' }));
windowEvents.dispatchEvent(new Event('focus')); await tick();
sessionRequests[2].resolve({ response: Response.json({}), data: value('c') }); await tick(); await tick();
sessionExports.expireAccountSession(oldLoginRevision);
assert.equal(sessionExports.webAccountStore.getSnapshot().account.account.userId, 'c', 'late unauthorized result cannot erase a newer login');

const require = createRequire(import.meta.url), clientExports = {}, apiReads = [];
const clientSource = ts.transpileModule(readFileSync('components/web-analysis/client.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const reportReturn = {};
new Function('exports',ts.transpileModule(readFileSync('lib/report-return.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(reportReturn);
const clientDependencies = {
  '@/lib/report-return': reportReturn,
  '@/components/AuroraUI.module.css': { default: {} },
  '@/components/PersonAvatarChoice': { PersonAvatarChoice() {} },
  '@/lib/web-api-request.mjs': { fetchWebJson() { const read = deferred(); apiReads.push(read); return read.promise; } },
  '@/lib/account-credits.mjs': { CREDIT_PRICES: {} },
  '@/lib/web-account-session': sessionExports,
};
new Function('exports', 'require', clientSource)(clientExports, key => clientDependencies[key] || require(key));
const requestExpired = clientExports.api('/api/web/profile');
apiReads[0].resolve({ response: Response.json({}, { status: 401 }), data: {} });
await assert.rejects(requestExpired, { status: 401 });
assert.equal(sessionExports.webAccountStore.getSnapshot().unauthorized, true, 'protected API 401 expires the current display session without a focus poll');
const { renderToStaticMarkup } = require('react-dom/server'), { createElement } = require('react');
const outage = renderToStaticMarkup(createElement(clientExports.AccountNotice, { state: { unauthorized: false, error: '账号校验服务暂不可用', refresh() {} } }));
assert.doesNotMatch(outage, /重新登录|href=/, 'temporary identity service failure never asks the user to log in again');
assert.match(outage, /重新连接/);
sessionExports.webAccountStore.invalidate();
const timeoutRead = sessionExports.webAccountStore.refresh(); await tick();
sessionRequests.at(-1).reject(Object.assign(Error('signal timed out'), { name: 'TimeoutError' }));
await timeoutRead;
assert.match(sessionExports.webAccountStore.getSnapshot().error, /账户暂时未连接/);
assert.equal(sessionExports.webAccountStore.getSnapshot().loading, false, 'timeout ends the initial loading state');
assert.equal(sessionExports.webAccountStore.getSnapshot().unauthorized, false, 'timeout is not a logout');
const serverOutage = sessionExports.webAccountStore.refresh({ force: true }); await tick();
sessionRequests.at(-1).resolve({ response: Response.json({}, { status: 503 }), data: { error: 'signal timed out' } });
await serverOutage;
assert.doesNotMatch(sessionExports.webAccountStore.getSnapshot().error, /signal timed out/);
sessionExports.announceAccountChange(true);
assert.equal(sessionExports.webAccountStore.getSnapshot().unauthorized, true);
assert.deepEqual(Object.keys(JSON.parse(saved.get('chengzi:account-revision'))).sort(), ['loggedOut', 'revision'], 'cross-tab notification contains no credentials or personal data');
unwatch1(); unwatch2();
const beforeCleanup = sessionRequests.length;
windowEvents.dispatchEvent(new Event('chengzi:credits-changed')); await tick();
assert.equal(sessionRequests.length, beforeCleanup, 'last unmount removes refresh listeners');
console.log('PASS: shared initial read, no reauthentication on focus, missed logout reconciliation, API 401 expiry, stable list references, transient recovery, account-switch races, mutation refresh, cross-tab logout/login and lightweight authenticated context');
