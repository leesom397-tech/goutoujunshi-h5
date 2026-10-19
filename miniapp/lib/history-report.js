const rows=value=>Array.isArray(value)?value.filter(row=>row&&typeof row==='object'):[];
const text=value=>typeof value==='string'?value.trim():'';
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
function historyReport(report){
  if(!report||!(report.analysisScope==='fullHistory'||report.captureFormat==='full-history'))return null;
  const semantic=report.semanticHistory||report.relationshipDiagnosis?.semanticHistory||{};
  const other=text(report.participants?.other?.label)||'对方';
  const who=role=>role==='self'?'你':role==='other'?other:'你们之间';
  const seen=new Set();
  const findings=rows(semantic.findings).filter(row=>{const key=text(row.claim).replace(/\s/g,'');if(!key||seen.has(key))return false;seen.add(key);return true;}).map(row=>({...row,who:who(row.subject),evidence:rows(row.evidence).filter(source=>text(source.quote)).map(source=>({...source,who:who(source.senderRole),kindLabel:source.sourceKind==='moments'?'朋友圈':'聊天'}))}));
  const evidence=ids=>findings.filter(row=>Array.isArray(ids)&&ids.includes(row.id));
  const sources=rows(report.sourceCoverage),momentIds=new Set(sources.filter(row=>row.kind==='moments').map(row=>row.libraryId));
  const moments=findings.filter(row=>row.evidence.some(source=>source.sourceKind==='moments'||momentIds.has(source.libraryId)));
  const activity=report.chatActivity;
  const affinity=semantic.affinity||report.affinity;
  const score=number(affinity?.value);
  const days=rows(activity?.days);const monthMap=new Map();
  for(const day of days){const month=text(day.date).slice(0,7);if(!/^\d{4}-\d{2}$/.test(month))continue;const item=monthMap.get(month)||{date:month,self:0,other:0};item.self+=number(day.self)||0;item.other+=number(day.other)||0;monthMap.set(month,item);}
  const months=[...monthMap.values()].sort((a,b)=>a.date.localeCompare(b.date));const peak=Math.max(1,...months.map(row=>row.self+row.other));
  return {other,summary:text(semantic.summary)||text(report.decision?.judgment)||text(report.summary),trend:text(semantic.trend),action:text(semantic.action)||text(report.decision?.nextStep),explanation:text(semantic.explanation),coverage:semantic.coverage||{},sources,
    findings,moments,momentsSummary:text(semantic.sourceInsights?.moments?.summary),crossSource:text(semantic.sourceInsights?.moments?.crossSource?.summary),
    profiles:rows(semantic.profileInsights).map(row=>({...row,who:who(row.subject),evidence:evidence(row.evidenceIds)})),
    risks:rows(semantic.riskAssessment?.items).filter(row=>row.subject==='other').map(row=>({...row,evidence:evidence(row.evidenceIds)})),riskSummary:text(semantic.riskAssessment?.summary),
    signals:rows(semantic.affinitySignals).filter(row=>row.subject==='other').map(row=>({...row,evidence:evidence(row.evidenceIds),directionLabel:row.direction==='support'?'支持信号':row.direction==='counter'?'相反信号':'待确认'})),
    changes:rows(semantic.changeInsights).map(row=>({...row,who:who(row.subject),evidence:evidence([...(row.before?.evidenceIds||[]),...(row.after?.evidenceIds||[])])})),
    timeline:rows(semantic.timeline).map(row=>({...row,evidence:evidence(row.evidenceIds)})),
    steps:rows(semantic.actionPlan?.steps).map(row=>({...row,evidence:evidence(row.evidenceIds)})),
    observe:text(semantic.observeWindow),stop:text(semantic.stopCondition),unknowns:Array.isArray(semantic.unknowns)?semantic.unknowns:[],
    activity:activity?{...activity,months:months.map(row=>({...row,selfWidth:row.self/peak*100,otherWidth:row.other/peak*100}))}:null,
    score:score!==null&&score<=100?Math.round(score):null,scoreReason:text(affinity?.unavailableReason),
    dimensions:rows(affinity?.dimensions).map(row=>({...row,value:number(row.value),evidence:evidence(row.evidenceIds)})),
    personalConnection:report.personalConnection||null,riskReview:report.riskReview||null,
    profileMaterials:rows(report.profileMaterials),mediaNote:text(report.captureMediaNote)
  };
}
module.exports={historyReport};
