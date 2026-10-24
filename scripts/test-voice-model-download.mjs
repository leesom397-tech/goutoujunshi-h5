import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
const id = 'sensevoice-int8-2024-07-17';
const file = { id, name: 'fixed-model.tar.bz2', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/fixed-model.tar.bz2', bytes: 8, sha256: 'a'.repeat(64) };
async function load(entry, fixture) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', plugins: fixture ? [{ name: 'synthetic-public-model', setup(b) {
    b.onLoad({ filter: /[\\/]lib[\\/]voice-model-download\.ts$/ }, () => ({ contents: `const model=Object.freeze(${JSON.stringify(fixture)});export const fixedVoiceModelArchive=asset=>asset===model.id?model:null;`, loader: 'ts' }));
  } }] : [] });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const actual = await load('lib/voice-model-download.ts');
assert.equal(actual.fixedVoiceModelArchive(id), actual.voiceModelArchive);
assert.equal(actual.fixedVoiceModelArchive('https://evil.invalid'), null);
assert.equal(Object.isFrozen(actual.voiceModelArchive), true);
const python = fs.readFileSync('desktop/wechat-collector/local_voice_transcriber.py', 'utf8');
assert.ok(python.includes('ARCHIVE_BYTES = ' + actual.voiceModelArchive.bytes));
assert.ok(python.includes('ARCHIVE_SHA256 = "' + actual.voiceModelArchive.sha256 + '"'));
assert.ok(actual.voiceModelArchive.url.endsWith(actual.voiceModelArchive.name));
const { GET, HEAD } = await load('app/api/web/voice-model/route.ts', file);
const request = (headers = {}, signal) => new Request('https://example.test/api/web/voice-model?asset=' + id, { headers, signal });
const bytes = new TextEncoder().encode('BZmodel!');
const asset = (body = bytes, status = 200, headers = {}) => new Response(body, { status, headers: { 'content-type': 'application/octet-stream', ...headers } });
const originalFetch = globalThis.fetch;
let calls = [];
const mock = fn => { calls = []; globalThis.fetch = async (url, options) => { calls.push({ url: String(url), ...options }); return fn(url, options); }; };
try {
  mock(() => asset(bytes, 200, { 'content-length': '8', etag: '"model-1"' }));
  let response = await GET(request());
  assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(calls[0].url, file.url); assert.equal(calls[0].redirect, 'manual');
  assert.equal(calls[0].headers.get('accept-encoding'), 'identity');
  assert.equal(response.headers.get('content-length'), '8'); assert.equal(response.headers.get('x-checksum-sha256'), file.sha256);
  for (const query of ['', '?asset=other', '?asset=' + id + '&url=https://evil.invalid', '?asset=' + id + '&asset=' + id]) {
    mock(() => { throw Error('Must not fetch unlisted input'); });
    assert.equal((await GET(new Request('https://example.test/api/web/voice-model' + query))).status, 404); assert.equal(calls.length, 0);
  }
  for (const [input, expected] of [['bytes=2-4', 'bytes=2-4'], ['bytes=5-', 'bytes=5-7'], ['bytes=-3', 'bytes=5-7'], ['bytes=5-99', 'bytes=5-7'], ['bytes=-99', 'bytes=0-7']]) {
    const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(expected), part = bytes.slice(Number(a), Number(b) + 1);
    mock(() => asset(part, 206, { 'content-range': `bytes ${a}-${b}/8`, 'content-length': String(part.length) }));
    response = await GET(request({ range: input, 'if-range': '"model-1"' }));
    assert.equal(response.status, 206, input); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), part);
    assert.equal(calls[0].headers.get('range'), expected); assert.equal(calls[0].headers.get('if-range'), '"model-1"'); assert.match(response.headers.get('cache-control'), /no-store/);
  }
  for (const invalid of ['bytes=', 'bytes=-0', 'bytes=8-', 'bytes=4-3', 'bytes=0-2,4-6', 'items=0-2', 'bytes=9007199254740992-', 'bytes=a-b']) {
    mock(() => { throw Error('Must not fetch invalid range'); }); response = await GET(request({ range: invalid }));
    assert.equal(response.status, 416, invalid); assert.equal(response.headers.get('content-range'), 'bytes */8'); assert.equal(calls.length, 0);
  }
  mock(() => asset(bytes, 200, { 'content-length': '8' })); response = await GET(request({ range: 'bytes=2-', 'if-range': '"older"' }));
  assert.equal(response.status, 200); assert.equal((await response.arrayBuffer()).byteLength, 8);
  for (const [status, expected] of [[404, 404], [403, 502], [429, 502], [500, 502]]) { mock(() => new Response('upstream', { status })); assert.equal((await GET(request())).status, expected); }
  mock(() => new Response(null, { status: 416, headers: { 'content-range': 'bytes */8' } })); assert.equal((await GET(request({ range: 'bytes=2-' }))).status, 416);
  mock(() => new Response(null, { status: 416, headers: { 'content-range': 'bytes */9' } })); assert.equal((await GET(request({ range: 'bytes=2-' }))).status, 502);
  for (const [status, headers, range] of [[200, { 'content-length': '7' }, null], [200, { 'content-range': 'bytes 0-7/8' }, null], [200, { 'content-encoding': 'gzip' }, null], [200, { 'content-type': 'text/html' }, null], [206, { 'content-range': 'bytes 2-7/99' }, 'bytes=2-'], [206, { 'content-range': 'bytes 1-7/8' }, 'bytes=2-'], [206, { 'content-range': 'bytes 0-7/8' }, null]]) {
    mock(() => asset(bytes, status, headers)); assert.equal((await GET(request(range ? { range } : {}))).status, 502, JSON.stringify(headers));
  }
  mock(() => asset(bytes.slice(0, 7))); response = await GET(request()); await assert.rejects(() => response.arrayBuffer(), /ended early/);
  mock(() => asset(new Uint8Array(9))); response = await GET(request()); await assert.rejects(() => response.arrayBuffer(), /exceeded/);
  mock(() => { throw Error('network failed'); }); assert.equal((await GET(request())).status, 502);
  let redirected = false;
  mock(() => { if (!redirected) { redirected = true; return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/github-production-release-asset/test?signature=synthetic' } }); } return asset(bytes); });
  response = await GET(request()); assert.equal((await response.arrayBuffer()).byteLength, 8); assert.equal(calls.length, 2);
  for (const location of ['http://release-assets.githubusercontent.com/test', 'https://release-assets.githubusercontent.com.evil.invalid/test', 'https://user:pass@release-assets.githubusercontent.com/test', 'https://127.0.0.1/test', 'https://github.com/login', 'https://github.com/another/repository/releases/download/model/test', 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/other-model.tar.bz2']) {
    mock(() => new Response(null, { status: 302, headers: { location } })); assert.equal((await GET(request())).status, 502, location); assert.equal(calls.length, 1);
  }
  mock(() => new Response(null, { status: 302, headers: { location: file.url } })); assert.equal((await GET(request())).status, 502); assert.equal(calls.length, 5);
  let cancelled = false, upstreamSignal;
  mock((_url, options) => { upstreamSignal = options.signal; return asset(new ReadableStream({ pull(c) { c.enqueue(bytes.slice(0, 1)); }, cancel() { cancelled = true; } })); });
  response = await GET(request()); await response.body.cancel('download cancelled'); assert.equal(cancelled, true); assert.equal(upstreamSignal.aborted, true);
  const controller = new AbortController();
  mock((_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); }));
  const pending = GET(request({}, controller.signal)); controller.abort(); assert.equal((await pending).status, 502); assert.equal(calls[0].signal.aborted, true);
  mock(() => new Response(null, { status: 200, headers: { 'content-length': '8', 'content-type': 'application/octet-stream' } }));
  response = await HEAD(request()); assert.equal(response.status, 200); assert.equal(response.body, null); assert.equal(calls[0].method, 'HEAD');
  console.log('PASS voice model fixed allowlist, pin consistency, Range/If-Range/HEAD, redirects, truncation/overflow/type rejection and cancellation.');
} finally { globalThis.fetch = originalFetch; }
