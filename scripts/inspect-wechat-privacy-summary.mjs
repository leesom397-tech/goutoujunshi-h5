// Keyword-only read of the existing privacy editor. No names, contact fields, or URLs.
const tabs = await fetch("http://127.0.0.1:9223/json/list").then(response => response.json());
const page = tabs.find(tab => tab.url?.startsWith("https://mp.weixin.qq.com/wxamp/wadevelopcode/privacy") && tab.webSocketDebuggerUrl);
if (!page) throw Error("PRIVACY_EDITOR_TAB_NOT_FOUND");
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
    expression: "(()=>{const values=[...document.querySelectorAll('input,textarea,select')].filter(x=>x.getClientRects().length).map(x=>String(x.value||''));const text=values.join('\\n');const terms=['提前上传','登录或者注册','显示距离','实名认证','语音','录音','阿里云','百炼','7天','7 天','档案'];return {visibleFieldCount:values.length,termPresent:Object.fromEntries(terms.map(term=>[term,text.includes(term)]))}})()",
    returnByValue: true
  } }));
});
socket.close();
console.log(JSON.stringify(result.result?.value));
