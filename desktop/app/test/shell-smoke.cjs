/* Isolated native-shell UI test: real installed markup, synthetic IPC only. */
'use strict';
const { app, BrowserWindow, ipcMain, session, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { textContrast } = require('./ui-metrics.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.stage/shell-smoke');
const checks = {}, errors = [], calls = [], metrics = {}, consoleErrors = [];
let win, failNavigation = false, holdNavigation, pendingNavigation;
let state = { path: '/workspace', canGoBack: false, canGoForward: false, online: true, loading: false, failed: false, collectorStatus: 'stopped', version: 'synthetic-preview', message: '' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = source => win.webContents.executeJavaScript(source);
function assert(name, condition, detail) { checks[name] = !!condition; if (!condition) errors.push({ name, detail }); }
async function until(source, label) { for (let i = 0; i < 50; i++) { if (await js(source)) return; await pause(40); } throw new Error('Timed out: ' + label); }
function emit(patch = {}) { state = { ...state, ...patch }; win.webContents.send('shell:state', state); }
async function click(selector) { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function screenshot(name) { await pause(180); fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
async function geometry(name, width, height) {
  win.setSize(width, height); await pause(180);
  const result = await js(`(()=>{const controls=[...document.querySelectorAll('aside button,header button')].filter(e=>!e.hidden);return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,aside:document.querySelector('aside').getBoundingClientRect().toJSON(),header:document.querySelector('header').getBoundingClientRect().toJSON(),buttons:controls.map(e=>({name:e.getAttribute('aria-label')||e.textContent.trim(),rect:e.getBoundingClientRect().toJSON(),font:parseFloat(getComputedStyle(e).fontSize)}))}})()`);
  metrics[name] = result;
  assert(name + ' fits window width', result.scrollWidth <= result.width + 1, result);
  assert(name + ' navigation and history targets are 44px', result.buttons.every(button => button.rect.width >= 44 && button.rect.height >= 44), result.buttons);
  assert(name + ' all shell controls remain in viewport', result.buttons.every(button => button.rect.left >= 0 && button.rect.top >= 0 && button.rect.right <= result.width + 1 && button.rect.bottom <= result.height + 1), result.buttons);
  assert(name + ' navigation stays readable', result.buttons.every(button => button.font >= 14), result.buttons);
  assert(name + ' header aligns with sidebar', Math.abs(result.aside.right - result.header.left) < 1, result);
  await screenshot(name);
}
app.setPath('userData', path.join(os.tmpdir(), 'chengzi-shell-synthetic-' + process.pid));
protocol.registerSchemesAsPrivileged([{ scheme: 'chengzi', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  ipcMain.handle('shell:state', () => state);
  ipcMain.handle('shell:navigate', async (_event, route) => {
    calls.push({ kind: 'navigate', route });
    if (failNavigation) throw new Error('Synthetic route failure');
    if (holdNavigation) await new Promise(resolve => { pendingNavigation = resolve; });
    const paths = { home: '/workspace', capture: '/capture', reports: '/reports', people: '/archive', chat: '/chat', account: '/account' };
    emit({ path: paths[route], canGoBack: true });
  });
  ipcMain.handle('shell:action', (_event, action) => { calls.push({ kind: 'action', action }); if (action === 'dismiss') emit({ message: '' }); });
  const ses = session.fromPartition('shell-synthetic-' + process.pid);
  ses.webRequest.onBeforeRequest((request, callback) => callback({ cancel: !['chengzi:', 'file:', 'data:'].some(prefix => request.url.startsWith(prefix)) }));
  ses.protocol.handle('chengzi', request => {
    const url = new URL(request.url), files = { '/shell.html': 'renderer/shell.html', '/shell.css': 'renderer/shell.css', '/shell.js': 'renderer/shell.js', '/logo.png': 'assets/logo.png' };
    return url.host === 'app' && files[url.pathname] ? net.fetch(pathToFileURL(path.join(root, files[url.pathname])).href) : new Response('', { status: 404 });
  });
  win = new BrowserWindow({ show: false, width: 1380, height: 900, webPreferences: { session: ses, preload: path.join(root, 'shell-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', details => { if (details.level === 'error') consoleErrors.push(details.message); });
  await win.loadURL('chengzi://app/shell.html');
  await until(`document.querySelector('#version').textContent.includes('synthetic-preview')`, 'initial shell state');
  assert('initial route is selected once', await js(`document.querySelectorAll('[aria-current="page"]').length===1&&document.querySelector('[data-route="home"]').getAttribute('aria-current')==='page'`));
  assert('initial history actions are disabled', await js(`document.querySelector('#back').disabled&&document.querySelector('#forward').disabled`));
  assert('shell startup does not invoke navigation or collector actions', calls.length === 0, calls);
  await geometry('shell-wide', 1380, 900);
  await geometry('shell-minimum', 980, 680);
  metrics.contrast = await js(`(${textContrast.toString()})('aside :is(button,strong,span,small),header :is(button,span),#fallback :is(h1,p,.eyebrow)')`);
  assert('shell text meets contrast requirements', metrics.contrast.samples.length >= 10 && metrics.contrast.failures.length === 0, metrics.contrast.failures);
  await click('[data-route="reports"]');
  await until(`document.querySelector('[data-route="reports"]').getAttribute('aria-current')==='page'`, 'report navigation');
  assert('navigation updates location and back state', await js(`document.querySelector('#location').textContent.includes('报告')&&!document.querySelector('#back').disabled`));
  holdNavigation = true;
  const before = calls.length;
  await js(`document.querySelector('[data-route="people"]').click();document.querySelector('[data-route="people"]').click();document.querySelector('[data-route="chat"]').click()`);
  await until(`document.querySelector('[data-route="people"]').getAttribute('aria-busy')==='true'`, 'pending navigation');
  for (let i = 0; i < 50 && !pendingNavigation; i++) await pause(20);
  assert('pending navigation prevents duplicate or competing clicks', calls.length === before + 1, calls.slice(before));
  holdNavigation = false; pendingNavigation();
  await until(`!document.querySelector('[data-route="people"]').disabled`, 'navigation unlocks');
  failNavigation = true; await click('[data-route="chat"]');
  await until(`!document.querySelector('#notice').hidden&&!document.querySelector('[data-route="chat"]').disabled`, 'failed navigation recovers');
  assert('failed navigation clears busy state', await js(`!document.querySelector('[data-route="chat"]').hasAttribute('aria-busy')`));
  failNavigation = false;
  emit({ path: '/report', canGoBack: true, canGoForward: true, collectorStatus: 'ready', online: false });
  await until(`document.querySelector('#network').textContent.includes('未连接')`, 'offline state');
  assert('saved report route selects report navigation', await js(`document.querySelector('[data-route="reports"]').getAttribute('aria-current')==='page'`));
  assert('local collector state stays independent from network', await js(`document.querySelector('#collector').textContent.includes('就绪')`));
  await click('[data-action="setup"]');
  assert('collector setup is an explicit fixed action', calls.filter(call => call.action === 'setup').length === 1);
  await click('#back'); await click('#forward');
  assert('history buttons invoke fixed actions', calls.some(call => call.action === 'back') && calls.some(call => call.action === 'forward'));
  emit({ failed: true, message: '合成测试：暂时无法连接，请重试。' });
  await until(`!document.querySelector('#retry').hidden&&!document.querySelector('#notice').hidden`, 'failure retry');
  await click('#retry'); await click('[data-action="dismiss"]');
  await until(`document.querySelector('#notice').hidden`, 'notice dismissed');
  assert('failure offers retry without leaving the app', calls.some(call => call.action === 'reload'));
  await screenshot('shell-error-minimum');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert('shell respects reduced motion', await js(`[...document.querySelectorAll('button')].every(e=>getComputedStyle(e).transitionDuration.split(',').every(v=>parseFloat(v)<=.01))`));
  win.webContents.debugger.detach();
  assert('no shell renderer errors', consoleErrors.length === 0, consoleErrors);
  finish();
}).catch(error => { errors.push({ name: 'shell flow', detail: error.stack }); finish(); });
function finish() {
  const result = { ok: errors.length === 0, syntheticOnly: true, realNetworkUsed: false, realCollectorStarted: false, checks, errors, calls, metrics, consoleErrors };
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, checks: Object.keys(checks).length, errors, output })); win?.destroy(); app.exit(result.ok ? 0 : 1);
}
setTimeout(() => { errors.push({ name: 'shell timeout' }); finish(); }, 30000).unref();
