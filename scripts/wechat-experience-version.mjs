const port = "http://127.0.0.1:9223";
const version = process.argv.find(arg => arg.startsWith("--version="))?.slice(10) || "1.0.31";
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid mini-program version");
const tabs = await (await fetch(`${port}/json/list`)).json();
const tab = tabs.find(item => item.type === "page" && new URL(item.url).pathname === "/wxamp/wacodepage/getcodepage");
if (!tab) throw new Error("WeChat version page is not open");
const browser = await (await fetch(`${port}/json/version`)).json();
const socket = new WebSocket(browser.webSocketDebuggerUrl);
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  }
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  setTimeout(() => {
    if (pending.delete(id)) reject(new Error(`${method} timed out`));
  }, 8000);
});
try {
  const { sessionId } = await call("Target.attachToTarget", { targetId: tab.id, flatten: true });
  if (process.argv.includes("--reload")) {
    await call("Page.reload", { ignoreCache: true }, sessionId);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  const expression = `(() => {
    const element = [...document.querySelectorAll('*')].find(item => item.innerText?.trim() === ${JSON.stringify(version)} && ![...item.children].some(child => child.innerText?.trim() === ${JSON.stringify(version)}));
    if (!element) return { found: false };
    let parent = element;
    const levels = [];
    for (let index = 0; index < 6 && parent; index++, parent = parent.parentElement) {
      levels.push({ level: index, tag: parent.tagName, className: String(parent.className).slice(0, 90), actions: [...parent.querySelectorAll('button,a,[role=button]')].map(item => item.innerText?.trim()).filter(Boolean).slice(0, 12) });
    }
    const row = element.closest('.code_version_log');
    const controls = row ? [...row.querySelectorAll('*')].filter(item => /体验版|设为体验版|取消体验版|扫描访问/.test(item.innerText?.trim() || '') && ![...item.children].some(child => /体验版|设为体验版|取消体验版|扫描访问/.test(child.innerText?.trim() || ''))).map(item => ({ text: item.innerText?.trim().slice(0, 70), tag: item.tagName, className: String(item.className).slice(0, 90), parentClass: String(item.parentElement?.className).slice(0, 90) })).slice(0, 10) : [];
    return { found: true, levels, controls };
  })()`;
  const result = await call("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
  console.log(JSON.stringify(result.result?.value));
  if (process.argv.includes("--open-qr")) {
    const open = `(() => {
      const element = [...document.querySelectorAll('.simple_preview_value')].find(item => item.innerText?.trim() === ${JSON.stringify(version)});
      const row = element?.closest('.code_version_log');
      const badge = row?.querySelector('.status_tag.info.clickable');
      if (!badge || !/体验版/.test(badge.innerText)) return false;
      badge.click();
      return true;
    })()`;
    const clicked = await call("Runtime.evaluate", { expression: open, returnByValue: true }, sessionId);
    console.log(JSON.stringify({ experienceQrOpened: clicked.result?.value === true }));
    await new Promise(resolve => setTimeout(resolve, 1000));
    const dialog = `(() => {
      const visible = item => { const style = getComputedStyle(item); const box = item.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && box.width > 0 && box.height > 0; };
      return { dialogs: [...document.querySelectorAll('[role=dialog],.weui-desktop-dialog,.weui-desktop-dialog__wrp,.dialog_wrp')].filter(visible).map(item => ({ text: item.innerText.slice(0, 280), images: [...item.querySelectorAll('img')].filter(visible).map(image => ({ width: image.naturalWidth, height: image.naturalHeight, dataImage: image.src.startsWith('data:') })) })).slice(0, 6), media: [...document.querySelectorAll('img,canvas')].filter(visible).map(item => ({ tag: item.tagName, width: item.width, height: item.height, dataImage: item.src?.startsWith('data:') || false, near: item.parentElement?.innerText.slice(0, 90) })).slice(-10) };
    })()`;
    const opened = await call("Runtime.evaluate", { expression: dialog, returnByValue: true }, sessionId);
    console.log(JSON.stringify(opened.result?.value));
    if (process.argv.includes("--save-qr")) {
      const qrExpression = `(() => {
        const visible = item => { const style = getComputedStyle(item); const box = item.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0; };
        const dialog = [...document.querySelectorAll('[role=dialog],.weui-desktop-dialog,.weui-desktop-dialog__wrp,.dialog_wrp')].find(item => visible(item) && item.innerText.includes('扫码访问体验版') && item.innerText.includes('路径 pages/home/index'));
        return [...(dialog?.querySelectorAll('img') || [])].find(item => visible(item) && item.naturalWidth === 165 && item.naturalHeight === 165)?.src || '';
      })()`;
      let dataUrl = "";
      for (let attempt = 0; attempt < 20 && !dataUrl.startsWith("data:image/png;base64,"); attempt++) {
        const image = await call("Runtime.evaluate", { expression: qrExpression, returnByValue: true }, sessionId);
        dataUrl = image.result?.value || "";
        if (!dataUrl) await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!dataUrl.startsWith("data:image/png;base64,")) throw new Error("Official experience QR was not a PNG data URL");
      const bytes = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid PNG signature");
      const path = resolve(`outputs/miniapp-experience-${version}.png`);
      writeFileSync(path, bytes);
      console.log(JSON.stringify({ savedQr: path, bytes: bytes.length }));
    }
  }
} finally {
  socket.close();
}
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
