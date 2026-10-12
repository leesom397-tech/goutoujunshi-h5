import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

const cache = new Map();
function compiled(file) { return ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText; }
function load(file) { const filename = resolve(file); if (cache.has(filename)) return cache.get(filename); const exports = {}; cache.set(filename, exports); new Function('exports', 'require', compiled(filename))(exports, name => load(resolve(dirname(filename), name) + '.ts')); return exports; }
const { validateCaptureBatch, mergeCaptureRecords: merge, captureNamespaceKey, captureLibraryId, CAPTURE_LIMITS } = load('lib/desktop-capture.ts');
const ns = { ownerId: 'test-owner-a', account: 'wx-account-a', friend: 'test-friend-a', kind: 'chat' };
const row = (text, extra = {}) => ({ kind: 'text', sender: '小A', senderRole: 'other', at: '', text, source: { label: '微信可见原文', method: 'uia', index: 1, order: 'ui-order' }, ...extra });
const batch = (records, extra = {}) => ({ version: 1, kind: 'chat', account: ns.account, friend: ns.friend, capturedAt: '2026-10-13T08:00:00.000Z', records, warnings: [], ...extra });
const initial = records => merge([], batch(records), ns);
const recapture = (existing, records, extra = {}) => merge(existing, batch(records, { capturedAt: '2026-10-14T08:00:00.000Z', ...extra }), ns);

const original = row('  周六一起看展吗？\n我可以买票。 ', { id: 'native-1', at: '昨天 18:00', source: { label: '原窗口', atRaw: '昨天 18:00', index: 8 }, senderRole: 'self' });
const stable = initial([original]);
assert.equal(stable.records[0].text, original.text, 'original whitespace and line breaks must survive');
assert.deepEqual(stable.records[0].source, original.source);
assert.equal(stable.records[0].senderRole, 'self');
const repeated = recapture(stable.records, [{ ...original, at: '2026年10月12日 18:00' }]);
assert.equal(repeated.added, 0, 'source ID survives changed display date and capture time');
assert.equal(repeated.records[0].localId, stable.records[0].localId);
assert.equal(repeated.records[0].firstCapturedAt, batch([]).capturedAt);
assert.equal(repeated.records[0].lastCapturedAt, '2026-10-14T08:00:00.000Z');
assert.equal(recapture(stable.records, [{ ...original, text: '修改后的原文' }]).added, 1, 'changed original content is retained as a revision');
assert.equal(initial([row('同一来源的截图重叠', { id: 'native-2' }), row('同一来源的截图重叠', { id: 'native-2' })]).added, 1);
assert.equal(initial([row('嗯', { id: 'native-3' }), row('嗯', { id: 'native-4' })]).added, 2, 'different message IDs are distinct even with identical words');

const short = initial([row('嗯')]);
assert.equal(recapture(short.records, [row('嗯')]).added, 1, 'undated short replies cannot be collapsed by text alone');
assert.equal(initial([row('嗯'), row('嗯')]).added, 2, 'unknown-time repeated phrases within a capture remain distinct');
const context = [row('今天上午的面试进行得顺利吗？'), row('挺顺利的，谢谢你还记得这个。'), row('太好了，周六可以一起看展庆祝一下。')];
const first = initial(context), overlapping = recapture(first.records, [...context, row('那就约周六下午两点吧。')]);
assert.deepEqual([overlapping.added, overlapping.repeated, overlapping.total], [1, 3, 4]);
assert.equal(recapture(overlapping.records, context).added, 0, 'a fully repeated contextual window is not analyzed twice');
assert.equal(recapture(first.records, [context[0], row('新的不同中间一句'), context[2]]).added, 3, 'disconnected matches must not masquerade as ordered overlap');
const timed = row('嗯', { at: '2026-10-13 10:32:10' });
const times = initial([timed, timed]);
assert.deepEqual([recapture(times.records, [timed, timed, timed]).repeated, recapture(times.records, [timed, timed, timed]).added], [2, 1], 'timestamp matching preserves multiplicity');
assert.equal(recapture(initial([row('嗯', { at: '昨天 10:32' })]).records, [row('嗯', { at: '昨天 10:32' })]).added, 1, 'relative dates are not silently treated as stable absolute dates');
const anchored = [row('下周展览活动确认', { at: '2026-10-13 10:32' }), row('嗯')];
assert.equal(recapture(initial(anchored).records, anchored).added, 0, 'a short reply may align through an adjacent unambiguous dated message');

