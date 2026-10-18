"use client";

import { useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Heart, Images, ScanEye, UserRound } from "lucide-react";
import { reportEvidenceDate } from "@/lib/report-reading";
import { riskAwarePresentation } from "@/lib/risk-aware-presentation";
import { reportAffinity, validScore } from "./report-data";
import { CaptureEvidence } from "./CaptureEvidence";
import { RelationshipDiagnosisPanel } from "./RelationshipDiagnosisPanel";
import type { Json } from "./client";
import styles from "./HistoryReportInsights.module.css";

const rows=(value:unknown):Json[]=>Array.isArray(value)?value.filter(item=>item&&typeof item==="object"):[];
const text=(value:unknown)=>typeof value==="string"?value.trim():"";
const norm=(value:unknown)=>text(value).replace(/[\s\p{P}\p{S}]/gu,"");
const count=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0?Number(value):null;
function sources(finding:Json){return rows(finding.evidence).filter(item=>text(item.quote));}
function data(report:Json){
 const semantic=report.semanticHistory||report.relationshipDiagnosis?.semanticHistory||{};
 const coverage=rows(report.sourceCoverage),momentLibraries=new Set([...coverage,...rows(report.relatedSnapshots)].filter(row=>row.kind==="moments").map(row=>row.libraryId));
 const isMoment=(item:Json)=>item.sourceKind==="moments"||item.kind==="moments"||momentLibraries.has(item.libraryId)&&!!item.libraryId;
 const findings=rows(semantic.findings).filter((item,index,all)=>text(item.claim)&&sources(item).length&&all.findIndex(other=>norm(other.claim)===norm(item.claim))===index);
 return {semantic,coverage,findings,isMoment};
}
function SourceLinks({findings}:{findings:Json[]}){
 const all=findings.flatMap(sources),unique=all.filter((item,index)=>all.findIndex(other=>other.libraryId===item.libraryId&&other.sourceId===item.sourceId&&other.quote===item.quote)===index);
 const groups=new Map<string,Json[]>();
 for(const item of unique){const key=JSON.stringify([item.libraryId||"",item.sourceKind||"chat"]);groups.set(key,[...(groups.get(key)||[]),item]);}
 return <div className={styles.sources}>{[...groups].map(([key,items])=><span key={key}><CaptureEvidence quote={items.length===1?items[0].quote:undefined} sourceIds={items.map(item=>item.sourceId).filter(Boolean)} libraryId={items[0].libraryId} sourceKind={items[0].sourceKind} label={`${items[0].sourceKind==="moments"?"朋友圈":"聊天"} · 查看 ${items.length} 条依据`}/></span>)}</div>;
}
function referenced(value:unknown,findings:Json[]){return Array.isArray(value)?findings.filter(row=>value.includes(row.id)):[];}

