import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as overview from '../lib/workspace-overview.mjs';
import * as identity from '../lib/request-identity.mjs';

// Runs the production SQL against SQLite and the actual route/auth guard. Only
// the upstream account-service response and Cloudflare environment are replaced.
const origin = 'https://coach.example.test';
const owner = 'lovetalk:alice';
const other = 'lovetalk:bob';
const aliceCookie = 'lt_next_session=alice_session_token_123456789';
const bobCookie = 'lt_next_session=bob_session_token_1234567890';
const env = {};
const mocks = {
  'cloudflare:workers': { env },
  '@/lib/request-identity.mjs': identity,
  '@/lib/workspace-overview.mjs': overview,
};
const compiled = ts.transpileModule(readFileSync(new URL('../app/api/web/workspace/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const route = {};
new Function('require', 'exports', compiled)(name => {
  assert.ok(name in mocks, 'Unexpected dependency: ' + name);
  return mocks[name];
}, route);

const originalFetch = globalThis.fetch;
let authCalls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), 'https://ai.lovetalk.love/next/api/session');
  authCalls++;
  const cookie = options.headers.Cookie;
  return Response.json(cookie === aliceCookie ? { logged_in: true, user: 'alice' }
    : cookie === bobCookie ? { logged_in: true, user: 'bob' }
      : { logged_in: false });
};

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const name of ['0000_lying_leech', '0003_wealthy_stephen_strange', '0018_saved_analysis_reports']) {
    sql.exec(readFileSync(new URL('../drizzle/' + name + '.sql', import.meta.url), 'utf8'));
  }
  let reads = 0;
  const db = { prepare(query) { let values = []; return {
    bind(...items) { values = items; return this; },
    async first() { reads++; return sql.prepare(query).get(...values) || null; },
    async all() { reads++; return { results: sql.prepare(query).all(...values) }; },
  }; } };
  const now = Date.now();
  const profile = (who, { consent = 1, paused = 0, data = {} } = {}) => sql.prepare(
    'INSERT OR REPLACE INTO coach_profiles (owner_id,consent_at,paused,data,updated_at) VALUES (?,?,?,?,?)',
  ).run(who, consent, paused, typeof data === 'string' ? data : JSON.stringify(data), now);
  const settings = (who, consent = 1) => sql.prepare(
    'INSERT OR REPLACE INTO coach_crush_settings (owner_id,consent_at,updated_at) VALUES (?,?,?)',
  ).run(who, consent, now);
  const person = (id, who, label, { status = 'active', data = {}, updatedAt = now } = {}) => sql.prepare(
    'INSERT INTO coach_subjects (id,owner_id,label,status,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
  ).run(id, who, label, status, typeof data === 'string' ? data : JSON.stringify(data), now, updatedAt);
  const thread = (id, who, subject = null) => sql.prepare(
    'INSERT INTO coach_crush_threads (id,owner_id,subject_id,channel_key,updated_at,expires_at) VALUES (?,?,?,?,?,?)',
  ).run(id, who, subject, id, now, now + 3600000);
  const report = (id, who, { threadId = id + '-thread', status = 'done', result = { decision: { judgment: '合成判断 ' + id } }, createdAt = now, expiresAt = now + 3600000 } = {}) => sql.prepare(
    'INSERT INTO coach_crush_reports (id,owner_id,thread_id,source_key,input_hash,revision,status,result,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, who, threadId, id, id, 1, status, typeof result === 'string' ? result : JSON.stringify(result), createdAt, now, expiresAt);
  const fact = (id, who, subject, field = 'profileClue', status = 'pending') => sql.prepare(
    'INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(id, who, subject, field, 'PRIVATE FACT BODY ' + id, 'synthetic', 'PRIVATE EVIDENCE ' + id, status, now);
  const updatePerson = (id, data) => sql.prepare('UPDATE coach_subjects SET data=? WHERE id=?')
    .run(typeof data === 'string' ? data : JSON.stringify(data), id);
  profile(owner, { data: { goals: '认真相处', privateNotes: 'DO NOT SURFACE SELF NOTES' } });
  profile(other, { data: { goals: 'DO NOT SURFACE OTHER SELF' } });
  settings(owner); settings(other);
  person('alice-person', owner, '阿青', { data: { stage: '刚认识', privateNotes: 'DO NOT SURFACE PERSON NOTES' } });
  person('bob-person', other, 'OTHER OWNER PERSON');
  thread('alice-thread', owner, 'alice-person');
  thread('bob-thread', other, 'bob-person');
  return { sql, db, now, profile, settings, person, thread, report, fact, updatePerson, get reads() { return reads; } };
}

const request = (query = '', headers = {}) => new Request(origin + '/api/web/workspace' + query, {
  headers: { Cookie: aliceCookie, Origin: origin, ...headers },
});
const results = [];
async function test(name, run) {
  const f = fixture();
  env.DB = f.db;
  try { await run(f); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false }); console.error('FAIL ' + name + '\n' + error.stack); }
  finally { f.sql.close(); }
}

