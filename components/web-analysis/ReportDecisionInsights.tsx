"use client";

import { ChevronDown, Lightbulb, Quote } from "lucide-react";
import { projectReportDecisionInsights } from "@/lib/report-decision-insights";
import { reportEvidenceDate } from "@/lib/report-reading";
import { CaptureEvidence } from "./CaptureEvidence";
import { reportEvidenceSpeaker } from "./report-context";
import type { Json } from "./client";
import styles from "./ReportDecisionInsights.module.css";

const rows=(value:unknown):Json[]=>Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];
function preview(value:string){
 if(value.length<=110)return value;
 const stop=value.slice(0,110).match(/^.*?[。！？]/)?.[0];
 return stop||value.slice(0,110)+"…";
}

/** A concise reading of saved, traceable findings. Expanding never re-runs analysis. */
export function ReportDecisionInsights({report}:{report:Json}){
 const items=projectReportDecisionInsights(report);
 if(!items.length)return null;
 const semantic=report.semanticHistory||report.relationshipDiagnosis?.semanticHistory||{};
 const findings=rows(semantic.findings);
 return <section className={styles.section} data-report-decision-insights aria-label="关键判断与核实">
  <header><span><Lightbulb size={19}/>值得看清的细节</span></header>
  <div className={styles.grid}>{items.map((item,index)=>{
   const sources=findings.filter(finding=>item.evidenceIds.includes(finding.id)).flatMap(finding=>rows(finding.evidence)).filter((source,n,all)=>typeof source.quote==='string'&&source.quote.trim()&&all.findIndex(other=>other.libraryId===source.libraryId&&other.sourceId===source.sourceId&&other.quote===source.quote)===n);
   const compact=(value:string)=>value.replace(/\s+/g,'');
   const primary=sources.find(source=>item.observation&&compact(source.quote).includes(compact(item.observation)))||sources[0];
   const otherSources=sources.filter(source=>source!==primary);
   const sourceCard=(source:Json,n:number)=><div key={`${source.libraryId}:${source.sourceId}:${n}`}><small>{reportEvidenceSpeaker(report,source.senderRole,source.basis)}{source.at?` · ${reportEvidenceDate(source.at)}`:''}</small><blockquote>{source.quote}</blockquote><CaptureEvidence quote={source.quote} sourceIds={source.sourceId?[source.sourceId]:undefined} libraryId={source.libraryId} sourceKind={source.sourceKind} label={source.basis==='visual'?'核对图片来源':'核对这句原话'}/></div>;
   const short=preview(item.answer);
   return <article key={`${item.question}:${index}`} data-decision-insight data-insight-basis={item.basis}>
    <div className={styles.question}><span aria-hidden="true">{String(index+1).padStart(2,'0')}</span><h3>{item.question}</h3></div>
    <p className={styles.answer}>{short}</p>
    <details>
     <summary>查看判断依据<ChevronDown size={17}/></summary>
     <div className={styles.detail}>
      {short!==item.answer&&<p className={styles.fullAnswer}>{item.answer}</p>}
      {primary&&<div className={styles.evidence}><h4><Quote size={16}/>记录里实际出现了什么</h4>{sourceCard(primary,0)}{otherSources.length>0&&<details className={styles.moreSources}><summary>另有 {otherSources.length} 条依据<ChevronDown size={16}/></summary>{otherSources.map(sourceCard)}</details>}</div>}
      {item.alternative&&<div className={styles.alternative}><h4>原判断的限定说明</h4><p>{item.alternative}</p></div>}
      {item.whatWouldChange&&<div className={styles.change}><h4>什么会改变这个判断</h4><p>{item.whatWouldChange}</p></div>}
      {item.verify&&<div className={styles.verify}><h4>下一次可以怎么核实</h4><p>{item.verify}</p></div>}
     </div>
    </details>
    <small className={styles.basis}>{item.basis==='saved-finding'?'原报告线索':item.basis==='saved-guidance'?'已更新的建议依据':'依据解读'}</small>
   </article>;
  })}</div>
 </section>;
}
