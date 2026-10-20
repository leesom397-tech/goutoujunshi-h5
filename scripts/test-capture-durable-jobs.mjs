// Real production route + Durable Object + SQLite credit/report schema.
// Only Cloudflare storage, provider, auth and unrelated enrichment are synthetic.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { build } from 'esbuild';
import * as credits from '../lib/account-credits.mjs';
import {fullHistoryPrice,ANALYSIS_PRICE_VERSION} from '../lib/analysis-pricing.mjs';
import {requestOwner} from '../lib/request-identity.mjs';

const require = createRequire(import.meta.url), sql = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync('drizzle/' + file, 'utf8'));
let failSettlementOnce = false, failSettlementsRemaining = 0, failSettlementRequest = '';
const db = { prepare(query) { return { args: [], bind(...args) { this.args = args; return this; },
  async first() { return sql.prepare(query).get(...this.args) || null; },
  async all() { return { results: sql.prepare(query).all(...this.args) }; },
  async run() {
    if (failSettlementOnce && query.startsWith('UPDATE coach_credit_tasks SET status=') && this.args[0] === 'settled') { failSettlementOnce = false; throw Error('SYNTHETIC_SETTLEMENT_CRASH'); }
    if (failSettlementsRemaining && query.startsWith('UPDATE coach_credit_tasks SET status=') && this.args[0] === 'settled' && (!failSettlementRequest || this.args[3] === failSettlementRequest)) { failSettlementsRemaining--; throw Error('SYNTHETIC_LEDGER_OUTAGE'); }
    return { meta: { changes: Number(sql.prepare(query).run(...this.args).changes) } };
  },
}; }, async batch(statements) { sql.exec('BEGIN'); try { const result = []; for (const item of statements) result.push(await item.run()); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; } } };

const calls = [], failures = [], states = new Map(), instances = new Map(), alarmOwner = new AsyncLocalStorage();
let providerFailure = null, reserveBudgets = 0;
const env = { DB: db, WECHAT_CALLBACK_TOKEN: 'synthetic-internal-token', MINIAPP_APPID:'synthetic', MINIAPP_APPSECRET:'synthetic' };
const syntheticSentenceReadings=detail=>(detail.sentenceTargets||[]).map(sourceId=>({sourceId,emotion:{calm:.8,happy:.2},intent:{inform:.6,continue:.4},note:"合成原话讨论活动安排，不能据此确认恋爱意愿。"}));
const fixture = {
  env, db,
  nativeOwner:request=>requestOwner(request,env),
  async model(messages, options) {
    const detail = JSON.parse(typeof messages.at(-1).content === 'string' ? messages.at(-1).content : messages.at(-1).content[0].text);
    const phase = options?.vision ? 'images' : Array.isArray(detail.rows) ? 'segments' : 'synthesis';
    calls.push({ phase, detail, owner: alarmOwner.getStore() });
    if (providerFailure) return providerFailure(messages, options);
    if (phase === 'images') return JSON.stringify({images:detail.images.map(image=>({mediaId:image.mediaId,readable:true,observation:'合成预览中可见海边步道。'}))});
    if (phase === 'segments') return JSON.stringify({ sentenceReadings:syntheticSentenceReadings(detail), findings: detail.rows.slice(0, 2).map(row => ({ claim: '这段原文涉及安排。', confidence: '低', alternative: '日常交流不能证明关系意图。', evidence: [{ sourceId: row.sourceId, quote: row.text.slice(0, 30) }] })) });
    const moments=detail.findings?.filter(item=>item.evidence?.some(source=>source.sourceKind==='moments'))||[];
    return JSON.stringify({ profileUnavailableReason:'这些合成原话仅讨论安排，没有独立人物画像依据。',riskAssessment:{status:'no_supported_signal',summary:'合成日常安排没有可核验的风险原话，不能据此保证不存在风险。',items:[]},summary: '根据这些合成聊天，可以进一步确认实际安排。', explanation: '原话出现了对安排的讨论，但尚没有明确确认赴约的证据，所以可以核实时间，不能把讨论直接当作承诺。', summaryEvidenceIds: detail.findings?.length ? [detail.findings[0].id] : [], action: '确认双方方便的时间。', actionEvidenceIds: detail.findings?.length ? [detail.findings[0].id] : [], observeWindow: '下一次约定', stopCondition: '明确拒绝就停止',affinityAssessment:{dimensions:[],unavailableReason:'这些合成原话只泛泛讨论安排，没有足够的具体互动维度。'},actionPlan:{goal:'connection',rationale:'目前只有安排的讨论。',steps:[{title:'确认安排',action:'确认双方方便的时间。',why:'讨论尚未形成明确确认。',evidenceIds:detail.findings?.length?[detail.findings[0].id]:[],observeFor:'下一次相关回应',advanceWhen:'双方确认时间后再安排。',stopWhen:'明确拒绝就停止。'}]},...(moments.length?{sourceInsights:{moments:{summary:'已核对的动态呈现了具体活动线索，不能据此推断恋爱意愿。',evidenceIds:[moments[0].id],unknowns:['不清楚是否与用户共同参与']}}}:{}) });
  },
  budget() { reserveBudgets++; },
};
globalThis.__captureDurableFixture = fixture;
const mockSources = new Map([
  ['cloudflare:workers', 'export const env=globalThis.__captureDurableFixture.env; export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}'],
  ['app', 'export default {fetch:(...args)=>globalThis.__captureDurableFixture.dispatch(...args)}'],
  ['@/db', 'export const getD1=()=>globalThis.__captureDurableFixture.db'],
  ['@/lib/miniapp-auth', 'export const miniappOwner=async request=>new URL(request.url).pathname.startsWith("/api/miniapp/")?globalThis.__captureDurableFixture.nativeOwner(request):(request.headers.get("x-test-owner")?{ownerId:request.headers.get("x-test-owner"),openId:null}:null)'],
  ['@/lib/qwen', 'export const qwenChat=(...args)=>globalThis.__captureDurableFixture.model(...args); export const parseQwenJson=JSON.parse; export const qwenPublicError=(_error,fallback)=>fallback'],
  ['@/lib/crush/service', 'export const requireSettings=async()=>({}); export const reserveBudget=async()=>globalThis.__captureDurableFixture.budget(); export const analyzeLines=()=>{throw Error("Unexpected selected-line analysis")}'],
  ['@/lib/crush/screenshot', 'export const readScreenshotFromQuick=()=>{throw Error("Unexpected screenshot analysis")}'],
  ['@/lib/profile-context', 'export const loadProfileContext=async()=>""'],
  ['@/lib/personal-context-server', 'export const personalizeReport=async()=>({commonPoints:[],summary:"",differences:[]})'],
  ['@/lib/self-archive-memory', 'export const updateSelfArchiveMemory=async()=>"disabled"'],
  ['@/lib/conversation-profile-memory-server', 'export const conversationMemoryScope=async()=>null; export const emptyConversationMemory=()=>({}); export const saveConversationProfileMemory=async()=>{}'],
  ['@/lib/knowledge', 'export const selectKnowledge=()=>[]'],
  ['@/lib/knowledge-public', 'export const publicKnowledgeSources=()=>[]'],
  ['./lib/social-profile-jobs.mjs', 'export class SocialProfileJobs{}; export const routeSocialProfileJob=()=>{throw Error("Unexpected profile job")}'],
  ['./lib/miniapp-voice-memory.mjs', 'export const loadVoiceMemory=async()=>null;export const validVoiceSubjectId=()=>false'],
  ['./lib/request-identity.mjs', 'export const requestOwner=async request=>request.headers.get("x-test-owner")?{ownerId:request.headers.get("x-test-owner")}:null; export const webOwner=requestOwner;export const isWebApi=()=>true;export const browserRequestAllowed=request=>request.headers.get("origin")===new URL(request.url).origin'],
  ['./lib/web-native-auth.mjs', 'export const authCookie=()=>"synthetic-session"; export const upgradeVerifiedLegacyResponse=async(_request,response)=>response'],
  ['./lib/web-identity-state.mjs', 'export const withWebIdentityScope=(_cookie,run)=>run(); export const currentIdentityScope=()=>null'],
]);
const built = await build({ stdin: { contents: `export {CaptureHistoryJobs} from './lib/capture-history-jobs.mjs';export * as route from './app/api/web/capture/analyze/route.ts';export * as cloud from './lib/capture-cloud-server.ts';export {default as worker} from './worker-entry.mjs';export * from './lib/capture-job-control.ts';export {CAPTURE_REPORT_VERSION} from './lib/capture-report-version.ts';`, resolveDir: process.cwd(), sourcefile: 'capture-durable-test.ts' },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', plugins: [{ name: 'synthetic-only', setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      const key = /dist\/server\/index\.js$/.test(args.path) ? 'app' : args.path;
      if (mockSources.has(key)) return { path: key, namespace: 'synthetic' };
    });
    build.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: mockSources.get(args.path), loader: 'js' }));
  } }] });
const module = { exports: {} };
new Function('module', 'exports', 'require', 'fetch', built.outputFiles[0].text)(module, module.exports, require, () => assert.fail('No external network permitted'));
const { CaptureHistoryJobs, route, cloud, worker, checkpointedCaptureModel, allCaptureSteps, CaptureJobYield, CaptureJobRetry, CAPTURE_REPORT_VERSION } = module.exports;
fixture.dispatch = request => route.POST(request);

