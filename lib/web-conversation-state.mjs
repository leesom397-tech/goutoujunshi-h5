const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
const modes = new Set(['conversation', 'chat', 'positioning']);
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);

export function restoreConversation(saved, owner, entry = {}) {
  const prior = saved && typeof saved === 'object' && (!saved.owner || saved.owner === owner) ? saved : {};
  const state = {
    owner, messages: Array.isArray(prior.messages) ? prior.messages.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').slice(-30) : [],
    draft: text(prior.draft, 1500), other: text(prior.other, 3000), subject: text(prior.subject, 36),
    mode: modes.has(prior.mode) ? prior.mode : 'conversation', contextKey: text(prior.contextKey, 100),
    requestId: uuid(prior.requestId) ? prior.requestId : null, requestBody: prior.requestBody || null,
  };
  if (entry.subject !== undefined && entry.subject !== state.subject) {
    state.subject = text(entry.subject, 36); state.messages = []; state.draft = ''; state.other = ''; state.contextKey = ''; state.requestId = null; state.requestBody = null;
  }
  if (modes.has(entry.mode) && entry.mode !== state.mode) {
    state.mode = entry.mode; state.messages = []; state.requestId = null; state.requestBody = null;
  }
  if (entry.contextKey && entry.contextKey !== state.contextKey) {
    state.contextKey = text(entry.contextKey, 100); state.messages = []; state.draft = ''; state.other = ''; state.mode = 'conversation'; state.requestId = null; state.requestBody = null;
  }
  const body = state.requestBody;
  if (!body || body.requestId !== state.requestId || body.self !== state.draft.trim() || body.other !== (state.mode === 'chat' ? state.other.trim() : '') || (body.subjectId || '') !== state.subject || body.mode !== state.mode) {
    state.requestId = null; state.requestBody = null;
  }
  return state;
}

export function conversationHistory(messages, context) {
  const recent = messages.slice(context ? -4 : -6).map(item => ({ role: item.role, content: text(item.content, 600) }));
  if (!context) return recent;
  const material = '【用户主动带入的分析摘要，含待验证推测，不是已确认事实】\n' + text(context.summary, 1100);
  return [...[material.slice(0, 600), material.slice(600, 1200)].filter(Boolean).map(content => ({ role: 'user', content })), ...recent];
}

export function fitConversationRequest(body) {
  const history = body.history.map(item => ({ ...item }));
  const bytes = () => new TextEncoder().encode(JSON.stringify({ ...body, history })).length;
  while (history.length && bytes() > 11000) {
    const longest = history.reduce((best, item, index) => item.content.length > history[best].content.length ? index : best, 0);
    if (history[longest].content.length <= 80) history.splice(longest, 1);
    else history[longest].content = history[longest].content.slice(0, -60);
  }
  if (bytes() > 11000) throw new Error('本次文字较长，请精简背景或分两次发送。');
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
