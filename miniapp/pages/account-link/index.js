Page({
  data: { src: '', failed: false },
  onLoad(options) {
    if (!/^[a-f0-9]{64}$/.test(options.ticket || '')) { this.setData({ failed: true }); return; }
    this.setData({ src: 'https://coach.lovetalk.love/miniapp/link?ticket=' + options.ticket });
  },
  onError() { this.setData({ failed: true }); },
  back() { wx.navigateBack(); }
});
