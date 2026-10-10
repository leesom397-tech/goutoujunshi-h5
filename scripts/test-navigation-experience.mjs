import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const event = dataset => ({ currentTarget: { dataset } });
const hub = (route, options = {}, data = {}) => ({ route: `pages/${route}/index`, options, data });

function navigation(pages, selected = 'home') {
  let definition;
  const calls = [];
  const wx = Object.fromEntries(['navigateBack', 'navigateTo', 'redirectTo'].map(method => [
    method, options => calls.push({ method, ...options })
  ]));
  new Function('Component', 'wx', 'getCurrentPages', read('miniapp/components/main-navigation/index.js'))(
    value => { definition = value; }, wx, () => pages
  );
  const component = { ...definition.methods, data: { selected } };
  return { component, calls, tap: target => component.open(event({ target })) };
}

for (const [target, route] of [['home', 'home'], ['people', 'archive'], ['me', 'account']]) {
  const nav = navigation([hub(route), hub('report')], target === 'home' ? 'people' : 'home');
  nav.tap(target);
  assert.equal(nav.calls.length, 1);
  assert.equal(nav.calls[0].method, 'navigateBack', `${target} should reuse its existing hub`);
  assert.equal(nav.calls[0].delta, 1);
}

for (const existing of [
  hub('archive', { tab: 'self' }),
  hub('archive', { subjectId: 'person-one' }),
  hub('archive', {}, { selectedId: 'person-one' })
]) {
  const nav = navigation([existing, hub('chat')]);
  nav.tap('people');
  assert.equal(nav.calls[0].method, 'navigateTo', 'my profile or a person detail must not masquerade as the people hub');
  assert.equal(nav.calls[0].url, '/pages/archive/index');
}

{
  const nav = navigation([hub('home'), hub('archive'), hub('archive', { tab: 'self' }), hub('chat')]);
  nav.tap('people');
  assert.equal(nav.calls[0].method, 'navigateBack', 'a later self-profile page must not hide an earlier reusable people hub');
  assert.equal(nav.calls[0].delta, 2);
}

for (const count of [8, 9]) {
  const nav = navigation(Array.from({ length: count }, () => hub('chat')));
  nav.tap('people');
  assert.equal(nav.calls[0].method, count >= 9 ? 'redirectTo' : 'navigateTo', 'a nearly full native stack must replace instead of overflow');
  assert.equal(nav.calls[0].url, '/pages/archive/index');
}

{
  const nav = navigation([hub('archive'), ...Array.from({ length: 8 }, () => hub('chat'))]);
  nav.tap('people');
  assert.equal(nav.calls[0].method, 'navigateBack', 'reuse wins even when the native stack is nearly full');
  assert.equal(nav.calls[0].delta, 8);
}

{
  const nav = navigation([hub('home')]);
  nav.tap('home');
  nav.tap('unknown');
  assert.equal(nav.calls.length, 0, 'active and unknown destinations are no-ops');
  nav.tap('people');
  nav.tap('me');
  assert.equal(nav.calls.length, 1, 'rapid repeated taps must start only one navigation');
  nav.calls[0].complete({ errMsg: 'navigateTo:fail' });
  nav.tap('me');
  assert.equal(nav.calls.length, 2, 'completion, including failure, must release the tap lock');
  assert.equal(nav.calls[1].url, '/pages/account/index');
}

const navMarkup = read('miniapp/components/main-navigation/index.wxml');
for (const target of ['home', 'people', 'me']) {
  assert.match(navMarkup, new RegExp(`<button\\b[^>]*data-target="${target}"[^>]*bindtap="open"`));
}
assert.match(navMarkup, /aria-current=/, 'native navigation should identify the current section');

function page(path, wx, modules = {}) {
  let definition;
  new Function('require', 'Page', 'wx', read(path))(
    id => {
      assert.ok(Object.hasOwn(modules, id), `unexpected page dependency: ${id}`);
      return modules[id];
    },
    value => { definition = value; }, wx
  );
  return { ...definition, data: structuredClone(definition.data), setData(next) { Object.assign(this.data, next); } };
}

