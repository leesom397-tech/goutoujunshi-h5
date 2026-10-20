/**
 * Real React/browser regression for shared follow-up reads and account isolation.
 * All HTTP requests use synthetic responses; no app server, account, or billing.
 * Run: node scripts/test-report-followup-browser.mjs (optional CHROME_BIN).
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

const origin = "http://127.0.0.1:8798";
const reportId = "11111111-1111-4111-8111-111111111111";
const bundled = await build({
  stdin: {
    contents: `
      import React from "react";
      import {createRoot} from "react-dom/client";
      import {ReportFollowUp, ReportActionFeedback} from "./components/web-analysis/ReportFollowUp";
      import {webAccountStore, announceAccountChange} from "./lib/web-account-session";
      const root=createRoot(document.getElementById("root"));
      window.harness={
        render(owner,subjectId,reportId,comparison=true){
          const report={subjectId,reportId};
          root.render(<>{comparison&&<ReportFollowUp report={report} owner={owner}/>}<ReportActionFeedback report={report} owner={owner}/></>);
        },
        async login(){announceAccountChange();await webAccountStore.refresh();},
        logout(){announceAccountChange(true);},
        clear(){root.render(null);},
        async ready(){await webAccountStore.refresh();}
      };
    `,
    resolveDir: process.cwd(),
    sourcefile: "report-followup-browser-fixture.tsx",
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "style-fixture",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default {}", loader: "js" }));
    },
  }],
});
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const errors = [], reads = [], writes = [], credits = [];
let serverOwner = "owner-a", holdCredits = false;
page.on("pageerror", error => errors.push(error.message));
await page.setRequestInterception(true);
const respond = (request, value, status = 200) => request.respond({
  status, contentType: "application/json", body: JSON.stringify(value),
});
page.on("request", async request => {
  try {
    const url = new URL(request.url());
    if (url.pathname === "/fixture") {
      await request.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' });
    } else if (url.pathname === "/api/web/account-context") {
      await respond(request, { account: { userId: serverOwner, balance: 100 }, people: [], prices: {} });
    } else if (url.pathname === "/api/account/credits") {
      credits.push({ request, owner: serverOwner });
      if (!holdCredits) await respond(request, { account: { userId: serverOwner } });
    } else if (url.pathname === "/api/web/relationship-feedback" && request.method() === "GET") {
      reads.push({ request, subject: url.searchParams.get("subjectId"), owner: serverOwner });
    } else if (url.pathname === "/api/web/relationship-feedback" && request.method() === "POST") {
      const body = JSON.parse(request.postData());
      writes.push({ owner: serverOwner, body });
      await respond(request, { feedback: { ...body, recordedAt: Date.now() } });
    } else {
      await request.abort();
    }
  } catch (error) {
    errors.push(error.message);
  }
});
const wait = (predicate, label) => new Promise((resolve, reject) => {
  const deadline = Date.now() + 10_000;
  const check = () => predicate() ? resolve() : Date.now() > deadline ? reject(Error(label)) : setTimeout(check, 20);
  check();
});
const render = (owner, subject, comparison = true) => page.evaluate(
  (owner, subject, reportId, comparison) => window.harness.render(owner, subject, reportId, comparison),
  owner, subject, reportId, comparison,
);
const waitText = text => page.waitForFunction(text => document.body.innerText.includes(text), { timeout: 10_000 }, text);
const finishRead = async (index, label, subject = reads[index].subject) => respond(reads[index].request, {
  subjectId: subject,
  versionChanges: { previousId: "previous", items: [{ title: label, detail: label, sources: [] }], note: "" },
  currentFeedback: { reportId, latest: null },
});
const click = text => page.evaluate(text => {
  const button = [...document.querySelectorAll("button")].find(node => node.textContent === text);
  if (!button) throw Error("Button missing: " + text);
  button.click();
}, text);
try {
  await page.goto(origin + "/fixture");
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await page.evaluate(() => window.harness.ready());
  await render("owner-a", "subject-one");
  await wait(() => reads.length === 1, "both cards should share one read");
  await finishRead(0, "第一份比较");
  await waitText("第一份比较");
  await waitText("后来怎么样了");
  assert.equal(reads.length, 1);
  assert.equal(credits.length, 0, "read-only cards reuse the account instead of verifying it twice");

  // Removing one card must not cancel the same in-flight request for the other.
  await render("owner-a", "subject-two");
  await wait(() => reads.length === 2, "second subject starts its own read");
  await render("owner-a", "subject-two", false);
  await finishRead(1, "只保留反馈");
  await waitText("后来怎么样了");
  assert.equal(reads.length, 2, "unmounting one consumer does not restart the shared read");

  // A response for an older person cannot populate either card for the new one.
  await render("owner-a", "subject-old");
  await wait(() => reads.length === 3, "old subject requested");
  await render("owner-a", "subject-new");
  await wait(() => reads.length === 4, "new subject requested");
  await finishRead(3, "新人物比较");
  await waitText("新人物比较");
  await finishRead(2, "不应显示的旧人物");
  assert.equal(await page.evaluate(() => document.body.innerText.includes("不应显示的旧人物")), false);

  // Account revision participates in the key even for the same owner and person.
  await render("owner-a", "subject-relogin");
  await wait(() => reads.length === 5, "read before relogin");
  await page.evaluate(() => window.harness.logout());
  await page.waitForFunction(() => !document.body.innerText.includes("后来怎么样了"));
  await page.evaluate(() => window.harness.login());
  await wait(() => reads.length === 6, "new login has a separate request");
  await finishRead(5, "重新登录后的比较");
  await waitText("重新登录后的比较");
  await finishRead(4, "不应显示的旧登录");
  assert.equal(await page.evaluate(() => document.body.innerText.includes("不应显示的旧登录")), false);

  await render("owner-a", "subject-account");
  await wait(() => reads.length === 7, "read before owner switch");
  serverOwner = "owner-b";
  await page.evaluate(() => window.harness.login());
  await render("owner-b", "subject-account");
  await wait(() => reads.length === 8, "new owner receives its own read");
  await finishRead(7, "乙账号比较");
  await waitText("乙账号比较");
  await finishRead(6, "不应显示的甲账号");
  assert.equal(await page.evaluate(() => document.body.innerText.includes("不应显示的甲账号")), false);
  assert.equal(credits.length, 0, "all read-only scenarios make zero extra credits requests");

  // A successful mutation still verifies the live account before writing.
  await click("试过了");
  await waitText("保存反馈");
  await click("保存反馈");
  await wait(() => writes.length === 1, "valid feedback is written");
  await waitText("已保存");
  assert.equal(credits.length, 1);
  assert.equal(writes[0].owner, "owner-b");
  assert.equal(writes[0].body.subjectId, "subject-account");
  assert.equal(writes[0].body.confirmed, true);

  // Switching accounts while the POST identity check is pending forbids the write.
  await render("owner-b", "subject-write-race");
  await wait(() => reads.length === 9, "write-race subject loaded");
  await finishRead(8, "准备补充");
  await waitText("准备补充");
  await click("情况变了");
  await waitText("保存反馈");
  holdCredits = true;
  await click("保存反馈");
  await wait(() => credits.length === 2, "mutation verification pending");
  serverOwner = "owner-c";
  await page.evaluate(() => window.harness.login());
  await respond(credits[1].request, { account: { userId: "owner-b" } });
  await page.waitForFunction(() => !document.body.innerText.includes("后来怎么样了"));
  assert.equal(writes.length, 1, "late identity success cannot POST into a changed account");
  assert.deepEqual(errors, []);
  console.log("PASS follow-up: shared read, independent consumer lifetime, subject/account/revision isolation, stale responses ignored, and live POST verification retained.");
} finally {
  await browser.close();
}
