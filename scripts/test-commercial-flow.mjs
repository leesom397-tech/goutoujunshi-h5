import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function page(file, api, wx = {}) {
  let definition;
  new Function('require', 'Page', 'wx', readFileSync(file, 'utf8'))(
    name => name.includes('knowledge-stats') ? { hanCharacters: 76735, sourceCount: 46 } : api,
    value => { definition = value; }, wx);
  return { ...definition, data: structuredClone(definition.data), setData(value, callback) { Object.assign(this.data, value); callback?.(); } };
}

let pending = true;
const navigation = [];
const home = page('miniapp/pages/home/index.js', {
  pendingUpload: path => pending && path.endsWith('/batch') ? { taskId: 'existing-task' } : null,
  session: async () => ({ token: 'session' })
}, { navigateTo: value => navigation.push(value.url) });
home.onShow();
assert.equal(home.data.pendingTasks.length, 1);
home.open({ currentTarget: { dataset: { entry: home.data.pendingTasks[0].entry } } });
assert.equal(navigation.at(-1), '/pages/quick/index');
pending = false;
home.onShow();
assert.equal(home.data.hasPendingTasks, false);

const copied = [], scrolled = [];
const quick = page('miniapp/pages/quick/index.js', {}, {
  setClipboardData: value => copied.push(value.data), pageScrollTo: value => scrolled.push(value.selector)
});
quick.data.result.replies = [{ text: '原回复', personalizedText: '调整后的回复' }];
quick.copyReply({ currentTarget: { dataset: { index: 0 } } });
quick.copyReply({ currentTarget: { dataset: { index: -1 } } });
assert.deepEqual(copied, ['调整后的回复']);
quick.data.showLines = false;
quick.jumpReport({ currentTarget: { dataset: { section: 'lines' } } });
assert.equal(quick.data.showLines, true);
assert.equal(scrolled.at(-1), '#report-lines');
quick.jumpReport({ currentTarget: { dataset: { section: 'unknown' } } });
assert.equal(scrolled.length, 1);

const account = page('miniapp/pages/account/index.js', {
  session: async () => ({ token: 'session' }),
  request: async () => ({ account: { balance: 0, features: [], entries: [] }, meteringReady: true,
    prices: { text: 8, profile: 0, voice: 'invalid' } })
});
await account.load();
assert.deepEqual(account.data.priceRows.map(item => [item.key, item.amount]), [['profile', 0], ['text', 8]]);
assert.equal(account.data.hasPrices, true);
console.log('PASS: home resumes existing tasks; completed tasks disappear; copy uses personalized text; report jump reveals lines; prices follow server including zero.');
