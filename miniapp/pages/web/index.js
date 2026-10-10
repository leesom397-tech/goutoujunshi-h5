const pages = Object.freeze({
  quick: { path: "/quick", title: "截图快判" },
  archive: { path: "/profile", title: "关系档案" },
  chat: { path: "/", title: "关系咨询" },
  positioning: { path: "/positioning", title: "择偶定位" },
  link: { path: "/miniapp/link", title: "关联成子账号" },
  report: { path: "/crush", title: "完整逐句报告" }
});
const reportIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

Page({
  data: { src: "", failed: false },
  onLoad(options) {
    const name = Object.prototype.hasOwnProperty.call(pages, options.entry) ? options.entry : "quick";
    const entry = pages[name];
    wx.setNavigationBarTitle({ title: entry.title });
    let suffix = "";
    if (name === "link" && /^[a-f0-9]{64}$/.test(options.ticket || "")) suffix = "?ticket=" + options.ticket;
    if (name === "report" && reportIdPattern.test(options.id || "")) suffix = "?id=" + options.id;
    this.setData({ src: "https://coach.lovetalk.love" + entry.path + suffix });
  },
  onError() {
    this.setData({ failed: true });
  },
  retry() {
    this.setData({ failed: false, src: this.data.src + (this.data.src.includes("?") ? "&" : "?") + "retry=" + Date.now() });
  }
});
