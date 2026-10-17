import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

// Synthetic accounts only. All API calls and local capture bridge calls are intercepted.
const origin = process.env.INTAKE_TEST_ORIGIN || 'http://localhost:8798';
const output = path.resolve('outputs/first-use-tour');
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox']});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const tour = '[data-first-use-tour]';
const targets = {
  method: '[data-tour="capture-method"]', connect: '[data-tour="capture-connect"]', friend: '[data-tour="capture-friend"]',
  kind: '[aria-label="采集内容"]', video: '[data-video-import] button', window: '[aria-label="微信窗口自动截图"] button',
  upload: '#analysis-upload', person: '[data-tour="analysis-person"]', confirm: '.ax-submit-row',
};

async function clickText(page, root, text) {
  await page.evaluate(({root, text}) => {
    const button = [...document.querySelectorAll(root + ' button')].find(node => node.textContent.trim() === text);
    if (!button) throw Error('Missing button: ' + text);
    button.click();
  }, {root, text});
}

async function setup(width) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  const state = {owner: 'tour-fixture-' + width, errors: [], mutations: [], bridge: [], chooser: 0};
  await page.setViewport({width, height: width < 600 ? 844 : 1000});
  page.on('pageerror', error => state.errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    window.__tourCaptureCalls = [];
    if (navigator.mediaDevices) for (const method of ['getDisplayMedia', 'getUserMedia']) {
      navigator.mediaDevices[method] = async () => { window.__tourCaptureCalls.push(method); throw Error('Synthetic test blocks capture'); };
    }
    const original = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function(...args) {
      if (this.type === 'file') { window.__tourCaptureCalls.push('file-chooser'); return; }
      return original.apply(this, args);
    };
  });
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const url = new URL(request.url());
    if (url.port === '17863') { state.bridge.push(url.pathname); return request.abort('blockedbyclient'); }
    if (!url.pathname.startsWith('/api/')) return request.continue();
    if (!['GET', 'HEAD'].includes(request.method())) {
      state.mutations.push({path: url.pathname, method: request.method()});
      return request.respond({status: 409, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic test blocks all mutations'})});
    }
    let value = {};
    if (url.pathname === '/api/auth/session') value = {loggedIn: true, user: {id: state.owner, name: '合成引导测试'}};
    if (url.pathname === '/api/account/credits') value = {account: {userId: state.owner, balance: 500, active: true}, prices: {analysisSmall: 20, text: 5, profile: 30}};
    if (url.pathname === '/api/web/profile') value = {enabled: true, paused: false, subjects: []};
    if (url.pathname === '/api/web/report/list') value = {reports: []};
    if (url.pathname === '/api/web/workspace') value = {archive: {enabled: true, paused: false, pendingFacts: 0, selfReady: false}, people: [], reports: [], peopleTotal: 0, total: 0, page: 1, pageSize: 10};
    return request.respond({status: 200, contentType: 'application/json', body: JSON.stringify(value)});
  });
  return {context, page, state};
}

async function visibleTour(page) {
  await page.waitForSelector(tour + ' [role="dialog"]', {visible: true});
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-first-use-tour] [role="dialog"]');
    return panel && getComputedStyle(panel).visibility === 'visible' && !!document.querySelector('[data-tour-highlight]');
  });
  await wait(60);
}

async function checkStep(page, label) {
  await visibleTour(page);
  const result = await page.evaluate(targets => {
    const root = document.querySelector('[data-first-use-tour]'), step = root.dataset.tourStep;
    const panel = root.querySelector('[role="dialog"]'), highlight = root.querySelector('[data-tour-highlight]');
    const selector = step === 'kind' && location.pathname === '/analyze' ? '[aria-label="分析材料"]' : targets[step];
    const target = [...document.querySelectorAll(selector)].find(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const rect = node => { const r = node.getBoundingClientRect(); return {left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height}; };
    return {step, panel:rect(panel), highlight:rect(highlight), target:target && rect(target), width:innerWidth, height:innerHeight, scrollWidth:document.documentElement.scrollWidth, title:panel.getAttribute('aria-label'), header:panel.querySelector('header').textContent};
  }, targets);
  assert.equal(result.title, '操作引导');
  assert.ok(result.target, label + ': missing current target');
  assert.ok(result.panel.left >= 0 && result.panel.right <= result.width + 1 && result.panel.top >= 0 && result.panel.bottom <= result.height + 1, label + ': panel outside viewport ' + JSON.stringify(result));
  assert.ok(result.highlight.width > 0 && result.highlight.height > 0, label + ': invisible highlight');
  assert.ok(result.highlight.left < result.target.right && result.highlight.right > result.target.left && result.highlight.top < result.target.bottom && result.highlight.bottom > result.target.top, label + ': highlight misses real control');
  assert.ok(result.scrollWidth <= result.width + 1, label + ': page horizontal overflow');
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[data-first-use-tour] [role="dialog"]')), true, label + ': Tab escapes tour');
  }
  await page.keyboard.down('Shift');
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[data-first-use-tour] [role="dialog"]')), true, label + ': Shift+Tab escapes tour');
  }
  await page.keyboard.up('Shift');
  return result.step;
}

async function complete(page, label) {
  const steps = [];
  while (await page.$(tour)) {
    assert.ok(steps.length < 3, label + ': more than 3 steps');
    steps.push(await checkStep(page, label));
    const last = await page.$eval(tour, node => node.textContent.includes('知道了，开始使用'));
    await clickText(page, tour, last ? '知道了，开始使用' : '下一步');
    if (last) await page.waitForSelector(tour, {hidden: true});
    else await wait(100);
  }
  return steps;
}

