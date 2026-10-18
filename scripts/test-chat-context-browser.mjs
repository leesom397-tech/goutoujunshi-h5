// Synthetic browser checks only; every API request is intercepted locally.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const origin = process.env.INTAKE_TEST_ORIGIN || 'http://127.0.0.1:8798';
const output = process.env.CHAT_TEST_OUTPUT || 'D:/temp/chengzi-chat-context';
await mkdir(output, { recursive: true });
const ownerA = '11111111-1111-4111-8111-111111111111', ownerB = '44444444-4444-4444-8444-444444444444';
const person = '22222222-2222-4222-8222-222222222222';
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
const checks = [], errors = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    await page.setViewport({ width, height: 1000 });
    let owner = ownerA, failNext = false;
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.setRequestInterception(true);
    page.on('request', async request => {
      if (!request.url().startsWith(origin)) return request.abort();
      const path = new URL(request.url()).pathname;
      if (!path.startsWith('/api/')) return request.continue();
      let status = 200, data = {};
      if (path === '/api/auth/session') data = { loggedIn: true, user: { id: owner, name: '合成测试账号' } };
      else if (path === '/api/account/credits') data = { account: { userId: owner, balance: 100, reserved: 0, active: true, features: ['chat', 'analysis'] }, prices: { text: 5, transcription: 5 } };
      else if (path === '/api/web/profile') data = { enabled: true, paused: false, subjects: [{ id: person, label: '合成人物甲' }] };
      else if (path === '/api/web/text') {
        const body = JSON.parse(request.postData()); requests.push(body);
        if (failNext) { failNext = false; status = 503; data = { error: '合成断线，保留本次请求重试。' }; }
        else if (!body.background && !body.opening && !body.skipIntake && body.self === '他喜欢我吗？') data = { clarification: { kind: 'background', questions: ['你们现在是什么关系，认识多久了？', '最近哪次具体互动，让你想问这个问题？'] }, charged: false };
        else data = { possibleIntent: '合成回答：可以先确认具体安排。', evidence: '周六下午可以见面', nextStep: '选择与你的实际安排一致的表达。', historyStatus: 'none', replies: [
          { style: '自然承接', text: '周六两点可以吗？', reason: '承接对方提出的周六', cost: '先确认自己两点有空', weight: 90 },
          { style: '重复', text: '周六两点可以吗', reason: '同一句', cost: '同一条件', weight: 50 },
          { style: '保留空间', text: '我确认一下周六的时间再告诉你。', reason: '自己的时间未确定', cost: '需要随后主动确认', weight: 70 },
        ] };
      } else { status = 501; data = { error: 'Unexpected synthetic API ' + path }; }
      await request.respond({ status, contentType: 'application/json', body: JSON.stringify(data) });
    });
    const mainInput = '.wa-composer > label.wa-field textarea';
    async function input(selector, value) { await page.$eval(selector, (node, text) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(node, text); node.dispatchEvent(new Event('input', { bubbles: true })); }, value); }
    async function press(label) { await page.evaluate(text => { const button = [...document.querySelectorAll('button')].find(node => node.textContent.includes(text) && !node.disabled); if (!button) throw Error('Missing button: ' + text); button.click(); }, label); }
    async function consent() { await page.$eval('.wa-composer input[type=checkbox]', node => { if (!node.checked) node.click(); }); }
    async function answered(count) { await page.waitForFunction(n => document.querySelectorAll('.wa-chat-message[data-role=assistant]').length === n, {}, count); }
    await page.goto(origin + '/chat', { waitUntil: 'networkidle0' });
    await page.waitForSelector(mainInput);
    await input(mainInput, '他喜欢我吗？'); await consent();
    await page.waitForFunction(() => document.querySelector('.wa-composer .wa-primary')?.textContent.includes('免费'));
    await press('先补充情况');
    await page.waitForSelector('#chat-background', { visible: true });
    assert.equal(requests.length, 1); assert.equal(await page.$eval('#chat-background', node => node.value), '');
    const background = '朋友介绍认识两个月。对方说“周六下午可以见面”，但我还没确认时间。';
    const longQuestion = '我们之前还谈过一些具体安排，需要结合当时情况判断。'.repeat(30) + '我现在该怎么回？';
    assert.ok(longQuestion.length > 600);
    await input('#chat-background', background); await input(mainInput, longQuestion); await press('发送 ·'); await answered(1);
    assert.equal(requests.at(-1).background, background);
    await page.waitForFunction(text => document.querySelector('textarea[aria-label="本次话题的起始描述"]')?.value === text, {}, longQuestion);
    assert.equal(await page.$$eval('.chat-quick-reply', rows => rows.length), 2, 'duplicate replies are omitted');
    await page.$eval('.chat-reply-conditions summary', node => node.click());
    assert.match(await page.$eval('.chat-reply-conditions', node => node.textContent), /承接对方提出的周六.*先确认自己两点有空/);
    await page.$eval('.chat-quick-reply', node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.screenshot({ path: `${output}/reply-conditions-${width}.png` });
    const beforeRewrite = requests.length; await press('更口语');
    await page.waitForFunction(selector => document.querySelector(selector)?.value.includes('改得更口语'), {}, mainInput);
    assert.equal(requests.length, beforeRewrite, 'rewrite only fills draft, never starts a charge');
    assert.match(await page.$eval('.chat-rewrite', node => node.textContent), /确认发送才扣 5 积分/);
    await press('发送 ·'); await answered(2);
    for (let turn = 3; turn <= 5; turn++) { await input(mainInput, '那下一步还要观察什么？'); await press('发送 ·'); await answered(turn); }
    assert.equal(requests.at(-1).opening, longQuestion, 'opening survives more than three turns');
    assert.equal(requests.at(-1).background, background, 'background remains independent of short history');
    const correction = '更正：昨天已经见面，今天需要确认下次安排。';
    await page.$eval('textarea[aria-label="本次对话补充背景"]', node => node.closest('details').open = true);
    await input('textarea[aria-label="本次对话补充背景"]', correction);
    await page.$eval('textarea[aria-label="本次对话补充背景"]', node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.screenshot({ path: `${output}/editable-background-${width}.png` });
    await input(mainInput, '结合更正后的情况，我怎么问？'); failNext = true; await press('发送 ·');
    await page.waitForFunction(() => document.body.textContent.includes('合成断线'));
    const failed = requests.at(-1); assert.equal(failed.background, correction);
    await page.reload({ waitUntil: 'networkidle0' }); await consent(); await press('重试本次提问'); await answered(6);
    assert.deepEqual(requests.at(-1), failed, 'reload retries identical body and request ID');
    await page.$eval('.chat-reply-conditions summary', node => node.click());
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow');
    await page.screenshot({ path: `${output}/chat-context-${width}.png`, fullPage: true });
    await page.select('#chat-active-person', person);
    await page.waitForFunction(() => document.querySelectorAll('.wa-chat-message').length === 0);
    await input(mainInput, '这次是另一个人的问题。'); await consent(); await press('发送 ·'); await answered(1);
    assert.equal(requests.at(-1).opening, ''); assert.equal(requests.at(-1).background, '', 'person switch clears previous private context');
    owner = ownerB; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelectorAll('.wa-chat-message').length === 0);
    assert.equal(await page.$eval(mainInput, node => node.value), '', 'owner change clears drafts');
    checks.push({ width, requests: requests.length, freeIntake: true, durableContext: true, correctionReplay: true, conditions: true, explicitRewrite: true, ownerIsolation: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ synthetic: true, realProviderCalls: 0, checks, errors }, null, 2));
  console.log(JSON.stringify({ output, checks, errors }));
} finally { await browser.close(); }
