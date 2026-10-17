import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

const cache = new Map();
const compiled = file => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
function load(file) { const path = resolve(file); if (cache.has(path)) return cache.get(path); const exports = {}; cache.set(path, exports); new Function('exports', 'require', compiled(path))(exports, name => load(resolve(dirname(path), name) + '.ts')); return exports; }
const { captureLibraryId, captureVoiceOriginalSource: snapshot, applyVerifiedVoiceUpdatesToRecords: apply, mergeCaptureRecords } = load('lib/desktop-capture.ts');
const { pendingCaptureRecords } = load('lib/desktop-capture-vault.ts');
const ns = { ownerId: 'synthetic-voice-owner', account: 'synthetic-wechat', friend: 'synthetic-contact', kind: 'chat' };
const capturedAt = '2026-10-15T06:00:00.000Z', upgradedAt = '2026-10-15T07:00:00.000Z';
const text = value => ({ kind: 'text', text: value, sender: 'synthetic-self', senderRole: 'self', at: '2026-10-15 14:00', source: { label: '合成测试文字', uiClass: 'mmui::ChatTextItemView' } });
const voice = index => ({ ...text('语音6"秒'), kind: 'other', source: { label: `合成测试语音 ${index}`, uiClass: 'mmui::ChatVoiceItemView', mediaKind: 'voice', rawMediaLabel: '语音6"秒', durationSeconds: 6, transcriptionStatus: 'missing', index, uiIndex: 7 - index, contentFingerprint: `synthetic-${index}` } });
const initial = { version: 1, kind: 'chat', account: ns.account, friend: ns.friend, capturedAt, warnings: [], records: [text('语音之前唯一完整的原文内容。'), voice(1), voice(2), text('语音之后另一条唯一完整原文。')] };
const rows = mergeCaptureRecords([], initial, ns).records;
const update = (index, value) => ({ localId: rows[index].localId, text: value, verified: true, originalSource: snapshot(rows[index], index), matchedAnchors: [rows[0].localId, rows[3].localId], source: { transcriptionSource: 'wechat-native-transcript-copy', transcriptionStatus: 'visible-text', rawMediaLabel: '语音6"秒', durationSeconds: 6 } });
const first = update(1, '第一条原生语音的完整文字。'), second = update(2, '第二条原生语音的完整文字。');
const input = updates => ({ libraryId: captureLibraryId(ns), account: ns.account, friend: ns.friend, capturedAt: upgradedAt, updates });
const result = apply(rows, input([first, second]), ns);
assert.deepEqual([result.updatedVoice, result.repeated, result.total], [2, 0, 4]);
assert.deepEqual(result.records.map(row => row.localId), rows.map(row => row.localId));
assert.deepEqual(result.records.slice(1, 3).map(row => row.text), [first.text, second.text]);
assert.equal(rows[1].kind, 'other', 'pure helper never mutates the original source');
assert.equal(result.records[1].firstCapturedAt, capturedAt);
assert.equal(result.records[1].source.uiIndex, rows[1].source.uiIndex);
assert.deepEqual(result.records[1].source.voiceOriginalSource, first.originalSource);
const replay = apply(result.records, { ...input([first, second]), capturedAt: '2026-10-16T07:00:00.000Z' }, ns);
assert.deepEqual([replay.updatedVoice, replay.repeated], [0, 2]);
assert.deepEqual(replay.records, result.records, 'replay preserves the first transcript timestamp and all source fields');
assert.equal(apply(rows, input([first, first]), ns).repeated, 1, 'duplicate same-source update is idempotent within one batch');
const dependentSecond = { ...second, matchedAnchors: [first.localId, rows[3].localId] };
const sequence = apply(rows, input([first, dependentSecond]), ns);
assert.equal(sequence.updatedVoice, 2, 'a verified native transcript completed earlier in this batch can anchor the next voice');
assert.equal(sequence.records[2].text, second.text);
const firstOnly = apply(rows, input([first]), ns);
assert.equal(apply(firstOnly.records, input([dependentSecond]), ns).updatedVoice, 1, 'a previously saved native transcript can anchor a later batch');
const rejection = (changed, base = rows, namespace = ns) => assert.throws(() => apply(base, changed, namespace));
rejection(input([dependentSecond]), rows);
rejection(input([dependentSecond, first]), rows);
for (const transcriptionSource of ['local-ocr', 'wechat-visible-ui', undefined]) {
  const unverified = structuredClone(firstOnly.records);
  if (transcriptionSource === undefined) delete unverified[1].source.transcriptionSource;
  else unverified[1].source.transcriptionSource = transcriptionSource;
  rejection(input([dependentSecond]), unverified);
}
const unfinishedAnchor = structuredClone(firstOnly.records); unfinishedAnchor[1].source.transcriptionStatus = 'pending';
rejection(input([dependentSecond]), unfinishedAnchor);
const malformedVoiceAnchor = structuredClone(firstOnly.records); malformedVoiceAnchor[1].source.rawMediaLabel = '未知语音';
rejection(input([dependentSecond]), malformedVoiceAnchor);
const repeatedVoiceAnchor = structuredClone(firstOnly.records); repeatedVoiceAnchor[0].text = first.text;
rejection(input([dependentSecond]), repeatedVoiceAnchor);
for (const changed of [{ account: 'foreign' }, { friend: 'foreign' }, { libraryId: 'foreign' }, { capturedAt: 'invalid' }, { capturedAt: '2020-01-01T00:00:00.000Z' }, { updates: [] }]) rejection({ ...input([first]), ...changed });
rejection(input([first]), rows, { ...ns, ownerId: 'foreign-owner' });
rejection(input([first]), rows, { ...ns, kind: 'moments' });
for (const changed of [
  { verified: false }, { localId: 'absent' }, { text: '' }, { text: '正在转文字…' }, { text: '语音6"秒' },
  { source: { transcriptionSource: 'local-ocr' } }, { source: { ...first.source, durationSeconds: 7 } },
  { matchedAnchors: [rows[3].localId, rows[0].localId] }, { matchedAnchors: [rows[0].localId, rows[0].localId] },
  { matchedAnchors: [rows[0].localId, first.localId] }, { matchedAnchors: [rows[0].localId, 'absent'] },
  { originalSource: { ...first.originalSource, index: 2 } }, { originalSource: { ...first.originalSource, signature: 'wrong' } },
  { originalSource: { ...first.originalSource, sender: 'another speaker' } },
  { originalSource: { ...first.originalSource, source: { ...first.originalSource.source, uiIndex: 999 } } },
]) rejection(input([{ ...first, ...changed }]));
rejection(input([{ ...first, text: '不同的原生文字不得覆盖' }]), result.records);
rejection(input([first, { ...first, text: '同一批出现冲突也必须整体拒绝' }]));
assert.equal(rows[1].kind, 'other', 'a rejected mixed batch cannot change its input');
const altered = structuredClone(result.records); altered[1].source.uiIndex++;
rejection(input([first]), altered);
const alteredDuration = structuredClone(result.records); alteredDuration[1].source.durationSeconds = 7; alteredDuration[1].source.rawMediaLabel = '语音7"秒';
rejection(input([first]), alteredDuration);
const stale = structuredClone(rows); stale[1].source.contentFingerprint = 'different';
rejection(input([first]), stale);
const duplicateAnchor = structuredClone(rows); duplicateAnchor.push({ ...rows[0], localId: 'duplicate-anchor' });
rejection(input([first]), duplicateAnchor);
const duplicateId = [...rows, rows[0]]; rejection(input([first]), duplicateId);
const oldLinks = [{ reportId: 'old', sourceIds: rows.map(row => row.localId), createdAt: capturedAt }];
assert.deepEqual(pendingCaptureRecords({ records: result.records, reportLinks: oldLinks }).map(row => row.localId), [first.localId, second.localId]);
const newerLinks = [...oldLinks, { reportId: 'new', sourceIds: [first.localId, second.localId], createdAt: upgradedAt }];
assert.equal(pendingCaptureRecords({ records: replay.records, reportLinks: newerLinks }).length, 0, 'replay does not requeue already consumed transcripts');
console.log('PASS verified voice updates: exact original identity, equal-duration sources, two-sided anchors, atomic validation, replay and conflict protection');

