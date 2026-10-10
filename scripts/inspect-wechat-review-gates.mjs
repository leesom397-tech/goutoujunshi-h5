// Read only the existing authenticated account-settings tab. Never print its URL.
const tabs = await fetch("http://127.0.0.1:9223/json/list").then(response => response.json());
const page = tabs.find(tab => tab.url?.startsWith("https://mp.weixin.qq.com/wxamp/basicprofile/") && tab.webSocketDebuggerUrl);
if (!page) throw Error("ACCOUNT_SETTINGS_TAB_NOT_FOUND");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error("CDP_TIMEOUT")), 10000);
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timer);
    message.error ? reject(Error(message.error.message)) : resolve(message.result);
  };
  socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: {
    expression: "(()=>{const names=['微信认证','小程序备案','用户隐私保护指引','服务类目','账号介绍'];return [...document.querySelectorAll('tr')].map(row=>({name:row.querySelector('.meta_name')?.textContent?.trim()||'',status:row.innerText.trim()})).filter(row=>names.some(name=>row.name.includes(name))).map(row=>({name:row.name,status:row.status.replace(row.name,'').trim().slice(0,320)}))})()",
    returnByValue: true
  } }));
});
socket.close();
console.log(JSON.stringify(result.result?.value));
