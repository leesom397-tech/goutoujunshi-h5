// Exercise public home -> account recovery without real credentials or paid calls.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const origin = process.env.INTAKE_TEST_ORIGIN || "http://127.0.0.1:8798";
const output = resolve("outputs/home-account-status");
await mkdir(output, { recursive: true });
const account = {
  account: { userId: "account-status-fixture", balance: 100, reserved: 0, spent: 0, active: true, features: ["chat"], entries: [] },
  prices: { text: 5 }, people: [], user: { name: "合成验收用户" }, admin: false,
};
const browser = await puppeteer.launch({
  headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"],
});
try {
  await Promise.all([1440, 390].map(async width => {
    for (const initialFailure of ["unavailable", "timeout"]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage(), errors = [], requests = [];
      let scenario = initialFailure, closed = false;
      await page.setViewport({ width, height: 950 });
      page.on("pageerror", error => errors.push(error.message));
      await page.setRequestInterception(true);
      page.on("request", async request => {
        try {
          const url = new URL(request.url());
          if (url.origin !== origin || !url.pathname.startsWith("/api/")) return request.continue();
          requests.push({ path: url.pathname, method: request.method(), scenario });
          let data = {}, status = 200;
          if (url.pathname === "/api/web/account-context") {
            if (scenario === "timeout") return; // Exercise the real browser request timeout.
            if (scenario === "unavailable") { status = 503; data = { error: "账号校验暂时不可用" }; }
            else if (scenario === "expired") { status = 401; data = { error: "请登录" }; }
            else data = account;
          }
          await request.respond({ status, contentType: "application/json", body: JSON.stringify(data) });
        } catch (error) { if (!closed) errors.push(error.message); }
      });
      const fits = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "viewport fits");
      const clickButton = text => page.evaluate(text => {
        const button = [...document.querySelectorAll("button")].find(el => el.textContent === text);
        if (!button || button.disabled) throw Error("No enabled button " + text);
        button.click();
      }, text);
      try {
        await page.goto(origin + "/workspace", { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-account-state="connection-error"]', { timeout: 30000 });
        assert.equal(new URL(page.url()).pathname, "/workspace", "temporary failure does not redirect home");
        assert.doesNotMatch(await page.$eval("body", el => el.innerText), /账户暂时未连接|账号校验暂时不可用|重新连接|signal timed out/, "account failure has no homepage banner");
        assert.equal(await page.$$eval('a[data-account-state]', els => els.length), 1, "one account status entry");
        const accountLink = await page.$eval('a[data-account-state]', el => ({ href: el.getAttribute("href"), label: el.getAttribute("aria-label"), title: el.title }));
        assert.equal(accountLink.href, "/account");
        assert.match(accountLink.label, /连接暂时中断/);
        assert.equal(accountLink.label, accountLink.title);
        assert.ok(await page.$eval('[aria-label="主导航"] a[href="/support"]', el => el.checkVisibility()), "download navigation stays available");
        assert.equal(await page.$$eval('[aria-label="主导航"] a', els => els.filter(el => el.hasAttribute("disabled")).length), 0);
        await fits();
        await page.screenshot({ path: resolve(output, `home-${initialFailure}-${width}.png`), fullPage: true });
        // Clicking the compact status leads to its relevant recovery surface.
        scenario = "unavailable";
        await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click('a[data-account-state]')]);
        await page.waitForSelector("[data-account-error]");
        assert.equal(new URL(page.url()).pathname, "/account");
        assert.match(await page.$eval("[data-account-error]", el => el.innerText), /账号校验暂时不可用/);
        assert.equal(await page.$('a[href^="/login"]'), null, "503 must not be presented as a sign out");
        scenario = "healthy";
        await clickButton("重新连接");
        await page.waitForFunction(() => document.querySelector("#balance")?.innerText.includes("100"));
        assert.match(await page.$eval("main", el => el.innerText), /合成验收用户/);
        assert.equal(await page.$("[data-account-error]"), null);
        assert.equal(await page.$eval("a[data-account-state]", el => el.dataset.accountState), "ready");
        // A background failure keeps the verified identity and balance visible.
        scenario = "unavailable";
        await clickButton("刷新");
        await page.waitForSelector("[data-account-error]");
        assert.match(await page.$eval("#balance", el => el.innerText), /100/);
        assert.match(await page.$eval("main", el => el.innerText), /合成验收用户/);
        assert.equal(await page.$('a[href^="/login"]'), null);
        await fits();
        await page.screenshot({ path: resolve(output, `account-recovery-${initialFailure}-${width}.png`), fullPage: true });
        // A genuine unauthorized response still clears the account and offers login.
        scenario = "expired";
        await clickButton("重新连接");
        await page.waitForSelector('a[href^="/login"]');
        assert.equal(await page.$("#balance"), null);
        assert.equal(await page.$eval("a[data-account-state]", el => el.dataset.accountState), "signed-out");
        assert.equal(requests.filter(row => row.method !== "GET").length, 0, "viewing/recovery never performs account mutations or paid actions");
        assert.deepEqual(errors, []);
        console.log(`PASS ${width} ${initialFailure}: compact home state -> account retry; transient error retains identity; genuine 401 clears it.`);
      } catch (error) {
        console.error(await page.$eval("body", el => el.innerText).catch(() => ""), errors);
        await page.screenshot({ path: resolve(output, `failure-${initialFailure}-${width}.png`), fullPage: true }).catch(() => {});
        throw error;
      } finally { closed = true; await context.close(); }
    }
  }));
} finally { await browser.close(); }
