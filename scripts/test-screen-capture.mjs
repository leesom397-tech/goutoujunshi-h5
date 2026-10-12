import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import ts from 'typescript';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

function compiled(file) { return ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText; }
const helpers = {}; new Function('exports', compiled('lib/screen-capture.ts'))(helpers);
const original = new Uint8ClampedArray(960 * 540 * 4).fill(255), shortReply = original.slice();
for (let i = 3000; i < 3040; i += 4) { shortReply[i] = 0; shortReply[i + 1] = 0; shortReply[i + 2] = 0; }
assert.equal(helpers.changedFrame(original, original.slice()), false);
assert.equal(helpers.changedFrame(original, shortReply), true, 'ten changed pixels from a short reply must survive whole-window deduplication');
assert.equal(helpers.blankFrame(new Uint8ClampedArray(400).fill(0)), true);
assert.equal(helpers.blankFrame(original), false);
assert.deepEqual(helpers.cropPixels(1000, 600, helpers.normalizeCrop({ x: .8, y: .5 }, { x: .1, y: .1 })), { x: 100, y: 60, width: 700, height: 240 });
assert.throws(() => helpers.cropPixels(1000, 600, { x: .1, y: .1, width: .001, height: .01 }), /太小/);
assert.equal(helpers.encodedImageBytes('YWJjZA=='), 4);
assert.throws(() => helpers.encodeCapture({ toDataURL: () => 'data:,' }), /未能生成/);
assert.throws(() => helpers.encodeCapture({ toDataURL: () => 'data:image/jpeg;base64,' + 'A'.repeat(6_666_672) }), /超过 5 MB/);

