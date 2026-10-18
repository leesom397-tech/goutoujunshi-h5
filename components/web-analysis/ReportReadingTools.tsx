"use client";
import { reportPersonLabel } from "@/components/report-person-label";
import {BookOpen,ArrowUpRight,MessageCircle} from "lucide-react";
import {knowledgeManifest} from "@/lib/knowledge-public";
import {keyReportEvidence,replyContrasts,reportEvidenceDate} from "@/lib/report-reading";
import {relationshipRiskReview} from "@/lib/relationship-risk";
import type {Json} from "./client";
import {CaptureEvidence} from "./CaptureEvidence";
import styles from "./ReportReadingTools.module.css";

export function MethodReferences({sources}:{sources?:Json[]}){
 if(!Array.isArray(sources)||!sources.length)return null;
 const unique=sources.filter((source,index,all)=>source?.label&&all.findIndex(other=>other?.label===source.label)===index).slice(0,6);
 if(!unique.length)return null;
 return <details className={styles.references} data-method-references><summary><BookOpen size={15}/>参考方法 · {unique.length} 条</summary><div>{unique.map((source,index)=>{
  const doc=knowledgeManifest.documents.find(doc=>(source.anchor&&doc.anchor===source.anchor)||(source.id&&doc.id===source.id)||doc.label===source.label);
  return doc?<a href={"/library#"+encodeURIComponent(doc.anchor)} target="_blank" rel="noopener noreferrer" key={index}>{source.label}<ArrowUpRight size={14}/></a>:<span key={index}>{source.label}</span>;
 })}</div><p>文献提供分析方法；这次判断的个人依据仍是上面的材料。</p></details>;
}
export function KeyEvidenceList({report,priorityEvidence,showReferences=true}:{report:Json;priorityEvidence?:string;showReferences?:boolean}){
 const semantic=report.semanticHistory||report.relationshipDiagnosis?.semanticHistory;
 const findings:Json[]=Array.isArray(semantic?.findings)?semantic.findings:[];
 const anchorIds=new Set(Array.isArray(semantic?.summaryEvidenceIds)?semantic.summaryEvidenceIds:[]);
 const anchors=[...findings.filter(row=>anchorIds.has(row.id)),...findings.filter(row=>!anchorIds.has(row.id))];
 const semanticItems=anchors.flatMap(finding=>(Array.isArray(finding.evidence)?finding.evidence:[]).map((evidence:Json)=>({text:String(evidence.quote||""),label:`${evidence.basis==="visual"?"图片可见内容":reportPersonLabel(evidence.senderRole)}${evidence.at?" · "+reportEvidenceDate(evidence.at):""}`,sourceId:evidence.sourceId,libraryId:evidence.libraryId,sourceKind:evidence.sourceKind,basis:evidence.basis}))).filter(item=>item.text.trim());
 const risk=semanticItems.length?null:relationshipRiskReview(report);
 const riskItems=risk?.scope==="full-history"?risk.signals.flatMap(signal=>(signal.sources||[]).map(source=>({text:source.quote,label:`风险核实 · 对方 · ${reportEvidenceDate(source.at)}`,sourceId:source.sourceId,libraryId:source.libraryId,sourceKind:"chat"}))):[];
 const normalize=(value:string)=>value.replace(/[\s\p{P}\p{S}]/gu,"");
 const candidates:Array<{text:string;label:string;sourceId?:string;libraryId?:string;sourceKind?:string;basis?:string}>=[...(priorityEvidence?keyReportEvidence(report,priorityEvidence).slice(0,1):[]),...semanticItems,...riskItems,...keyReportEvidence(report)];
 const items=candidates.filter((item,index,all)=>all.findIndex(other=>normalize(other.text)===normalize(item.text))===index).slice(0,3);
 return <div data-key-evidence>{items.length?<ol className={styles.evidenceList}>{items.map((item,index)=><li key={index}><small><b>{index+1}</b>{item.label}</small><blockquote>{item.text.length>150?item.text.slice(0,150)+"…":item.text}</blockquote><CaptureEvidence quote={item.text} sourceIds={item.sourceId?[item.sourceId]:undefined} libraryId={item.libraryId} sourceKind={item.sourceKind} label={item.basis==="visual"?"查看图片来源":undefined}/></li>)}</ol>:<p className={styles.empty}>本轮暂未保留可引用的具体依据，不补造原话。</p>}{showReferences&&<MethodReferences sources={report.knowledgeSources||report.decision?.knowledgeSources}/>}</div>;
}
export function ReplyDifference({options,index}:{options:Json[];index:number}){
 const contrast=replyContrasts(options).find(row=>row.index===index);
 if(!contrast)return null;
 return <div className={styles.replyDifference} data-reply-difference><span><MessageCircle size={15}/>{contrast.features.join(" · ")}</span><p>{contrast.difference}</p></div>;
}
