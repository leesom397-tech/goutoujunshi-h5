const api = require("../../lib/api");
const followupContext = require("../../lib/followup-context");
function savedChatTask() { try { return typeof wx.getStorageSync === "function" ? wx.getStorageSync("chat-analysis-task") : null; } catch { return null; } }
const reportIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const empty = () => ({ id: "", subjectId: "", possibleIntent: "", evidence: "", observation: "", judgment: "", nextStep: "", lines: [], replies: [], hasReplies: false, replyEmptyReason: "", review: "", reportId: "", styleReportIds: [], canPersonalize: false, ranked: false, interactionScore: null, hasInteractionScore: false, interactionScoreLabel: "", interactionScoreNote: "" });

function followupSummary(result) {
  const excerpt = (value, length) => { const text = String(value || '').trim(); return text.length > length ? text.slice(0, length) + '…' : text; };
  return [
    result.partialNotice ? '范围：' + excerpt(result.partialNotice, 100) : '',
    '本轮判断：' + excerpt(result.judgment || result.possibleIntent, 140),
    result.interactionInsight ? '深层推测：' + excerpt(result.interactionInsight.interpretation, 150) + '；另一种解释：' + excerpt(result.interactionInsight.alternative, 100) + '；观察依据：' + excerpt(result.interactionInsight.observed, 150) : '',
    '可能的意思（推测）：' + excerpt(result.possibleIntent, 100),
    '依据：' + excerpt(result.evidence, 120),
    '下一步建议：' + excerpt(result.nextStep, 100),
    '最近原话摘录（不是完整聊天）：',
    ...(Array.isArray(result.lines) ? result.lines : []).slice(-5).map(line => (line.who || '待确认') + '：' + excerpt(line.text, 80))
  ].filter(Boolean).join('\n');
}

function interactionScore(result) {
  const preview = result.affinity || result.decision?.affinityPreview;
  return typeof preview?.value === "number" && Number.isFinite(preview.value) && preview.value >= 0 && preview.value <= 100 ? Math.round(preview.value) : null;
}
function relationshipMetrics(lines, annotations, score) {
  const seen = new Set(), turns = [];
  let interrupted = true;
  for (const item of lines || []) {
    if (!item || !['self','other'].includes(item.speaker) || typeof item.text !== 'string' || !item.text.trim() || /^\s*[\[【](?:图片|语音|视频|文件|表情)/.test(item.text)) { interrupted = true; continue; }
    // Reused report line IDs identify overlap; identical everyday phrases alone do not.
    const key = item.id ? JSON.stringify([item.id,item.speaker,item.text]) : '';
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const last = turns[turns.length-1];
    if (!interrupted && last && last.speaker === item.speaker) last.text += '\n' + item.text;
    else turns.push({speaker:item.speaker,text:item.text,interrupted});
    interrupted = false;
  }
  const other = turns.filter(item=>item.speaker==='other');
  const inviting = text => !/不约|不见|取消|没约|未约|上次|昨天|他说|她说|听说/.test(text) && /(?:要不要|要不|我们|咱们|一起).{0,15}(?:见面|见一面|吃饭|喝咖啡|看电影|逛街)/.test(text);
  const active = other.filter(item=>/[？?]|要不要|你觉得/.test(item.text) || inviting(item.text)).length;
  const responses = turns.filter((item,index)=>item.speaker==='other' && !item.interrupted && turns[index-1]?.speaker==='self');
  const expanded = responses.filter(item=>item.text.replace(/\s/g,'').length>=15 || /[？?]/.test(item.text)).length;
  const invites = other.filter(item=>inviting(item.text)).length;
  const boundary = other.some(item=>/别再联系我|不要再联系我|不要联系我|别联系我|别再找我|不想和你继续|不想跟你继续/.test(item.text));
  const percentage=(a,b)=>b?Math.round(a/b*100):null;
  const issues = [other.length<3?'当前对方原话较少，本轮比例不能代替长期主动率':'',!responses.length?'截图没有完整的我方发言→对方回应，回应扩展度暂不计分':'',invites?'邀约还需关联具体约定与后续结果，不能把见面回顾直接算兑现':''].filter(Boolean);
  return {
    activeRate:percentage(active,other.length), activeCount:active, otherTurnCount:other.length,
    replyExpansion:percentage(expanded,responses.length), expandedCount:expanded, responseCount:responses.length,
    inviteFulfillment:null, invitationCount:invites,
    stage:boundary?'明确退出信号':invites?'出现邀约线索':'交流了解中',
    trend:'待对照历史', trendDelta:null, trendNote:'只比较已归档、日期明确且可比的独立互动，不按分析次数判断。',
    score:typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=100?score:null,
    redFlag:boundary?'对方明确要求停止联系，应尊重边界并停止主动推进':'本轮没有识别到明确停止联系的原话，不等于已排除其他风险',
    opportunity:active?'对方有提问或邀约表达，可围绕原话具体回应':'先观察对方是否回应并延伸话题，不从短句直接推断冷淡',
    hasIssues:issues.length>0, issues,
    stopAdvice:boundary?'停止主动联系，尊重对方的明确表达。':'降低投入要看多次真实互动与已确认失约，不能按重复分析次数决定。'
  };
}

function historicalTrend(points, subjectId, reportId) {
  const merged = reportId && (points || []).find(point=>point && point.subjectId===subjectId && point.reportId!==reportId && Array.isArray(point.sourceReportIds) && point.sourceReportIds.includes(reportId));
  if (merged) return {trend:'已记录的互动',trendDelta:null,trendNote:'这段材料已合并到已有记录，本次重析不新增关系进展，也不累计加分。'};
  const validScore=value=>typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100;
  const validDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;};
  const dated=(points || []).filter(point=>point && point.subjectId===subjectId && validDate(point.eventStart) && validDate(point.eventEnd) && point.eventStart<=point.eventEnd).sort((a,b)=>a.eventEnd.localeCompare(b.eventEnd));
  const latest=reportId ? dated.find(point=>point.reportId===reportId) : dated[dated.length-1];
  const before=latest && dated.find(point=>point.reportId===latest.previousReportId);
  if(!latest || !before || !latest.connectPrevious || before.eventEnd>=latest.eventStart || !validScore(latest.score) || !validScore(before.score)) return {trend:'待对照历史',trendDelta:null,trendNote:'还没有两段日期明确、去重且可比的独立互动。'};
  const delta=Math.round(latest.score-before.score);
  return {trend:delta>0?'参考指标上升':delta<0?'参考指标下降':'参考指标持平',trendDelta:delta,trendNote:`${before.eventEnd} → ${latest.eventEnd}，互动参考指数 ${before.score} → ${latest.score}；不是好感概率。`};
}