mkdirSync('.tmp/screen-capture-test', { recursive: true }); mkdirSync('outputs/screen-capture', { recursive: true });
writeFileSync('.tmp/screen-capture-test/fixture.tsx', `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ScreenCapture}from'../../components/ScreenCapture';
function Fixture(){const[disabled,setDisabled]=useState(false),[owner,setOwner]=useState('owner-a'),[shown,setShown]=useState(true);Object.assign(window,{__setDisabled:setDisabled,__setOwner:setOwner,__setShown:setShown});return <main style={{maxWidth:1050,margin:'30px auto'}}>{shown&&<ScreenCapture disabled={disabled} sessionKey={owner} onReady={async(frames)=>{window.__saved=frames;}}/>}</main>}createRoot(document.getElementById('root')).render(<Fixture/>);`);
await build({ entryPoints: ['.tmp/screen-capture-test/fixture.tsx'], bundle: true, outfile: '.tmp/screen-capture-test/fixture.js', format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': resolve('.') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
const css = readFileSync('.tmp/screen-capture-test/fixture.css', 'utf8');
const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#fffaf4;font:16px/1.6 system-ui}*{box-sizing:border-box}' + css + '</style><div id="root"></div><script src="/fixture.js"></script>';
const server = createServer((request, response) => { response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html'); response.end(request.url === '/fixture.js' ? readFileSync('.tmp/screen-capture-test/fixture.js') : html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1280, height: 1060 });
  await page.evaluateOnNewDocument(() => {
    const test = window.__captureMock = { streams: [], waiting: [], mode: 'normal', serial: 0, deferredHash: false, hashWaiting: [] };
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600; test.canvas = canvas;
    test.draw = (variant = 0) => { const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f1f1f1'; ctx.fillRect(0, 0, 800, 600); ctx.fillStyle = '#2b2b2b'; ctx.fillRect(0, 0, 150, 600); ctx.fillStyle = '#fff'; ctx.font = '19px sans-serif'; ctx.fillText('联系人测试区', 10, 40); ctx.fillStyle = '#222'; ctx.fillText('测试好友 · 合成聊天', 180, 45); ctx.fillStyle = '#fff'; ctx.fillRect(180, 90, 440, 58); ctx.fillRect(180, 172, 390, 58); ctx.fillStyle = '#222'; ctx.fillText('周六一起去看展吗？', 200, 125); ctx.fillText('可以呀，我们下午见。', 200, 210); if (variant) { ctx.fillStyle = '#222'; ctx.fillRect(190, 510, 12 + variant, 12); } };
    test.draw();
    const digest = crypto.subtle.digest.bind(crypto.subtle); crypto.subtle.digest = async (...args) => { if (test.deferredHash) await new Promise(resolve => test.hashWaiting.push(resolve)); return digest(...args); };
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
      if (test.mode === 'reject') throw new DOMException('synthetic deny', 'NotAllowedError');
      const stream = canvas.captureStream(8), track = stream.getVideoTracks()[0], settings = track.getSettings.bind(track); test.streams.push(stream); test.serial++;
      const paint = setInterval(() => { if (track.readyState === 'ended') clearInterval(paint); else { canvas.getContext('2d').drawImage(canvas, 0, 0); track.requestFrame?.(); } }, 100);
      track.getSettings = () => ({ ...settings(), displaySurface: test.mode === 'monitor' ? 'monitor' : 'window' });
      if (test.mode === 'deferred') await new Promise(resolve => test.waiting.push(resolve));
      return stream;
    } });
  });
  await page.goto(base, { waitUntil: 'networkidle0' });
  const click = async text => { const found = await page.evaluate(text => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.includes(text)); if (!button || button.disabled) return false; button.click(); return true; }, text); assert.ok(found, 'button available: ' + text); };
  const count = () => page.$$eval('img[alt^="采集截图"]', images => images.length);
  const untilCount = n => page.waitForFunction(n => document.querySelectorAll('img[alt^="采集截图"]').length === n, { timeout: 6000 }, n);
  const share = async () => { await click('选择微信窗口'); try { await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('开始自动截取') && !button.disabled), { timeout: 12000 }); } catch(error) { console.error(await page.evaluate(() => ({text:document.body.innerText,video:{width:document.querySelector('video')?.videoWidth,ready:document.querySelector('video')?.readyState},streams:window.__captureMock.streams.length}))); throw error; } };
  await share();
  assert.equal(await page.$eval('video', video => video.videoWidth), 800, 'a real canvas MediaStream was bound to the preview');
  const box = await page.$eval('[data-visible=true]', element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .06); await page.mouse.down(); await page.mouse.move(box.x + box.width * .96, box.y + box.height * .96, { steps: 4 }); await page.mouse.up();
  await click('开始自动截取'); await untilCount(1); await click('暂停截图');
  assert.equal(await page.evaluate(() => window.__captureMock.streams.at(-1).getTracks()[0].readyState), 'live', 'pause leaves preview live and explicitly labelled');
  await click('开始自动截取'); await page.waitForFunction(() => document.body.textContent.includes('跳过重复画面 1 次')); await click('暂停截图'); assert.equal(await count(), 1);
  await page.evaluate(() => window.__captureMock.draw(1)); await new Promise(resolve => setTimeout(resolve, 180));
  await click('开始自动截取'); await untilCount(2); await click('暂停截图');
  await click('保存截图');
  const saved = await page.evaluate(() => window.__saved.map(frame => ({ width: frame.width, height: frame.height, bytes: atob(frame.data).length })));
  assert.equal(saved.length, 2); assert.ok(saved.every(frame => frame.width >= 600 && frame.width <= 612 && frame.height >= 530 && frame.height <= 550 && frame.bytes <= 5_000_000), JSON.stringify(saved));
  assert.equal(await page.evaluate(() => window.__captureMock.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true, 'finish ends tracks');
  await page.screenshot({ path: 'outputs/screen-capture/windows-captured-1280.png', fullPage: true });

  await page.evaluate(() => window.__setOwner('owner-b')); await untilCount(0);
  await share(); await page.evaluate(() => { const test = window.__captureMock; test.canvas.getContext('2d').fillStyle = '#000'; test.canvas.getContext('2d').fillRect(0, 0, 800, 600); }); await new Promise(resolve => setTimeout(resolve, 180));
  await click('开始自动截取'); await page.waitForSelector('[role=alert]'); assert.match(await page.$eval('[role=alert]', element => element.textContent), /黑屏/); assert.equal(await count(), 0);
  await page.evaluate(() => window.__captureMock.draw(2)); await new Promise(resolve => setTimeout(resolve, 180));
  await page.evaluate(() => window.__captureMock.deferredHash = true); await click('开始自动截取'); await page.waitForFunction(() => window.__captureMock.hashWaiting.length === 1);
  await page.evaluate(() => window.__setDisabled(true)); await page.waitForFunction(() => window.__captureMock.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
  await page.evaluate(() => { window.__captureMock.hashWaiting.shift()(); window.__captureMock.deferredHash = false; }); await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(await count(), 0, 'disabled stale hash cannot append a screenshot');
  await page.evaluate(() => { window.__setDisabled(false); window.__captureMock.mode = 'deferred'; }); await click('选择微信窗口'); await page.waitForFunction(() => window.__captureMock.waiting.length === 1);
  await page.evaluate(() => window.__setOwner('owner-c')); await new Promise(resolve => setTimeout(resolve, 50));
  await click('选择微信窗口'); await page.waitForFunction(() => window.__captureMock.waiting.length === 2);
  await page.evaluate(() => window.__captureMock.waiting.shift()()); await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await page.evaluate(() => window.__captureMock.streams.at(-2).getTracks()[0].readyState), 'ended', 'old permission request stops tracks when it resolves');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('正在等待窗口选择'))?.disabled), true, 'old finally cannot unlock a newer pending request');
  await page.evaluate(() => { window.__captureMock.mode = 'normal'; window.__captureMock.waiting.shift()(); }); await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('开始自动截取') && !button.disabled));
  await click('开始自动截取'); await untilCount(1); await click('暂停截图');
  await page.evaluate(() => window.__setOwner('owner-d')); await untilCount(0); assert.equal(await page.evaluate(() => window.__captureMock.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);
  await page.evaluate(() => window.__captureMock.mode = 'monitor'); await click('选择微信窗口'); await page.waitForSelector('[role=alert]'); assert.match(await page.$eval('[role=alert]', element => element.textContent), /整块屏幕/);
  await page.evaluate(() => window.__captureMock.mode = 'reject'); await click('选择微信窗口'); await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('Mac'));
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36');
  await page.screenshot({ path: 'outputs/screen-capture/mac-permission-guidance-1280.png', fullPage: true });
  await page.setViewport({ width: 390, height: 844 }); await page.screenshot({ path: 'outputs/screen-capture/permission-guidance-390.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.setViewport({ width: 1280, height: 1060 }); await page.evaluate(() => window.__captureMock.mode = 'normal'); await share();
  for (let n = 0; n < 9; n++) { await page.evaluate(n => window.__captureMock.draw(n + 10), n); await new Promise(resolve => setTimeout(resolve, 160)); await click('开始自动截取'); await untilCount(n + 1); if (n < 8) await click('暂停截图'); }
  assert.equal(await page.evaluate(() => window.__captureMock.streams.at(-1).getTracks()[0].readyState), 'ended', 'nine-frame limit ends all sharing');
  await page.evaluate(() => window.__setOwner('owner-e')); await untilCount(0); await share(); await page.evaluate(() => window.__setShown(false));
  assert.equal(await page.evaluate(() => window.__captureMock.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true, 'unmount ends tracks');
  assert.deepEqual(errors, []);
  console.log('PASS real MediaStream fixture: video binding, crop pixels, duplicate skip, short replies, black-screen rejection, pause/stop, old permissions/hash, account changes, limits, unmount and Mac/mobile presentation');
  console.log('LIMIT: getDisplayMedia chooser mocked with a real canvas MediaStream; no real WeChat window or macOS system permission was exercised.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