function makeStorage() {
  const values = new Map(); let alarm = null, tail = Promise.resolve();
  const storage = {
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async delete(key) { return values.delete(key); },
    async list({ prefix = '' } = {}) { return new Map([...values].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, structuredClone(value)])); },
    async getAlarm() { return alarm; }, async setAlarm(value) { alarm = value; }, async deleteAlarm() { alarm = null; },
    async transaction(run) { const work = tail.then(() => run(storage)); tail = work.catch(() => {}); return work; },
    takeAlarm() { const previous = alarm; alarm = null; return previous; },
  };
  return storage;
}
function instance(owner, restart = false) {
  if (!states.has(owner)) states.set(owner, { storage: makeStorage(), waitUntil() {} });
  if (restart || !instances.has(owner)) instances.set(owner, new CaptureHistoryJobs(states.get(owner), env));
  return instances.get(owner);
}
env.CAPTURE_HISTORY_JOBS = { idFromName: owner => owner, get: owner => instance(owner) };
const fixturePrices=new Map();
const fixturePrice=owner=>fixturePrices.get(owner);
const creditTask = (owner, id) => sql.prepare('SELECT * FROM coach_credit_tasks WHERE owner_id=? AND request_id=?').get(owner, id);
const balance = owner => sql.prepare('SELECT balance FROM coach_credit_accounts WHERE owner_id=?').get(owner).balance;
const taskCount = owner => sql.prepare('SELECT COUNT(*) AS n FROM coach_credit_tasks WHERE owner_id=?').get(owner).n;
const request = (owner, body, headers = {}) => new Request('https://fixture.invalid/api/web/capture/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://fixture.invalid', ...(owner ? { 'x-test-owner': owner } : {}), ...headers }, body: JSON.stringify(body.analysisScope==='fullHistory'&&body.expectedTotal>0&&!Object.hasOwn(body,'priceConfirmation')?{...body,priceConfirmation:fullHistoryPrice(body)}:body) });
async function start(owner, body, expected = 202) { const response = await route.POST(request(owner, body)); const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result; }
async function alarm(owner, restart = true) {
  const object = instance(owner, restart), before = calls.filter(call => call.owner === owner).length;
  states.get(owner).storage.takeAlarm(); await alarmOwner.run(owner, () => object.alarm());
  assert.ok(calls.filter(call => call.owner === owner).length - before <= 4, 'one alarm must make at most four provider calls');
  return object.status(owner);
}
async function finish(owner, limit = 12) {
  let status;
  for (let step = 0; step < limit; step++) { status = await alarm(owner); if (['done', 'error', 'removed'].includes(status.status)) return status; }
  assert.fail('Task did not reach a terminal status: ' + JSON.stringify(status));
}
async function setup(total = 675) {
  const owner = 'synthetic-' + crypto.randomUUID(), subject = crypto.randomUUID(), library = 'cl_' + crypto.randomUUID().replaceAll('-', '').repeat(2), friend = '合成人物';
  fixturePrices.set(owner,total<=500?20:total<=3000?40:total<=10000?70:100);
  await credits.ensureCreditAccount(db, owner);
  await credits.adjustCredits(db, { id: crypto.randomUUID(), ownerId: owner, actorId: 'fixture', delta: 1000, reason: '合成测试' });
  await credits.setCreditPermissions(db, { id: crypto.randomUUID(), ownerId: owner, actorId: 'fixture', features: ['analysis'], enabledUntil: Date.now() + 86400000, reason: '合成测试' });
  sql.prepare("INSERT INTO coach_subjects(id,owner_id,label,status,data,created_at,updated_at) VALUES(?,?,'合成人物','active','{}',1,1)").run(subject, owner);
  sql.prepare("INSERT INTO coach_capture_libraries(id,owner_id,account,friend,kind,subject_id,created_at,updated_at) VALUES(?,?,'synthetic-wechat',?,'chat',?,'2026-01-01','2026-01-01')").run(library, owner, friend, subject);
  const insert = sql.prepare('INSERT INTO coach_capture_records(library_id,owner_id,epoch,local_id,digest,record_json,sort_known,sort_time,updated_at) VALUES(?,?,1,?,?,?,1,?,1)');
  for (let i = 0; i < total; i++) {
    const row = { localId: 'synthetic-row-' + i, kind: 'text', senderRole: i % 2 ? 'other' : 'self', sender: i % 2 ? friend : '我', at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), text: '这是合成聊天第' + i + '条，讨论周末的安排。', imageCount: 0, source: { label: 'synthetic', method: 'wechat-local-db' } };
    insert.run(library, owner, row.localId, row.localId, JSON.stringify(row), Date.parse(row.at));
  }
  return { owner, subject, library, body: { requestId: crypto.randomUUID(), confirmed: true, kind: 'chat', analysisScope: 'fullHistory', friend, subjectId: subject, libraryId: library, expectedEpoch: 1, expectedTotal: total, records: [], relatedSnapshots: [] } };
}
async function addRelated(fixture, imageCount = 3) {
  const library = 'cl_' + crypto.randomUUID().replaceAll('-', '').repeat(2), { owner, subject, body } = fixture;
  sql.prepare("INSERT INTO coach_capture_libraries(id,owner_id,account,friend,kind,subject_id,created_at,updated_at) VALUES(?,?,'synthetic-wechat',?,'moments',?,'2026-01-01','2026-01-01')").run(library, owner, body.friend, subject);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF4cAAAAASUVORK5CYII=', 'base64');
  for (let i = 0; i < imageCount; i++) {
    const row = { localId: 'synthetic-post-' + i, kind: 'post', senderRole: 'other', sender: body.friend, at: '2026-01-02', text: '合成动态：今天去海边散步。' + i, imageCount: 1, source: { label: 'synthetic', imageType: 'visible-ui-preview' } };
    sql.prepare('INSERT INTO coach_capture_records(library_id,owner_id,epoch,local_id,digest,record_json,sort_known,sort_time,updated_at) VALUES(?,?,1,?,?,?,1,1,1)').run(library, owner, row.localId, row.localId, JSON.stringify(row));
    const bytes = Buffer.concat([png, Buffer.from(library + i)]), sha = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex'), id = 'cm_' + sha;
    sql.prepare("INSERT INTO coach_capture_media(id,owner_id,library_id,epoch,local_id,image_index,mime,name,sha256,bytes,chunk_count,status,created_at) VALUES(?,?,?,1,?,0,'image/png','synthetic',?,?,1,'ready',1)").run(id, owner, library, row.localId, sha, bytes.length);
    sql.prepare('INSERT INTO coach_capture_media_chunks VALUES(?,0,?)').run(id, bytes.toString('base64'));
  }
  body.relatedSnapshots = [{ libraryId: library, kind: 'moments', expectedEpoch: 1, expectedTotal: imageCount }];
  return library;
}
let groups = 0;
async function test(label, run) {
  providerFailure = null; failSettlementOnce = false; failSettlementsRemaining = 0; failSettlementRequest = '';
  try { await run(); groups++; console.log('PASS ' + label); }
  catch (error) { failures.push({ label, error }); console.error('FAIL ' + label + '\n' + error.stack); }
  finally { providerFailure = null; failSettlementOnce = false; failSettlementsRemaining = 0; failSettlementRequest = ''; }
}

await test('all record tiers quote without billing; stale or absent confirmation cannot charge; failures refund', async () => {
  for(const [total,amount] of [[1,20],[500,20],[501,40],[3000,40],[3001,70],[10000,70],[10001,100],[20000,100]]) {
    const data=await setup(total), before=calls.length;
    const quoted=await start(data.owner,{...data.body,confirmed:false,quoteOnly:true,priceConfirmation:null},200);
    assert.equal(quoted.quote.amount,amount);assert.equal(quoted.quote.recordCount,total);
    assert.equal(taskCount(data.owner),0);assert.equal(balance(data.owner),1000);assert.equal(calls.length,before);
    for(const priceConfirmation of [null,{version:'old',amount:20},{version:ANALYSIS_PRICE_VERSION,amount:amount-1}]){
      const rejected=await start(data.owner,{...data.body,priceConfirmation},409);
      assert.equal(rejected.code,'PRICE_CONFIRMATION_REQUIRED');assert.equal(rejected.quote.amount,amount);
      assert.equal(taskCount(data.owner),0);assert.equal(calls.length,before);
    }
    const accepted=await start(data.owner,{...data.body,priceConfirmation:{version:quoted.quote.version,amount}});
    assert.equal(accepted.creditAmount,amount);assert.equal(creditTask(data.owner,data.body.requestId).amount,amount);
    assert.equal(balance(data.owner),1000-amount);
    await instance(data.owner).purge(data.owner);
    assert.equal(balance(data.owner),1000);assert.equal(creditTask(data.owner,data.body.requestId).status,'released');
    await instance(data.owner).purge(data.owner);assert.equal(balance(data.owner),1000,'refund once');
  }
});
await test('combined sources cross tiers once; forged totals rejected; running legacy task retains agreed price',async()=>{
  const data=await setup(500);await addRelated(data,1);
  const quote=await start(data.owner,{...data.body,quoteOnly:true,priceConfirmation:null},200);
  assert.equal(quote.quote.amount,40);assert.equal(quote.quote.recordCount,501);
  const forged=await start(data.owner,{...data.body,expectedTotal:499,priceConfirmation:{version:ANALYSIS_PRICE_VERSION,amount:20}},409);
  assert.match(forged.error,/同步|变化|数量/);assert.equal(taskCount(data.owner),0);
  const requestId=crypto.randomUUID(),oldInput={...data.body,requestId};
  await credits.reserveCredits(db,{ownerId:data.owner,requestId,feature:'analysis',amount:20,fingerprint:'a'.repeat(64)});
  const storage=states.get(data.owner).storage,now=Date.now();
  await storage.put('job:'+requestId,{owner:data.owner,taskId:requestId,input:oldInput,manifest:{},fingerprint:'legacy',createdAt:now,updatedAt:now,expiresAt:now+100000,status:'queued',creditAmount:20});
  const restored=await instance(data.owner).start(data.owner,oldInput,{}, {priceConfirmation:{version:'old',amount:20}});
  assert.equal(restored.creditAmount,20);assert.equal(balance(data.owner),980);assert.equal(taskCount(data.owner),1);
  await instance(data.owner).purge(data.owner);assert.equal(balance(data.owner),1000);
});
await test('auth, ownership, internal header gate and unchanged admission cost', async () => {
  const { owner, body } = await setup();
  assert.equal((await route.POST(request(null, body))).status, 401);
  assert.equal((await route.POST(request('foreign-owner', body))).status, 404);
  for (const headers of [{ 'x-capture-job-key': env.WECHAT_CALLBACK_TOKEN }, { 'x-capture-job-owner': owner }]) assert.equal((await worker.fetch(request(owner, body, headers), env, {})).status, 403);
  assert.equal(taskCount(owner), 0); assert.equal(balance(owner), 1000);
  await assert.rejects(instance(owner).start(owner, { requestId: 'bad', analysisScope: 'fullHistory' }, {}), /参数无效/);
});
await test('published miniapp uses verified Bearer and confirmed 20 maximum; web and explicit quote cannot bypass',async()=>{
  const data=await setup(675),token='b'.repeat(64),openId='pricing-legacy-'+crypto.randomUUID();
  sql.prepare('INSERT INTO coach_miniapp_links(open_id,owner_id,created_at,updated_at) VALUES(?,?,1,1)').run(openId,data.owner);
  sql.prepare('INSERT INTO coach_miniapp_sessions(token_hash,open_id,expires_at,created_at) VALUES(?,?,?,1)')
    .run(Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex'),openId,Date.now()+60000);
  const native=(body,headers={})=>new Request('https://coach.lovetalk.love/api/miniapp/capture/analyze',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token,...headers},body:JSON.stringify(body)});
  assert.equal((await route.POST(native({...data.body,legacyMiniapp:true,openId},{authorization:'',cookie:'fake','x-open-id':openId,'x-owner-id':data.owner}))).status,401);
  for(const priceConfirmation of [null,{version:'old',amount:20}])assert.equal((await route.POST(native({...data.body,priceConfirmation}))).status,409);
  assert.equal((await route.POST(native({...data.body,confirmed:false}))).status,400);
  const forged=await route.POST(request(data.owner,{...data.body,priceConfirmation:null,legacyMiniapp:true,openId}));
  assert.equal(forged.status,409);assert.equal(taskCount(data.owner),0);
  const result=await route.POST(native(data.body));assert.equal(result.status,202);
  const accepted=await result.json();assert.equal(accepted.creditAmount,20);assert.equal(accepted.quote.version,'miniapp-confirmed-v1');
  assert.equal(balance(data.owner),980);assert.equal(creditTask(data.owner,data.body.requestId).amount,20);
  const replay=await route.POST(native(data.body));assert.equal(replay.status,202);assert.equal(taskCount(data.owner),1);assert.equal(balance(data.owner),980);
  const completed=await finish(data.owner);assert.equal(completed.status,'done',completed.error);
  assert.equal(creditTask(data.owner,data.body.requestId).status,'settled');assert.equal(balance(data.owner),980);
  const modern=await setup(675),modernOpenId='pricing-modern-'+crypto.randomUUID(),modernToken='c'.repeat(64);
  sql.prepare('INSERT INTO coach_miniapp_links(open_id,owner_id,created_at,updated_at) VALUES(?,?,1,1)').run(modernOpenId,modern.owner);
  sql.prepare('INSERT INTO coach_miniapp_sessions(token_hash,open_id,expires_at,created_at) VALUES(?,?,?,1)')
    .run(Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(modernToken))).toString('hex'),modernOpenId,Date.now()+60000);
  const quoteResponse=await route.POST(native({...modern.body,confirmed:false,quoteOnly:true},{authorization:'Bearer '+modernToken}));
  assert.equal(quoteResponse.status,200);const quote=(await quoteResponse.json()).quote;assert.equal(quote.amount,40);
  assert.equal(taskCount(modern.owner),0);assert.equal(balance(modern.owner),1000);
  const started=await route.POST(native({...modern.body,priceConfirmation:{version:quote.version,amount:quote.amount}},{authorization:'Bearer '+modernToken}));
  assert.equal(started.status,202);assert.equal((await started.json()).creditAmount,40);
  await instance(modern.owner).purge(modern.owner);assert.equal(balance(modern.owner),1000);
});

