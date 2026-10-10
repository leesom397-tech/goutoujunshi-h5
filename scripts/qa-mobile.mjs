// Local, anonymous UI smoke test. Uses a fresh Edge profile, never a personal browser session.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const base = process.argv[2] || 'http://127.0.0.1:5184';
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base) && base !== 'https://coach.lovetalk.love') throw new Error('Project preview URL required');
const profile = await mkdtemp(join(tmpdir(), 'coach-mobile-qa-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let socket;
const pending = new Map();
let serial = 0;
function call(method, params = {}, sessionId) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
try {
  let info;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { info = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); break; } catch { await delay(150); }
  }
  if (!info) throw new Error('Fresh browser did not become ready');
  socket = new WebSocket('ws://127.0.0.1:' + info[0] + info[1]);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => call(method, params, sessionId);
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
  for (const [path, name] of [['/', 'home'], ['/risk', 'risk'], ['/library', 'library'], ['/crush', 'crush']]) {
    await send('Page.navigate', { url: base + path });
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await evaluate('location.pathname === ' + JSON.stringify(path) + ' && document.readyState === "complete"')) break;
      await delay(150);
    }
    await delay(600);
    const metrics = await evaluate('({width:innerWidth, content:document.documentElement.scrollWidth, heading:document.querySelector("h1")?.textContent, errors:document.querySelectorAll(".error-message").length})');
    if (metrics.content > 391 || metrics.width !== 390) throw new Error(name + ' overflows: ' + JSON.stringify(metrics));
    if (name === 'home') {
      if(!await evaluate('document.querySelector(".knowledge-proof")?.textContent.includes("135") && document.querySelector(".knowledge-proof")?.textContent.includes("43") && document.querySelector(".knowledge-proof")?.textContent.includes("非原书全文")'))throw new Error('Knowledge scale or source distinction missing on home');
      await evaluate('[...document.querySelectorAll(".case-switcher button")].find(b=>b.textContent.includes("预警")).click()');
      let switched=false;
      for(let attempt=0;attempt<20;attempt++){
        if(await evaluate('document.querySelector(".case-preview")?.textContent.includes("照片")')){switched=true;break;}
        await delay(150);
      }
      if (!switched) throw new Error('Case demo switch failed');
    }
    if(name==='library'&&!await evaluate('document.querySelectorAll(".library-domains span").length===8 && document.querySelector(".library-indexed-books")?.textContent.includes("Attachment and Loss") && document.querySelector(".library-scale-note")?.textContent.includes("不把整本书")'))throw new Error('Knowledge catalog or full-text disclaimer missing');
    if (name === 'risk' && !await evaluate('document.querySelector(".risk-submit").disabled')) throw new Error('Empty risk form must be disabled');
    if(name==='crush'){
      await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("填入示例")).click()');
      await delay(150);
      if(!await evaluate('document.querySelector("#chat-input").value.includes("周日")'))throw new Error('Example input did not populate');
      if(!await evaluate('document.querySelector(".crush-source").textContent.includes("演示")'))throw new Error('Demo disclosure missing');
      if(!await evaluate('document.querySelectorAll(".crush-annotation").length===2'))throw new Error('Per-bubble annotations missing');
      if(await evaluate('document.querySelector(".crush-result-panel").textContent.includes("100%")'))throw new Error('Synthetic percentages must not be shown');
    }
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = resolve('.' + name + '-mobile-qa.png');
    await writeFile(file, Buffer.from(screenshot.data, 'base64'));
    console.log(JSON.stringify({ path, ...metrics, screenshot: file }));
  }
  await call('Browser.close');
} finally {
  socket?.close();
  for (const item of pending.values()) clearTimeout(item.timer);
  if (edge.exitCode === null) edge.kill();
}
