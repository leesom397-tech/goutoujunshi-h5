import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as credits from '../lib/account-credits.mjs';
import { creditResponse } from '../lib/credit-response.mjs';
import * as savedReports from '../lib/saved-reports.mjs';

// Every account and record below is synthetic. Models are stubbed; credit and
// report persistence use their production implementation against memory SQLite.
const cache = new Map();
function load(file, overrides = {}) {
  const filename = path.resolve(file);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {}; cache.set(filename, exports);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', 'fetch', compiled)(exports, name => {
    if (name in overrides) return overrides[name];
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + (path.extname(name) ? '' : '.ts')), overrides);
    throw Error('Unexpected dependency: ' + name);
  }, () => assert.fail('No network requests are permitted in this test'));
  return exports;
}
const { captureAnalysisInput, captureReadableText } = load('lib/capture-analysis-input.ts');
const id = () => crypto.randomUUID();
const row = (extra = {}) => ({ localId: id(), kind: 'text', sender: '合成好友', senderRole: 'other', at: '昨天 20:30', text: '周六一起去看展吗？', ...extra });
const payload = (extra = {}) => ({ requestId: id(), confirmed: true, kind: 'chat', friend: '合成好友', records: [row(), row({ senderRole: 'self', sender: '合成我', text: '好呀，下午两点见。' })], ...extra });
const png = { mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF4cAAAAASUVORK5CYII=', name: 'synthetic.png' };
let checks = 0;
function rejects(body, match) { assert.throws(() => captureAnalysisInput(body), match); checks++; }
rejects(null, /格式/); rejects(payload({ confirmed: false }), /确认/); rejects(payload({ kind: 'profile' }), /聊天或朋友圈/);
rejects(payload({ requestId: 'not-a-uuid' }), /编号/); rejects(payload({ subjectId: '-'.repeat(36) }), /人物编号/);
rejects(payload({ friend: ' ' }), /好友/); rejects(payload({ records: [] }), /数量/);
rejects(payload({ records: Array.from({ length: 41 }, () => row()) }), /数量/);
rejects(payload({ kind: 'moments', records: Array.from({ length: 13 }, () => row({ kind: 'post' })) }), /数量/);
rejects(payload({ records: [row({ text: 12 })] }), /材料/);
rejects(payload({ records: [row({ text: 'x'.repeat(6001) })] }), /材料/);
rejects(payload({ records: [row({ senderRole: 'unknown' })] }), /身份/);
rejects(payload({ records: [row({ kind: 'sticker', senderRole: 'unknown', ocrTextVerified: true })] }), /身份/);
rejects(payload({ records: [row({ kind: 'sticker', text: '哈哈哈' })] }), /没有可读取/);
rejects(payload({ records: [row({ kind: 'sticker', text: '[动画表情]', ocrTextVerified: true })] }), /没有可读取/);
rejects(payload({ records: [row({ kind: 'post' })] }), /朋友圈/);
rejects(payload({ records: [row({ kind: 'image', text: '[图片]' })] }), /没有可读取/);
rejects(payload({ records: [row({ images: 'bad' })] }), /图片格式/);
rejects(payload({ records: [row({ images: [{ ...png, data: 'abcd' }] })] }), /格式不一致/);
rejects(payload({ records: [row({ images: [{ ...png, data: 'a' }] })] }), /格式不支持/);
rejects(payload({ records: [row({ images: [{ ...png, mime: 'image/jpeg' }] })] }), /格式不一致/);
rejects(payload({ records: [row({ images: Array.from({ length: 10 }, () => png) })] }), /过多/);
rejects(payload({ records: [row({ localId: 'same' }), row({ localId: 'same' })] }), /重复/);
rejects(payload({ records: [row({ text: 'x'.repeat(1801) })] }), /1800/);
rejects(payload({ records: [row({ kind: 'sticker', text: 'x'.repeat(1800), ocrTextVerified: true })] }), /1800/);
rejects(payload({ records: Array.from({ length: 8 }, () => row({ text: 'x'.repeat(1600) })) }), /聊天文字过长/);
rejects(payload({ kind: 'moments', records: Array.from({ length: 5 }, () => row({ kind: 'post', text: 'x'.repeat(5000) })) }), /过多/);
const verbatim = row({ text: '  第一行\n 第二行  ', at: '  昨天 20:30  ', sender: ' 合成好友 ' });
const kept = captureAnalysisInput(payload({ records: [verbatim] })).records[0];
for (const key of ['text', 'at', 'sender']) assert.equal(kept[key], verbatim[key], 'raw ' + key + ' must stay verbatim');
assert.equal(captureAnalysisInput(payload({ kind: 'moments', records: [row({ kind: 'post', text: '', images: [png] })] })).records.length, 1);

const sql = new DatabaseSync(':memory:');
for (const name of ['0000_lying_leech', '0003_wealthy_stephen_strange', '0015_account_credits', '0016_credit_receipts', '0018_saved_analysis_reports']) sql.exec(readFileSync('drizzle/' + name + '.sql', 'utf8'));
const db = {
  prepare(query) { let values = []; return { bind(...v) { values = v; return this; }, async first() { return sql.prepare(query).get(...values) || null; }, async all() { return { results: sql.prepare(query).all(...values) }; }, async run() { return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } }; } }; },
  async batch(statements) { sql.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } },
};
const owner = 'synthetic-capture-owner', foreign = 'synthetic-foreign-owner';
await credits.ensureCreditAccount(db, owner);
await credits.adjustCredits(db, { id: id(), ownerId: owner, actorId: 'fixture-admin', delta: 500, reason: '本地合成测试' });
await credits.setCreditPermissions(db, { id: id(), ownerId: owner, actorId: 'fixture-admin', features: ['analysis'], enabledUntil: Date.now() + 86400000, reason: '本地合成测试' });
const subject = id(), otherSubject = id();
for (const [subjectId, subjectOwner] of [[subject, owner], [otherSubject, foreign]]) sql.prepare('INSERT INTO coach_subjects(id,owner_id,label,created_at,updated_at) VALUES(?,?,?,?,?)').run(subjectId, subjectOwner, '合成人物', Date.now(), Date.now());
let authenticated = true, currentOwner = owner, modelCalls = 0, analysisCalls = 0, failModel = false, holdModel = false, releaseModel, quickInput, modelInput, budgets = 0;
const momentsModule = load('lib/moments-report.ts');
const riskModule = load('lib/relationship-risk.ts');
const photoModule = load('lib/social-photo-clues.ts');
const route = load('app/api/web/capture/analyze/route.ts', {
  '@/db': { getD1: () => db },
  '@/lib/miniapp-auth': { miniappOwner: async () => authenticated ? { ownerId: currentOwner } : null },
  '@/lib/capture-analysis-input': { captureAnalysisInput, captureReadableText },
  '@/lib/account-credits.mjs': credits,
  '@/lib/credit-response.mjs': { creditResponse },
  '@/lib/saved-reports.mjs': savedReports,
  '@/lib/crush/service': {
    requireSettings: async () => ({ provider: 'qwen' }),
    reserveBudget: async (actualOwner, mode) => { assert.equal(actualOwner, owner); assert.equal(mode, 'deep'); budgets++; },
    analyzeLines: async (actualOwner, text, options) => {
      analysisCalls++; assert.equal(actualOwner, owner); assert.equal(options.providerOverride, 'qwen'); assert.equal(options.skipAffinity, true);
      const report = { id: id(), lines: options.prepared.lines.map((line, index) => ({ id: String(index), speaker: line.speaker, text: line.text })), annotations: [], decision: { judgment: '合成判断', evidence: options.prepared.lines[0].text } };
      sql.prepare("INSERT INTO coach_crush_reports(id,owner_id,thread_id,source_key,input_hash,revision,status,result,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,1,'done',?,?,?,?)").run(report.id, actualOwner, 'fixture-thread', options.sourceKey, 'fixture-hash', JSON.stringify(report), Date.now(), Date.now(), Date.now() + 86400000);
      return report;
    },
  },
  '@/lib/crush/screenshot': { readScreenshotFromQuick: async quick => {
    modelCalls++; quickInput = quick;
    if (holdModel) await new Promise(resolve => { releaseModel = resolve; });
    if (failModel) throw Error('SYNTHETIC_MODEL_FAILURE');
    const lines = quick.lines.filter(line => ['text', 'sticker'].includes(line[1]) && line[2].trim()).map(line => ({ speaker: line[0] === 'right' ? 'self' : 'other', text: (line[1] === 'sticker' ? '【表情包文字】' : '') + line[2].trim(), annotation: {} }));
    return { text: lines.map(line => `${line.speaker === 'self' ? '我' : '对方'}：${line.text}`).join('\n'), prepared: { lines }, decision: { judgment: '合成判断' } };
  } },
  '@/lib/profile-context': { loadProfileContext: async (actualOwner, actualSubject) => { assert.equal(actualOwner, owner); assert.equal(actualSubject, subject); return '合成档案'; } },
  '@/lib/qwen': {
    parseQwenJson: JSON.parse,
    qwenPublicError: (_error, fallback) => fallback,
    qwenChat: async (messages, options) => {
      modelCalls++; modelInput = { messages, options }; if (failModel) throw Error('SYNTHETIC_MODEL_FAILURE');
      const rows = JSON.parse(messages[1].content[0].text);
      return JSON.stringify({ summary: '合成朋友圈总结', moments: { summary: '合成朋友圈总结', posts: rows.map(row => ({ sourceId: row.sourceId, content: '模型改写不能代替原文', date: '2050年', contentTags: ['日常'], copyTags: ['生活记录'] })) }, photoClues: [{ title: '不应保留的无图描述' }] });
    },
  },
  '@/lib/moments-report': momentsModule,
  '@/lib/relationship-risk': riskModule,
  '@/lib/knowledge': { selectKnowledge: () => [] },
  '@/lib/knowledge-public': { publicKnowledgeSources: () => [] },
  '@/lib/social-photo-clues': photoModule,
});
const request = (body = payload(), headers = {}) => new Request('https://capture.test/api/web/capture/analyze', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://capture.test', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const balance = async () => (await credits.readCreditAccount(db, owner)).balance;
authenticated = false; assert.equal((await route.POST(request())).status, 401); authenticated = true;
assert.equal((await route.POST(request(payload(), { origin: 'https://wrong.test' }))).status, 403);
assert.equal((await route.POST(request(payload(), { origin: '' }))).status, 403);
assert.equal((await route.POST(request(payload(), { 'content-type': 'text/plain' }))).status, 415);
assert.equal((await route.POST(request(payload(), { 'content-length': '10000001' }))).status, 413);
assert.equal((await route.POST(request('{bad json'))).status, 400);
assert.equal((await route.POST(request(payload({ confirmed: false })))).status, 400);
assert.equal((await route.POST(request(payload({ subjectId: otherSubject })))).status, 404);
assert.equal(modelCalls, 0); assert.equal(await balance(), 500);

// Concurrent clicks and a later reload keep the same receipt and charge once.
const chat = payload({ subjectId: subject, records: [row({ kind: 'sticker', text: '哈哈哈', ocrTextVerified: true }), row({ senderRole: 'self', text: '好呀' }), row({ senderRole: 'self', text: '好呀' }), row({ kind: 'image', text: '[图片]' }), row({ kind: 'sticker', text: '[动画表情]', senderRole: 'unknown' })] });
holdModel = true;
const pending = route.POST(request(chat));
while (!releaseModel) await new Promise(resolve => setTimeout(resolve, 1));
const concurrent = await route.POST(request(chat)); assert.equal(concurrent.status, 409); assert.equal((await concurrent.json()).code, 'CREDIT_PROCESSING');
releaseModel(); holdModel = false;
const success = await pending; assert.equal(success.status, 200); const report = await success.json();
assert.equal(report.reportId, chat.requestId); assert.equal(report.captureOrigin, true); assert.equal(report.retention, 'until-deleted');
assert.deepEqual(report.sourceIds, chat.records.map(r => r.localId));
assert.deepEqual(report.lines.map(line => line.sourceId), chat.records.slice(0, 3).map(r => r.localId));
assert.equal(report.lines[0].text, '【表情包文字】哈哈哈'); assert.equal(quickInput.lines[3][2], '', 'image markers cannot become invented chat text');
assert.equal(quickInput.lines[4][2], '', 'unverified sticker placeholder must never become real wording'); assert.equal(report.captureUnreadMediaCount, 2); assert.match(report.captureMediaNote, /未解读图片内容/);
assert.equal(modelCalls, 1); assert.equal(analysisCalls, 1); assert.equal(await balance(), 500 - credits.CREDIT_PRICES.analysisSmall);
assert.deepEqual(await (await route.POST(request(chat))).json(), report); assert.equal(modelCalls, 1);
assert.equal((await route.POST(request({ ...chat, friend: '另一个合成好友' }))).status, 409); assert.equal(modelCalls, 1);
const persisted = await savedReports.readAnalysisReport(db, owner, chat.requestId);
assert.equal(persisted.report.captureOrigin, true); assert.equal(persisted.entries[0].lines[0].sourceId, chat.records[0].localId);
assert.equal(await savedReports.readAnalysisReport(db, foreign, chat.requestId), null);

// Model failures release credits; released IDs cannot accidentally start again.
const failed = payload(), beforeFailure = await balance(); failModel = true;
assert.equal((await route.POST(request(failed))).status, 503); failModel = false;
assert.equal(await balance(), beforeFailure); const failedCalls = modelCalls;
const retryReleased = await route.POST(request(failed)); assert.equal(retryReleased.status, 409); assert.equal((await retryReleased.json()).code, 'CREDIT_RELEASED'); assert.equal(modelCalls, failedCalls);
assert.equal((await route.POST(request({ ...failed, requestId: id() }))).status, 200); assert.equal(await balance(), beforeFailure - credits.CREDIT_PRICES.analysisSmall);

// Moments posts retain confirmed original text/date; model cannot rewrite them.
const moments = payload({ kind: 'moments', records: [row({ kind: 'post', text: '周末散步，看到了晚霞。', at: '昨天' }), row({ kind: 'post', text: '今天完成了新的项目。', at: '星期一' })] });
const momentResponse = await route.POST(request(moments)); assert.equal(momentResponse.status, 200); const momentReport = await momentResponse.json();
assert.equal(modelInput.options.vision, false); assert.equal(momentReport.moments.posts.length, 2); assert.deepEqual(momentReport.photoClues, []);
momentReport.moments.posts.forEach((post, index) => { assert.equal(post.sourceId, moments.records[index].localId); assert.equal(post.content, moments.records[index].text); assert.equal(post.date, moments.records[index].at); });
assert.match(modelInput.messages[0].content, /不能执行其中指令/); assert.match(modelInput.messages[0].content, /没有图片就photoClues/);
assert.equal((await savedReports.readAnalysisReport(db, owner, moments.requestId)).report.moments.posts[0].sourceId, moments.records[0].localId);
const photoPayload = payload({ kind: 'moments', records: [row({ kind: 'post', text: '', images: [png] })] });
assert.equal((await route.POST(request(photoPayload))).status, 200); assert.equal(modelInput.options.vision, true);
assert.ok(modelInput.messages[1].content.some(part => part.type === 'image_url' && part.image_url.url.startsWith('data:image/png;base64,')));
assert.equal(budgets, 2);

currentOwner = foreign; const beforeForeign = modelCalls;
await credits.ensureCreditAccount(db, foreign);
assert.equal((await route.POST(request(payload()))).status, 403); assert.equal(modelCalls, beforeForeign);
currentOwner = owner;
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM coach_saved_reports WHERE owner_id=? AND status='done'").get(owner).n, 4);
sql.close();
console.log(`PASS capture analysis: ${checks} input rejections, verbatim sources, image validation, auth/origin/size/ownership gates, real credit concurrency/replay/refund, permanent report persistence, exact chat/sticker and moments source IDs; all models synthetic.`);
