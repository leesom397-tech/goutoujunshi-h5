// Real anonymous local pages. No API interception, fixtures, or production data.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { performance } from "node:perf_hooks";

const base = "http://127.0.0.1:5191";
const output = resolve("outputs/design-refresh");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "chengzi-glass-motion-"));
const frames = await mkdtemp(join(output, "daylight-frames-"));
const ffmpeg = process.env.FFMPEG_PATH || execFileSync("powershell.exe", ["-NoProfile", "-Command", "(Get-Command ffmpeg -ErrorAction Stop).Source"], { encoding: "utf8", windowsHide: true }).trim();
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, "--window-size=1280,800", "about:blank",
], { windowsHide: true, stdio: "ignore" });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map(), checks = [], exceptions = [], mutations = [];
let socket, serial = 0, sessionId;
const result = { base, anonymous: true, mocked: false, checks, exceptions };

function call(method, params = {}, sid) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
  });
}
const send = (method, params) => call(method, params, sessionId);
async function evaluate(expression) {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error(`${response.exceptionDetails.text}: ${response.result.description}`);
  return response.result.value;
}
async function until(expression, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw Error(`Timed out: ${label}`);
}
async function sample() {
  return evaluate(`(()=>{const stage=document.querySelector('.cz-glass-stage');const float=stage?.querySelector('.cz-glass-float');return {motion:stage?.dataset.motion,reduced:stage?.dataset.reducedMotion,transform:float?getComputedStyle(float).transform:null,animation:float?getComputedStyle(float).animationName:null,playState:float?getComputedStyle(float).animationPlayState:null,x:stage?.style.getPropertyValue('--cz-glass-x'),y:stage?.style.getPropertyValue('--cz-glass-y'),rx:stage?.style.getPropertyValue('--cz-glass-rx'),ry:stage?.style.getPropertyValue('--cz-glass-ry')}})()`);
}
async function clickToggle() {
  const target = await evaluate(`(()=>{const button=document.querySelector('.cz-glass-toggle');if(!button)return null;const r=button.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,label:button.getAttribute('aria-label'),fullyInViewport:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:button.contains(document.elementFromPoint(x,y))}})()`);
  assert.ok(target?.hit, `pause control is reachable by pointer hit testing: ${JSON.stringify(target)}`);
  assert.ok(target.fullyInViewport, "entire pause control is inside the viewport");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
  return target;
}
async function viewport(width, height, mobile = false) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
}
async function pointerPauseCheck(label) {
  const hit = await clickToggle();
  await until("document.querySelector('.cz-glass-stage').dataset.motion==='paused'", `${label} pause`);
  await delay(120);
  const stopped = await sample();
  await delay(350);
  assert.equal((await sample()).transform, stopped.transform, `${label}: paused transform stays fixed`);
  assert.equal(stopped.playState, "paused");
  await clickToggle();
  await until("document.querySelector('.cz-glass-stage').dataset.motion==='running'", `${label} resume`);
  const resumed = await sample();
  await delay(350);
  assert.notEqual((await sample()).transform, resumed.transform, `${label}: resumed transform changes`);
  checks.push({ check: `${label} pointer pause and play`, passed: true, hit });
}

