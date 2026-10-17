const api = require("../../lib/api");
const { buildPersonComparison } = require("../../lib/person-comparison");
const { drawRadar, drawTrend } = require("../../lib/radar");
const basicLabels = { ageRange: "年龄", city: "常住地", education: "学历", occupation: "职业", relationshipStatus: "婚恋状态", childrenPlan: "婚育想法", lifestyle: "生活方式" };
const subjectBasics = (item, facts = []) => {
  if (!item) return [];
  // Profile API returns newest first. Keep the first usable clue for each field;
  // Map(array) would overwrite it with older evidence from the same field.
  const factMap = new Map();
  for (const fact of facts) {
    if (!['accepted', 'pending'].includes(fact.status) || !String(fact.kind || '').startsWith('subjectBasic:') || !String(fact.value || '').trim()) continue;
    const key = String(fact.kind).slice(13);
    if (!factMap.has(key)) factMap.set(key, fact);
  }
  const value = (field, fallback = "待了解") => item[field] || (factMap.get(field)?.status === "pending" ? `待确认 · ${factMap.get(field).value}` : factMap.get(field)?.value) || fallback;
  return [{ label: "年龄", value: value("ageRange") }, { label: "常住地", value: value("city") }, { label: "学历", value: value("education") }, { label: "职业", value: value("occupation") }, { label: "婚恋状态", value: value("relationshipStatus") }, { label: "婚育想法", value: value("childrenPlan") }, { label: "生活方式", value: value("lifestyle") }, { label: "关系阶段", value: item.stage || "未填写" }, { label: "认识方式", value: item.howMet || "未填写" }, { label: "明确价值观", value: item.values || "未填写" }, { label: "明确边界", value: item.boundaries || "未填写" }, { label: "我的备注", value: item.notes || "未填写" }];
};
const signalChart = signal => (signal?.dimensions || []).slice(0, 6).map(item => ({ ...item, valueText: item.value == null ? "待了解" : `${item.value}`, width: item.value == null ? 0 : Math.max(0, Math.min(100, Number(item.value))) }));
const radarStyle = signal => {
  const values = (signal?.dimensions || []).slice(0, 6).map(item => typeof item.value === "number" ? Math.max(0, Math.min(100, item.value)) : 0);
  if (values.length < 3) return "";
  const points = values.map((value, index) => { const angle = -Math.PI / 2 + index * Math.PI / 3; const radius = 12 + value * .34; return `${(50 + Math.cos(angle) * radius).toFixed(1)}% ${(50 + Math.sin(angle) * radius).toFixed(1)}%`; });
  return `clip-path: polygon(${points.join(",")})`;
};
const hasChartValue = rows => (rows || []).some(row => {
  const value = typeof row.value === "number" ? row.value : row.score;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
});
const detailExperience = (subject, chart, trend) => {
  const dated = trend.filter(point => point.eventStart).slice().sort((a, b) => String(a.eventEnd || a.eventStart).localeCompare(String(b.eventEnd || b.eventStart)));
  const recent = dated.length ? dated[dated.length - 1] : trend[trend.length - 1];
  return {
    hasFitRadar: !!subject && hasChartValue(subject.compatibility && subject.compatibility.fit),
    hasInteractionRadar: hasChartValue(chart),
    hasTrendChart: dated.some(point => typeof point.score === "number" && Number.isFinite(point.score)),
    selectedRecentChange: recent ? recent.changeSummary || recent.summary || "" : "",
    selectedRecentDate: recent ? recent.dateLabel || recent.label || "日期待确认" : "",
    selectedRecentLabel: recent && recent.changeSummary ? "近期变化" : "最近记录"
  };
};