await test('real queued route completes all 675 rows in one bounded alarm and charges once', async () => {
  const { owner, body } = await setup(), before = calls.length, budgetsBefore = reserveBudgets;
  const queued = await start(owner, body); assert.equal(queued.status, 'queued'); assert.equal(calls.length, before); assert.equal(balance(owner), 1000 - fixturePrice(owner));
  const done = await alarm(owner); assert.equal(done.status, 'done', done.error); assert.equal(done.completedText, 675); assert.equal(done.result.semanticHistory.status, 'complete'); assert.equal(done.result.semanticHistory.coverage.analyzedText, 675); assert.equal(calls.length - before, 4); assert.equal(reserveBudgets - budgetsBefore, 1, 'daily budget is reserved once across alarms');
  assert.equal(creditTask(owner, body.requestId).status, 'settled'); assert.equal(taskCount(owner), 1); assert.equal(balance(owner), 1000 - fixturePrice(owner));
  assert.equal((await start(owner, body, 200)).taskId, body.requestId); assert.equal(calls.length - before, 4);
});

await test('identical snapshot reuses a saved result for free; changed snapshot creates a new task', async () => {
  const { owner, body, library } = await setup(12); await start(owner, body); const done = await finish(owner); assert.equal(done.status, 'done', done.error);
  const before = calls.length, reused = await start(owner, { ...body, requestId: crypto.randomUUID() }, 200);
  assert.equal(reused.reused, true); assert.equal(reused.taskId, body.requestId); assert.equal(taskCount(owner), 1); assert.equal(balance(owner), 1000 - fixturePrice(owner)); assert.equal(calls.length, before);
  await states.get(owner).storage.delete('job:' + body.requestId);
  instances.delete(owner);
  const permanentReuse = await start(owner, {...body, requestId:crypto.randomUUID()}, 200);
  assert.equal(permanentReuse.taskId, body.requestId, 'saved report fingerprint survives temporary task cleanup');
  assert.equal(taskCount(owner), 1); assert.equal(calls.length, before);
  sql.prepare('UPDATE coach_capture_libraries SET revision=revision+1 WHERE id=?').run(library);
  const fresh = { ...body, requestId: crypto.randomUUID() }; assert.equal((await start(owner, fresh)).taskId, fresh.requestId); assert.equal(taskCount(owner), 2); assert.equal(balance(owner), 1000 - 2 * fixturePrice(owner));
  assert.equal((await finish(owner)).status, 'done');
});

await test('syncing identical materials before another analysis preserves free saved-report reuse', async () => {
  const fixture = await setup(0), at = '2026-01-01T00:00:00.000Z';
  const library = { account: 'synthetic-resync', friend: fixture.body.friend, kind: 'chat', subjectId: fixture.subject, createdAt: at, updatedAt: at };
  const rows = Array.from({ length: 12 }, (_, i) => ({ localId: 'sync-' + i, kind: 'text', senderRole: i % 2 ? 'other' : 'self', sender: i % 2 ? '对方' : '我', at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), text: '合成同步聊天，讨论周末安排。' + i, imageCount: 0, source: { label: 'synthetic' }, firstCapturedAt: at, lastCapturedAt: at }));
  const first = await cloud.syncCloudCaptureLibrary(fixture.owner, { requestId: crypto.randomUUID(), confirmed: true, library, records: rows }, db);
  fixture.body = { ...fixture.body, libraryId: first.library.id, expectedTotal: 12 }; await start(fixture.owner, fixture.body); assert.equal((await finish(fixture.owner)).status, 'done');
  const before = calls.length;
  const synced = await cloud.syncCloudCaptureLibrary(fixture.owner, { requestId: crypto.randomUUID(), confirmed: true, libraryId: first.library.id, expectedEpoch: 1, library: { ...library, updatedAt: '2026-01-02T00:00:00.000Z' }, records: rows }, db);
  assert.equal(synced.library.revision, first.library.revision);
  const reused = await start(fixture.owner, { ...fixture.body, requestId: crypto.randomUUID() }, 200); assert.equal(reused.reused, true); assert.equal(reused.taskId, fixture.body.requestId); assert.equal(calls.length, before); assert.equal(balance(fixture.owner), 1000 - fixturePrice(fixture.owner)); assert.equal(taskCount(fixture.owner), 1);
});

await test('same-owner concurrent submissions converge while different owners remain independent', async () => {
  const a = await setup(12), b = await setup(12), bodies = [a.body, { ...a.body, requestId: crypto.randomUUID() }, { ...a.body, requestId: crypto.randomUUID(), question: 'risk' }];
  const results = await Promise.all(bodies.map(body => start(a.owner, body))); assert.equal(new Set(results.map(result => result.taskId)).size, 1); assert.equal(taskCount(a.owner), 1); assert.equal(results.filter(result => result.active).length, 2); assert.ok(results.some(result => result.active && result.sameMaterials === false));
  await start(b.owner, b.body); const completed = await Promise.all([finish(a.owner), finish(b.owner)]); assert.ok(completed.every(item => item.status === 'done'), JSON.stringify(completed.map(item => item.error)));
  assert.equal(await instance(a.owner).status(b.owner, a.body.requestId), null);
  const get = await route.GET(new Request('https://fixture.invalid/api/web/capture/analyze?taskId=' + a.body.requestId, { headers: { 'x-test-owner': b.owner } })); assert.equal((await get.json()).status, 'none');
  assert.equal(balance(a.owner), 1000 - fixturePrice(a.owner)); assert.equal(balance(b.owner), 1000 - fixturePrice(b.owner));
});

await test('changed input cannot reuse a request ID and checkpoint RPC enforces owner/token', async () => {
  const { owner, body } = await setup(); await start(owner, body);
  const job = await states.get(owner).storage.get('job:' + body.requestId);
  await assert.rejects(instance(owner).start(owner, { ...job.input, question: 'risk' }, job.manifest), /不一致/);
  await assert.rejects(instance(owner).checkpoint(owner, body.requestId, 'wrong-token', 'context'), /验证失败/);
  await assert.rejects(instance(owner).checkpoint('foreign-owner', body.requestId, env.WECHAT_CALLBACK_TOKEN, 'context'), /任务已结束/);
  await assert.rejects(instance(owner).checkpoint(owner, body.requestId, env.WECHAT_CALLBACK_TOKEN, 'not-a-hash'), /检查点无效/);
  assert.equal(taskCount(owner), 1);
});

await test('snapshot updates before execution refund without a model call', async () => {
  const { owner, body, library } = await setup(); const before = calls.length; await start(owner, body);
  sql.prepare('UPDATE coach_capture_libraries SET revision=revision+1 WHERE id=?').run(library);
  const stopped = await alarm(owner); assert.equal(stopped.status, 'error'); assert.match(stopped.error, /更新|变化/); assert.equal(calls.length, before); assert.equal(balance(owner), 1000); assert.equal(creditTask(owner, body.requestId).status, 'released');
});

await test('changed related snapshots stop before any vision provider call', async () => {
  const fixture = await setup(12), related = await addRelated(fixture); await start(fixture.owner, fixture.body);
  sql.prepare('UPDATE coach_capture_libraries SET revision=revision+1 WHERE id=?').run(related);
  const before = calls.length, result = await alarm(fixture.owner);
  assert.equal(result.status, 'error', result.error); assert.match(result.error, /更新|变化/); assert.equal(calls.length, before, 'stale related materials cannot consume image model calls'); assert.equal(balance(fixture.owner), 1000);
});

await test('image and text work share the four-call alarm budget and preserve complete source coverage', async () => {
  const fixture = await setup(); await addRelated(fixture); const before = calls.length; await start(fixture.owner, fixture.body);
  const first = await alarm(fixture.owner); assert.equal(first.status, 'queued', first.error); assert.equal(first.completedImages, 3); assert.ok([500,675].includes(first.completedText),'parallel chat/Moments calls may complete in either order within the four-call budget');
  const done = await finish(fixture.owner); assert.equal(done.status, 'done', done.error); assert.equal(done.completedImages, 3); assert.equal(done.completedText, 675); assert.equal(calls.length - before, 6);
  const segments=calls.slice(before).filter(call=>Array.isArray(call.detail.rows));
  assert.equal(segments.length,4,'three chat segments and one independent Moments evidence pass');
  const momentsSegment=segments.filter(call=>call.detail.rows.every(row=>row.sourceKind==='moments'));
  assert.equal(momentsSegment.length,1,'Moments must not compete with the last chat segment for observation slots');
  assert.equal(momentsSegment[0].detail.rows.filter(row=>row.basis==='caption').length,3);
  assert.equal(momentsSegment[0].detail.rows.filter(row=>row.basis==='visual').length,3);
  assert.equal(segments.flatMap(call=>call.detail.rows).filter(row=>row.basis==='chat-original').length,675);
  const moments = done.result.sourceCoverage.find(source => source.kind === 'moments'); assert.equal(moments.imagesAnalyzed, 3); assert.equal(moments.textRead, 3); assert.equal(done.result.semanticHistory.coverage.analyzedText, 675); assert.equal(balance(fixture.owner), 1000 - fixturePrice(fixture.owner));
});

