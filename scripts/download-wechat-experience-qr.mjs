// Download the official QR from an already-open, authenticated WeChat modal.
// This does not set an experience version or submit any review.
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
const version = process.argv[2];
if (!/^1\.0\.\d+$/.test(version || "")) throw Error("EXACT_VERSION_REQUIRED");
const tabs = await fetch("http://127.0.0.1:9223/json/list").then(response => response.json());
const page = tabs.find(tab => tab.url?.startsWith("https://mp.weixin.qq.com/wxamp/wacodepage/"));
if (!page?.webSocketDebuggerUrl) throw Error("WECHAT_ADMIN_TAB_NOT_FOUND");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  message.error ? task.reject(Error(message.error.message)) : task.resolve(message.result);
};
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
try {
  const visible = await send("Runtime.evaluate", { expression: "document.body.innerText.includes('橙意派对体验版') && document.body.innerText.includes('路径 pages/home/index') && document.body.innerText.includes(" + JSON.stringify(version) + ")", returnByValue: true });
  if (visible.result?.value !== true) throw Error("EXPECTED_EXPERIENCE_MODAL_NOT_VISIBLE");
  const image = await send("Runtime.evaluate", { expression: "(()=>{const d=[...document.querySelectorAll('.weui-desktop-dialog')].find(x=>x.innerText.includes('橙意派对体验版'));const images=[...(d?.querySelectorAll('img')||[])].filter(x=>x.getClientRects().length&&x.src.startsWith('data:image/png;base64,'));return images.map(x=>({src:x.src,width:x.naturalWidth,height:x.naturalHeight})).sort((a,b)=>b.width*b.height-a.width*a.height)[0]||null})()", returnByValue: true });
  const value = image.result?.value;
  if (!value?.src || value.width < 160 || value.width !== value.height) throw Error("OFFICIAL_QR_IMAGE_NOT_VISIBLE");
  const bytes = Buffer.from(value.src.slice("data:image/png;base64,".length), "base64");
  if (bytes.length < 2500 || bytes.subarray(0,8).toString("hex") !== "89504e470d0a1a0a") throw Error("INVALID_OFFICIAL_QR_IMAGE");
  const output = resolve("outputs", `miniapp-experience-${version}.png`);
  writeFileSync(output, bytes, { flag: "wx" });
  console.log(JSON.stringify({ officialQr: output, bytes: bytes.length, source: "version-matched-WeChat-experience-dialog" }));
} finally { socket.close(); }
