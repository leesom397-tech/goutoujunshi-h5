const api = require('../../lib/api');
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function present(row) {
  const date = new Date(Number(row.createdAt));
  return { ...row, kindLabel: row.supplementOf ? '补充解读' : row.analysisScope === 'fullHistory' || row.format === 'fullHistory' ? '完整关系报告' : row.format === 'risk' ? '关系提醒' : row.format === 'import' ? '导入聊天' : { chat: '本次聊天截图', moments: '朋友圈截图', social: '社交主页截图' }[row.kind] || '分析报告', label: row.label || '未关联人物', summary: row.summary || '打开这次分析报告', dateLabel: Number.isFinite(date.getTime()) && Number(row.createdAt) > 0 ? `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}` : '' };
}
Page({
  data: { loading: true, error: '', reports: [], query: '', activeQuery: '', page: 1, total: 0, pages: 1, ownerId: '', webLinked: true },
  onLoad() { this._generation = 0; this._unloaded = false; },
  onShow() { return this.load(this.data.page || 1, this.data.activeQuery || ''); },
  onUnload() { this._unloaded = true; this._generation++; },
  onPullDownRefresh() { Promise.resolve(this.load(this.data.page, this.data.activeQuery)).finally(() => wx.stopPullDownRefresh()); },
  sessionCurrent() { const stored = wx.getStorageSync(api.STORAGE); return stored?.token === this._token && stored.expiresAt > Date.now(); },
  async load(page = 1, query = '') {
    const generation = ++this._generation;
    this.setData({ loading: true, error: '', reports: [] });
    try {
      const session = await api.session();
      if (this._unloaded || generation !== this._generation) return;
      if (this._token && this._token !== session.token) { page = 1; query = ''; this.setData({ query: '', activeQuery: '', ownerId: '', total: 0 }); }
      this._token = session.token;
      const result = await api.request('/api/miniapp/report/list?q=' + encodeURIComponent(query.trim()) + '&page=' + page, 'GET', null, this._token);
      if (this._unloaded || generation !== this._generation) return;
      if (!this.sessionCurrent()) throw Error('账号已变化，请重新读取报告。');
      if (!result.ownerId) throw Error('暂时无法确认报告所属账户，请重试。');
      if (this.data.ownerId && this.data.ownerId !== result.ownerId) {
        this.setData({ ownerId: '', page: 1, query: '', activeQuery: '', total: 0, reports: [] });
        throw Error('账号已变化，请重新读取报告。');
      }
      this.setData({ reports: (result.reports || []).filter(row => idPattern.test(row.id || '')).map(present), total: result.total || 0, page: result.page || page, pages: Math.max(1, Math.ceil((result.total || 0) / (result.pageSize || 12))), activeQuery: query.trim(), ownerId: result.ownerId, webLinked: result.webLinked !== false });
    } catch (error) { if (!this._unloaded && generation === this._generation) this.setData({ error: error.message || '历史报告暂时没有取回。' }); }
    finally { if (!this._unloaded && generation === this._generation) this.setData({ loading: false }); }
  },
  editQuery(event) { this.setData({ query: event.detail.value }); },
  search() { return this.load(1, this.data.query); },
  clearSearch() { this.setData({ query: '' }); return this.load(1, ''); },
  retry() { return this.load(this.data.page, this.data.activeQuery); },
  previous() { if (!this.data.loading && this.data.page > 1) return this.load(this.data.page - 1, this.data.activeQuery); },
  next() { if (!this.data.loading && this.data.page < this.data.pages) return this.load(this.data.page + 1, this.data.activeQuery); },
  openReport(event) {
    const id = event.currentTarget.dataset.id;
    if (!this.sessionCurrent()) { this.setData({ reports: [], error: '账号已变化，请重新读取报告。' }); return; }
    if (idPattern.test(id || '') && this.data.reports.some(row => row.id === id)) wx.navigateTo({ url: '/pages/report/index?id=' + id });
  },
  openAccount() { wx.navigateTo({ url: '/pages/account/index' }); },
  startAnalysis() { wx.navigateTo({ url: '/pages/library/index' }); },
});
