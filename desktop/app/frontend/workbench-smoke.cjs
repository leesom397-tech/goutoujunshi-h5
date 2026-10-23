/* Run with Electron after frontend:build. Only synthetic accounts and local
   protocol responses are used; no host collector, real account or network. */
const { app, BrowserWindow, session, ipcMain } = require('electron');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { textContrast } = require('../test/ui-metrics.cjs');
const root = path.resolve(__dirname, '../frontend-dist');
const output = path.resolve(__dirname, '../.stage/workbench-smoke');
const origin = 'https://coach.lovetalk.love';
const local = 'http://127.0.0.1:17863';
const avatarPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN84AAAAASUVORK5CYII=', 'base64');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const people = [{ id: 'demo-person-a', label: '演示小林', avatar: 'https://wx.qlogo.cn/synthetic-avatar.png' }, { id: 'demo-person-b', label: '演示小雨', avatar: 'data:image/png;base64,' + avatarPng.toString('base64') }];
const reports = Array.from({ length: 16 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  kind: 'chat', label: i % 2 ? '演示小雨' : '演示小林',
  summary: `合成测试报告 ${i + 1}：根据最近互动整理判断和下一步。`,
  createdAt: 1792713600000 - i * 86400000,
  ...(i === 2 ? { format: 'risk' } : i === 3 ? { analysisScope: 'supplement' } : {}),
}));
const errors = [], checks = {}, requests = [], missingAssets = [], consoleErrors = [], nativeCalls = [], computedStyles = {}, renderedFonts = {}, contrastMetrics = {};
const minimumWidth = 772, minimumHeight = 616; // 980×680 app, 208px sidebar and 64px toolbar.
let win, pairAttempts = 0, accountMode = 'signed-in';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function assert(name, value, detail) { checks[name] = !!value; if (!value) errors.push({ name, detail }); }
const json = (data, status = 200) => Response.json(data, { status, headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-private-network': 'true' } });
const js = source => win.webContents.executeJavaScript(source);
async function until(source, label, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await js(source); if (value) return value; await pause(70); }
  throw new Error('Timed out: ' + label);
}
async function click(selector) {
  return js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return false;e.click();return true})()`);
}
async function input(selector, value) {
  return js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
}
async function navigate(route) {
  await js(`window.dispatchEvent(new CustomEvent('chengzi:desktop-navigate',{detail:${JSON.stringify(route)}}))`);
  await until(`location.pathname+location.search===${JSON.stringify(route)}`, route);
}
async function screenshot(name) {
  await pause(650);
  await writeFile(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
async function layout(name, width, height) {
  win.setSize(width, height); await pause(200);
  const result = await js(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,focus:[...document.querySelectorAll('.dw-primary,.dw-report-item,.dw-search input')].filter(e=>e.getBoundingClientRect().height>0).slice(0,8).map(e=>({tag:e.tagName,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))})`);
  assert(name + ' no horizontal overflow', result.scrollWidth <= result.width + 1, result);
  const contrastSelector = name.startsWith('home') ? '.dw-home :is(h1,h2,p,.dw-muted,.dw-eyebrow,.dw-row-copy strong,.dw-row-copy>span,.dw-row-copy small,.dw-person strong,.dw-person small,.dw-primary,.dw-button)' : name.startsWith('report') ? '.dw-report-rail :is(h1,strong,p,time,.dw-report-type,.dw-rail-caption span,input),.dw-reading-title>span,.dw-reading-title small,.dw-reading-toggle,.dw-library-empty :is(h2,p),.dw-report-body :is(h1,h2,h3,p)' : '.dw-capture :is(h1,h2,p,label,button,.dw-capture-foot span,.dw-capture-foot a),.dw-capture-steps strong';
  contrastMetrics[name] = await js(`(${textContrast.toString()})(${JSON.stringify(contrastSelector)})`);
  assert(name + ' text meets contrast requirements', contrastMetrics[name].samples.length >= 3 && contrastMetrics[name].failures.length === 0, contrastMetrics[name].failures);
  const primaryTargets = await js(`[...document.querySelectorAll('.dw-primary')].filter(e=>e.getBoundingClientRect().height>0).map(e=>({text:e.textContent.trim(),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))`);
  assert(name + ' primary actions retain usable target size', primaryTargets.every(target => target.width >= 42 && target.height >= 42), primaryTargets);
  computedStyles[name] = await js(`['.dw-people h2','.dw-person strong','.dw-capture-surface [class*="selectedPerson"] span'].flatMap(selector=>[...document.querySelectorAll(selector)].map(e=>({selector,text:e.textContent.trim().slice(0,65),fontFamily:getComputedStyle(e).fontFamily,fontSize:getComputedStyle(e).fontSize,color:getComputedStyle(e).color})))`);
  renderedFonts[name] = await platformFonts();
  await screenshot(name);
}
async function platformFonts() {
  const selectors = ['.dw-people h2', '.dw-person strong', '.dw-capture-surface [class*="selectedPerson"] div>span'];
  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('DOM.enable');
    await win.webContents.debugger.sendCommand('CSS.enable');
    const { root: document } = await win.webContents.debugger.sendCommand('DOM.getDocument');
    const result = [];
    for (const selector of selectors) {
      const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: document.nodeId, selector });
      if (nodeId) result.push({ selector, ...(await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId })) });
    }
    return result;
  } finally { win.webContents.debugger.detach(); }
}
async function captureReadability(name) {
  const result = await js(`(()=>{const selectors='.dw-capture :is(p,label,button,.dw-primary),.dw-capture-steps strong';return [...document.querySelectorAll(selectors)].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&e.textContent.trim()}).map(e=>({text:e.textContent.trim().slice(0,65),size:parseFloat(getComputedStyle(e).fontSize),color:getComputedStyle(e).color})).filter(e=>e.size<14)})()`);
  assert(name + ' body copy at least 14px', result.length === 0, result);
}
async function visibleCapturePrimary(name) {
  const result = await js(`(()=>{const e=[...document.querySelectorAll('.dw-capture button')].find(e=>e.textContent.includes('连接本机微信')&&!e.disabled);if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,viewport:[innerWidth,innerHeight]}})()`);
  assert(name + ' connect action is visible and usable', !!result && result.left >= 0 && result.right <= result.viewport[0] && result.top >= 0 && result.bottom <= result.viewport[1] && result.height >= 42, result);
}
async function searchShortcut(name) {
  await js(`window.__searchFocus=[...document.querySelectorAll('.web-search-trigger')].find(e=>e.getClientRects().length>0);window.__searchFocus?.focus()`);
  await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',ctrlKey:true,bubbles:true,cancelable:true}))`);
  await until(`document.querySelectorAll('dialog[open]').length>0`, name + ' shortcut opens search');
  const count = await js(`document.querySelectorAll('dialog[open]').length`);
  assert(name + ' Ctrl+K opens exactly one dialog', count === 1, { count });
  await click('dialog[open] button[aria-label="关闭搜索"]');
  await until(`document.querySelectorAll('dialog[open]').length===0`, name + ' shortcut dialog closes');
  assert(name + ' shortcut dialog closes completely', await js(`document.querySelectorAll('dialog[open]').length===0`));
  assert(name + ' shortcut restores the prior focus', await js(`!!window.__searchFocus&&document.activeElement===window.__searchFocus`));
}
async function readingMode(name) {
  const before = requests.filter(request => request.path === '/api/web/report').length;
  await js(`window.__reader=document.querySelector('.dw-report-body');window.__reader.scrollTop=120;window.__readerScroll=window.__reader.scrollTop;window.__pageLabel=document.querySelector('.dw-page-controls')?.textContent;window.__filter=document.querySelector('.dw-search input').value;window.__listNode=document.querySelector('.dw-report-rail');void 0`);
  for (let turn = 0; turn < 2; turn++) {
    const previous = await js(`document.querySelector('.dw-reports').classList.contains('is-focused')`);
    await click('.dw-reading-toggle');
    await until(`document.querySelector('.dw-reports').classList.contains('is-focused')===${!previous}`, name + ' reading mode toggles');
    await pause(250);
    assert(name + ' mode ' + turn + ' preserves report instance and scroll', await js(`document.querySelector('.dw-report-body')===window.__reader&&Math.abs(window.__reader.scrollTop-window.__readerScroll)<2`));
    assert(name + ' mode ' + turn + ' preserves list query and pagination', await js(`document.querySelector('.dw-report-rail')===window.__listNode&&document.querySelector('.dw-search input').value===window.__filter&&document.querySelector('.dw-page-controls')?.textContent===window.__pageLabel`));
  }
  assert(name + ' reading mode never reloads report data', requests.filter(request => request.path === '/api/web/report').length === before);
}
function savedReport(id) {
  const item = reports.find(row => row.id === id);
  if (!item) return json({ error: '演示报告不存在' }, 404);
  return json({ ...item, reportId: id, report: { id, reportId: id, subjectId: people[0].id,
    participants: { self: '我', other: item.label },
    decision: { judgment: item.summary, possibleIntent: '继续了解彼此', nextStep: '周末再聊具体安排。', replyOptions: [] },
    lines: Array.from({ length: 20 }, (_, i) => ({ id: 'line-' + i, speaker: i % 2 ? 'self' : 'other', text: `合成原话 ${i + 1}：这个周末你想去哪里走走？` })),
    annotations: [], generatedAt: new Date(item.createdAt).toISOString(),
  } });
}
async function handler(request) {
  const url = new URL(request.url);
  if (![origin, local].includes(url.origin)) return json({ error: 'No network in synthetic test' }, 503);
  if (url.origin === local) {
    requests.push({ path: url.pathname, method: request.method, local: true });
    if (request.method === 'OPTIONS') return json({});
    if (url.pathname === '/health') return json({ version: '1.2.23', platform: 'win32', ready: true, backgroundStatus: 'ready', capabilities: { chat: true, moments: true, backgroundChat: true, backgroundHistory: true, contactPagination: true } });
    if (url.pathname === '/pair/handoff') {
      pairAttempts++;
      return pairAttempts === 1 ? json({ error: { code: 'HANDOFF_INVALID', message: '连接已失效，请在本机助手重新点击打开网页并连接。' } }, 401) : json({ token: 'synthetic-only-token', expiresIn: 60 });
    }
    if (url.pathname === '/session') return json({ connected: true, expiresIn: 60 });
    if (url.pathname === '/contacts/search') return json({ accountKey: 'synthetic-account', contacts: [{ contactId: 'synthetic-contact', label: '演示小林', nickname: '演示小林', remark: '演示小林', wechatId: 'synthetic-contact', avatarData: 'data:image/png;base64,AAAA', avatarUrl: 'https://wx.qlogo.cn/synthetic-avatar.png' }], hasMore: false });
    return json({ error: 'Synthetic test does not start capture jobs' }, 503);
  }
  if (url.pathname === '/_desktop/contact-avatar') {
    requests.push({ path: url.pathname, method: request.method, local: false });
    return url.searchParams.get('url') === 'https://wx.qlogo.cn/synthetic-avatar.png' ? new Response(avatarPng, { headers: { 'content-type': 'image/png' } }) : new Response('', { status: 403 });
  }
  if (url.pathname.startsWith('/api/')) {
    requests.push({ path: url.pathname, query: url.search, method: request.method, local: false });
    if (request.method !== 'GET') return json({ error: 'Synthetic test does not mutate server state' }, 405);
    if (url.pathname === '/api/web/account-context') {
      if (accountMode === 'signed-out') return json({ error: '请登录后继续。' }, 401);
      if (accountMode === 'unavailable') return json({ error: '账户服务暂时未连接，请重试。' }, 503);
      return json({ account: { userId: 'desktop-synthetic-test-owner', balance: 100, reserved: 0, spent: 0, features: ['analysis', 'chat'], active: true, enabledUntil: 1893456000000, signupCredits: 0, entries: [] }, user: { name: '合成测试账户' }, admin: false, people, prices: {} });
    }
    if (url.pathname === '/api/account/credits') return json({ account: { userId: 'desktop-synthetic-test-owner' }, balance: 100, prices: {} });
    if (url.pathname === '/api/web/profile') return json({ enabled: true, paused: false, self: {}, subjects: people.map(person => ({ ...person, updatedAt: 1792713600000 })), facts: [], signals: [], trends: [] });
    if (url.pathname === '/api/web/report/list') {
      const q = url.searchParams.get('q') || '', page = Math.max(1, Number(url.searchParams.get('page')) || 1);
      if (q === '慢') await pause(420);
      const rows = reports.filter(row => (row.label + row.summary).includes(q));
      return json({ reports: rows.slice((page - 1) * 12, page * 12), total: rows.length, page, pageSize: 12 });
    }
    if (url.pathname === '/api/web/report') return savedReport(url.searchParams.get('id'));
    if (url.pathname === '/api/web/workspace') return json({ people, reports, tasks: [], balances: { credits: 100 } });
    if (url.pathname.includes('capture/library')) return url.searchParams.has('reportId')
      ? json({ ownerId: 'desktop-synthetic-test-owner', error: '这份演示报告没有关联导入资料。' }, 404)
      : json({ ownerId: 'desktop-synthetic-test-owner', libraries: [], nextCursor: null });
    if (url.pathname.includes('capture/task')) return json({ jobs: [] });
    return json({ enabled: true, subjects: people, libraries: [], rows: [], items: [], reports: [], tasks: [] });
  }
  const routes = JSON.parse(await readFile(path.join(root, 'routes.json'), 'utf8'));
  const resource = routes.includes(url.pathname) ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const filename = path.resolve(root, resource);
  if (!filename.startsWith(root + path.sep)) return new Response('', { status: 403 });
  try { return new Response(await readFile(filename), { headers: { 'content-type': mime[path.extname(filename)] || 'application/octet-stream' } }); }
  catch { missingAssets.push(url.pathname); return new Response('', { status: 404 }); }
}
app.setPath('userData', path.join(os.tmpdir(), 'chengzi-workbench-synthetic-' + process.pid));
app.whenReady().then(async () => {
  await mkdir(output, { recursive: true });
  const preload = path.join(output, 'synthetic-preload.cjs');
  ipcMain.handle('synthetic-workbench-native', (_event, operation) => {
    nativeCalls.push(operation);
    return operation === 'connect' ? { handoff: 's'.repeat(43) } : { opened: true };
  });
  await writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('chengziDesktop',{connectCollector:()=>ipcRenderer.invoke('synthetic-workbench-native','connect'),openCollectorSetup:()=>ipcRenderer.invoke('synthetic-workbench-native','setup'),getRuntimeState:async()=>({platform:'win32',version:'synthetic',collectorStatus:'stopped'})});`);
  const ses = session.fromPartition('synthetic-workbench-' + process.pid);
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: ![origin + '/', local + '/', 'data:', 'blob:'].some(prefix => details.url.startsWith(prefix)) }));
  await ses.protocol.handle('https', handler); await ses.protocol.handle('http', handler);
  win = new BrowserWindow({ show: false, width: 1184, height: 836, webPreferences: { session: ses, preload, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', details => { if (details.level === 'error' && !/status of 401|net::ERR_BLOCKED_BY_CLIENT/.test(details.message)) consoleErrors.push(details.message.slice(0, 500)); });
  accountMode = 'signed-out';
  await win.loadURL(origin + '/capture?method=desktop');
  await until(`document.querySelectorAll('.dw-capture a[href^="/login"]').length>0`, 'signed-out capture gate');
  await pause(300);
  assert('signed-out capture has one login action', await js(`document.querySelectorAll('.dw-capture a[href^="/login"]').length===1`));
  assert('signed-out capture omits collector controls and underlying capture', await js(`!document.querySelector('[data-desktop-capture-step]')&&![...document.querySelectorAll('.dw-capture button')].some(e=>/连接本机微信|本机采集设置/.test(e.textContent))`));
  assert('signed-out capture cannot start native service', nativeCalls.length === 0 && requests.every(row => !row.local), { nativeCalls: [...nativeCalls], localRequests: requests.filter(row => row.local) });
  await layout('capture-signed-out-minimum', minimumWidth, minimumHeight);
  await captureReadability('signed-out capture');
  accountMode = 'unavailable';
  await win.loadURL(origin + '/capture?method=desktop');
  await until(`[...document.querySelectorAll('.dw-capture button')].some(e=>/重新连接|重试/.test(e.textContent)&&!e.disabled)`, 'account failure retry');
  assert('account network error does not suggest signing in', await js(`document.querySelectorAll('.dw-capture a[href^="/login"]').length===0&&!document.querySelector('[data-desktop-capture-step]')&&!/请先登录|登录后|登录账户/.test(document.querySelector('.dw-capture').innerText)`));
  assert('account network error cannot start native service', nativeCalls.length === 0 && requests.every(row => !row.local));
  await screenshot('capture-account-error');
  await captureReadability('account failure');
  accountMode = 'signed-in';
  await js(`[...document.querySelectorAll('.dw-capture button')].find(e=>/重新连接|重试/.test(e.textContent)&&!e.disabled)?.click()`);
  await until(`!!document.querySelector('[data-desktop-capture-step="0"]')&&[...document.querySelectorAll('button')].some(e=>e.textContent.includes('连接本机微信')&&!e.disabled)`, 'retry restores authenticated capture');
  assert('account retry recovers without a login redirect', await js(`location.pathname==='/capture'&&document.querySelectorAll('.dw-capture a[href^="/login"]').length===0`));
  assert('account retry does not silently start collector', nativeCalls.length === 0);
  await layout('capture-authenticated-minimum', minimumWidth, minimumHeight);
  await captureReadability('authenticated capture');
  await visibleCapturePrimary('minimum capture');
  assert('minimum capture footer is visible without empty page height', await js(`(()=>{const e=document.querySelector('.dw-capture-foot'),r=e?.getBoundingClientRect();return !!r&&r.top>=0&&r.bottom<=innerHeight})()`));
  await searchShortcut('authenticated capture');
  await win.loadURL(origin + '/workspace');
  await until(`document.querySelectorAll('.dw-recent-row').length===4`, 'real synthetic recent reports');
  assert('home shows actual API people', await js(`document.querySelectorAll('.dw-person').length===2`));
  assert('home person names are at least 15px', await js(`[...document.querySelectorAll('.dw-person strong')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=15)`));
  assert('home import action links to capture', await js(`document.querySelector('.dw-start a')?.getAttribute('href')==='/capture?method=desktop'`));
  await layout('home-wide', 1184, 836);
  await layout('home-minimum', minimumWidth, minimumHeight);
  await click('.dw-toolbar .web-search-trigger');
  assert('search dialog opens', await until(`!!document.querySelector('dialog[open] #quick-search-field')`, 'search'));
  await click('button[aria-label="关闭搜索"]');
  await navigate('/reports');
  await until(`document.querySelectorAll('.dw-report-item').length===12`, 'report list');
  assert('report list heading and body are readable', await js(`[...document.querySelectorAll('.dw-report-item strong')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=15)&&[...document.querySelectorAll('.dw-report-item p')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=14)`));
  assert('list count comes from API', await js(`document.querySelector('.dw-report-rail header').textContent.includes('16')`));
  await input('.dw-search input', '小林');
  await until(`document.querySelectorAll('.dw-report-item').length===8`, 'filtered reports');
  await js(`window.__syntheticRail=document.querySelector('.dw-report-rail');window.__syntheticSearch=document.querySelector('.dw-search input');document.querySelector('.dw-report-items').scrollTop=170;window.__syntheticRailScroll=document.querySelector('.dw-report-items').scrollTop;window.__syntheticDocument='retained'`);
  await click('.dw-report-item');
  await until(`!!document.querySelector('[data-report-mode]')`, 'saved report reader');
  assert('small window opens report in focused reading mode', await js(`document.querySelector('.dw-reports').classList.contains('is-focused')&&document.querySelector('.dw-reading-toggle').getAttribute('aria-label')==='显示报告列表'`));
  assert('selection keeps list instance and query', await js(`document.querySelector('.dw-report-rail')===window.__syntheticRail&&document.querySelector('.dw-search input')===window.__syntheticSearch&&document.querySelector('.dw-search input').value==='小林'`));
  await readingMode('filtered report');
  await click('.dw-reading-toggle');
  await until(`document.querySelector('.dw-report-rail').getBoundingClientRect().width>0`, 'report list revealed');
  assert('selection preserves rail scroll after revealing list', await js(`Math.abs(document.querySelector('.dw-report-items').scrollTop-window.__syntheticRailScroll)<2`));
  await click('.dw-reading-toggle');
  assert('selected row is marked', await js(`document.querySelector('.dw-report-item[aria-current="page"]')?.getAttribute('href')===location.pathname+location.search`));
  await layout('report-minimum', minimumWidth, minimumHeight);
  assert('minimum report shows the complete first judgment above the fold', await js(`(()=>{const r=document.querySelector('[data-report-decision-summary] h2')?.getBoundingClientRect();return !!r&&r.top>=64&&r.bottom<=innerHeight})()`));
  await layout('report-wide', 1184, 836);
  await searchShortcut('open report');
  await js(`window.history.back()`);
  await until(`location.pathname==='/reports'&&!document.querySelector('.dw-report-body')`, 'back to report list');
  assert('back retains filtered list', await js(`document.querySelector('.dw-search input').value==='小林'&&document.querySelector('.dw-report-rail')===window.__syntheticRail`));
  await input('.dw-search input', '慢'); await pause(230); await input('.dw-search input', '小雨');
  await until(`document.querySelectorAll('.dw-report-item').length===8&&[...document.querySelectorAll('.dw-report-item')].every(e=>e.textContent.includes('小雨'))`, 'latest search results');
  await pause(500);
  assert('stale search cannot replace latest results', await js(`document.querySelectorAll('.dw-report-item').length===8&&[...document.querySelectorAll('.dw-report-item')].every(e=>e.textContent.includes('小雨'))`));
  await input('.dw-search input', ''); await until(`document.querySelectorAll('.dw-report-item').length===12&&!document.querySelector('[aria-label="下一页"]')?.disabled`, 'restore all reports');
  await click('[aria-label="下一页"]'); await until(`document.querySelectorAll('.dw-report-item').length===4`, 'report pagination');
  assert('pagination shows second page', await js(`document.querySelector('.dw-page-controls').textContent.includes('2 / 2')`));
  await click('.dw-report-item');
  await until(`!!document.querySelector('[data-report-mode]')`, 'second page report');
  await readingMode('second-page report');
  await navigate('/capture?method=desktop');
  await until(`!!document.querySelector('[data-desktop-capture-step="0"]')&&[...document.querySelectorAll('button')].some(e=>e.textContent.includes('连接本机微信')&&!e.disabled)`, 'desktop capture entry');
  assert('capture stage 1 matches source', await js(`document.querySelector('.dw-capture-steps [aria-current="step"]')?.textContent.includes('连接微信')`));
  assert('capture uses one content column', await js(`!document.querySelector('.dw-capture-rail')&&!!document.querySelector('.dw-capture-steps')`));
  await screenshot('capture-connect');
  await js(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('连接本机微信'))?.click()`);
  await until(`document.body.innerText.includes('连接已失效')`, 'synthetic handoff failure');
  assert('native pairing failure has in-app recovery', await js(`document.body.innerText.includes('本机采集连接已失效')&&!document.body.innerText.includes('重新点击打开网页')`));
  assert('pair failure clears busy hint', await js(`![...document.querySelectorAll('[role="status"]')].some(e=>e.textContent.includes('正在准备本机采集'))&&[...document.querySelectorAll('button')].some(e=>e.textContent.includes('连接本机微信')&&!e.disabled)`));
  await js(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('连接本机微信'))?.click()`);
  await until(`!!document.querySelector('[data-desktop-capture-step="1"]')`, 'paired capture stage');
  assert('capture stage 2 reflects successful pairing', await js(`document.querySelector('.dw-capture-steps [aria-current="step"]')?.textContent.includes('选择好友')`));
  await input('input[placeholder="输入好友的备注或昵称"]', '演示');
  await until(`!!document.querySelector('[aria-label="选择要导入的微信联系人"] button')`, 'synthetic contact search');
  await until(`document.querySelector('[aria-label="选择要导入的微信联系人"] img')?.naturalWidth>0`, 'contact avatar falls back from bad cached bytes to proxy');
  assert('contact avatar renders through desktop proxy after cache decode fails', await js(`document.querySelector('[aria-label="选择要导入的微信联系人"] img')?.getAttribute('src').startsWith('/_desktop/contact-avatar?url=')`));
  await click('[aria-label="选择要导入的微信联系人"] button');
  await until(`!!document.querySelector('[data-desktop-capture-step="2"]')`, 'selected capture stage');
  assert('capture stage 3 reflects contact selection', await js(`document.querySelector('.dw-capture-steps [aria-current="step"]')?.textContent.includes('导入资料')`));
  assert('valid library response has no false owner error', await js(`!document.body.innerText.includes('登录账号已变化')`));
  assert('capture is not automatically started', requests.every(row => row.path !== '/capture'));
  await until(`document.querySelector('[data-selected-person] img')?.naturalWidth>0`, 'selected contact avatar');
  assert('selected contact avatar renders', await js(`document.querySelector('[data-selected-person] img')?.naturalWidth>0`));
  await layout('capture-selected-minimum', minimumWidth, minimumHeight);
  await captureReadability('selected contact');
  await layout('capture-selected-wide', 1184, 836);
  await js(`document.querySelector('[data-selected-person] img').dispatchEvent(new Event('error'))`);
  await until(`!document.querySelector('[data-selected-person] img')&&!!document.querySelector('[data-selected-person] span svg')`, 'failed avatar remains visible as placeholder');
  assert('failed avatar leaves a visible person placeholder', await js(`document.querySelector('[data-selected-person] span svg')?.getBoundingClientRect().width>0`));
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert('reduced motion disables entrance animation', await js(`getComputedStyle(document.querySelector('.dw-enter')).animationName==='none'||parseFloat(getComputedStyle(document.querySelector('.dw-enter')).animationDuration)<=0.01`));
  win.webContents.debugger.detach();
  await win.loadURL(origin + '/archive');
  await until(`document.querySelector('img[alt="演示小林的头像"]')?.naturalWidth>0&&document.querySelector('img[alt="演示小雨的头像"]')?.naturalWidth>0`, 'saved archive avatars');
  assert('archive remote avatar uses desktop proxy', await js(`document.querySelector('img[alt="演示小林的头像"]').getAttribute('src').startsWith('/_desktop/contact-avatar?url=')`));
  assert('archive uploaded avatar remains data image', await js(`document.querySelector('img[alt="演示小雨的头像"]').getAttribute('src').startsWith('data:image/png;base64,')`));
  await screenshot('archive-wide');
  assert('archive native header has no duplicate generic Home return', await js(`(()=>{const e=document.querySelector('[data-page-back][href="/workspace"]');return !e||e.getClientRects().length===0})()`));
  assert('archive hero keeps title and action in a compact row', await js(`document.querySelector('[data-aurora-hero]').getBoundingClientRect().height<145`));
  await js(`document.querySelector('img[alt="演示小林的头像"]').dispatchEvent(new Event('error'))`);
  await until(`!document.querySelector('img[alt="演示小林的头像"]')`, 'expired archive avatar fallback');
  assert('archive failed avatar retains initials', await js(`[...document.querySelectorAll('span[aria-hidden="true"]')].some(e=>e.textContent==='演'&&e.getBoundingClientRect().width>0)`));
  await win.loadURL(origin + '/relationship');
  await until(`document.querySelector('img[alt="演示小林的头像"]')?.naturalWidth>0&&document.querySelector('img[alt="演示小雨的头像"]')?.naturalWidth>0`, 'saved relationship avatars');
  assert('relationship remote and uploaded avatars both render', await js(`document.querySelector('img[alt="演示小林的头像"]').getAttribute('src').startsWith('/_desktop/contact-avatar?url=')&&document.querySelector('img[alt="演示小雨的头像"]').getAttribute('src').startsWith('data:')`));
  for (const [route, name] of [['/chat', 'chat-wide'], ['/account', 'account-wide'], ['/analyze?mode=chat', 'analyze-wide']]) {
    await win.loadURL(origin + route);
    await until(`!!document.querySelector('h1')?.textContent.trim()`, name + ' heading');
    await pause(350);
    await screenshot(name);
    assert(name + ' has no horizontal overflow', await js(`document.documentElement.scrollWidth<=innerWidth+1`));
  }
  assert('viewing and navigating never sends a paid or mutating API request', requests.every(request => request.local || request.method === 'GET'), requests.filter(request => !request.local && request.method !== 'GET'));
  assert('no asset missing', missingAssets.length === 0, missingAssets);
  const actualFonts = Object.values(renderedFonts).flat().flatMap(row => row.fonts);
  assert('real platform glyphs use Chinese UI sans font', actualFonts.length >= 3 && actualFonts.every(font => /Microsoft YaHei|PingFang/.test(font.familyName)), actualFonts);
  assert('no renderer exceptions', consoleErrors.filter(row => !/401|400|Failed to load resource/.test(row)).length === 0, consoleErrors);
  await finish();
}).catch(async error => { errors.push({ name: 'workbench flow', detail: error.stack }); if (win) await screenshot('failure').catch(() => {}); await finish(); });
async function finish() {
  await mkdir(output, { recursive: true });
  const result = { ok: errors.length === 0, syntheticOnly: true, realNetworkUsed: false, realAccountUsed: false, checks, errors, consoleErrors, missingAssets, nativeCalls, requests, computedStyles, renderedFonts, contrastMetrics };
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, checks, errors, output }));
  win?.destroy(); app.exit(result.ok ? 0 : 1);
}
setTimeout(() => { console.error('Workbench smoke timed out'); app.exit(1); }, 75_000).unref();
