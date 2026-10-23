"use client";
import {useId,useState} from "react";
import { reportPersonLabel } from "@/components/report-person-label";
import {BookOpen,ArrowUpRight,MessageCircle} from "lucide-react";
import {knowledgeManifest} from "@/lib/knowledge-public";
import {keyReportEvidence,replyContrasts,reportEvidenceDate} from "@/lib/report-reading";
import {relationshipRiskReview} from "@/lib/relationship-risk";
import type {Json} from "./client";
import {CaptureEvidence} from "./CaptureEvidence";
import styles from "./ReportReadingTools.module.css";
import {reportEvidenceSpeaker,reportIdentity} from "./report-context";

export function MethodReferences({sources}:{sources?:Json[]}){
 if(!Array.isArray(sources)||!sources.length)return null;
 const known=sources.flatMap(source=>{const doc=knowledgeManifest.documents.find(doc=>(source?.anchor&&doc.anchor===source.anchor)||(source?.id&&doc.id===source.id)||source?.label===doc.label);return doc?[{label:doc.label,anchor:doc.anchor}]:[];});
 const unique=known.filter((source,index,all)=>all.findIndex(other=>other.anchor===source.anchor)===index);
 if(!unique.length)return null;
 return <details className={styles.references} data-method-references><summary><BookOpen size={17}/>本次实际参考的方法 · {unique.length} 份</summary><div>{unique.map(source=><a href={"/library#"+encodeURIComponent(source.anchor)} target="_blank" rel="noopener noreferrer" key={source.anchor}>{source.label}<ArrowUpRight size={14}/></a>)}</div><p>文献提供分析方法；这次判断的个人依据仍是上面的材料。</p></details>;
}
function EvidenceQuote({text}:{text:string}){
 const [expanded,setExpanded]=useState(false),id=useId(),characters=Array.from(text),long=characters.length>150;
 return <><blockquote id={id}>{long&&!expanded?characters.slice(0,150).join("")+"…":text}</blockquote>{long&&<button type="button" className={styles.expandEvidence} aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(value=>!value)}>{expanded?"收起长依据":`展开完整依据 · ${characters.length} 字`}</button>}</>;
}
export function KeyEvidenceList({report,priorityEvidence,showReferences=true}:{report:Json;priorityEvidence?:string;showReferences?:boolean}){
 const semantic=report.semanticHistory||report.relationshipDiagnosis?.semanticHistory;
 const findings:Json[]=Array.isArray(semantic?.findings)?semantic.findings:[];
 const anchorIds=new Set(Array.isArray(semantic?.summaryEvidenceIds)?semantic.summaryEvidenceIds:[]);
 const anchors=[...findings.filter(row=>anchorIds.has(row.id)),...findings.filter(row=>!anchorIds.has(row.id))];
 const semanticItems=anchors.flatMap(finding=>(Array.isArray(finding.evidence)?finding.evidence:[]).map((evidence:Json)=>({text:String(evidence.quote||""),label:`${reportEvidenceSpeaker(report,evidence.senderRole,evidence.basis)}${evidence.at?" · "+reportEvidenceDate(evidence.at):""}`,sourceId:evidence.sourceId,libraryId:evidence.libraryId,sourceKind:evidence.sourceKind,basis:evidence.basis}))).filter(item=>item.text.trim());
 const risk=semanticItems.length?null:relationshipRiskReview(report);
 const riskItems=risk?.scope==="full-history"?risk.signals.flatMap(signal=>(signal.sources||[]).map(source=>({text:source.quote,label:`风险核实 · ${reportIdentity(report).other}说 · ${reportEvidenceDate(source.at)}`,sourceId:source.sourceId,libraryId:source.libraryId,sourceKind:"chat"}))):[];
 const normalize=(value:string)=>value.replace(/[\s\p{P}\p{S}]/gu,"");
 const candidates:Array<{text:string;label:string;sourceId?:string;libraryId?:string;sourceKind?:string;basis?:string}>=[...(priorityEvidence?keyReportEvidence(report,priorityEvidence).slice(0,1):[]),...semanticItems,...riskItems,...keyReportEvidence(report)];
 const items=candidates.filter((item,index,all)=>all.findIndex(other=>normalize(other.text)===normalize(item.text))===index).slice(0,3);
 return <div data-key-evidence>{items.length?<ol className={styles.evidenceList}>{items.map((item,index)=><li key={item.text}><small><b>{index+1}</b>{item.label}</small><EvidenceQuote text={item.text}/><CaptureEvidence quote={item.text} sourceIds={item.sourceId?[item.sourceId]:undefined} libraryId={item.libraryId} sourceKind={item.sourceKind} label={item.basis==="visual"?"查看图片来源":undefined}/></li>)}</ol>:<p className={styles.empty}>本轮暂未保留可引用的具体依据，不补造原话。</p>}{showReferences&&<MethodReferences sources={report.knowledgeSources||report.decision?.knowledgeSources}/>}</div>;
}
export function ReplyDifference({options,index}:{options:Json[];index:number}){
 const contrast=replyContrasts(options).find(row=>row.index===index);
 if(!contrast)return null;
 return <div className={styles.replyDifference} data-reply-difference><span><MessageCircle size={15}/>{contrast.features.join(" · ")}</span><p>{contrast.difference}</p></div>;
}
