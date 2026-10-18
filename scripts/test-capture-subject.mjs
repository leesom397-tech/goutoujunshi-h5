import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { browserRequestAllowed } from '../lib/request-identity.mjs';

const native = createRequire(import.meta.url), sql = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) sql.exec(readFileSync('drizzle/' + file, 'utf8'));
const db = {
  prepare(query) { return { query, values: [], bind(...values) { this.values = values; return this; }, async first() { return sql.prepare(query).get(...this.values) || null; }, execute() { return { meta: { changes: Number(sql.prepare(query).run(...this.values).changes) } }; }, async run() { return this.execute(); } }; },
  async batch(statements) { sql.exec('BEGIN'); try { const result = statements.map(statement => statement.execute()); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; } },
};
const owner = 'synthetic-capture-owner', other = 'synthetic-other-owner', publicId = crypto.randomUUID(), otherPublicId = crypto.randomUUID();
for (const [who, id] of [[owner, publicId], [other, otherPublicId]]) sql.prepare('INSERT INTO coach_credit_accounts(owner_id,public_id,created_at,updated_at) VALUES(?,?,1,1)').run(who, id);
const mocks = { '@/db': { getD1: () => db }, '@/lib/miniapp-auth': { miniappOwner: async request => request.headers.get('x-test-owner') === 'none' ? null : { ownerId: request.headers.get('x-test-owner') || owner } }, '@/lib/request-identity.mjs': { browserRequestAllowed } };
const cache = new Map();
function load(file) {
  const path = resolve(file); if (cache.has(path)) return cache.get(path);
  const exports = {}; cache.set(path, exports);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true } }).outputText;
  new Function('exports', 'require', code)(exports, name => { if (name in mocks) return mocks[name]; if (name.startsWith('@/') || name.startsWith('.')) { let next = name.startsWith('@/') ? resolve(name.slice(2)) : resolve(dirname(path), name); if (!/\.(?:ts|mjs|json)$/.test(next)) next += '.ts'; return load(next); } return native(name); });
  return exports;
}
const server = load('lib/capture-subject-server.ts'), route = load('app/api/web/capture/subject/route.ts');
const contact = { accountKey: 'a'.repeat(64), contactId: 'wxid_synthetic-contact', label: '同名联系人', nickname: '合成昵称', remark: '合成备注' };
const payload = (extra = {}) => ({ expectedOwnerId: publicId, confirmed: true, consent: true, contact: { ...contact }, ...extra });
const request = (body, headers = {}) => new Request('https://synthetic.test/api/web/capture/subject', { method: 'POST', headers: { origin: 'https://synthetic.test', 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const call = async (body, headers) => { const response = await route.POST(request(body, headers)); return { status: response.status, body: await response.json() }; };
const person = id => sql.prepare('SELECT * FROM coach_subjects WHERE id=?').get(id);
const count = who => sql.prepare('SELECT COUNT(*) AS n FROM coach_subjects WHERE owner_id=?').get(who).n;
const addPerson = (who = owner, data = {}, label = '已有称呼') => { const id = crypto.randomUUID(); sql.prepare("INSERT INTO coach_subjects(id,owner_id,label,status,data,created_at,updated_at) VALUES(?,?,?,'active',?,1,1)").run(id, who, label, JSON.stringify(data)); return id; };
const oldFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error('NETWORK_MUST_NOT_BE_CALLED'); };
let checks = 0;
try {
  assert.equal((await call(payload(), { 'x-test-owner': 'none' })).status, 401);
  assert.equal((await call(payload(), { origin: 'https://foreign.test' })).status, 403);
  assert.equal((await call(payload(), { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await call(payload(), { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await call('{')).status, 400);
  assert.equal((await call([])).status, 400);
  assert.equal((await call(payload(), { 'content-length': '160001' })).status, 413);
  assert.equal((await call(' '.repeat(160001))).status, 413); checks++;

  for (const extra of [{ expectedOwnerId: otherPublicId }, { confirmed: false }, { consent: false }, { consent: undefined }]) assert.ok((await call(payload(extra))).status >= 400);
  assert.equal(count(owner), 0); assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM coach_profiles').get().n, 0);
  for (const bad of [{ ...contact, accountKey: '' }, { ...contact, contactId: '' }, { ...contact, contactId: 'x\u0000y' }, { ...contact, contactId: ' space ' }, { label: '同名联系人' }]) assert.equal((await call(payload({ contact: bad }))).status, 400); checks++;

  const first = await call(payload()); assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.created, true); assert.equal(first.body.label, '合成备注');
  assert.match(first.body.subjectId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const firstId = first.body.subjectId, consentAt = sql.prepare('SELECT consent_at FROM coach_profiles WHERE owner_id=?').get(owner).consent_at;
  const renamed = await call(payload({ contact: { ...contact, nickname: '后来改昵称', remark: '后来改备注' } }));
  assert.equal(renamed.body.subjectId, firstId); assert.equal(renamed.body.created, false); assert.equal(renamed.body.label, '合成备注'); assert.equal(count(owner), 1); checks++;

  const sameNameId = addPerson(owner, {}, '合成备注');
  const differentContact = await call(payload({ contact: { ...contact, contactId: 'wxid_another-contact' } }));
  const differentAccount = await call(payload({ contact: { ...contact, accountKey: 'b'.repeat(64) } }));
  const foreign = await call(payload({ expectedOwnerId: otherPublicId }), { 'x-test-owner': other });
  assert.equal(new Set([firstId, sameNameId, differentContact.body.subjectId, differentAccount.body.subjectId, foreign.body.subjectId]).size, 5); checks++;

  const ownAvatar = 'data:image/jpeg;base64,/9j/2Q==', explicit = addPerson(owner, { avatar: ownAvatar, notes: '保留笔记' });
  const avatarUrl = 'https://wx.qlogo.cn/mmhead/synthetic/132';
  const selected = await call(payload({ subjectId: explicit, contact: { ...contact, avatarUrl } }));
  assert.equal(selected.status, 200); assert.equal(selected.body.subjectId, explicit); assert.equal(selected.body.created, false); assert.equal(selected.body.avatar, ownAvatar); assert.equal(selected.body.label, '已有称呼');
  assert.equal(JSON.parse(person(explicit).data).notes, '保留笔记');
  assert.equal(Object.keys(JSON.parse(person(firstId).data).captureBindings).length, 0);
  assert.equal((await call(payload())).body.subjectId, explicit); checks++;

  const beforeInvalid = count(owner);
  assert.equal((await call(payload({ subjectId: foreign.body.subjectId }))).status, 404);
  assert.equal((await call(payload({ subjectId: crypto.randomUUID() }))).status, 404);
  assert.equal((await call(payload({ subjectId: 'bad' }))).status, 400); assert.equal(count(owner), beforeInvalid);
  assert.equal((await call(payload())).body.subjectId, explicit); checks++;

  async function race(bodyA, bodyB, reverse = false) {
    const batch = db.batch, pending = [];
    db.batch = statements => new Promise((resolve, reject) => { pending.push({ statements, resolve, reject }); if (pending.length === 2) for (const item of reverse ? pending.toReversed() : pending) batch(item.statements).then(item.resolve, item.reject); });
    try { return await Promise.all([call(bodyA), call(bodyB)]); } finally { db.batch = batch; }
  }
  const simultaneous = payload({ contact: { ...contact, contactId: 'wxid_concurrent' } });
  const concurrent = await race(simultaneous, simultaneous);
  assert.ok(concurrent.every(result => result.status === 200), JSON.stringify(concurrent)); assert.equal(concurrent[0].body.subjectId, concurrent[1].body.subjectId); assert.equal(concurrent.filter(result => result.body.created).length, 1); checks++;

  for (const reverse of [false, true]) {
    const precise = { ...contact, contactId: 'wxid_explicit-race-' + reverse }, target = addPerson();
    const result = await race(payload({ contact: precise }), payload({ contact: precise, subjectId: target }), reverse);
    assert.ok(result.every(value => value.status === 200), JSON.stringify(result)); assert.equal((await call(payload({ contact: precise }))).body.subjectId, target);
  }
  const multiTarget = addPerson(), multiA = payload({ subjectId: multiTarget, contact: { ...contact, contactId: 'wxid_multi-A' } }), multiB = payload({ subjectId: multiTarget, contact: { ...contact, contactId: 'wxid_multi-B' } });
  await race(multiA, multiB); assert.equal(Object.keys(JSON.parse(person(multiTarget).data).captureBindings).length, 2); checks++;

  const library = { id: 'capture:' + JSON.stringify([publicId, 'synthetic-legacy-account', '合成备注', 'chat']), account: 'synthetic-legacy-account', friend: '合成备注' };
  const legacy = payload({ contact: undefined, library }); const imported = await call(legacy); assert.equal(imported.status, 200, JSON.stringify(imported.body)); assert.notEqual(imported.body.subjectId, sameNameId); assert.equal((await call(legacy)).body.subjectId, imported.body.subjectId);
  for (const invalid of [{ ...library, friend: '另一个联系人' }, { ...library, kind: 'moments' }, { ...library, id: library.id.replace(publicId, otherPublicId) }, { ...library, id: 'capture:[]' }]) assert.ok((await call(payload({ contact: undefined, library: invalid }))).status >= 400);
  assert.equal((await call(payload({ contact: { label: '无身份' }, library }))).status, 400, 'invalid precise identity cannot silently fall back'); checks++;

  sql.prepare('UPDATE coach_profiles SET paused=1,data=? WHERE owner_id=?').run(JSON.stringify({ city: '合成城市', avatar: ownAvatar }), owner);
  assert.equal((await call(payload())).status, 200);
  let profile = sql.prepare('SELECT * FROM coach_profiles WHERE owner_id=?').get(owner);
  assert.equal(profile.paused, 0); assert.equal(profile.consent_at, consentAt); assert.equal(JSON.parse(profile.data).city, '合成城市');
  sql.prepare('UPDATE coach_profiles SET consent_at=NULL,paused=1 WHERE owner_id=?').run(owner);
  assert.equal((await call(payload({ consent: false }))).status, 403); assert.equal(sql.prepare('SELECT consent_at FROM coach_profiles WHERE owner_id=?').get(owner).consent_at, null);
  assert.equal((await call(payload())).status, 200); assert.ok(sql.prepare('SELECT consent_at FROM coach_profiles WHERE owner_id=?').get(owner).consent_at); checks++;

  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=';
  const avatarCases = [
    [{ avatarData: png }, png], [{ avatarData: 'data:image/svg+xml;base64,PHN2Zz4=' }, ''], [{ avatarData: 'data:image/png;base64,' + btoa('not an image at all') }, ''],
    [{ avatarUrl }, avatarUrl], [{ avatarUrl: 'https://qlogo.cn.evil.test/image' }, ''], [{ avatarUrl: 'http://wx.qlogo.cn/image' }, ''], [{ avatarUrl: 'https://evil.test/image' }, ''],
    [{ avatarUrl: 'https://user:password@wx.qlogo.cn/image' }, ''], [{ avatarUrl: 'https://wx.qlogo.cn:8443/image' }, ''], [{ avatarData: 'invalid', avatarUrl }, avatarUrl],
  ];
  for (const [input, expected] of avatarCases) assert.equal(server.captureContactAvatar(input), expected);
  const noAvatar = payload({ contact: { ...contact, contactId: 'wxid_avatar', avatarData: 'invalid' } });
  const emptyAvatar = await call(noAvatar); assert.equal(emptyAvatar.status, 200); assert.equal(emptyAvatar.body.avatar, undefined);
  const newAvatar = await call(payload({ contact: { ...noAvatar.contact, avatarData: png } })); assert.equal(newAvatar.body.subjectId, emptyAvatar.body.subjectId); assert.equal(newAvatar.body.avatar, png);
  assert.equal((await call(payload({ contact: { ...noAvatar.contact, avatarUrl } }))).body.avatar, png); checks++;

  const fullOwner = 'synthetic-full-owner', fullPublicId = crypto.randomUUID();
  sql.prepare('INSERT INTO coach_credit_accounts(owner_id,public_id,created_at,updated_at) VALUES(?,?,1,1)').run(fullOwner, fullPublicId);
  for (let index = 0; index < 40; index++) addPerson(fullOwner);
  assert.equal((await call(payload({ expectedOwnerId: fullPublicId }), { 'x-test-owner': fullOwner })).status, 409); assert.equal(count(fullOwner), 40);
  const fullTarget = sql.prepare('SELECT id FROM coach_subjects WHERE owner_id=? LIMIT 1').get(fullOwner).id;
  assert.equal((await call(payload({ expectedOwnerId: fullPublicId, subjectId: fullTarget }), { 'x-test-owner': fullOwner })).body.subjectId, fullTarget);
  assert.equal((await call(payload({ expectedOwnerId: fullPublicId }), { 'x-test-owner': fullOwner })).body.subjectId, fullTarget); checks++;

  const inactiveBody = payload({ contact: { ...contact, contactId: 'wxid_inactive' } }); const inactive = await call(inactiveBody);
  sql.prepare("UPDATE coach_subjects SET status='archived',data=json_set(data,'$.notes','旧档案私密笔记') WHERE id=?").run(inactive.body.subjectId);
  const reimported = await call(inactiveBody); assert.equal(reimported.status, 200); assert.notEqual(reimported.body.subjectId, inactive.body.subjectId); assert.equal(reimported.body.created, true);
  assert.equal(person(inactive.body.subjectId).status, 'archived'); assert.equal(JSON.parse(person(reimported.body.subjectId).data).notes, undefined);
  sql.prepare('DELETE FROM coach_subjects WHERE id=?').run(reimported.body.subjectId);
  const afterDelete = await call(inactiveBody); assert.equal(afterDelete.status, 200); assert.notEqual(afterDelete.body.subjectId, reimported.body.subjectId); assert.equal(afterDelete.body.created, true);
  assert.equal((await call(inactiveBody)).body.subjectId, afterDelete.body.subjectId); checks++;

  for (const captureBindings of ['broken legacy field', [], null]) {
    const legacyTarget = addPerson(owner, { notes: '旧字段保留', captureBindings });
    const repaired = await call(payload({ subjectId: legacyTarget, contact: { ...contact, contactId: 'wxid_legacy-' + legacyTarget } }));
    assert.equal(repaired.status, 200, JSON.stringify(repaired.body)); assert.equal(JSON.parse(person(legacyTarget).data).notes, '旧字段保留'); assert.equal(Object.keys(JSON.parse(person(legacyTarget).data).captureBindings).length, 1);
  } checks++;

  const batch = db.batch, beforeRollback = count(owner);
  db.batch = statements => batch([...statements, { execute() { throw Error('SYNTHETIC_ROLLBACK'); } }]);
  assert.equal((await call(payload({ contact: { ...contact, contactId: 'wxid_rollback' } }))).status, 500); db.batch = batch; assert.equal(count(owner), beforeRollback); checks++;

  const deletedTarget = addPerson(); db.batch = statements => { sql.prepare('DELETE FROM coach_subjects WHERE id=?').run(deletedTarget); return batch(statements); };
  assert.equal((await call(payload({ subjectId: deletedTarget }))).status, 409); db.batch = batch; assert.equal((await call(payload())).body.subjectId, explicit); checks++;

  const stored = sql.prepare('SELECT data FROM coach_subjects').all().map(row => row.data).join(''); assert.ok(!stored.includes('wxid_')); assert.ok(!stored.includes(contact.accountKey));
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM coach_credit_tasks').get().n, 0); assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM coach_capture_records').get().n, 0); assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM coach_facts').get().n, 0); checks++;
  console.log(`Capture subject passed ${checks} real SQLite integration groups: exact identities, explicit precedence, concurrent retries/rebinding, legacy namespaces, consent, avatar validation/preservation, owner isolation, capacity, rollback, and deletion races. No network, model, capture, or billing calls.`);
} finally { globalThis.fetch = oldFetch; sql.close(); }