await test('snapshot update after a yield refunds; a new request reuses unchanged finished segments', async () => {
  const { owner, body, library } = await setup(1250); await start(owner, body); const before = calls.length; assert.equal((await alarm(owner)).completedText, 1000);
  sql.prepare('UPDATE coach_capture_libraries SET revision=revision+1 WHERE id=?').run(library);
  const stopped = await alarm(owner); assert.equal(stopped.status, 'error'); assert.equal(balance(owner), 1000); assert.equal(calls.length - before, 4);
  const retry = { ...body, requestId: crypto.randomUUID() }; await start(owner, retry); const result = await finish(owner); assert.equal(result.status, 'done', result.error); assert.equal(result.reusedSteps, 4); assert.equal(calls.length - before, 6); assert.equal(balance(owner), 1000 - fixturePrice(owner)); assert.equal(creditTask(owner, body.requestId).status, 'released'); assert.equal(creditTask(owner, retry.requestId).status, 'settled');
});

await test('provider failures retain checkpoints, refund exactly once and retry only unfinished work', async () => {
  const { owner, body } = await setup(1250); await start(owner, body); await alarm(owner); const cached = (await instance(owner).status(owner)).completedText; assert.equal(cached, 1000);
  providerFailure = () => { throw Error('SYNTHETIC_PROVIDER_FAILURE'); };
  let last; for (let i = 0; i < 4; i++) { last = await alarm(owner); assert.equal(last.completedText, 1000); assert.equal(last.status, i < 3 ? 'retrying' : 'error', last.error); }
  assert.equal(balance(owner), 1000); assert.equal(creditTask(owner, body.requestId).status, 'released'); await alarm(owner); assert.equal(balance(owner), 1000, 'repeat alarm cannot refund twice');
  providerFailure = null; const before = calls.length, retry = { ...body, requestId: crypto.randomUUID() }; await start(owner, retry); const done = await finish(owner);
  assert.equal(done.status, 'done', done.error); assert.equal(done.reusedSteps, 4); assert.equal(calls.length - before, 2); assert.equal(balance(owner), 1000 - fixturePrice(owner));
});

await test('reimport epoch and changed question invalidate checkpoint reuse', async () => {
  const { owner, body, library } = await setup(12); await start(owner, body); assert.equal((await finish(owner)).status, 'done');
  sql.prepare('UPDATE coach_capture_libraries SET epoch=2,revision=revision+1 WHERE id=?').run(library); sql.prepare('UPDATE coach_capture_records SET epoch=2 WHERE library_id=?').run(library);
  const reimport = { ...body, requestId: crypto.randomUUID(), expectedEpoch: 2 }, before = calls.length; await start(owner, reimport); const reimported = await finish(owner);
  assert.equal(reimported.status, 'done', reimported.error); assert.equal(reimported.reusedSteps, 0); assert.equal(calls.length - before, 2);
  const changed = { ...reimport, requestId: crypto.randomUUID(), question: 'risk' }, questionBefore = calls.length; await start(owner, changed); const result = await finish(owner);
  assert.equal(result.status, 'done', result.error); assert.equal(result.reusedSteps, 0); assert.equal(calls.length - questionBefore, 2); assert.equal(balance(owner), 1000 - 3 * fixturePrice(owner));
});

await test('failed durable admission refunds the reservation and cannot execute the abandoned ID', async () => {
  const { owner, body } = await setup(12), object = instance(owner), storage = states.get(owner).storage, transaction = storage.transaction;
  storage.transaction = async () => { throw Error('SYNTHETIC_STORAGE_FAILURE'); };
  const response = await route.POST(request(owner, body)); assert.equal(response.status, 503); assert.equal(balance(owner), 1000); assert.equal(creditTask(owner, body.requestId).status, 'released'); assert.equal(await object.status(owner, body.requestId), null);
  storage.transaction = transaction;
  const again = await route.POST(request(owner, body)); assert.ok(!again.ok); assert.equal(balance(owner), 1000);
  await start(owner, { ...body, requestId: crypto.randomUUID() }); assert.equal((await finish(owner)).status, 'done'); assert.equal(balance(owner), 1000 - fixturePrice(owner));
});

await test('malformed model outputs never become checkpoints or charged partial reports', async () => {
  const { owner, body } = await setup(12); providerFailure = () => '{malformed-json'; await start(owner, body); const result = await finish(owner);
  assert.equal(result.status, 'error', result.error); assert.equal((await states.get(owner).storage.list({ prefix: 'step:' })).size, 0); assert.equal(balance(owner), 1000); assert.equal(creditTask(owner, body.requestId).status, 'released');
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM coach_saved_reports WHERE id=? AND status='done'").get(body.requestId).n, 0);
});

await test('real route serializes cited affinity, chronological changes, useful next steps and complete Moments fixtures',async()=>{
  const data=await setup(210),momentsId=await addRelated(data),before=calls.length;
  const statements={1:'我记得你周末喜欢散步，要不要找个时间一起？',3:'你上次说工作有点累，今天有没有好一些？',5:'我最近也开始每天走一段路，觉得能把心静下来。',181:'下周我们一起走海边那段吧，周六下午两点可以吗？',183:'那就周六两点，到了我发消息给你。',185:'昨天一起走路挺开心的，下次再约。'};
  for(const item of sql.prepare('SELECT local_id,record_json FROM coach_capture_records WHERE library_id=?').all(data.library)){
    const row=JSON.parse(item.record_json),i=Number(row.localId.split('-').at(-1));
    if(statements[i])row.text=statements[i];
    if(i>=181)row.at='2026-01-10T10:'+String(i-181).padStart(2,'0')+':00.000Z';
    if(i>=194){row.kind='other';row.text='[语音未转写]';}
    sql.prepare('UPDATE coach_capture_records SET record_json=?,sort_time=? WHERE library_id=? AND local_id=?').run(JSON.stringify(row),Date.parse(row.at),data.library,row.localId);
  }
  providerFailure=(messages,options)=>{
    const detail=JSON.parse(typeof messages.at(-1).content==='string'?messages.at(-1).content:messages.at(-1).content[0].text);
    if(options?.vision)return JSON.stringify({images:detail.images.map(image=>({mediaId:image.mediaId,readable:true,observation:'图片可见海边步道，仅能判断可见场景。'}))});
    if(detail.rows){const selected=detail.rows.filter(row=>Object.values(statements).includes(row.text)||row.sourceKind==='moments').slice(0,8);return JSON.stringify({sentenceReadings:syntheticSentenceReadings(detail),findings:selected.map((row,index)=>({claim:row.sourceKind==='moments'?`动态或图片中的步道线索${index}`:`原话中的具体互动${index}`,confidence:'中',alternative:'普通朋友相处仍是合理解释。',evidence:[{sourceId:row.sourceId,quote:row.text}]}))});}
    const chat=detail.findings.filter(item=>item.evidence.some(source=>!source.basis)),moments=detail.findings.filter(item=>item.evidence.some(source=>source.sourceKind==='moments'));
    const earliest=chat.find(item=>item.evidence.some(source=>source.quote===statements[1])),latest=chat.find(item=>item.evidence.some(source=>source.quote===statements[185]));
    const cite=(chat[0]||moments[0]).id,actionSource=(latest||moments[0]||chat[0]).id;
    const dimensions=chat.length?['initiative','engagement','care','openness','intimacy','action'].map((key,i)=>({key,level:i===4?2:i===5?4:3,status:i===4?'ambiguous':'clear',reason:i===4?'原话表达一起活动开心，仍不能区分友情与恋爱意愿。':'这组原话包含具体关心、分享或相处安排。',evidenceIds:[chat[Math.min(i,chat.length-1)].id]})):[];
    return JSON.stringify({riskAssessment:{status:'no_supported_signal',summary:'这些原话尚未出现足以核实的风险信号。',items:[]},profileInsights:[{subject:'other',dimension:'生活与兴趣',reading:'对方多次提到散步，从一般话题转为具体路线与活动体验，可作为自然聊天切入点，不能由此确定关系意愿。',evidenceIds:[cite],alternative:'也可能是普通朋友之间的共同兴趣。'}],summary:chat.length?'从聊散步到约定和回顾，实际接触有了推进，恋爱意愿尚待确认。':'动态呈现了散步活动，可从具体路线自然聊起。',explanation:chat.length?'早些原话提到一起散步，后面出现了具体时间与活动回顾，实际相处的证据比单纯聊得热闹更充分。\n\n不过，开心地一起活动也可能是朋友相处。对方还没有明确表达恋爱意愿，下一步适合回应具体体验，不宜据此追问关系承诺。':'配文和可见图片都涉及海边步道，支持把散步作为当前可聊的话题。公开动态无法证明对方对用户的态度，也不能据此判断收入、性格或恋爱意愿。',summaryEvidenceIds:[cite],affinityAssessment:{dimensions,unavailableReason:chat.length?'':'本次只有朋友圈，没有双方聊天，不能评价对方对你的好感。'},affinitySignals:chat.length?[{direction:'support',signal:'安排从提议走到具体时间',meaning:'具体安排和活动回顾支持愿意继续接触，但尚不等于恋爱确认。',evidenceIds:[latest.id],alternative:'也可能是舒适的朋友活动。'}]:[],changeInsights:earliest&&latest?[{title:'从讨论活动到出现活动回顾',before:{reading:'之前还在提出一起散步的想法。',evidenceIds:[earliest.id]},after:{reading:'之后出现具体安排，并回顾一起活动的体验。',evidenceIds:[latest.id]},meaning:'接触已经不只停留在口头提议，下一次可顺着共同体验自然推进。',alternative:'朋友之间也可能有同样的活动安排，尚不能确认恋爱意图。'}]:[],actionPlan:{goal:'connection',rationale:chat.length?'已有共同活动和对方愿意继续约的原话。':'已有具体动态话题，可从公开内容开场。',steps:[{title:chat.length?'回应共同体验':'从具体动态开场',action:chat.length?'回应散步时你也喜欢的一个细节，再接住下一次邀约。':'聊动态中的步道路线，先看看对方是否愿意展开。',why:chat.length?'对方已经回顾体验并提到下次，回应这件事比另起无关话题自然。':'配文提供了具体话题，不需要根据照片猜测私人情况。',evidenceIds:[actionSource],observeFor:'下一轮与这个话题有关的真实互动',advanceWhen:'对方也延续话题并愿意共同确认安排时再推进。',stopWhen:'对方明确拒绝或表示不想继续，就停止推进。',reply:chat.length?'我也挺开心的，海边那段走起来很舒服，下次再一起走呀。':'看到你分享海边步道，那段路走起来感觉怎么样？'}]},...(moments.length?{sourceInsights:{moments:{summary:'动态配文记录了海边散步，图片可见步道场景，可以作为生活话题线索。',evidenceIds:[moments[0].id],unknowns:['无法判断是否与用户同行'],...(chat.length?{crossSource:{summary:'聊天和动态都出现散步话题，但日期不同，不能断定是同一次活动。',evidenceIds:[cite,moments[0].id]}}:{})}}}:{})});
  };
  await start(data.owner,data.body);const joint=await finish(data.owner);assert.equal(joint.status,'done',joint.error);
  assert.equal(joint.result.analysisVersion,CAPTURE_REPORT_VERSION);assert.equal(joint.result.affinity.contextCount,194);assert.equal(typeof joint.result.affinity.value,'number');assert.equal(joint.result.affinity.dimensions.length,6);
  assert.equal(joint.result.recentSentenceAnalysis.sampleCount,12);assert.equal(joint.result.recentSentenceAnalysis.totalReadable,194);assert.equal(joint.result.recentSentenceAnalysis.annotations[0].emotion[0].probability,.8);assert.equal(joint.result.recentSentenceAnalysis.annotations[0].emotion[0].label,"平静");assert.ok(joint.result.recentSentenceAnalysis.annotations.every(item=>Array.isArray(item.emotion)&&Array.isArray(item.intent)));assert.equal(joint.result.semanticHistory.changeInsights.length,1);assert.ok(joint.result.semanticHistory.actionPlan.steps[0].reply);assert.ok(joint.result.semanticHistory.sourceInsights.moments.crossSource);
  assert.equal(joint.result.sourceCoverage.find(source=>source.kind==='chat').total,210);assert.equal(joint.result.sourceCoverage.find(source=>source.kind==='chat').textRead,194);
  assert.equal(joint.result.sourceCoverage.find(source=>source.kind==='moments').total,3);assert.equal(calls.slice(before).filter(call=>call.phase==='segments').flatMap(call=>call.detail.rows).filter(row=>row.basis==='chat-original').length,194);
  const folder=process.env.REPORT_ROUTE_FIXTURE_DIR||'outputs/report-route-fixtures';mkdirSync(folder,{recursive:true});writeFileSync(folder+'/full-person.json',JSON.stringify(joint.result,null,2));
  const chatOnlyBody={...data.body,requestId:crypto.randomUUID(),relatedSnapshots:[]};await start(data.owner,chatOnlyBody);const chatOnly=await finish(data.owner);assert.equal(chatOnly.status,'done',chatOnly.error);assert.equal(chatOnly.result.sourceCoverage.length,1);assert.match(chatOnly.result.captureMediaNote,/尚未提供朋友圈/);writeFileSync(folder+'/chat-only-210-194.json',JSON.stringify(chatOnly.result,null,2));
  const momentsBody={...data.body,requestId:crypto.randomUUID(),kind:'moments',libraryId:momentsId,expectedTotal:3,relatedSnapshots:[]};await start(data.owner,momentsBody);const momentOnly=await finish(data.owner);assert.equal(momentOnly.status,'done',momentOnly.error);
  assert.equal(momentOnly.result.kind,'profile');assert.equal(momentOnly.result.captureKind,'moments');assert.equal(momentOnly.result.chatActivity,undefined);assert.equal(momentOnly.result.affinity,undefined);assert.equal(momentOnly.result.sourceCoverage.length,1);assert.equal(momentOnly.result.sourceCoverage[0].kind,'moments');assert.equal(momentOnly.result.sourceCoverage[0].textRead,3);assert.equal(momentOnly.result.sourceCoverage[0].imagesAnalyzed,3);assert.ok(momentOnly.result.semanticHistory.sourceInsights.moments);writeFileSync(folder+'/moments-only.json',JSON.stringify(momentOnly.result,null,2));
});

