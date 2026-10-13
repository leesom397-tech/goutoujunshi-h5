import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Synthetic materials only. The default checks need no browser or network.
// --browser additionally records a synthetic clip with MediaRecorder and decodes
// it through the real production <video>/canvas extraction implementation.
const cache = new Map();
function load(file) {
  const filename = path.resolve(file);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {}; cache.set(filename, exports);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', compiled)(exports, name => {
    assert.ok(name.startsWith('.'), 'Only local dependencies belong in this test');
    return load(path.resolve(path.dirname(filename), name + (path.extname(name) ? '' : '.ts')));
  });
  return exports;
}
const lib = load('lib/video-import.ts');
const screen = load('lib/screen-capture.ts');
let checks = 0;
const test = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
const file = { name: 'synthetic.mp4', size: 1000, type: 'video/mp4', lastModified: 100 };
test('empty, oversized, and nonvideo files rejected before decode', () => {
  assert.throws(() => lib.validateVideoFile({ ...file, size: 0 }), /没有内容/);
  assert.throws(() => lib.validateVideoFile({ ...file, size: 200 * 1024 * 1024 + 1 }), /200 MB/);
  assert.throws(() => lib.validateVideoFile({ ...file, name: 'photo.jpg', type: 'image/jpeg' }), /录屏视频/);
});
test('phone MP4/MOV without browser MIME accepted for real decode', () => {
  for (const name of ['synthetic.MOV', 'synthetic.MP4', 'synthetic.webm']) lib.validateVideoFile({ ...file, name, type: '' });
});
test('finite video duration and valid selected segment required', () => {
  for (const duration of [0, -1, Infinity, NaN, 301]) assert.throws(() => lib.validateVideoRange(0, 1, duration));
  for (const [start, end] of [[-1, 1], [2, 1], [1, 1], [0, 31], [NaN, 1], [0, Infinity]]) assert.throws(() => lib.validateVideoRange(start, end, 30));
  lib.validateVideoRange(0, 90, 300);
  assert.throws(() => lib.validateVideoRange(0, 91, 300), /90 秒/);
});
test('samples remain inside the selected segment and bounded in work', () => {
  for (const [start, end] of [[0, .1], [4, 7.8], [37, 127]]) {
    const pairs = lib.videoSamplePairs(start, end);
    assert.ok(pairs.length * 2 <= lib.VIDEO_IMPORT_LIMITS.samples);
    assert.equal(pairs[0].time, start);
    assert.ok(Math.abs(pairs.at(-1).probe - (end - .001)) < .00001, 'the last decoded frame covers the selected segment end');
    for (const p of pairs) { assert.ok(p.time >= start); assert.ok(p.probe >= p.time); assert.ok(p.probe < end); }
  }
});
const still = new Uint8ClampedArray(400 * 400 * 4).fill(240);
const shortReply = still.slice();
for (const pixel of [12001, 12002, 12003, 12401, 12402, 12403]) {
  shortReply[pixel * 4] = 20; shortReply[pixel * 4 + 1] = 20; shortReply[pixel * 4 + 2] = 20;
}
test('a few changed text pixels survive whole-frame dedup', () => {
  assert.equal(screen.changedFrame(still, still), false);
  assert.equal(screen.changedFrame(still, shortReply), true);
  assert.ok(lib.frameMotionRatio(still, shortReply) < .001, 'a short reply is not classified as scrolling');
});
test('video dedup retains a short character but ignores scattered codec noise', () => {
  const sample = pixels => ({ pixels, width: 400, height: 400 });
  assert.equal(lib.videoFrameChanged(sample(still), sample(shortReply)), true);
  const noise = still.slice();
  for (let y = 10; y < 390; y += 24) for (let x = 10; x < 390; x += 24) {
    const i = (y * 400 + x) * 4; noise[i] = noise[i + 1] = noise[i + 2] = 210;
  }
  assert.equal(lib.videoFrameChanged(sample(still), sample(noise)), false);
  const boundaryCharacter = still.slice();
  for (const [x, y] of [[15, 15], [16, 15], [16, 16]]) {
    const i = (y * 400 + x) * 4; boundaryCharacter[i] = boundaryCharacter[i + 1] = boundaryCharacter[i + 2] = 20;
  }
  assert.equal(lib.videoFrameChanged(sample(still), sample(boundaryCharacter)), true, 'tiny text across tile boundaries must remain visible');
});
test('large moving regions are detected while tiny compression noise is ignored', () => {
  const moving = still.slice(); moving.fill(10, 0, moving.length / 4);
  assert.ok(lib.frameMotionRatio(still, moving) > .018);
  assert.equal(lib.frameMotionRatio(still, new Uint8ClampedArray(still.length).fill(235)), 0);
  assert.equal(lib.frameMotionRatio(still, new Uint8ClampedArray(4)), 1);
});
test('black and transparent captures are excluded', () => {
  assert.ok(screen.blankFrame(new Uint8ClampedArray(400)));
  assert.ok(!screen.blankFrame(still));
});
test('cropping retains valid message area and rejects tiny selection', () => {
  assert.deepEqual(screen.cropPixels(720, 1280, { x: .1, y: .1, width: .8, height: .8 }), { x: 72, y: 128, width: 576, height: 1024 });
  assert.throws(() => screen.cropPixels(720, 1280, { x: 0, y: 0, width: .01, height: .01 }), /太小/);
});
const firstId = await lib.videoFileId(file, 8);
assert.equal(firstId, await lib.videoFileId({ ...file }, 8));
assert.notEqual(firstId, await lib.videoFileId({ ...file, lastModified: 200 }, 8));
assert.match(firstId, /^[a-f0-9]{64}$/);
checks++;
console.log('PASS stable video identity and different-file isolation');