// Real IndexedDB on a synthetic origin; no site account or original chat content.
const { default: puppeteer } = await import('puppeteer-core');
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Verified voice update test</title>' }));
  await page.goto('http://verified-voice.test');
  const checks = await page.evaluate(async ({ pure, vault, initial, payload, ownerId }) => {
    const capture = {}, storage = {}; new Function('exports', pure)(capture); new Function('exports', 'require', vault)(storage, () => capture);
    let checks = 0;
    const expect = (condition, label) => { if (!condition) throw Error(label); checks++; };
    const rejects = async (call, label) => { let rejected = false; try { await call(); } catch { rejected = true; } expect(rejected, label); };
    const saved = await storage.saveCaptureBatch(ownerId, initial);
    const sourceIds = saved.library.records.map(row => row.localId);
    await storage.linkReportSources(ownerId, 'synthetic-old-report', { libraryId: saved.library.id, sourceIds });
    const before = await storage.getCaptureLibrary(ownerId, saved.library.id);
    await rejects(() => storage.applyVerifiedVoiceUpdates('foreign-owner', payload), 'foreign owner must be rejected');
    await rejects(() => storage.applyVerifiedVoiceUpdates(ownerId, { ...payload, account: 'foreign-wechat' }), 'foreign WeChat account must be rejected');
    const conflict = structuredClone(payload); conflict.updates[1].originalSource.index = 0;
    await rejects(() => storage.applyVerifiedVoiceUpdates(ownerId, conflict), 'second invalid update aborts whole transaction');
    expect(JSON.stringify(await storage.getCaptureLibrary(ownerId, saved.library.id)) === JSON.stringify(before), 'failed transaction preserves complete library');
    const enriched = await storage.applyVerifiedVoiceUpdates(ownerId, payload);
    expect(enriched.updatedVoice === 2 && enriched.total === 4, 'two original voices completed with no added row');
    expect(JSON.stringify(enriched.library.reportLinks) === JSON.stringify(before.reportLinks), 'report links retained');
    expect(JSON.stringify(enriched.library.records.map(row => row.localId)) === JSON.stringify(sourceIds), 'IDs and source ordering retained');
    const sources = await storage.readReportSources(ownerId, 'synthetic-old-report');
    expect(sources.records[1].text === payload.updates[0].text && sources.records[2].text === payload.updates[1].text, 'existing report reads completed original records');
    const repeated = await storage.applyVerifiedVoiceUpdates(ownerId, { ...payload, capturedAt: '2026-10-16T07:00:00.000Z' });
    expect(repeated.updatedVoice === 0 && repeated.repeated === 2, 'persisted replay is idempotent');
    expect(JSON.stringify(repeated.library) === JSON.stringify(enriched.library), 'replay does not update completion dates or report state');
    const changed = structuredClone(payload); changed.updates[0].text = '不同文字';
    await rejects(() => storage.applyVerifiedVoiceUpdates(ownerId, changed), 'changed transcript rejected after persistence');
    expect(JSON.stringify(await storage.getCaptureLibrary(ownerId, saved.library.id)) === JSON.stringify(enriched.library), 'conflict preserves saved result');
    await storage.removeCaptureLibrary(ownerId, saved.library.id);
    return checks;
  }, { pure: compiled('lib/desktop-capture.ts'), vault: compiled('lib/desktop-capture-vault.ts'), initial, payload: input([first, second]), ownerId: ns.ownerId });
  console.log(`PASS real IndexedDB verified voice updates: ${checks} atomic persistence and isolation checks`);
} finally { await browser.close(); }
