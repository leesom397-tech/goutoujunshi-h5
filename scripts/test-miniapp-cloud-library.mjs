import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const helperModule = { exports: {} };
new Function('module', readFileSync('miniapp/lib/cloud-library.js', 'utf8'))(helperModule);
const view = helperModule.exports;
const rows = Array.from({ length: 160 }, (_, index) => ({ seq: index + 1, localId: 'row-' + (index + 1), kind: 'text', senderRole: index % 2 ? 'self' : 'other', sender: index % 2 ? '我' : '虚构联系人', at: '2026-10-15T09:30:00Z', text: '虚构测试原话 ' + (index + 1), source: { label: '合成测试', mediaKind: index === 159 ? 'voice' : 'text' } }));
const library = { id: 'library-a', friend: '虚构联系人', kind: 'chat', total: 160, epoch: 1, subjectId: null, reportLinks: [], startAt: rows[0].at, endAt: rows[159].at };
assert.equal(view.presentRecord(rows[159], {}, 'chat').voiceLabel, '语音转文字');
assert.equal(view.readable({ ...rows[0], senderRole: 'unknown' }, 'chat'), false);
assert.equal(view.readable({ ...rows[0], kind: 'sticker', text: '狗狗表情' }, 'chat'), false);
assert.equal(view.readable({ kind: 'post', text: '', media: [{ id: 'img', status: 'ready' }] }, 'moments'), true);
assert.equal(view.mediaRefs({ media: [{ id: 'done', status: 'ready' }, { id: 'pending', status: 'uploading' }] }).length, 1);
assert.throws(() => view.analysisRows(rows.slice(0, 41), 'chat'), /40/);
assert.deepEqual(view.analysisRows([rows[3], rows[0]], 'chat').map(row => row.localId), ['row-1', 'row-4']);
assert.doesNotMatch(view.presentLibrary({ ...library, startAt: '', endAt: '', createdAt: '2026-01-01' }).range, /2026/);
assert.equal(view.fingerprint('a'), view.fingerprint('a'));
assert.notEqual(view.fingerprint('a'), view.fingerprint('b'));

const storage = new Map([['session', { token: 'native-token', expiresAt: Date.now() + 60000 }]]);
const requests = [], nav = []; let page, foreign = false, analysisFailure = true, newIds = 0;
const reportId = '10000000-0000-4000-8000-000000000001';
const api = {
  STORAGE: 'session', session: async () => ({ token: 'native-token', state: { subjects: [] } }),
  newId: async () => { newIds++; return reportId; },
  async request(path, method, body) {
    requests.push({ path, method, body });
    if (path === '/api/miniapp/credits') return { prices: { analysisSmall: 20, profile: 30 } };
    if (path === '/api/miniapp/capture/library' && method === 'GET') return { ownerId: 'public-a', webLinked: true, libraries: [library] };
    if (path.includes('/capture/library?id=')) { const params = new URL('https://x' + path).searchParams, cursor = Number(params.get('cursor') || 161); const batch = [...rows].reverse().filter(row => row.seq < cursor).slice(0, Number(params.get('limit')) || 100); return { ownerId: foreign ? 'foreign-owner' : 'public-a', library, records: foreign ? [{ ...rows[0], localId: 'foreign-private' }] : batch, nextCursor: batch.at(-1)?.seq > 1 ? String(batch.at(-1).seq) : null }; }
    if (path.startsWith('/api/miniapp/report?')) { const error = new Error('不存在'); error.status = 404; throw error; }
    if (path === '/api/miniapp/capture/analyze') { if (analysisFailure) { analysisFailure = false; throw Error('模拟网络中断'); } return { reportId, kind: 'chat' }; }
    if (method === 'POST' && body.action === 'link-report') return { ownerId: 'public-a', library: { ...library, reportLinks: [{ reportId, sourceIds: body.sourceIds }] }, linked: true };
    throw Error('未预期的接口 ' + path);
  }
};
const wx = {
  getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
  showModal: options => options.success({ confirm: true }), showToast() {}, pageScrollTo() {}, navigateTo: options => nav.push(options.url),
  getFileSystemManager: () => ({ unlink() {} })
};
new Function('require', 'Page', 'wx', readFileSync('miniapp/pages/library/index.js', 'utf8'))(name => name.includes('cloud-library') ? view : api, definition => { page = { ...definition, data: structuredClone(definition.data), setData(change) { Object.assign(this.data, change); } }; }, wx);
page._selected = {}; page._cursors = ['']; page._tempFiles = []; page._generation = 0;
await page.load();
assert.equal(page.data.libraries.length, 1);
await page.openLibraryId(library.id);
assert.equal(page.data.records[0].seq, 136);
assert.equal(page.data.records.at(-1).seq, 160);
page.selectRecent(); assert.equal(page.data.selectedCount, 25);
assert.ok(page._selected['row-136']); assert.ok(page._selected['row-160']);
page.clearSelection(); page.toggleRecord({ currentTarget: { dataset: { id: 'row-160' } } });
await page.nextPage(); assert.equal(page.data.records[0].seq, 111); assert.equal(page.data.pageNumber, 2);
page.toggleRecord({ currentTarget: { dataset: { id: 'row-111' } } }); assert.equal(page.data.selectedCount, 2);
await page.previousPage(); assert.equal(page.data.records.find(row => row.localId === 'row-160').selected, true);
foreign = true; await page.retryPage(); assert.match(page.data.error, /账号已变化/); assert.equal(page.data.records.length, 0); assert.equal(page.data.library, null); foreign = false;
await page.load(); await page.openLibraryId(library.id); page.toggleRecord({ currentTarget: { dataset: { id: 'row-160' } } }); await page.nextPage(); page.toggleRecord({ currentTarget: { dataset: { id: 'row-111' } } });
await page.analyze(); assert.match(page.data.error, /模拟网络中断/);
const firstRequest = requests.find(row => row.path.endsWith('/capture/analyze'));
assert.equal(firstRequest.body.confirmed, true); assert.equal(firstRequest.body.records.length, 2); assert.deepEqual(firstRequest.body.records.map(row => row.localId), ['row-111', 'row-160']);
await page.analyze();
assert.equal(newIds, 1, 'network retry must reuse the original request id');
assert.equal(new Set(requests.filter(row => row.path.endsWith('/capture/analyze')).map(row => row.body.requestId)).size, 1);
assert.equal(nav.at(-1), '/pages/report/index?id=' + reportId);
assert.equal(page.data.latestReportId, reportId);
const linked = requests.find(row => row.body?.action === 'link-report'); assert.equal(linked.body.expectedOwnerId, 'public-a'); assert.deepEqual(linked.body.sourceIds, ['row-111', 'row-160']);
storage.set('session', { token: 'different-account', expiresAt: Date.now() + 60000 });
const before = requests.length; await page.analyze(); assert.equal(requests.length, before, 'account switch cannot send the old selection');

