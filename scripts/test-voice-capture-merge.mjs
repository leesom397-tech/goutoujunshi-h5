import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

const cache = new Map();
function compiled(file) { return ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText; }
function load(file) { const filename = resolve(file); if (cache.has(filename)) return cache.get(filename); const exports = {}; cache.set(filename, exports); new Function('exports', 'require', compiled(filename))(exports, name => load(resolve(dirname(filename), name) + '.ts')); return exports; }
const { mergeCaptureRecords: merge } = load('lib/desktop-capture.ts');
const { pendingCaptureRecords } = load('lib/desktop-capture-vault.ts');
const ns = { ownerId: 'synthetic-voice-owner', account: 'synthetic-account', friend: 'synthetic-friend', kind: 'chat' };
const firstAt = '2026-10-13T08:00:00.000Z', upgradeAt = '2026-10-14T08:00:00.000Z';
const batch = (records, capturedAt = firstAt) => ({ version: 1, kind: 'chat', account: ns.account, friend: ns.friend, capturedAt, records, warnings: [] });
const row = (text, extra = {}) => ({ kind: 'text', sender: '测试对象', senderRole: 'other', at: '', text, source: { label: '合成测试原话', uiClass: 'mmui::ChatTextItemView' }, ...extra });
const before = row('这是语音之前的唯一一条完整原始文字。'), after = row('这是语音之后的另一条唯一完整原始文字。');
const png = { mime: 'image/png', name: 'voice-preview.png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGkAAAAASUVORK5CYII=' };
const placeholder = (extra = {}) => row('语音5"秒', { kind: 'other', at: '2026-10-13 12:00', images: [png], source: { label: '合成语音预览', uiClass: 'mmui::ChatVoiceItemView', uiIndex: 7 }, ...extra });
const transcript = (text, extra = {}) => row(text, { at: '2026-10-13 12:00', source: { label: '合成语音转文字', uiClass: 'mmui::ChatVoiceItemView', mediaKind: 'voice', transcriptionStatus: 'visible-text', rawMediaLabel: '语音5"秒', durationSeconds: 5 }, ...extra });
const original = merge([], batch([before, placeholder(), after]), ns);
const incoming = [before, transcript('请把之前提到的资料再发给我。'), after];
const enriched = merge(original.records, batch(incoming, upgradeAt), ns);
assert.deepEqual([enriched.added, enriched.repeated, enriched.updatedVoice, enriched.total], [0, 3, 1, 3]);
assert.equal(original.updatedVoice, 0, 'new original records are not voice updates');
assert.deepEqual(enriched.records.map(item => item.localId), original.records.map(item => item.localId), 'enrichment retains original source IDs and order');
assert.equal(enriched.records[1].firstCapturedAt, firstAt);
assert.equal(enriched.records[1].lastCapturedAt, upgradeAt);
assert.equal(enriched.records[1].kind, 'text');
assert.equal(enriched.records[1].text, incoming[1].text);
assert.equal(enriched.records[1].source.transcriptCapturedAt, upgradeAt);
assert.equal(enriched.records[1].source.uiIndex, 7, 'original source metadata remains available');
assert.deepEqual(enriched.records[1].images, [png], 'original voice preview remains available');
assert.equal(original.records[1].kind, 'other', 'input and previously returned source snapshots are not mutated');
const again = merge(enriched.records, batch(incoming, '2026-10-15T08:00:00.000Z'), ns);
assert.equal(again.updatedVoice, 0, 'already visible transcripts are not counted as a new enrichment');
assert.equal(again.added, 0, 'a later capture without the previous UI preview does not duplicate the transcript');
assert.equal(again.records[1].source.transcriptCapturedAt, upgradeAt, 'repeated capture does not make a consumed transcript pending again');