const postNs = { ...ns, kind: 'moments' };
const postBatch = records => batch(records, { kind: 'moments' });
const post = row('周末去看了新的摄影展，分享几张照片。', { kind: 'post', at: '2026年10月13日' });
const posts = merge([], postBatch([post]), postNs);
assert.equal(merge(posts.records, postBatch([post]), postNs).added, 0);
assert.equal(merge(posts.records, postBatch([{ ...post, at: '2026年10月14日' }]), postNs).added, 1, 'same copy on a different day is another post');
const png = { mime: 'image/png', name: 'test.png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGkAAAAASUVORK5CYII=' };
const withImage = { ...post, images: [png] };
assert.equal(merge(posts.records, postBatch([withImage]), postNs).added, 1, 'different media is not discarded as a duplicate of identical copy');
assert.equal(merge(merge([], postBatch([withImage]), postNs).records, postBatch([{ ...withImage, images: [{ ...png, name: 'renamed.png' }] }]), postNs).added, 0, 'renaming media does not create a new post');
for (const next of [{ ...ns, ownerId: 'test-owner-b' }, { ...ns, account: 'wx-account-b' }, { ...ns, friend: 'test-friend-b' }, postNs]) {
  assert.notEqual(captureLibraryId(next), captureLibraryId(ns));
  assert.throws(() => merge(first.records, batch(context, { account: next.account, friend: next.friend, kind: next.kind }), next), /其他账号|联系人/);
}
assert.throws(() => captureNamespaceKey({ ...ns, ownerId: '' }), /登录账号/);
assert.throws(() => validateCaptureBatch(batch([row('x', { senderRole: 'guess' })])), /身份/);
assert.throws(() => validateCaptureBatch(batch([row('x', { images: [{ mime: 'image/svg+xml', name: 'x.svg', data: 'PHN2Zz4=' }] })])), /PNG/);
assert.throws(() => validateCaptureBatch(batch([row('x', { images: [{ ...png, mime: 'image/jpeg' }] })])), /格式不一致/);
assert.throws(() => validateCaptureBatch(batch([row('x', { images: [{ ...png, data: '%%%=' }] })])), /编码/);
assert.throws(() => validateCaptureBatch(batch([row('x', { images: [{ ...png, data: 'A'.repeat(Math.ceil(CAPTURE_LIMITS.imageBytes / 3) * 4 + 4) }] })])), /过长/);
assert.throws(() => validateCaptureBatch(batch([row('x'.repeat(CAPTURE_LIMITS.textPerRecord + 1))])), /过长/);
assert.throws(() => validateCaptureBatch(batch([row('')])) , /空条目/);
assert.throws(() => validateCaptureBatch(batch([row('x')], { capturedAt: '昨天' })), /ISO/);
assert.equal(validateCaptureBatch(batch([row('未注明是谁', { senderRole: undefined })])).records[0].senderRole, 'unknown');
const sticker = row('[表情包：微笑]', { id: 'sticker-native', kind: 'sticker' });
assert.equal(recapture(initial([sticker]).records, [{ ...sticker, ocrTextVerified: true }]).added, 1, 'verified visual text must not collapse into an unverified sticker placeholder');
assert.equal(validateCaptureBatch(batch([{ ...sticker, ocrTextVerified: true }])).records[0].ocrTextVerified, true);
assert.throws(() => validateCaptureBatch(batch([{ ...sticker, ocrTextVerified: 'true' }])), /核验标记/);
console.log('PASS capture records: original evidence, conservative overlap, stable IDs/revisions, repeated short messages, dates, media, namespaces and validation');