await test('risk goal keeps named subjects, early warnings, later clarification and conditional next steps',async()=>{
  const data=await setup(10),before=calls.length;data.body.question='risk';
  sql.prepare('UPDATE coach_subjects SET label=? WHERE id=?').run('合成对象林澈',data.subject);
  const words={0:'我希望长期稳定地相处。',1:'把验证码发给我。',2:'我不会提供验证码，我会自己操作。',3:'不用给我验证码了，你自己在官方页面操作。刚才是我说法不合适。',5:'我只想短期交往。',6:'我期待长期关系，想知道我们的目标能否一致。',7:'我现在仍然只想短期交往。'};
  for(const item of sql.prepare('SELECT local_id,record_json FROM coach_capture_records WHERE library_id=?').all(data.library)){
    const row=JSON.parse(item.record_json),index=Number(row.localId.split('-').at(-1));if(words[index])row.text=words[index];row.at=`2026-01-${String(index+1).padStart(2,'0')}T10:00:00.000Z`;
    sql.prepare('UPDATE coach_capture_records SET record_json=?,sort_time=? WHERE library_id=? AND local_id=?').run(JSON.stringify(row),Date.parse(row.at),data.library,row.localId);
  }
  let synthesisCalls=0;
  providerFailure=messages=>{
    const detail=JSON.parse(messages.at(-1).content);
    assert.equal(detail.participantLabels.self,'你');assert.equal(detail.participantLabels.other,'合成对象林澈');
    if(detail.rows)return JSON.stringify({findings:detail.rows.filter(row=>Object.values(words).includes(row.text)).map(row=>({subject:row.role,claim:`${row.role==='self'?'你':'林澈'}的具体表达：${row.text}`,confidence:'中',alternative:'只根据这句表达不能确定未记录的事实。',evidence:[{sourceId:row.sourceId,quote:row.text}]}))});
    const anchors=detail.findings.filter(item=>item.id.startsWith('risk:'));assert.equal(anchors.length,2);
    const code=anchors.find(item=>item.evidence.some(source=>source.quote==='把验证码发给我。')),expectation=anchors.find(item=>item!==code);
    const clarification=detail.findings.find(item=>item.evidence.some(source=>source.quote===words[3]));
    const base={summary:'林澈的验证码要求后来有明确更正，但短期关系期待仍与你的长期期待不同。',explanation:'验证码要求发生在一月二日；你拒绝后，林澈在一月四日明确说由你自己在官方页面操作，因此不能只展示最早一句就认定当前仍在索取。\n\n关系期待是另一件事。林澈后来仍表达短期交往，而你明确希望长期稳定。需要把这个实际差异问清楚，不能用更主动的投入替代双方目标一致。',summaryEvidenceIds:[code.id,expectation.id],affinityAssessment:{dimensions:[],unavailableReason:'这些原话主要涉及边界与关系目标，缺少足够互动维度合成好感参考度。'},action:'先确认双方现在是否接受相同的关系目标。',actionEvidenceIds:[expectation.id],actionPlan:{goal:'risk',rationale:'已经存在明确的关系目标差异。',steps:[{title:'先确认目标',action:'说明你希望长期稳定，询问林澈现在是否愿意朝同样的方向了解。',why:'林澈明确表达短期，而你的期待是长期；这个差异影响你是否继续投入。',evidenceIds:[expectation.id],observeFor:'下一次双方认真讨论关系时',advanceWhen:'双方明确愿意了解长期相处后，再结合实际行动决定。',stopWhen:'林澈仍只接受短期，而你不能接受时停止增加投入。',reply:'我希望的是长期稳定的相处。你现在也愿意往这个方向了解吗？'}]}};
    if(++synthesisCalls===1)return JSON.stringify(base); // Must retry the missing goal-specific interpretation.
    return JSON.stringify({...base,riskAssessment:{status:'signals',summary:'账号边界要保留，关系目标差异需要单独确认。',items:[{title:'验证码要求后来已更正',subject:'other',meaning:'林澈曾要求你提供验证码，后来改为你自行操作。两段原话需要一起看，同时保持账号边界。',evidenceIds:[code.id],resolution:{status:'clarified',reading:'一月四日林澈明确更正为你在官方页面自行操作；这不能替代你独立核实渠道。',evidenceIds:[clarification.id]},alternative:'可能是当时对流程表达不清；更正后的说法仍需和实际操作一致。',verify:{action:'只在自己确认的官方页面操作，不发送验证码。',question:'我会在官方页面自行操作，你确认不需要我的验证码，对吗？',outcomes:[{when:'林澈接受你自行操作',nextStep:'保留账号边界，自行核实流程。'},{when:'林澈再次索取验证码',nextStep:'停止操作并保留记录。'}]}},{title:'短期目标与你的长期期待不一致',subject:'other',meaning:'林澈明确表达短期交往，你明确想要长期。短期本身不是欺骗，但它与你继续投入的前提不同。',evidenceIds:[expectation.id],resolution:{status:'unresolved',reading:'较晚原话仍表示短期，目前没有双方达成长期共识的记录。',evidenceIds:[]},alternative:'目标可能随相处阶段改变，但可能改变不能当作已经承诺。',verify:{action:'直接确认当前目标，再决定自己的投入。',question:'我想了解长期稳定的可能，你现在愿意往这个方向相处吗？',outcomes:[{when:'明确愿意了解长期关系',nextStep:'结合之后的具体投入观察，暂不把回答当作承诺兑现。'},{when:'仍只接受短期',nextStep:'如果你不能接受短期，就停止追加投入。'}]}}]}});
  };
  await start(data.owner,data.body);const done=await finish(data.owner);assert.equal(done.status,'done',done.error);
  assert.equal(synthesisCalls,2);assert.equal(calls.slice(before).filter(call=>call.phase==='segments').length,1,'incomplete risk synthesis reuses the verified segment');
  assert.equal(done.result.analysisQuestion,'risk');assert.equal(done.result.participants.other.label,'合成对象林澈');assert.equal(done.result.semanticHistory.riskAssessment.items.length,2);
  assert.equal(done.result.semanticHistory.riskAssessment.items[0].resolution.status,'clarified');assert.equal(done.result.semanticHistory.riskAssessment.items[0].timeRange.start,'2026-01-02');
  assert.equal(done.result.semanticHistory.actionPlan.actor,'self');assert.equal(done.result.affinity.direction,'otherToSelf');assert.equal(balance(data.owner),1000-fixturePrice(data.owner));
  assert.ok(done.result.semanticHistory.riskAssessment.items.every(item=>item.subject==='other'&&item.verify.outcomes.length===2));
  const folder=process.env.REPORT_ROUTE_FIXTURE_DIR||'outputs/report-route-fixtures';mkdirSync(folder,{recursive:true});writeFileSync(folder+'/risk-person.json',JSON.stringify(done.result,null,2));
});

await test('summary-only synthesis retries without losing completed evidence or charging a partial report', async()=>{
  const {owner,body}=await setup(),before=calls.length;await start(owner,body);
  providerFailure=messages=>{
    const detail=JSON.parse(messages.at(-1).content);
    if(detail.rows)return JSON.stringify({findings:[{claim:'后段讨论具体安排',evidence:[{sourceId:detail.rows[0].sourceId,quote:detail.rows[0].text.slice(0,30)}]}]});
    return JSON.stringify({summary:'尚需确认安排。',summaryEvidenceIds:[detail.findings[0].id]});
  };
  const retrying=await alarm(owner);assert.equal(retrying.status,'retrying');assert.equal(retrying.completedText,675);assert.equal(retrying.phase,'synthesis');assert.match(retrying.error,/重试/);
  const checkpoints=await states.get(owner).storage.list({prefix:'step:'});assert.equal(checkpoints.size,3);assert.ok([...checkpoints.values()].every(step=>step.phase==='segments'));
  assert.equal(creditTask(owner,body.requestId).status,'reserved');assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM coach_saved_reports WHERE id=? AND status='done'").get(body.requestId).n,0);
  providerFailure=null;const done=await finish(owner);assert.equal(done.status,'done',done.error);assert.ok(done.result.semanticHistory.explanation);
  assert.equal(calls.slice(before).filter(call=>call.phase==='segments').length,3,'verified segments must not run again after sparse synthesis');
  assert.equal(calls.slice(before).filter(call=>call.phase==='synthesis').length,2);assert.equal(balance(owner),1000-fixturePrice(owner));assert.equal(creditTask(owner,body.requestId).status,'settled');
});

