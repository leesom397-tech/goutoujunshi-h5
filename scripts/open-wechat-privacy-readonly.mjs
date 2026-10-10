// Open the existing WeChat privacy-guide view with a trusted browser click.
// Never enter data or invoke a save/submit control.
const tabs = await fetch("http://127.0.0.1:9223/json/list").then(response => response.json());
const page = tabs.find(tab => tab.url?.startsWith("https://mp.weixin.qq.com/wxamp/basicprofile/"));
if (!page?.webSocketDebuggerUrl) throw Error("ACCOUNT_SETTINGS_TAB_NOT_FOUND");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data), task = pending.get(message.id);
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
  const found = await send("Runtime.evaluate", {
    expression: "(()=>{const row=[...document.querySelectorAll('.meta_name')].find(x=>x.textContent?.trim()==='用户隐私保护指引')?.closest('tr');const link=[...(row?.querySelectorAll('a')||[])].find(x=>x.innerText.trim()==='去完善');if(!link)return null;link.scrollIntoView({block:'center'});const r=link.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
    returnByValue: true
  });
  const point = found.result?.value;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw Error("PRIVACY_GUIDE_CONTROL_NOT_FOUND");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  console.log("PRIVACY_GUIDE_VIEW_CLICKED");
} finally { socket.close(); }