const double = merge([], batch([before, placeholder(), placeholder(), after]), ns);
const doubleNew = [before, transcript('第一条语音的完整文字。'), transcript('第二条语音的完整文字。'), after];
const doubleUpdated = merge(double.records, batch(doubleNew, upgradeAt), ns);
assert.deepEqual(doubleUpdated.records.map(item => item.localId), double.records.map(item => item.localId));
assert.deepEqual(doubleUpdated.records.slice(1, 3).map(item => item.text), doubleNew.slice(1, 3).map(item => item.text), 'equal-time/equal-duration voices remain distinct and upgrade one-to-one in source order');
assert.equal(doubleUpdated.added, 0);
assert.equal(doubleUpdated.updatedVoice, 2, 'each proven original voice is counted once');
assert.equal(merge(doubleUpdated.records, batch(doubleNew, upgradeAt), ns).updatedVoice, 0);
const mismatchedCount = merge(double.records, batch([before, transcript('只有一条语音转写，不能猜是哪条。'), after], upgradeAt), ns);
assert.equal(mismatchedCount.records.filter(item => item.kind === 'other').length, 2, 'unequal segment lengths cannot identify an individual voice');
assert.equal(mismatchedCount.records.filter(item => item.source.transcriptionStatus === 'visible-text').length, 1, 'unmatched transcript is retained as a separate source');
const noAnchor = merge(merge([], batch([placeholder()]), ns).records, batch([incoming[1]], upgradeAt), ns);
assert.equal(noAnchor.updatedVoice, 0, 'unmatched new transcript cannot claim an original voice was completed');
assert.equal(noAnchor.added, 1, 'duration, sender and exact time without neighboring original-message anchors cannot prove identity');
const variants = [
  { sender: '另一个说话人' }, { senderRole: 'self' }, { at: '2026-10-13 12:01' },
  { source: { ...incoming[1].source, rawMediaLabel: '语音6"秒', durationSeconds: 6 } },
  { source: { ...incoming[1].source, durationSeconds: 6 } },
  { id: 'different-native-voice' },
];
for (const variant of variants) {
  const base = variant.id ? merge([], batch([before, placeholder({ id: 'old-native-voice' }), after]), ns) : original;
  const result = merge(base.records, batch([before, { ...incoming[1], ...variant }, after], upgradeAt), ns);
  assert.equal(result.records.find(item => item.localId === base.records[1].localId).kind, 'other', 'sender, role, time, duration and native-ID conflicts never overwrite a placeholder');
}
const literal = placeholder({ source: { label: '真实文本', uiClass: 'mmui::ChatTextItemView' } });
const literalOriginal = merge([], batch([before, literal, after]), ns);
assert.equal(merge(literalOriginal.records, batch(incoming, upgradeAt), ns).records.find(item => item.localId === literalOriginal.records[1].localId).kind, 'other', 'a literal voice label in a text item is never treated as an actual voice');
const durationChanged = { ...incoming[1], source: { ...incoming[1].source, rawMediaLabel: '语音6"秒', durationSeconds: 6 } };
assert.equal(merge(enriched.records, batch([durationChanged], upgradeAt), ns).added, 1, 'different voice duration with the same text and time is not the same message');
assert.equal(merge(enriched.records, batch([{ ...incoming[1], source: { label: '真正的文字消息' } }], upgradeAt), ns).added, 1, 'a text message identical to a transcript is still another source');
const photo = row('[图片]', { kind: 'image', at: '2026-10-13 12:00', images: [png] });
assert.equal(merge(merge([], batch([photo]), ns).records, batch([{ ...photo, images: [] }], upgradeAt), ns).added, 1, 'ordinary media still uses its actual images for identity');

