const api = require("../../lib/api");
const followup = require("../../lib/followup-context");
const DRAFT_STORAGE = "lovetalk_chat_draft_v1";

Page({
  data: {
    mode: "conversation", messages: [], hasMessages: false, phase: "loading", token: "", busy: false, error: "",
    other: "", self: "", agreed: false, followupTitle: "", followupSummary: "", showFollowupSummary: false,
    people: [{ id: "", label: "这次不使用档案" }], personIndex: 0,
    result: null, recording: false, transcribing: false, voiceTarget: "self"
  },
  onLoad(options) {
    this._requestedSubject = typeof options?.subjectId === "string" ? options.subjectId : null;
    let draft = {};
    try { draft = wx.getStorageSync(DRAFT_STORAGE) || {}; } catch { /* Draft storage is optional. */ }
    this.setData({ mode: "conversation", other: "", self: typeof draft.self === "string" ? draft.self : "" });
    this._draftLoaded = true;
    if (options?.contextKey) {
      this._followupContext = followup.takeReportFollowup(options.contextKey);
      if (this._followupContext) {
        this._requestedSubject = this._followupContext.subjectId;
        this.setData({ followupTitle: this._followupContext.title, followupSummary: this._followupContext.summary,
          ...(!this.data.self && this._followupContext.question ? { self: this._followupContext.question } : {}) });
      } else this.setData({ error: "这份分析的追问上下文已过期，请返回报告重新打开。" });
    }
  },
  onShow() {
    this._hidden = false;
    if (this._followupContext && !this.isFollowupIdentityCurrent()) {
      this.clearFollowup();
      this.setData({ messages: [], hasMessages: false, token: '', error: '微信身份已变化，请返回报告重新打开追问。' });
    }
    if (!this.data.busy && !this.data.token) this.refresh();
  },
  async refresh() {
    const selectedId = this._requestedSubject ?? (this.data.people[this.data.personIndex]?.id || api.currentSubject?.() || "");
    this.setData({ phase: "loading", error: "" });
    try {
      const current = await api.session();
      if (!current.token) throw new Error("微信身份暂时无法验证，请稍后重试。");
      const people = [{ id: "", label: "这次不使用档案" }, ...(current.state.subjects || [])];
      const index = selectedId ? people.findIndex(item => item.id === selectedId) : 0;
      this.setData({ phase: "ready", token: current.token, people, personIndex: index < 0 ? 0 : index,
        ...(index < 0 ? { result: null, agreed: false, error: "之前选的对象已不在档案中，请重新确认。" } : {}) });
      this._requestedSubject = null;
      if (this._followupContext && (current.token !== this._followupContext.sessionToken || index < 0)) {
        this.clearFollowup();
        this.setData({ error: "身份或人物已变化，请返回报告重新打开追问。" });
      }
    } catch (error) { this.setData({ phase: "error", error: error.message || "暂时连接不上。" }); }
  },
  saveDraft(next = {}) {
    try { wx.setStorageSync(DRAFT_STORAGE, { mode: this.data.mode, other: next.other ?? this.data.other, self: next.self ?? this.data.self }); } catch { /* Draft storage is optional. */ }
  },
  otherInput(event) { const other = event.detail.value; this.setData({ other, result: null }); this.saveDraft({ other }); },
  selfInput(event) { const self = event.detail.value; this._textRequestId = null; this.setData({ self, result: null }); this.saveDraft({ self }); },
  voiceTargetChange(event) { this.setData({ voiceTarget: event.detail.value }); },
  ensureRecorder() {
    if (this.recorder) return this.recorder;
    const recorder = wx.getRecorderManager();
    recorder.onStop(async event => {
      if (!this.data.recording) return;
      this.setData({ recording: false });
      if (this.voiceDiscard) { this.voiceDiscard = false; return; }
      if (!event.tempFilePath || event.duration < 500) { this.setData({ error: "录音太短，请按住说完整的一句话。" }); return; }
      if (event.fileSize > 2000000) { this.setData({ error: "录音太长，请分段说。" }); return; }
      this.setData({ transcribing: true, error: "" });
      try {
        const audio = await api.readAudio(event.tempFilePath);
        this._transcribeRequestId ||= await api.newId();
        const response = await api.request("/api/miniapp/transcribe", "POST", { audio, confirmed: true, requestId: this._transcribeRequestId }, this.data.token);
        if (!response.text || !response.text.trim()) throw new Error("没有识别到清晰的文字，请重试。");
        const field = "self";
        this._transcribeRequestId = null; this.setData({ [field]: [this.data[field], response.text.trim()].filter(Boolean).join("\n"), result: null });
        this.saveDraft();
      } catch (error) { this.setData({ error: error.message || "语音识别没有完成，请重试。" }); }
      finally { this.setData({ transcribing: false }); }
    });
    recorder.onError(() => this.setData({ recording: false, transcribing: false, error: "录音失败，请检查微信麦克风权限。" }));
    this.recorder = recorder;
    return recorder;
  },
  startVoice() {
    if (this.data.phase !== "ready" || this.data.busy || this.data.transcribing || this.data.recording) return;
    if (!this.data.agreed) { this.setData({ error: "先勾选同意本次语音识别，再按住说话。" }); return; }
    this.voiceDiscard = false;
    this._transcribeRequestId = null;
    this.setData({ recording: true, error: "" });
    this.ensureRecorder().start({ duration: 30000, sampleRate: 16000, numberOfChannels: 1, format: "wav", audioMode: "voiceRecognition" });
  },
  stopVoice() { if (this.data.recording && this.recorder) this.recorder.stop(); },
  clearDraft() {
    if (this.data.busy || this.data.recording || this.data.transcribing) return;
    wx.showModal({ title: "清空当前草稿？", content: "只清空本页输入和本机草稿，不删除人物档案。", success: result => {
      if (!result.confirm || this.data.busy || this.data.recording || this.data.transcribing) return;
      this.setData({ other: "", self: "", result: null, agreed: false });
      try { wx.removeStorageSync(DRAFT_STORAGE); } catch { /* Local storage is optional. */ }
    } });
  },
  onHide() { this._hidden = true; this.voiceDiscard = true; this.stopVoice(); },
  onUnload() { this._unloaded = true; this._hidden = true; this.voiceDiscard = true; this.stopVoice(); },
  personChange(event) {
    const index = Number(event.detail.value);
    if (this.data.busy || !Number.isInteger(index) || index < 0 || index >= this.data.people.length) return;
    api.setCurrentSubject?.(this.data.people[index]?.id || "");
    this.clearFollowup();
    this._textRequestId = null;
    this.setData({ personIndex: index, result: null, messages: [], hasMessages: false });
  },
  openLiveVoice() { if (this.data.busy || this.data.recording || this.data.transcribing) return; this.saveDraft(); wx.navigateTo({ url: "/pages/voice/index?subjectId=" + encodeURIComponent(this.data.people[this.data.personIndex]?.id || "") }); },
  setMode(event) { const mode = event.currentTarget.dataset.mode; if (["chat", "positioning"].includes(mode)) { this.setData({ mode, result: null, agreed: false }); this.saveDraft({ mode }); } },
  agree(event) { this.setData({ agreed: event.detail.value.includes("yes") }); },
  toggleFollowupSummary() { this.setData({ showFollowupSummary: !this.data.showFollowupSummary }); },
  isFollowupIdentityCurrent() {
    if (!this._followupContext) return true;
    try { return wx.getStorageSync(api.STORAGE || 'lovetalk_mini_session_v1')?.token === this._followupContext.sessionToken; }
    catch { return false; }
  },
  clearFollowup() {
    this._contextGeneration = (this._contextGeneration || 0) + 1;
    this._followupContext = null;
    this._textRequestId = null;
    this.setData({ followupTitle: "", followupSummary: "", showFollowupSummary: false, agreed: false });
  },
  copyConversationReply(event) {
    const id = event.currentTarget.dataset.message;
    const index = Number(event.currentTarget.dataset.index);
    const message = this.data.messages.find(item => item.id === id && item.role === 'assistant');
    if (!Number.isInteger(index) || index < 0 || typeof message?.replies?.[index]?.text !== 'string' || !message.replies[index].text.trim()) return;
    wx.setClipboardData({ data: message.replies[index].text });
  },
  toggleReply(event) {
    const index = Number(event.currentTarget.dataset.index);
    const result = this.data.result;
    if (!result || !Number.isInteger(index) || index < 0 || index >= result.replies.length) return;
    this.setData({ result: { ...result, replies: result.replies.map((item, position) => position === index ? { ...item, expanded: !item.expanded } : item) } });
  },
  async analyze() {
    if (this.data.busy || this.data.transcribing || this.data.recording || this.data.phase !== "ready") return;
    if (this.data.mode === "conversation" && this.data.self.trim().length < 2) { this.setData({ error: "说说你想聊什么。" }); return; }
    if (this.data.mode === "positioning" && this.data.self.trim().length < 6) { this.setData({ error: "先说说你的需求和犹豫。" }); return; }
    if (!this.data.agreed) { this.setData({ error: "请先确认处理范围。" }); return; }
    const requestToken = this.data.token;
    const generation = this._contextGeneration || 0;
    const reportContext = this._followupContext;
    const sameConversation = () => !this._unloaded && requestToken === this.data.token && generation === (this._contextGeneration || 0) && (!reportContext || this._followupContext === reportContext && this.isFollowupIdentityCurrent());
    this.setData({ busy: true, error: "", result: null });
    try {
      this._textRequestId ||= await api.newId();
      if (this._unloaded || generation !== (this._contextGeneration || 0) || requestToken !== this.data.token) return;
      const body = {
        mode: "conversation", other: "", self: this.data.self.trim(),
        history: this.data.messages.slice(-6).map(item => ({ role: item.role, content: item.content.slice(0, 600) })),
        subjectId: this.data.people[this.data.personIndex]?.id || null, confirmed: true, requestId: this._textRequestId
      };
      if (this._followupContext) {
        if (!this.isFollowupIdentityCurrent() || this._followupContext.expiresAt <= Date.now() || this._followupContext.sessionToken !== this.data.token || this._followupContext.subjectId !== (body.subjectId || "")) {
          this.clearFollowup();
          throw new Error("这份报告上下文已失效，请返回报告重新打开追问。");
        }
        body.history = followup.reportHistory(this._followupContext, this.data.messages);
      }
      const result = await api.request("/api/miniapp/text", "POST", this._followupContext ? followup.fitHistoryToRequest(body) : body, requestToken);
      if (!sameConversation()) return;
      if (!result.possibleIntent || !result.evidence || !result.nextStep || !Array.isArray(result.replies)) throw new Error("解读结果不完整，请重试。");
      const replies = result.replies.slice(0, 3).sort((a, b) => b.weight - a.weight).map((item, index) => ({ ...item, rankLabel: index === 0 ? "本轮首选" : `备选 ${index + 1}`, expanded: false }));
      const userMessage = { id: body.requestId + "-u", role: "user", content: body.self };
      const answer = [result.possibleIntent, result.nextStep].filter(Boolean).join("\n\n");
      this._textRequestId = null;
      this.setData({ result: null, self: "", hasMessages: true, messages: [...this.data.messages, userMessage, { id: userMessage.id + "-a", role: "assistant", content: answer, replies }].slice(-30) }, () => {
        if (!this._hidden && typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ selector: '#conversation-end', duration: 220 });
      });
      try { wx.removeStorageSync(DRAFT_STORAGE); } catch { /* Draft storage is optional. */ }
    } catch (error) {
      if (generation !== (this._contextGeneration || 0) && !/上下文已失效/.test(error.message || '') || this._unloaded || requestToken !== this.data.token) return;
      if (error.details?.code === "CREDIT_RELEASED") this._textRequestId = null;
      if (error.status === 401) { wx.removeStorageSync(api.STORAGE); this.setData({ phase: "error" }); }
      this.setData({ error: error.message || "这次解读暂未完成，请重试。" });
    } finally { this.setData({ busy: false }); }
  }
});
