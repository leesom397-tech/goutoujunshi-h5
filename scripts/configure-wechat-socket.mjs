// One-shot, narrowly scoped update of the already-open WeChat server-domain dialog.
const tabs = await fetch("http://127.0.0.1:9223/json/list").then(response => response.json());
const page = tabs.find(tab => tab.url?.startsWith("https://mp.weixin.qq.com/wxamp/devprofile/"));
if (!page?.webSocketDebuggerUrl) throw Error("WECHAT_DEVELOPMENT_TAB_NOT_FOUND");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
async function evaluate(expression) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("CDP_TIMEOUT")), 10000);
    const handler = event => { const message = JSON.parse(event.data); if (message.id !== id) return; clearTimeout(timer); socket.removeEventListener("message", handler); message.error ? reject(Error(message.error.message)) : resolve(message.result?.result?.value); };
    socket.addEventListener("message", handler);
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
}
const before = await evaluate("(()=>{const d=document.querySelector('.weui-desktop-dialog');if(!d)return null;return [...d.querySelectorAll('.config_info_meta')].map(g=>({label:g.querySelector('label')?.textContent?.trim(),value:g.querySelector('.url_area')?.textContent?.trim()||''}))})()");
if (!Array.isArray(before) || before.find(x => x.label === "request合法域名")?.value !== "https://coach.lovetalk.love;" || before.find(x => x.label === "socket合法域名")?.value) throw Error("DOMAIN_PRECONDITION_FAILED");
const filled = await evaluate("(()=>{const g=[...document.querySelectorAll('.weui-desktop-dialog .config_info_meta')].find(x=>x.querySelector('label')?.textContent?.trim()==='socket合法域名');const area=g?.querySelector('.url_area');if(!area||area.textContent.trim())return false;area.focus();document.execCommand('insertText',false,'wss://coach.lovetalk.love;');area.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'wss://coach.lovetalk.love;'}));return area.textContent.trim()==='wss://coach.lovetalk.love;'})()");
if (!filled) throw Error("SOCKET_FILL_FAILED");
const after = await evaluate("[...document.querySelectorAll('.weui-desktop-dialog .config_info_meta')].map(g=>({label:g.querySelector('label')?.textContent?.trim(),value:g.querySelector('.url_area')?.textContent?.trim()||''}))");
if (after.length !== before.length || after.some((item, index) => item.value !== (item.label === "socket合法域名" ? "wss://coach.lovetalk.love;" : before[index].value))) throw Error("UNEXPECTED_DOMAIN_CHANGE");
const saved = await evaluate("(()=>{const d=document.querySelector('.weui-desktop-dialog');const b=[...d.querySelectorAll('button')].find(x=>x.textContent?.trim()==='保存并提交');if(!b)return false;b.click();return true})()");
socket.close();
console.log(JSON.stringify({ priorRequest: before.find(x => x.label === "request合法域名")?.value, addedSocket: after.find(x => x.label === "socket合法域名")?.value, saveClicked: saved }));