// Exercise the shared native/web authorization boundary before costly analysis.
const routeSource = ts.transpileModule(readFileSync('app/api/web/capture/analyze/route.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const route = { exports: {} }; let authenticated = true;
new Function('require', 'module', 'exports', routeSource)(name => {
  if (name.endsWith('/miniapp-auth')) return { miniappOwner: async () => authenticated ? { ownerId: 'test-owner' } : null };
  if (name.endsWith('/capture-analysis-input')) return { captureAnalysisInput() { throw Error('INPUT_VALIDATION_REACHED'); } };
  return {};
}, route, route.exports);
const request = (path, origin) => new Request('https://coach.lovetalk.love' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: '{}' });
assert.equal((await route.exports.POST(request('/api/web/capture/analyze'))).status, 403);
assert.equal((await route.exports.POST(request('/api/web/capture/analyze', 'https://evil.example'))).status, 403);
assert.equal((await route.exports.POST(request('/api/web/capture/analyze', 'https://coach.lovetalk.love'))).status, 400);
assert.equal((await route.exports.POST(request('/api/miniapp/capture/analyze'))).status, 400);
authenticated = false; assert.equal((await route.exports.POST(request('/api/miniapp/capture/analyze'))).status, 401);
const authSource = ts.transpileModule(readFileSync('lib/miniapp-auth.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const auth = { exports: {} };
new Function('require', 'module', 'exports', authSource)(name => name === 'cloudflare:workers' ? { env: { MINIAPP_APPID: 'test', MINIAPP_APPSECRET: 'test' } } : name.endsWith('/request-identity.mjs') ? { isWebApi: req => new URL(req.url).pathname.startsWith('/api/web/'), webOwner: async () => null } : {}, auth, auth.exports);
assert.equal(await auth.exports.miniappOwner(new Request('https://coach.lovetalk.love/api/miniapp/capture/analyze', { headers: { cookie: 'session=not-a-native-token' } })), null, 'web cookies cannot authenticate the native route');
const wrapper = { exports: {} }; let forwarded = 0;
new Function('require', 'module', 'exports', ts.transpileModule(readFileSync('app/api/miniapp/capture/analyze/route.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(name => name.endsWith('/miniapp-auth') ? { miniappOwner: async () => ({ ownerId: 'internal-owner-a' }) } : name.endsWith('/capture-cloud-server') ? { captureCloudPublicOwner: async () => 'public-a' } : { POST: async () => { forwarded++; return Response.json({ ok: true }); } }, wrapper, wrapper.exports);
const nativeRequest = owner => new Request('https://coach.lovetalk.love/api/miniapp/capture/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedOwnerId: owner }) });
assert.equal((await wrapper.exports.POST(nativeRequest('old-account'))).status, 409); assert.equal(forwarded, 0);
assert.equal((await wrapper.exports.POST(nativeRequest('public-a'))).status, 200); assert.equal(forwarded, 1);
console.log('PASS miniapp cloud library: latest-first paging, selection, voice/media labels, owner isolation, retries, report navigation, and native/web auth boundaries');
