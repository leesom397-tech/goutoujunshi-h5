import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { syncCollectorDownloads, validateReleaseIndex } from './sync-collector-downloads.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const base = await mkdtemp(join(tmpdir(), 'chengzi-release-fixture-'));
try {
  const source = join(base, 'source'), output = join(base, 'output');
  await mkdir(source); await mkdir(output);
  const part = Buffer.from('synthetic archive bytes'), exe = Buffer.from('MZ synthetic GUI installer');
  const partName = 'chengzi-wechat-collector-1.2.5.part01.bin', exeName = 'ChengziWeChatCollector-Setup-1.2.5.exe';
  const manifest = Buffer.from(JSON.stringify({ version: '1.2.5', bytes: part.length, sha256: hash(part), exeSha256: hash(exe),
    parts: [{ name: partName, bytes: part.length, sha256: hash(part) }] }));
  const files = { [exeName]: exe, [partName]: part, 'manifest-1.2.5.json': manifest, 'manifest.json': manifest };
  const index = { schema: 1, version: '1.2.5', tag: 'collector-1.2.5', files: Object.entries(files).map(([name, data]) => ({
    name, bytes: data.length, sha256: hash(data), url: `https://github.com/leesom397-tech/goutoujunshi-h5/releases/download/collector-1.2.5/${name}`,
  })) };
  for (const [name, data] of Object.entries(files)) await writeFile(join(source, name), data);
  const indexPath = join(base, 'release.json');
  await writeFile(indexPath, JSON.stringify(index));
  const settings = { indexPath, outputDir: output, assetDir: source, log() {}, fetchImpl() { throw Error('Unexpected network access'); } };
  await writeFile(join(output, 'unrelated.txt'), 'preserve');
  assert.deepEqual(await syncCollectorDownloads(settings), { version: '1.2.5', reused: 0, copied: 4, downloaded: 0 });
  assert.deepEqual(await syncCollectorDownloads(settings), { version: '1.2.5', reused: 4, copied: 0, downloaded: 0 });
  await writeFile(join(output, exeName), 'corrupt');
  assert.equal((await syncCollectorDownloads(settings)).copied, 1);
  assert.equal((await readFile(join(output, exeName))).equals(exe), true);
  assert.equal(await readFile(join(output, 'unrelated.txt'), 'utf8'), 'preserve');

  // Corrupt remote bytes must never replace an existing file or remain as .tmp.
  await writeFile(join(output, exeName), 'keep until verified');
  await assert.rejects(() => syncCollectorDownloads({ ...settings, assetDir: '',
    fetchImpl: async () => new Response(Buffer.alloc(exe.length, 0)) }), /SHA-256/);
  assert.equal(await readFile(join(output, exeName), 'utf8'), 'keep until verified');
  assert.equal((await readdir(output)).some(name => name.includes('.sync-')), false);

  // Local preloading explicitly disables network fallback on missing assets.
  await unlink(join(source, exeName));
  await assert.rejects(() => syncCollectorDownloads(settings), /No network fallback/);
  assert.throws(() => validateReleaseIndex({ ...index, files: [{ ...index.files[0], name: '../escape.exe' }] }), /Invalid/);
  assert.throws(() => validateReleaseIndex({ ...index, files: [{ ...index.files[0], url: 'https://untrusted.invalid/setup.exe' }] }), /Invalid/);
  const releaseRoot = 'https://github.com/leesom397-tech/goutoujunshi-h5/releases/download/';
  const mixedIndex = { ...index, version: '1.2.6', previousVersion: '1.2.5', tag: 'collector-1.2.6', files: [
    ...index.files.map(file => ({ ...file, name: file.name.replaceAll('1.2.5', '1.2.6'), url: file.url.replaceAll('1.2.5', '1.2.6') })),
    ...index.files.filter(file => file.name !== 'manifest.json'),
    { ...index.files[0], name: 'ChengziWeChatCollector-Setup-1.2.4.exe', url: `${releaseRoot}collector-1.2.5/ChengziWeChatCollector-Setup-1.2.4.exe` },
  ] };
  assert.equal(validateReleaseIndex(mixedIndex), mixedIndex, 'Versioned legacy assets reuse the verified previous release.');
  const changeFile = (name, change) => ({ ...mixedIndex, files: mixedIndex.files.map(file => file.name === name ? { ...file, ...change } : file) });
  assert.throws(() => validateReleaseIndex(changeFile('ChengziWeChatCollector-Setup-1.2.6.exe', {
    url: `${releaseRoot}collector-1.2.5/ChengziWeChatCollector-Setup-1.2.6.exe`,
  })), /Invalid/, 'A new installer must not load from an old tag.');
  assert.throws(() => validateReleaseIndex(changeFile('manifest.json', { url: `${releaseRoot}collector-1.2.5/manifest.json` })), /Invalid/);
  assert.throws(() => validateReleaseIndex({ ...mixedIndex, files: [...mixedIndex.files, {
    ...index.files[0], name: 'chengzi-wechat-collector-windows.zip', url: `${releaseRoot}collector-1.2.5/chengzi-wechat-collector-windows.zip`,
  }] }), /Invalid/, 'Generic ZIP aliases must use the current tag.');
  assert.throws(() => validateReleaseIndex(changeFile('ChengziWeChatCollector-Setup-1.2.5.exe', {
    url: 'https://untrusted.invalid/collector-1.2.5/ChengziWeChatCollector-Setup-1.2.5.exe',
  })), /Invalid/);
  assert.throws(() => validateReleaseIndex({ ...mixedIndex, files: [...mixedIndex.files, {
    ...index.files[0], name: 'ChengziWeChatCollector-Setup-1.2.7.exe', url: `${releaseRoot}collector-1.2.6/ChengziWeChatCollector-Setup-1.2.7.exe`,
  }] }), /Invalid/, 'Future versions cannot be inserted under the current tag.');
  assert.throws(() => validateReleaseIndex({ ...mixedIndex, previousVersion: '1.2.7' }), /Invalid/);
  console.log('PASS collector release sync: offline preloading, checksums, cache reuse, corrupt downloads, preservation and path/URL validation');
} finally {
  if (!resolve(base).startsWith(resolve(tmpdir()) + '\\chengzi-release-fixture-')
    && !resolve(base).startsWith(resolve(tmpdir()) + '/chengzi-release-fixture-')) throw Error('Refusing cleanup outside the generated fixture directory.');
  await rm(base, { recursive: true, force: true });
}
