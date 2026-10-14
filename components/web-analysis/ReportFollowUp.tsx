"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, FilePlus2, History, Sparkles } from "lucide-react";
import type { AutomaticRelationshipUpdate } from "@/lib/relationship-updates";
import { api, message, WebError, type Json } from "./client";
import "./report-follow-up.css";
import { RelationshipEvidenceCards } from "./RelationshipEvidenceCards";
export function ReportFollowUp({ report, owner }: { report: Json; owner?: string }) { return <Progress key={[owner,report.id,report.subjectId].join(":")} report={report} owner={owner || ""}/>; }
function Progress({ report, owner }: { report: Json; owner: string }) {
  const subjectId = String(report.subjectId || ""), reportId = String(report.id || "");
  const [update,setUpdate]=useState<AutomaticRelationshipUpdate|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false),[accessible,setAccessible]=useState(true);
  const generation=useRef(0);
  useEffect(()=>{
    const current=++generation.current,controller=new AbortController();
    setUpdate(null);setError("");setAccessible(true);
    if(!owner||!subjectId)return()=>controller.abort();
    setLoading(true);
    void(async()=>{try{
      const identity=await api("/api/account/credits",undefined,controller.signal);
      if(current!==generation.current||controller.signal.aborted)return;
      if(identity.account?.userId!==owner){setAccessible(false);return;}
      const result=await api("/api/web/relationship-feedback?subjectId="+encodeURIComponent(subjectId)+"&reportId="+encodeURIComponent(reportId),undefined,controller.signal);
      if(current!==generation.current||controller.signal.aborted)return;
      if(result.subjectId!==subjectId)throw new Error("人物信息已变化，请重新打开报告。");
      setUpdate(result.automatic||null);
    }catch(cause){if(controller.signal.aborted||current!==generation.current)return;if(cause instanceof WebError&&cause.status===401)setAccessible(false);else if(!(cause instanceof WebError&&[403,404].includes(cause.status)))setError(message(cause));}
    finally{if(current===generation.current&&!controller.signal.aborted)setLoading(false);}})();
    return()=>{controller.abort();generation.current++;};
  },[owner,subjectId,reportId]);
  if(!accessible)return <section className="wa-card report-follow-up"><p>账号已切换，请重新打开属于当前账号的报告。</p></section>;
  return <section className="wa-card report-follow-up rf-automatic" id="followup" aria-labelledby="report-follow-up-title">
    <div className="rf-heading"><div><span className="wa-eyebrow"><History size={16}/>接着这次，继续了解</span><h2 id="report-follow-up-title">{update?.headline||"有新聊天，直接补充就好"}</h2></div><span className="rf-free">自动结合已有资料</span></div>
    <p className="wa-muted">{subjectId?"补充这个人的新聊天，成子会对照之前的材料更新判断。":"下一次分析选择同一人物，就能把前后线索放在一起。"}</p>
    {loading&&<p role="status" className="wa-muted">正在对照已有分析…</p>}
    <RelationshipEvidenceCards review={update?.evidenceReview}/>
    {!update?.evidenceReview?.cards.length&&update?.current&&update.previous&&<details><summary>回看两次分析摘要</summary><div className="rf-observations"><article><span>本次分析摘要{update.current.date?" · "+update.current.date:""}</span><p>{update.current.summary}</p></article><article><span>此前分析摘要{update.previous.date?" · "+update.previous.date:""}</span><p>{update.previous.summary}</p><a href={"/report?id="+encodeURIComponent(update.previous.reportId)}>回看依据<ArrowRight size={14}/></a></article></div>{!!update.changes.length&&<div className="rf-changes">{update.changes.map(change=><div key={change.label}><Sparkles size={17}/><span>{change.label}</span><strong>{change.before}<ArrowRight size={14}/>{change.after}</strong></div>)}</div>}<p className="rf-note">{update.note}</p></details>}
    <div className="wa-actions rf-actions"><a className="rf-primary" href={"/analyze?mode=chat"+(subjectId?"&subjectId="+encodeURIComponent(subjectId):"")+(reportId?"&returnTo="+encodeURIComponent("/report?id="+reportId):"")}><FilePlus2 size={18}/>补充新聊天</a>{subjectId&&<a href={"/archive?subjectId="+encodeURIComponent(subjectId)+"&section=trend"}>查看完整进展<ArrowRight size={16}/></a>}</div>
    {error&&<p className="wa-error" role="alert">{error}</p>}
  </section>;
}
