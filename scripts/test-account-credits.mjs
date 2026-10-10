import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { adjustCredits, ensureCreditAccount, readCreditAccount, reserveCredits, finishCreditTask, setCreditPermissions, isCreditAdmin, SIGNUP_CREDITS } from '../lib/account-credits.mjs';

const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
sql.exec(readFileSync(new URL('../drizzle/0015_account_credits.sql', import.meta.url), 'utf8'));
const db = { prepare(query) {
  let values = [];
  return { bind(...args) { values = args; return this; },
    async run() { const result = sql.prepare(query).run(...values); return { meta: { changes: Number(result.changes) } }; },
    async first() { return sql.prepare(query).get(...values) || null; },
    async all() { return { results: sql.prepare(query).all(...values) }; } };
} };
const now = Date.now(), id = () => crypto.randomUUID();
const alice = 'test-alice', bob = 'test-bob', admin = 'test-admin';
assert.equal(SIGNUP_CREDITS, 0);
for (const owner of [alice, bob]) {
  const row = await ensureCreditAccount(db, owner, now);
  assert.equal(row.balance, 0); assert.equal(row.features, '[]'); assert.equal(row.enabled_until, 0);
  assert.equal((await ensureCreditAccount(db, owner, now)).public_id, row.public_id);
}
assert.equal(isCreditAdmin(alice, ''), false);
assert.equal(isCreditAdmin('test', admin), false);
assert.equal(isCreditAdmin(admin, `other, ${admin}`), true);
const task = () => ({ ownerId: alice, requestId: id(), feature: 'analysis', fingerprint: 'a'.repeat(64), amount: 20 });
await assert.rejects(reserveCredits(db, task(), now), /未开通/);
const grant = { id: id(), ownerId: alice, actorId: admin, delta: 50, reason: '人工分配' };
await Promise.all([adjustCredits(db, grant, now), adjustCredits(db, grant, now)]);
assert.equal((await readCreditAccount(db, alice)).balance, 50);
assert.equal((await readCreditAccount(db, bob)).balance, 0);
await assert.rejects(adjustCredits(db, { ...grant, delta: 100 }, now), /编号/);
await assert.rejects(adjustCredits(db, { ...grant, id: id(), delta: -51 }, now), /CHECK/);
assert.equal((await readCreditAccount(db, alice)).balance, 50);
await assert.rejects(reserveCredits(db, task(), now), /未开通/);
const permission = { id: id(), ownerId: alice, actorId: admin, features: ['analysis'], enabledUntil: now + 86400000, reason: '人工开通' };
await setCreditPermissions(db, permission, now);
await setCreditPermissions(db, permission, now);
const sameTask = task();
const concurrent = await Promise.all([reserveCredits(db, sameTask, now), reserveCredits(db, sameTask, now)]);
assert.equal(concurrent.filter(result => result.execute).length, 1);
assert.equal((await readCreditAccount(db, alice)).balance, 30);
await assert.rejects(reserveCredits(db, { ...sameTask, fingerprint: 'b'.repeat(64) }, now), /编号/);
const another = task();
const compete = await Promise.allSettled([reserveCredits(db, another, now), reserveCredits(db, task(), now)]);
assert.equal(compete.filter(result => result.status === 'fulfilled').length, 1);
assert.equal((await readCreditAccount(db, alice)).balance, 10);
await finishCreditTask(db, alice, sameTask.requestId, false, now);
await finishCreditTask(db, alice, sameTask.requestId, false, now);
assert.equal((await readCreditAccount(db, alice)).balance, 30);
assert.equal((await reserveCredits(db, sameTask, now)).execute, false);
await assert.rejects(finishCreditTask(db, alice, sameTask.requestId, true, now), /状态/);
await finishCreditTask(db, alice, another.requestId, true, now);
await finishCreditTask(db, alice, another.requestId, true, now);
const wallet = await readCreditAccount(db, alice);
assert.equal(wallet.balance, 30); assert.equal(wallet.reserved, 0); assert.equal(wallet.spent, 20);
await assert.rejects(reserveCredits(db, { ...task(), feature: 'voice' }, now), /未开通/);
await assert.rejects(reserveCredits(db, task(), now + 2 * 86400000), /未开通/);
await assert.rejects(finishCreditTask(db, bob, another.requestId, false, now), /不存在/);
assert.throws(() => sql.exec('DELETE FROM coach_credit_adjustments'), /IMMUTABLE/);
assert.throws(() => sql.exec('DELETE FROM coach_credit_tasks'), /IMMUTABLE/);
console.log('PASS: zero signup credits; admin allowlist; no duplicate grants; atomic reservations; no overspend; exact-once release/settlement; ownership; expiry; immutable audit.');
sql.close();