await test('standalone full Moments reads beyond ten posts and accounts captions separately from images',async()=>{
  const data=await setup(2),momentsId=await addRelated(data,17);
  const body={...data.body,requestId:crypto.randomUUID(),kind:'moments',libraryId:momentsId,expectedTotal:17,relatedSnapshots:[]};
  const before=calls.length;await start(data.owner,body);const done=await finish(data.owner);assert.equal(done.status,'done',done.error);
  assert.equal(done.result.sourceCoverage[0].total,17);assert.equal(done.result.sourceCoverage[0].textRead,17);assert.equal(done.result.sourceCoverage[0].imagesAnalyzed,17);
  const rows=calls.slice(before).filter(call=>call.phase==='segments').flatMap(call=>call.detail.rows);
  assert.equal(rows.filter(row=>row.basis==='caption').length,17);assert.equal(rows.filter(row=>row.basis==='visual').length,17);assert.equal(rows.filter(row=>row.basis==='chat-original').length,0);
  assert.equal(done.completedText,0);assert.equal(done.completedCaptions,17);assert.equal(done.completedImages,17);assert.equal(done.result.semanticHistory.affinity.value,null);
  assert.equal(creditTask(data.owner,body.requestId).amount,credits.CREDIT_PRICES.historySmall,'standalone Moments charges the displayed profile price');
  assert.equal(balance(data.owner),1000-credits.CREDIT_PRICES.historySmall);
  const same=await start(data.owner,{...body,requestId:crypto.randomUUID()},200);assert.equal(same.status,'done');assert.equal(balance(data.owner),1000-credits.CREDIT_PRICES.historySmall,'unchanged Moments reuse the report without charging again');
});

await test('persistent Moments synthesis failure refunds without publishing a generic partial report',async()=>{
  const data=await setup(2),momentsId=await addRelated(data,3);
  const body={...data.body,requestId:crypto.randomUUID(),kind:'moments',libraryId:momentsId,expectedTotal:3,relatedSnapshots:[]};
  providerFailure=(messages,options)=>{
    const detail=JSON.parse(typeof messages.at(-1).content==='string'?messages.at(-1).content:messages.at(-1).content[0].text);
    if(options?.vision)return JSON.stringify({images:detail.images.map(image=>({mediaId:image.mediaId,readable:true,observation:'动态预览中可见海边步道。'}))});
    if(detail.rows)return JSON.stringify({findings:detail.rows.slice(0,2).map(row=>({claim:'已核对动态线索。',confidence:'低',alternative:'公开记录仍需结合实际沟通。',evidence:[{sourceId:row.sourceId,quote:row.text}]}))});
    throw Error('SYNTHETIC_SYNTHESIS_TIMEOUT');
  };
  await start(data.owner,body);
  const failed=await finish(data.owner);
  assert.equal(failed.status,'error');
  assert.equal(balance(data.owner),1000);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM coach_saved_reports WHERE id=? AND status='done'").get(body.requestId).n,0);
  const readCalls=calls.filter(call=>call.owner===data.owner&&call.phase!=='synthesis').length;
  providerFailure=null;
  await start(data.owner,{...body,requestId:crypto.randomUUID()});
  const complete=await finish(data.owner);
  assert.equal(complete.status,'done',complete.error);
  assert.equal(complete.result.semanticHistory.status,'complete');
  assert.equal(complete.completedImages,3,'cached image work remains visible in the retry progress');
  assert.equal(calls.filter(call=>call.owner===data.owner&&call.phase!=='synthesis').length,readCalls,'retry reuses every completed image and segment');
});

await test('omitted imported Moments interpretation retries rather than delivering a chat-only complete report',async()=>{
  const data=await setup(2);await addRelated(data,1);await start(data.owner,data.body);
  providerFailure=(messages,options)=>{const content=messages.at(-1).content,detail=JSON.parse(typeof content==='string'?content:content[0].text);if(options?.vision)return JSON.stringify({images:detail.images.map(image=>({mediaId:image.mediaId,readable:true,observation:'可见步道'}))});if(detail.rows)return JSON.stringify({findings:detail.rows.slice(0,1).map(row=>({claim:'已核对动态原文',evidence:[{sourceId:row.sourceId,quote:row.text}]}))});return JSON.stringify({summary:'只有聊天概括',explanation:'有交流但尚需核实。',summaryEvidenceIds:[detail.findings[0].id],affinityAssessment:{dimensions:[],unavailableReason:'互动维度不足'}});};
  const retrying=await alarm(data.owner);assert.equal(retrying.status,'retrying');assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM coach_saved_reports WHERE id=? AND status='done'").get(data.body.requestId).n,0);
  providerFailure=null;const done=await finish(data.owner);assert.equal(done.status,'done',done.error);assert.ok(done.result.semanticHistory.sourceInsights.moments);assert.equal(done.result.sourceCoverage.find(source=>source.kind==='moments').textRead,1);
});

await test('photos-only Moments preserve image coverage without fabricating captions or chat statistics',async()=>{
  const data=await setup(2),momentsId=await addRelated(data,1);
  const row=JSON.parse(sql.prepare('SELECT record_json FROM coach_capture_records WHERE library_id=?').get(momentsId).record_json);row.text='[图片]';sql.prepare('UPDATE coach_capture_records SET record_json=? WHERE library_id=?').run(JSON.stringify(row),momentsId);
  const body={...data.body,requestId:crypto.randomUUID(),kind:'moments',libraryId:momentsId,expectedTotal:1,relatedSnapshots:[]};await start(data.owner,body);const done=await finish(data.owner);
  assert.equal(done.status,'done',done.error);assert.equal(done.completedText,0);assert.equal(done.completedCaptions,0);assert.equal(done.completedImages,1);assert.equal(done.result.sourceCoverage[0].textRead,0);assert.equal(done.result.sourceCoverage[0].imagesAnalyzed,1);
  assert.equal(done.result.chatActivity,undefined);assert.equal(done.result.affinity,undefined);assert.equal(done.result.semanticHistory.affinity.value,null);assert.ok(done.result.semanticHistory.sourceInsights.moments);assert.ok(done.result.semanticHistory.findings.every(finding=>finding.evidence.every(source=>source.basis==='visual')));
});

await test('in-flight v5 report completes with original 20-credit agreement and fingerprint after v6 rollout',async()=>{
  const {owner,body}=await setup(675);await start(owner,body);const storage=states.get(owner).storage;
  const legacy=await storage.get('job:'+body.requestId);await instance(owner).purge(owner);assert.equal(balance(owner),1000);
  const taskId=crypto.randomUUID();legacy.taskId=taskId;legacy.input.requestId=taskId;legacy.manifest.analysisVersion=5;
  legacy.creditAmount=20;legacy.priceQuote={version:'legacy-v5',amount:20};legacy.createdAt=Date.now();legacy.updatedAt=Date.now();
  const {requestId,...scope}=legacy.input;
  legacy.fingerprint=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({scope,manifest:legacy.manifest})))).toString('hex');
  await credits.reserveCredits(db,{ownerId:owner,requestId:taskId,feature:'analysis',amount:20,fingerprint:legacy.fingerprint});
  await storage.put('job:'+taskId,legacy);await storage.setAlarm(Date.now()+1);
  const resumed=await start(owner,{...body,requestId:taskId,priceConfirmation:null});
  assert.equal(resumed.creditAmount,20);assert.equal(balance(owner),980);
  const done=await finish(owner);assert.equal(done.status,'done',done.error);assert.equal(done.result.analysisVersion,5);
  assert.equal(done.result.analysisFingerprint,legacy.fingerprint);assert.equal(creditTask(owner,taskId).amount,20);
  assert.equal(creditTask(owner,taskId).status,'settled');assert.equal(balance(owner),980);
});
await test('an older running report contract stops before model work and releases its reservation once',async()=>{
  const {owner,body}=await setup(2);await start(owner,body);const storage=states.get(owner).storage,job=await storage.get('job:'+body.requestId);job.manifest.analysisVersion=1;await storage.put('job:'+body.requestId,job);
  const before=calls.length,done=await alarm(owner);assert.equal(done.status,'error');assert.match(done.error,/分析方式已更新/);assert.equal(calls.length,before);assert.equal(balance(owner),1000);assert.equal(creditTask(owner,body.requestId).status,'released');
  await alarm(owner);assert.equal(balance(owner),1000);assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM coach_saved_reports WHERE id=? AND status='done'").get(body.requestId).n,0);
});

await test('persistent ungrounded synthesis refunds and never caches or saves a complete report',async()=>{
  const {owner,body}=await setup(),before=calls.length;await start(owner,body);
  providerFailure=messages=>{
    const detail=JSON.parse(messages.at(-1).content);
    return JSON.stringify(detail.rows?{findings:[{claim:'后段讨论安排',evidence:[{sourceId:detail.rows[0].sourceId,quote:detail.rows[0].text.slice(0,30)}]}]}:{summary:'没有可核对的概括',explanation:'虽然文字齐全，但引用是伪造的。',summaryEvidenceIds:['fake-evidence']});
  };
  const failed=await finish(owner);assert.equal(failed.status,'error');assert.equal(failed.completedText,675);assert.equal(balance(owner),1000);assert.equal(creditTask(owner,body.requestId).status,'released');
  assert.equal(calls.slice(before).filter(call=>call.phase==='segments').length,3);assert.equal(calls.slice(before).filter(call=>call.phase==='synthesis').length,4);
  const checkpoints=await states.get(owner).storage.list({prefix:'step:'});assert.equal(checkpoints.size,3);assert.ok([...checkpoints.values()].every(step=>step.phase==='segments'));
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM coach_saved_reports WHERE id=? AND status='done'").get(body.requestId).n,0);
  const count=calls.length;await alarm(owner);assert.equal(calls.length,count);assert.equal(balance(owner),1000,'refund and terminal retry stay idempotent');
});

await test('crash after durable completion but before settlement settles without repeating model work', async () => {
  const { owner, body } = await setup(12); await start(owner, body); failSettlementOnce = true;
  assert.equal((await alarm(owner)).status, 'done');
  const job = await states.get(owner).storage.get('job:' + body.requestId); assert.equal(job.status, 'done'); assert.ok(!job.creditFinished); assert.equal(creditTask(owner, body.requestId).status, 'reserved');
  assert.ok(job.nextSettlementAt > Date.now()); assert.ok(await states.get(owner).storage.getAlarm());
  job.nextSettlementAt=Date.now()-1;await states.get(owner).storage.put('job:'+body.requestId,job);
  const before = calls.length; assert.equal((await alarm(owner)).status, 'done'); assert.equal(calls.length, before); assert.equal(creditTask(owner, body.requestId).status, 'settled'); assert.equal(balance(owner), 1000 - fixturePrice(owner));
});

