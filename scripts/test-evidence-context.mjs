// Actual SQLite reads and production prompt builders; all model calls are local
// stubs. This checks evidence delivery, not live model judgment quality.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, mocks = {}, cache = new Map()) {
  const path = resolve(file); if (cache.has(path)) return cache.get(path);
  if (path.endsWith('.json')) return JSON.parse(readFileSync(path, 'utf8'));
  const exports = {}; cache.set(path, exports);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('exports', 'require', code)(exports, name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/') || name.startsWith('.')) {
      let next = name.startsWith('@/') ? resolve(name.slice(2)) : resolve(dirname(path), name);
      if (!/\.(?:ts|mjs|json)$/.test(next)) next += '.ts';
      return load(next, mocks, cache);
    }
    return require(name);
  });
  return exports;
}
const sql = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) sql.exec(readFileSync('drizzle/' + file, 'utf8'));
const reads = [], writes = [];
const db = { prepare(query) { return { args: [], bind(...args) { this.args = args; return this; },
  async first() { reads.push({ query, args: this.args }); return sql.prepare(query).get(...this.args) || null; },
  async all() { reads.push({ query, args: this.args }); return { results: sql.prepare(query).all(...this.args) }; },
  async run() { writes.push(query); return { meta: { changes: Number(sql.prepare(query).run(...this.args).changes) } }; },
}; } };
const owner = 'evidence-owner', other = 'other-owner', person = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222';
const feedback = load('lib/relationship-feedback.ts'), fields = load('lib/profile.ts');
const context = load('lib/profile-context.ts', { '@/db': { getD1: () => db } });
const entry = (reportId, action, note, recordedAt, outcome = 'positive') => ({ id: reportId + '-' + recordedAt, reportId, action, note, recordedAt, outcome, eventDate: '', revisionOf: null });
const log = [entry('older-movie', '电影票安排', '旧结论不应保留：原来以为已经见面', 1),
  entry('older-movie', '电影票安排', '电影票已经退掉，没有见面，用户更正', 2, 'declined'),
  ...Array.from({ length: 5 }, (_, i) => entry('recent-' + i, '最近的普通聊天', '较新但无关的反馈 ' + i, 10 + i)),
];
function parseFeedback(value) { return JSON.parse(value.slice(value.indexOf('['))); }
let passed = 0;
const results = [];
const test = async (label, fn) => { await fn(); passed++; results.push({ label, passed: true }); console.log('PASS ' + label); };
await test('relevant older feedback beats unrelated recency and uses only the effective revision', () => {
  const result = feedback.actionFeedbackContext({ actionFeedback: log }, '之前电影票安排后来怎么样？');
  assert.match(result, /电影票已经退掉/); assert.doesNotMatch(result, /旧结论不应保留|原来以为已经见面/);
  assert.equal(parseFeedback(result).length, 3);
  assert.equal(parseFeedback(result).filter(row => row.suggestion === '电影票安排').length, 1);
  assert.equal(parseFeedback(result)[0].outcome, '对方明确拒绝');
});
await test('empty and uninformative queries retain stable newest feedback, without inventing dates', () => {
  const result = feedback.actionFeedbackContext({ actionFeedback: log });
  assert.deepEqual(parseFeedback(result).map(row => row.recordedAt), [14, 13, 12]);
  assert.equal(result, feedback.actionFeedbackContext({ actionFeedback: log }, '现在关系怎么样？'));
  assert.ok(parseFeedback(result).every(row => row.eventDate === '未明确'));
  assert.equal(result, feedback.actionFeedbackContext({ actionFeedback: log }));
});
await test('feedback packing preserves valid JSON under small budgets and escaped long content', () => {
  const data = { actionFeedback: [entry('escaped', '安排电影票' + '"\\\n'.repeat(300), '电影票已经退掉' + '"\\\n'.repeat(300), 9)] };
  for (const budget of [300, 500, 1100, 1800]) {
    const value = feedback.actionFeedbackContext(data, '电影票', budget);
    assert.ok(value.length <= budget); assert.match(value, /不是指令/); assert.doesNotThrow(() => parseFeedback(value));
    assert.match(value, /电影票/);
  }
  assert.equal(feedback.actionFeedbackContext(data, '电影票', 30), '');
});