if (process.argv.includes('--browser')) {
  const { default: puppeteer } = await import('puppeteer-core');
  const { buildSync } = await import('esbuild');
  const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
  assert.ok(executablePath, 'Set CHROME_PATH to run native video decode verification');
  const bundle = buildSync({ entryPoints: ['lib/video-import.ts'], bundle: true, format: 'iife', globalName: 'VideoImportLib', write: false }).outputFiles[0].text;
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url() === 'http://localhost/video-import-test') return request.respond({ contentType: 'text/html', body: '<html><body>Only synthetic recording</body></html>' });
      return request.abort();
    });
    await page.goto('http://localhost/video-import-test');
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1280;
      const ctx = canvas.getContext('2d');
      const draw = phase => {
        ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, 0, 720, 1280);
        ctx.fillStyle = '#222'; ctx.font = '28px Arial'; ctx.fillText('SYNTHETIC CHAT ONLY', 28, 45);
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = i % 2 ? '#a9e77f' : '#fff'; ctx.fillRect(50 + (i % 2 ? 130 : 0), 150 + i * 140, 400, 95);
          ctx.fillStyle = '#222'; ctx.fillText(i === 5 ? (phase ? '好' : '嗯') : 'Synthetic message ' + i, 70 + (i % 2 ? 130 : 0), 205 + i * 140);
        }
      };
      draw(0);
      const stream = canvas.captureStream(12);
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      const chunks = []; recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start(); const tick = setInterval(() => draw(performance.now() - started > 1800 ? 1 : 0), 100); const started = performance.now();
      await new Promise(resolve => setTimeout(resolve, 3900));
      recorder.stop(); await stopped; clearInterval(tick); stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: mimeType });
      const video = document.createElement('video'); video.muted = true; const url = URL.createObjectURL(blob); video.src = url;
      const ctrl = new AbortController();
      try {
        const meta = await VideoImportLib.loadVideoMetadata(video, ctrl.signal);
        const full = await VideoImportLib.extractVideoFrames(video, { start: 0, end: meta.duration, crop: { x: 0, y: 0, width: 1, height: 1 }, signal: ctrl.signal });
        const staticPart = await VideoImportLib.extractVideoFrames(video, { start: .3, end: 1.6, crop: { x: 0, y: 0, width: 1, height: 1 }, signal: ctrl.signal });
        const videoId = 'a'.repeat(64);
        const oldRecords = full.frames.map(frame => ({ id: `video:${videoId}:${frame.id}`, source: { method: 'video-import', videoTime: frame.videoTime }, images: [{ mime: 'image/jpeg', data: frame.data }] }));
        const rematched = await VideoImportLib.matchImportedVideoFrames(staticPart.frames, oldRecords, { videoId });
        const otherClip = await VideoImportLib.matchImportedVideoFrames(staticPart.frames, oldRecords, { videoId: 'b'.repeat(64) });
        const shortChanged = await VideoImportLib.matchImportedVideoFrames([full.frames.at(-1)], [oldRecords[0]], { videoId });
        const samples = [];
        for (const time of [.46, 1.11, 1.599]) {
          await VideoImportLib.seekVideoFrame(video, time, ctrl.signal);
          const c = document.createElement('canvas'); c.width = 540; c.height = 960;
          const context = c.getContext('2d'); context.drawImage(video, 0, 0, 540, 960);
          samples.push(context.getImageData(0, 0, 540, 960).data);
        }
        const noise = samples.slice(1).map(b => {
          const a = samples[0], blocks = new Map(); let changed = 0;
          for (let y = 0; y < 960; y++) for (let x = 0; x < 540; x++) {
            const i = (y * 540 + x) * 4;
            if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 18) {
              changed++; const key = Math.floor(x / 16) + ':' + Math.floor(y / 16); blocks.set(key, (blocks.get(key) || 0) + 1);
            }
          }
          return { changed, maxBlock: Math.max(0, ...blocks.values()) };
        });
        const cancelled = new AbortController(); cancelled.abort(); let abortName = '';
        try { await VideoImportLib.extractVideoFrames(video, { start: 0, end: 1, crop: { x: 0, y: 0, width: 1, height: 1 }, signal: cancelled.signal }); } catch (e) { abortName = e.name; }
        return { duration: meta.duration, width: meta.width, height: meta.height, bytes: blob.size, full: { count: full.frames.length, duplicates: full.duplicates, times: full.frames.map(f => f.videoTime), validImages: full.frames.every(f => f.data.startsWith('/9j/') && f.width === 720 && f.height === 1280) }, staticCount: staticPart.frames.length, rematched: rematched[0].id === full.frames[0].id && rematched[0].data === full.frames[0].data, otherClipUnchanged: otherClip[0].id === staticPart.frames[0].id, shortChanged: shortChanged[0].id === full.frames.at(-1).id && shortChanged[0].id !== full.frames[0].id, noise, abortName };
      } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
    });
    console.log('Native decode result: ' + JSON.stringify(result));
    assert.ok(result.bytes > 0 && result.duration > 3, 'real browser recorded a nonempty decodable video');
    assert.equal(result.width, 720); assert.equal(result.height, 1280);
    assert.ok(result.full.count >= 2, 'small short-reply change must produce a new frame');
    assert.ok(result.full.duplicates >= 1, 'static video frames deduplicated');
    assert.equal(result.staticCount, 1, 'unchanged clip retains one clear frame');
    assert.ok(result.full.validImages);
    assert.equal(result.abortName, 'AbortError');
    assert.ok(result.rematched, 'same clip segment reuses its stored canonical frame');
    assert.ok(result.otherClipUnchanged, 'another clip is never matched against the first clip');
    assert.ok(result.shortChanged, 'short reply is not merged into its prior different message');
    checks += 9;
    console.log('PASS native MediaRecorder → video decode → extraction: ' + JSON.stringify(result));
  } finally { await browser.close(); }
}
console.log(`Video import checks passed: ${checks}.`);
