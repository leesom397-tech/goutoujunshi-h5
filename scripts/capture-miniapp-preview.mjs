// Render the local fictional miniapp walkthrough in a fresh browser profile.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const edgePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const pageUrl = pathToFileURL(resolve("miniapp/preview.html")).href;
const outDir = resolve("outputs");
const views = process.argv.includes("--remaining") ? ["quick", "result"] : ["home", "quick", "result"];
const suffix = process.argv.find(arg => arg.startsWith("--suffix="))?.slice(9) || "";
if (suffix && !/^[a-zA-Z0-9_-]{1,32}$/.test(suffix)) throw new Error("INVALID_PREVIEW_SUFFIX");
const previewPath = view => resolve(outDir, `miniapp-preview-${view}${suffix ? "-" + suffix : ""}.png`);
const outputs = views.map(previewPath);
if (outputs.some(path => existsSync(path))) throw new Error("PREVIEW_OUTPUT_ALREADY_EXISTS");

const profile = await mkdtemp(join(tmpdir(), "lovetalk-mini-preview-"));
const browser = spawn(edgePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { windowsHide: true, stdio: "ignore" });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
const pending = new Map();
let serial = 0;
function call(method, params = {}, sessionId) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
try {
  let port;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/); break; }
    catch { await delay(150); }
  }
  if (!port) throw new Error("Preview browser did not become ready");
  socket = new WebSocket("ws://127.0.0.1:" + port[0] + port[1]);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data), item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
  });
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => call(method, params, sessionId);
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: pageUrl + "#home" });
  for (const view of views) {
    await send("Runtime.evaluate", { expression: `typeof show === 'function' && show('${view}')`, returnByValue: true });
    for (let attempt = 0; attempt < 40; attempt++) {
      const ready = (await send("Runtime.evaluate", { expression: `document.querySelector('#${view}')?.classList.contains('active') && document.readyState === 'complete'`, returnByValue: true })).result.value;
      if (ready) break;
      if (attempt === 39) throw new Error("Preview view did not render: " + view);
      await delay(100);
    }
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(previewPath(view), Buffer.from(screenshot.data, "base64"));
  }
  console.log(JSON.stringify({ preview: pageUrl, screenshots: outputs, fictionalDataOnly: true }));
  await call("Browser.close");
} finally {
  socket?.close();
  for (const item of pending.values()) clearTimeout(item.timer);
  if (browser.exitCode === null) browser.kill();
}
