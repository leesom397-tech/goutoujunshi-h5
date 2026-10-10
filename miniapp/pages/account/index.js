const api = require('../../lib/api');
const labels = { analysis: '截图与资料分析', chat: '文字解读', voice: '实时语音' };
const date = value => value ? new Date(value).toLocaleDateString('zh-CN') : '未设置';
function present(account) {
  return Object.assign({}, account, {
    expiresLabel: date(account.enabledUntil),
    featureLabels: account.features.map(key => labels[key] || key).join('、') || '暂无',
    entries: account.entries.map((entry, index) => Object.assign({}, entry, {
      key: String(index), dateLabel: date(entry.time),
      label: labels[entry.label] || entry.label,
      kindLabel: { adjustment: '积分调整', reserved: '处理中·暂留', settled: '已使用', released: '已退回' }[entry.kind] || entry.kind,
      amountLabel: entry.kind === 'adjustment' ? (entry.amount > 0 ? '+' : '') + entry.amount : entry.kind === 'released' ? '+' + entry.amount : entry.kind === 'reserved' ? '暂留 ' + entry.amount : '-' + entry.amount,
      positive: entry.kind === 'released' || entry.kind === 'adjustment' && entry.amount > 0
    }))
  });
}
Page({
  data: { loading: true, saving: false, error: '', account: null, admin: false, target: null, userId: '', delta: '', reason: '', featureOptions: Object.keys(labels).map(key => ({ key, label: labels[key], checked: false })), features: [], expires: '', notice: '' },
  onShow() { this.load(); },
  openProfile() { wx.navigateTo({ url: '/pages/archive/index?tab=self' }); },
  copyContact() { wx.setClipboardData({ data: 'lxlikex' }); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await api.session();
      this.token = session.token;
      const state = await api.request('/api/miniapp/credits', 'GET', null, session.token);
      const prices = state.prices || {};
      const priceRows = [
        ['analysisSmall', '聊天截图 · 1–3 张'], ['analysisMedium', '聊天截图 · 4–6 张'],
        ['analysisLarge', '聊天截图 · 7–9 张'], ['profile', '社交资料 · 每批最多 9 张'],
        ['text', '文字提问 · 每次'], ['transcription', '语音转文字 · 每次'], ['voice', '实时语音 · 每通']
      ].filter(([key]) => Number.isFinite(prices[key]) && prices[key] >= 0).map(([key, label]) => ({ key, label, amount: prices[key] }));
      this.setData({ account: present(state.account), admin: state.admin === true, meteringReady: state.meteringReady === true, priceRows, hasPrices: priceRows.length > 0 });
    } catch (error) { this.setData({ error: error.message || '加载失败，点此重试。' }); }
    finally { this.setData({ loading: false }); }
  },
  copyId() { const id = this.data.account?.userId; if (typeof id === 'string' && id.trim()) wx.setClipboardData({ data: id }); },
  adminFailure(message) {
    this.setData({ adminError: message });
    wx.showToast({ title: message, icon: 'none', duration: 3000 });
  },
  edit(event) {
    if (this.data.saving) return;
    const field = event.currentTarget.dataset.field;
    if (!['userId', 'delta', 'reason'].includes(field)) return;
    this.setData({ [field]: event.detail.value, notice: '', adminError: '', ...(field === 'userId' ? { target: null } : {}) });
  },
  selectFeatures(event) { if (!this.data.saving) this.setData({ features: event.detail.value }); },
  selectDate(event) { if (!this.data.saving) this.setData({ expires: event.detail.value }); },
  async findUser() {
    if (!this.data.admin || this.data.saving) return;
    if (!this.data.userId.trim()) { this.adminFailure('请先粘贴用户编号。'); return; }
    this.setData({ saving: true, adminError: '', notice: '', target: null });
    try {
      const state = await api.request('/api/miniapp/admin/credits?userId=' + encodeURIComponent(this.data.userId.trim()), 'GET', null, this.token);
      const target = present(state.account);
      const end = target.enabledUntil > Date.now() ? new Date(target.enabledUntil) : new Date(Date.now() + 365 * 86400000);
      this.setData({ target, features: target.features, featureOptions: Object.keys(labels).map(key => ({ key, label: labels[key], checked: target.features.includes(key) })), expires: end.getFullYear() + '-' + String(end.getMonth() + 1).padStart(2, '0') + '-' + String(end.getDate()).padStart(2, '0') });
    } catch (error) { this.adminFailure(error.message || '查询失败，请重试。'); }
    finally { this.setData({ saving: false }); }
  },
  async save(event) {
    if (!this.data.admin || !this.data.target || this.data.saving) return;
    const action = event.currentTarget.dataset.action;
    const reason = this.data.reason.trim();
    if (reason.length < 2) { this.adminFailure('请先填写操作原因。'); return; }
    let change;
    if (action === 'adjust') {
      const delta = Number(this.data.delta);
      if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1000000) { this.adminFailure('请输入非零整数，减少积分请填负数。'); return; }
      change = { delta };
    } else if (action === 'permissions') {
      change = { features: this.data.features, enabledUntil: this.data.features.length ? Date.parse(this.data.expires + 'T23:59:59+08:00') : 0 };
    } else return;
    const body = { action, userId: this.data.target.userId, reason, ...change };
    const signature = JSON.stringify(body);
    this.setData({ saving: true, adminError: '', notice: '' });
    try {
      const confirmed = await new Promise(resolve => wx.showModal({ title: action === 'adjust' ? '确认调整积分' : '确认修改权限', content: '账号 ' + body.userId + '\n' + (action === 'adjust' ? '调整 ' + body.delta + ' 积分' : '功能：' + (this.data.features.map(key => labels[key]).join('、') || '全部关闭')), success: result => resolve(result.confirm), fail: () => resolve(false) }));
      if (!confirmed) return;
      // Keep the same id on ambiguous network failure, including page re-entry.
      const storageKey = 'coach_credit_admin_pending_v1';
      const pending = wx.getStorageSync(storageKey);
      const id = pending && pending.signature === signature ? pending.id : await api.newId();
      wx.setStorageSync(storageKey, { signature, id });
      const result = await api.request('/api/miniapp/admin/credits', 'POST', { ...body, id }, this.token);
      wx.removeStorageSync(storageKey);
      this.setData({ target: present(result.account), notice: '已保存，账目已更新。', delta: '' });
      if (this.data.account.userId === body.userId) this.setData({ account: present(result.account) });
    } catch (error) { this.adminFailure(error.message || '请先核对账户记录，再重试。'); }
    finally { this.setData({ saving: false }); }
  }
});