const makeLibrary = (records, links) => ({ ...ns, id: 'test-library', records, reportLinks: links, createdAt: firstAt, updatedAt: upgradeAt, warnings: [] });
const ids = enriched.records.map(item => item.localId);
const oldLink = { reportId: 'old-report', sourceIds: ids, createdAt: '2026-10-13T09:00:00.000Z' };
assert.deepEqual(pendingCaptureRecords(makeLibrary(enriched.records, [oldLink])).map(item => item.localId), [ids[1]], 'only a proven later transcript becomes pending after the old placeholder was analyzed');
for (const date of [upgradeAt, '2026-10-14T09:00:00.000Z', 'invalid']) {
  const newer = { reportId: 'new-report', sourceIds: [ids[1]], createdAt: date };
  assert.equal(pendingCaptureRecords(makeLibrary(enriched.records, [oldLink, newer])).length, 0, 'later/equal report consumes the transcript; unknown report time is conservative');
}
assert.equal(pendingCaptureRecords(makeLibrary(original.records, [oldLink])).length, 0, 'untranscribed placeholders are not requeued');
assert.equal(pendingCaptureRecords(makeLibrary(enriched.records.map(item => ({ ...item, source: { ...item.source, transcriptCapturedAt: 'invalid' } })), [oldLink])).length, 0);
assert.deepEqual(oldLink.sourceIds, ids, 'pending calculation leaves report attribution unchanged');
console.log('PASS voice upgrade: anchored one-to-one identity, repeated durations, conservative mismatches, media, transcript pending timestamps');

// Real browser IndexedDB, synthetic origin and materials only.
const { default: puppeteer } = await import('puppeteer-core');
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Voice upgrade test</title>' }));
  await page.goto('http://voice-capture.test');
  const count = await page.evaluate(async ({ pure, vault, oldPayload, newPayload, ownerId }) => {
    const capture = {}, storage = {};
    new Function('exports', pure)(capture);
    new Function('exports', 'require', vault)(storage, () => capture);
    let checks = 0;
    const expect = (value, message) => { if (!value) throw new Error(message); checks++; };
    const saved = await storage.saveCaptureBatch(ownerId, oldPayload);
    const sourceIds = saved.library.records.map(item => item.localId);
    await storage.linkReportSources(ownerId, 'voice-old-report', { libraryId: saved.library.id, sourceIds });
    const linksBefore = (await storage.getCaptureLibrary(ownerId, saved.library.id)).reportLinks;
    const updated = await storage.saveCaptureBatch(ownerId, newPayload);
    expect(updated.updatedVoice === 1, 'saveCaptureBatch propagates the actual voice update count');
    expect(updated.added === 0 && updated.total === 3, 'IndexedDB upgrades the original message instead of appending');
    expect(JSON.stringify(updated.library.reportLinks) === JSON.stringify(linksBefore), 'report source attribution and creation dates are untouched');
    const sources = await storage.readReportSources(ownerId, 'voice-old-report');
    expect(JSON.stringify(sources.sourceIds) === JSON.stringify(sourceIds), 'existing report retains its source order and IDs');
    expect(sources.records[1].kind === 'text' && sources.records[1].text === newPayload.records[1].text, 'source view can read the original message with its later visible transcript');
    expect(sources.records[1].source.transcriptCapturedAt === newPayload.capturedAt, 'source shows when the transcript became available');
    expect(await storage.getCaptureLibrary('foreign-owner', saved.library.id) === null, 'voice upgrade preserves owner isolation');
    const repeated = await storage.saveCaptureBatch(ownerId, newPayload);
    expect(repeated.updatedVoice === 0, 'persisted reimport does not claim completion again');
    expect(repeated.added === 0 && repeated.total === 3, 'reimport remains idempotent after persistence');
    await storage.removeCaptureLibrary(ownerId, saved.library.id);
    return checks;
  }, { pure: compiled('lib/desktop-capture.ts'), vault: compiled('lib/desktop-capture-vault.ts'), oldPayload: batch([before, placeholder(), after]), newPayload: batch(incoming, upgradeAt), ownerId: ns.ownerId });
  console.log(`PASS real IndexedDB voice enrichment: ${count} source-preservation and isolation checks`);
} finally { await browser.close(); }
