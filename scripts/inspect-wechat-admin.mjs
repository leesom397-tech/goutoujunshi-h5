// Read-only local CDP inspection of the already-open WeChat admin page.
const tabs = await fetch("http://127.0.0.1:9223/json/list").then(response => response.json());
const page = tabs.find(tab => tab.url?.startsWith("https://mp.weixin.qq.com/wxamp/"));
if (!page?.webSocketDebuggerUrl) throw Error("WECHAT_ADMIN_TAB_NOT_FOUND");
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
    expression: process.argv.includes("--reload") ? "location.reload(); 'reloading'" : process.argv.includes("--dialogs") ? "[...document.querySelectorAll('[role=dialog],.weui-desktop-dialog,.weui-desktop-dialog__wrp')].filter(x=>x.getClientRects().length).map(x=>({text:x.innerText.slice(0,5000),htmlStart:x.outerHTML.slice(0,300)})).slice(0,5)" : process.argv.includes("--open-privacy") ? "(()=>{const row=[...document.querySelectorAll('.meta_name')].find(x=>x.textContent?.trim()==='用户隐私保护指引')?.closest('tr');const link=[...(row?.querySelectorAll('a')||[])].find(x=>x.innerText.trim()==='去完善');if(!link)return 'not found';link.click();return 'opened'})()" : process.argv.includes("--privacy-link") ? "(()=>{const row=[...document.querySelectorAll('.meta_name')].find(x=>x.textContent?.trim()==='用户隐私保护指引')?.closest('tr');return [...(row?.querySelectorAll('a,button')||[])].map(x=>({text:x.innerText.trim(),href:x.href||null,outer:x.outerHTML.slice(0,300)}))})()" : process.argv.includes("--release-gates") ? "[...document.querySelectorAll('.meta_name')].filter(x=>/隐私保护指引|服务类目|主体信息|备案/.test(x.textContent||'')).map(x=>({name:x.textContent?.trim(),row:x.closest('tr')?.innerText.slice(0,900),visible:!!x.getClientRects().length}))" : process.argv.includes("--inspect-basic") ? "[...document.querySelectorAll('*')].filter(x=>x.children.length<2&&/基本设置|隐私|类目/.test(x.textContent||'')).slice(0,20).map(x=>({tag:x.tagName,text:x.textContent?.trim().slice(0,80),html:x.outerHTML.slice(0,350)}))" : process.argv.includes("--go-account") ? "(()=>{const x=[...document.querySelectorAll('a')].find(x=>x.title==='账号设置');if(!x)return 'not found';location.assign(x.href);return 'navigating'})()" : process.argv.includes("--go-dev") ? "(()=>{const x=[...document.querySelectorAll('a')].find(x=>x.title==='开发管理');if(!x)return 'not found';location.assign(x.href);return 'navigating'})()" : process.argv.includes("--inspect-menu") ? "[...document.querySelectorAll('a')].filter(x=>/开发管理|开发设置|隐私|服务器域名/.test(x.innerText)).map(x=>({text:x.innerText,href:x.href,outer:x.outerHTML.slice(0,350)})).slice(0,25)" : process.argv.includes("--qr-meta") ? "[...document.querySelectorAll('img,canvas')].filter(x=>x.closest('[role=dialog],.weui-desktop-dialog,.dialog')||x.src?.startsWith('data:image')).map(x=>({tag:x.tagName,srcStart:x.src?.slice(0,80),srcLength:x.src?.length,width:x.width,height:x.height,outer:x.outerHTML.slice(0,260)})).slice(-12)" : process.argv.includes("--inspect-experience") ? "[...document.querySelectorAll('.code_version_log')].filter(x=>x.innerText.includes('1.0.20')).map(x=>x.outerHTML.slice(0,2500))" : process.argv.includes("--open-experience") ? "(()=>{const row=[...document.querySelectorAll('.code_version_log')].find(x=>x.innerText.includes('1.0.20')); const icon=row?.querySelector('i[data-msgid=\"扫描访问体验版\"]'); if(!icon) return 'not found'; icon.click(); return 'clicked';})()" : "({title:document.title,url:location.href,text:document.body.innerText.slice(0,9000),buttons:[...document.querySelectorAll('button')].map(x=>x.innerText).filter(Boolean).slice(0,45)})",
    returnByValue: true
  } }));
});
socket.close();
console.log(JSON.stringify(result.result?.value));
