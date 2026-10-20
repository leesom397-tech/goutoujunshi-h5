const api = require("../../lib/api");
const analysisEntry = require("../../lib/analysis-entry");
const {riskAwarePresentation}=require("../../lib/risk-aware-presentation");
const { drawRadar } = require("../../lib/radar");
const { openReportFollowup } = require("../../lib/followup-context");
const basicLabels = { ageRange: "年龄", city: "常住地", education: "学历", occupation: "职业", relationshipStatus: "婚恋状态", childrenPlan: "婚育想法", lifestyle: "生活方式" };

function previousExcerpt(result) {
  if (!result) return null;
  const short = (value, max) => typeof value === "string" ? value.slice(0, max) : "";
  const facts = rows => (rows || []).slice(0, 8).map(item => ({ title: short(item.title, 32), evidence: short(item.evidence, 120), meaning: short(item.meaning, 100) }));
  return {
    summary: short(result.summary, 180),
    visibleFacts: facts(result.visibleFacts),
    positives: facts(result.positives).slice(0, 3),
    cautions: facts(result.cautions).slice(0, 3),
    hypotheses: (result.hypotheses || []).slice(0, 2).map(item => ({ title: short(item.title, 40), evidence: short(item.evidence, 120), possibility: short(item.possibility, 140), alternative: short(item.alternative, 100), verify: short(item.verify, 100) })),
    riskSignals: (result.riskSignals || []).slice(0, 2).map(item => ({ category: short(item.category, 32), evidence: short(item.evidence, 120), check: short(item.check, 100), level: short(item.level, 2) })),
    fit: (result.fit || []).slice(0, 2).map(item => ({ dimension: short(item.dimension, 24), selfNeed: short(item.selfNeed, 90), evidence: short(item.evidence, 120), reading: short(item.reading, 100), conclusion: short(item.conclusion, 90), status: short(item.status, 3) })),
    profileBasics: (result.profileBasics || []).slice(0, 7).map(item => ({ field: short(item.field, 20), value: short(item.value, 70), evidence: short(item.evidence, 100) })),
    unknowns: (result.unknowns || []).slice(0, 5).map(item => short(item, 70)),
    questions: (result.questions || []).slice(0, 3).map(item => short(item, 90))
  };
}
function profileCandidates(result) {
  const facts = (result?.visibleFacts || []).slice(0, 8).map(item => ({ title: item.title, evidence: item.evidence }));
  const context = (result?.profileContext || []).slice(0, 4).map(item => ({ title: `${({ stage: "关系阶段", howMet: "认识方式", values: "价值观", boundaries: "边界" }[item.field] || item.field)}：${item.value}`, evidence: item.evidence }));
  return [...facts, ...context].slice(0, 12);
}
function fitRadarStyle(rows) {
  const values = (rows || []).slice(0, 6).map(item => item.status === "匹配" ? 90 : item.status === "有差异" ? 45 : item.status === "有冲突" ? 20 : item.status === "待了解" ? 0 : 65);
  while (values.length < 6) values.push(0);
  if (!values.some(Boolean)) return "";
  const points = values.map((value, index) => { const angle = -Math.PI / 2 + index * Math.PI / 3; const radius = 12 + value * .34; return `${(50 + Math.cos(angle) * radius).toFixed(1)}% ${(50 + Math.sin(angle) * radius).toFixed(1)}%`; });
  return `clip-path: polygon(${points.join(",")})`;
}
function decorateResult(result, totalCount) {
  const risk=riskAwarePresentation(result);result={...risk.viewReport,riskReview:risk.review};
  const opportunity = (result.commonPoints || [])[0] || (result.positives || [])[0];
  const concern = risk.priority?{meaning:risk.nextStep}:((result.riskSignals || [])[0] || (result.cautions || [])[0]);
  const nextQuestion = (result.questions || [])[0];
  result = { ...result,
    hypotheses: (result.hypotheses || []).map(item => ({ ...item, expanded: false })),
    hasHypothesisActions: (result.hypotheses || []).some(item => !!item.verify),
    hasPhotoClues: (result.photoClues || []).length > 0,
    hasKnowledgeSources: (result.knowledgeSources || []).length > 0,
    brief: [
      { label: "最值得了解", tone: "positive", text: opportunity ? opportunity.meaning || opportunity.title : "先从资料中明确写出的兴趣聊起，看看能否自然展开。" },
      { label: concern ? "最需要留意" : "下一步怎么做", tone: concern ? "caution" : "action", text: concern ? concern.check || concern.meaning || concern.category || concern.title : nextQuestion || "围绕一个共同话题交流，再用真实互动更新判断。" }
    ]
  };
  const counts = [{ label: "可见事实", count: (result.visibleFacts || []).length, tone: "fact" }, { label: "积极线索", count: (result.positives || []).length, tone: "positive" }, { label: "待留意", count: (result.cautions || []).length, tone: "caution" }, { label: "待核实", count: (result.unknowns || []).length, tone: "unknown" }];
  const maximum = Math.max(1, ...counts.map(item => item.count));
  return { ...result, fitScore: typeof result.fitScore === "number" ? result.fitScore : null, commonPoints: result.commonPoints || [], hasCommonPoints: (result.commonPoints || []).length > 0, fitRadarStyle: fitRadarStyle(result.fit), profileBasics: (result.profileBasics || []).map(item => ({ ...item, label: basicLabels[item.field] || item.field })), isChat: result.kind === "chat", isProfile: result.kind === "profile", hasProfileBasics: (result.profileBasics || []).length > 0, hasVisibleFacts: (result.visibleFacts || []).length > 0, hasPositives: (result.positives || []).length > 0, hasCautions: (result.cautions || []).length > 0, hasHypotheses: (result.hypotheses || []).length > 0, hasNextMaterials: (result.nextMaterials || []).length > 0, hasFit: (result.fit || []).length > 0, riskCount: (result.riskSignals || []).length, chart: counts.map(item => ({ ...item, width: Math.round(item.count / maximum * 100) })) };
}
function savedTaskId() { try { return api.pendingUpload?.("/api/miniapp/social-profile")?.taskId || (typeof wx.getStorageSync === "function" ? wx.getStorageSync("social-profile-task") : ""); } catch { return ""; } }
function saveTaskId(taskId) { try { if (typeof wx.setStorageSync === "function") wx.setStorageSync("social-profile-task", taskId); } catch { /* The page can still poll while open. */ } }
function clearTaskId() { try { if (typeof wx.removeStorageSync === "function") wx.removeStorageSync("social-profile-task"); } catch { /* Storage is optional. */ } }
function followupSummary(result, targetSelf) {
  const short = (value, max) => typeof value === "string" ? value.replace(/[\r\n]+/g, " ").slice(0, max) : "";
  const report = result.moments || result;
  const parts = [targetSelf ? "对象：我自己的资料展示。" : "对象：本次资料所属人物。", "以下是资料分析的暂时解释，不是已核实事实。", "总评：" + short(report.summary || result.summary, 130)];
  for (const item of (report.hypotheses || []).slice(0, 2)) {
    parts.push("待验证推测：" + short(item.title, 20) + "；" + short(item.possibility, 70), "依据：" + short(item.evidence, 55), "另一种可能：" + short(item.alternative, 45));
    if (item.verify) parts.push("可观察：" + short(item.verify, 35));
  }
  const approach = report.approach;
  if (approach) for (const [key, label] of [["attitude", "相处态度"], ["emotion", "情绪承接"], ["pace", "节奏"], ["avoid", "避免"], ["evidence", "建议依据"], ["adjustWhen", "何时调整"]]) {
    if (approach[key]) parts.push(label + "：" + short(approach[key], 35));
  }
  const facts = result.moments ? report.behaviorClues : result.visibleFacts;
  for (const item of (facts || []).slice(0, 2)) parts.push("可见材料：" + short(item.quote || item.title, 25) + "；" + short(item.evidence, 40));
  return parts.join("\n").slice(0, 1050);
}

