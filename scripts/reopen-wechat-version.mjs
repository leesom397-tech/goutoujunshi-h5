// Open the same authenticated version-management URL in a fresh local Chrome tab.
// Do not print the URL because it contains the administrator session token.
const tabs = await fetch("http://127.0.0.1:9223/json/list").then(response => response.json());
const page = tabs.find(tab => tab.url?.startsWith("https://mp.weixin.qq.com/wxamp/wacodepage/"));
if (!page) throw Error("VERSION_MANAGEMENT_TAB_NOT_FOUND");
const response = await fetch("http://127.0.0.1:9223/json/new?" + encodeURIComponent(page.url), { method: "PUT" });
if (!response.ok) throw Error("NEW_TAB_HTTP_" + response.status);
const opened = await response.json();
console.log(JSON.stringify({ opened: opened.type === "page", path: new URL(opened.url).pathname }));
