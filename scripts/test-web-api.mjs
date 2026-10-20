import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as identity from '../lib/request-identity.mjs';
import * as credits from '../lib/account-credits.mjs';
import * as billing from '../lib/web-credit-policy.mjs';
import * as creditResponse from '../lib/credit-response.mjs';
import * as guard from '../lib/voice-turn-guard.mjs';
import * as memory from '../lib/miniapp-voice-memory.mjs';
import { nativeRegister } from '../lib/web-native-auth.mjs';
import * as savedReports from '../lib/saved-reports.mjs';
import * as recognitionReview from '../lib/screenshot-recognition-review.mjs';
import * as nativeAuth from '../lib/web-native-auth.mjs';
import * as identityState from '../lib/web-identity-state.mjs';

const origin = 'https://coach.example.test';
const token = 'alice_session_token_123456789';
const cookie = 'lt_next_session=' + token;
let authCalls = 0, authUnavailable = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), 'https://ai.lovetalk.love/next/api/session');
  authCalls++;
  if (authUnavailable) throw Error('account service offline');
  const value = options.headers.Cookie;
  assert.ok(!value.includes('other_cookie'), 'unrelated cookies must not leave our origin');
  return Response.json(value === cookie ? { logged_in: true, user: 'alice' }
    : value === 'lt_next_session=bob_session_token_1234567890' ? { logged_in: true, user: 'bob' } : { logged_in: false });
};
const request = (path, body, extra = {}) => new Request(origin + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const loggedIn = request('/api/web/profile');
assert.equal((await identity.webOwner(loggedIn)).ownerId, 'lovetalk:alice');
const before = authCalls;
assert.equal((await identity.webOwner(loggedIn)).ownerId, 'lovetalk:alice');
assert.equal(authCalls, before, 'one Request reuses only its own verified identity');
assert.equal(await identity.webOwner(request('/api/web/profile', {}, { Origin: 'https://attacker.test' })), null);
assert.equal(await identity.webOwner(request('/api/web/profile', {}, { Origin: '' })), null);
assert.equal(await identity.webOwner(request('/api/web/profile', undefined, { 'Sec-Fetch-Site': 'cross-site' })), null);
assert.equal(await identity.webOwner(request('/api/web/profile', undefined, { Cookie: '', 'X-Owner-Id': 'lovetalk:alice', Authorization: 'Bearer ' + 'a'.repeat(64) })), null);
assert.equal(await identity.webOwner(request('/api/web/profile', undefined, { Cookie: cookie + '; ' + cookie })), null);
assert.equal(identity.browserRequestAllowed(request('/api/web/voice-live', undefined, { Upgrade: 'websocket', Origin: '' })), false);
assert.equal(identity.browserRequestAllowed(request('/api/web/voice-live', undefined, { Upgrade: 'websocket' })), true);
authUnavailable = true;
await assert.rejects(identity.webOwner(request('/api/web/profile')), error => error.code === 'AUTH_IDENTITY_UNAVAILABLE' && error.status === 503);
authUnavailable = false;
const tokenDb = { prepare() { return { bind(hash) { assert.match(hash, /^[a-f0-9]{64}$/); return this; }, async first() { return { owner_id: 'original-wechat-owner', open_id: 'openid-original' }; } }; } };
const miniEnv = { DB: tokenDb, MINIAPP_APPID: 'configured', MINIAPP_APPSECRET: 'configured' };
assert.equal(await identity.requestOwner(request('/api/miniapp/profile'), miniEnv), null, 'web cookie cannot impersonate a mini-program');
assert.equal((await identity.requestOwner(request('/api/miniapp/profile', undefined, { Authorization: 'Bearer ' + 'a'.repeat(64) }), miniEnv)).ownerId, 'original-wechat-owner');
assert.equal(await identity.requestOwner(request('/api/web/profile', undefined, { Cookie: '', Authorization: 'Bearer ' + 'a'.repeat(64) }), miniEnv), null, 'mini-program bearer cannot impersonate a web account');

const sql = new DatabaseSync(':memory:');
for (const name of ['0000_lying_leech','0003_wealthy_stephen_strange','0015_account_credits', '0016_credit_receipts', '0017_web_accounts','0018_saved_analysis_reports','0021_verified_legacy_sessions']) sql.exec(readFileSync(new URL('../drizzle/' + name + '.sql', import.meta.url), 'utf8'));
const db = { prepare(query) { let values = []; return { bind(...v) { values = v; return this; }, async first() { return sql.prepare(query).get(...values) || null; }, async all() { return { results: sql.prepare(query).all(...values) }; }, async run() { return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } }; } }; }, async batch(statements) { sql.exec('BEGIN'); try { const result = []; for (const s of statements) result.push(await s.run()); sql.exec('COMMIT'); return result; } catch (e) { sql.exec('ROLLBACK'); throw e; } } };
const owner = 'lovetalk:alice';
let expectedOwner=owner;
await credits.ensureCreditAccount(db, owner);
await credits.adjustCredits(db, { id: crypto.randomUUID(), ownerId: owner, actorId: 'admin', delta: 300, reason: '测试完整迁移' });
await credits.setCreditPermissions(db, { id: crypto.randomUUID(), ownerId: owner, actorId: 'admin', features: ['analysis', 'chat', 'voice'], enabledUntil: Date.now() + 86400000, reason: '测试权限' });
class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
const calls = [];
let positioningRoute;
const app = { async fetch(req, appEnv) {
  const verified = await identity.webOwner(req, appEnv);
  assert.equal(verified?.ownerId, expectedOwner);
  calls.push({ path: new URL(req.url).pathname, headers: req.headers });
  if (new URL(req.url).pathname === '/api/positioning' && positioningRoute) return positioningRoute[req.method](req);
  if (new URL(req.url).pathname === '/api/voice') return new Response('v=0\nm=audio', { headers: { 'Content-Type': 'application/sdp' } });
  return Response.json({ ok: true, report: 'owner-scoped report' });
} };
const mocks = {
  './saved-reports.mjs': savedReports,
  'cloudflare:workers': { DurableObject },
  '../dist/server/index.js': { default: app }, './dist/server/index.js': { default: app },
  './account-credits.mjs': credits, './lib/account-credits.mjs': credits,
  './request-identity.mjs': identity, './lib/request-identity.mjs': identity,
  './lib/web-credit-policy.mjs': billing, './lib/credit-response.mjs': creditResponse,
  './lib/miniapp-voice-memory.mjs': memory, './lib/voice-turn-guard.mjs': guard,
  './screenshot-recognition-review.mjs': recognitionReview,
  './lib/web-native-auth.mjs': nativeAuth, './lib/web-identity-state.mjs': identityState,
};
function load(path) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', output)(name => { if (!(name in mocks)) throw Error('missing mock ' + name); return mocks[name]; }, exports);
  return exports;
}
const social = load('../lib/social-profile-jobs.mjs');
mocks['./lib/social-profile-jobs.mjs'] = social;
mocks['./lib/capture-history-jobs.mjs'] = load('../lib/capture-history-jobs.mjs');
const worker = load('../worker-entry.mjs').default;
const stores = new Map(), objects = new Map();
const env = { DB: db, SOCIAL_PROFILE_JOBS: {
  idFromName(name) { return name; },
  get(name) {
    if (!objects.has(name)) {
      const entries = new Map();
      const storage = {
        async get(key) { return structuredClone(entries.get(key)); },
        async put(key, value) { entries.set(key, structuredClone(value)); },
        async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) entries.delete(key); },
        async list({ prefix }) { return new Map([...entries].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])); },
        async setAlarm() {}, async transaction(fn) { return fn(storage); },
      };
      stores.set(name, entries);
      objects.set(name, new social.SocialProfileJobs({ storage }, env));
    }
    return objects.get(name);
  },
} };
const ctx = { waitUntil() {} };
authUnavailable = true;
assert.equal((await worker.fetch(request('/api/web/profile'), env, ctx)).status, 503, 'temporary account lookup failure is not logout');
assert.equal((await worker.fetch(request('/api/web/screenshot', { confirmed: true, requestId: crypto.randomUUID() }), env, ctx)).status, 503);
assert.equal((await credits.readCreditAccount(db, owner)).balance, 300, 'failed authentication never reaches billing');
assert.equal(calls.length, 0);
authUnavailable = false;
assert.equal((await worker.fetch(request('/api/web/screenshot', { confirmed: true }, { Origin: 'https://attacker.test' }), env, ctx)).status, 403);
assert.equal((await worker.fetch(request('/api/web/screenshot', { confirmed: true }, { Cookie: '' }), env, ctx)).status, 401);
assert.equal(calls.length, 0);
for (const alternate of ['/api/chat/', '/api//chat', '/%61pi/chat', '/api/ch%61t', '/api/web/screenshot/']) assert.equal((await worker.fetch(request(alternate, { mode: 'reply' }), env, ctx)).status, 400, 'alternate route cannot bypass credits: ' + alternate);
const screenshotId = crypto.randomUUID();
for (let i = 0; i < 2; i++) assert.equal((await worker.fetch(request('/api/web/screenshot', { confirmed: true, requestId: screenshotId, image: 'test' }), env, ctx)).status, 200);
assert.equal(calls.length, 1, 'web screenshot retries reuse the paid receipt');
assert.equal((await credits.readCreditAccount(db, owner)).balance, 280);
assert.equal((await worker.fetch(request('/api/web/screenshot', { confirmed: true, requestId: screenshotId, image: 'different' }), env, ctx)).status, 409);
const oldChatId = crypto.randomUUID();
for (let i = 0; i < 2; i++) assert.equal((await worker.fetch(request('/api/chat', { mode: 'reply', turns: [], requestId: oldChatId }), env, ctx)).status, 200);
assert.equal(calls.length, 2, 'legacy retry uses the same ledger and never invokes the model twice');
assert.equal((await credits.readCreditAccount(db, owner)).balance, 275);
assert.equal((await worker.fetch(request('/api/chat', { turns: [] }, { Cookie: 'lt_next_session=bob_session_token_1234567890' }), env, ctx)).status, 403);
for (const path of ['/api/chat', '/api/crush/quick', '/api/crush/rewrite', '/api/crush/screenshot', '/api/crush/card', '/api/import/analyze', '/api/import/transcribe', '/api/history/check', '/api/risk', '/api/profile/suggest', '/api/voice', '/api/voice/delegate', '/api/voice/summary']) assert.ok(billing.legacyCreditPolicy(path, 'POST'), path + ' must meter its provider work');
for (const action of ['generate', 'save', 'invalid']) assert.equal(billing.legacyCreditPolicy('/api/positioning', 'POST', { action }), null, 'local positioning never reserves provider credits');
for (const action of ['analyze', 'advice', 'enrichDistribution', 'refreshAffinity']) assert.ok(billing.legacyCreditPolicy('/api/crush', 'POST', { action }));
for (const action of ['settings', 'imageMapping', 'quickJev', 'fullJev', 'affinity', 'enableAll']) assert.equal(billing.legacyCreditPolicy('/api/crush', 'POST', { action }), null);
assert.equal(billing.legacyCreditPolicy('/api/chat', 'GET'), null);
assert.deepEqual(billing.legacyCreditPolicy('/api/chat','POST',{turns:[{role:'user',image:'data:image/png;base64,AAAA'}]}),{feature:'analysis',amount:20},'image chat must require analysis permission and its analysis price');
const voiceId = crypto.randomUUID();
const voice = () => new Request(origin + '/api/voice', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/sdp', 'X-Request-Id': voiceId }, body: 'v=0\nm=audio' });
assert.equal((await worker.fetch(voice(), env, ctx)).status, 200);
assert.equal((await worker.fetch(voice(), env, ctx)).status, 409);
assert.equal((await credits.readCreditAccount(db, owner)).balance, 255);

const batchId = crypto.randomUUID(), batchPath = '/api/web/screenshot/batch';
const upload = body => worker.fetch(request(batchPath, { ...body, taskId: batchId }), env, ctx);
assert.equal((await worker.fetch(request(batchPath, { taskId: batchId }, { 'X-Request-Id': crypto.randomUUID() }), env, ctx)).status, 409);
assert.equal((await upload({ uploadAction: 'init', confirmed: true, imageCount: 2, selfSide: 'right', sessionId: crypto.randomUUID(), ownerId: 'forged-owner' })).status, 201);
const saved = stores.get(owner).get('job:' + batchId);
assert.equal(saved.ownerId, owner, 'caller cannot choose a different credit owner');
assert.equal(saved.webCookie, cookie);
assert.equal((await credits.readCreditAccount(db, owner)).balance, 235);
assert.equal((await upload({ uploadAction: 'part', index: 0, image: 'data:image/jpeg;base64,AAAA' })).status, 200);
assert.equal((await upload({ uploadAction: 'part', index: 1, image: 'data:image/jpeg;base64,BBBB' })).status, 200);
assert.equal((await upload({ uploadAction: 'commit' })).status, 202);
await objects.get(owner).alarm();
await objects.get(owner).alarm();
const status = await (await worker.fetch(request(batchPath + '?taskId=' + batchId), env, ctx)).json();
assert.equal(status.status, 'done');
assert.equal(status.result.entries.length, 2);
const terminal = stores.get(owner).get('job:' + batchId);
assert.equal(terminal.webCookie, undefined, 'terminal jobs must erase credentials');
assert.equal(terminal.authorization, undefined);
assert.equal([...stores.get(owner).keys()].some(key => key.startsWith('upload:')), false, 'terminal jobs erase images');
assert.equal(calls.slice(-2).every(call => call.path === '/api/web/screenshot' && call.headers.get('cookie') === cookie && call.headers.get('origin') === origin), true);
assert.equal((await credits.readCreditAccount(db, owner)).balance, 235, 'batch callbacks must not charge each image again');
const otherStatus = await worker.fetch(request(batchPath + '?taskId=' + batchId, undefined, { Cookie: 'lt_next_session=bob_session_token_1234567890' }), env, ctx);
assert.equal(otherStatus.status, 404, 'another account cannot read the job');
assert.equal(JSON.stringify(status).includes(token), false, 'credentials never appear in polling responses');
const socialId = crypto.randomUUID();
assert.equal((await worker.fetch(request('/api/web/social-profile', { confirmed: true, images: ['data:image/jpeg;base64,AAAA'], target: 'other' }, { 'X-Request-Id': socialId }), env, ctx)).status, 202);
await objects.get(owner).alarm();
assert.equal(calls.at(-1).path, '/api/web/social-profile');
assert.equal((await credits.readCreditAccount(db, owner)).balance, 205);
assert.equal(stores.get(owner).get('job:' + socialId).webCookie, undefined);

// The same worker, ledger and DO callbacks also execute for an independent native account.
const signup=await nativeRegister(request('/api/auth/register',{username:'native_customer',password:'native password 123',agree:true}),env);
assert.equal(signup.status,200);
const nativeCookie=signup.headers.getSetCookie().find(value=>value.startsWith('cz_session=')).split(';')[0];
const nativeIdentity=await identity.webOwner(request('/api/web/profile',undefined,{Cookie:nativeCookie}),env);
expectedOwner=nativeIdentity.ownerId;
assert.match(expectedOwner,/^chengzi:/);
await credits.ensureCreditAccount(db,expectedOwner);
await credits.adjustCredits(db,{id:crypto.randomUUID(),ownerId:expectedOwner,actorId:'admin',delta:50,reason:'客户购买'});
await credits.setCreditPermissions(db,{id:crypto.randomUUID(),ownerId:expectedOwner,actorId:'admin',features:['analysis','chat','voice'],enabledUntil:Date.now()+86400000,reason:'客户开通'});
const nativeTask=crypto.randomUUID();
assert.equal((await worker.fetch(request('/api/web/social-profile',{confirmed:true,images:['data:image/jpeg;base64,AAAA'],target:'self',taskId:nativeTask},{Cookie:nativeCookie}),env,ctx)).status,202);
assert.equal(stores.get(expectedOwner).get('job:'+nativeTask).webCookie,nativeCookie);
await objects.get(expectedOwner).alarm();
const nativeResult=await (await worker.fetch(request('/api/web/social-profile?taskId='+nativeTask,undefined,{Cookie:nativeCookie}),env,ctx)).json();
assert.equal(nativeResult.status,'done');
assert.equal(stores.get(expectedOwner).get('job:'+nativeTask).webCookie,undefined);
assert.equal((await credits.readCreditAccount(db,expectedOwner)).balance,20);
sql.exec('CREATE TABLE IF NOT EXISTS coach_crush_budget (id TEXT PRIMARY KEY,uses INTEGER NOT NULL,expires_at INTEGER NOT NULL)');
const voiceStatus=await worker.fetch(request('/api/web/voice-live/status',undefined,{Cookie:nativeCookie}),env,ctx);
assert.equal(voiceStatus.status,200);assert.equal((await voiceStatus.json()).configured,false);
assert.equal((await worker.fetch(request('/api/web/voice-live?requestId='+crypto.randomUUID(),undefined,{Cookie:nativeCookie,Upgrade:'websocket'}),env,ctx)).status,503,'native voice authenticates before configuration check');
// Exercise real positioning handlers behind the real worker credit gate. Only
// the account/database environment is synthetic; no model or network is used.
sql.exec('CREATE TABLE IF NOT EXISTS coach_positionings (owner_id TEXT PRIMARY KEY,input_json TEXT NOT NULL,report_json TEXT NOT NULL,updated_at INTEGER NOT NULL)');
mocks['@/lib/positioning'] = load('../lib/positioning.ts');
mocks['@/app/chatgpt-auth'] = { getChatGPTUser: async () => ({ userId: expectedOwner }) };
mocks['@/db'] = { getD1: () => db };
positioningRoute = load('../app/api/positioning/route.ts');
const positioningInput = { goal: 'long-term', priorities: ['communication', 'safety'], selfPicture: '合成验收资料：工作日忙，周末有时间交流。', constraints: '', boundaries: '尊重拒绝', pattern: '' };
const freeBalance = (await credits.readCreditAccount(db, expectedOwner)).balance;
const taskCount = sql.prepare('SELECT COUNT(*) AS n FROM coach_credit_tasks').get().n;
let positioningReport;
for (let i=0;i<2;i++) {
  const response=await worker.fetch(request('/api/positioning',{action:'generate',input:positioningInput},{Cookie:nativeCookie}),env,ctx);
  assert.equal(response.status,200);positioningReport=(await response.json()).report;
}
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM coach_positionings').get().n,0,'generation does not save');
for (let i=0;i<2;i++) assert.equal((await worker.fetch(request('/api/positioning',{action:'save',input:positioningInput,report:positioningReport},{Cookie:nativeCookie}),env,ctx)).status,200);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM coach_positionings').get().n,1,'repeat save updates the same owner row');
assert.equal((await worker.fetch(request('/api/positioning',{action:'invalid',input:positioningInput},{Cookie:nativeCookie}),env,ctx)).status,400);
assert.equal((await credits.readCreditAccount(db,expectedOwner)).balance,freeBalance,'generate/save and their retries are free');
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM coach_credit_tasks').get().n,taskCount,'free positioning creates no credit tasks');
sql.close();
globalThis.fetch = originalFetch;
console.log('PASS: verified cookie identities; CSRF and WebSocket origin checks; no forged owner/token channel crossover; web and legacy exact-once billing; async batch ownership, receipt replay, callback credentials and cleanup; social-profile parity.');
