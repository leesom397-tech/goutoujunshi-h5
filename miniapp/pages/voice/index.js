const api = require("../../lib/api");
const { createEchoFilter } = require("../../lib/echo-filter");

Page({
  data: { phase: "idle", status: "准备好后，开始通话", error: "", you: "", assistant: "", agreed: false, audioMode: "speaker", people: [{ id: "", label: "这次不使用档案" }], personIndex: 0, memoryAgreed: false, memoryHint: "正在读取可选档案…" },
  onLoad(options) { this.entrySubject = options?.subjectId; },
  async onShow() {
    if (this.data.phase !== "idle") return;
    try {
      const current = await api.session();
      const profile = await api.request("/api/miniapp/profile", "GET", null, current.token);
      if (this.data.phase !== "idle") return;
      const subjects = profile.enabled && !profile.paused ? (profile.subjects || []).filter(item => item && typeof item.id === "string" && typeof item.label === "string") : [];
      const people = [{ id: "", label: "这次不使用档案" }, ...subjects];
      const selected = this.entrySubject ?? api.currentSubject?.() ?? "";
      const index = people.findIndex(item => item.id === selected);
      this.setData({ people, personIndex: Math.max(0, index), memoryAgreed: true, memoryHint: subjects.length ? "本次对话会参考所选人物的已确认档案。" : "暂无可用于语音的档案；本次不会读取档案。" });
    } catch {
      if (this.data.phase === "idle") this.setData({ people: [{ id: "", label: "这次不使用档案" }], personIndex: 0, memoryAgreed: false, memoryHint: "档案暂不可用，本次仍可不使用档案通话。" });
    }
  },
  agree(event) { this.setData({ agreed: event.detail.value.includes("yes") }); },
  personChange(event) { if (this.data.phase === "idle") { const index = Number(event.detail.value) || 0; api.setCurrentSubject?.(this.data.people[index]?.id || ""); this.setData({ personIndex: index, memoryAgreed: true, error: "" }); } },
  memoryAgree(event) { this.setData({ memoryAgreed: event.detail.value.includes("yes") }); },
  selectAudioMode(event) { if (this.data.phase === "idle" && ["speaker", "headphones"].includes(event.currentTarget.dataset.mode)) this.setData({ audioMode: event.currentTarget.dataset.mode }); },
  async start() {
    if (this.data.phase !== "idle") return;
    if (this._recorderStopping) { this.setData({error:'录音设备正在结束上一通，请稍后再开始。'}); return; }
    if (!this.data.agreed) { this.setData({ error: "请先确认语音处理范围。" }); return; }
    const selected = this.data.people[this.data.personIndex];
    if (selected && selected.id && !this.data.memoryAgreed) { this.setData({ error: "请先同意本次使用所选档案，或改为不使用档案。" }); return; }
    const generation = (this.generation || 0) + 1;
    this.generation = generation;
    this.voiceStage = "identity";
    this.sessionExpiresAt = 0;
    clearTimeout(this.callTimer);
    this.setData({ phase: "connecting", status: "正在连接语音服务…", error: "", you: "", assistant: "" });
    try {
      if (typeof wx.createWebAudioContext !== "function") throw new Error("当前微信版本不支持实时音频播放，请升级微信。");
      // Create/resume audio in the user's tap gesture, before awaiting login.
      this.audio = wx.createWebAudioContext();
      const resumed = this.audio.resume && this.audio.resume();
      if (resumed && typeof resumed.catch === "function") resumed.catch(() => {
        if (this.generation === generation) { this.setData({ error: "音频播放未能启动，请重试。" }); this.end(); }
      });
      this.nextPlayAt = 0;
      this.sources = [];
      clearInterval(this.playbackTimer);
      this.playbackTimer = setInterval(() => { if (this.data.phase === "talking" && this.audio && this.nextPlayAt > this.audio.currentTime) this.socket?.send({ data: JSON.stringify({ type: "gateway.playback" }) }); }, 700);
      this.userSpeaking = false;
      this.echoFilter = createEchoFilter();
      this.lastEchoAt = 0;
      this.setData({ status: "正在确认麦克风权限…" });
      await new Promise((resolve, reject) => wx.authorize({ scope: "scope.record", success: resolve, fail: () => reject(new Error("麦克风权限未开启。请在微信的小程序设置中允许录音后重试。")) }));
      if (this.generation !== generation || this.data.phase !== "connecting") return;
      const current = await api.session();
      if (this.generation !== generation || this.data.phase !== "connecting") return;
      if (!current.token) throw new Error("微信身份暂不可用。");
      this.voiceStage = "socket";
      this._requestId ||= await api.newId();
      if (!this.recorder) {
        this.recorder = wx.getRecorderManager();
        this.recorder.onFrameRecorded(event => {
          if (this.data.phase !== "talking" || !this.socket || !event.frameBuffer) return;
          // Never mute every microphone frame while the model speaks: that
          // would prevent the user from interrupting. Only drop strong matches
          // against recently played PCM in speaker mode.
          if (this.data.audioMode === "speaker" && this.echoFilter?.isEcho(event.frameBuffer, this.audio?.currentTime || 0)) { this.lastEchoAt = Date.now(); return; }
          this.socket.send({ data: JSON.stringify({ type: "input_audio_buffer.append", audio: wx.arrayBufferToBase64(event.frameBuffer) }) });
        });
        this.recorder.onError(event => { if (this.data.phase !== "idle") { const code = Number.isInteger(event?.errCode) ? `（录音代码 ${event.errCode}）` : ""; this.setData({ error: `麦克风录音失败${code}，请检查微信录音权限。` }); this.end(); } });
        this.recorder.onStop?.(() => {
          this._recording = false;
          if (this._recorderStopping) { this._recorderStopping = false; return; }
          if (this.data.phase !== 'talking') return;
          if (this.sessionExpiresAt && Date.now() >= this.sessionExpiresAt - 1500) { this.setData({error:''}); this.end('本次 3 分钟通话已结束，可以开始新一轮'); return; }
          this.setData({error:'麦克风已停止，本次通话已结束。你可以重新开始。'});
          this.end();
        });
      }
      const memoryQuery = selected && selected.id ? "?subjectId=" + encodeURIComponent(selected.id) + "&profileConsent=1" : "";
      const separator = memoryQuery ? "&" : "?";
      const socket = wx.connectSocket({ url: api.BASE.replace(/^https:/, "wss:") + "/api/miniapp/voice-live" + memoryQuery + separator + "requestId=" + encodeURIComponent(this._requestId), header: { Authorization: "Bearer " + current.token } });
      this.socket = socket;
      socket.onOpen(() => { if (this.socket === socket) { this.voiceStage = "model"; this.setData({ status: "连接成功，正在启动语音模型…" }); } });
      socket.onMessage(event => { if (this.socket === socket) this.message(event.data); });
      socket.onError(event => { if (this.socket === socket) this.socketFailed(event, socket); });
      socket.onClose(event => { if (this.socket === socket) this.socketFailed(event, socket); });
    } catch (error) { if (this.generation === generation) { this.setData({ error: error.message || "语音暂时不可用。" }); this.end(); } }
  },
  socketFailed(event, socket) {
    if (this.socket !== socket) return;
    const stage = this.voiceStage;
    const code = Number.isInteger(event?.code) ? `连接代码 ${event.code}` : "";
    const message = String(event?.errMsg || "").slice(0, 150).replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]").replace(/[a-f0-9]{64}/gi, "[已隐藏]");
    const http = /\b(?:401|402|403|429|500|502|503|504)\b/.exec(message)?.[0];
    const detail = http ? `（握手 HTTP ${http}）` : code ? `（${code}）` : "";
    const error = stage === "socket" ? `语音连接未建立${detail}，正在核对服务状态…` : stage === "model" ? `语音模型启动中断${detail}，正在核对服务状态…` : `通话意外中断${detail}。`;
    this.setData({ error });
    this.end();
    if (stage === "socket" || stage === "model") this.diagnoseConnection(error, this.generation);
  },
  async diagnoseConnection(initial, generation) {
    const show = message => { if (this.generation === generation && this.data.phase === "idle") this.setData({ error: message }); };
    try {
      const current = await api.session();
      const state = await api.request("/api/miniapp/voice-live/status", "GET", null, current.token);
      if (state.configured === false) { show("语音服务配置暂不可用，请稍后再试。"); return; }
      if (state.remaining === 0) { show("今天的语音通话次数已用完；失败的上游连接不再计入新版本限额。"); return; }
      try {
        const probe = await api.request("/api/miniapp/voice-live/check", "GET", null, current.token);
        if (probe.stage === "ready") show(`${initial} 上游模型此刻可连通，请检查微信网络或 socket 合法域名。`);
      } catch (error) {
        const details = error.details || {};
        const code = details.httpStatus ? `HTTP ${details.httpStatus}` : details.code || details.closeCode || details.stage || "未知原因";
        show(`语音上游握手未就绪（${code}）。请稍后重试；若持续出现，把这行提示发给我们。`);
      }
    } catch { show(`${initial} 连通性检查也未完成，请检查网络后重试。`); }
  },
  message(raw) {
    let event;
    try { event = JSON.parse(raw); } catch { return; }
    if (event.type === "gateway.session_meta") {
      if (this.data.phase === "idle") return;
      const expiresAt = Number(event.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt > 0) {
        this.sessionExpiresAt = expiresAt;
        clearTimeout(this.callTimer);
        const generation = this.generation;
        this.callTimer = setTimeout(() => { if (this.generation === generation && this.data.phase !== "idle") { this.setData({error:""}); this.end("本次 3 分钟通话已结束，可以开始新一轮"); } }, Math.max(0, Math.min(180000, expiresAt - Date.now())));
      }
      return;
    }
    if (event.type === "gateway.session_end") { this.setData({error:""}); this.end(event.reason === "time_limit" ? "本次 3 分钟通话已结束，可以开始新一轮" : "通话已正常结束"); return; }
    if (event.type === "gateway.notice") { if (this.data.phase !== "idle") this.setData({status:typeof event.message === "string" ? event.message.slice(0,160) : "这句话没能识别清楚，请再说一次。"}); return; }
    if (event.type === "gateway.interrupted") { if (this.data.phase === "talking") { this.userSpeaking = true; this.interrupt(); this.setData({assistant:"",status:"已停止播报，现在听你说"}); } return; }
    if (event.type === "error") { const code = typeof event.error?.code === "string" && /^[A-Za-z0-9_.-]{1,48}$/.test(event.error.code) ? `（${event.error.code}）` : ""; this.setData({ error: typeof event.error?.message === "string" ? event.error.message.slice(0,200) : `实时语音服务返回错误${code}，请稍后重试。` }); this.end(); return; }
    if (event.type === "gateway.error") { this.setData({ error: event.code === "provider_closed" ? "语音模型连接被中断，请稍后重试。" : "语音服务连接失败，请稍后重试。" }); this.end(); return; }
    if (event.type === "session.updated" && this.data.phase === "connecting") {
      try {
        this.voiceStage = "microphone";
        this.setData({ status: "语音模型已就绪，正在打开麦克风…" });
        this._recording = true;
        this.sessionExpiresAt ||= Date.now() + 180000;
        this.recorder.start({ duration: 180000, sampleRate: 16000, numberOfChannels: 1, format: "PCM", frameSize: 2, audioMode: "voiceChat" });
        this.voiceStage = "talking";
        this.setData({ phase: "talking", status: "正在听你说话" });
        this.keepScreenOnRequested = true;
        if (typeof wx.setKeepScreenOn === "function") wx.setKeepScreenOn({ keepScreenOn: true, fail: () => { if (this.data.phase === "talking") this.setData({ error: "无法保持屏幕常亮；请检查手机锁屏设置。" }); } });
        else this.setData({ error: "当前微信不支持保持屏幕常亮；请检查手机锁屏设置。" });
      } catch (error) { this._recording = false; this.setData({ error: `麦克风启动失败：${error?.message || "请检查录音权限。"}` }); this.end(); }
      return;
    }
    if (this.data.phase !== "talking") return;
    if (event.type === "gateway.user_turn") { this.userSpeaking = false; this.interrupt(); this.setData({ you: String(event.transcript || "").slice(0, 500), assistant: "", status: "正在思考…" }); return; }
    if (event.type === "input_audio_buffer.speech_started") { if (this.data.audioMode === "speaker" && Date.now() - this.lastEchoAt < 180) return; this.userSpeaking = true; this.interrupt(); this.setData({ status: "正在听你说话", assistant: "" }); return; }
    if (event.type === "input_audio_buffer.speech_stopped") { this.userSpeaking = false; this.setData({ status: "正在思考…" }); return; }
    if (event.type === "conversation.item.input_audio_transcription.completed") { this.setData({ you: String(event.transcript || event.text || "").slice(0, 500), assistant: "" }); return; }
    if (this.userSpeaking && (event.type === "response.audio_transcript.delta" || event.type === "response.audio.delta")) return;
    if (event.type === "response.audio_transcript.delta") { this.setData({ assistant: (this.data.assistant + String(event.delta || "")).slice(-600), status: "军师正在回答" }); return; }
    if (event.type === "response.audio.delta" && typeof event.delta === "string") this.playPcm(event.delta);
    if (event.type === "response.done" && !this.userSpeaking) this.setData({ status: "可以继续说，随时打断" });
  },
  playPcm(base64) {
    if (!this.audio || this.data.phase !== "talking") return;
    try {
      const bytes = new Uint8Array(wx.base64ToArrayBuffer(base64));
      const samples = Math.floor(bytes.length / 2);
      if (!samples) return;
      const buffer = this.audio.createBuffer(1, samples, 24000);
      const channel = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      // Moderate soft-limited output boost; keep the echo reference identical to playback.
      for (let i = 0; i < samples; i++) channel[i] = Math.tanh(view.getInt16(i * 2, true) / 32768 * 1.8);
      const source = this.audio.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audio.destination);
      const now = this.audio.currentTime;
      const when = Math.max(now + 0.04, this.nextPlayAt || 0);
      source.start(when);
      if (this.data.audioMode === "speaker") this.echoFilter?.addPlayback(channel, when);
      this.nextPlayAt = when + samples / 24000;
      this.sources.push(source);
      if (this.sources.length > 120) this.sources.splice(0, this.sources.length - 60);
    } catch { this.setData({ error: "音频播放失败，可先看下方文字。" }); }
  },
  interrupt() {
    (this.sources || []).forEach(source => { try { source.stop(); } catch {} });
    this.sources = [];
    this.nextPlayAt = 0;
    this.echoFilter?.stopPlayback?.(this.audio?.currentTime || 0);
  },
  end(label) {
    clearInterval(this.playbackTimer);
    clearTimeout(this.callTimer);
    this.sessionExpiresAt = 0;
    this.generation = (this.generation || 0) + 1;
    if (this.keepScreenOnRequested) {
      this.keepScreenOnRequested = false;
      if (typeof wx.setKeepScreenOn === "function") wx.setKeepScreenOn({ keepScreenOn: false });
    }
    if (this.data.phase === "idle" && !this.socket && !this.recorder && !this.audio) return;
    this.setData({ phase: "idle", status: typeof label === "string" ? label : this.data.error ? "通话未能启动或已中断" : "通话已结束", agreed: false });
    this.userSpeaking = false;
    this.echoFilter?.reset();
    this.lastEchoAt = 0;
    this.interrupt();
    if (this.recorder && this._recording && !this._recorderStopping) { this._recording = false; this._recorderStopping = typeof this.recorder.onStop === 'function'; try { this.recorder.stop(); } catch { this._recorderStopping = false; } }
    if (this.socket) { const socket = this.socket; this.socket = null; try { socket.close({ code: 1000, reason: "通话结束" }); } catch {} }
    this._requestId = null;
    if (this.audio) { try { this.audio.close(); } catch {} this.audio = null; }
  },
  openText() {
    const subjectId = this.data.people[this.data.personIndex]?.id || "";
    this.end();
    wx.navigateTo({ url: subjectId ? "/pages/chat/index?subjectId=" + encodeURIComponent(subjectId) : "/pages/chat/index?mode=chat" });
  },
  onHide() { this.end(); },
  onUnload() { this.end(); }
});
