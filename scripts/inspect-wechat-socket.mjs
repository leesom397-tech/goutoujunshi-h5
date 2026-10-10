// Read-only inspection of the existing, logged-in WeChat admin tab.
const tabs = await fetch("http://127.0.0.1:9223/json/list").then(response => response.json());
const page = tabs.find(tab => tab.url?.startsWith("https://mp.weixin.qq.com/wxamp/devprofile/"));
if (!page?.webSocketDebuggerUrl) throw Error("WECHAT_DEVELOPMENT_TAB_NOT_FOUND");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const expression = process.argv.includes("--refresh") ? "(()=>{const d=document.querySelector('.weui-desktop-dialog');const a=[...(d?.querySelectorAll('a')||[])].find(x=>x.textContent?.trim()==='刷新');if(!a)return 'no refresh link';a.click();return 'refreshed'})()" : process.argv.includes("--open") ? "(()=>{const section=document.querySelector('[data-component=server_domain]');const button=section?.querySelector('.btn_add');if(!button)return 'not found';button.click();return 'opened'})()" : process.argv.includes("--dialog") ? "[...document.querySelectorAll('[role=dialog],.dialog,.weui-desktop-dialog,.dialog_wrp')].filter(x=>x.getClientRects().length).map(x=>x.outerHTML.slice(0,12000)).slice(0,3)" : "(()=>{const label=[...document.querySelectorAll('*')].find(x=>x.children.length===0&&x.textContent?.trim()==='socket合法域名');if(!label)return 'not found';const row=label.closest('tr')||label.parentElement?.parentElement;return {row:row?.outerHTML.slice(0,4500),server:[...document.querySelectorAll('*')].filter(x=>x.children.length===0&&x.textContent?.trim()==='服务器域名').map(x=>x.parentElement?.parentElement?.outerHTML.slice(0,3500)).slice(0,2)}})()";
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error("CDP_TIMEOUT")), 10000);
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id !== 1) return; clearTimeout(timer); message.error ? reject(Error(message.error.message)) : resolve(message.result?.result?.value); };
  socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
});
socket.close();
console.log(JSON.stringify(result));
