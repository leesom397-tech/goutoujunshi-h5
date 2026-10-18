import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_ROOT = 'https://github.com/leesom397-tech/goutoujunshi-h5/releases/download/';
const LEGACY_RELEASES = new Map([['1.2.4', 'collector-1.2.5'], ['1.2.5', 'collector-1.2.5'], ['1.2.6', 'collector-1.2.6'], ['1.2.7', 'collector-1.2.7']]);

function compareVersions(left, right) {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function assetUrlAllowed(file, index) {
  const version = /^(?:ChengziWeChatCollector-Setup-|chengzi-wechat-collector-(?:windows-)?|manifest-)(\d+\.\d+\.\d+)[.-]/.exec(file.name)?.[1];
  if (version && compareVersions(version, index.version) > 0) return false;
  if (file.url === `${RELEASE_ROOT}${index.tag}/${file.name}`) return true;
  // Only explicitly pinned, immutable older-version files may reuse the
  // previously published release. Generic aliases and new files stay pinned
  // to the current tag, preventing an old installer from silently returning.
  const legacyTag = version && compareVersions(version, index.version) < 0 && LEGACY_RELEASES.get(version);
  return Boolean(legacyTag && file.url === `${RELEASE_ROOT}${legacyTag}/${file.name}`);
}

export function validateReleaseIndex(value) {
  if (!value || value.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(value.version || '')
    || value.tag !== `collector-${value.version}` || !Array.isArray(value.files) || !value.files.length || value.files.length > 100) {
    throw Error('Invalid collector release index.');
  }
  if (value.previousVersion !== undefined && (!/^\d+\.\d+\.\d+$/.test(value.previousVersion) || compareVersions(value.previousVersion, value.version) >= 0)) {
    throw Error('Invalid previous collector release version.');
  }
  const names = new Set();
  for (const file of value.files) {
    if (!file || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(file.name || '') || names.has(file.name)
      || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 25 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(file.sha256 || '')
      || !assetUrlAllowed(file, value)) throw Error('Invalid collector release asset.');
    names.add(file.name);
  }
  for (const name of [`ChengziWeChatCollector-Setup-${value.version}.exe`, `manifest-${value.version}.json`, 'manifest.json']) {
    if (!names.has(name)) throw Error(`Collector release is missing ${name}.`);
  }
  if (value.previousVersion) {
    for (const name of [`ChengziWeChatCollector-Setup-${value.previousVersion}.exe`, `manifest-${value.previousVersion}.json`]) {
      if (!names.has(name)) throw Error(`Previous collector release is missing ${name}.`);
    }
  }
  return value;
}

async function matches(path, file) {
  try {
    if ((await stat(path)).size !== file.bytes) return false;
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    return digest.digest('hex') === file.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function download(file, target, fetchImpl) {
  const response = await fetchImpl(file.url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'chengzi-collector-release-sync' } });
  if (!response.ok || !response.body) throw Error(`Collector asset ${file.name}: HTTP ${response.status}. Publish the GitHub release before building.`);
  const digest = createHash('sha256');
  let bytes = 0;
  const verify = new Transform({ transform(chunk, encoding, done) {
    bytes += chunk.length;
    if (bytes > file.bytes) { done(Error(`Collector asset ${file.name} exceeds its declared size.`)); return; }
    digest.update(chunk);
    done(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(target, { flags: 'wx' }));
  if (bytes !== file.bytes || digest.digest('hex') !== file.sha256) throw Error(`Collector asset ${file.name} failed SHA-256 verification.`);
}

async function verifyManifest(outputDir, index, version) {
  const manifest = JSON.parse(await readFile(resolve(outputDir, `manifest-${version}.json`), 'utf8'));
  const latest = version === index.version ? JSON.parse(await readFile(resolve(outputDir, 'manifest.json'), 'utf8')) : manifest;
  if (manifest.version !== version || JSON.stringify(latest) !== JSON.stringify(manifest) || !Array.isArray(manifest.parts) || !manifest.parts.length) {
    throw Error(`Collector ${version} manifest does not match the pinned release.`);
  }
  const files = new Map(index.files.map(file => [file.name, file]));
  const archiveHash = createHash('sha256');
  let total = 0;
  for (const part of manifest.parts) {
    const file = files.get(part.name);
    if (!file || file.bytes !== part.bytes || file.sha256 !== part.sha256) throw Error('Collector manifest references an unpinned archive part.');
    for await (const chunk of createReadStream(resolve(outputDir, file.name))) archiveHash.update(chunk);
    total += part.bytes;
  }
  if (total !== manifest.bytes || archiveHash.digest('hex') !== manifest.sha256) throw Error('Collector archive failed complete SHA-256 verification.');
}

export async function syncCollectorDownloads({
  indexPath = resolve(ROOT, 'public/downloads/collector-release.json'),
  outputDir = resolve(ROOT, 'public/downloads'),
  assetDir = process.env.COLLECTOR_RELEASE_ASSET_DIR,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const index = validateReleaseIndex(JSON.parse(await readFile(indexPath, 'utf8')));
  await mkdir(outputDir, { recursive: true });
  let reused = 0, copied = 0, downloaded = 0;
  // Keep concurrent downloads bounded for Cloudflare build memory and disk use.
  const pending = [...index.files];
  const results = await Promise.allSettled(Array.from({ length: 3 }, async () => {
    while (pending.length) {
      const file = pending.shift();
      const target = resolve(outputDir, file.name);
      if (await matches(target, file)) { reused++; continue; }
      const temporary = `${target}.sync-${randomUUID()}.tmp`;
      try {
        if (assetDir) {
          const local = resolve(assetDir, file.name);
          if (!await matches(local, file)) throw Error(`Local collector asset ${file.name} is missing or has a different SHA-256. No network fallback was attempted.`);
          await copyFile(local, temporary);
          if (!await matches(temporary, file)) throw Error(`Local collector asset ${file.name} changed during copying.`);
          copied++;
        } else {
          await download(file, temporary, fetchImpl);
          downloaded++;
        }
        await rename(temporary, target);
      } catch (error) {
        pending.length = 0;
        throw error;
      } finally {
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    }
  }));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  await verifyManifest(outputDir, index, index.version);
  if (index.previousVersion) await verifyManifest(outputDir, index, index.previousVersion);
  log(`Collector ${index.version}${index.previousVersion ? ` (retaining ${index.previousVersion})` : ''}: ${reused} verified existing, ${copied} copied, ${downloaded} downloaded. Installer and archive checksums verified.`);
  return { version: index.version, reused, copied, downloaded };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncCollectorDownloads().catch(error => { console.error(error.message); process.exitCode = 1; });
}