try {
  let info;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { info = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/); break; }
    catch { await delay(100); }
  }
  assert.ok(info, "fresh headless Edge starts");
  socket = new WebSocket(`ws://127.0.0.1:${info[0]}${info[1]}`);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === "Network.requestWillBeSent") {
      const { request } = message.params;
      if (request.url.startsWith(base + "/api/") && !["GET", "HEAD"].includes(request.method)) mutations.push({ method: request.method, path: new URL(request.url).pathname });
    }
    const promise = pending.get(message.id);
    if (promise) { clearTimeout(promise.timer); pending.delete(message.id); message.error ? promise.reject(Error(message.error.message)) : promise.resolve(message.result); }
  });
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await viewport(1280, 800);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await send("Page.navigate", { url: base + "/workspace" });
  await send("Page.bringToFront");
  await until("document.readyState==='complete' && document.querySelector('.cz-glass-stage')?.dataset.motion==='running'", "live workspace motion");
  await until("[...document.images].every(image=>image.complete&&image.naturalWidth>0)", "loaded artwork");
  await delay(1000);
  const identity = await evaluate("fetch('/api/auth/session',{cache:'no-store'}).then(response=>response.json())");
  assert.equal(identity.loggedIn, false);
  assert.equal(identity.user, null);
  assert.equal(await evaluate("document.querySelector('.workspace-identity a')?.getAttribute('href')"), "/register");
  checks.push({ check: "fresh anonymous real session; registration CTA; all images loaded", passed: true });

  const first = await sample();
  await delay(350);
  const second = await sample();
  assert.notEqual(first.transform, second.transform);
  checks.push({ check: "automatic continuous motion changes the actual computed transform", passed: true, first, second });
  await pointerPauseCheck("desktop");

  const point = await evaluate(`(()=>{const stage=document.querySelector('.cz-glass-stage'),r=stage.getBoundingClientRect();for(const [u,v] of [[.78,.45],[.85,.35],[.7,.6]]){const x=r.left+r.width*u,y=r.top+r.height*v;if(x<innerWidth&&y<innerHeight&&stage.contains(document.elementFromPoint(x,y)))return {x,y};}return null})()`);
  assert.ok(point, "glass scene has an unobstructed pointer target");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await delay(150);
  const parallax = await sample();
  assert.ok(Math.abs(parseFloat(parallax.x)) > .1 || Math.abs(parseFloat(parallax.y)) > .1);
  assert.ok(Math.abs(parseFloat(parallax.x)) <= 6 && Math.abs(parseFloat(parallax.ry)) <= 2);
  checks.push({ check: "real desktop pointer changes bounded parallax", passed: true, point, parallax });

  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await until("document.querySelector('.cz-glass-stage').dataset.reducedMotion==='true'", "reduced motion preference");
  const reduced = await sample();
  assert.equal(reduced.motion, "paused");
  assert.equal(reduced.animation, "none");
  assert.equal(reduced.transform, "none");
  assert.equal(await evaluate("document.querySelector('.cz-glass-toggle')===null"), true);
  checks.push({ check: "reduced motion disables animation, parallax and unnecessary control", passed: true, reduced });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await until("document.querySelector('.cz-glass-stage').dataset.motion==='running'", "restore motion preference");

  await viewport(1280, 320);
  await evaluate("scrollTo(0,document.documentElement.scrollHeight)");
  await until("document.querySelector('.cz-glass-stage').getBoundingClientRect().bottom<0 && document.querySelector('.cz-glass-stage').dataset.motion==='paused'", "offscreen scene pauses");
  const offscreen = await sample();
  assert.equal(offscreen.playState, "paused");
  checks.push({ check: "offscreen IntersectionObserver suspends animation", passed: true, offscreen });

  await viewport(390, 844, true);
  await evaluate("scrollTo(0,0)");
  await until("document.querySelector('.cz-glass-stage').dataset.motion==='running'", "mobile automatic motion");
  await delay(500);
  await pointerPauseCheck("mobile");
  assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), "mobile has no overflow");

  await viewport(1280, 800);
  await evaluate("scrollTo(0,0)");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 15, y: 750 });
  await until("document.querySelector('.cz-glass-stage').dataset.motion==='running'", "recording runs");
  await delay(800);
  assert.equal((await evaluate("fetch('/api/auth/session',{cache:'no-store'}).then(response=>response.json())")).loggedIn, false);
  assert.deepEqual(mutations, [], "no account writes or paid API requests");
  const fps = 8, durationMs = 6000, timings = [];
  let start;
  // Preserve actual elapsed time. Screenshot throughput varies by renderer;
  // ffmpeg holds each real frame until the next capture, without speeding up motion.
  for (let index = 0; index < 80; index++) {
    if (start !== undefined) {
      const wait = start + index * 1000 / fps - performance.now();
      if (wait > 0) await delay(wait);
    }
    const frame = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    if (start === undefined) start = performance.now();
    timings.push(Math.round(performance.now() - start));
    await writeFile(join(frames, `${String(index).padStart(3, "0")}.png`), Buffer.from(frame.data, "base64"));
    if (timings.at(-1) >= durationMs) break;
  }
  assert.ok(timings.at(-1) >= durationMs, "six seconds of real animation captured");
  const manifest = [];
  for (let index = 0; index < timings.length - 1; index++) {
    manifest.push(`file '${String(index).padStart(3, "0")}.png'`, `duration ${((timings[index + 1] - timings[index]) / 1000).toFixed(3)}`);
  }
  manifest.push(`file '${String(timings.length - 1).padStart(3, "0")}.png'`);
  const concat = join(frames, "timeline.ffconcat");
  await writeFile(concat, "ffconcat version 1.0\n" + manifest.join("\n") + "\n");
  const video = join(output, "daylight-motion.mp4"), poster = join(output, "daylight-motion-poster.png");
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "1", "-i", concat, "-r", String(fps), "-fps_mode", "cfr", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video], { windowsHide: true });
  const posterIndex = timings.findIndex(time => time >= 2000);
  await copyFile(join(frames, `${String(posterIndex).padStart(3, "0")}.png`), poster);
  const ffprobe = join(dirname(ffmpeg), "ffprobe.exe");
  const media = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt,width,height,nb_frames:format=duration,size", "-of", "json", video], { windowsHide: true, encoding: "utf8" }));
  assert.equal(media.streams[0].codec_name, "h264");
  assert.equal(media.streams[0].pix_fmt, "yuv420p");
  assert.equal(media.streams[0].width, 1280);
  assert.equal(media.streams[0].height, 800);
  assert.deepEqual(exceptions, [], "no uncaught page exceptions");
  assert.ok(Math.abs(Number(media.format.duration) * 1000 - timings.at(-1)) < 350, "encoded duration preserves actual animation speed");
  result.video = { file: video, poster, bytes: (await stat(video)).size, fps, capturedFrames: timings.length, frames: Number(media.streams[0].nb_frames), actualCaptureMs: timings.at(-1) - timings[0], timings, media };
  checks.push({ check: "actual 1280×800 anonymous browser recording; H.264 yuv420p faststart", passed: true });
  result.passed = true;
  console.log(JSON.stringify({ passed: true, checks: checks.length, video, poster, videoBytes: result.video.bytes, captureMs: result.video.actualCaptureMs }, null, 2));
} catch (error) {
  result.passed = false;
  result.error = String(error.stack || error);
  throw error;
} finally {
  await writeFile(join(output, "daylight-motion-qa.json"), JSON.stringify(result, null, 2) + "\n");
  if (socket?.readyState === 1) { try { await call("Browser.close"); } catch {} socket.close(); }
  edge.kill();
  for (const promise of pending.values()) clearTimeout(promise.timer);
}
