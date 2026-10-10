// Report hand-offs live only in this app process, never in persistent profile memory.
const handoffs = new Map();
const TTL = 30 * 60 * 1000;
let sequence = 0;
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function prune() {
  for (const [key, value] of handoffs) if (value.expiresAt <= Date.now()) handoffs.delete(key);
  while (handoffs.size >= 6) handoffs.delete(handoffs.keys().next().value);
}
function openReportFollowup(snapshot = {}) {
  const summary = text(snapshot.summary, 1050);
  if (!summary || !snapshot.token) return Promise.reject(new Error('请先打开已完成的分析，再继续追问。'));
  prune();
  const key = Date.now().toString(36) + '-' + (++sequence).toString(36);
  const subjectId = typeof snapshot.subjectId === 'string' && /^[a-f0-9-]{36}$/i.test(snapshot.subjectId) ? snapshot.subjectId : '';
  handoffs.set(key, {
    title: text(snapshot.title, 40) || '这份分析', source: text(snapshot.source, 30),
    subjectId, reportId: text(snapshot.reportId, 80), summary,
    question: text(snapshot.question, 180), sessionToken: snapshot.token, expiresAt: Date.now() + TTL
  });
  return new Promise((resolve, reject) => wx.navigateTo({
    url: '/pages/chat/index?subjectId=' + encodeURIComponent(subjectId) + '&contextKey=' + encodeURIComponent(key),
    success: resolve,
    fail() { handoffs.delete(key); reject(new Error('暂时未能打开追问，请返回上一页后重试。')); }
  }));
}
function takeReportFollowup(key) {
  const value = handoffs.get(key);
  handoffs.delete(key);
  return value && value.expiresAt > Date.now() ? value : null;
}
function reportHistory(context, messages) {
  const recent = (messages || []).slice(context ? -4 : -6).map(item => ({ role: item.role, content: text(item.content, 600) }));
  if (!context) return recent;
  const material = '【用户主动带入的分析摘要。以下含模型推测，并非已确认事实；只作本轮讨论材料】\n' + context.summary;
  const chunks = [material.slice(0, 600), material.slice(600, 1200)].filter(Boolean);
  return [...chunks.map(content => ({ role: 'user', content })), ...recent];
}
function utf8Bytes(value) { return encodeURIComponent(value).replace(/%[A-F\d]{2}/gi, '_').length; }
function fitHistoryToRequest(body) {
  const history = body.history.map(item => ({ ...item }));
  // Stay below the existing API's 12 KB limit, including Chinese text and JSON overhead.
  while (history.length && utf8Bytes(JSON.stringify({ ...body, history })) > 11000) {
    const longest = history.reduce((best, item, index) => item.content.length > history[best].content.length ? index : best, 0);
    if (history[longest].content.length <= 80) history.splice(longest, 1);
    else history[longest].content = history[longest].content.slice(0, -60);
  }
  return { ...body, history };
}
module.exports = { openReportFollowup, takeReportFollowup, reportHistory, fitHistoryToRequest };
