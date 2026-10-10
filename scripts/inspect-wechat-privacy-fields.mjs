// Read-only inspection of the already-open WeChat privacy-guide editor.
const tabs = await fetch("http://127.0.0.1:9223/json/list").then(response => response.json());
const page = tabs.find(tab => tab.url?.startsWith("https://mp.weixin.qq.com/wxamp/wadevelopcode/privacy"));
if (!page?.webSocketDebuggerUrl) throw Error("PRIVACY_TAB_NOT_FOUND");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const result = await new Promise((resolve, reject) => {
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    message.error ? reject(Error(message.error.message)) : resolve(message.result);
  };
  socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: {
    expression: "[...document.querySelectorAll('input,textarea,select')].filter(x=>x.getClientRects().length).map(x=>({tag:x.tagName,type:x.type||'',placeholder:x.placeholder||'',value:/^1[3-9]\\d{9}$/.test(x.value||'')?'[redacted]':x.value||'',checked:x.type==='radio'||x.type==='checkbox'?x.checked:undefined,near:x.parentElement?.parentElement?.innerText?.slice(0,100)||''})).filter(x=>!x.near.includes('电话')&&!x.near.includes('联系方式')).slice(0,80)",
    returnByValue: true
  } }));
});
socket.close();
console.log(JSON.stringify(result.result?.value));
