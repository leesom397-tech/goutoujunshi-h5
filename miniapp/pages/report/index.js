const api = require("../../lib/api");
const {riskAwarePresentation,riskReplyAllowed}=require("../../lib/risk-aware-presentation");
const followupContext = require("../../lib/followup-context");
const { importedReport } = require("../../lib/imported-report");
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function followupSummary(report) {
  const excerpt = (value, length) => { const text = String(value || '').trim(); return text.length > length ? text.slice(0, length) + '…' : text; };
  return [
    '本轮判断：' + excerpt(report.judgment || report.possibleIntent, 140),
    report.interactionInsight ? '深层推测：' + excerpt(report.interactionInsight.interpretation, 150) + '；另一种解释：' + excerpt(report.interactionInsight.alternative, 100) + '；观察依据：' + excerpt(report.interactionInsight.observed, 150) : '',
    '可能的意思（推测）：' + excerpt(report.possibleIntent, 100),
    '依据：' + excerpt(report.evidence, 120),
    '下一步建议：' + excerpt(report.nextStep, 100),
    '最近原话摘录（不是完整聊天）：',
    ...(Array.isArray(report.lines) ? report.lines : []).slice(-5).map(line => (line.who || '待确认') + '：' + excerpt(line.text, 80))
  ].join('\n');
}

function historicalTrend(points, subjectId, reportId) {
  const merged = reportId && (points || []).find(point=>point && point.subjectId===subjectId && point.reportId!==reportId && Array.isArray(point.sourceReportIds) && point.sourceReportIds.includes(reportId));
  if (merged) return {trend:'已记录的互动',trendDelta:null,trendNote:'这段材料已合并到已有记录，本次重析不新增关系进展，也不累计加分。'};
  const validScore=value=>typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100;
  const validDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;};
  const dated=(points || []).filter(point=>point && point.subjectId===subjectId && validDate(point.eventStart) && validDate(point.eventEnd) && point.eventStart<=point.eventEnd);
  const latest=dated.find(point=>point.reportId===reportId);
  const before=latest && dated.find(point=>point.reportId===latest.previousReportId);
  if(!latest || !before || !latest.connectPrevious || before.eventEnd>=latest.eventStart || !validScore(latest.score) || !validScore(before.score)) return {trend:'待对照历史',trendDelta:null,trendNote:'还没有两段日期明确、去重且可比的独立互动。'};
  const delta=Math.round(latest.score-before.score);
  return {trend:delta>0?'参考指标上升':delta<0?'参考指标下降':'参考指标持平',trendDelta:delta,trendNote:`${before.eventEnd} → ${latest.eventEnd}，互动参考指数 ${before.score} → ${latest.score}；不是好感概率。`};
}

