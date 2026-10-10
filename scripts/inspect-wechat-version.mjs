// Inspect only the already-open authenticated WeChat version-management tab.
const tabs = await fetch("http://127.0.0.1:9223/json/list").then(response => response.json());
const page = tabs.find(tab => tab.url?.startsWith("https://mp.weixin.qq.com/wxamp/wacodepage/"));
if (!page?.webSocketDebuggerUrl) throw Error("VERSION_MANAGEMENT_TAB_NOT_FOUND");
const socket = new WebSocket(page.webSocketDebuggerUrl);
const selectedVersion = process.argv.find(arg => /^1\.0\.\d+$/.test(arg)) || "1.0.21";
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data), task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  clearTimeout(task.timer);
  message.error ? task.reject(Error(message.error.message)) : task.resolve(message.result);
};
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error("CDP_TIMEOUT:" + method)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const expression = process.argv.includes("--reload") ? "location.reload();'reloading'" :
  process.argv.includes("--open-experience") ? "(()=>{const row=[...document.querySelectorAll('.code_version_log')].find(x=>x.innerText.includes(" + JSON.stringify(selectedVersion) + "));const icon=row?.querySelector('i[data-msgid=\"扫描访问体验版\"]');if(!icon)return 'experience-icon-not-found';icon.click();return 'experience-view-opened'})()" :
  "({title:document.title,text:document.body.innerText.slice(0,12000),rows:[...document.querySelectorAll('.code_version_log')].map(x=>({text:x.innerText.slice(0,900),buttons:[...x.querySelectorAll('button,a')].map(y=>({text:y.innerText.trim(),title:y.title||''})).filter(y=>y.text||y.title)})).slice(0,12)})";
try {
  await send("Page.bringToFront");
  if (process.argv.includes("--navigate")) {
    const navigation = await send("Page.navigate", { url: page.url });
    console.log(JSON.stringify({ navigated: !navigation.errorText, error: navigation.errorText || null }));
    process.exit(0);
  }
  const result = await send("Runtime.evaluate", { expression, returnByValue: true });
  console.log(JSON.stringify(result.result?.value));
} finally { socket.close(); }