const copied = [];
const opened = [];
const wx = {
  setClipboardData(options) { copied.push(options.data); },
  navigateTo(options) { opened.push(options.url); }
};
const account = page('miniapp/pages/account/index.js', wx, { '../../lib/api': {} });
for (const value of [null, {}, { userId: '' }, { userId: '   ' }, { userId: 0 }, { userId: 42 }, { userId: {} }]) {
  account.setData({ account: value });
  account.copyId();
}
assert.equal(copied.length, 0, 'an unavailable or invalid account ID must not overwrite the clipboard');
account.setData({ account: { userId: 'valid-user-id' } });
account.copyId();
assert.deepEqual(copied, ['valid-user-id']);
account.openProfile();
assert.equal(opened.at(-1), '/pages/archive/index?tab=self', 'my profile must retain its explicit self scope');
assert.match(read('miniapp/pages/account/index.wxml'), /<button\b[^>]*bindtap="copyId"/);

const chat = page('miniapp/pages/chat/index.js', wx, { '../../lib/api': {}, '../../lib/followup-context': {} });
const beforeChatCopies = copied.length;
chat.copyConversationReply(event({ message: 'missing', index: 0 }));
chat.setData({ messages: [
  { id: 'user-turn', role: 'user', replies: [{ text: '用户原话' }] },
  { id: 'assistant-turn', role: 'assistant', replies: [{ text: '可以，周日下午见。' }] }
] });
chat.copyConversationReply(event({ message: 'user-turn', index: 0 }));
for (const index of [-1, 1.5, 'not-a-number', 20, undefined]) {
  chat.copyConversationReply(event({ message: 'assistant-turn', index }));
}
for (const text of [undefined, null, '', '   ', 7, {}]) {
  chat.setData({ messages: [{ id: 'invalid-reply', role: 'assistant', replies: [{ text }] }] });
  chat.copyConversationReply(event({ message: 'invalid-reply', index: 0 }));
}
assert.equal(copied.length, beforeChatCopies, 'only a present, nonblank assistant reply may be copied');
chat.setData({ messages: [{ id: 'assistant-turn', role: 'assistant', replies: [{ text: '可以，周日下午见。', reason: '仅解释，不应一起复制' }] }] });
chat.copyConversationReply(event({ message: 'assistant-turn', index: '0' }));
assert.equal(copied.at(-1), '可以，周日下午见。', 'copy only the selected sendable sentence');
assert.match(read('miniapp/pages/chat/index.wxml'), /<button\b[^>]*data-message="\{\{message\.id\}\}"[^>]*bindtap="copyConversationReply"/);

const home = page('miniapp/pages/home/index.js', wx, {
  '../../lib/api': {}, '../../lib/knowledge-stats': { hanCharacters: 100000, sourceCount: 12 }
});
const destinations = {
  quick: '/pages/quick/index',
  'social-profile': '/pages/social-profile/index',
  archive: '/pages/archive/index',
  self: '/pages/archive/index?tab=self',
  account: '/pages/account/index',
  chat: '/pages/chat/index?mode=chat',
  positioning: '/pages/chat/index?mode=positioning',
  voice: '/pages/chat/index?mode=chat'
};
for (const [entry, url] of Object.entries(destinations)) {
  home.open(event({ entry }));
  assert.equal(opened.at(-1), url, `${entry} must keep its existing native destination`);
}
const beforeInvalidHomeTap = opened.length;
home.open(event({ entry: 'unknown' }));
assert.equal(opened.length, beforeInvalidHomeTap);
home.toggleSources();
assert.equal(home.data.showSources, true);
home.toggleSources();
assert.equal(home.data.showSources, false);
const homeMarkup = read('miniapp/pages/home/index.wxml');
assert.doesNotMatch(homeMarkup, /<(?:view|text|image)\b[^>]*bindtap=/, 'home actions need native button affordances');
for (const entry of ['quick', 'social-profile', 'chat', 'archive', 'self']) {
  assert.match(homeMarkup, new RegExp(`<button\\b[^>]*data-entry="${entry}"[^>]*bindtap="open"`));
}
assert.match(homeMarkup, /<button\b[^>]*bindtap="toggleSources"/);
assert.match(homeMarkup, /<button\b[^>]*bindtap="retryLogin"/);
assert.match(homeMarkup, /<button\b[^>]*data-entry="\{\{item\.entry\}\}"[^>]*bindtap="open"/, 'resumable tasks remain clearly actionable');

console.log('PASS: navigation reuse, scoped archives, stack safety, tap lock, copy guards and native home buttons');