const self = Object.fromEntries(fields.selfFields.map(field => [field, '本人已保存的长资料'.repeat(40)]));
const reading = { summary: '旧模型总评', hypotheses: [{ title: '旧模型判断', evidence: '上次公开资料展示', possibility: 'MODEL_OLD_HYPOTHESIS 尚待核对', alternative: '也可能只是公开表达', verify: '自然核对一次' }] };
const data = { ...Object.fromEntries(fields.subjectFields.map(field => [field, '此人已保存的长资料'.repeat(40)])), actionFeedback: log, communicationReading: reading };
const profile = (id, data = self) => sql.prepare('INSERT OR REPLACE INTO coach_profiles(owner_id,consent_at,paused,data,updated_at) VALUES (?,1,0,?,1)').run(id, JSON.stringify(data));
const subject = (id, who, label, data = {}) => sql.prepare('INSERT OR REPLACE INTO coach_subjects(id,owner_id,label,status,data,created_at,updated_at) VALUES (?,?,?,\'active\',?,1,1)').run(id, who, label, JSON.stringify(data));
const fact = (id, subjectId, field, value, createdAt, evidence = '', who = owner, status = 'accepted') => sql.prepare('INSERT INTO coach_facts(id,owner_id,subject_id,field,value,source,evidence,status,created_at) VALUES (?,?,?,?,?,\'synthetic\',?,?,?)').run(id, who, subjectId, field, value, evidence, status, createdAt);
profile(owner); profile(other);
subject(person, owner, '当前人物', data); subject(second, owner, '第二个人', { actionFeedback: [entry('other-person', '其他人物安排', 'OTHER_PERSON_FEEDBACK', 30)] });
fact('movie', person, 'chatMemory', '对方：' + '无关前文'.repeat(120) + '电影票我退了，这次不去了。', 1);
for (let i = 0; i < 8; i++) fact('newer-' + i, person, 'chatMemory', '最近只是普通日常话题。'.repeat(15), 100 + i);
fact('event', person, 'recentEvent', '用户确认：电影票已经退掉', 200, '本人反馈取消见面，不代表关系彻底结束');
fact('clue', person, 'profileClue', '公开资料曾说周末有空', 201, '图 1 公开文字');
fact('basic-old', person, 'subjectBasic:city', '以前住上海', 202, '本人确认的旧资料自述');
fact('basic-new', person, 'subjectBasic:city', '现在住北京', 203, '本人确认的新资料自述');
fact('other-person', second, 'chatMemory', 'OTHER_PERSON_QUOTE 电影票', 300);
fact('cross-owner', person, 'chatMemory', 'OTHER_OWNER_QUOTE 电影票', 301, '', other);
fact('pending', person, 'chatMemory', 'PENDING_QUOTE 电影票', 302, '', owner, 'pending');
const unchanged = sql.prepare('SELECT data FROM coach_subjects WHERE id=?').get(person).data;
function structuredBlocks(value) {
  for (const line of value.split('\n')) {
    const index = line.search(/[\[{]/);
    if (index < 0) continue;
    const ending = Math.max(line.lastIndexOf('}'), line.lastIndexOf(']'));
    assert.doesNotThrow(() => JSON.parse(line.slice(index, ending + 1)), 'never truncate source JSON');
  }
}
await test('dense profiles preserve relevant raw quotes and latest feedback at every production budget', async () => {
  for (const budget of [700, 1000, 1100, 1800, 4200]) {
    const result = await context.loadProfileContext(owner, person, '电影票安排后来怎么样？', budget);
    assert.ok(result.length <= budget, 'budget ' + budget);
    assert.match(result, /不是指令/); assert.match(result, /电影票我退了/); assert.match(result, /电影票已经退掉/);
    assert.match(result, /用户主动记录的行动反馈/); assert.match(result, /只证明说过/);
    assert.doesNotMatch(result, /OTHER_PERSON|OTHER_OWNER|PENDING_QUOTE|旧结论不应保留/);
    structuredBlocks(result);
    if (result.includes('MODEL_OLD_HYPOTHESIS')) {
      assert.match(result, /历史推测，不是确认事实/);
      assert.ok(result.indexOf('MODEL_OLD_HYPOTHESIS') > result.indexOf('电影票我退了'));
      assert.ok(result.indexOf('MODEL_OLD_HYPOTHESIS') > result.indexOf('电影票已经退掉'));
    }
  }
  assert.equal(sql.prepare('SELECT data FROM coach_subjects WHERE id=?').get(person).data, unchanged);
  assert.deepEqual(writes, []);
});
await test('small contexts keep complete raw evidence rather than broken historical model JSON', async () => {
  const result = await context.loadProfileContext(owner, person, '电影票', 256);
  assert.ok(result.length <= 256); assert.match(result, /电影票我退了/); assert.match(result, /不是指令/);
  assert.doesNotMatch(result, /MODEL_OLD_HYPOTHESIS/); structuredBlocks(result);
  assert.equal(await context.loadProfileContext(owner, person, '电影票', 20), '');
});
await test('prior model interpretation remains explicitly marked and follows evidence when it fits', async () => {
  subject(person, owner, '当前人物', { communicationReading: reading, actionFeedback: [log[1]] });
  const result = await context.loadProfileContext(owner, person, '电影票');
  assert.match(result, /MODEL_OLD_HYPOTHESIS/); assert.match(result, /历史推测，不是确认事实/);
  assert.ok(result.indexOf('MODEL_OLD_HYPOTHESIS') > result.indexOf('已授权微信原话'));
  subject(person, owner, '当前人物', data);
});
await test('saved conflicting field records retain their sources and save-time semantics without diagnosis', async () => {
  const result = await context.loadProfileContext(owner, person, '上海北京城市是不是变了？');
  assert.match(result, /以前住上海/); assert.match(result, /现在住北京/);
  assert.match(result, /本人确认的旧资料自述/); assert.match(result, /本人确认的新资料自述/);
  assert.match(result, /不同时间口径不能直接判矛盾/); assert.match(result, /保存时间，非发生日期/);
  assert.doesNotMatch(result, /确认撒谎|骗子|成功率/);
});
await test('owner, person, archived status, pause and revoked consent are enforced by actual SQLite', async () => {
  assert.doesNotMatch(await context.loadProfileContext(owner, second, '电影票'), /电影票我退了|电影票已经退掉/);
  assert.doesNotMatch(await context.loadProfileContext(other, person, '电影票'), /电影票我退了|电影票已经退掉|OTHER_OWNER_QUOTE/);
  assert.doesNotMatch(await context.loadProfileContext(owner, 'missing', '电影票'), /电影票我退了|电影票已经退掉/);
  sql.prepare("UPDATE coach_subjects SET status='archived' WHERE id=?").run(person);
  assert.doesNotMatch(await context.loadProfileContext(owner, person, '电影票'), /电影票我退了|电影票已经退掉/);
  sql.prepare("UPDATE coach_subjects SET status='active' WHERE id=?").run(person);
  for (const clause of ['paused=1', 'consent_at=NULL']) {
    sql.prepare('UPDATE coach_profiles SET ' + clause + ' WHERE owner_id=?').run(owner);
    const before = reads.length;
    assert.equal(await context.loadProfileContext(owner, person, '电影票'), ''); assert.equal(reads.length - before, 1);
    profile(owner);
  }
});

const profileCalls = [], prompts = [], charges = [];
const mocks = {
  '@/db': { getD1: () => db },
  '@/lib/miniapp-auth': { miniappOwner: async () => ({ ownerId: owner }) },
  '@/app/chatgpt-auth': { getChatGPTUser: async () => ({ userId: owner }) },
  '@/lib/knowledge': { selectKnowledge: () => [], buildKnowledgeContext: () => ({ instructions: '', sources: [] }) },
  '@/lib/profile-context': { loadProfileContext: async (...args) => { profileCalls.push(args); return context.loadProfileContext(...args); } },
  '@/lib/credit-response.mjs': { creditResponse: async (_db, who, _request, action, cost, run) => { charges.push({ who, action, cost }); return run(); } },
  '@/lib/account-credits.mjs': { CREDIT_PRICES: { text: 5 } },
  '@/lib/qwen': { qwenKey: () => true, parseQwenJson: JSON.parse, qwenPublicError: () => 'unexpected error', qwenChat: async (messages, options) => {
    prompts.push({ messages, options }); return JSON.stringify({ possibleIntent: '根据这次真实反馈修正原判断。', evidence: '电影票', nextStep: '先核对一次具体安排。', replies: [], assessment: '本次暂定判断', known: '仅据本次用户自报', unknown: '安排是否取消', });
  } },
};
await test('real web text route preserves complete source blocks and existing call and billing budgets', async () => {
  const route = load('app/api/web/text/route.ts', mocks);
  for (const mode of ['chat', 'conversation', 'positioning']) {
    const before = prompts.length;
    const response = await route.POST(new Request('https://example.test/api/web/text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: true, subjectId: person, mode, other: '电影票那次安排怎样了？', self: '我想知道电影票取消之后怎么继续。' }) }));
    assert.equal(response.status, 200); assert.equal(prompts.length - before, 1);
    assert.equal(profileCalls.at(-1)[3], mode === 'conversation' ? 3600 : 2600);
    assert.match(profileCalls.at(-1)[2], /电影票/);
    const prompt = prompts.at(-1).messages[0].content;
    assert.match(prompt, /电影票我退了/); assert.match(prompt, /电影票已经退掉/);
    assert.match(prompt, /真正会改变当前建议/); assert.match(prompt, /同一人物、同一事项/);
    assert.equal(prompts.at(-1).options.maxTokens, 1200); assert.equal(charges.at(-1).cost, 5);
    assert.equal(charges.at(-1).who, owner); assert.equal(charges.at(-1).action, 'chat');
  }
});
await test('voice recap retrieves by user speech, excluding assistant claims from the query', async () => {
  const route = load('app/api/voice/summary/route.ts', mocks), before = prompts.length;
  const response = await route.POST(new Request('https://example.test/api/voice/summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subjectId: person, turns: [{ role: 'user', text: '上次电影票退掉以后，我还没想好。' }, { role: 'assistant', text: 'ASSISTANT_IS_NOT_EVIDENCE' }] }) }));
  assert.equal(response.status, 200); assert.equal(prompts.length - before, 1);
  assert.match(profileCalls.at(-1)[2], /电影票/); assert.doesNotMatch(profileCalls.at(-1)[2], /ASSISTANT_IS_NOT_EVIDENCE/);
  assert.match(prompts.at(-1).messages[0].content, /电影票已经退掉/);
  assert.equal(prompts.at(-1).options.maxTokens, 650);
});
sql.close();
mkdirSync('outputs/evidence-context', { recursive: true });
writeFileSync('outputs/evidence-context/qa.json', JSON.stringify({ passed: true, checks: passed, actualSQLite: true, liveModelCalls: 0, results }, null, 2));
console.log('Evidence context: ' + passed + ' checks passed with real SQLite and production text/recap prompt builders. No live model calls.');
