// Read-only projection of saved reports; missing counts stay unknown.
const rows=v=>Array.isArray(v)?v.filter(r=>r&&typeof r==='object'):[];
const text=v=>typeof v==='string'?v.trim():'';
const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const strings=v=>Array.isArray(v)?v.map(text).filter(Boolean):[];
const full=r=>r.analysisScope==='fullHistory'||r.analysisScope==='uploadedHistory'||r.captureFormat==='full-history';
function signalTags(v){
 if(typeof v==='string')return text(v)?[{label:text(v)}]:[];
 if(v&&typeof v==='object'&&!Array.isArray(v)){const keys=Object.keys(v);v=keys.length<=80&&keys.every((key,i)=>key===String(i))?keys.map(key=>v[key]):[];}
 return rows(v).filter(r=>text(r.label)).slice(0,3).map(r=>{const p=number(r.probability),w=number(r.weight);return {...r,label:text(r.label),probability:p!==null&&p<=1?p:w!==null&&w<=100?w/100:null};});
}
function reportGeneratedTime(r){
 for(const raw of [r.generatedAt,r.createdAt,r.created_at]){
  if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(raw))continue;
  const n=raw.replace(' ','T'),d=new Date(n.length===10?n+'T00:00:00Z':/[zZ]|[+-]\d\d:\d\d$/.test(n)?n:n+'Z');
  if(!Number.isFinite(d.getTime()))continue;
  const local=new Date(d.getTime()+8*3600000).toISOString();return local.slice(0,10)+' '+local.slice(11,16)+'（北京时间）';
 }
 return '';
}
function reportScope(r){
 if(r.analysisScope==='uploadedHistory')return {label:r.materialCoverage?.history==='user-declared-complete'?'完整关系报告':'阶段关系报告',note:text(r.scopeNote)};
 if(r.analysisScope==='supplement'||r.supplementOf?.reportId)return {label:'补充截图解读',note:text(r.scopeNote)||'以原完整报告为背景，仅解读本次新增截图；不重新统计全部历史。'};
 if(full(r))return {label:r.captureKind==='moments'?'完整朋友圈报告':'完整关系报告',note:'基于生成时已导入的全部可读资料。未同步的内容不在这份报告内。'};
 if(r.isImported||r.importAnalysis)return {label:'导入材料分析',note:'基于本次导入的材料；逐句区展示最近一批关键原话。'};
 if(r.kind==='moments'||r.moments||r.type==='moments')return {label:'本次朋友圈截图',note:'只分析本次上传截图中的可见动态，不代表全部朋友圈。'};
 return {label:r.isRiskAnalysis?'本次材料风险分析':'本次截图解读',note:text(r.scopeNote)||'只分析本次上传的可见对话，不代表全部聊天历史。'};
}
function historyReport(report){
 if(!report||!full(report))return null;
 const semantic=report.semanticHistory||report.relationshipDiagnosis?.semanticHistory||{},scope=reportScope(report);
 const other=text(report.participants?.other?.label)||'对方',who=r=>r==='self'?'你':r==='other'?other:'归属待确认';
 const sources=rows(report.sourceCoverage),momentIds=new Set(sources.filter(r=>r.kind==='moments').map(r=>r.libraryId));
 for(const r of rows(report.relatedArchiveSnapshots))if(r.kind==='moments')momentIds.add(r.libraryId);
 if(report.captureKind==='moments'&&report.archiveSnapshot?.libraryId)momentIds.add(report.archiveSnapshot.libraryId);
 const isMoment=r=>r.sourceKind==='chat'||r.kind==='chat'?false:r.sourceKind==='moments'||r.kind==='moments'||momentIds.has(r.libraryId);
 const profile=r=>['moments-cover','profile-signature'].includes(r.materialRole);
 const label=r=>r.materialRole==='profile-signature'?'个性签名':r.materialRole==='moments-cover'?'朋友圈封面':isMoment(r)?'朋友圈':'聊天';
 const seen=new Set();
 const findings=rows(semantic.findings).filter(r=>{const key=r.id||JSON.stringify([text(r.claim),r.evidence]);if(!text(r.claim)||seen.has(key))return false;seen.add(key);return true;}).map(r=>({...r,who:r.subject==='interaction'?'你们之间':who(r.subject),evidence:rows(r.evidence).filter(s=>text(s.quote)).map(s=>({...s,who:who(s.senderRole||s.speaker),kindLabel:label(s)}))}));
 const referenced=ids=>findings.filter(r=>Array.isArray(ids)&&ids.includes(r.id));
 const evidence=ids=>{const seen=new Set();return referenced(ids).flatMap(r=>r.evidence).filter(r=>{const key=JSON.stringify([r.libraryId,r.sourceId,r.quote]);if(seen.has(key))return false;seen.add(key);return true;});};
 const moments=findings.filter(r=>r.evidence.some(s=>isMoment(s)&&!profile(s))).map(r=>({...r,evidence:r.evidence.filter(isMoment)}));
 const insight=semantic.sourceInsights?.moments||{},insightEvidence=evidence(insight.evidenceIds),crossEvidence=evidence(insight.crossSource?.evidenceIds);
 const momentsSummary=insight.status==='no_supported_insight'||insightEvidence.some(isMoment)?text(insight.summary):'';
 const crossSource=crossEvidence.some(isMoment)&&crossEvidence.some(s=>!isMoment(s))?text(insight.crossSource?.summary):'';
 const stats=report.momentsStatistics?.basis==='capture-records'&&count(report.momentsStatistics.total)!==null?report.momentsStatistics:null;
 const legacy=report.moments?.statistics||(report.captureKind==='moments'?report.statistics:null);
 const legacyGroups=legacy?[['内容主题',rows(legacy.content).length?legacy.content:legacy.visibleContent],['文案表达',rows(legacy.copy).length?legacy.copy:legacy.visibleCopy]].map(([title,list])=>({title,rows:rows(list).filter(r=>text(r.label)&&count(r.count)!==null).map(r=>({...r,width:number(r.percent)!==null&&r.percent<=100?r.percent:null}))})).filter(group=>group.rows.length):[];
 const statMonths=rows(stats?.months).filter(r=>/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)&&count(r.count)!==null&&r.count>0),monthPeak=Math.max(1,...statMonths.map(r=>r.count));
 const momentsStatistics=stats?{...stats,withText:count(stats.withText),previewsAvailable:count(stats.previewsAvailable),pinnedCount:count(stats.pinnedCount),months:statMonths.map(r=>({...r,width:r.count/monthPeak*100,sourceRefs:rows(r.sourceRefs)}))}:null;
 const momentSources=sources.filter(r=>r.kind==='moments');
 const momentsTotal=stats?stats.total:momentSources.length&&momentSources.every(r=>count(r.momentCount)!==null)?momentSources.reduce((sum,r)=>sum+r.momentCount,0):null;
 const visualSeen=new Set();
 const allVisuals=rows(report.mediaEvidence).filter(r=>text(r.observation)).filter(r=>{const key=JSON.stringify([r.libraryId,r.sourceId,r.observation]);if(visualSeen.has(key))return false;visualSeen.add(key);return true;}).map(r=>({...r,kindLabel:label(r),who:who(r.speaker)}));
 const visuals=allVisuals.filter(r=>!profile(r));
 const materials=rows(report.profileMaterials).map(r=>({...r,kindLabel:label(r),observation:allVisuals.find(s=>s.libraryId===r.libraryId&&s.sourceId===r.sourceId)?.observation||''}));
 const steps=rows(semantic.actionPlan?.steps).map(r=>({...r,evidence:evidence(r.evidenceIds)})),first=steps.find(r=>text(r.action)&&r.evidence.length),fallbackEvidence=evidence(semantic.actionEvidenceIds);
 const actionOverview=first?{...first,observeFor:text(first.observeFor)||text(semantic.observeWindow),stopWhen:text(first.stopWhen)||text(semantic.stopCondition)}:text(semantic.action)&&fallbackEvidence.length?{action:text(semantic.action),evidence:fallbackEvidence,observeFor:text(semantic.observeWindow),stopWhen:text(semantic.stopCondition)}:null;
 const activity=report.chatActivity,affinity=semantic.affinity||report.affinity,score=number(affinity?.value),monthMap=new Map();
 for(const day of rows(activity?.days)){const month=text(day.date).slice(0,7);if(!/^\d{4}-\d{2}$/.test(month))continue;const item=monthMap.get(month)||{date:month,self:0,other:0};item.self+=number(day.self)||0;item.other+=number(day.other)||0;monthMap.set(month,item);}
 const months=[...monthMap.values()].sort((a,b)=>a.date.localeCompare(b.date)),peak=Math.max(1,...months.map(r=>r.self+r.other));
 const recent=report.recentSentenceAnalysis||semantic.recentSentenceAnalysis,annotations=new Map(rows(recent?.annotations).map(r=>[r.lineId,r]));
 const recentLines=recent?.scope==='recent'?rows(recent.lines).filter(r=>text(r.text)&&!isMoment(r)).map(r=>{const note=annotations.get(r.id)||{};return {...r,who:who(r.speaker),emotionTags:signalTags(note.emotion),intentTags:signalTags(note.intent),note:text(note.note)};}):[];
 const replies=rows(report.decision?.replyOptions).filter(r=>text(r.text)).slice(0,3).map((r,i)=>({...r,style:text(r.style)||'方案 '+(i+1),evidence:evidence(r.evidenceIds)}));
 return {other,scope,generatedTime:reportGeneratedTime(report),momentsOnly:report.captureKind==='moments',summary:text(semantic.summary)||text(report.decision?.judgment)||text(report.summary),trend:text(semantic.trend),action:text(semantic.action)||text(report.decision?.nextStep),explanation:text(semantic.explanation),coverage:semantic.coverage||{},sources,
  findings,moments,momentsSummary,momentsEvidence:insightEvidence,momentsUnknowns:strings(insight.unknowns),crossSource,crossEvidence,momentsStatistics,momentsTotal,legacyStatistics:legacy||null,legacyGroups,
  hasMoments:!!(momentsTotal>0||moments.length||momentsSummary||materials.length||visuals.some(isMoment)),visuals,profileMaterials:materials,
  profiles:rows(semantic.profileInsights).map(r=>({...r,who:who(r.subject),evidence:evidence(r.evidenceIds)})),
  risks:rows(semantic.riskAssessment?.items).filter(r=>r.subject==='other').map(r=>({...r,evidence:evidence(r.evidenceIds)})),riskSummary:text(semantic.riskAssessment?.summary),
  signals:rows(semantic.affinitySignals).filter(r=>r.subject==='other').map(r=>({...r,evidence:evidence(r.evidenceIds),directionLabel:r.direction==='support'?'支持信号':r.direction==='counter'?'相反信号':'待确认'})),
  changes:rows(semantic.changeInsights).map(r=>({...r,who:who(r.subject),evidence:evidence([...(r.before?.evidenceIds||[]),...(r.after?.evidenceIds||[])])})),
  timeline:rows(semantic.timeline).map(r=>({...r,evidence:evidence(r.evidenceIds)})),steps,actionOverview,replies,recent:recentLines.length?{...recent,lines:recentLines}:null,
  observe:text(semantic.observeWindow),stop:text(semantic.stopCondition),unknowns:strings(semantic.unknowns),
  activity:activity?{...activity,months:months.map(r=>({...r,selfWidth:r.self/peak*100,otherWidth:r.other/peak*100}))}:null,
  score:score!==null&&score<=100?Math.round(score):null,scoreReason:text(affinity?.unavailableReason),
  dimensions:rows(affinity?.dimensions).map(r=>({...r,value:number(r.value)!==null&&r.value<=100?r.value:null,evidence:evidence(r.evidenceIds)})),
  personalConnection:report.personalConnection||null,riskReview:report.riskReview||null,mediaNote:text(report.captureMediaNote)
 };
}
module.exports={historyReport,reportScope,reportGeneratedTime,signalTags};