Page({
  openComparisonEntry(){this.setData({archiveTab:"people",selectedId:"",comparisonOnly:true,showComparison:true});if(this._lastState)this.apply(this._lastState);wx.pageScrollTo?.({scrollTop:0,duration:200});},
  openPeopleEntry(){this.setData({archiveTab:"people",selectedId:"",comparisonOnly:false});if(this._lastState)this.apply(this._lastState);},
  openSelfEntry(){wx.navigateTo({url:"/pages/archive/index?tab=self&quick=1"});},
  async saveQuickSelf(event){if(event.detail.confirmed!==true||this.data.busy||this.data.paused)return;await this.action({action:"self",data:event.detail.data});if(!this.data.error){this.selectComponent?.("#quick-self")?.reset();wx.showToast?.({title:"我的资料已更新",icon:"success"});}},
  toggleManualFeedback(){this.setData({showManualFeedback:!this.data.showManualFeedback});},
  openSelectedQuick(){if(!this.data.selectedId)return;api.setCurrentSubject?.(this.data.selectedId);wx.navigateTo({url:"/pages/quick/index?subjectId="+encodeURIComponent(this.data.selectedId)});},
  toggleComparison() { this.setData({ showComparison: !this.data.showComparison }); },
  toggleComparisonDetails() { this.setData({ comparisonDetailed: !this.data.comparisonDetailed }); },
  changeComparison(event) {
    const view = buildPersonComparison(this._lastState || {}, this.data.comparisonIds || []);
    const id = event.currentTarget.dataset.id;
    if (!view.choices.some(person => person.id === id)) return;
    const next = view.ids.includes(id) ? view.ids.filter(value => value !== id) : view.ids.length < 3 ? [...view.ids, id] : view.ids;
    this.updateComparison(this._lastState || {}, next);
  },
  updateComparison(state, ids = this.data.comparisonIds || []) {
    const comparison = buildPersonComparison(state, ids);
    this.setData({ comparisonIds: comparison.ids, comparison, comparisonWidth: `${190 + comparison.count * 400}rpx` });
  },
  openComparisonPerson(event) { const id = event.currentTarget.dataset.id; if ((this._lastState?.subjects || []).some(person => person.id === id)) wx.navigateTo({ url: `/pages/archive/index?subjectId=${encodeURIComponent(id)}` }); },
  openComparisonSource(event) { const id = event.currentTarget.dataset.id; if (id) wx.navigateTo({ url: `/pages/report/index?id=${encodeURIComponent(id)}` }); },
  toggleAvatar(){this.setData({showAvatarPicker:!this.data.showAvatarPicker});},
  toggleMomentsTimeline() { this.setData({showMomentsTimeline:!this.data.showMomentsTimeline}); },
  toggleMomentsDetails() { this.setData({showMomentsDetails:!this.data.showMomentsDetails}); },
  data: { phase: "loading", busy: false, error: "", enabled: false, paused: false, subjects: [], rankedSubjects: [], rankedCount: 0, hasSubjects: false, facts: [], pendingFacts: [], hasPendingFacts: false, selectedFacts: [], selectedPendingFacts: [], hasSelectedFacts: false, hasSelectedPendingFacts: false, selectedBasics: [], selectedChart: [], selectedRadarStyle: "", selfFacts: [], visibleSelfFacts: [], hasSelfFacts: false, hasMoreSelfFacts: false, showSelfMemory: false, selfKnownCount: 0, selfBasics: [], selfChart: [], selfPreferences: [], showSelfEditor: false, showSubjectEditor: false, selfText: "", label: "", firstConsent: false, selectedId: "", selectedLabel: "", selectedSignal: null, selectedNotes: "", selectedStage: "", selectedHowMet: "", selectedValues: "", selectedBoundaries: "", self: { ageRange: "", city: "", education: "", occupation: "", relationshipStatus: "", childrenPlan: "", lifestyle: "", preferredAgeRange: "", distancePreference: "", goals: "", values: "", boundaries: "", preferredRelationship: "" }, selfSaved: false },
  onLoad(options = {}) {
    const archiveTab = options.tab === "self" ? "self" : "people";
    this._detailRoute = archiveTab === "people" && !!options.subjectId;
    this.setData({ detailSection: "overview", archiveTab, comparisonOnly:options.compare==="1",showComparison:options.compare==="1", selectedId: archiveTab === "self" ? "" : options.subjectId || "", showManagement: false, showPendingReview: false, showQuickCreate: false, readingExpanded: {}, showSelfMemory: false });
    if (typeof wx.setNavigationBarTitle === "function") wx.setNavigationBarTitle({ title: archiveTab === "self" ? "我的资料" : this._detailRoute ? "人物详情" : "人物档案" });
  },
  switchDetailSection(event) { const detailSection = event.currentTarget.dataset.section; if (!["overview", "profile", "trend"].includes(detailSection)) return; this.setData({ detailSection }, () => this.renderCharts()); },
  toggleManagement() { this.setData({ showManagement: !this.data.showManagement }); },
  togglePendingReview() { this.setData({ showPendingReview: !this.data.showPendingReview }); },
  toggleQuickCreate() { this.setData({ showQuickCreate: !this.data.showQuickCreate }); },
  toggleReadingEvidence(event) {
    const index = Number(event.currentTarget.dataset.index);
    const subject = this.data.subjects.find(item => item.id === this.data.selectedId);
    const findings = subject && subject.communicationReading && subject.communicationReading.hypotheses;
    if (!Number.isInteger(index) || !findings || !findings[index]) return;
    const readingExpanded = { ...(this.data.readingExpanded || {}) };
    readingExpanded[index] = !readingExpanded[index];
    this.setData({ readingExpanded });
  },
  returnToList() { if (this._detailRoute && typeof getCurrentPages === "function" && getCurrentPages().length > 1) wx.navigateBack(); else { this.close(); if (this._lastState) this.apply(this._lastState); } },
  onShow() { if (!this.data.showSelfEditor && !this.data.showSubjectEditor && !this.data.feedbackOpen) this.refresh(); },
  switchArchiveTab(event) { const archiveTab = event.currentTarget.dataset.tab === "self" ? "self" : "people"; this.setData({ archiveTab, showSelfEditor: false, showSubjectEditor: false, showPendingReview: false, showQuickCreate: false, readingExpanded: {}, selectedId: archiveTab === "self" ? "" : this.data.selectedId }); if (this._lastState) this.apply(this._lastState); },
  async refresh() {
    this._feedbackLoadedSubject = "";
    if (this._refreshing) return;
    this._refreshing = true;
    this.setData({ phase: this.data.phase === "ready" ? "ready" : "loading", error: "" });
    try {
      const session = await api.session();
      if (!session.token) throw new Error("请重新进入小程序完成微信登录。");
      this._token = session.token;
      this.setData({profileSessionKey:session.token});
      this.apply(await api.request("/api/miniapp/profile", "GET", null, session.token));
      this._loaded = true;
    } catch (error) {
      if (this.data.phase !== "ready") this.setData({ phase: "error", error: "网络暂时不稳定，请点重试；已保存的资料不会丢失。" });
      else this.setData({ error: "网络暂时不稳定，当前资料已保留。" });
    } finally { this._refreshing = false; }
  },
  apply(state) {
    this._lastState = state;
    this.setData({selfProfile:state.self||{}});
    this.updateComparison(state);
    const showingSelf = this.data.archiveTab === "self";
    const subjects = showingSelf ? [] : (state.subjects || []);
    const signalById = new Map((state.signals || []).map(item => [item.subjectId, item]));
    const rankedSubjects = subjects.map(item => {
      const signal = signalById.get(item.id);
      return { ...item, avatarText: (item.label || "?").slice(0, 1), signal: signal || null, scoreText: signal?.comparable ? `${signal.score}` : signal?.score == null ? "待观察" : String(signal.score), comparable: !!signal?.comparable, barWidth: signal?.comparable ? `${signal.score}%` : "0%" };
    }).sort((a, b) => Number(b.comparable) - Number(a.comparable) || (b.comparable ? b.signal.score - a.signal.score : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
    let rank = 0;
    rankedSubjects.forEach(item => { item.rankLabel = item.comparable ? `#${++rank}` : "—"; });
    const facts = (state.facts || []).map(item => {
      const key = typeof item.kind === "string" && item.kind.startsWith("selfBasic:") ? item.kind.slice(10) : "";
      return { ...item, displayValue: basicLabels[key] ? `${basicLabels[key]} · ${item.value}` : item.value };
    });
    const current = subjects.find(item => item.id === this.data.selectedId);
    const names = new Map(subjects.map(item => [item.id, item.label]));
    const pendingFacts = facts.filter(item => item.status === "pending" && (showingSelf ? !item.subjectId : current ? item.subjectId === current.id : !!item.subjectId)).map(item => ({ ...item, subjectLabel: item.subjectId ? names.get(item.subjectId) || "已删除的人物" : "我的档案" }));
    const selectedFacts = current ? facts.filter(item => item.subjectId === current.id && item.status === "accepted") : [];
    const selectedPendingFacts = current ? facts.filter(item => item.subjectId === current.id && item.status === "pending") : [];
    const selfFacts = facts.filter(item => !item.subjectId && item.status === "accepted");
    const self = { ageRange: state.self?.ageRange || "", city: state.self?.city || "", education: state.self?.education || "", occupation: state.self?.occupation || "", relationshipStatus: state.self?.relationshipStatus || "", childrenPlan: state.self?.childrenPlan || "", lifestyle: state.self?.lifestyle || "", preferredAgeRange: state.self?.preferredAgeRange || "", distancePreference: state.self?.distancePreference || "", goals: state.self?.goals || "", values: state.self?.values || "", boundaries: state.self?.boundaries || "", preferredRelationship: state.self?.preferredRelationship || "" };
    const selfBasics = [{ label: "年龄", value: self.ageRange || "未填写" }, { label: "常住地", value: self.city || "未填写" }, { label: "学历", value: self.education || "未填写" }, { label: "职业", value: self.occupation || "未填写" }, { label: "婚恋状态", value: self.relationshipStatus || "未填写" }, { label: "婚育想法", value: self.childrenPlan || "未填写" }, { label: "生活方式", value: self.lifestyle || "未填写" }];
    const selfChart = selfBasics.map(item => ({ ...item, filled: item.value !== "未填写", width: item.value !== "未填写" ? 100 : 0 }));
    const selfPreferences = [{ label: "希望的年龄", value: self.preferredAgeRange || "未填写" }, { label: "异地接受程度", value: self.distancePreference || "未填写" }, { label: "想要的关系", value: self.preferredRelationship || "未填写" }, { label: "在意的事", value: self.values || "未填写" }, { label: "不能接受", value: self.boundaries || "未填写" }, { label: "眼下目标", value: self.goals || "未填写" }];
    const selectedBasics = subjectBasics(current, facts.filter(item => item.subjectId === current?.id));
    const selectedSignal = current ? signalById.get(current.id) || null : null;
    const selectedChart = signalChart(selectedSignal);
    const selectedTrend = current ? ((state.trends || []).find(item => item.subjectId === current.id)?.points || []) : [];
    this.setData({ trends: state.trends || [] });
    this.setData({ phase: "ready", enabled: !!state.enabled, paused: !!state.paused, subjects, rankedSubjects, rankedCount: rank, hasSubjects: subjects.length > 0, facts, selfKnownCount: ["ageRange", "city", "education", "occupation", "relationshipStatus", "childrenPlan", "lifestyle"].filter(key => !!state.self?.[key]).length, self: { ageRange: state.self?.ageRange || "", city: state.self?.city || "", education: state.self?.education || "", occupation: state.self?.occupation || "", relationshipStatus: state.self?.relationshipStatus || "", childrenPlan: state.self?.childrenPlan || "", lifestyle: state.self?.lifestyle || "", preferredAgeRange: state.self?.preferredAgeRange || "", distancePreference: state.self?.distancePreference || "", goals: state.self?.goals || "", values: state.self?.values || "", boundaries: state.self?.boundaries || "", preferredRelationship: state.self?.preferredRelationship || "" },
      ...detailExperience(current, selectedChart, selectedTrend), selfHasContent: Object.values(self).some(Boolean) || selfFacts.length > 0 || !!(state.self && state.self.momentsReport), trends: state.trends || [], selectedCompatibility: current?.compatibility || null, pendingFacts, visiblePendingFacts: this.data.showAllPending ? pendingFacts : pendingFacts.slice(0, 3), hasMorePending: pendingFacts.length > 3, hasPendingFacts: pendingFacts.length > 0,
      hasSelectedBasics: selectedBasics.length > 0, hasSelectedChart: selectedChart.length > 0, hasSelectedTrend: selectedTrend.length > 0, selectedFacts, selectedPendingFacts, hasSelectedFacts: selectedFacts.length > 0, hasSelectedPendingFacts: selectedPendingFacts.length > 0, selectedBasics, selectedChart, selectedRadarStyle: radarStyle(selectedSignal), selectedTrend, selfFacts, visibleSelfFacts: this.data.showSelfMemory ? selfFacts : selfFacts.slice(0, 2), hasSelfFacts: selfFacts.length > 0, hasMoreSelfFacts: selfFacts.length > 2, selfBasics, selfChart, selfPreferences,
      selfAvatar:state.self?.avatar || "", selectedAvatar:current?.avatar || "", selfMomentsReport:state.self?.momentsReport || null, selectedId: current?.id || "", selectedLabel: current?.label || "", selectedSignal, selectedNotes: current?.notes || "", selectedStage: current?.stage || "", selectedHowMet: current?.howMet || "", selectedValues: current?.values || "", selectedBoundaries: current?.boundaries || "", error: "" }, () => this.renderCharts());
  },
  labelInput(event) { this.setData({ label: event.detail.value }); },
  openManualCreate() { wx.navigateTo({url:'/pages/person-new/index'}); },
  firstConsentChange(event) { this.setData({ firstConsent: event.detail.value.includes("yes") }); },
  selectedLabelInput(event) { this.setData({ selectedLabel: event.detail.value }); },
  deleteReading(event) { if(this.data.busy)return;const subjectId=event.currentTarget.dataset.id;wx.showModal({title:"删除相处评价？",content:"之后分析不再参考这份评价，保留基础资料。",success:async result=>{if(!result.confirm)return;this.setData({busy:true});try{await api.request("/api/miniapp/profile","POST",{action:"delete-reading",subjectId},this._token);await this.refresh();}catch(error){this.setData({error:error.message||"删除未完成"});}finally{this.setData({busy:false});}}}); },
  deleteMoments(event) { if(this.data.busy) return; const target=event.currentTarget.dataset.target; const subjectId=event.currentTarget.dataset.id; wx.showModal({title:"删除朋友圈报告？",content:"删除这份报告及当前相处评价，保留已核对的基础资料。",success:async result=>{if(!result.confirm)return;this.setData({busy:true});try{await api.request("/api/miniapp/profile","POST",{action:"delete-moments",target,subjectId},this._token);await this.refresh();}catch(error){this.setData({error:error.message||"删除未完成"});}finally{this.setData({busy:false});}}}); },
  notesInput(event) { this.setData({ selectedNotes: event.detail.value }); },
  subjectInput(event) { const field = event.currentTarget.dataset.field; if (["selectedStage", "selectedHowMet", "selectedValues", "selectedBoundaries"].includes(field)) this.setData({ [field]: event.detail.value }); },
  selfInput(event) { const field = event.currentTarget.dataset.field; if (["ageRange", "city", "education", "occupation", "relationshipStatus", "childrenPlan", "lifestyle", "preferredAgeRange", "distancePreference", "goals", "values", "boundaries", "preferredRelationship"].includes(field)) this.setData({ [`self.${field}`]: event.detail.value, selfSaved: false }); },
  toggleSelfEditor() {
    const showSelfEditor = !this.data.showSelfEditor;
    this.setData({ showSelfEditor }, () => {
      if (showSelfEditor && typeof wx.pageScrollTo === "function") wx.pageScrollTo({ selector: "#self-profile-editor", duration: 250 });
    });
  },
  editSelfPreferences() {
    this.setData({ showSelfEditor: true }, () => {
      wx.pageScrollTo({ selector: '#self-preferences-editor', duration: 250 });
    });
  },
  openSelfProfile() { this.setData({ showSelfEditor: true }); },
  toggleSelfMemory() { const showSelfMemory = !this.data.showSelfMemory; this.setData({ showSelfMemory, visibleSelfFacts: showSelfMemory ? this.data.selfFacts : this.data.selfFacts.slice(0, 2) }); },
  renderCharts() {
    if (this.data.selectedId && this.data.archiveTab !== "self") {
      if (this.data.detailSection === "overview" && this.data.hasFitRadar) drawRadar(this, "personFitRadar", this.data.selectedCompatibility.fit, ["年龄阶段", "见面距离", "教育经历", "职业交集", "婚恋目标", "生活方式"]);
      if (this.data.detailSection === "trend" && this.data.hasInteractionRadar) drawRadar(this, "personInteractionRadar", this.data.selectedChart || [], ["主动表达", "回应承接", "回应扩展", "邀约兑现", "边界尊重", "互惠稳定"]);
      if (this.data.detailSection === "trend" && this.data.hasTrendChart) drawTrend(this, "relationshipTrend", this.data.selectedTrend || []);
    }
    this.loadActionCards();
  },
  async loadActionCards(force = false) {
    const subjectId = this.data.selectedId;
    if (!subjectId || this.data.archiveTab === "self" || this.data.paused || !this.data.enabled) { this._feedbackLoadVersion = (this._feedbackLoadVersion || 0) + 1; this._feedbackLoadingSubject = ""; this._feedbackLoadedSubject = ""; this.setData({ automaticUpdate:null,showManualFeedback:false,correctionCards:[],hasCorrectionCards:false,actionCards: [], visibleActionCards: [], feedbackEvents: [], visibleFeedbackEvents: [], hasFeedbackEvents: false, hasMoreFeedbackEvents: false, hasActionCards: false, feedbackOpen: false, feedbackLoading: false }); return; }
    if (!this._token || (!force && ((this._feedbackLoadedSubject === subjectId && this._feedbackDisplayedSubject === subjectId) || this._feedbackLoadingSubject === subjectId))) return;
    const version = this._feedbackLoadVersion = (this._feedbackLoadVersion || 0) + 1;
    this._feedbackLoadingSubject = subjectId;
    this._feedbackDisplayedSubject = subjectId;
    this.setData({ feedbackLoading: true, feedbackError: "", ...(this._feedbackLoadedSubject !== subjectId ? { automaticUpdate:null,showManualFeedback:false,correctionCards:[],hasCorrectionCards:false,actionCards: [], visibleActionCards: [], feedbackEvents: [], visibleFeedbackEvents: [], hasFeedbackEvents: false, hasMoreFeedbackEvents: false, showAllFeedbackEvents: false, hasActionCards: false, feedbackOpen: false } : {}) });
    try {
      const state = await api.request("/api/miniapp/relationship-feedback?subjectId=" + encodeURIComponent(subjectId), "GET", null, this._token);
      if (version !== this._feedbackLoadVersion || this.data.selectedId !== subjectId) return;
      const date = value => value ? new Date(value).toLocaleDateString("zh-CN") : "";
      const cards = (state.cards || []).map(card => ({ ...card, dateLabel: date(card.suggestedAt), feedbackDateLabel: date(card.latest?.recordedAt), revisions: (card.revisions || []).map(item => ({ ...item, dateLabel: date(item.recordedAt) })) }));
      this._feedbackLoadedSubject = subjectId;
      const events = Array.isArray(state.events) ? state.events : [];
      const correctionCards=cards.filter(card=>card.latest);
      const automatic=state.automatic?{...state.automatic,hasEvidenceReview:!!state.automatic.evidenceReview?.cards?.length,evidenceReview:state.automatic.evidenceReview?{...state.automatic.evidenceReview,cards:(state.automatic.evidenceReview.cards||[]).map(card=>({...card,kindLabel:({change:'前后变化',consistency:'说法对照',action:'说法与行动',feedback:'已确认反馈',pattern:'反复出现的互动',repair:'分歧后的回应'})[card.kind]||'互动线索',steps:(card.steps||[]).map(step=>({...step,statusLabel:step.status==='observed'?'已出现':step.status==='reappeared'?'再次出现':'材料尚未覆盖'}))}))}:null}:null;
      this.setData({automaticUpdate:automatic,correctionCards,hasCorrectionCards:correctionCards.length>0, actionCards: cards, visibleActionCards: this.data.showAllActions ? cards : cards.slice(0, 1), hasActionCards: cards.length > 0, hasMoreActions: cards.length > 1, feedbackEvents: events, hasFeedbackEvents: events.length > 0, hasMoreFeedbackEvents: events.length > 3, visibleFeedbackEvents: this.data.showAllFeedbackEvents ? events : events.slice(0, 3) });
    } catch (error) { if (version === this._feedbackLoadVersion && this.data.selectedId === subjectId) this.setData({ feedbackError: error.message || "行动记录暂未读取，可以重试。" }); }
    finally { if (version === this._feedbackLoadVersion) { this._feedbackLoadingSubject = ""; this.setData({ feedbackLoading: false }); } }
  },
  retryActionCards() { return this.loadActionCards(true); },
  openEventDate(event) {
    if(this.data.eventDateBusy || this.data.paused || !this.data.enabled) return;
    const fact=(this.data.facts||[]).find(item=>item.id===event.currentTarget.dataset.id && item.kind==="recentEvent" && item.eventTitle);
    if(!fact || (this.data.selectedId && fact.subjectId!==this.data.selectedId)) return;
    this._eventDateEdit={id:fact.id,subjectId:fact.subjectId,expectedDate:fact.eventDate||"",selection:this.data.selectedId||"",tab:this.data.archiveTab,token:this._token};
    this._eventDateRequest=null;
    this.setData({eventDateOpen:true,eventDateSelection:this.data.selectedId||"",eventDateTab:this.data.archiveTab,eventDateValue:fact.eventDate||"",eventDateOriginal:fact.eventDate||"",eventDateQuote:fact.value,eventDateError:""});
    if(typeof wx.pageScrollTo==="function") wx.pageScrollTo({selector:"#event-date-editor",duration:200});
  },
  eventDateChange(event) { if(!this.data.eventDateBusy){this._eventDateRequest=null;this.setData({eventDateValue:event.detail.value,eventDateError:""});} },
  clearEventDate() { if(!this.data.eventDateBusy){this._eventDateRequest=null;this.setData({eventDateValue:"",eventDateError:""});} },
  closeEventDate() { if(!this.data.eventDateBusy){this._eventDateEdit=null;this._eventDateRequest=null;this.setData({eventDateOpen:false,eventDateError:""});} },
  async saveEventDate() {
    const edit=this._eventDateEdit;
    const valid=()=>edit && this._eventDateEdit===edit && this._token===edit.token && (this.data.selectedId||"")===edit.selection && this.data.archiveTab===edit.tab && this.data.enabled && !this.data.paused;
    if(this.data.busy || this.data.eventDateBusy || !valid()) return;
    this.setData({eventDateBusy:true,eventDateError:""});
    try {
      if(!this._eventDateRequest) this._eventDateRequest={action:"event-date",id:edit.id,requestId:await api.newId(),eventDate:this.data.eventDateValue||"",expectedDate:edit.expectedDate,confirmed:true};
      if(!valid()) return;
      const state=await api.request("/api/miniapp/profile","POST",this._eventDateRequest,edit.token);
      if(!valid()) return;
      this._feedbackLoadedSubject="";
      this._eventDateEdit=null;this._eventDateRequest=null;
      this.setData({eventDateOpen:false});this.apply(state);
    } catch(error) { if(valid()) this.setData({eventDateError:error.message||"日期暂未保存，选择已保留，请重试。"}); }
    finally { this.setData({eventDateBusy:false}); }
  },
  toggleFeedbackEvents() { const expanded = !this.data.showAllFeedbackEvents; const events = this.data.feedbackEvents || []; this.setData({ showAllFeedbackEvents: expanded, visibleFeedbackEvents: expanded ? events : events.slice(0, 3) }); },
  toggleActionSource(event) {
    const reportId = event.currentTarget.dataset.reportId;
    const cards = (this.data.actionCards || []).map(card => card.reportId === reportId ? { ...card, sourceExpanded: !card.sourceExpanded } : card);
    this.setData({ actionCards: cards, correctionCards:cards.filter(card=>card.latest), visibleActionCards: this.data.showAllActions ? cards : cards.slice(0, 1) });
  },
  toggleActions() { const showAllActions = !this.data.showAllActions; this.setData({ showAllActions, visibleActionCards: showAllActions ? this.data.actionCards : (this.data.actionCards || []).slice(0, 1) }); },
  toggleFeedbackHistory(event) { const id = event.currentTarget.dataset.reportId; this.setData({ historyReportId: this.data.historyReportId === id ? "" : id }); },
  openFeedback(event) {
    if (this.data.feedbackBusy || this.data.paused) return;
    const card = (this.data.actionCards || []).find(item => item.reportId === event.currentTarget.dataset.reportId);
    if (!card) return;
    const key = this.data.selectedId + ":" + card.reportId;
    const draft = this._feedbackDrafts?.[key] || { feedbackOutcome: card.latest?.outcome || "", feedbackNote: card.latest?.note || "", feedbackEventDate: card.latest?.eventDate || "" };
    this.setData({ feedbackOpen: true, feedbackDetails: Boolean(draft.feedbackNote || draft.feedbackEventDate || ["alternative", "declined"].includes(draft.feedbackOutcome)), feedbackReportId: card.reportId, feedbackAction: card.action, feedbackSubjectId: this.data.selectedId, feedbackSubjectLabel: this.data.selectedLabel, feedbackError: "", ...draft,
      feedbackOptions: [{ value: "not_done", label: "还没执行" }, { value: "waiting", label: "等待反馈" }, { value: "positive", label: "有积极反馈" }, { value: "alternative", label: "提出其他安排" }, { value: "declined", label: "明确拒绝" }, { value: "uncomfortable", label: "让我不舒服" }] });
  },
  keepFeedbackDraft() { const key = this.data.feedbackSubjectId + ":" + this.data.feedbackReportId; this._feedbackDrafts = this._feedbackDrafts || {}; this._feedbackDrafts[key] = { feedbackOutcome: this.data.feedbackOutcome, feedbackNote: this.data.feedbackNote, feedbackEventDate: this.data.feedbackEventDate }; },
  feedbackOutcomeChange(event) { this.setData({ feedbackOutcome: event.currentTarget.dataset.value }); this.keepFeedbackDraft(); },
  toggleFeedbackDetails() { if (!this.data.feedbackBusy) this.setData({ feedbackDetails: !this.data.feedbackDetails }); },
  async quickFeedbackOutcome(event) {
    if (this.data.feedbackBusy || !this.data.feedbackOpen || this.data.feedbackSubjectId !== this.data.selectedId) return;
    this.feedbackOutcomeChange(event);
    if (!this.data.feedbackDetails) await this.saveFeedback();
  },
  feedbackNoteInput(event) { this.setData({ feedbackNote: event.detail.value }); this.keepFeedbackDraft(); },
  feedbackDateChange(event) { this.setData({ feedbackEventDate: event.detail.value }); this.keepFeedbackDraft(); },
  clearFeedbackDate() { this.setData({ feedbackEventDate: "" }); this.keepFeedbackDraft(); },
  closeFeedback() { if (!this.data.feedbackBusy) { this.keepFeedbackDraft(); this.setData({ feedbackOpen: false }); } },
  async saveFeedback() {
    if (this.data.feedbackBusy || !this.data.feedbackOpen || this.data.paused || this.data.feedbackSubjectId !== this.data.selectedId) return;
    if (!this.data.feedbackOutcome) { this.setData({ feedbackError: "先选一个结果。" }); return; }
    const payload = { subjectId: this.data.feedbackSubjectId, reportId: this.data.feedbackReportId, outcome: this.data.feedbackOutcome, note: this.data.feedbackNote || "", eventDate: this.data.feedbackEventDate || "", confirmed: true };
    const fingerprint = JSON.stringify(payload);
    this.setData({ feedbackBusy: true, feedbackError: "" });
    try {
      if (this._feedbackSubmission?.fingerprint !== fingerprint) this._feedbackSubmission = { fingerprint, id: await api.newId() };
      await api.request("/api/miniapp/relationship-feedback", "POST", { ...payload, id: this._feedbackSubmission.id }, this._token);
      delete (this._feedbackDrafts || {})[payload.subjectId + ":" + payload.reportId];
      this._feedbackSubmission = null;
      if (this.data.selectedId === payload.subjectId) { this.setData({ feedbackOpen: false }); await this.loadActionCards(true); }
    } catch (error) { if (this.data.selectedId === payload.subjectId) this.setData({ feedbackError: error.message || "反馈暂未保存，你填写的内容还在。" }); }
    finally { this.setData({ feedbackBusy: false }); }
  },
  deleteFeedback(event) {
    if (this.data.feedbackBusy) return;
    const subjectId = this.data.selectedId, reportId = event.currentTarget.dataset.reportId;
    if (!(this.data.actionCards || []).some(item => item.reportId === reportId && item.latest)) return;
    wx.showModal({ title: "删除这条建议的反馈？", content: "将删除这条建议的所有反馈与更正记录，不能恢复。原分析和基础资料不会删除。", confirmText: "删除反馈", success: async result => {
      if (!result.confirm || this.data.feedbackBusy || this.data.selectedId !== subjectId) return;
      this.setData({ feedbackBusy: true, feedbackError: "" });
      try { await api.request("/api/miniapp/relationship-feedback", "DELETE", { subjectId, reportId, confirmed: true }, this._token); delete (this._feedbackDrafts || {})[subjectId + ":" + reportId]; if (this.data.selectedId === subjectId) { this.setData({ feedbackOpen: false }); await this.loadActionCards(true); } }
      catch (error) { if (this.data.selectedId === subjectId) this.setData({ feedbackError: error.message || "反馈暂未删除。" }); }
      finally { this.setData({ feedbackBusy: false }); }
    } });
  },
  togglePersonEvidence() { this.setData({ showPersonEvidence: !this.data.showPersonEvidence }); },
  toggleFitDetails() { this.setData({ showFitDetails: !this.data.showFitDetails }); },
  togglePending() { const showAllPending = !this.data.showAllPending; this.setData({ showAllPending, visiblePendingFacts: showAllPending ? this.data.pendingFacts : this.data.pendingFacts.slice(0, 3) }); },
  toggleSubjectEditor() {
    const showSubjectEditor = !this.data.showSubjectEditor;
    this.setData({ showSubjectEditor }, () => {
      if (showSubjectEditor && typeof wx.pageScrollTo === "function") wx.pageScrollTo({ selector: "#subject-profile-editor", duration: 250 });
    });
  },
  selfTextInput(event) { this.setData({ selfText: event.detail.value }); },
  async importSelfText() { const value = this.data.selfText.trim(); if (!value) { this.setData({ error: "请先粘贴你自己写过的资料文字。" }); return; } await this.action({ action: "self-memory", text: value, evidence: "本人主动粘贴的社交资料文字", confirmed: true }); if (!this.data.error) this.setData({ selfText: "" }); },
  saveSelf() { this.action({ action: "self", data: this.data.self }).then(() => { if (!this.data.error) this.setData({ selfSaved: true }); }); },
  select(event) {
    const target = this.data.subjects.find(item => item.id === event.currentTarget.dataset.id);
    if (target) {
      const selectedFacts = this.data.facts.filter(item => item.subjectId === target.id && item.status === "accepted");
      api.setCurrentSubject?.(target.id);
      const selectedPendingFacts = this.data.facts.filter(item => item.subjectId === target.id && item.status === "pending");
      const selectedSignal = this.data.rankedSubjects.find(item => item.id === target.id)?.signal || null;
      const selectedBasics = subjectBasics(target, this.data.facts.filter(item => item.subjectId === target.id));
      const selectedChart = signalChart(selectedSignal);
      const selectedTrend = (this.data.trends || []).find(item => item.subjectId === target.id)?.points || [];
      const pendingFacts = selectedPendingFacts.map(item => ({ ...item, subjectLabel: target.label }));
      this.setData({ ...detailExperience(target, selectedChart, selectedTrend), pendingFacts, visiblePendingFacts: this.data.showAllPending ? pendingFacts : pendingFacts.slice(0, 3), hasPendingFacts: pendingFacts.length > 0, hasMorePending: pendingFacts.length > 3, detailSection: "overview", readingExpanded: {}, showMomentsDetails: false, showMomentsTimeline: false, showFitDetails: false, showPersonEvidence: false, showPendingReview: false, selectedTrend, hasSelectedTrend: selectedTrend.length > 0, hasSelectedBasics: subjectBasics(target).length > 0, hasSelectedChart: signalChart(selectedSignal).length > 0, selectedCompatibility: target.compatibility || null });
      this.setData({ selectedId: target.id, selectedLabel: target.label, selectedSignal, selectedBasics: subjectBasics(target, this.data.facts.filter(item => item.subjectId === target.id)), selectedChart: signalChart(selectedSignal), selectedRadarStyle: radarStyle(selectedSignal), selectedNotes: target.notes || "", selectedStage: target.stage || "", selectedHowMet: target.howMet || "", selectedValues: target.values || "", selectedBoundaries: target.boundaries || "", showSubjectEditor: false, hasSelectedBasics: selectedBasics.length > 0, hasSelectedChart: selectedChart.length > 0, hasSelectedTrend: selectedTrend.length > 0, selectedFacts, selectedPendingFacts, hasSelectedFacts: selectedFacts.length > 0, hasSelectedPendingFacts: selectedPendingFacts.length > 0, error: "" }, () => {
        this.renderCharts();
        if (typeof wx.pageScrollTo === "function") wx.pageScrollTo({ selector: "#selected-subject", duration: 250 });
      });
    }
  },
  openSubjectDetail(event) { const id = event.currentTarget.dataset.id; if (this.data.subjects.some(item => item.id === id)) wx.navigateTo({ url: "/pages/archive/index?subjectId=" + encodeURIComponent(id) }); },
  close() { this.setData({ selectedId: "", selectedLabel: "", selectedSignal: null, selectedRadarStyle: "", showSubjectEditor: false, selectedNotes: "", selectedFacts: [], selectedPendingFacts: [], hasSelectedFacts: false, hasSelectedPendingFacts: false }); },
  openSelectedChat() { if (!this.data.selectedId) return; api.setCurrentSubject?.(this.data.selectedId); wx.navigateTo({ url: "/pages/chat/index" }); },
  openSelectedReport() { const id = this.data.selectedSignal?.reportId; if (id) wx.navigateTo({ url: "/pages/report/index?id=" + encodeURIComponent(id) }); },
  openSelectedSocial() { if (!this.data.selectedId) return; wx.navigateTo({ url: "/pages/social-profile/index?subjectId=" + encodeURIComponent(this.data.selectedId) }); },
  async action(value) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try { this.apply(await api.request("/api/miniapp/profile", "POST", value, this._token)); }
    catch (error) {
      if (error.status === 401) wx.removeStorageSync(api.STORAGE);
      this.setData({ error: error.message || "操作未完成，请重试。" });
    } finally { this.setData({ busy: false }); }
  },
  enable() { this.action({ action: "consent", enabled: true }); },
  async enableSelfOnly() {
    if (this.data.busy) return;
    if (!this.data.firstConsent) { this.setData({ error: "请先勾选同意启用关系档案。" }); return; }
    await this.action({ action: "consent", enabled: true });
    if (!this.data.error && this.data.enabled) {
      this.setData({ archiveTab: "self", selectedId: "", firstConsent: false, showSelfEditor: true });
      if (this._lastState) this.apply(this._lastState);
      if (typeof wx.pageScrollTo === "function") wx.pageScrollTo({ selector: "#self-profile-editor", duration: 250 });
    }
  },
  async createFirst() {
    if (this.data.busy) return;
    const name = this.data.label.trim();
    if (!name || name.length > 60) { this.setData({ error: "先给这位对象起个 60 字以内的称呼。" }); return; }
    if (!this.data.firstConsent) { this.setData({ error: "请先确认是否同意启用人物档案。" }); return; }
    this.setData({ busy: true, error: "" });
    try {
      if (!this.data.enabled || this.data.paused) this.apply(await api.request("/api/miniapp/profile", "POST", { action: "consent", enabled: true }, this._token));
      const created = await api.request("/api/miniapp/profile", "POST", { action: "create", label: name }, this._token);
      this.apply(created);
      this.setData({ label: "", firstConsent: false });
    } catch (error) {
      if (error.status === 401) wx.removeStorageSync(api.STORAGE);
      this.setData({ error: error.message || "档案未建立，请重试。" });
    } finally { this.setData({ busy: false }); }
  },
  pause() { this.action({ action: "pause", paused: !this.data.paused }); },
  revoke() { this.action({ action: "consent", enabled: false }); },
  factDecision(event) {
    const id = event.currentTarget.dataset.id;
    const decision = event.currentTarget.dataset.decision;
    if (!this.data.pendingFacts.some(item => item.id === id) || !["accept", "reject"].includes(decision)) return;
    return this.action({ action: "fact-decide", id, decision });
  },
  confirmAll() {
    const ids = this.data.pendingFacts.map(item => item.id).filter(Boolean).slice(0, 80);
    if (!ids.length || this.data.busy || this.data.paused) return;
    this.action({ action: "fact-decide-many", ids, decision: "accept" });
  },
  deleteFact(event) { const id = event.currentTarget.dataset.id; if (this.data.facts.some(item => item.id === id)) this.action({ action: "fact-delete", id }); },
  openSelfScreenshot() { wx.navigateTo({ url: "/pages/social-profile/index?target=self" }); },
  async create() {
    const name = this.data.label.trim();
    if (!name) { this.setData({ error: "先给这个对象一个称呼或代号。" }); return; }
    await this.action({ action: "create", label: name });
    if (!this.data.error) this.setData({ label: "" });
  },
  save() { this.action({ action: "save", id: this.data.selectedId, label: this.data.selectedLabel, notes: this.data.selectedNotes, stage: this.data.selectedStage, howMet: this.data.selectedHowMet, values: this.data.selectedValues, boundaries: this.data.selectedBoundaries }); },
  deleteSubject() {
    const id = this.data.selectedId;
    if (!id) return;
    wx.showModal({ title: "删除这个对象？", content: "这会删除这位对象的档案、待确认事实和关联的分析报告，无法恢复。", confirmText: "确认删除", confirmColor: "#a14235", success: result => { if (result.confirm && this.data.selectedId === id) this.action({ action: "delete", id }); } });
  },
  wipe() {
    wx.showModal({ title: "删除全部档案？", content: "将删除本账号全部对象、记忆和分析报告，无法恢复；微信登录身份仍保留。", confirmText: "全部删除", confirmColor: "#a14235", success: result => { if (result.confirm) this.action({ action: "wipe", confirm: "DELETE_MY_ARCHIVE" }); } });
  }
});
