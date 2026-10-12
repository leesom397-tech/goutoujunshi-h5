import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
const source = ts.transpileModule(readFileSync('lib/desktop-bridge-client.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const origin = 'https://coach.lovetalk.love', requests = [];
const server = createServer((request, response) => {
  requests.push({ method: request.method, url: request.url, origin: request.headers.origin, auth: request.headers.authorization, cookie: request.headers.cookie });
  if (request.headers.origin !== origin) { response.writeHead(403); response.end(); return; }
  response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); response.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (request.method === 'OPTIONS') { response.setHeader('Access-Control-Allow-Methods', 'GET, POST'); response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); response.writeHead(204); response.end(); return; }
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/jobs/redirect') { response.writeHead(302, { Location: origin + '/private-test' }); response.end(); return; }
  if (request.url === '/jobs/not-json') { response.end('not-json'); return; }
  if (request.url === '/jobs/malformed') { response.end('[]'); return; }
  if (request.url === '/jobs/denied') { response.writeHead(401); response.end(JSON.stringify({ error: '配对码已失效，请重新配对。' })); return; }
  if (request.url === '/jobs/delay') { const timer = setTimeout(() => response.end(JSON.stringify({ ok: true })), 2000); response.on('close', () => clearTimeout(timer)); return; }
  if (request.url === '/capture' && request.headers.authorization !== 'Bearer synthetic-token') { response.writeHead(401); response.end('{}'); return; }
  response.end(JSON.stringify({ version: 'test', ready: true, capabilities: { chat: true, moments: true } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(), cdp = await browser.target().createCDPSession();
  await page.setRequestInterception(true);
  page.on('request', request => { if (request.isNavigationRequest()) return request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic HTTPS bridge test</title>' }); return request.continue(); });
  // No connection to production occurs: only the main synthetic HTTPS document is fulfilled above.
  await page.goto(origin + '/__synthetic_capture_test');
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  await page.evaluate(code => { window.__bridge = {}; new Function('exports', code)(window.__bridge); }, source.replace('127.0.0.1:17863', '127.0.0.1:' + port));
  await cdp.send('Browser.setPermission', { permission: { name: 'loopback-network' }, setting: 'denied', origin });
  const denied = await page.evaluate(async () => { try { await window.__bridge.bridgeRequest('/health'); return ''; } catch (error) { return error.message; } });
  assert.match(denied, /本机.*本地网络访问|本地网络访问/);
  assert.equal(requests.length, 0, 'denied loopback permission must prevent actual requests');
  await cdp.send('Browser.setPermission', { permission: { name: 'loopback-network' }, setting: 'granted', origin });
  const health = await page.evaluate(() => window.__bridge.bridgeRequest('/health')); assert.equal(health.ready, true);
  const capture = await page.evaluate(() => window.__bridge.bridgeRequest('/capture', { token: 'synthetic-token', body: { kind: 'chat', friend: '合成联系人' } })); assert.equal(capture.ready, true);
  assert.ok(requests.some(request => request.method === 'OPTIONS' && request.url === '/capture'));
  assert.ok(requests.some(request => request.method === 'POST' && request.auth === 'Bearer synthetic-token'));
  assert.ok(requests.every(request => request.origin === origin && !request.cookie), 'exact origin and no credentials');
  const errors = await page.evaluate(async () => {
    const result = {};
    for (const path of ['/jobs/redirect', '/jobs/not-json', '/jobs/malformed', '/jobs/denied', '//elsewhere']) { try { await window.__bridge.bridgeRequest(path); result[path] = ''; } catch (error) { result[path] = error.message; } }
    const controller = new AbortController(); setTimeout(() => controller.abort(), 30);
    try { await window.__bridge.bridgeRequest('/jobs/delay', { signal: controller.signal }); } catch (error) { result.cancel = error.name; }
    // Verify supplied signals do not disable the independent timeout.
    const originalTimeout = window.setTimeout; window.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms === 12000 ? 40 : ms, ...args);
    try { await window.__bridge.bridgeRequest('/jobs/delay', { signal: new AbortController().signal }); } catch (error) { result.timeout = error.message; }
    finally { window.setTimeout = originalTimeout; }
    return result;
  });
  assert.match(errors['/jobs/redirect'], /未能连接/); assert.match(errors['/jobs/not-json'], /数据格式/); assert.match(errors['/jobs/malformed'], /无法识别/); assert.match(errors['/jobs/denied'], /配对码已失效/); assert.match(errors['//elsewhere'], /地址无效/); assert.equal(errors.cancel, 'AbortError'); assert.match(errors.timeout, /超时/);
  console.log(`PASS ${await browser.version()}: synthetic HTTPS origin → real HTTP loopback with LNA denied/granted, strict CORS preflight, token, no cookies, redirects blocked, bad JSON/errors, abort and timeout`);
  console.log('LIMIT: a strict synthetic loopback service was used; no real WeChat data or installed helper was queried.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
