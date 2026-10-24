const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
const modes = new Set(['conversation', 'chat', 'positioning']);
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
export function conversationContextScope(value) {
  if (value?.subject || value?.subjectId || value?.contextKey || value?.contextScope === 'person') return 'person';
  return value?.contextScope === 'all' ? 'all' : 'none';
}

export function restoreConversation(saved, owner, entry = {}) {
  const prior = saved && typeof saved === 'object' && (!saved.owner || saved.owner === owner) ? saved : {};
  const state = {
    owner, messages: Array.isArray(prior.messages) ? prior.messages.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').slice(-30) : [],
    draft: text(prior.draft, 1500), other: text(prior.other, 3000), subject: text(prior.subject, 36),
    mode: modes.has(prior.mode) ? prior.mode : 'conversation', contextKey: text(prior.contextKey, 100),
    // Old drafts retain their original scope; only a genuinely new conversation
    // defaults to all authorized people. Never upgrade an old request on reload.
    contextScope: Object.keys(prior).length ? conversationContextScope(prior) : 'all',
    opening: text(prior.opening, 1500), background: text(prior.background, 600),
    requestId: uuid(prior.requestId) ? prior.requestId : null, requestBody: prior.requestBody || null,
  };
  if (entry.subject !== undefined && entry.subject !== state.subject) {
    state.subject = text(entry.subject, 36); state.messages = []; state.draft = ''; state.other = ''; state.contextKey = ''; state.opening = ''; state.background = ''; state.requestId = null; state.requestBody = null;
  }
  if (modes.has(entry.mode) && entry.mode !== state.mode) {
    state.mode = entry.mode; state.messages = []; state.opening = ''; state.background = ''; state.requestId = null; state.requestBody = null;
  }
  if (entry.contextKey && entry.contextKey !== state.contextKey) {
    state.contextKey = text(entry.contextKey, 100); state.messages = []; state.draft = ''; state.other = ''; state.opening = ''; state.background = ''; state.mode = 'conversation'; state.requestId = null; state.requestBody = null;
  }
  const entryScope = entry.contextKey ? 'person' : ['all', 'person', 'none'].includes(entry.contextScope) ? entry.contextScope : entry.subject !== undefined ? entry.subject ? 'person' : 'none' : state.contextScope;
  if (entryScope !== state.contextScope) {
    state.contextScope = entryScope; state.messages = []; state.other = ''; state.contextKey = entry.contextKey || ''; state.opening = ''; state.background = ''; state.requestId = null; state.requestBody = null;
    if (entryScope !== 'person') state.subject = '';
  }
  const body = state.requestBody;
  if (!body || body.requestId !== state.requestId || body.self !== state.draft.trim() || body.other !== (state.mode === 'chat' ? state.other.trim() : '') || (body.subjectId || '') !== state.subject || body.mode !== state.mode || (body.contextScope === 'all') !== (state.contextScope === 'all') || (body.contextScope === 'all' && (body.subjectId || state.contextKey))) {
    state.requestId = null; state.requestBody = null;
  }
  return state;
}

export function conversationHistory(messages, context) {
  const quotes = (Array.isArray(context?.originalQuotes) ? context.originalQuotes : []).filter(row => row && ['self', 'other'].includes(row.speaker) && typeof row.text === 'string' && row.text.trim()).slice(-4);
  const recent = messages.slice(context ? quotes.length ? -3 : -4 : -6).map(item => ({ role: item.role, source: item.role === 'user' ? 'user-input' : 'assistant', content: text(item.rawContent ?? item.content, 600) }));
  if (!context) return recent;
  const summary = text(context.summary, 1100);
  const material = [summary.slice(0, 550), summary.slice(550, 1100)].filter(Boolean).map(content => ({ role: 'assistant', source: 'report-summary', content: '【报告推测，不是用户原话或已确认事实】\n' + content }));
  const original = quotes.length ? [{ role: 'user', source: 'report-quote', content: quotes.map(row => (row.speaker === 'self' ? '我' : '对方') + (row.sourceKind === 'moments' ? '的朋友圈' : '') + (row.at ? '（' + text(row.at, 25) + '）' : '') + '：' + text(row.text, 110)).join('\n') }] : [];
  return [...material, ...original, ...recent];
}

export function fitConversationRequest(body) {
  const history = body.history.map(item => ({ ...item }));
  const limit = body.opening ? 11800 : 11000;
  const bytes = () => new TextEncoder().encode(JSON.stringify({ ...body, history })).length;
  while (history.length && bytes() > limit) {
    const longest = history.reduce((best, item, index) => item.content.length > history[best].content.length ? index : best, 0);
    if (history[longest].content.length <= 80) history.splice(longest, 1);
    else history[longest].content = history[longest].content.slice(0, -60);
  }
  if (bytes() > limit) throw new Error('本次文字较长，请精简背景或分两次发送。');
  return { ...body, history };
}

export function voiceAccessError(account) {
  const value = account?.account;
  if (!value?.userId) return '请登录后开始语音。';
  if (!value.active) return '语音服务尚未开通或已到期，请到账户页联系开通。';
  if (!Array.isArray(value.features) || !value.features.includes('voice')) return '当前账号尚未开通语音功能，请到账户页联系开通。';
  if (typeof account?.prices?.voice !== 'number' || !Number.isFinite(account.prices.voice) || account.prices.voice < 0) return '暂时未能读取语音价格，请重试。';
  if (typeof value.balance !== 'number' || !Number.isFinite(value.balance)) return '暂时未能读取可用积分，请重试。';
  if (value.balance < account.prices.voice) return '可用积分不足，请到账户页补充积分后再开始语音。';
  return '';
}
