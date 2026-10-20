import * as pricing from '../lib/analysis-pricing.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as credits from '../lib/account-credits.mjs';

let identity = null, calls = [], suppliedActor;
const account = { userId: '11111111-1111-4111-8111-111111111111', balance: 0, features: [], entries: [], enabledUntil: 0 };
const mocks = {'@/lib/analysis-pricing.mjs':pricing,
  'cloudflare:workers': { env: { COACH_ADMIN_OWNER_IDS: 'real-admin' } },
  '@/db': { getD1() { calls.push('db'); return {}; } },
  '@/lib/miniapp-auth': { async miniappOwner() { return identity; } },
  '@/lib/account-credits.mjs': { ...credits,
    async readCreditAccount(_db, ownerId) { calls.push('read:' + ownerId); return account; },
    async findCreditOwner(_db, userId) { assert.equal(userId, account.userId); return 'target-owner'; },
    async adjustCredits(_db, body) { suppliedActor = body.actorId; return { replayed: false }; }
  }
};
function route(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', output)(name => { if (!(name in mocks)) throw new Error(name); return mocks[name]; }, exports);
  return exports;
}
const userRoute = route('../app/api/miniapp/credits/route.ts');
const adminRoute = route('../app/api/miniapp/admin/credits/route.ts');
const request = () => new Request('https://example.test/api/miniapp/admin/credits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'adjust', userId: account.userId, id: crypto.randomUUID(), delta: 100, reason: '人工分配', actorId: 'forged-admin', ownerId: 'forged-owner' }) });
assert.equal((await userRoute.GET(new Request('https://example.test'))).status, 401);
assert.equal((await adminRoute.GET(new Request('https://example.test'))).status, 403);
assert.equal((await adminRoute.POST(request())).status, 403);
assert.equal(calls.length, 0);
identity = { ownerId: 'normal-user' };
assert.equal((await adminRoute.POST(request())).status, 403);
const user = await userRoute.GET(new Request('https://example.test?userId=another-account'));
assert.equal(user.headers.get('cache-control'), 'no-store');
const state = await user.json();
assert.equal(state.admin, false); assert.equal(state.account.balance, 0);
assert.ok(calls.includes('read:normal-user')); assert.ok(!calls.includes('read:another-account'));
identity = { ownerId: 'real-admin' };
assert.equal((await adminRoute.POST(request())).status, 200);
assert.equal(suppliedActor, 'real-admin');
mocks['cloudflare:workers'].env.COACH_ADMIN_OWNER_IDS = '';
assert.equal((await adminRoute.POST(request())).status, 403);

let page;
const source = readFileSync(new URL('../miniapp/pages/account/index.js', import.meta.url), 'utf8');
const api = { async session() { return { token: 'test-session' }; }, async request(path) { assert.equal(path, '/api/miniapp/credits'); return { account: { ...account, reserved: 0, spent: 0 }, admin: false, meteringReady: false }; } };
const toasts = [];
new Function('require', 'Page', 'wx', source)(() => api, value => { page = value; }, { showToast: value => toasts.push(value.title) });
page.data = structuredClone(page.data);
page.setData = patch => Object.assign(page.data, patch);
await page.load();
assert.equal(page.data.account.balance, 0);
assert.equal(page.data.admin, false);
assert.equal(page.data.account.featureLabels, '暂无');
assert.equal(page.data.loading, false);
assert.equal(page.data.error, '');
await page.save({ currentTarget: { dataset: { action: 'adjust' } } }); // no admin: no request
page.data.admin = true;
page.data.target = page.data.account;
await page.save({ currentTarget: { dataset: { action: 'adjust' } } });
assert.equal(page.data.adminError, '请先填写操作原因。');
assert.equal(toasts.at(-1), page.data.adminError, 'validation must be visible even when the admin scrolled down');
assert.equal(page.data.saving, false);
console.log('PASS: anonymous and ordinary users cannot administer; actor/owner cannot be forged; missing admin config denies access; account page renders true zero.');
