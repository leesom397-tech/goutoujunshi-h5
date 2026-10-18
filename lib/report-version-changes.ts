import type { RelationshipSourceReport } from "./relationship-evidence";
import { relationshipEvidenceReview } from "./relationship-evidence";
type Row=Record<string,any>;
export type ReportChangeSource={reportId:string;sourceId?:string;libraryId?:string;quote:string;at:string;basis?:string};
export type ReportVersionChanges={status:"first"|"compared"|"limited";previousId?:string;previousSummary?:string;currentSummary?:string;actionChange?:{before:string;after:string;sources:ReportChangeSource[]};items:{kind:"new"|"supporting"|"revised";title:string;detail:string;sources:ReportChangeSource[]}[];note:string};
const rows=(v:unknown):Row[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==="object"):[];
const str=(v:unknown)=>typeof v==="string"?v.trim():"";
const key=(v:string)=>v.replace(/[\s\p{P}\p{S}]/gu,"");
function semantic(row:RelationshipSourceReport){return row.report.semanticHistory||row.report.relationshipDiagnosis?.semanticHistory||{};}
function findings(row:RelationshipSourceReport){
 const result:{claim:string;sources:ReportChangeSource[];id:string}[]=[];
 for(const finding of rows(semantic(row).findings)){
  const sources=rows(finding.evidence).filter(e=>str(e.sourceId)&&str(e.quote)&&["self","other"].includes(e.senderRole)).map(e=>({reportId:row.id,sourceId:e.sourceId,libraryId:str(e.libraryId)||undefined,quote:str(e.quote),at:str(e.at),basis:e.basis}));
  if(str(finding.claim)&&sources.length)result.push({claim:finding.claim,sources,id:str(finding.id)});
 }
 return result;
}
const sourceKey=(source:ReportChangeSource)=>source.sourceId?[(source.libraryId||""),source.sourceId,key(source.quote)].join(":"):key(source.quote);
/** Compare retained, already verified evidence; no model, causal attribution or score deltas. */
export function reportVersionChanges(reports:RelationshipSourceReport[],reportId:string):ReportVersionChanges{
 const current=reports.find(row=>row.id===reportId||row.entries?.some(entry=>entry.id===reportId));
 const earlier=current?reports.filter(row=>row.createdAt<current.createdAt&&row.id!==current.id).sort((a,b)=>b.createdAt-a.createdAt):[];
 const previous=earlier[0];
 if(!current||!previous)return {status:"first",items:[],note:"这是目前可对照的第一份报告。"};
 const fresh=findings(current),old=findings(previous),known=new Set(old.flatMap(f=>f.sources.map(sourceKey))),oldText=new Set(old.flatMap(f=>f.sources.map(s=>key(s.quote))));
 const usedClaims=new Set<string>(),usedSources=new Set<string>(),items:ReportVersionChanges["items"]=[];
 const currentSemantic=semantic(current),previousSemantic=semantic(previous);
 const libraries=(report:Row)=>[report.archiveSnapshot?.libraryId,...rows(report.relatedSnapshots).map(row=>row.libraryId)].filter(Boolean).sort().join("|");
 const question=(report:Row)=>str(report.diagnosticQuestion||report.relationshipDiagnosis?.question);
 const comparable=current.report.analysisScope==="fullHistory"&&previous.report.analysisScope==="fullHistory"&&!!libraries(current.report)&&libraries(current.report)===libraries(previous.report)&&question(current.report)===question(previous.report)&&currentSemantic.status==="complete"&&previousSemantic.status==="complete";
 const beforeAction=str(previousSemantic.action),afterAction=str(currentSemantic.action);
 const actionIds=new Set(Array.isArray(currentSemantic.actionEvidenceIds)?currentSemantic.actionEvidenceIds:[]);
 const actionSources=fresh.filter(finding=>actionIds.has(finding.id)).flatMap(finding=>finding.sources).filter(source=>!known.has(sourceKey(source))&&!oldText.has(key(source.quote)));
 const actionChange=comparable&&beforeAction&&afterAction&&key(beforeAction)!==key(afterAction)&&actionSources.length?{before:beforeAction,after:afterAction,sources:actionSources.slice(0,2)}:undefined;
 const currentSummary=str(currentSemantic.summary||current.report.decision?.judgment||current.report.summary),previousSummary=str(previousSemantic.summary||previous.report.decision?.judgment||previous.report.summary);
 const summaryIds=new Set<string>();
 for(const id of Array.isArray(currentSemantic.summaryEvidenceIds)?currentSemantic.summaryEvidenceIds:[])if(typeof id==="string")summaryIds.add(id);
 const changedSummary=!!currentSummary&&!!previousSummary&&key(currentSummary)!==key(previousSummary);
 for(const finding of fresh){
  const claim=key(finding.claim),sources=finding.sources.filter(source=>!known.has(sourceKey(source))&&!oldText.has(key(source.quote))&&!usedSources.has(sourceKey(source)));
  if(!sources.length||usedClaims.has(claim))continue;
  const supporting=old.some(before=>key(before.claim)===claim);
  const revised=!supporting&&changedSummary&&summaryIds.has(finding.id)&&old.length>0&&items.every(item=>item.kind!=="revised");
  items.push({kind:supporting?"supporting":revised?"revised":"new",title:supporting?"原有判断新增依据":revised?"判断表述有更新":"新增观察",detail:finding.claim,sources:sources.slice(0,2)});
  usedClaims.add(claim);sources.forEach(source=>usedSources.add(sourceKey(source)));
  if(items.length===3)break;
 }
 // Older screenshot reports retain exact lines rather than semantic findings.
 // Reuse the existing conservative action/claim comparison, with its source pair.
 if(!items.length&&!fresh.length){
  const review=relationshipEvidenceReview({},String(current.report.subjectId||previous.report.subjectId||""),current.id,[previous,current]);
  for(const card of review.cards){
   const sources=card.sources.filter(source=>source.kind!=="extracted-content"&&source.kind!=="user-feedback"&&source.text);
   if(!sources.some(source=>source.reportId===current.id))continue;
   const signature=sources.map(source=>[source.date,key(source.text)].join(":"));
   if(signature.some(value=>usedSources.has(value)))continue;
   signature.forEach(value=>usedSources.add(value));
   items.push({kind:card.kind==="consistency"?"revised":card.kind==="pattern"?"supporting":"new",title:card.kind==="consistency"?"出现需要核对的差异":card.kind==="pattern"?"相处模式新增依据":"新增观察",detail:card.title,sources:sources.slice(-3).map(source=>({reportId:source.reportId,quote:source.text,at:source.date}))});
   if(items.length===3)break;
  }
 }
 return {status:items.length||fresh.length&&old.length?"compared":"limited",previousId:previous.id,previousSummary,currentSummary,actionChange,items,note:items.length?"只对照本次新保留的依据；表述变化不等于关系已转变。":fresh.length&&old.length?"本次保留的证据与前次重叠或不足以确认新变化，不据此认定关系没有变化。":"前次或本次缺少可定位的整体判断依据，暂不比较变化。"};
}
