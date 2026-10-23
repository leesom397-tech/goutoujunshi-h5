/* Offline runtime verification of packaged page modules, using synthetic APIs. */
const { app, BrowserWindow, session } = require('electron');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../frontend-dist');
const origin = 'https://coach.lovetalk.love';
const output = path.resolve(__dirname, '../.stage/frontend-smoke.json');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
app.whenReady().then(async () => {
  const routes = JSON.parse(await readFile(path.join(root, 'routes.json'), 'utf8'));
  const errors = [], misses = [], results = [];
  const ses = session.fromPartition('desktop-local-frontend-offline-smoke');
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(origin + '/') && !details.url.startsWith('data:') && !details.url.startsWith('blob:') }));
  await ses.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.origin !== origin) return new Response('Offline test', { status: 503 });
    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'Offline test: sign in required' }, { status: 401 });
    const resource = routes.includes(url.pathname) ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const filename = path.resolve(root, resource);
    if (!filename.startsWith(root + path.sep)) return new Response('', { status: 403 });
    try { return new Response(await readFile(filename), { headers: { 'content-type': mime[path.extname(filename)] || 'application/octet-stream' } }); }
    catch { misses.push(url.pathname); return new Response('', { status: 404 }); }
  });
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  let activeRoute = '';
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' && !/status of 401|Offline test|net::ERR_BLOCKED_BY_CLIENT/.test(details.message)) errors.push({ route: activeRoute, message: details.message.slice(0, 1000) });
  });
  for (const route of routes) {
    activeRoute = route;
    await win.loadURL(origin + route);
    await new Promise(resolve => setTimeout(resolve, 650));
    const result = await win.webContents.executeJavaScript(`({path:location.pathname,text:document.body.innerText.slice(0,1000),rootChildren:document.getElementById('root')?.childElementCount||0,scripts:[...document.scripts].map(s=>s.src)})`);
    results.push({ route, ...result });
    if (!result.rootChildren || /这个页面暂时没有打开|^正在打开/.test(result.text)) errors.push({ route, message: 'Page failed to mount' });
  }
  await win.loadURL(origin + '/workspace');
  await new Promise(resolve => setTimeout(resolve, 1000));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(path.join(path.dirname(output), 'frontend-workspace.png'), (await win.webContents.capturePage()).toPNG());
  const searchVisible = await win.webContents.executeJavaScript(`(()=>{const button=document.querySelector('.web-search-trigger');const visible=!!button&&button.getBoundingClientRect().height>0;button?.click();return visible})()`);
  await new Promise(resolve => setTimeout(resolve, 250));
  const searchOpens = await win.webContents.executeJavaScript(`(()=>{const opened=!!document.querySelector('dialog[open] #quick-search-field');document.querySelector('button[aria-label="关闭搜索"]')?.click();return opened})()`);
  if (!searchVisible || !searchOpens) errors.push({ route: '/workspace', message: 'Desktop search is hidden or cannot open' });
  // The compact workbench deliberately fits a desktop viewport. Use the real
  // help document at the minimum content width for a meaningful scroll return.
  await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('chengzi:desktop-navigate',{detail:'/support'}))`);
  await new Promise(resolve => setTimeout(resolve, 650));
  win.setSize(784, 616);
  await new Promise(resolve => setTimeout(resolve, 250));
  await win.webContents.executeJavaScript(`window.scrollTo({top:120,behavior:'instant'});window.__desktopNavigationSmoke='retained'`);
  const beforeScroll = await win.webContents.executeJavaScript(`scrollY`);
  if (beforeScroll < 50) errors.push({ route: '/support', message: 'Help scroll fixture did not produce a meaningful nonzero position', beforeScroll });
  const supportContent = await win.webContents.executeJavaScript(`document.body.innerText`);
  if (!supportContent.includes('采集工具已内置') || supportContent.includes('下载 Windows 助手')) errors.push({ route: '/support', message: 'Local desktop support override failed' });
  await writeFile(path.join(path.dirname(output), 'frontend-support.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('chengzi:desktop-navigate',{detail:'/workspace'}))`);
  await new Promise(resolve => setTimeout(resolve, 650));
  const nativeNavigation = await win.webContents.executeJavaScript(`({retained:window.__desktopNavigationSmoke==='retained',path:location.pathname,body:document.body.innerText})`);
  if (!nativeNavigation.retained || nativeNavigation.path !== '/workspace' || !nativeNavigation.body.includes('工作台')) errors.push({ route: '/workspace', message: 'Native SPA navigation did not retain the current document' });
  await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('chengzi:desktop-navigate',{detail:'https://example.invalid/'}));window.dispatchEvent(new CustomEvent('chengzi:desktop-navigate',{detail:'/not-a-route'}))`);
  const invalidRouteBlocked = await win.webContents.executeJavaScript(`location.pathname==='/workspace' && location.origin==='${origin}'`);
  if (!invalidRouteBlocked) errors.push({ route: '/workspace', message: 'Invalid desktop destination was accepted' });
  await win.webContents.executeJavaScript('window.history.back()');
  await new Promise(resolve => setTimeout(resolve, 650));
  const historyReturn = await win.webContents.executeJavaScript(`({path:location.pathname,retained:window.__desktopNavigationSmoke==='retained',scroll:scrollY})`);
  if (historyReturn.path !== '/support' || !historyReturn.retained || Math.abs(historyReturn.scroll - beforeScroll) > 2) errors.push({ route: '/support', message: 'History back did not restore the SPA document and scroll position', historyReturn, beforeScroll });
  const receipt = { ok: errors.length === 0 && misses.length === 0, offline: true, routes: results, interactions: { searchVisible, searchOpens, nativeNavigationRetained: nativeNavigation.retained, invalidRouteBlocked, historyReturn, beforeScroll }, errors, missingAssets: [...new Set(misses)] };
  await writeFile(output, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ ok: receipt.ok, routeCount: results.length, errors, missingAssets: receipt.missingAssets, output }));
  win.destroy(); app.exit(receipt.ok ? 0 : 1);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => { console.error('Offline frontend test timed out'); app.exit(1); }, 90_000).unref();