// A real browser transaction test, using only a synthetic origin and synthetic records.
const { default: puppeteer } = await import('puppeteer-core');
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true); page.on('request', request => request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Capture vault test</title>' }));
  await page.goto('http://capture-vault.test');
  const results = await page.evaluate(async ({ pure, vault, payload }) => {
    const capture = {}, storage = {};
    new Function('exports', pure)(capture);
    new Function('exports', 'require', vault)(storage, () => capture);
    const checks = [], expect = (value, description) => { if (!value) throw new Error(description); checks.push(description); };
    const first = await storage.saveCaptureBatch('owner-a', payload);
    expect(first.added === 3, 'initial save');
    expect(storage.pendingCaptureRecords(first.library).length === 3, 'newly saved records remain pending');
    const second = await storage.saveCaptureBatch('owner-a', { ...payload, capturedAt: '2026-10-14T09:00:00.000Z' });
    expect(second.added === 0 && storage.pendingCaptureRecords(second.library).length === 3, 'repeat capture after failed analysis keeps all pending');
    expect(await storage.getCaptureLibrary('owner-b', first.library.id) === null, 'foreign owner cannot read library by known ID');
    expect((await storage.listCaptureLibraries('owner-b')).length === 0, 'foreign owner cannot list another owner records');
    expect(await storage.getCaptureRecord('owner-b', first.library.id, first.newRecords[0].localId) === null, 'foreign owner cannot retrieve an individual source');
    let rejected = false;
    try { await storage.linkReportSources('owner-b', 'report-1', { libraryId: first.library.id, sourceIds: [first.newRecords[0].localId] }); } catch { rejected = true; }
    expect(rejected, 'foreign owner cannot link report sources');
    const sourceIds = [first.newRecords[2].localId, first.newRecords[0].localId];
    await storage.linkReportSources('owner-a', 'report-1', { libraryId: first.library.id, sourceIds });
    await storage.linkReportSources('owner-a', 'report-1', { libraryId: first.library.id, sourceIds });
    const linked = await storage.readReportSources('owner-a', 'report-1');
    expect(JSON.stringify(linked.records.map(item => item.localId)) === JSON.stringify(sourceIds), 'sources follow report order');
    expect(await storage.readReportSources('owner-b', 'report-1') === null, 'report sources are owner-scoped');
    const partial = await storage.getCaptureLibrary('owner-a', first.library.id);
    expect(storage.pendingCaptureRecords(partial).length === 1 && partial.reportLinks.length === 1, 'only linked originals become analyzed; receipt retry is idempotent');
    const summary = (await storage.listCaptureLibraries('owner-a'))[0];
    expect(summary.total === 3 && summary.pending === 1 && !('records' in summary), 'library listing is a summary');
    const otherFriend = await storage.saveCaptureBatch('owner-a', { ...payload, friend: '另一个人' });
    const otherAccount = await storage.saveCaptureBatch('owner-a', { ...payload, account: '另一微信号' });
    expect(otherFriend.added === 3 && otherAccount.added === 3, 'friend and WeChat account partitions');
    rejected = false;
    try { await storage.linkReportSources('owner-a', 'report-1', { libraryId: otherFriend.library.id, sourceIds: [otherFriend.newRecords[0].localId] }); } catch { rejected = true; }
    expect(rejected, 'existing report attribution cannot be overwritten');
    await storage.removeCaptureLibrary('owner-b', first.library.id);
    expect(!!await storage.getCaptureLibrary('owner-a', first.library.id), 'foreign owner cannot delete library');
    // Both calls race for the same library: a single read/write transaction prevents lost updates.
    await Promise.all([storage.saveCaptureBatch('owner-a', { ...payload, records: [{ ...payload.records[0], id: 'concurrent-a', text: '并发新消息A' }] }), storage.saveCaptureBatch('owner-a', { ...payload, records: [{ ...payload.records[0], id: 'concurrent-b', text: '并发新消息B' }] })]);
    expect((await storage.getCaptureLibrary('owner-a', first.library.id)).records.length === 5, 'concurrent saves preserve both additions');
    await storage.removeCaptureLibrary('owner-a', first.library.id);
    expect(await storage.getCaptureLibrary('owner-a', first.library.id) === null && await storage.readReportSources('owner-a', 'report-1') === null, 'deletion removes originals and report link together');
    return checks;
  }, { pure: compiled('lib/desktop-capture.ts'), vault: compiled('lib/desktop-capture-vault.ts'), payload: batch(context) });
  console.log(`PASS real IndexedDB: ${results.length} checks for isolation, retry/pending, evidence order, concurrent writes and deletion`);
} finally { await browser.close(); }