function visiblePossibleIntent(text, label, evidence) {
  const candidate = String(label || "").trim();
  if (candidate && evidence !== "insufficient" && !/(?:未明确|依据还不够|难以判断|难判断|无法判断|未知|不确定)/.test(candidate)) return candidate;
  const quote = String(text || "").trim();
  if (!quote || /^(?:\[|【)(?:语音|图片|视频|文件)(?:\]|】)/.test(quote)) return "这轮没有可读的对方原话，先不猜想法";
  if (/(?:别联系|不要联系|停止联系|别再找我|不想继续)/.test(quote)) return "可能在表达不想继续或需要边界";
  if (/(?:没空|不方便|不行|去不了|算了)/.test(quote)) return "可能在说这次安排不方便";
  if (/[？?]/.test(quote)) return "可能在向你提问或确认信息";
  if (/(?:周[一二三四五六日天]|星期[一二三四五六日天]|明天|后天|几点).*(?:可以|有空|改|见)/.test(quote)) return "可能在商量时间或安排";
  if (/^(?:好[的呀]?|嗯+|哦+|行|可以|收到|知道了|哈哈+)[…~～。！!]*$/.test(quote)) return "可能只是在简短回应你，暂看不出更多";
  return "可能在接着当前话题说，具体想法还要看上下文";
}