try {
  await test('owner-scoped people, self summary, reports and relationship joins', async f => {
    f.report('own', owner, { threadId: 'alice-thread' });
    f.report('other-secret', other, { threadId: 'bob-thread', result: { decision: { judgment: 'OTHER OWNER REPORT' } } });
    f.report('cross-thread', owner, { threadId: 'bob-thread' });
    f.thread('bad-subject-thread', owner, 'bob-person');
    f.report('cross-subject', owner, { threadId: 'bad-subject-thread' });
    const data = await overview.workspaceOverview(f.db, owner);
    assert.deepEqual(data.people.map(p => p.id), ['alice-person']);
    assert.equal(data.peopleTotal, 1, 'count must exclude other owners');
    assert.equal(data.archive.selfReady, true);
    assert.equal(data.total, 3);
    assert.equal(data.reports.find(r => r.id === 'own').label, '阿青');
    for (const id of ['cross-thread', 'cross-subject']) {
      assert.equal(data.reports.find(r => r.id === id).subjectId, null);
      assert.equal(data.reports.find(r => r.id === id).label, '');
    }
    assert.doesNotMatch(JSON.stringify(data), /OTHER OWNER|DO NOT SURFACE/);
    assert.deepEqual(Object.keys(data.people[0]).sort(), ['id', 'label', 'stage', 'updatedAt']);
  });

  await test('pending count excludes other owners, inactive/missing people and unrelated fields', async f => {
    f.person('archived-person', owner, 'Archived', { status: 'archived' });
    f.fact('valid-person', owner, 'alice-person');
    f.fact('valid-self', owner, null, 'selfBasic:city');
    f.fact('valid-event', owner, 'alice-person', 'recentEvent');
    f.fact('other', other, 'bob-person');
    f.fact('foreign-person', owner, 'bob-person');
    f.fact('missing-person', owner, 'missing-person');
    f.fact('archived-person', owner, 'archived-person');
    f.fact('accepted', owner, 'alice-person', 'profileClue', 'accepted');
    f.fact('unrelated', owner, null, 'chatMemory');
    const data = await overview.workspaceOverview(f.db, owner);
    assert.equal(data.archive.pendingFacts, 3);
    assert.equal(data.peopleTotal, 1, 'count must exclude archived people');
    assert.doesNotMatch(JSON.stringify(data), /PRIVATE FACT|PRIVATE EVIDENCE|Archived/);
  });

  await test('completed reports survive old expiry; malformed JSON degrades without query failure', async f => {
    f.report('fresh', owner);
    f.report('expired', owner, { expiresAt: f.now - 1000 });
    f.report('failed', owner, { status: 'failed' });
    f.report('pending', owner, { status: 'pending' });
    f.report('broken-json', owner, { result: '{bad json' });
    f.report('fallback', owner, { result: { decision: { possibleIntent: '可以核对的替代解释' } } });
    const data = await overview.workspaceOverview(f.db, owner);
    assert.deepEqual(data.reports.map(r => r.id).sort(), ['broken-json', 'expired', 'fallback', 'fresh']);
    assert.equal(data.total, 4);
    assert.equal(data.reports.find(r => r.id === 'fallback').summary, '可以核对的替代解释');
    assert.ok(data.reports.find(r => r.id === 'broken-json').summary.length > 0);
  });

  await test('paused archive surfaces no people, clues, self signal or reports', async f => {
    f.profile(owner, { paused: 1, data: { goals: 'private paused goal' } });
    f.fact('hidden-clue', owner, 'alice-person');
    f.report('hidden-report', owner, { threadId: 'alice-thread' });
    const data = await overview.workspaceOverview(f.db, owner);
    assert.deepEqual(data.people, []); assert.deepEqual(data.reports, []);
    assert.equal(data.peopleTotal, 0);
    assert.deepEqual(data.archive, { enabled: true, paused: true, pendingFacts: 0, selfReady: false });
    assert.equal(data.total, 0);
    assert.deepEqual(data.followups, []); assert.equal(data.pendingFollowups, 0);
  });

  await test('revoked archive hides stored self, people and clue metadata', async f => {
    f.profile(owner, { consent: null, data: { goals: 'retained but unauthorized goal' } });
    f.fact('hidden-clue', owner, 'alice-person');
    f.report('separate-report', owner, { threadId: 'alice-thread', result: { decision: { judgment: 'independently authorized report' } } });
    const data = await overview.workspaceOverview(f.db, owner);
    assert.deepEqual(data.people, []);
    assert.equal(data.peopleTotal, 0);
    assert.deepEqual(data.archive, { enabled: false, paused: false, pendingFacts: 0, selfReady: false });
    // Report consent is currently independent from archive consent. If reports
    // remain accessible, none may carry a retained archive label or subject ID.
    assert.ok(data.reports.every(r => r.label === '' && r.subjectId === null));
    assert.doesNotMatch(JSON.stringify(data), /阿青|alice-person|retained but unauthorized|PRIVATE FACT/);
    assert.deepEqual(data.followups, []); assert.equal(data.pendingFollowups, 0);
  });

  await test('revoked report consent hides all report counts and results', async f => {
    f.settings(owner, null); f.report('hidden', owner);
    const data = await overview.workspaceOverview(f.db, owner);
    assert.equal(data.total, 0); assert.deepEqual(data.reports, []);
    assert.equal(data.people.length, 1);
  });

  await test('new empty account and stale self data without consent have safe defaults', async f => {
    const empty = await overview.workspaceOverview(f.db, 'lovetalk:new-empty');
    assert.deepEqual(empty, { archive: { enabled: false, paused: false, pendingFacts: 0, selfReady: false }, people: [], peopleTotal: 0, followups: [], pendingFollowups: 0, reports: [], total: 0, page: 1, pageSize: 12 });
    f.profile('lovetalk:no-consent', { consent: null, data: { goals: 'Do not surface', values: 'private' } });
    assert.equal((await overview.workspaceOverview(f.db, 'lovetalk:no-consent')).archive.selfReady, false);
    f.profile('lovetalk:bad-self', { data: '["not an object"]' });
    assert.equal((await overview.workspaceOverview(f.db, 'lovetalk:bad-self')).archive.selfReady, false);
  });

  await test('literal search handles SQL metacharacters, Chinese and case-insensitive text', async f => {
    f.report('literal-percent', owner, { result: { decision: { judgment: '100% effort' } } });
    f.report('literal-under', owner, { result: { decision: { judgment: 'hello_world' } } });
    f.report('literal-quote', owner, { result: { decision: { judgment: "O'Neil said hello" } } });
    f.report('named', owner, { threadId: 'alice-thread' });
    for (const [query, expected] of [['%', 'literal-percent'], ['_', 'literal-under'], ["O'Neil", 'literal-quote'], ['  EFFORT ', 'literal-percent'], ['阿青', 'named']]) {
      const data = await overview.workspaceOverview(f.db, owner, { query });
      assert.equal(data.total, 1, query); assert.equal(data.reports[0].id, expected, query);
    }
    assert.equal((await overview.workspaceOverview(f.db, owner, { query: "' OR 1=1 --" })).total, 0);
  });

  await test('report pagination is deterministic for equal timestamps and bounded for invalid page input', async f => {
    const ids = Array.from({ length: 27 }, (_, i) => 'page-' + String(i).padStart(2, '0'));
    for (const id of ids) f.report(id, owner, { createdAt: f.now });
    const pages = await Promise.all([1, 2, 3].map(page => overview.workspaceOverview(f.db, owner, { page })));
    assert.deepEqual(pages.map(p => p.reports.length), [12, 12, 3]);
    assert.ok(pages.every(p => p.total === 27));
    assert.deepEqual(pages.flatMap(p => p.reports.map(r => r.id)), [...ids].sort().reverse());
    assert.deepEqual((await overview.workspaceOverview(f.db, owner, { page: 2 })).reports, pages[1].reports);
    for (const page of [-10, 0, NaN, Infinity, 'not-a-page']) {
      assert.equal((await overview.workspaceOverview(f.db, owner, { page })).page, 1);
    }
    assert.equal((await overview.workspaceOverview(f.db, owner, { page: 2.9 })).page, 2);
    const far = await overview.workspaceOverview(f.db, owner, { page: 1e20 });
    assert.equal(far.page, 10000); assert.equal(far.total, 27); assert.deepEqual(far.reports, []);
  });

  await test('recent people use an ID tie-breaker so the 40-person cutoff is stable', async f => {
    const ids = Array.from({ length: 42 }, (_, i) => 'recent-' + String(i).padStart(2, '0'));
    // Deliberately insert in a different order from the expected sort. SQLite's
    // implicit row/index order must not decide which people survive the limit.
    for (const i of [...ids.keys()].filter(i => i % 2).concat([...ids.keys()].filter(i => !(i % 2)))) {
      f.person(ids[i], owner, 'Recent ' + i, { updatedAt: f.now + 1 });
    }
    const data = await overview.workspaceOverview(f.db, owner);
    assert.deepEqual(data.people.map(p => p.id), [...ids].sort().reverse().slice(0, 40));
    assert.equal(data.peopleTotal, 43, 'true count includes older people beyond the recent limit');
    const older = await overview.workspaceOverview(f.db, owner, { query: '阿青' });
    assert.deepEqual(older.people.map(p => p.id), ['alice-person'], 'search must match before applying the recent limit');
    assert.equal(older.peopleTotal, 43, 'the total remains independent from the search');
    const stage = await overview.workspaceOverview(f.db, owner, { query: '刚认识' });
    assert.deepEqual(stage.people.map(p => p.id), ['alice-person']);
    f.person('bad-json-person', owner, '损坏资料仍可按名字找', { data: '{bad json' });
    assert.equal((await overview.workspaceOverview(f.db, owner, { query: '损坏资料' })).people[0].id, 'bad-json-person');
  });

  await test('actual route uses verified owner and ignores spoofed owner query/header', async f => {
    f.report('alice-report', owner); f.report('bob-report', other);
    const response = await route.GET(request('?ownerId=lovetalk%3Abob', { 'X-Owner-Id': other }));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json(); assert.deepEqual(data.reports.map(r => r.id), ['alice-report']);
    const next = await route.GET(request('', { Cookie: bobCookie }));
    assert.deepEqual((await next.json()).reports.map(r => r.id), ['bob-report'], 'a new request must not reuse the previous owner');
  });

  await test('followups use only archived advice from the authenticated active person', async f => {
    const history = (subjectId, reportId, nextStep) => ({ subjectId, reportId, nextStep, updatedAt: f.now, summary: 'saved source' });
    f.updatePerson('alice-person', { relationshipHistory: [history('alice-person', 'own-advice', '核对下一步安排'), history('bob-person', 'wrong-subject', 'WRONG SUBJECT ADVICE')] });
    f.updatePerson('bob-person', { relationshipHistory: [history('bob-person', 'other-advice', 'OTHER OWNER ADVICE')] });
    f.person('archived-person', owner, 'Archived', { status: 'archived', data: { relationshipHistory: [history('archived-person', 'archived-advice', 'ARCHIVED ADVICE')] } });
    f.person('deleted-person', owner, 'Deleted', { data: { relationshipHistory: [history('deleted-person', 'deleted-advice', 'DELETED ADVICE')] } });
    f.sql.prepare('DELETE FROM coach_subjects WHERE id=?').run('deleted-person');
    f.fact('pending-suggestion', owner, 'alice-person', 'recentEvent');
    f.fact('accepted-observation', owner, 'alice-person', 'recentEvent', 'accepted');
    const response = await route.GET(request('?ownerId=' + encodeURIComponent(other), { 'X-Owner-Id': other }));
    const data = await response.json();
    assert.equal(data.pendingFollowups, 1);
    assert.equal(data.followups.length, 1);
    assert.equal(data.followups[0].subjectId, 'alice-person');
    assert.equal(data.followups[0].action, '核对下一步安排');
    assert.doesNotMatch(JSON.stringify(data.followups), /OTHER OWNER|WRONG SUBJECT|ARCHIVED|DELETED|PRIVATE FACT/);
    const next = await route.GET(request('', { Cookie: bobCookie }));
    assert.deepEqual((await next.json()).followups.map(item => item.reportId), ['other-advice']);
  });

  await test('followups collapse revisions by append order and keep real suggestion dates', async f => {
    f.updatePerson('alice-person', { privateNotes: 'DO NOT SURFACE NOTES', relationshipHistory: [
      { subjectId: 'alice-person', reportId: 'revised', nextStep: '保留原来的建议', updatedAt: f.now - 9000, summary: 'PRIVATE SOURCE BODY' },
    ], actionFeedback: [
      { id: 'one', reportId: 'revised', action: 'mutated action', outcome: 'waiting', recordedAt: f.now - 1000, note: 'PRIVATE FEEDBACK NOTE' },
      { id: 'two', reportId: 'revised', action: 'mutated action', outcome: 'positive', recordedAt: f.now - 1000, revisionOf: 'one' },
      { id: 'three', reportId: 'old-source', action: '来源已整理但反馈保留', outcome: 'not_done', recordedAt: f.now - 2000 },
    ] });
    const before = f.sql.prepare('SELECT data FROM coach_subjects WHERE id=?').get('alice-person').data;
    const data = await overview.workspaceOverview(f.db, owner);
    assert.equal(data.pendingFollowups, 0);
    assert.equal(data.followups.length, 2);
    const current = data.followups.find(item => item.reportId === 'revised');
    assert.equal(current.outcome, 'positive'); assert.equal(current.outcomeLabel, '有积极反馈');
    assert.equal(current.action, '保留原来的建议');
    assert.equal(current.suggestedAt, f.now - 9000); assert.equal(current.recordedAt, f.now - 1000);
    assert.equal(current.sourceAvailable, true);
    const old = data.followups.find(item => item.reportId === 'old-source');
    assert.equal(old.outcome, 'not_done'); assert.equal(old.suggestedAt, null); assert.equal(old.sourceAvailable, false);
    assert.doesNotMatch(JSON.stringify(data), /PRIVATE SOURCE BODY|PRIVATE FEEDBACK NOTE|DO NOT SURFACE NOTES|mutated action/);
    assert.equal(f.sql.prepare('SELECT data FROM coach_subjects WHERE id=?').get('alice-person').data, before, 'workspace reads cannot rewrite feedback or advice');
  });

  await test('three followups prioritize unreported suggestions, then recent feedback with stable ties', async f => {
    f.updatePerson('alice-person', { relationshipHistory: [
      { reportId: 'pending-a', nextStep: '较早建议', updatedAt: f.now - 5000 },
      { reportId: 'pending-b', nextStep: '同一时刻建议', updatedAt: f.now - 5000 },
    ], actionFeedback: [
      { reportId: 'latest-feedback', action: '已反馈建议', outcome: 'waiting', recordedAt: f.now },
      { reportId: 'older-feedback', action: '较早反馈建议', outcome: 'declined', recordedAt: f.now - 1000 },
    ] });
    const data = await overview.workspaceOverview(f.db, owner);
    assert.equal(data.pendingFollowups, 2);
    assert.deepEqual(data.followups.map(item => item.reportId), ['pending-a', 'pending-b', 'latest-feedback']);
    assert.deepEqual((await overview.workspaceOverview(f.db, owner)).followups, data.followups);
  });

  await test('followup totals and candidates include older people beyond the forty-person list', async f => {
    for (let i = 0; i < 42; i++) f.person('recent-person-' + i, owner, 'Recent ' + i, { updatedAt: f.now + 1000 });
    f.updatePerson('alice-person', { relationshipHistory: Array.from({ length: 5 }, (_, i) => ({ reportId: 'older-' + i, nextStep: '真实保留建议 ' + i, updatedAt: f.now - i })) });
    const data = await overview.workspaceOverview(f.db, owner, { query: 'Recent' });
    assert.equal(data.people.some(item => item.id === 'alice-person'), false);
    assert.equal(data.pendingFollowups, 5); assert.equal(data.followups.length, 3);
    assert.ok(data.followups.every(item => item.subjectId === 'alice-person'));
  });

  await test('completed reports stay available while absent and unauthorized reports remain hidden', async f => {
    f.updatePerson('alice-person', { relationshipHistory: [
      { reportId: 'fresh-source', nextStep: '有效报告建议', updatedAt: f.now, summary: '已存摘要' },
      { reportId: 'expired-source', nextStep: '过期报告建议', updatedAt: f.now - 1, summary: '过期但已归档摘要' },
      { reportId: 'absent-source', nextStep: '报告已清理', updatedAt: f.now - 2, summary: '' },
    ] });
    f.report('fresh-source', owner, { threadId: 'alice-thread' });
    f.report('expired-source', owner, { threadId: 'alice-thread', expiresAt: f.now - 1000 });
    let data = await overview.workspaceOverview(f.db, owner);
    assert.deepEqual(data.followups.map(item => [item.reportId, item.sourceAvailable, item.reportAvailable]), [
      ['fresh-source', true, true], ['expired-source', true, true], ['absent-source', false, false],
    ]);
    f.settings(owner, null);
    data = await overview.workspaceOverview(f.db, owner);
    assert.equal(data.followups.length, 3, 'archive and report consent are independent');
    assert.equal(data.pendingFollowups, 3);
    assert.ok(data.followups.every(item => item.reportAvailable === false));
    for (const profile of [{ consent: null }, { paused: 1 }]) {
      f.profile(owner, profile);
      data = await overview.workspaceOverview(f.db, owner);
      assert.deepEqual(data.followups, []); assert.equal(data.pendingFollowups, 0);
    }
  });

  await test('report links require the same owner and person, not just a retained report ID', async f => {
    f.person('second-person', owner, '另一个人'); f.thread('second-thread', owner, 'second-person');
    f.updatePerson('alice-person', { relationshipHistory: [
      { reportId: 'foreign-report', nextStep: '归档建议一', updatedAt: f.now },
      { reportId: 'wrong-person-report', nextStep: '归档建议二', updatedAt: f.now },
      { reportId: 'bad-thread-report', nextStep: '归档建议三', updatedAt: f.now },
    ] });
    f.report('foreign-report', other, { threadId: 'bob-thread' });
    f.report('wrong-person-report', owner, { threadId: 'second-thread' });
    f.report('bad-thread-report', owner, { threadId: 'bob-thread' });
    const data = await overview.workspaceOverview(f.db, owner);
    assert.equal(data.followups.length, 3);
    assert.ok(data.followups.every(item => item.reportAvailable === false));
    assert.doesNotMatch(JSON.stringify(data.followups), /OTHER OWNER/);
  });

  await test('damaged legacy followup records fail closed without invented timestamps or outcomes', async f => {
    f.updatePerson('alice-person', { relationshipHistory: [null, [], 7,
      { reportId: '', nextStep: 'missing ID' }, { reportId: 'bad-action', nextStep: {} },
      { reportId: 'no-date', nextStep: '日期尚未保存的建议', updatedAt: 'yesterday', summary: [] },
    ], actionFeedback: [null, { reportId: 'unsafe', action: 'invalid outcome', outcome: '__proto__' },
      { reportId: 'bad-date', action: '保留已存反馈', outcome: 'alternative', recordedAt: 'tomorrow' },
    ] });
    f.person('bad-person-json', owner, 'Bad JSON', { data: '{bad' });
    f.person('bad-arrays', owner, 'Bad arrays', { data: { relationshipHistory: { reportId: 'not-array' }, actionFeedback: 'not-array' } });
    const data = await overview.workspaceOverview(f.db, owner);
    assert.equal(data.pendingFollowups, 1); assert.equal(data.followups.length, 2);
    assert.ok(data.followups.every(item => item.suggestedAt === null && item.recordedAt === null && !item.sourceAvailable && !item.reportAvailable));
    assert.doesNotMatch(JSON.stringify(data.followups), /missing ID|invalid outcome|yesterday|tomorrow|unsafe/);
  });

  await test('anonymous, bearer-only and duplicate-cookie requests return 401 before querying data', async f => {
    for (const headers of [{ Cookie: '' }, { Cookie: '', Authorization: 'Bearer ' + 'a'.repeat(64), 'X-Owner-Id': owner }, { Cookie: aliceCookie + '; ' + aliceCookie }]) {
      const response = await route.GET(request('', headers));
      assert.equal(response.status, 401); assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal(f.reads, 0);
  });

  await test('cross-site and foreign-origin requests are rejected before authentication or DB reads', async f => {
    const before = authCalls;
    for (const headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'https://attacker.example' }]) {
      assert.equal((await route.GET(request('', headers))).status, 401);
    }
    assert.equal(authCalls, before); assert.equal(f.reads, 0);
  });

  await test('invalid native cookie cannot fall back to a valid account-service cookie', async f => {
    const before = authCalls;
    assert.equal((await route.GET(request('', { Cookie: 'cz_session=invalid; ' + aliceCookie }))).status, 401);
    assert.equal(authCalls, before); assert.equal(f.reads, 0);
  });

  await test('database errors return recoverable 503 without leaking internal details', async () => {
    env.DB = { prepare() { throw new Error('secret table names and sql details'); } };
    const response = await route.GET(request());
    assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json(); assert.equal(typeof data.error, 'string');
    assert.doesNotMatch(data.error, /secret|sql|table/);
  });
} finally { globalThis.fetch = originalFetch; }

const failed = results.filter(r => !r.passed);
console.log(`Workspace overview: ${results.length - failed.length}/${results.length} runtime checks passed.`);
if (failed.length) process.exitCode = 1;