export function HistoryReportReading({report,diagnosis}:{report:Json;diagnosis?:Json|null}){
 const [active,setActive]=useState("interaction"),id=useId(),root=useRef<HTMLElement>(null);
 const sections=[{id:"interaction",label:"互动与推理",Icon:Heart},{id:"profile",label:"人物解读",Icon:UserRound},{id:"moments",label:"朋友圈与图片",Icon:Images}];
 function select(next:string){setActive(next);if((root.current?.getBoundingClientRect().top??0)<100)root.current?.scrollIntoView({block:"start",behavior:"instant"});}
 return <section ref={root} className={styles.reading} aria-label="完整报告解读" data-history-reading>
  <div className={styles.sectionTabs} role="tablist" aria-label="选择详细解读">{sections.map(({id:key,label,Icon},index)=><button key={key} type="button" role="tab" id={`${id}-tab-${key}`} aria-controls={`${id}-panel`} aria-selected={active===key} tabIndex={active===key?0:-1} onClick={()=>select(key)} onKeyDown={event=>{if(!["ArrowRight","ArrowLeft","Home","End"].includes(event.key))return;event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?sections.length-1:(index+(event.key==="ArrowRight"?1:-1)+sections.length)%sections.length;select(sections[next].id);document.getElementById(`${id}-tab-${sections[next].id}`)?.focus({preventScroll:true});}}><Icon size={19}/><span>{label}</span></button>)}</div>
  <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${active}`}>
   {active==="interaction"&&<HistoryReportInsights report={report} diagnosis={diagnosis}/>}
   {active==="profile"&&<HistoryProfileInsights report={report}/>}
   {active==="moments"&&<HistoryMomentsInsights report={report}/>}
  </div>
 </section>;
}

/** The full-history reader must expose saved reasoning even when lines=[];
 * those lines are only the optional, newly uploaded sentence-analysis input. */
export function HistoryReportInsights({report,diagnosis}:{report:Json;diagnosis?:Json|null}){
 const {semantic,findings,isMoment}=data(report),chatFindings=findings.filter(row=>sources(row).some(item=>!isMoment(item)));
 const affinity=reportAffinity(report),known=validScore(affinity?.value),risk=riskAwarePresentation(report);
 const counterIds=new Set(Array.isArray(semantic.counterEvidenceIds)?semantic.counterEvidenceIds:[]);
 const unknowns=Array.isArray(semantic.unknowns)?semantic.unknowns.filter((value:unknown)=>text(value)):[];
 const signals=rows(semantic.affinitySignals).map(item=>({...item,evidence:referenced(item.evidenceIds,findings)} as Json)).filter(item=>text(item.signal)&&text(item.meaning)&&item.evidence.length&&["support","counter","uncertain"].includes(item.direction));
 const coverage=semantic.coverage||{},read=count(coverage.analyzedText),received=count(coverage.receivedText);
 return <section className={styles.section} id="report-history-reasoning" data-history-insights>
  <header className={styles.heading}><div><span><Heart size={18}/>互动与人物解读</span><h2>好感与互动信号</h2></div>{known&&<div className={styles.affinity} data-history-affinity><small>已有互动信号参考</small><strong>{Math.round(affinity!.value)}<small> / 100</small></strong><span>不是喜欢你的概率</span></div>}</header>
  <p className={styles.lead}>{risk.mode!=="normal"?risk.title||"先核实边界与风险，再考虑推进。":"结合回应、实际投入与边界，理解对方在这段关系中的表现。"}</p>
  {affinity&&<p className={styles.scope}>{count(affinity.contextCount)!==null?`信号评估实际读取 ${affinity.contextCount} 条；` : "这份旧信号结果未记录评估范围；"}{affinity.unavailableReason||"数字不能代替原话与行动依据。"}</p>}
  <dl className={styles.signalCounts}><div><dt>可回看线索</dt><dd>{findings.length}<small> 条</small></dd></div><div><dt>相反或保留证据</dt><dd>{findings.filter(row=>counterIds.has(row.id)).length}<small> 条</small></dd></div><div><dt>仍待确认</dt><dd>{unknowns.length}<small> 项</small></dd></div></dl>
  {read!==null&&received!==null&&<p className={styles.scope}>已解读 {read} / {received} 条可读文字{semantic.status!=="complete"?" · 尚未全部完成":""}。这里展示可核对的线索，不把聊天条数换算成好感。</p>}
  {!findings.length&&!text(semantic.explanation)&&<p className={styles.empty}>这份报告尚未保存可回看的深层互动解读。已有统计仍可查看，暂不补造好感分数。</p>}
  {signals.length>0&&<div className={styles.affinitySignals} data-affinity-signals>{signals.slice(0,6).map((item,index)=><article key={index} data-direction={item.direction}><small>{item.direction==="support"?"支持靠近的信号":item.direction==="counter"?"需要保留的判断":"还不能确定"}</small><h3>{item.signal}</h3><p>{item.meaning}</p>{text(item.alternative)&&<p className={styles.alternative}>也可能：{item.alternative}</p>}<SourceLinks findings={item.evidence}/></article>)}</div>}
  <RelationshipDiagnosisPanel diagnosis={diagnosis} semanticHistory={{...semantic,findings:chatFindings}} hideCoverage hideFacts={!!report.chatActivity} pageSize={3}/>
 </section>;
}

function HistoryProfileInsights({report}:{report:Json}){
 const {semantic,findings}=data(report);
 const profile:Json[]=rows(semantic.profileInsights).map(item=>({...item,evidence:referenced(item.evidenceIds,findings)} as Json)).filter(item=>text(item.dimension)&&text(item.reading)&&item.evidence.length&&norm(item.reading)!==norm(semantic.explanation)&&norm(item.reading)!==norm(semantic.summary));
 return <section className={styles.section} data-profile-insights>
  <header className={styles.heading}><div><span><UserRound size={18}/>从互动理解这个人</span><h2>TA 怎样表达、投入和相处</h2></div></header>
  {profile.length>0?<div className={styles.profileReadings}>{profile.map((item,index)=><article key={item.dimension+index}><h3>{item.dimension}</h3><p>{item.reading}</p>{sources(item.evidence[0]).slice(0,1).map((source,i)=><blockquote key={i}>{source.quote}</blockquote>)}{text(item.alternative)&&<p className={styles.alternative}>另一种可能：{item.alternative}</p>}<SourceLinks findings={item.evidence}/></article>)}</div>:<><p className={styles.empty}>这份旧报告没有保存独立的人物解读。下面保留已有的行为线索，不把它们推断成固定性格。</p><RelationshipDiagnosisPanel semanticHistory={{findings,unknowns:semantic.unknowns}} hideCoverage hideFacts pageSize={3}/></>}
 </section>;
}

export function HistoryMomentsInsights({report}:{report:Json}){
 const {semantic,coverage,findings,isMoment}=data(report),[page,setPage]=useState(0),[imagePage,setImagePage]=useState(0);
 const momentCoverage=coverage.filter(row=>row.kind==="moments"),momentFindings=findings.filter(row=>sources(row).some(isMoment));
 const snapshots=rows(report.relatedSnapshots).filter(row=>row.kind==="moments");
 const knownCounts=(momentCoverage.length?momentCoverage.map(row=>count(row.total)):snapshots.map(row=>count(row.total??row.expectedTotal))).filter((value):value is number=>value!==null);
 const total=knownCounts.length?knownCounts.reduce((sum,value)=>sum+value,0):null;
 const visual=rows(report.mediaEvidence).filter(item=>text(item.observation)),uniqueVisual=visual.filter((item,index,all)=>all.findIndex(other=>other.libraryId===item.libraryId&&other.sourceId===item.sourceId&&norm(other.observation)===norm(item.observation))===index);
 const insight=semantic.sourceInsights?.moments,insightEvidence=referenced(insight?.evidenceIds,findings),cross=insight?.crossSource,crossEvidence=referenced(cross?.evidenceIds,findings);
 const summary=insightEvidence.some(row=>sources(row).some(isMoment))?text(insight?.summary):"";
 const crossSupported=crossEvidence.some(row=>sources(row).some(isMoment))&&crossEvidence.some(row=>sources(row).some(item=>!isMoment(item)));
 const pages=Math.max(1,Math.ceil(momentFindings.length/3)),current=Math.min(page,pages-1),imagePages=Math.max(1,Math.ceil(uniqueVisual.length/3)),currentImage=Math.min(imagePage,imagePages-1);
 const imported=total!==null?total>0:momentFindings.length>0||visual.some(isMoment);
 const expected=coverage.reduce((sum,row)=>sum+(count(row.imagesExpected)||0),0),analyzed=coverage.reduce((sum,row)=>sum+(count(row.imagesAnalyzed)||0),0);
 return <section className={styles.section} id="report-history-moments" data-history-moments>
  <header className={styles.heading}><div><span><Images size={18}/>聊天之外的材料</span><h2>朋友圈与图片</h2></div></header>
  <div className={styles.materialScope}><span>{total!==null?`已导入 ${total} 条朋友圈`:imported?"已保留朋友圈线索":"未导入朋友圈到这份报告"}</span>{expected>0&&<span>图片已解读 {analyzed} / {expected} 张</span>}</div>
  {!imported&&<p className={styles.empty}>当前判断基于这份报告中的聊天材料。补充同一位好友的朋友圈后，再看自我呈现与聊天是否一致。</p>}
  {summary&&<div className={styles.sourceSummary} data-moments-synthesis><p>{summary}</p><SourceLinks findings={insightEvidence}/></div>}
  {imported&&!momentFindings.length&&!summary&&<p className={styles.empty}>朋友圈材料已保留，这份报告尚未提供可核对的朋友圈解读，不能把已导入当成已经分析。</p>}
  <div className={styles.findings}>{momentFindings.slice(current*3,(current+1)*3).map((finding,index)=><article key={finding.id||index} data-moments-finding><h3>{finding.claim}</h3>{sources(finding).filter(isMoment).slice(0,2).map((item,n)=><div key={`${item.sourceId}:${n}`}><small>{item.basis==="visual"?"图片可见内容":"朋友圈原话"}{item.at?` · ${reportEvidenceDate(item.at)}`:""}</small><blockquote>{item.quote}</blockquote><CaptureEvidence quote={item.quote} sourceIds={item.sourceId?[item.sourceId]:undefined} libraryId={item.libraryId} sourceKind="moments" label={item.basis==="visual"?"查看图片来源":"回看这条朋友圈"}/></div>)}{text(finding.alternative)&&<p className={styles.alternative}>也可能：{finding.alternative}</p>}</article>)}</div>
  {pages>1&&<nav className={styles.pager} aria-label="朋友圈线索分页"><button disabled={!current} onClick={()=>setPage(current-1)}><ArrowLeft size={16}/>上一组</button><span>{current+1} / {pages}</span><button disabled={current===pages-1} onClick={()=>setPage(current+1)}>下一组<ArrowRight size={16}/></button></nav>}
  {crossSupported&&text(cross.summary)&&<div className={styles.sourceSummary} data-cross-source-reading><h3>放回聊天一起看</h3><p>{cross.summary}</p><SourceLinks findings={crossEvidence}/></div>}
  {Array.isArray(insight?.unknowns)&&insight.unknowns.some((value:unknown)=>text(value))&&<div className={styles.unknowns}><strong>还需要核实</strong><ul>{insight.unknowns.filter((value:unknown)=>text(value)).map((value:string)=><li key={value}>{value}</li>)}</ul></div>}
  {uniqueVisual.length>0&&<section className={styles.visuals} data-history-images><h3><ScanEye size={19}/>图片里实际看到了什么</h3><p className={styles.scope}>以下来自已同步的预览或采集画面，只描述可见内容。</p>{uniqueVisual.slice(currentImage*3,(currentImage+1)*3).map((item,index)=><article key={item.mediaId||index}><small>{item.kind==="moments"?"朋友圈图片":"聊天图片"}{item.at?` · ${reportEvidenceDate(item.at)}`:""}</small><p>{item.observation}</p><CaptureEvidence quote={item.observation} sourceIds={item.sourceId?[item.sourceId]:undefined} libraryId={item.libraryId} sourceKind={item.kind} label="查看图片来源"/></article>)}{imagePages>1&&<nav className={styles.pager} aria-label="图片解读分页"><button disabled={!currentImage} onClick={()=>setImagePage(currentImage-1)}><ArrowLeft size={16}/>上一组</button><span>{currentImage+1} / {imagePages}</span><button disabled={currentImage===imagePages-1} onClick={()=>setImagePage(currentImage+1)}>下一组<ArrowRight size={16}/></button></nav>}</section>}
  {expected>analyzed&&<p className={styles.empty}>另有 {expected-analyzed} 张图片尚未完成解读，不计入已读图片依据。</p>}
 </section>;
}
