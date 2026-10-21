/** Actual Chrome/React with synthetic reads only. No credentials or paid APIs. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const origin = process.env.INTAKE_TEST_ORIGIN || 'http://127.0.0.1:8798';
const account = owner => ({ account: { userId: owner, balance: 20 }, people: [], admin: false });
const workspace = name => ({ people: [], reports: [{ id: name, label: name, summary: name }], archive: {}, total: 1, peopleTotal: 0, page: 1, pageSize: 10 });
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
const errors = [];
try {
  // Cover the actual public route, including all navigation components.
  const publicPage = await browser.newPage(), publicCalls = [];
  publicPage.on('pageerror', error => errors.push(error.message));
  await publicPage.setRequestInterception(true);
  publicPage.on('request', async request => {
    const url = new URL(request.url());
    if (url.origin !== origin || !url.pathname.startsWith('/api/')) return request.continue();
    publicCalls.push(url.pathname);
    const data = url.pathname === '/api/web/account-context' ? account('public-owner') : url.pathname === '/api/web/workspace' ? workspace('Public Search Result') : {};
    await request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await publicPage.goto(`${origin}/support`, { waitUntil: 'networkidle0' });
  await publicPage.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); });
  assert.deepEqual(publicCalls.filter(path => /account|workspace/.test(path)), [], 'closed search on public support does not verify account or read records');
  await publicPage.click('button[aria-label="搜索功能、人物与报告"]');
  await publicPage.waitForFunction(() => document.querySelector('.quick-search-results')?.textContent.includes('Public Search Result'));
  assert.deepEqual(publicCalls.filter(path => /account|workspace/.test(path)), ['/api/web/account-context', '/api/web/workspace'], 'opening search verifies once, then reads authorized records');
  await publicPage.click('button[aria-label="关闭搜索"]');
  await publicPage.close();

  // Isolate commits to detect even one-render exposure before passive cleanup.
  // Account store, session lifecycle, fetch timeout, and component are production code.
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{Profiler} from 'react'; import {createRoot} from 'react-dom/client';
    import {QuickSearch} from './components/QuickSearch';
    import {webAccountStore,announceAccountChange} from './lib/web-account-session';
    window.requests=[];window.commits=[];window.failNext=false;window.fastTimeout=false;window.ignoreNextAbort=false;
    const timeout=AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout=ms=>timeout(window.fastTimeout&&ms===12000?100:ms);
    window.fetch=(url,options={})=>new Promise((resolve,reject)=>{
      const entry={url:String(url),options,resolve,reject,ignoreAbort:window.ignoreNextAbort};
      window.ignoreNextAbort=false;window.requests.push(entry);
      if(window.failNext){window.failNext=false;reject(new TypeError('Failed to fetch'));return;}
      const abort=()=>{entry.aborted=true;if(!entry.ignoreAbort)reject(options.signal.reason);};
      if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
    });
    window.respond=(index,data,status=200)=>window.requests[index].resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));
    window.store=webAccountStore;window.announce=announceAccountChange;
    createRoot(document.getElementById('app')).render(<Profiler id="search" onRender={()=>window.commits.push({owner:webAccountStore.getSnapshot().account?.account?.userId,query:document.querySelector('#quick-search-field')?.value,text:document.querySelector('.quick-search-results')?.textContent||''})}><QuickSearch/></Profiler>);
  ` }, bundle: true, write: false, outfile: '.tmp/quick-search-fixture.js', format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent', plugins: [{ name: 'search-route-only', setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
    builder.onResolve({ filter: /FirstUseTour$/ }, args => args.importer.endsWith('QuickSearch.tsx') ? { path: 'tour', namespace: 'fixture' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'navigation' ? "export const usePathname=()=>'/support';" : "export const TOUR_EVENT='synthetic-tour';" }));
  } }] });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => request.respond({ status: 200, contentType: 'text/html', body: `<style>${css}</style><main id="app"></main><script>${js}</script>` }));
  await page.goto(`${origin}/__quick-search-fixture`, { waitUntil: 'load' });
  const readCount = () => page.evaluate(() => window.requests.length);
  const waitRead = count => page.waitForFunction(count => window.requests.length >= count, {}, count);
  const respond = (index, data, status = 200) => page.evaluate(({ index, data, status }) => window.respond(index, data, status), { index, data, status });
  const contains = text => page.waitForFunction(text => document.querySelector('.quick-search-results')?.textContent.includes(text), {}, text);
  const query = async value => { await page.focus('#quick-search-field'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type(value); };
  await page.waitForSelector('button[aria-label="搜索功能、人物与报告"]');
  assert.equal(await readCount(), 0, 'mount remains read-only');
  await page.click('button[aria-label="搜索功能、人物与报告"]');
  await waitRead(1); assert.equal(await page.evaluate(() => window.requests[0].url), '/api/web/account-context');
  await respond(0, account('owner-a')); await waitRead(2); await respond(1, workspace('Owner A Report')); await contains('Owner A Report');

  await query('Alpha');
  assert.equal(await page.evaluate(() => window.commits.filter(commit => commit.query === 'Alpha').some(commit => commit.text.includes('Owner A Report'))), false, 'query render immediately masks old records before effects');
  await waitRead(3); await respond(2, workspace('Alpha Result')); await contains('Alpha Result');
  await page.evaluate(() => { window.ignoreNextAbort = true; });
  await query('Beta'); await waitRead(4);
  await query('Gamma'); await waitRead(5); await respond(4, workspace('Gamma Result')); await contains('Gamma Result');
  await respond(3, workspace('Late Beta Result'));
  assert.equal(await page.evaluate(() => window.commits.some(commit => commit.query === 'Gamma' && /Alpha Result|Beta Result/.test(commit.text))), false, 'debounced or late old query never appears under new query');

  await page.evaluate(() => { window.fastTimeout = true; });
  await query('Timeout'); await waitRead(6); await contains('查找已超过 12 秒');
  assert.equal(await page.evaluate(() => window.requests[5].aborted), true, 'timeout aborts the underlying read');
  await page.evaluate(() => { window.fastTimeout = false; });
  await page.click('[role="alert"] button'); await waitRead(7); await respond(6, workspace('Retry Result')); await contains('Retry Result');
  await page.evaluate(() => { window.failNext = true; });
  await query('Offline'); await waitRead(8); await contains('暂时无法读取记录');
  assert.equal(await page.evaluate(() => window.store.getSnapshot().unauthorized), false, 'network failure does not sign out');
  await page.click('[role="alert"] button'); await waitRead(9); await respond(8, workspace('Recovered Owner A')); await contains('Recovered Owner A');

  // A refreshed identity may change owner without an explicit local logout.
  await page.evaluate(() => { void window.store.refresh({ force: true }); });
  await waitRead(10); await respond(9, account('owner-b')); await waitRead(11);
  assert.equal(await page.evaluate(() => window.commits.filter(commit => commit.owner === 'owner-b').some(commit => /Recovered Owner A|Retry Result/.test(commit.text))), false, 'new owner commit masks old data immediately');
  await respond(10, workspace('Owner B Report')); await contains('Owner B Report');

  // Keep a request alive despite cancellation to simulate a late old-session 401.
  await page.evaluate(() => { window.ignoreNextAbort = true; });
  await query('Late401'); await waitRead(12);
  await page.evaluate(() => window.announce(false)); await waitRead(13);
  await respond(12, account('owner-c')); await waitRead(14); await respond(13, workspace('Owner C Report')); await contains('Owner C Report');
  await respond(11, { error: 'expired previous login' }, 401);
  assert.equal(await page.evaluate(() => window.store.getSnapshot().account?.account?.userId), 'owner-c', 'old-session 401 cannot expire the new login');
  await query('Current401'); await waitRead(15); await respond(14, { error: 'expired' }, 401); await contains('登录后可查找');
  assert.equal(await page.evaluate(() => window.store.getSnapshot().unauthorized), true, 'current-session 401 expires display credentials');
  assert.equal(await page.evaluate(() => document.querySelector('.quick-search-results').textContent.includes('Owner C Report')), false, 'logout removes private search results');

  await page.click('button[aria-label="关闭搜索"]');
  const before = await readCount();
  await page.evaluate(() => window.dispatchEvent(new Event('chengzi:credits-changed')));
  assert.equal(await readCount(), before, 'closing search releases the account watcher');
  assert.equal(await page.evaluate(() => window.requests.every(request => (request.options.method || 'GET') === 'GET')), true, 'every request is a read');

  await page.reload({ waitUntil: 'load' });
  await page.click('button[aria-label="搜索功能、人物与报告"]');
  await waitRead(1); await respond(0, { error: 'synthetic temporary outage' }, 503); await contains('账户暂时未连接');
  assert.equal(await page.evaluate(() => window.store.getSnapshot().unauthorized), false, 'initial identity outage offers recovery instead of forcing login');
  await page.click('[role="alert"] button'); await waitRead(2); await respond(1, account('recovered-owner'));
  await waitRead(3); await respond(2, workspace('Recovered Account Report')); await contains('Recovered Account Report');
  assert.deepEqual(errors, []);
  console.log('PASS quick search: public support has no passive account/workspace reads; open verifies once; query/owner commit isolation; debounce/late response; aborting timeout; offline/identity retry; old-session 401 isolation; current 401 logout; close cleanup. Actual Chrome/React and store; synthetic GETs only.');
} finally { await browser.close(); }
