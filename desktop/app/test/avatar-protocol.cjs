/* Electron integration: synthetic avatar bytes only, with all network blocked. */
'use strict';
const { app, BrowserWindow, session, net } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalApp } = require('../local-app.cjs');
const { ORIGIN } = require('../policy.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chengzi-avatar-protocol-'));
const output = path.resolve(__dirname, '../.stage/avatar-protocol.json');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN84AAAAASUVORK5CYII=', 'base64');
const requests = [], forwards = [], checks = {};
let win;
app.setPath('userData', path.join(dir, 'userdata'));
app.whenReady().then(async () => {
  const root = path.join(dir, 'frontend'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><body>合成头像测试</body></html>');
  const ses = session.fromPartition('avatar-protocol-' + process.pid);
  // Every HTTPS response is generated below; other protocols cannot leave.
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('https:') && !details.url.startsWith('data:') && !details.url.startsWith('file:') }));
  const handler = createLocalApp({ root, routes: ['/'], fetchFile: url => net.fetch(url), fetchRemote: async (request, options) => {
    forwards.push({ path: new URL(request.url).pathname, destination: request.destination, credentials: options.credentials, redirect: options.redirect });
    return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  } });
  await ses.protocol.handle('https', request => {
    requests.push({ path: new URL(request.url).pathname, destination: request.destination, initiatorOrigin: request.initiatorOrigin, destHeader: request.headers.get('sec-fetch-dest'), siteHeader: request.headers.get('sec-fetch-site') });
    return handler(request);
  });
  win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  await win.loadURL(ORIGIN + '/');
  const images = await win.webContents.executeJavaScript(`Promise.all(['/_desktop/contact-avatar?url='+encodeURIComponent('https://wx.qlogo.cn/synthetic-avatar.png'),'data:image/png;base64,${png.toString('base64')}'].map(src=>new Promise(resolve=>{const i=new Image();i.referrerPolicy='no-referrer';i.onload=()=>resolve({src:src.startsWith('data:')?'data':'https',loaded:i.naturalWidth>0});i.onerror=()=>resolve({src:src.startsWith('data:')?'data':'https',loaded:false});i.src=src;document.body.append(i)})))`);
  checks.httpsAvatarLoads = images.find(image => image.src === 'https')?.loaded === true;
  checks.dataAvatarLoads = images.find(image => image.src === 'data')?.loaded === true;
  checks.externalFetchRemainsBlocked = await win.webContents.executeJavaScript(`fetch('https://wx.qlogo.cn/not-an-image-api').then(r=>r.status===403).catch(()=>true)`);
  checks.onlyAvatarForwarded = forwards.length === 1 && forwards[0].path === '/synthetic-avatar.png';
  checks.credentialFree = forwards.length === 1 && forwards[0].credentials === 'omit';
  finish();
}).catch(error => finish(error));
function finish(error) {
  const result = { ok: !error && Object.values(checks).every(Boolean), syntheticOnly: true, realNetworkUsed: false, checks, requests, forwards, ...(error ? { error: error.stack } : {}) };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); win?.destroy(); app.exit(result.ok ? 0 : 1);
}
setTimeout(() => finish(new Error('Avatar protocol test timed out')), 15000).unref();