Page({
  sessionCurrent(token=this._token) { try { const stored=wx.getStorageSync(api.STORAGE);return !this._unloaded&&!!token&&this._token===token&&stored?.token===token&&stored.expiresAt>Date.now(); } catch { return false; } },
  openSupplementResult(result){const url=analysisEntry.reportUrl(result?.reportId||result?.id);if(this.data.returnReportId&&url)wx.navigateTo({url});},
  returnToReport() { const url=analysisEntry.reportUrl(this.data.returnReportId);if(url)wx.navigateTo({url}); },
  async loadPrices() {
    const token = this._token;
    if (!token) return false;
    const read = this._priceRead = (this._priceRead || 0) + 1;
    this.setData({ pricesReady: false, priceError: "" });
    try {
      const value = await api.request(analysisEntry.CREDIT_PATH, "GET", null, token);
      if (!this.sessionCurrent(token) || read !== this._priceRead) return false;
      const prices = analysisEntry.validatePrices(value);
      this.setData({ prices, pricesReady: true, priceError: "" }); return true;
    } catch (error) { if (this.sessionCurrent(token) && read === this._priceRead) this.setData({ pricesReady: false, priceError: error.message || "价格暂未取回，请重试后再开始。" }); return false; }
  },

  async continueDiscussion() {
    const result = this.data.result;
    if (!result || this.data.busy || this.data.followupBusy) return;
    const subjectId = this.data.targetSelf ? "" : typeof result.subjectId === "string" ? result.subjectId : this._reportSubjectId || "";
    this.setData({ followupBusy: true, error: "" });
    try {
      await openReportFollowup({ source: result.moments ? "moments" : "social-profile", title: this.data.targetSelf ? "我的资料印象" : result.moments ? "朋友圈人物分析" : "社交资料分析", subjectId, token: this._token, reportId: result.reportId || result.id || "", summary: followupSummary(result, this.data.targetSelf) });
    } catch (error) { this.setData({ error: error.message || "追问页面暂未打开，请重试。" }); }
    finally { this.setData({ followupBusy: false }); }
  },
  toggleMomentsTimeline() { this.setData({showMomentsTimeline:!this.data.showMomentsTimeline}); },
  toggleMomentsDetails() { this.setData({showMomentsDetails:!this.data.showMomentsDetails}); },
  resetReportView() { return { showReportDetails: false, showFitDetails: false, showMomentsDetails: false, showMomentsTimeline: false }; },
  toggleUploadHelp() { this.setData({ showUploadHelp: !this.data.showUploadHelp }); },
  togglePrivacyDetails() { this.setData({ showPrivacyDetails: !this.data.showPrivacyDetails }); },
  previewImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    const images = this.data.images || [];
    if (!Number.isInteger(index) || !images[index]) return;
    wx.previewImage({ current: images[index].path, urls: images.map(item => item.path) });
  },
  jumpToSection(event) {
    if (!this.data.result || typeof wx.pageScrollTo !== "function") return;
    const section = event.currentTarget.dataset.section;
    const prefix = this.data.result.moments ? "moments" : "profile";
    const selectors = { findings: "#" + prefix + "-findings", actions: "#" + prefix + "-actions", evidence: this.data.result.moments ? "#moments-statistics" : "#social-evidence" };
    if (selectors[section]) wx.pageScrollTo({ selector: selectors[section], duration: 240 });
  },
  data: { phase: "loading", prices: null, pricesReady: false, priceError: "", busy: false, linkBusy: false, profileUrl: "", linkMessage: "", images: [], imageCount: 0, canAdd: true, completedCount: 0, totalCount: 0, canContinue: false, agreed: false, error: "", result: null, label: "", archiveConsent: false, archiveTogether: false, archiveBusy: false, archiveMessage: "", people: [{ id: "", label: "暂不归档" }], personIndex: 0, compareSelf: false, targetSelf: false, showUploadHelp: false, showPrivacyDetails: false, showReportDetails: false, showFitDetails: false, showMomentsDetails: false, showMomentsTimeline: false },
  onLoad(options = {}) { this._entry=analysisEntry.context(options);this._explicitSubject=this._entry.subjectId||'';this._savedReportId=analysisEntry.ID.test(options.reportId||'')?options.reportId:'';this.setData({returnReportId:this._entry.returnReportId||'',supplementLabel:'',materialType:options.materialType==='moments'?'moments':'profile'});if(options.target==='self'&&!this._entry.returnReportId)this.setData({targetSelf:true}); },
  async loadSavedReport() {
    if (this._readingSaved) return; this._readingSaved = true;
    const read=this._savedRead=(this._savedRead||0)+1;
    this.setData({ phase: 'loading', result: null, error: '' });
    try {
      const session = await api.session();if(this._unloaded||read!==this._savedRead)return;
      const token=this._token=session.token;
      const saved = await api.request('/api/miniapp/report?id=' + encodeURIComponent(this._savedReportId), 'GET', null, token);
      if (read!==this._savedRead || !this.sessionCurrent(token)) return;
      if (saved.reportId !== this._savedReportId || !saved.report || !['moments','social'].includes(saved.kind)) throw Error('这份资料报告暂时无法打开。');
      this._explicitSubject = saved.subjectId || ''; this._selectedSubject = this._explicitSubject;
      const people = [{ id: '', label: '暂不归档' }, ...(session.state?.subjects || [])];
      const parent=saved.report.supplementOf;
      const parentId=saved.report.analysisScope==='supplement'&&parent?.scope==='fullHistory'&&analysisEntry.ID.test(parent.reportId||'')&&analysisEntry.ID.test(saved.subjectId||'')?parent.reportId:'';
      const parentDate=parentId&&typeof parent.generatedAt==='string'?Date.parse(parent.generatedAt):NaN;
      this._entry=analysisEntry.context({subjectId:saved.subjectId||'',returnReportId:parentId});
      this.setData({returnReportId:parentId,supplementLabel:parentId?people.find(person=>person.id===saved.subjectId)?.label||'这位人物':'',parentGeneratedTime:Number.isFinite(parentDate)?new Date(parentDate+8*3600000).toISOString().slice(0,16).replace('T',' ')+'（北京时间）':''});
      this.setData({ phase: 'ready', result: decorateResult({ ...saved.report, reportId: saved.reportId }, saved.totalCount), people, personIndex: Math.max(0, people.findIndex(person => person.id === saved.subjectId)), materialType: saved.kind === 'moments' ? 'moments' : 'profile', totalCount: saved.totalCount || 0, targetSelf: saved.targetSelf === true });
    } catch (error) { if (!this._unloaded&&read===this._savedRead) this.setData({ phase: 'error', error: error.message || '报告暂时无法打开，请稍后回来。' }); }
    finally { if(read===this._savedRead)this._readingSaved = false; }
  },
  materialChange(event) { if(this.data.busy || this.data.backgroundPending) return; this._previousResult=null; this.setData({...this.resetReportView(),materialType:event.currentTarget.dataset.type === "moments" ? "moments" : "profile",result:null,completedCount:0,canContinue:false,agreed:false}); },
  onHide() { this._hiddenAt = Date.now(); this._hidden = true; },
  onUnload() { this._unloaded = true; this._hidden = true; },
  resumeAfterReturn() { if (this._resumeWhenIdle && !this._hidden && this.data.backgroundPending && !this._unloaded) { this._resumeWhenIdle = false; this.resumeAnalysis(); } },
  async onShow() {
    this._hidden = false;
    if(this._token&&!this.sessionCurrent()){
      this._savedRead=(this._savedRead||0)+1;this._showRead=(this._showRead||0)+1;this._token='';this._loaded=false;this._refreshing=false;this._readingSaved=false;this._polling=false;this._pollPromise=null;this._previousResult=null;this._reportSubjectId='';this._resumeWhenIdle=false;
      this._explicitSubject=this._entry?.subjectId||'';this._selectedSubject='';
      this.setData({...this.resetReportView(),phase:'loading',result:null,analysisPreview:null,people:[{id:'',label:'暂不归档'}],personIndex:0,supplementLabel:'',parentGeneratedTime:'',images:[],imageCount:0,completedCount:0,totalCount:0,agreed:false,busy:false,backgroundPending:false,prices:null,pricesReady:false,archiveConsent:false,archiveTogether:false,archiveMessage:'',label:'',error:''});
    }
    if (this._savedReportId) return this.loadSavedReport();
    if (this.data.busy) { this._resumeWhenIdle = true; return; }
    const requestedSubject = this._explicitSubject || "";
    if (this._loaded && this.data.phase === "ready" && !savedTaskId() && requestedSubject === (this._selectedSubject || "")) { this.loadPrices(); return; }
    if (this._refreshing) return;
    this._refreshing = true;
    const read=this._showRead=(this._showRead||0)+1;
    try {
      const session = await api.session();
      if(this._unloaded||read!==this._showRead)return;
      const token=this._token=session.token;
      this.loadPrices();
      const people = [{ id: "", label: "暂不归档" }, ...(session.state?.subjects || [])];
      const supplement=await analysisEntry.verifyContext(this._entry||{},api,this._token,people);
      if(read!==this._showRead||!this.sessionCurrent(token))return;
      this.setData({supplementLabel:supplement?.label||''});
      const selected = requestedSubject;
      const index = Math.max(0, people.findIndex(item => item.id === selected));
      const previousId = this.data.people[this.data.personIndex]?.id || "";
      const selectedId = people[index]?.id || "";
      if (previousId !== selectedId && (this.data.completedCount || this.data.totalCount)) {
        this._previousResult = null;
        this.setData({ ...this.resetReportView(), phase: "ready", people, personIndex: index, completedCount: 0, totalCount: 0, result: null, images: [], imageCount: 0, canAdd: true, canContinue: false, agreed: false, archiveConsent: false, archiveTogether: false, archiveMessage: "", error: "当前对象已变化，请重新选择这位对象的资料图。" });
      } else this.setData({ phase: "ready", people, personIndex: index, compareSelf: !this.data.targetSelf, error: "" });
      this._selectedSubject = selected;
      this._loaded = true;
    }
    catch (error) { if(!this._unloaded&&read===this._showRead){if (this.data.phase !== "ready") this.setData({ phase: "error", error: error.message || "网络暂时不稳定，请点重试；已选图片和报告不会丢失。" }); else this.setData({ error: error.message || "网络暂时不稳定，当前页面已保留。" });} }
    finally { if(read===this._showRead){this._refreshing = false; const taskId = savedTaskId(); if (this.data.phase==='ready'&&this.sessionCurrent()&&taskId&&!this.data.result) { this._resumeTask(taskId); }} }
  },
  resumeAnalysis() { const taskId = savedTaskId(); if (taskId && !this.data.busy) return this._resumeTask(taskId); },
  cancelAnalysis() {
    const pending = api.pendingUpload?.("/api/miniapp/social-profile");
    if (!pending || this.data.busy) return;
    wx.showModal({ title: "取消本次上传？", content: "只删除本次临时上传，不删除人物档案。已启动的后台分析不能在这里取消。", success: async result => {
      if (!result.confirm || this.data.busy) return;
      this.setData({ busy: true });
      try { await api.cancelUpload(pending.taskId, this._token); clearTaskId(); this.setData({ backgroundPending: false, error: "", agreed: false }); }
      catch (error) { this.setData({ error: error.message }); }
      finally { this.setData({ busy: false }); }
    } });
  },
  jobStatus(state) { if (["queued", "running"].includes(state.status)) this.setData({ taskStage: "running" }); else if (state.status === "uploading") this.setData({ taskStage: "uploading", uploadProgress: `已上传 ${state.received}/${state.total} 张` }); },
  async _resumeTask(taskId) {
    if (this._polling) return;
    const token=this._token,current=()=>this.sessionCurrent(token);if(!current())return;
    const pendingContext=api.pendingUpload?.('/api/miniapp/social-profile');
    if(this.data.returnReportId&&(!pendingContext||pendingContext.subjectId!==this._entry?.subjectId||pendingContext.parentReportId!==this.data.returnReportId)){this.setData({error:'另有一组资料任务尚未完成，请先从首页“接着上次”查看。'});return;}
    this._polling = true;
    this.setData({ busy: true, taskStage: "checking", backgroundPending: true, error: "" });
    try {
      const pending = api.pendingUpload?.("/api/miniapp/social-profile");
      this._reportSubjectId = pending?.taskId === taskId ? pending.subjectId || "" : "";
      if (pending?.taskId === taskId) {
        await api.resumeUpload(taskId, token, state => {if(current())this.jobStatus(state);});
        if(!current())return;
        const index = Math.max(0, this.data.people.findIndex(person => person.id === pending.subjectId));
        this.setData({ personIndex: index });
        this._explicitSubject = this.data.people[index]?.id || "";if(this._entry?.subjectId)this._entry.subjectId=this._explicitSubject;
      }
      const result = await this._pollTask(taskId,token);
      if (!current()) return;
      clearTaskId(); await api.finishUpload?.(taskId);
      if(!current())return;
      this.setData({ canContinue: false, result: decorateResult(result, this.data.totalCount), error: "" });this.openSupplementResult(result);
    } catch (error) {
      if(!current())return;
      if (error.status === 410) { clearTaskId(); await api.finishUpload?.(taskId); }
      this.setData({ error: error.message || "后台识图未完成，请重试。" });
    } finally { if(current()){this._polling = false; this.setData({ busy: false, backgroundPending: !!savedTaskId() }, () => this.renderFit()); this.resumeAfterReturn();} }
  },
  _pollTask(taskId,token=this._token) { if (this._pollPromise && this._pollTaskId === taskId&&this._pollToken===token) return this._pollPromise; this._pollTaskId = taskId;this._pollToken=token;const promise=this._readTask(taskId,token).finally(() => { if(this._pollPromise===promise)this._pollPromise=null; });this._pollPromise=promise;return promise; },
  async _readTask(taskId,token=this._token) {
    for (let i = 0; i < 120; i++) {
      if(!this.sessionCurrent(token))throw Error('账号已变化，本次结果保留在原账号。');
      let state;
      try { state = await api.request("/api/miniapp/social-profile?taskId=" + encodeURIComponent(taskId), "GET", null, token); }
      catch (error) { if(!this.sessionCurrent(token))throw error;if (error.status === 401 || error.status === 404) { if (error.status === 404) { clearTaskId(); await api.finishUpload?.(taskId); } throw error; } await new Promise(resolve => setTimeout(resolve, 3000)); continue; }
      if(!this.sessionCurrent(token))throw Error('账号已变化，本次结果保留在原账号。');
      if (["running", "queued"].includes(state.status)) this.setData({ taskStage: "running", uploadProgress:state.phase === "summarize" ? "图片识别完成，正在整理人物评价与报告" : state.phase === "extract" ? `已识别 ${state.recognizedCount || 0}/${state.imageCount} 张，进度已保存${state.retryAt ? ' · 当前步骤重试中' : ''}` : "", analysisPreview:state.preview || null });
      if (state.status === "done") { this.setData({ analysisPreview:null, targetSelf: state.target === "self", compareSelf: state.compareWithSelf === true, totalCount: state.totalCount || this.data.imageCount }); return state.result; }
      if (state.status === "error" || state.status === "expired") { clearTaskId(); await api.finishUpload?.(taskId); throw new Error(state.error || "后台识图未完成。"); }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error("资料仍在后台处理中，稍后回到本页即可查看。");
  },
  renderFit() { if (!this.data.compareSelf || !(this.data.result?.fitCoverage > 0)) return; drawRadar(this, "fitRadar", (this.data.result.fit || []).slice(0, 6), ["年龄阶段", "见面距离", "教育经历", "职业交集", "婚恋目标", "生活方式"]); },
  toggleFitDetails() { this.setData({ showFitDetails: !this.data.showFitDetails }); },
  toggleReportDetails() { this.setData({ showReportDetails: !this.data.showReportDetails }); },
  toggleHypothesis(event) {
    const index = Number(event.currentTarget.dataset.index);
    const result = this.data.result;
    if (!result || !Number.isInteger(index) || index < 0 || index >= (result.hypotheses || []).length) return;
    this.setData({ result: { ...result, hypotheses: result.hypotheses.map((item, position) => position === index ? { ...item, expanded: !item.expanded } : item) } });
  },
  startNewProfile() { if (this.data.busy) return; this._previousResult = null; this._explicitSubject = this._entry?.subjectId || ""; this._selectedSubject = this._explicitSubject; this.setData({ ...this.resetReportView(), result: null, images: [], imageCount: 0, completedCount: 0, totalCount: 0, canAdd: true, canContinue: false, personIndex: this._entry?.subjectId ? Math.max(0,this.data.people.findIndex(person=>person.id===this._entry.subjectId)) : 0, agreed: false, archiveConsent: false, archiveTogether: false, archiveMessage: "", label: "", error: "" }); },
  personChange(event) {
    if (this.data.busy || this.data.returnReportId) return;
    const index = Number(event.detail.value) || 0;
    if (index < 0 || index >= this.data.people.length) return;
    this._explicitSubject = this.data.people[index]?.id || "";if(this._entry?.subjectId)this._entry.subjectId=this._explicitSubject;
    if (index !== this.data.personIndex && (this.data.completedCount || this.data.totalCount)) {
      this._previousResult = null;
      this.setData({ ...this.resetReportView(), personIndex: index, completedCount: 0, totalCount: 0, result: null, images: [], imageCount: 0, canAdd: true, canContinue: false, agreed: false, archiveConsent: false, archiveTogether: false, archiveMessage: "", error: "已切换对象，请重新选择这位对象的资料图。" });
      return;
    }
    this.setData({ personIndex: index, archiveConsent: false, archiveTogether: false, archiveMessage: "" });
  },
  targetChange(event) { if (this.data.busy || this.data.returnReportId) return; const targetSelf = event.currentTarget.dataset.target === "self";if(targetSelf&&this._entry){this._entry.subjectId="";this._explicitSubject="";} this._previousResult = null; this.setData({ ...this.resetReportView(), targetSelf, compareSelf: !targetSelf, completedCount: 0, totalCount: 0, result: null, archiveMessage: "", archiveConsent: false, archiveTogether: false, agreed: false, images: [], imageCount: 0, canAdd: true, canContinue: false }); },
  archiveTogetherChange(event) { this.setData({ archiveTogether: event.detail.value.includes("yes") }); },
  compareChange(event) { if (this.data.busy) return; this.setData({ compareSelf: event.detail.value.includes("yes"), result: null, agreed: false }); },
  profileUrlInput(event) { this.setData({ profileUrl: event.detail.value, linkMessage: "", error: "" }); },
  toggleLinkImport() { if (!this.data.busy && !this.data.linkBusy) this.setData({ showLinkImport: !this.data.showLinkImport }); },
  linkAgree(event) { if (!this.data.linkBusy) this.setData({ linkConsent: event.detail.value.includes("yes") }); },
  async analyzeProfileLink() {
    if (this.data.busy || this.data.backgroundPending) return;
    const url = this.data.profileUrl.trim();
    if (this.data.linkBusy || !url) { this.setData({ error: "先粘贴小红书或抖音的公开主页链接。" }); return; }
    if (!this.data.linkConsent) { this.setData({ error: "请先确认读取公开主页并建立人物档案。" }); return; }
    if (!this.data.pricesReady) { this.setData({ error: "请先重试读取主页分析价格。" }); return; }
    this.setData({ linkBusy: true, error: "", linkMessage: "正在读取公开主页…" });
    try {
      this._linkRequestId ||= await api.newId();
      const result = await api.request("/api/miniapp/social-link", "POST", { url, confirmed: true, requestId: this._linkRequestId }, this._token);
      const session = await api.session();
      const people = [{ id: "", label: "暂不归档" }, ...(session.state?.subjects || [])];
      this._linkRequestId = null; this.setData({ people, personIndex: Math.max(0, people.findIndex(item => item.id === result.subjectId)), linkMessage: result.message || "已建立对象档案，请到档案页确认资料。", profileUrl: "" });
    } catch (error) { this.setData({ error: error.message || "主页分析未完成，请改用截图。", linkMessage: "" }); }
    finally { this.setData({ linkBusy: false }); }
  },
  choose() {
    if (this.data.busy) return;
    const remaining = Math.min(9 - this.data.images.length, 9 - this.data.completedCount - this.data.images.length);
    if (remaining <= 0) { this.setData({ error: "最多选择 9 张；可先移除不需要的图片。" }); return; }
    wx.chooseMedia({ count: remaining, mediaType: ["image"], sourceType: ["album"], sizeType: ["original", "compressed"], success: async value => {
      try {
        const additions = [];
        for (const item of value.tempFiles || []) additions.push(await this.prepareImage(item));
        if (!additions.length) return;
        const images = [...this.data.images, ...additions].map((item, index) => ({ ...item, display: `第 ${index + 1} 张 · ${item.label}` }));
        if (images.reduce((total, item) => total + item.size, 0) > 36000000) throw new Error("这批图片压缩后合计仍超过 36 MB，请移除一张后重试。");
        this.setData({ images, imageCount: images.length, canAdd: images.length < 9, agreed: false, result: null, error: "", archiveMessage: "", label: "", archiveConsent: false });
      } catch (error) { this.setData({ error: error.message || "图片读取失败，请重试。" }); }
    } });
  },
  async prepareImage(item) {
    if (!item?.tempFilePath) throw new Error("图片没有读取成功，请重新选择。");
    let path = item.tempFilePath;
    let size = Number(item.size) || 0;
    if (!size) {
      if (typeof wx.getFileInfo !== "function") throw new Error("无法确认图片大小，请重新选择。");
      const info = await new Promise((resolve, reject) => wx.getFileInfo({ filePath: path, success: resolve, fail: reject }));
      size = Number(info.size) || 0;
      if (!size) throw new Error("无法确认图片大小，请重新选择。");
    }
    if (size > 12000000) throw new Error("这张原图超过 12 MB，请先裁掉无关区域再选择。");
    const originalSize = size;
    let imageInfo = await new Promise((resolve, reject) => wx.getImageInfo({ src: path, success: resolve, fail: reject }));
    const needsPixelReduction = Number(imageInfo.width) * Number(imageInfo.height) > 16000000;
    if (size > 1500000 || needsPixelReduction) {
      if (typeof wx.compressImage !== "function" || typeof wx.getFileInfo !== "function") throw new Error("当前微信无法压缩这张图，请裁掉无关区域后再选。");
      for (const [width, quality] of [[2600, 88], [2200, 82], [1800, 76], [1500, 68]]) {
        const dimension = Number(imageInfo.height) > Number(imageInfo.width) ? { compressedHeight: width } : { compressedWidth: width };
        const compressed = await new Promise((resolve, reject) => wx.compressImage({ src: path, quality, ...dimension, success: resolve, fail: reject }));
        path = compressed.tempFilePath;
        const info = await new Promise((resolve, reject) => wx.getFileInfo({ filePath: path, success: resolve, fail: reject }));
        size = Number(info.size) || 0;
        if (!size) throw new Error("无法确认压缩后图片的大小，请重新选择。");
        imageInfo = await new Promise((resolve, reject) => wx.getImageInfo({ src: path, success: resolve, fail: reject }));
        if (size <= 1500000 && !(Number(imageInfo.width) * Number(imageInfo.height) > 16000000)) break;
      }
      if (size > 1500000) throw new Error("这张图压缩后仍过大，请裁掉无关区域再选。");
      if (Number(imageInfo.width) * Number(imageInfo.height) > 16000000) throw new Error("这张截图像素仍过高，请裁掉无关区域后再选。");
    }
    const type = String(imageInfo.type || "").toLowerCase();
    if (!["jpg", "jpeg", "png"].includes(type)) throw new Error("只支持 JPG 或 PNG 截图。");
    return { path, type: type === "png" ? "png" : "jpeg", size, originalSize, label: (size / 1000000).toFixed(1) + " MB" + (size < originalSize ? " 已压缩" : "") };
  },
  removeImage(event) {
    if (this.data.busy) return;
    const index = Number(event.currentTarget.dataset.index);
    const images = this.data.images.filter((_, position) => position !== index).map((item, position) => ({ ...item, display: `第 ${position + 1} 张 · ${item.label}` }));
    this.setData({ images, imageCount: images.length, canAdd: true, agreed: false, result: null, error: "", archiveMessage: "", archiveConsent: false });
  },
  agree(event) { this.setData({ agreed: event.detail.value.includes("yes") }); },
  labelInput(event) { this.setData({ label: event.detail.value }); },
  archiveAgree(event) { this.setData({ archiveConsent: event.detail.value.includes("yes") }); },
  async analyze() {
    const token=this._token,current=()=>this.sessionCurrent(token),update=(value,done)=>{if(current())this.setData(value,done);};
    if(!current())return;
    if (savedTaskId() && !this.data.busy) { await this._resumeTask(savedTaskId()); return; }
    if (this.data.busy || !this.data.imageCount) { update({ error: "先选择一张或多张资料截图。" }); return; }
    if (!this.data.agreed) { update({ error: "请先确认你有权提供这些资料并同意本次识图。" }); return; }
    if (savedTaskId()) return this._resumeTask(savedTaskId());
    if (!this.data.pricesReady) { update({ error: "请先重试读取本次价格，再开始分析。" }); return; }
    this._reportSubjectId = this.data.targetSelf ? "" : this.data.people[this.data.personIndex]?.id || "";
    if(this._entry?.subjectId&&this._reportSubjectId!==this._entry.subjectId){update({error:'人物已变化，请从原报告重新进入。'});return;}
    const priceConfirmation=analysisEntry.screenshotQuote(this.data.imageCount,this.data.prices),parentReportId=this.data.returnReportId||undefined;
    update({ ...this.resetReportView(), busy: true, taskStage: "uploading", backgroundPending: false, error: "", result: null, analysisPreview:null, uploadProgress:"" });
    try {
      if (api.createUpload) {
        const previous = this._previousResult ? { ...this._previousResult, fit: this.data.compareSelf ? this._previousResult.fit : [] } : null;
        const queued = await api.createUpload("/api/miniapp/social-profile", this.data.images, { materialType:this.data.materialType, confirmed: true, priceConfirmation, parentReportId, target: this.data.targetSelf ? "self" : "other", compareWithSelf: !this.data.targetSelf && this.data.compareSelf, previous, previousCount: this.data.completedCount, subjectId: this.data.targetSelf ? null : this.data.people[this.data.personIndex]?.id || null }, token);
        if(!current())return;
        saveTaskId(queued.taskId);
        await api.resumeUpload(queued.taskId, token, state => {if(current())this.jobStatus(state);});
        const result = await this._pollTask(queued.taskId,token);
        if (!current()) return;
        clearTaskId(); await api.finishUpload?.(queued.taskId);if(!current())return;
        update({ canContinue: false, result: decorateResult(result, this.data.totalCount) });this.openSupplementResult(result);return;
      }
      const images = [];
      for (const item of this.data.images) images.push(await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: item.path, encoding: "base64", success: value => resolve("data:image/" + item.type + ";base64," + value.data), fail: reject })));
      const previous = this._previousResult ? { ...this._previousResult, fit: this.data.compareSelf ? this._previousResult.fit : [] } : null;
      const taskId = typeof api.newId === "function" ? await api.newId() : undefined;
      if(!current())return;
      if (taskId) saveTaskId(taskId);
      const submitted = await api.request("/api/miniapp/social-profile", "POST", { materialType:this.data.materialType, taskId, images, confirmed: true, priceConfirmation, parentReportId,subjectId:this._reportSubjectId||null, target: this.data.targetSelf ? "self" : "other", compareWithSelf: !this.data.targetSelf && this.data.compareSelf, previous, previousCount: this.data.completedCount }, token);
      if(!current())return;
      if (submitted.status === "running") { this._taskId = submitted.taskId; saveTaskId(submitted.taskId); update({ taskStage: "running" }); const result = await this._pollTask(submitted.taskId,token);if(!current())return;clearTaskId();this.openSupplementResult(result); return update({ totalCount: this.data.completedCount + images.length, canContinue: false, result: decorateResult(result, this.data.completedCount + images.length) }); }
      const result = submitted;this.openSupplementResult(result);
      clearTaskId();
      const totalCount = this.data.completedCount + images.length;
      const counts = [
        { label: "可见事实", count: (result.visibleFacts || []).length, tone: "fact" },
        { label: "积极线索", count: (result.positives || []).length, tone: "positive" },
        { label: "待留意", count: (result.cautions || []).length, tone: "caution" },
        { label: "待核实", count: (result.unknowns || []).length, tone: "unknown" }
      ];
      const maximum = Math.max(1, ...counts.map(item => item.count));
      update({ totalCount, canContinue: totalCount < 9, result: decorateResult(result, totalCount) });
    } catch (error) { if(!current())return; if(analysisEntry.isPriceError(error)){const pending=api.pendingUpload?.("/api/miniapp/social-profile");if(pending)await api.finishUpload?.(pending.taskId);clearTaskId();update({agreed:false});await this.loadPrices();} if (savedTaskId() && (error.network || error.status >= 500)) { await this._resumeTask(savedTaskId()); } else { if (error.status && error.status < 500) clearTaskId(); update({ error: error.message || "本次分析未完成。" }); } }
    finally { update({ busy: false, backgroundPending: !!savedTaskId() }, () => this.renderFit()); if(current())this.resumeAfterReturn(); }
  },
  nextBatch() {
    if (this.data.busy || !this.data.result || !this.data.canContinue) return;
    this._previousResult = previousExcerpt(this.data.result);
    this.setData({ completedCount: this.data.totalCount, images: [], imageCount: 0, canAdd: true, canContinue: false, agreed: false, result: null, error: "", archiveMessage: "", label: "", archiveConsent: false, archiveTogether: false });
  },
  async createArchive() {
    const name = this.data.label.trim();
    if (this.data.archiveBusy || !this.data.result) return;
    if (!name || name.length > 60) { this.setData({ error: "请给这位对象填写 60 字以内的称呼。" }); return; }
    if (!this.data.archiveConsent) { this.setData({ error: "请先同意建立人物档案。" }); return; }
    const candidates = profileCandidates(this.data.result);
    if (this.data.archiveTogether && !candidates.length) { this.setData({ error: "这组截图没有可保存的文字线索；请补清晰的个人资料页。" }); return; }
    this.setData({ archiveBusy: true, error: "" });
    try {
      let state = await api.request("/api/miniapp/profile", "GET", null, this._token);
      if (!state.enabled || state.paused) state = await api.request("/api/miniapp/profile", "POST", { action: "consent", enabled: true }, this._token);
      const existing = new Set((state.subjects || []).map(item => item.id));
      const created = await api.request("/api/miniapp/profile", "POST", { action: "create", label: name }, this._token);
      const person = (created.subjects || []).find(item => !existing.has(item.id));
      if (!person) throw new Error("档案状态未确认，请到人物档案查看。 ");
      const people = [{ id: "", label: "暂不归档" }, ...(created.subjects || [])];
      api.setCurrentSubject?.(person.id);
      this.setData({ people, personIndex: people.findIndex(item => item.id === person.id) });
      if (this.data.archiveTogether) {
        const basics = [...(this.data.result.profileBasics || []).slice(0, 7), ...(!this.data.targetSelf ? this.data.result.profileContext || [] : [])].map(item => ({ field: item.field, value: item.value, evidence: item.evidence }));
        await api.request("/api/miniapp/profile", "POST", { action: "import-social", communicationReading:this.data.result.moments ? null : {summary:this.data.result.summary,hypotheses:this.data.result.hypotheses,approach:this.data.result.approach}, momentsReport:this.data.result.moments, target: "subject", subjectId: person.id, confirmed: true, candidates, basics }, this._token);
        this._reportSubjectId = person.id;
        this.setData({ people, personIndex: people.findIndex(item => item.id === person.id), archiveMessage: "已同时建立档案并归档本组截图线索；原图未长期保存。", archiveConsent: false, archiveTogether: false });
      } else this.setData({ people, personIndex: people.findIndex(item => item.id === person.id), archiveMessage: "对象已建立；如需记住本组截图线索，请再确认归档。", archiveConsent: false, archiveTogether: false });
    } catch (error) { this.setData({ error: this.data.people[this.data.personIndex]?.id ? "档案已建立，但线索归档失败；请在下方点‘归档线索’重试。" : error.message || "建档未完成，请重试。" }); }
    finally { this.setData({ archiveBusy: false }); }
  },
  async saveClues() {
    const person = this.data.people[this.data.personIndex];
    if (this.data.archiveBusy || !this.data.result || !this.data.targetSelf && !person?.id) { this.setData({ error: "先选择一位已有档案的对象。" }); return; }
    if (!this.data.archiveConsent) { this.setData({ error: "请先确认把这组截图的可见线索归到所选对象。" }); return; }
    this.setData({ archiveBusy: true, error: "" });
    try {
      const candidates = profileCandidates(this.data.result);
      const basics = [...(this.data.result.profileBasics || []).slice(0, 7), ...(!this.data.targetSelf ? this.data.result.profileContext || [] : [])].map(item => ({ field: item.field, value: item.value, evidence: item.evidence }));
      if (!candidates.length && !basics.length) throw new Error("这组截图没有可保存的文字线索；请补清晰的个人资料页。");
      if (this.data.targetSelf) {
        const state = await api.request("/api/miniapp/profile", "GET", null, this._token);
        if (!state.enabled || state.paused) await api.request("/api/miniapp/profile", "POST", { action: "consent", enabled: true }, this._token);
      }
      await api.request("/api/miniapp/profile", "POST", { action: "import-social", communicationReading:this.data.result.moments ? null : {summary:this.data.result.summary,hypotheses:this.data.result.hypotheses,approach:this.data.result.approach}, momentsReport:this.data.result.moments, target: this.data.targetSelf ? "self" : "subject", subjectId: this.data.targetSelf ? null : person.id, confirmed: true, candidates, basics }, this._token);
      this._reportSubjectId = this.data.targetSelf ? "" : person.id;
      this.setData({ archiveMessage: this.data.targetSelf ? "已建立我的档案，基础信息和截图线索待逐条确认；原图未长期保存。" : "已把可见线索放入该对象的待核对区；原图未长期保存。", archiveConsent: false });
    } catch (error) { this.setData({ error: error.message || "线索归档未完成。" }); }
    finally { this.setData({ archiveBusy: false }); }
  },
  openArchive() { const person = this.data.people[this.data.personIndex]; wx.navigateTo({ url: "/pages/archive/index?tab=" + (this.data.targetSelf ? "self" : "people") + (person && person.id && !this.data.targetSelf ? "&subjectId=" + encodeURIComponent(person.id) : "") }); },
  openChatScreenshot() { wx.navigateTo({ url: "/pages/quick/index" }); }
});
