"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowRight,History,Sparkles} from "lucide-react";
import type {AutomaticRelationshipUpdate} from "@/lib/relationship-updates";
import {riskAwarePresentation} from "@/lib/risk-aware-presentation";
import {reportUpdateHighlights} from "@/lib/report-update-highlights";
import {api,message,WebError,type Json} from "./client";
import "./report-follow-up.css";
import {RelationshipEvidenceCards} from "./RelationshipEvidenceCards";
export function ReportFollowUp({report,owner}:{report:Json;owner?:string}){
 return <Progress key={[owner,report.reportId||report.id,report.subjectId].join(":")} report={report} owner={owner||""}/>;
}
function Progress({report,owner}:{report:Json;owner:string}){
 const subjectId=String(report.subjectId||""),reportId=String(report.reportId||report.id||"");
 const [update,setUpdate]=useState<AutomaticRelationshipUpdate|null>(null),[error,setError]=useState(""),[accessible,setAccessible]=useState(true);
 const generation=useRef(0);
 useEffect(()=>{
  const current=++generation.current,controller=new AbortController();
  setUpdate(null);setError("");setAccessible(true);
  if(!owner||!subjectId||report.targetSelf)return()=>controller.abort();
  void(async()=>{try{
   const identity=await api("/api/account/credits",undefined,controller.signal);
   if(current!==generation.current||controller.signal.aborted)return;
   if(identity.account?.userId!==owner){setAccessible(false);return;}
   const result=await api("/api/web/relationship-feedback?subjectId="+encodeURIComponent(subjectId)+"&reportId="+encodeURIComponent(reportId),undefined,controller.signal);
   if(current!==generation.current||controller.signal.aborted)return;
   if(result.subjectId!==subjectId)throw new Error("人物信息已变化，请重新打开报告。");
   setUpdate(result.automatic||null);
  }catch(cause){if(controller.signal.aborted||current!==generation.current)return;if(cause instanceof WebError&&cause.status===401)setAccessible(false);else if(!(cause instanceof WebError&&[403,404].includes(cause.status)))setError(message(cause));}})();
  return()=>{controller.abort();generation.current++;};
 },[owner,subjectId,reportId]);
 if(!accessible||report.targetSelf||!owner||!subjectId)return null;
 const highlights=reportUpdateHighlights(update,reportId),risk=riskAwarePresentation(report);
 const displayedCards=risk.mode==="safety"?highlights.cards.map(card=>({...card,question:"",observe:risk.nextStep})):highlights.cards;
 if(!highlights.cards.length&&!highlights.changes.length){
  return highlights.compact?<p className="rf-compact" data-report-update="unchanged"><History size={16}/><span>{highlights.compact}</span>{update?.previous&&<a href={"/report?id="+encodeURIComponent(update.previous.reportId)}>前次依据<ArrowRight size={14}/></a>}</p>:error?<p className="wa-muted">前次材料暂未取回；不影响阅读本次报告。</p>:null;
 }
 return <section className="wa-card report-follow-up rf-automatic" id="followup" data-report-update="changed" aria-label="本次新增与变化">
  <div className="rf-heading"><h2><History size={21}/>{highlights.headline}</h2></div>
  {highlights.cards.length>0&&<RelationshipEvidenceCards review={{cards:displayedCards,note:update?.evidenceReview?.note||"只对照已保存的具体材料，不推断建议已经执行。"}}/>}
  {highlights.changes.length>0&&<><div className="rf-changes">{highlights.changes.map(change=><div key={change.label}><Sparkles size={17}/><span>{change.label}</span><strong>{change.before}<ArrowRight size={14}/>{change.after}</strong></div>)}</div><p className="rf-note">{update?.note}</p>{update?.current&&update.previous&&<details><summary>查看前后摘要依据</summary><div className="rf-observations"><article><span>本次 · {update.current.date}</span><p>{update.current.summary}</p></article><article><span>此前 · {update.previous.date}</span><p>{update.previous.summary}</p><a href={"/report?id="+encodeURIComponent(update.previous.reportId)}>回看依据<ArrowRight size={14}/></a></article></div></details>}</>}
  <a className="rf-history-link" href={"/archive?subjectId="+encodeURIComponent(subjectId)+"&section=trend"}>查看这个人的完整进展<ArrowRight size={15}/></a>
 </section>;
}