await test('ledger outage beyond platform retry budget remains scheduled and GET repairs an exhausted alarm', async () => {
  const {owner,body}=await setup(12);await start(owner,body);failSettlementsRemaining=8;
  const storage=states.get(owner).storage;let providerCount;
  for(let attempt=0;attempt<8;attempt++){
    if(attempt){const job=await storage.get('job:'+body.requestId);job.nextSettlementAt=Date.now()-1;await storage.put('job:'+body.requestId,job);}
    const result=await alarm(owner);assert.equal(result.status,'done');assert.equal(result.creditTaskStatus,'reserved');assert.equal(result.creditSettlementPending,true);
    const job=await storage.get('job:'+body.requestId);assert.equal(job.creditFinished,false);assert.equal(job.settlementAttempts,attempt+1);assert.ok(job.nextSettlementAt>Date.now());assert.ok(job.nextSettlementAt<=Date.now()+300000);assert.ok(await storage.getAlarm(),'each failed ledger attempt durably schedules another alarm');
    providerCount ??=calls.length;assert.equal(calls.length,providerCount,'ledger retry never calls a model');
  }
  const job=await storage.get('job:'+body.requestId);job.nextSettlementAt=Date.now()-1;await storage.put('job:'+body.requestId,job);storage.takeAlarm();assert.equal(await storage.getAlarm(),null);
  const response=await route.GET(new Request('https://fixture.invalid/api/web/capture/analyze?taskId='+body.requestId,{headers:{'x-test-owner':owner}}));
  assert.equal(response.status,200);assert.equal((await response.json()).creditTaskStatus,'reserved');assert.ok(await storage.getAlarm(),'GET restores terminal unsettled task after missing/exhausted alarm');
  const done=await alarm(owner);assert.equal(done.creditTaskStatus,'settled');assert.equal(done.creditSettlementPending,false);assert.equal(calls.length,providerCount);assert.equal(balance(owner),1000-fixturePrice(owner));assert.equal(taskCount(owner),1);
});

await test('cron-released completion records the real ledger outcome and does not block the same owner next task', async () => {
  const {owner,body}=await setup(12);body.requestId='00000000-0000-4000-8000-000000000001';await start(owner,body);failSettlementOnce=true;await alarm(owner);
  const storage=states.get(owner).storage,old=await storage.get('job:'+body.requestId);assert.equal(old.creditFinished,false);
  await credits.finishCreditTask(db,owner,body.requestId,false);assert.equal(balance(owner),1000,'same terminal transition used by expiration cron refunds once');
  old.nextSettlementAt=Date.now()-1;await storage.put('job:'+body.requestId,old);
  const next={...body,requestId:'ffffffff-ffff-4fff-8fff-ffffffffffff',question:'next'};await start(owner,next);
  await alarm(owner);const prior=await instance(owner).status(owner,body.requestId),done=await instance(owner).status(owner,next.requestId);
  assert.equal(prior.status,'done');assert.equal(prior.creditTaskStatus,'released');assert.equal(prior.creditSettlementPending,false);assert.match(prior.creditSettlementIssue,/已退回/);assert.ok(prior.result,'delivered report remains available');
  assert.equal(done.status,'done');assert.equal(done.creditTaskStatus,'settled');assert.equal(creditTask(owner,body.requestId).status,'released');assert.equal(creditTask(owner,next.requestId).status,'settled');assert.equal(balance(owner),1000-fixturePrice(owner));assert.equal(taskCount(owner),2,'no replacement charge for the cron-released task');
});

await test('one unavailable settlement does not prevent another task for the same owner from completing', async () => {
  const {owner,body}=await setup(12);body.requestId='00000000-0000-4000-8000-000000000002';await start(owner,body);failSettlementsRemaining=10;failSettlementRequest=body.requestId;await alarm(owner);
  const storage=states.get(owner).storage,old=await storage.get('job:'+body.requestId);old.nextSettlementAt=Date.now()-1;await storage.put('job:'+body.requestId,old);
  const next={...body,requestId:'ffffffff-ffff-4fff-8fff-fffffffffffe',question:'next'};await start(owner,next);await alarm(owner);
  const prior=await instance(owner).status(owner,body.requestId),done=await instance(owner).status(owner,next.requestId);
  assert.equal(prior.creditTaskStatus,'reserved');assert.equal(prior.creditSettlementPending,true);assert.equal(done.status,'done');assert.equal(done.creditTaskStatus,'settled');assert.ok(await storage.getAlarm());
});

await test('deleting an in-progress or completed report cannot resurrect it on alarms or replay', async () => {
  const { owner, body } = await setup(1250); await start(owner, body); await alarm(owner);
  sql.prepare("UPDATE coach_saved_reports SET status='deleted',result='{}' WHERE id=? AND owner_id=?").run(body.requestId, owner);
  const result = await finish(owner); assert.equal(result.status, 'error', result.error); assert.equal(balance(owner), 1000); assert.equal(sql.prepare('SELECT status FROM coach_saved_reports WHERE id=?').get(body.requestId).status, 'deleted');
  await alarm(owner); assert.equal(sql.prepare('SELECT status FROM coach_saved_reports WHERE id=?').get(body.requestId).status, 'deleted');
  const completed = await setup(12); await start(completed.owner, completed.body); assert.equal((await finish(completed.owner)).status, 'done');
  sql.prepare("UPDATE coach_saved_reports SET status='deleted',result='{}' WHERE id=?").run(completed.body.requestId);
  const before = calls.length; assert.equal((await instance(completed.owner, true).status(completed.owner, completed.body.requestId)).status, 'removed'); await alarm(completed.owner);
  assert.equal(calls.length, before); assert.equal(sql.prepare('SELECT status FROM coach_saved_reports WHERE id=?').get(completed.body.requestId).status, 'deleted');
  const replay = await start(completed.owner, completed.body); assert.equal(replay.status, 'removed'); assert.equal(taskCount(completed.owner), 1); assert.equal(balance(completed.owner), 1000 - fixturePrice(completed.owner));
});

await test('expired jobs release the reservation and status repairs a missing alarm', async () => {
  const { owner, body } = await setup(); await start(owner, body); const storage = states.get(owner).storage; storage.takeAlarm(); assert.equal(await storage.getAlarm(), null);
  await instance(owner, true).status(owner, body.requestId); assert.ok(await storage.getAlarm());
  const job = await storage.get('job:' + body.requestId); job.expiresAt = Date.now() - 1; await storage.put('job:' + body.requestId, job);
  const before = calls.length, result = await alarm(owner); assert.equal(result.status, 'error'); assert.match(result.error, /到期/); assert.equal(calls.length, before); assert.equal(balance(owner), 1000);
});

await test('purging during a model call rejects late checkpoints, clears private job context and refunds once', async () => {
  const current = await setup(1250), other = await setup(12); await start(current.owner, current.body); await alarm(current.owner); await start(other.owner, other.body);
  const storage = states.get(current.owner).storage;
  assert.equal((await storage.list({ prefix: 'step:' })).size, 4);
  assert.ok((await storage.get('job:' + current.body.requestId)).context);
  const otherBefore = await states.get(other.owner).storage.list();
  let arrived, release;
  const entered = new Promise(resolve => { arrived = resolve; }), gate = new Promise(resolve => { release = resolve; });
  providerFailure = async messages => { arrived(); await gate; const detail = JSON.parse(messages.at(-1).content); return JSON.stringify({ findings: detail.rows.slice(0, 1).map(row => ({ claim: '迟到的合成结果', confidence: '低', alternative: '仍需核实', evidence: [{ sourceId: row.sourceId, quote: row.text.slice(0, 20) }] })) }); };
  const pending = alarm(current.owner);
  try {
    await entered;
    await instance(current.owner).purge(current.owner);
    const clean = await storage.get('job:' + current.body.requestId);
    assert.equal(clean.purged, true); assert.equal(clean.status, 'error'); assert.equal(clean.creditFinished, true); assert.equal(clean.input.friend, ''); assert.equal(clean.input.subjectId, null); assert.equal(clean.input.libraryId, null); assert.equal(clean.context, undefined); assert.deepEqual(clean.manifest, {}); assert.equal(clean.fingerprint, ''); assert.deepEqual(clean.used, []);
    assert.equal((await storage.list({ prefix: 'step:' })).size, 0); assert.equal(balance(current.owner), 1000); assert.equal(creditTask(current.owner, current.body.requestId).status, 'released');
    await assert.rejects(instance(current.owner).checkpoint(current.owner, current.body.requestId, env.WECHAT_CALLBACK_TOKEN, 'a'.repeat(64), { text: 'late secret', phase: 'segments', count: 1 }), /任务已结束/);
    await instance(current.owner).purge(current.owner); assert.equal(balance(current.owner), 1000, 'repeated purge refunds only once');
    assert.deepEqual(await states.get(other.owner).storage.list(), otherBefore); assert.equal(balance(other.owner), 1000 - fixturePrice(other.owner)); assert.equal(creditTask(other.owner, other.body.requestId).status, 'reserved');
  } finally { release(); await pending; providerFailure = null; }
  assert.equal((await storage.list()).size, 0, 'alarm removes sanitized tombstones after settlement'); assert.equal(await storage.getAlarm(), null);
  assert.equal(sql.prepare('SELECT status FROM coach_saved_reports WHERE id=?').get(current.body.requestId).status, 'deleted');
  const before = calls.length; await alarm(current.owner); assert.equal(calls.length, before); assert.equal(balance(current.owner), 1000); assert.equal((await storage.list()).size, 0);
  assert.equal((await finish(other.owner)).status, 'done', 'another owner continues normally');
});

await test('purging after the final checkpoint but before the report write cannot resurrect a result', async () => {
  const { owner, body } = await setup(12); await start(owner, body);
  let arrived, release;
  const entered = new Promise(resolve => { arrived = resolve; }), gate = new Promise(resolve => { release = resolve; }), originalPrepare = db.prepare;
  db.prepare = function(query) {
    const statement = originalPrepare(query), run = statement.run;
    if (query.startsWith('UPDATE coach_saved_reports SET result=')) statement.run = async function() { if (this.args[5] === owner) { arrived(); await gate; } return run.call(this); };
    return statement;
  };
  const pending = alarm(owner);
  try {
    await entered; await instance(owner).purge(owner);
    assert.equal(sql.prepare('SELECT status FROM coach_saved_reports WHERE id=?').get(body.requestId).status, 'deleted'); assert.equal(balance(owner), 1000);
  } finally { release(); await pending; db.prepare = originalPrepare; }
  const row = sql.prepare('SELECT status,result FROM coach_saved_reports WHERE id=?').get(body.requestId); assert.equal(row.status, 'deleted'); assert.equal(row.result, '{}'); assert.equal(creditTask(owner, body.requestId).status, 'released');
  assert.equal((await states.get(owner).storage.list()).size, 0); const before = calls.length; await alarm(owner); assert.equal(calls.length, before); assert.equal(balance(owner), 1000);
});