// Keep style evidence on this device and limit it to confirmed self bubbles in this report.
function readableStyleText(value) {
  const text = String(value || "").replace(/[″〃]/g, '"').trim();
  if (!text) return "";
  if (/^(?:\[|【)(?:表情包文字|表情包|sticker(?: text)?)(?:\]|】)/i.test(text)) return "";
  if (/^(?:\[|【)(?:语音(?:消息)?|voice(?: message)?)(?:\]|】)(?:\s*\d+(?:\.\d+)?\s*(?:["'”’]|秒|s|sec(?:onds)?))?\s*$/i.test(text)) return "";
  if (/^(?:\[|【)(?:图片|视频|文件|表情|位置|image|video|file)(?:\]|】)(?:\s+\S[^\r\n]*)?\s*$/i.test(text)) return "";
  return text.replace(/\s+/g, " ").slice(0, 120);
}
function styleSamples(lines) {
  const samples = [...new Set(lines.filter(line => line.speaker === "self").map(line => readableStyleText(line.text)).filter(Boolean))].slice(-8);
  // Conservative on-device check: only readable Chinese or ASCII letters/digits
  // can unlock the button. The server repeats the final eligibility check.
  return { samples, eligible: samples.length >= 3 && samples.join("").replace(/[^A-Za-z0-9\u3400-\u9FFF]/g, "").length >= 30 };
}

Page({
  async loadPrices() {
    const token = this.data.token;
    if (!token) return false;
    const read = this._priceRead = (this._priceRead || 0) + 1;
    this.setData({ pricesReady: false, priceError: "" });
    try {
      const value = await api.request("/api/miniapp/credits", "GET", null, token);
      if (this._unloaded || read !== this._priceRead || this.data.token !== token) return false;
      const prices = value.prices || {};
      if (!["analysisSmall", "analysisMedium", "analysisLarge", "text"].every(key => Number.isFinite(prices[key]) && prices[key] >= 0)) throw new Error("价格暂未完整取回，请重试或到账户页核对。");
      this.setData({ prices, pricesReady: true, priceError: "" }); return true;
    } catch (error) { if (!this._unloaded && read === this._priceRead && this.data.token === token) this.setData({ pricesReady: false, priceError: error.message || "价格暂未取回，请重试后再开始。" }); return false; }
  },

  data: {
    phase: "loading", prices: null, pricesReady: false, priceError: "", busy: false, error: "", progress: "", elapsedSeconds: 0, lastElapsedSeconds: 0, ticket: "", token: "",
    image: "", imageType: "", imageSize: 0, images: [], imageCount: 0, batchProgress: "",
    side: "ask", sideIndex: 0, sideChoices: ["请选择哪侧是我", "右侧绿色气泡是我", "左侧气泡是我"], agreed: false,
    people: [{ id: "", label: "这次先不归档" }], personIndex: 0,
    newPersonOpen: false, newPersonName: "", newPersonConsent: false, archiveReady: false, creatingPerson: false, archivePrompt: false,
    enabled: false, savedSide: "ask", result: empty(), rewriteBusy: -1, showLines: true,
    partialReports: [], partialCount: 0, partialTotal: 0,
    showEvidence: false, showPrivacyDetails: false, copiedReplyIndex: -1, copyError: "", followupBusy: false, followupError: ""
  },
  onShow() { this._hidden = false; if (this.data.busy) { this._resumeWhenIdle = true; return; } if (!this.data.token) this.refresh().then(() => this.resumeBackground()); else { this.loadPrices(); this.resumeBackground(); } },
  onHide() { this._hidden = true; },
  resumeAfterReturn() { if (this._resumeWhenIdle && !this._hidden && this.data.backgroundPending && !this._unloaded) { this._resumeWhenIdle = false; this.resumeBackground(); } },
  resumeAnalysis() { return this.resumeBackground(); },
  cancelAnalysis() {
    const pending = api.pendingUpload?.("/api/miniapp/screenshot/batch");
    if (!pending || this.data.busy) return;
    wx.showModal({ title: "取消本次上传？", content: "只删除本次临时上传，不删除人物档案。已启动的后台分析不能在这里取消。", success: async result => {
      if (!result.confirm || this.data.busy) return;
      this.setData({ busy: true });
      try { await api.cancelUpload(pending.taskId, this.data.token); wx.removeStorageSync("chat-analysis-task"); this.setData({ backgroundPending: false, error: "", agreed: false }); }
      catch (error) { this.setData({ error: error.message }); }
      finally { this.setData({ busy: false }); }
    } });
  },
  jobStatus(state) {
    if (this._unloaded) return;
    if (['error', 'expired', 'done'].includes(state.status)) this.clearPartialReports();
    if (state.taskId && this._partialTaskId && state.taskId !== this._partialTaskId) this.clearPartialReports();
    if (state.taskId) this._partialTaskId = state.taskId;
    if (['running', 'queued'].includes(state.status) && Array.isArray(state.partialResult?.entries)) {
      this.showPartialReports(state.partialResult.entries, state.imageCount);
    }
    if (["running", "queued"].includes(state.status)) {
      const total = state.imageCount || this.data.imageCount;
      const completed = Number(state.completedCount) || 0;
      this.setData({ taskStage: "running", batchProgress: state.retryAt
        ? `后台重试第 ${completed + 1} 张 · 已完成 ${completed}/${total} 张`
        : `服务器已接收 · 已完成 ${completed}/${total} 张，切走后继续分析` });
    } else if (state.status === "uploading") {
      const received = Array.isArray(state.received) ? state.received.length : state.received;
      this.setData({ taskStage: "uploading", uploadProgress: `已上传 ${received}/${state.total || state.imageCount} 张` });
    }
  },
  clearPartialReports() {
    this._partialTaskId = null;
    this._partialVersion = '';
    this.setData({ partialReports: [], partialCount: 0, partialTotal: 0 });
  },
  showPartialReports(entries, total) {
    const reports = (entries || []).slice(0, 9).filter(entry => entry?.id && Array.isArray(entry.lines));
    const version = reports.map(entry => entry.id).join('|');
    if (!reports.length || version === this._partialVersion) return;
    this._partialVersion = version;
    this.setData({ partialCount: reports.length, partialTotal: Number(total) || this.data.imageCount || reports.length,
      partialReports: reports.map((entry, index) => {
        const notes = new Map((entry.annotations || []).map(note => [note.lineId, note]));
        return { id: entry.id, number: index + 1,
          observation: entry.decision?.observation || '',
          interpretation: entry.decision?.possibleIntent || entry.decision?.judgment || '',
          lines: entry.lines.map((line, lineIndex) => ({ id: line.id || String(lineIndex),
            speaker: line.speaker, who: line.speaker === 'self' ? '我' : line.speaker === 'other' ? '对方' : '待确认',
            text: line.text, note: notes.get(line.id)?.note || '' })) };
      }) });
  },
  presentBatch(entries, elapsed, completion = {}) {
      this.clearPartialReports();
      const result = entries.at(-1);
      const collected = entries.flatMap((entry, index) => entry.lines.map(line => ({ ...line, screenshotNumber: index + 1 })));
      const collectedAnnotations = entries.flatMap(entry => entry.annotations || []);
      if (!result.id || !Array.isArray(result.lines)) throw new Error("报告没有完整返回，请稍后重试。");
      const tags = new Map(collectedAnnotations.map(item => [item.lineId, item]));
      const lines = collected.map((item, index) => {
        const labels = tags.get(item.id) || {};
        const describe = values => (values || []).slice(0, 3).map(tag => tag.label + (typeof tag.probability === "number" ? " " + Math.round(tag.probability * 100) + "%" : "")).join(" · ");
        return { id: `${item.screenshotNumber}-${item.id || index}`, screenshotNumber: item.screenshotNumber, lineNumber: index + 1, who: item.speaker === "self" ? "我" : item.speaker === "other" ? "对方" : "待确认", text: item.text, emotions: describe(labels.emotion), intents: describe(labels.intent), emotionTags:labels.emotion||[],intentTags:labels.intent||[],note: labels.note || "" };
      });
      const lastOther = [...collected].reverse().find(item => item.speaker === "other");
      const annotation = tags.get(lastOther?.id);
      const options = [...(result.decision?.replyOptions || [])].sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1)).slice(0, 3);
      const replies = options.map((option, index) => ({ ...option, rankLabel: index === 0 ? "本轮首选" : `备选 ${index + 1}`, expanded: false, personalizedText: "", note: "", rewriteError: "" }));
      const latestSpeaker = [...collected].reverse().find(item => item.speaker === "self" || item.speaker === "other")?.speaker;
      const styleReportIds = entries.filter(entry => entry.lines?.some(line => line.speaker === "self")).map(entry => entry.id).filter(Boolean).slice(-9);
      const score = interactionScore(result);
      const photoClues = entries.flatMap((entry,index)=>(entry.decision?.photoClues || []).map(clue=>({...clue,location:`图 ${index+1} · ${clue.location}`})));
      this._selfLines = collected.filter(item => item.speaker === "self");
      this.setData({ result: {
        partialNotice: completion.incomplete ? `仅完成前 ${entries.length}/${completion.totalCount || '?'} 张，以下不是整组结论。未完成部分请稍后单独提交。` : '',
        id: result.id, subjectId: result.subjectId || "", compatibility: result.compatibility || null,
        avatarCandidates: entries.flatMap((entry,imageIndex)=>(entry.decision?.avatarCandidates||[]).filter(c=>this.data.side !== "ask" && c.side !== this.data.side && ["left","right"].includes(c.side)).map(c=>({...c,imageIndex}))), photoClues, photoClueCount: photoClues.length,
        interactionInsight: result.decision?.interactionInsight || null,
        possibleIntent: visiblePossibleIntent(lastOther?.text, result.decision?.possibleIntent || annotation?.intent?.[0]?.label, annotation?.evidence),
        evidence: result.decision?.evidence || (lastOther ? "对方原话：「" + lastOther.text.slice(0, 100) + (lastOther.text.length > 100 ? "…" : "") + "」" : "本轮没有已确认来自对方的可读原话。"),
        observation: result.decision?.observation || "", judgment: result.decision?.judgment || "", nextStep: result.decision?.nextStep || "",
        review: result.decision?.replyReview || (this._selfLines.length ? "看到你已发的消息；这轮未能可靠评价具体哪句，打开逐句解读核对原话。" : "截图中未识别到你已发的文字，暂时没有可评价的回复。"), replies, hasReplies: replies.length > 0,
        replyEmptyReason: latestSpeaker === "self" ? "最后是你已发出的消息，先等对方回应；不把旧截图的回复建议当成现在该发的话。" : "这轮没有可靠的可发送回复；可以先按上面的下一步行动。",
        lines, linesToggleLabel: `查看逐句解读 · ${lines.length} 句`, reportId: result.id, styleReportIds,
        canPersonalize: styleSamples(this._selfLines).eligible,
        interactionScore: score, hasInteractionScore: score !== null,
        affectionScope: (result.affinity || result.decision?.affinityPreview)?.valueScope === 'partial' ? '部分维度参考' : '本次互动信号',
        affectionBoundary: !!(result.affinity || result.decision?.affinityPreview)?.boundaryApplied,
        interactionScoreLabel: score === null ? `本轮可核对互动 · ${collected.filter(item => item.speaker === "self" || item.speaker === "other").length} 句` : `综合互动参考 · ${score}/100`,
        interactionScoreNote: score === null ? "已列出可核对的对话句数；六维分数缺少依据时不编造。" : "仅供参考，不是喜欢你的概率。", metrics: relationshipMetrics(collected, collectedAnnotations, score),
        ranked: replies.length > 0 && replies.every(option => typeof option.weight === "number"),
        durationSeconds: elapsed()
      }, showLines: true, showEvidence: false, copiedReplyIndex: -1, copyError: "", followupError: "", image: "", images: [], imageCount: 0, agreed: false, progress: "", batchProgress: "" });
      this.loadHistoricalTrend?.(result.subjectId, result.id);
  },
  async loadHistoricalTrend(subjectId, reportId) {
    if (!subjectId || !reportId || !this.data.token) return;
    const token=this.data.token, readId=this._trendRead=(this._trendRead || 0)+1;
    const current=()=>{
      let session;
      try { session=wx.getStorageSync(api.STORAGE); } catch { return false; }
      return !this._unloaded && this._trendRead===readId && this.data.token===token && session?.token===token && session.expiresAt>Date.now() && this.data.result?.reportId===reportId;
    };
    if (!current()) return;
    this.setData({'result.metrics.trendLoading':true});
    try {
      const profile=await api.request('/api/miniapp/profile','GET',null,token);
      if (!current()) return;
      if (!profile.enabled || profile.paused || !(profile.subjects || []).some(person=>person.id===subjectId)) {
        this.setData({'result.metrics.trendLoading':false,'result.metrics.trendNote':'当前人物档案未启用，暂不读取长期趋势。'}); return;
      }
      const trend=historicalTrend((profile.trends || []).find(item=>item.subjectId===subjectId)?.points,subjectId,reportId);
      this.setData({'result.metrics':{...this.data.result.metrics,...trend,trendLoading:false}});
    } catch {
      if (current()) this.setData({'result.metrics.trendLoading':false,'result.metrics.trendNote':'长期趋势暂未取回，本轮逐句分析仍可查看。'});
    }
  },
  async resumeBackground() {
    if (!api.BACKGROUND_BATCH || this.data.busy || !this.data.token) return;
    const saved = api.pendingUpload?.("/api/miniapp/screenshot/batch") || savedChatTask();
    if (!saved || !saved.taskId) return;
    this.setData({ busy: true, taskStage: "checking", backgroundPending: true, error: "", progress: "正在取回后台聊天分析…" });
    try {
      if (api.pendingUpload?.("/api/miniapp/screenshot/batch")?.taskId === saved.taskId) await api.resumeUpload(saved.taskId, this.data.token, state => this.jobStatus(state));
      const completed = await api.waitForJob("/api/miniapp/screenshot/batch", saved.taskId, this.data.token, state => this.jobStatus(state));
      if (this._unloaded) return;
      this.setData({ personIndex: Math.max(0, this.data.people.findIndex(person => person.id === saved.subjectId)) });
      this.presentBatch(completed.entries, () => 0, completed);
      wx.removeStorageSync("chat-analysis-task");
      await api.finishUpload?.(saved.taskId);
    } catch (error) { if (error.terminal || [401, 403, 409, 410].includes(error.status)) this.clearPartialReports(); if (error.terminal || error.status === 410) { wx.removeStorageSync("chat-analysis-task"); await api.finishUpload?.(saved.taskId); } this.setData({ error: error.message || "暂时无法取回报告，请稍后回来。" }); }
    finally { this.setData({ busy: false, progress: "", backgroundPending: !!(api.pendingUpload?.("/api/miniapp/screenshot/batch") || savedChatTask()) }); this.resumeAfterReturn(); }
  },
  async refresh() {
    const selectedId = this.data.people[this.data.personIndex]?.id || "";
    this.setData({ phase: "loading", error: "" });
    try {
      const current = await api.session();
      if (!current.token) throw new Error("微信身份暂时无法验证，请稍后重试。");
      const people = [{ id: "", label: "这次先不归档" }, ...(current.state.subjects || [])];
      const selectedIndex = selectedId ? people.findIndex(item => item.id === selectedId) : 0;
      const missing = !!selectedId && selectedIndex < 0;
      if (missing) { this._requestId = null; this._sessionId = null; this._selfLines = []; }
      this.setData({
        phase: "ready", token: current.token, ticket: "",
        people, personIndex: missing ? 0 : selectedIndex,
        ...(missing ? { agreed: false, result: empty(), error: "之前选的对象已不在档案中；请重新确认这张截图对应谁。" } : {}),
        enabled: !!current.state.screenshot?.enabled,
        savedSide: current.state.screenshot?.selfSide || "ask"
      });
      this.loadPrices();
    } catch (error) { this.setData({ phase: "error", error: error.message }); }
  },
  choose() {
    if (this.data.busy) return;
    wx.chooseMedia({
      count: 9, mediaType: ["image"], sourceType: ["album"], sizeType: ["original"],
      success: async value => {
        const selected = value.tempFiles || [];
        if (!selected.length || selected.length > 9 || selected.some(item => item.size > 5000000)) { this.setData({ error: "最多选 9 张，每张须在 5 MB 内。" }); return; }
        try {
          const images = await Promise.all(selected.map(async (item, index) => {
            const info = await new Promise((resolve, reject) => wx.getImageInfo({ src: item.tempFilePath, success: resolve, fail: reject }));
            const type = String(info.type || "").toLowerCase();
            if (!["jpeg", "jpg", "png"].includes(type)) throw new Error("请选 JPG 或 PNG 截图。");
            return { path: item.tempFilePath, type: type === "png" ? "png" : "jpeg", size: item.size, order: index + 1 };
          }));
          this._requestId = null;
          this._sessionId = null;
          this._selfLines = [];
          this._batchResults = null;
          this.setData({ avatarSources: images, image: images[0].path, imageType: images[0].type, imageSize: images[0].size, images, imageCount: images.length, side: "ask", sideIndex: 0, personIndex: 0, agreed: false, error: "", elapsedSeconds: 0, lastElapsedSeconds: 0, result: empty(), showLines: true, showEvidence: false, showPrivacyDetails: false, copiedReplyIndex: -1, copyError: "", archivePrompt: true, newPersonOpen: false, newPersonName: "", newPersonConsent: false });
        } catch (error) { this.setData({ error: error.message || "截图没有读取成功，请重新选择。" }); }
      }
    });
  },
  moveImage(event) {
    if (this.data.busy) return;
    const from = Number(event.currentTarget.dataset.index), step = Number(event.currentTarget.dataset.step);
    const to = from + step, images = this.data.images.slice();
    if (!Number.isInteger(from) || !Number.isInteger(step) || to < 0 || to >= images.length) return;
    [images[from], images[to]] = [images[to], images[from]];
    this._requestId = null; this._sessionId = null; this._batchResults = null;
    this.setData({ images: images.map((item, index) => ({ ...item, order: index + 1 })), agreed: false, result: empty() });
  },
  sideChange(event) { if (this.data.busy) return; const index = Number(event.detail.value) || 0; this._requestId = null; this._sessionId = null; this._selfLines = []; this._batchResults = null; this.setData({ side: index === 1 ? "right" : index === 2 ? "left" : "ask", sideIndex: index, agreed: false, result: empty() }); },
  personChange(event) { if (this.data.busy) return; const candidate = Number(event.detail.value); const index = Number.isInteger(candidate) && candidate >= 0 && candidate < this.data.people.length ? candidate : 0; this._requestId = null; this._sessionId = null; this._selfLines = []; this._batchResults = null; api.setCurrentSubject?.(this.data.people[index]?.id || ""); this.setData({ personIndex: index, archivePrompt: false, agreed: false, result: empty() }); },
  skipArchive() { this.personChange({ detail: { value: 0 } }); },
  async openNewPerson() {
    if (this.data.busy || this.data.creatingPerson || !this.data.token) return;
    this.setData({ newPersonOpen: true, archivePrompt: false, archiveReady: false, newPersonConsent: false, error: "" });
    try {
      const profile = await api.request("/api/miniapp/profile", "GET", null, this.data.token);
      this.setData({ archiveReady: !!profile.enabled && !profile.paused });
    } catch (error) { this.setData({ error: error.message || "暂时无法读取档案状态。" }); }
  },
  newPersonInput(event) { this.setData({ newPersonName: event.detail.value }); },
  newPersonAgree(event) { this.setData({ newPersonConsent: event.detail.value.includes("yes") }); },
  cancelNewPerson() { if (!this.data.creatingPerson) this.setData({ newPersonOpen: false, newPersonName: "", newPersonConsent: false, error: "" }); },
  async createPerson() {
    if (this.data.busy || this.data.creatingPerson || !this.data.token) return;
    const name = this.data.newPersonName.trim();
    if (!name || name.length > 60) { this.setData({ error: "先给这位对象起个 60 字以内的称呼。" }); return; }
    this.setData({ creatingPerson: true, error: "" });
    try {
      let profile = await api.request("/api/miniapp/profile", "GET", null, this.data.token);
      if (!profile.enabled || profile.paused) {
        if (!this.data.newPersonConsent) { this.setData({ archiveReady: false, error: "请先同意启用关系档案，或取消后选择不归档。" }); return; }
        profile = await api.request("/api/miniapp/profile", "POST", { action: "consent", enabled: true }, this.data.token);
      }
      const existing = new Set((profile.subjects || []).map(item => item.id));
      const created = await api.request("/api/miniapp/profile", "POST", { action: "create", label: name }, this.data.token);
      const person = (created.subjects || []).find(item => !existing.has(item.id));
      if (!person) throw new Error("档案已保存，请重新打开页面选择这位对象。");
      const people = [{ id: "", label: "这次先不归档" }, ...(created.subjects || [])];
      this._requestId = null; this._sessionId = null; this._selfLines = [];
      this.setData({ people, personIndex: people.findIndex(item => item.id === person.id), newPersonOpen: false, newPersonName: "", newPersonConsent: false, archiveReady: true, archivePrompt: false, agreed: false, result: empty(), error: "" });
    } catch (error) {
      if (error.status === 401) wx.removeStorageSync(api.STORAGE);
      this.setData({ error: error.message || "新建档案未完成，请重试。" });
    } finally { this.setData({ creatingPerson: false }); }
  },
  agree(event) { this.setData({ agreed: event.detail.value.length > 0 }); },
  togglePrivacyDetails() { this.setData({ showPrivacyDetails: !this.data.showPrivacyDetails }); },
  toggleEvidence() { this.setData({ showEvidence: !this.data.showEvidence }); },
  toggleLines() { this.setData({ showLines: !this.data.showLines }); },
  jumpReport(event) {
    const section = event.currentTarget.dataset.section;
    if (!['judgment', 'replies', 'metrics', 'lines', 'photos'].includes(section)) return;
    if (section === 'photos' && !this.data.result.photoClueCount) return;
    const scroll = () => this.scrollReportSection(section);
    if (section === 'lines' && !this.data.showLines) this.setData({ showLines: true }, scroll);
    else scroll();
  },
  scrollReportSection(section) {
    const selector = '#report-' + section;
    if (typeof wx.createSelectorQuery !== 'function') { wx.pageScrollTo({ selector, duration: 250 }); return; }
    wx.createSelectorQuery().select(selector).boundingClientRect().select('.report-shortcuts').boundingClientRect().selectViewport().scrollOffset().exec(rects => {
      if (this._unloaded || !rects || !rects[0] || !rects[2]) return;
      const inset = rects[1] ? rects[1].height + 12 : 12;
      wx.pageScrollTo({ scrollTop: Math.max(0, rects[0].top + rects[2].scrollTop - inset), duration: 250 });
    });
  },
  copyReply(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const reply = this.data.result.replies[index];
    const text = reply && (reply.personalizedText || reply.text);
    if (!text) return;
    const reportId = this.data.result.reportId;
    const copyRequest = this._copyRequest = (this._copyRequest || 0) + 1;
    const current = () => {
      const selected = this.data.result.replies[index];
      return !this._unloaded && this._copyRequest === copyRequest && this.data.result.reportId === reportId && selected && (selected.personalizedText || selected.text) === text;
    };
    this.setData({ copiedReplyIndex: -1, copyError: "" });
    wx.setClipboardData({
      data: text,
      success: () => { if (current()) this.setData({ copiedReplyIndex: index, copyError: "" }); },
      fail: () => { if (current()) this.setData({ copyError: "复制未完成，可以长按回复文字复制。" }); }
    });
  },
  async analyze() {
    if (api.BACKGROUND_BATCH && !this.data.busy && savedChatTask()) return this.resumeBackground();
    if (this.data.busy || this.data.phase !== "ready") return;
    if (!this.data.image) { this.setData({ error: "先从相册选择聊天截图。" }); return; }
    if (this.data.side === "ask") { this.setData({ error: "请先选择截图里哪侧气泡是你。" }); return; }
    if (!this.data.agreed) { this.setData({ error: "请先确认材料提供权与本次处理范围。" }); return; }
    if (!this.data.pricesReady) { this.setData({ error: "请先重试读取本次价格，再开始分析。" }); return; }
    const subjectId = this.data.people[this.data.personIndex]?.id || null;
    const startedAt = Date.now();
    const elapsed = () => Math.max(1, Math.ceil((Date.now() - startedAt) / 1000));
    if (api.BACKGROUND_BATCH && (api.pendingUpload?.("/api/miniapp/screenshot/batch") || savedChatTask())) return this.resumeBackground();
    this.clearPartialReports();
    this.setData({ busy: true, taskStage: "uploading", backgroundPending: false, error: "", progress: "", elapsedSeconds: 1, lastElapsedSeconds: 0 });
    this._elapsedTimer = setInterval(() => this.setData({ elapsedSeconds: elapsed() }), 1000);
    try {
      if (!this.data.enabled || this.data.savedSide !== this.data.side) {
        await api.request("/api/miniapp/settings", "POST", { consent: true, allowImageProcessing: true, selfSide: this.data.side }, this.data.token);
        this.setData({ enabled: true, savedSide: this.data.side });
      }
      this._sessionId ||= await api.newId();
      const images = this.data.images.length ? this.data.images : [{ path: this.data.image, type: this.data.imageType }];
      const signature = JSON.stringify({ paths: images.map(item => item.path), side: this.data.side, subjectId });
      if (!this._batchResults || this._batchResults.signature !== signature) this._batchResults = { signature, entries: [] };
      const entries = this._batchResults.entries;
      if (api.BACKGROUND_BATCH && !entries.length) {
        let taskId;
        if (api.createUpload) {
          const queued = await api.createUpload("/api/miniapp/screenshot/batch", images, { confirmed: true, selfSide: this.data.side, sessionId: this._sessionId, subjectId }, this.data.token);
          taskId = queued.taskId;
          wx.setStorageSync("chat-analysis-task", { taskId, subjectId });
          await api.resumeUpload(taskId, this.data.token, state => this.jobStatus(state));
        } else {
        const payloads = [];
        for (const item of images) payloads.push(await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({filePath:item.path,encoding:"base64",success:value=>resolve("data:image/"+item.type+";base64,"+value.data),fail:reject})));
        taskId = await api.newId();
        wx.setStorageSync("chat-analysis-task", { taskId, subjectId });
        this.setData({ batchProgress: "正在上传整组聊天，请先留在本页。" });
        try { await api.request("/api/miniapp/screenshot/batch", "POST", { taskId, images: payloads, confirmed: true, selfSide: this.data.side, sessionId: this._sessionId, subjectId }, this.data.token); this.setData({ taskStage: "running", batchProgress: "后台已接收，回来后可查看结果。" }); }
        catch (error) { if (!error.network && !(error.status >= 500)) { wx.removeStorageSync("chat-analysis-task"); throw error; } }
        }
        this.setData({ taskStage: this.data.taskStage === "running" ? "running" : "checking" });
        const completed = await api.waitForJob("/api/miniapp/screenshot/batch", taskId, this.data.token, state => this.jobStatus(state));
        if (this._unloaded) return;
        entries.push(...completed.entries);
        wx.removeStorageSync("chat-analysis-task");
        await api.finishUpload?.(taskId);
        if (completed.incomplete) { this.presentBatch(entries, elapsed, completed); this._batchResults = null; return; }
      }
      for (let index = entries.length; index < images.length; index++) {
        const item = images[index];
        this.setData({ batchProgress: `正在按聊天顺序分析第 ${index + 1}/${images.length} 张` });
        const image = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({
          filePath: item.path, encoding: "base64", success: value => resolve("data:image/" + item.type + ";base64," + value.data), fail: reject
        }));
        this._requestId ||= await api.newId();
        let currentResult;
        try {
          currentResult = await api.request("/api/miniapp/screenshot", "POST", {
            image, confirmed: true, selfSide: this.data.side,
            requestId: this._requestId, sessionId: this._sessionId,
            subjectId
          }, this.data.token);
        } catch (error) {
          if (!error.network && !error.processing) throw error;
          this.setData({ progress: `连接中断，正在查询第 ${index + 1} 张的结果…` });
          currentResult = await api.waitForScreenshot(this._requestId, this.data.token);
        }
        if (!currentResult.id || !Array.isArray(currentResult.lines)) throw new Error(`第 ${index + 1} 张的报告未完整返回，请重试。`);
        entries.push(currentResult);
        this.showPartialReports(entries, images.length);
        this._requestId = null;
      }
      this.presentBatch(entries, elapsed);
      this._requestId = null;
    } catch (error) {
      if (error.terminal || [401, 403, 409, 410].includes(error.status)) this.clearPartialReports();
      if (error.terminal || error.status === 410) { const failedTask = api.pendingUpload?.("/api/miniapp/screenshot/batch") || savedChatTask(); if (failedTask) await api.finishUpload?.(failedTask.taskId); wx.removeStorageSync("chat-analysis-task"); }
      if (error.status === 401) { wx.removeStorageSync(api.STORAGE); this.setData({ phase: "error", error: "会话已过期，请重新登录。" }); }
      else this.setData({ error: error.message || "截图分析未完成，请重试。" });
      this.setData({ lastElapsedSeconds: elapsed() });
    } finally { clearInterval(this._elapsedTimer); this._elapsedTimer = null; this.setData({ busy: false, progress: "", batchProgress: "", elapsedSeconds: 0, backgroundPending: !!(api.pendingUpload?.("/api/miniapp/screenshot/batch") || savedChatTask()) }); this.resumeAfterReturn(); }
  },
  report() {
    const id = this.data.result.reportId;
    if (reportIdPattern.test(id)) wx.navigateTo({ url: "/pages/report/index?id=" + id });
  },
  async openFollowup() {
    const result = this.data.result;
    if (this.data.followupBusy || !result || !reportIdPattern.test(result.reportId)) return;
    this.setData({ followupBusy: true, followupError: "" });
    try {
      await followupContext.openReportFollowup({ source: 'chat-analysis', title: '聊天分析', subjectId: result.subjectId || '', token: this.data.token, reportId: result.reportId, summary: followupSummary(result) });
    } catch (error) {
      if (!this._unloaded && this.data.result.reportId === result.reportId) this.setData({ followupError: error.message || '暂时无法继续追问，请重试。' });
    } finally { if (!this._unloaded) this.setData({ followupBusy: false }); }
  },
  openArchive() { wx.navigateTo({ url: "/pages/archive/index" }); },
  toggleReply(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.result.replies.length) return;
    this.setData({ result: { ...this.data.result, replies: this.data.result.replies.map((item, position) => position === index ? { ...item, expanded: !item.expanded } : item) } });
  },
  async personalize(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.data.result.canPersonalize || this.data.rewriteBusy >= 0 || !Number.isInteger(index) || index < 0 || index >= this.data.result.replies.length) return;
    if (!this.data.pricesReady) { this.setData({ error: "请先重试读取改写价格。" }); return; }
    const reportId = this.data.result.reportId;
    this.setData({ rewriteBusy: index, copiedReplyIndex: -1, copyError: "" });
    try {
      this._rewriteIds ||= {};
      const rewriteKey = reportId + ":" + index;
      this._rewriteIds[rewriteKey] ||= await api.newId();
      const rewritten = await api.request("/api/miniapp/rewrite", "POST", { reportId, optionIndex: index, styleReportIds: this.data.result.styleReportIds, confirmed: true, requestId: this._rewriteIds[rewriteKey] }, this.data.token);
      if (!rewritten.text || !rewritten.status || !rewritten.note) throw new Error("云端改写暂未完成，原推荐仍可使用。");
      if (this.data.result.reportId !== reportId) return;
      this.setData({ result: { ...this.data.result, replies: this.data.result.replies.map((item, position) => position === index ? { ...item, personalizedText: rewritten.status === "adjusted" ? rewritten.text : "", note: rewritten.note, rewriteError: "" } : item) } });
    } catch (error) {
      if (this.data.result.reportId === reportId) this.setData({ result: { ...this.data.result, replies: this.data.result.replies.map((item, position) => position === index ? { ...item, rewriteError: error.message || "云端改写暂未完成。" } : item) } });
    } finally { this.setData({ rewriteBusy: -1 }); }
  },
  reset() { this.clearPartialReports(); this._requestId = null; this._sessionId = null; this._selfLines = []; this._batchResults = null; this.setData({ image: "", images: [], imageCount: 0, side: "ask", sideIndex: 0, personIndex: 0, agreed: false, result: empty(), error: "", elapsedSeconds: 0, lastElapsedSeconds: 0, archivePrompt: false, newPersonOpen: false, newPersonName: "", newPersonConsent: false, showLines: true, showEvidence: false, showPrivacyDetails: false, copiedReplyIndex: -1, copyError: "" }); if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 250 }); },
  openSocialProfile() { wx.navigateTo({ url: "/pages/social-profile/index" }); },
  onUnload() { this._unloaded = true; this._hidden = true; clearInterval(this._elapsedTimer); this._elapsedTimer = null; }
});
