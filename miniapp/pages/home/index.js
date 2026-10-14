const api = require("../../lib/api");
const knowledgeStats = require("../../lib/knowledge-stats");

Page({
  data: { loginState: "connecting", loginError: "", knowledgeWan: (knowledgeStats.hanCharacters / 10000).toFixed(1), knowledgeSources: knowledgeStats.sourceCount, showSources: false, motionPlaying: true, motionVisible: false },
  onShow() {
    const tasks = [
      { path: '/api/miniapp/screenshot/batch', entry: 'quick', label: '聊天截图分析' },
      { path: '/api/miniapp/social-profile', entry: 'social-profile', label: '社交资料分析' }
    ].map(task => {
      const pending = api.pendingUpload?.(task.path);
      if (!pending) return null;
      const received = Array.isArray(pending.received) ? pending.received.length : Number(pending.received) || 0;
      const total = Number(pending.total || pending.imageCount || pending.images?.length) || 0;
      return { ...task, statusLabel: pending.status === 'uploading'
        ? (total ? `上传待继续 · 已收到 ${received}/${total} 张` : '上传进度已保留')
        : '任务已保留 · 查看最新进度' };
    }).filter(Boolean);
    this.setData({ pendingTasks: tasks, hasPendingTasks: tasks.length > 0, motionVisible: true });
    this.retryLogin();
  },
  toggleSources() { this.setData({ showSources: !this.data.showSources }); },
  toggleMotion() { this.setData({ motionPlaying: !this.data.motionPlaying }); },
  onHide() { this.setData({ motionVisible: false }); },
  async retryLogin() {
    this.setData({ loginState: "connecting", loginError: "" });
    try {
      const current = await api.session({ cacheFirst: true });
      if (!current.token) throw new Error("微信身份暂时不可用");
      this.setData({ loginState: "ready" });
    } catch (error) { this.setData({ loginState: "error", loginError: error.message || "稍后重试" }); }
  },
  open(event) {
    const entry = event.currentTarget.dataset.entry;
    if (entry === "account") { wx.navigateTo({ url: "/pages/account/index" }); return; }
    if (entry === "comparison") {wx.navigateTo({url:"/pages/archive/index?compare=1"});return;}
    if (!["quick", "social-profile", "archive", "self", "chat", "positioning", "voice"].includes(entry)) return;
    if (entry === "self") { wx.navigateTo({ url: "/pages/archive/index?tab=self" }); return; }
    if (entry === "quick") {
      wx.navigateTo({ url: "/pages/quick/index" });
      return;
    }
    if (entry === "social-profile") { wx.navigateTo({ url: "/pages/social-profile/index" }); return; }
    if (entry === "archive") {
      wx.navigateTo({ url: "/pages/archive/index" });
      return;
    }
    if (entry === "voice") { wx.navigateTo({ url: "/pages/voice/index" }); return; }
    wx.navigateTo({ url: "/pages/chat/index?mode=" + entry });
  }
});