// Observable counts only, using the same turn boundaries as the quick report.
function interactionOverview(lines) {
  const seen = new Set(), turns = [];
  let interrupted = true;
  for (const line of lines || []) {
    if (!line || !['self', 'other'].includes(line.speaker) || typeof line.text !== 'string' || !line.text.trim() || /^\s*[\[【](?:图片|语音|视频|文件|表情)/.test(line.text)) { interrupted = true; continue; }
    const key = line.id ? JSON.stringify([line.id, line.speaker, line.text]) : '';
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const last = turns[turns.length - 1];
    if (!interrupted && last && last.speaker === line.speaker) last.text += '\n' + line.text;
    else turns.push({ speaker: line.speaker, text: line.text, interrupted });
    interrupted = false;
  }
  const other = turns.filter(line => line.speaker === 'other');
  const inviting = text => !/不约|不见|取消|没约|未约|上次|昨天|他说|她说|听说/.test(text) && /(?:要不要|要不|我们|咱们|一起).{0,15}(?:见面|见一面|吃饭|喝咖啡|看电影|逛街)/.test(text);
  const responses = turns.filter((line, index) => line.speaker === 'other' && !line.interrupted && turns[index - 1]?.speaker === 'self');
  return {
    otherTurnCount: other.length,
    activeCount: other.filter(line => /[？?]|要不要|你觉得/.test(line.text) || inviting(line.text)).length,
    expandedCount: responses.filter(line => line.text.replace(/\s/g, '').length >= 15 || /[？?]/.test(line.text)).length,
    responseCount: responses.length
  };
}

function present(report) {
  report = importedReport(report);
  const rankedOriginal = [...(report.decision?.replyOptions || [])].map((item, originalIndex) => ({...item,originalIndex})).sort((a,b)=>(b.weight??-1)-(a.weight??-1)).slice(0,3);
  const samples = [...new Set((report.lines || []).filter(line=>line.speaker==='self' && !/^\s*[\[【](?:表情|贴纸|图片|视频|文件|语音|voice|sticker|image)/i.test(line.text || '')).map(line=>String(line.text || '').trim().replace(/\s+/g,' ').slice(0,120)).filter(Boolean))].slice(-8);
  const canPersonalize = !report.isImported && samples.length>=3 && samples.join('').replace(/[^A-Za-z0-9\u3400-\u9FFF]/g,'').length>=30;
  const risk=riskAwarePresentation(report);report=risk.viewReport;
  const notes = new Map((report.annotations || []).map(item => [item.lineId, item]));
  const lines = (report.lines || []).map((line, index) => {
    const annotation = notes.get(line.id) || {};
    const tags = values => (values || []).slice(0, 3).map(item => item.label + (typeof item.probability === "number" ? " " + Math.round(item.probability * 100) + "%" : "")).join(" · ");
    return {
      id: line.id || String(index), lineNumber: index + 1, who: report.isImported ? line.speaker === 'self' ? '我' : line.sourceSpeaker : line.speaker === "self" ? "我" : line.speaker === "other" ? "对方" : "待确认",
      text: line.text, emotion: tags(annotation.emotion), intent: tags(annotation.intent), emotionTags:annotation.emotion||[],intentTags:annotation.intent||[],note: annotation.note || "",
      alternative: annotation.alternative || '', certainty: annotation.certainty || '',
      evidence: annotation.evidence === "insufficient" ? "依据不足" : annotation.evidence === "limited" ? "线索有限" : ""
    };
  });
  const replies = risk.replyOptions.slice(0,3).map((item,index)=>({...item,rewriteIndex:report.isImported?-1:rankedOriginal.findIndex(option=>option.originalIndex===item.originalIndex),rankLabel:report.isImported?`回复方向 ${index+1}`:index===0?'本轮首选':`备选 ${index+1}`,expanded:false,personalizedText:'',note:'',rewriteError:'',experienceEvidence:[]}));
  const affinity = report.affinity || report.decision?.affinityPreview;
  const score = typeof affinity?.value === "number" && Number.isFinite(affinity.value) && affinity.value >= 0 && affinity.value <= 100 ? Math.round(affinity.value) : null;
  const scope = affinity?.valueScope === "partial" ? "已知维度参考指数" : "六维互动参考指数";
  const dimensions = (affinity?.dimensions || []).map(item => {
    const value = typeof item.value === "number" && Number.isFinite(item.value) && item.value >= 0 && item.value <= 100 ? Math.round(item.value) : null;
    return { key: item.key, label: item.label, value, displayValue: value === null ? "待验证" : String(value), width: value === null ? 0 : value };
  });
  const diagnosis = report.relationshipDiagnosis && typeof report.relationshipDiagnosis === 'object' ? report.relationshipDiagnosis : null;
  const relationshipDiagnosis = diagnosis ? {
    questionLabel: diagnosis.questionLabel || '先看完整关系全景',
    currentState: diagnosis.relationship?.currentState || '待了解',
    trend: diagnosis.relationship?.trend || '待了解',
    reciprocity: diagnosis.relationship?.reciprocity || '材料不足，暂不判断。',
    recommendation: diagnosis.decision?.recommendation || '先核对材料，再决定下一步。',
    observeWindow: diagnosis.decision?.observeWindow || '',
    risks: Array.isArray(diagnosis.relationship?.risks) ? diagnosis.relationship.risks.slice(0, 3) : [],
    claimActions: Array.isArray(diagnosis.claimActions) ? diagnosis.claimActions.slice(0, 3) : [],
    unknowns: Array.isArray(diagnosis.unknowns) ? diagnosis.unknowns.slice(0, 3) : [],
  } : null;
  return {
    isImported: !!report.isImported, isRiskAnalysis: !!report.isRiskAnalysis, riskAlerts: report.riskAlerts || [], riskQuestions: report.riskQuestions || [], hasRiskAlerts: !!report.riskAlerts?.length, hasRiskQuestions: !!report.riskQuestions?.length, importObservations: report.importObservations || [], importBatches: report.importBatches || [],
    trend: '待对照历史', trendLoading: false,
    trendNote: report.subjectId ? '正在准备对照已归档的独立互动。' : '本次未关联人物，暂不对照历史。',
    affectionScore: score, hasAffectionScore: score !== null, interactionOverview: interactionOverview(report.lines),
    affectionScope: affinity?.valueScope === 'partial' ? '部分维度参考' : '本次互动信号',
    affectionBoundary: !!affinity?.boundaryApplied,
    photoClues: report.decision?.photoClues || [],
    personalConnection: report.personalConnection || null,relationshipDiagnosis,riskReview:risk.review,
    interactionInsight: report.decision?.interactionInsight || null,
    photoClueCount: (report.decision?.photoClues || []).length,
    id: report.id, subjectId: report.subjectId || '', compatibility: Object.prototype.hasOwnProperty.call(report, 'latestCompatibility') ? report.latestCompatibility : report.compatibility || null,
    hasCommonPoints: !!((Object.prototype.hasOwnProperty.call(report, 'latestCompatibility') ? report.latestCompatibility : report.compatibility)?.commonPoints?.length),
    compatibilityTitle: Object.prototype.hasOwnProperty.call(report, 'latestCompatibility') ? '最新资料适配 · 与你合适吗？' : '与你合适吗？',
    compatibilityNote: Object.prototype.hasOwnProperty.call(report, 'latestCompatibility') ? '按当前已确认档案判断，不改变上方原报告。' : '',
    possibleIntent: report.isImported || report.isRiskAnalysis ? '' : report.decision?.possibleIntent || "这轮原话还不足以判断对方的具体想法。",
    evidence: report.decision?.evidence || "请结合下方原话核对。", nextStep: report.decision?.nextStep || "先核对上下文，再决定是否回复。",
    observation: report.decision?.observation || "", judgment: report.decision?.judgment || "", review: report.decision?.replyReview || "",
    replies, canPersonalize, hasReplies: replies.length > 0, lines, linesLabel: `${report.isImported ? '最近一批关键原话' : '逐句解读'} · ${lines.length} 句`, coverage: report.coverage || null,
    affinity: affinity ? {
      value: score, scoreLabel: score === null ? "总分待验证" : `${scope} ${score}/100`,
      scope,
      contextCount: affinity.contextCount,
      boundaryApplied: !!affinity.boundaryApplied,
      dimensions, radarReady: dimensions.length === 6 && dimensions.every(item => item.value !== null)
    } : null
  };
}

Page({
  data: { phase: "loading", error: "", report: null, rewriteBusy: -1, showEvidence: false, showFitDetails: false, showLines: true, copiedReplyIndex: -1, copyError: "", followupBusy: false, followupError: "" },
  async openFollowup() {
    const report = this.data.report;
    if (this.data.followupBusy || !report || !idPattern.test(report.id)) return;
    this.setData({ followupBusy: true, followupError: "" });
    try {
      await followupContext.openReportFollowup({ source: 'chat-analysis', title: '聊天分析', subjectId: report.subjectId || '', token: this._token, reportId: report.id, summary: followupSummary(report) });
    } catch (error) {
      if (!this._unloaded && this.data.report && this.data.report.id === report.id) this.setData({ followupError: error.message || '暂时无法继续追问，请重试。' });
    } finally { if (!this._unloaded) this.setData({ followupBusy: false }); }
  },
  toggleEvidence() { this.setData({ showEvidence: !this.data.showEvidence }); },
  toggleFitDetails() { this.setData({ showFitDetails: !this.data.showFitDetails }); },
  toggleLines() { this.setData({ showLines: !this.data.showLines }); },
  jumpReport(event) {
    const section = event.currentTarget.dataset.section;
    if (!['judgment', 'replies', 'lines', 'metrics', 'photos', 'fit'].includes(section)) return;
    const report = this.data.report;
    if (!report || (section === 'photos' && !report.photoClueCount) || (section === 'fit' && !report.compatibility)) return;
    const scroll = () => this.scrollReportSection(section);
    if (section === 'lines' && !this.data.showLines) this.setData({ showLines: true }, scroll);
    else if (section === 'fit' && !this.data.showFitDetails) this.setData({ showFitDetails: true }, scroll);
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
    const index = Number(event.currentTarget.dataset.index), report = this.data.report;
    if (!report || !Array.isArray(report.replies) || !Number.isInteger(index) || index < 0 || index >= report.replies.length) return;
    const item = report.replies[index];
    const text = item && (item.personalizedText || item.text);
    if (!text) return;
    const copyRequest = this._copyRequest = (this._copyRequest || 0) + 1;
    const current = () => {
      const active = this.data.report;
      return !this._unloaded && this._copyRequest === copyRequest && active && active.id === report.id && active.replies[index] && (active.replies[index].personalizedText || active.replies[index].text) === text;
    };
    this.setData({ copiedReplyIndex: -1, copyError: "" });
    wx.setClipboardData({
      data: text,
      success: () => { if (current()) this.setData({ copiedReplyIndex: index, copyError: "" }); },
      fail: () => { if (current()) this.setData({ copyError: "复制未完成，可以长按回复文字复制。" }); }
    });
  },
  async personalize(event) {
    const index=Number(event.currentTarget.dataset.index), report=this.data.report, token=this._token, read=this._read;
    if(!report?.canPersonalize || this.data.rewriteBusy>=0 || !Number.isInteger(index) || !report.replies[index] || report.replies[index].rewriteIndex<0) return;
    const current=()=>{let session;try{session=wx.getStorageSync(api.STORAGE);}catch{return false;}return !this._unloaded && this._read===read && this._token===token && session?.token===token && session.expiresAt>Date.now() && this.data.report?.id===report.id;};
    if(!current())return;
    this.setData({rewriteBusy:index,copiedReplyIndex:-1,copyError:''});
    try {
      this._rewriteIds ||= {};
      const key=report.id+':'+report.replies[index].rewriteIndex;
      this._rewriteIds[key] ||= await api.newId();
      if(!current())return;
      const response=await api.request('/api/miniapp/rewrite','POST',{reportId:report.id,optionIndex:report.replies[index].rewriteIndex,confirmed:true,requestId:this._rewriteIds[key]},token);
      if(!current())return;
      if(!response.text || !response.status || !response.note)throw new Error('改写暂未完成，原推荐仍可使用。');
      if(this._riskPresentation && !riskReplyAllowed(this._riskPresentation,response.text))throw new Error('这条改写与当前风险提醒冲突，请保留原回复。');
      this.setData({report:{...this.data.report,replies:this.data.report.replies.map((item,i)=>i===index?{...item,personalizedText:response.status==='adjusted'?response.text:'',note:response.note,rewriteError:'',experienceEvidence:Array.isArray(response.experienceEvidence)?response.experienceEvidence:[]}:item)}});
    }catch(error){if(current())this.setData({report:{...this.data.report,replies:this.data.report.replies.map((item,i)=>i===index?{...item,rewriteError:error.message || '改写暂未完成。'}:item)}});}
    finally{if(!this._unloaded && this._read===read)this.setData({rewriteBusy:-1});}
  },
  onLoad(options) {
    this._unloaded = false;
    this._id = options.id || "";
    this.refresh();
  },
  onUnload() { this._unloaded = true; this._read = (this._read || 0) + 1; },
  onShow() {
    if (!this._token) return;
    let saved;
    try { saved=wx.getStorageSync(api.STORAGE); } catch { /* Refresh safely on unreadable session. */ }
    if (saved?.token!==this._token || !(saved.expiresAt>Date.now())) this.refresh();
  },
  async refresh() {
    if (!idPattern.test(this._id)) { this.setData({ phase: "error", error: "报告编号不正确。" }); return; }
    const read = this._read = (this._read || 0) + 1, id = this._id;
    let token = '';
    const current = () => {
      if (this._unloaded || this._read !== read || this._id !== id) return false;
      if (!token) return true;
      try { const saved=wx.getStorageSync(api.STORAGE); return saved?.token===token && saved.expiresAt>Date.now(); } catch { return false; }
    };
    this.setData({ phase: "loading", error: "", report: null, rewriteBusy: -1, showEvidence: false, showFitDetails: false, showLines: true, copiedReplyIndex: -1, copyError: "", followupError: "" });
    try {
      const session = await api.session();
      if (!current()) return;
      if (!session.token) throw new Error("请重新进入小程序完成微信登录。");
      token = session.token;
      this._token = token;
      if (!current()) return;
      const response = await api.request("/api/miniapp/report?id=" + id, "GET", null, token);
      if (!current()) return;
      if (!response.report || (response.report.id !== this._id && response.reportId !== this._id)) throw new Error("报告没有完整返回，请稍后重试。");
      const source = { ...response.report, id };
      const formatted = present(source);
      this._riskPresentation = riskAwarePresentation(importedReport(source));
      this.setData({ phase: "ready", report: formatted }, () => {
        if (!current()) return;
        if (formatted.affinity && formatted.affinity.radarReady && typeof wx.createCanvasContext === "function") this.drawRadar(formatted.affinity.dimensions);
      });
      if (response.report.subjectId) this.loadHistoricalTrend(response.report.subjectId, id, token, current);
    } catch (error) {
      if (!current()) return;
      if (error.status === 401) wx.removeStorageSync(api.STORAGE);
      this.setData({ phase: "error", error: error.message || "报告暂时无法打开。" });
    }
  },
  async loadHistoricalTrend(subjectId, reportId, token, current) {
    if (!current()) return;
    this.setData({'report.trendLoading':true});
    try {
      const profile=await api.request('/api/miniapp/profile','GET',null,token);
      if (!current() || this.data.report?.id!==reportId) return;
      if (!profile.enabled || profile.paused || !(profile.subjects || []).some(person=>person.id===subjectId)) {
        this.setData({'report.trendLoading':false,'report.trendNote':'当前人物档案未启用，暂不读取长期趋势。'}); return;
      }
      const trend=historicalTrend((profile.trends || []).find(item=>item.subjectId===subjectId)?.points,subjectId,reportId);
      this.setData({report:{...this.data.report,...trend,trendLoading:false}});
    } catch {
      if (current() && this.data.report?.id===reportId) this.setData({'report.trendLoading':false,'report.trendNote':'历史暂未取回，本次分析仍可查看。'});
    }
  },
  toggleReply(event) {
    const index = Number(event.currentTarget.dataset.index);
    const report = this.data.report;
    if (!report || !Number.isInteger(index) || index < 0 || index >= report.replies.length) return;
    this.setData({ report: { ...report, replies: report.replies.map((item, position) => position === index ? { ...item, expanded: !item.expanded } : item) } });
  },
  drawRadar(dimensions) {
    const context = wx.createCanvasContext("affinityRadar", this);
    const center = 130, radius = 91;
    const point = (index, fraction) => {
      const angle = -Math.PI / 2 + index * Math.PI / 3;
      return [center + Math.cos(angle) * radius * fraction, center + Math.sin(angle) * radius * fraction];
    };
    [0.25, 0.5, 0.75, 1].forEach(level => {
      context.beginPath();
      for (let index = 0; index < 6; index++) {
        const [x, y] = point(index, level);
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.closePath(); context.setStrokeStyle("#cddfea"); context.stroke();
    });
    for (let index = 0; index < 6; index++) {
      const [x, y] = point(index, 1);
      context.beginPath(); context.moveTo(center, center); context.lineTo(x, y);
      context.setStrokeStyle("#dceaf3"); context.stroke();
    }
    context.beginPath();
    dimensions.forEach((item, index) => {
      const [x, y] = point(index, item.value / 100);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.closePath(); context.setFillStyle("rgba(68, 168, 197, 0.22)"); context.fill();
    context.setStrokeStyle("#3296b5"); context.setLineWidth(2); context.stroke();
    context.draw();
  }
});