await test('terminal purge removes all job and step data; deleting the report forces fresh model steps', async () => {
  const { owner, body } = await setup(), other = await setup(12); await start(owner, body); assert.equal((await finish(owner)).status, 'done'); await start(other.owner, other.body);
  const storage = states.get(owner).storage, otherBefore = await states.get(other.owner).storage.list(); assert.ok((await storage.list({ prefix: 'step:' })).size > 0);
  await assert.rejects(instance(owner).purge(other.owner), /账号不一致/); assert.ok((await storage.list({ prefix: 'step:' })).size > 0);
  sql.prepare("UPDATE coach_saved_reports SET status='deleted',result='{}',summary='' WHERE id=? AND owner_id=?").run(body.requestId, owner);
  await instance(owner).purge(owner); assert.equal((await storage.list()).size, 0, 'finished job friend, manifest and cached model text are removed'); assert.deepEqual(await states.get(other.owner).storage.list(), otherBefore); assert.equal(balance(owner), 1000 - fixturePrice(owner), 'already delivered reports are not refunded again');
  await alarm(owner); assert.equal(await storage.getAlarm(), null); await instance(owner).purge(owner); await alarm(owner); assert.equal((await storage.list()).size, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM coach_capture_records WHERE owner_id=? AND library_id=?').get(owner, body.libraryId).n, 675, 'original source remains for explicit re-analysis');
  const before = calls.length, fresh = { ...body, requestId: crypto.randomUUID() }; const queued = await start(owner, fresh); assert.equal(queued.reused, undefined); assert.equal(queued.taskId, fresh.requestId);
  const done = await finish(owner); assert.equal(done.status, 'done', done.error); assert.equal(done.reusedSteps, 0); assert.equal(calls.length - before, 4, 'deleted cached steps cannot be reused even with the same source epoch'); assert.equal(balance(owner), 1000 - 2 * fixturePrice(owner)); assert.equal(sql.prepare('SELECT status FROM coach_saved_reports WHERE id=?').get(body.requestId).status, 'deleted');
});

await test('concurrent checkpoint calls finish in-flight work before yielding and validate phase outputs', async () => {
  const cache = new Map(), releases = []; let providerCalls = 0, finished = false;
  const checkpoint = async (key, update) => { if (update && key !== 'progress') cache.set(key, update); return cache.get(key); };
  const model = checkpointedCaptureModel(async () => { providerCalls++; await new Promise(resolve => releases.push(resolve)); return JSON.stringify({ findings: [] }); }, checkpoint);
  const messages = i => [{ role: 'user', content: JSON.stringify({ rows: [{ basis: 'chat-original', text: '合成' + i }] }) }];
  const all = allCaptureSteps([1,2,3,4,5].map(i=>model(messages(i)))).finally(() => { finished = true; });
  while (releases.length < 4) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(providerCalls, 4); assert.equal(finished, false); releases.forEach(resolve => resolve()); await assert.rejects(all, error => error instanceof CaptureJobYield); assert.equal(cache.size, 4);
  const malformed = checkpointedCaptureModel(async () => JSON.stringify({ wrong: true }), async () => null);
  await assert.rejects(malformed(messages(4)), error => error instanceof CaptureJobRetry);
});

await test('sparse legacy synthesis cache is replaced while concise grounded reasoning is accepted',async()=>{
  const messages=[{role:'user',content:JSON.stringify({findings:[{id:'verified-one'}]})}],options={fast:true,json:true,maxTokens:7000};
  const oldKey=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({version:1,messages,options})))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const cache=new Map([[oldKey,{text:JSON.stringify({summary:'旧的一句话',summaryEvidenceIds:['verified-one']})}]]);let providerCalls=0;
  const model=checkpointedCaptureModel(async()=>{providerCalls++;return JSON.stringify({summary:'可继续核实安排。',explanation:'有提议，尚无兑现证据。',summaryEvidenceIds:['verified-one']});},async(key,update)=>{if(update&&key!=='progress')cache.set(key,update);return cache.get(key);});
  assert.match(await model(messages,options),/尚无兑现证据/);assert.equal(providerCalls,1);assert.equal(cache.size,2);
  assert.match(await model(messages,options),/尚无兑现证据/);assert.equal(providerCalls,1,'validated new synthesis is reused');
  const noFindings=checkpointedCaptureModel(async()=>JSON.stringify({summary:'目前没有可靠观察。'}),async()=>null);
  assert.match(await noFindings([{role:'user',content:JSON.stringify({findings:[]})}],options),/没有可靠观察/);
});

await test('unverifiable segment citations retry rather than becoming a paid empty report',async()=>{
  const {owner,body}=await setup(12);let attempts=0;
  providerFailure=()=>{attempts++;return JSON.stringify({findings:[{claim:'无法核对的推测',evidence:[{sourceId:'not-in-this-segment',quote:'不存在的原话'}]}]});};
  await start(owner,body);const failed=await finish(owner);
  assert.equal(failed.status,'error');assert.equal(failed.completedText,0);assert.equal(attempts,4);
  assert.equal(balance(owner),1000);assert.equal((await states.get(owner).storage.list({prefix:'step:'})).size,0);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM coach_saved_reports WHERE id=? AND status='done'").get(body.requestId).n,0);
});

await test('legacy ungrounded segment cache is replaced without invalidating good sibling work',async()=>{
  const messages=[{role:'user',content:JSON.stringify({rows:[{sourceId:'H1',role:'other',text:'周六一起去散步。',basis:'chat-original'}]})}],options={fast:true,json:true};
  const key=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({version:1,messages,options})))).toString('hex');
  const cache=new Map([[key,{text:JSON.stringify({findings:[{claim:'旧坏线索',evidence:[{sourceId:'H9',quote:'假原话'}]}]})}]]);
  let count=0;
  const model=checkpointedCaptureModel(async()=>{count++;return JSON.stringify({findings:[{claim:'有具体活动提议',evidence:[{sourceId:'H1',quote:'一起去散步'}]}]});},async(key,update)=>{if(update&&key!=='progress')cache.set(key,update);return cache.get(key);});
  assert.match(await model(messages,options),/具体活动提议/);assert.match(await model(messages,options),/具体活动提议/);assert.equal(count,1);
});

await test('elapsed alarm budget yields before another provider and still allows cached checkpoints',async()=>{
  const cache=new Map();let count=0,now=1000;const originalNow=Date.now;Date.now=()=>now;
  try{
    const model=checkpointedCaptureModel(async()=>{count++;return JSON.stringify({findings:[]});},async(key,update)=>{if(update&&key!=='progress')cache.set(key,update);return cache.get(key);});
    const messages=i=>[{role:'user',content:JSON.stringify({rows:[{text:'合成'+i}]})}];
    await model(messages(1));now+=75_000;
    await model(messages(1));assert.equal(count,1,'cached work remains reusable after the time budget');
    await assert.rejects(model(messages(2)),error=>error instanceof CaptureJobYield);assert.equal(count,1);
  }finally{Date.now=originalNow;}
});

await test('a failed parallel step waits for sibling checkpoint completion before retry',async()=>{
  let release,settled=false;
  const sibling=new Promise(resolve=>{release=()=>{settled=true;resolve('saved');};});
  const failure=new CaptureJobRetry('synthetic retry');
  let returned=false;
  const pending=allCaptureSteps([Promise.reject(failure),sibling]).catch(error=>{returned=true;assert.equal(error,failure);});
  await Promise.resolve();await Promise.resolve();assert.equal(returned,false);assert.equal(settled,false);
  release();await pending;assert.equal(settled,true);assert.equal(returned,true);
});

await test('image batches reject missing duplicate and foreign IDs before checkpointing',async()=>{
  const images=[{mediaId:'image-a'},{mediaId:'image-b'}];
  const messages=[{role:'user',content:[{type:'text',text:JSON.stringify({images})}]}];
  const observation=mediaId=>({mediaId,readable:true,observation:'合成图片可见步道。'});
  for(const invalid of [[observation('image-a')],[observation('image-a'),observation('image-a')],[observation('image-a'),observation('foreign-image')]]){
    const cache=new Map();
    const model=checkpointedCaptureModel(async()=>JSON.stringify({images:invalid}),async(key,value)=>{if(value&&key!=='progress')cache.set(key,value);return cache.get(key);});
    await assert.rejects(model(messages,{vision:true}),error=>error instanceof CaptureJobRetry);
    assert.equal(cache.size,0,'malformed batch cannot become reusable evidence');
  }
  const cache=new Map();let calls=0;
  const model=checkpointedCaptureModel(async()=>{calls++;return JSON.stringify({images:[observation('image-b'),observation('image-a')]});},async(key,value)=>{if(value&&key!=='progress')cache.set(key,value);return cache.get(key);});
  await model(messages,{vision:true});await model(messages,{vision:true});
  assert.equal(calls,1);assert.equal([...cache.values()][0].imageCount,2,'progress counts images instead of provider calls');
});

await test('edited person context between alarms stops the frozen analysis and releases credits once', async()=>{
  const {owner,subject,body}=await setup(1250);
  sql.prepare("INSERT INTO coach_profiles(owner_id,consent_at,paused,data,updated_at) VALUES(?,1,0,'{}',1)").run(owner);
  await start(owner,body);await alarm(owner);const before=calls.length;
  sql.prepare("UPDATE coach_subjects SET data=json_set(data,'$.concerns','用户补充：关系期待已明确改变') WHERE id=?").run(subject);
  const result=await alarm(owner);assert.equal(result.status,'error');assert.match(result.error,/资料或档案授权已改变/);assert.equal(calls.length,before);
  assert.equal(balance(owner),1000);assert.equal(creditTask(owner,body.requestId).status,'released');assert.equal((await states.get(owner).storage.get('job:'+body.requestId)).context,undefined);
  await alarm(owner);assert.equal(balance(owner),1000);
});

await test('pausing or revoking profile consent during a model call prevents further calls and saving', async()=>{
  for(const change of ['paused=1','consent_at=NULL']){
    const {owner,body}=await setup(12);
    sql.prepare("INSERT INTO coach_profiles(owner_id,consent_at,paused,data,updated_at) VALUES(?,1,0,'{}',1)").run(owner);
    await start(owner,body);const before=calls.length;
    providerFailure=async messages=>{sql.prepare('UPDATE coach_profiles SET '+change+' WHERE owner_id=?').run(owner);const detail=JSON.parse(messages.at(-1).content);return JSON.stringify({findings:detail.rows.slice(0,1).map(row=>({claim:'合成判断',confidence:'低',alternative:'需核实',evidence:[{sourceId:row.sourceId,quote:row.text}]}))});};
    const result=await alarm(owner);providerFailure=null;
    assert.equal(result.status,'error');assert.match(result.error,/资料或档案授权已改变/);assert.equal(calls.length-before,1,'no second provider receives the revoked context');
    assert.equal(balance(owner),1000);assert.notEqual(sql.prepare('SELECT status FROM coach_saved_reports WHERE id=?').get(body.requestId).status,'done');
    assert.equal((await states.get(owner).storage.get('job:'+body.requestId)).context,undefined);
  }
});

delete globalThis.__captureDurableFixture;
sql.close();
assert.equal(failures.length, 0, failures.map(item => item.label + ': ' + item.error.message).join('\n'));
console.log(`PASS ${groups} durable-capture groups; real SQLite billing/report triggers, synthetic Cloudflare/provider only.`);