async function replay(page) {
  const mobileHelp = await page.$('[aria-label="重看本页操作引导"]');
  if (mobileHelp && await mobileHelp.evaluate(node => node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility !== 'hidden')) {
    await mobileHelp.click();
    await visibleTour(page);
    return;
  }
  await page.click('[aria-label="搜索功能、人物与报告"]');
  await page.waitForSelector('#quick-search-field', {visible: true});
  await page.type('#quick-search-field', '重看本页操作引导');
  await page.waitForFunction(() => [...document.querySelectorAll('.quick-search-dialog button, .quick-search-dialog a')].some(node => node.textContent.includes('重看本页操作引导')));
  await page.evaluate(() => [...document.querySelectorAll('.quick-search-dialog button, .quick-search-dialog a')].find(node => node.textContent.includes('重看本页操作引导')).click());
  await visibleTour(page);
}

async function noAutomatic(page, label) {
  await wait(1000);
  assert.equal(await page.$(tour), null, label);
}

async function assertNoWork(page, state) {
  assert.deepEqual(state.mutations, [], 'tour must not upload, analyze, consent or charge');
  assert.deepEqual(state.bridge, [], 'tour must not connect to desktop WeChat helper');
  assert.deepEqual(await page.evaluate(() => window.__tourCaptureCalls), [], 'tour must not open file picker or capture devices');
  assert.deepEqual(state.errors, [], 'browser errors');
}

try {
  for (const width of (process.env.TOUR_TEST_WIDTHS || '1440,390,320').split(',').map(Number)) {
    const {context, page, state} = await setup(width);
    try {
      const method = width < 600 ? 'video' : 'computer';
      await page.goto(origin + '/capture?method=' + method, {waitUntil: 'networkidle0'});
      await visibleTour(page);
      await checkStep(page, width + ' first capture');
      await page.screenshot({path:path.join(output, 'capture-' + width + '.png')});
      const steps = await complete(page, width + ' capture');
      assert.deepEqual(steps, width < 600 ? ['method', 'kind', 'video'] : ['connect', 'friend']);
      await page.reload({waitUntil:'networkidle0'});
      await noAutomatic(page, 'same owner capture must remember completion');
      await replay(page); await page.keyboard.press('Escape');
      await page.waitForSelector(tour, {hidden:true});
      await noAutomatic(page, 'Esc must not immediately reopen');

      state.owner += '-other';
      await page.evaluate(() => window.dispatchEvent(new Event('chengzi:credits-changed')));
      await visibleTour(page);
      await clickText(page, tour, '跳过引导');
      await page.waitForSelector(tour, {hidden:true});
      await page.reload({waitUntil:'networkidle0'});
      await noAutomatic(page, 'second owner skip is remembered independently');
      const keys = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('chengzi-first-use:')));
      assert.equal(keys.length, 2, 'separate completion for each owner');
      await assertNoWork(page, state);

      await page.goto(origin + '/analyze?new=1&mode=chat', {waitUntil:'networkidle0'});
      await noAutomatic(page, 'analyze never opens guide automatically');
      await replay(page);
      const emptySteps = await complete(page, width + ' empty analyze');
      assert.ok(emptySteps.includes('upload'));
      assert.ok(!emptySteps.includes('person') && !emptySteps.includes('confirm'), 'no absent confirmation controls in empty guide');
      await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 600;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, 360, 600); ctx.fillStyle = '#202020'; ctx.font='20px sans-serif'; ctx.fillText('合成测试：周六一起喝咖啡吗？', 15, 80);
        const bytes=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c=>c.charCodeAt(0));
        const input=document.querySelector('input[aria-label="选择分析截图"]'), data=new DataTransfer(); data.items.add(new File([bytes], 'synthetic-tour.png', {type:'image/png'})); input.files=data.files; input.dispatchEvent(new Event('change', {bubbles:true}));
      });
      await page.waitForSelector('.wa-image');
      await noAutomatic(page, 'adding images does not automatically interrupt');
      await replay(page);
      await page.screenshot({path:path.join(output, 'analyze-' + width + '.png')});
      assert.deepEqual(await complete(page, width + ' populated analyze'), ['upload', 'person', 'confirm']);
      await assertNoWork(page, state);
      if (width === 390) {
        state.owner += '-manual-race';
        await page.goto(origin + '/capture?method=video', {waitUntil:'domcontentloaded'});
        await page.waitForFunction(() => {
          const button=document.querySelector('[aria-label="重看本页操作引导"]');
          return button && !button.disabled && button.getBoundingClientRect().width > 0;
        });
        await page.click('[aria-label="重看本页操作引导"]');
        await visibleTour(page);
        await clickText(page, tour, '下一步');
        await wait(900);
        assert.equal(await page.$eval(tour, node => node.dataset.tourStep), 'kind', 'pending automatic timer must not reset a manually advanced tour');
        await page.click(tour + ' [aria-label="关闭操作引导"]');
        await page.waitForSelector(tour, {hidden:true});
        await assertNoWork(page, state);
      }
      console.log('PASS ' + width + ': capture ' + (width < 600 ? '3' : '2') + '-step, completion/skip/Esc, owner isolation, manual help, analyze contextual controls, focus trap, no overflow or paid/capture requests');
    } finally { await context.close(); }
  }
  console.log('Screenshots: ' + output);
} finally { await browser.close(); }
