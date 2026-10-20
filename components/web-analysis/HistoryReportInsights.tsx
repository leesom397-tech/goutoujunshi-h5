"use client";

import {captureMaterialLabel,captureProfileMaterial} from "@/lib/capture-material";
import { useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Heart, Images, ScanEye, UserRound, MessageCircle, ChartNoAxesCombined, ShieldCheck, Send } from "lucide-react";
import { reportEvidenceDate } from "@/lib/report-reading";
import { riskAwarePresentation } from "@/lib/risk-aware-presentation";
import { reportAffinity, validScore } from "./report-data";
import { CaptureEvidence } from "./CaptureEvidence";
import { RelationshipDiagnosisPanel } from "./RelationshipDiagnosisPanel";
import { ReportReplyPreview } from "./ReportBrief";
import { intakeHref } from "./intake-navigation";
import { withAnalysisFocus, captureMomentsSupplementHref } from "@/lib/person-analysis-navigation";
import { relationshipRiskReview } from "@/lib/relationship-risk";
import {reportIdentity,reportEvidenceSpeaker,reportGoal} from "./report-context";
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
 const findings=rows(semantic.findings).filter((item,index,all)=>text(item.claim)&&sources(item).length&&all.findIndex(other=>item.id?other.id===item.id:other.subject===item.subject&&norm(other.claim)===norm(item.claim)&&JSON.stringify(sources(other))===JSON.stringify(sources(item)))===index);
 return {semantic,coverage,findings,isMoment};
}
function SourceLinks({findings}:{findings:Json[]}){
 const all=findings.flatMap(sources),unique=all.filter((item,index)=>all.findIndex(other=>other.libraryId===item.libraryId&&other.sourceId===item.sourceId&&other.quote===item.quote)===index);
 const groups=new Map<string,Json[]>();
 for(const item of unique){const key=JSON.stringify([item.libraryId||"",item.sourceKind||"chat"]);groups.set(key,[...(groups.get(key)||[]),item]);}
 return <div className={styles.sources}>{[...groups].map(([key,items])=><span key={key}><CaptureEvidence quote={items.length===1?items[0].quote:undefined} sourceIds={items.map(item=>item.sourceId).filter(Boolean)} libraryId={items[0].libraryId} sourceKind={items[0].sourceKind} label={`${items[0].sourceKind==="moments"?"朋友圈":"聊天"} · 查看 ${items.length} 条依据`}/></span>)}</div>;
}
function referenced(value:unknown,findings:Json[]){return Array.isArray(value)?findings.filter(row=>value.includes(row.id)):[];}
function EvidenceQuotes({report,findings,limit=2}:{report:Json;findings:Json[];limit?:number}){
 const quotes=findings.flatMap(sources).filter((item,index,all)=>all.findIndex(other=>other.sourceId===item.sourceId&&other.libraryId===item.libraryId)===index).slice(0,limit);
 return <div className={styles.namedEvidence}>{quotes.map((item,index)=><div key={index} data-named-evidence><small>{reportEvidenceSpeaker(report,item.senderRole,item.basis)} · {captureMaterialLabel(item)}{item.at&&!captureProfileMaterial(item)?` · ${reportEvidenceDate(item.at)}`:""}</small><blockquote>{item.quote}</blockquote><CaptureEvidence quote={item.quote} sourceIds={item.sourceId?[item.sourceId]:undefined} libraryId={item.libraryId} sourceKind={item.sourceKind}/></div>)}</div>;
}
function riskItems(report:Json){
 const {semantic,findings}=data(report),assessment=semantic.riskAssessment;
 const assessedItems=rows(assessment?.items).map(item=>({...item,evidence:referenced(item.evidenceIds,findings)} as Json)).filter(item=>item.subject==='other'&&item.evidence.length);
 if(assessedItems.length)return assessedItems;
 return relationshipRiskReview(report).signals.filter(item=>item.sources?.length).map((item,index)=>({id:`saved-risk-${index}`,title:item.title,subject:'other',meaning:item.reading,alternative:item.alternative,evidence:[{evidence:item.sources!.flatMap(source=>[{...source,senderRole:'other',sourceKind:'chat'},...(source.response?[{...source.response,senderRole:'self',sourceKind:'chat',libraryId:source.libraryId}]:[])])}],resolution:{status:'unknown',reading:'这份报告未保存后来是否已澄清的判断，请结合后续原话核对。'},verify:{action:item.action},timeRange:{start:item.firstAt,end:item.lastAt}} as Json));
}
function RiskVerification({report}:{report:Json}){
 const {semantic,findings}=data(report),items=riskItems(report),identity=reportIdentity(report),[page,setPage]=useState(0),root=useRef<HTMLElement>(null);
 const index=Math.min(page,Math.max(0,items.length-1)),item=items[index];
 function turn(next:number){setPage(next);requestAnimationFrame(()=>root.current?.scrollIntoView({block:'start',behavior:'instant'}));}
 return <section ref={root} className={styles.section} data-history-risk-verification><header className={styles.heading}><div><span><ShieldCheck size={18}/>核对原话和后续</span><h2>{identity.other}的哪些表达需要核实</h2></div></header>
  {item?<article className={styles.riskVerification} data-risk-verification-item><h3>{item.title}</h3><p>{item.meaning}</p><EvidenceQuotes report={report} findings={item.evidence} limit={3}/><h4>后来有没有澄清</h4><p>{item.resolution?.reading||'当前没有保存可核对的后续澄清，暂不能认定已经解决。'}</p><EvidenceQuotes report={report} findings={referenced(item.resolution?.evidenceIds,findings)}/>{text(item.alternative)&&<p className={styles.alternative}>另一种解释：{item.alternative}</p>}{text(item.verify?.action)&&<div className={styles.verificationTask}><h4>你要核实的这件事</h4><p>{item.verify.action}</p></div>}</article>:<p className={styles.empty}>{semantic.riskAssessment?.summary||relationshipRiskReview(report).summary||'这份报告没有保存足够的风险原话，不能把缺少线索当成已经排除风险。'}</p>}
  {items.length>1&&<nav className={styles.pager} aria-label="风险证据分页"><button disabled={!index} onClick={()=>turn(index-1)}><ArrowLeft size={16}/>上一项</button><span>{index+1} / {items.length}</span><button disabled={index===items.length-1} onClick={()=>turn(index+1)}>下一项<ArrowRight size={16}/></button></nav>}
 </section>;
}

function momentsState(report:Json){
 const {semantic,coverage,findings,isMoment}=data(report),momentRows=coverage.filter(row=>row.kind==="moments"),snapshots=rows(report.relatedSnapshots).filter(row=>row.kind==="moments");
 const counts=(momentRows.length?momentRows.map(row=>count(row.momentCount??row.total)):snapshots.map(row=>count(row.total??row.expectedTotal))).filter((value):value is number=>value!==null);
 const total=counts.length?counts.reduce((sum,value)=>sum+value,0):null,matched=findings.filter(row=>sources(row).some(isMoment));
 const refs=referenced(semantic.sourceInsights?.moments?.evidenceIds,findings),summary=refs.some(row=>sources(row).some(isMoment))?text(semantic.sourceInsights.moments.summary):"";
 return {total,matched,summary,profileTotal:rows(report.profileMaterials).length,imported:rows(report.profileMaterials).length>0|| (total!==null?total>0:matched.length>0||rows(report.mediaEvidence).some(isMoment)),hasCoverage:momentRows.length>0||snapshots.length>0};
}
export function HistoryReportEntry({report,onSelect}:{report:Json;onSelect:(section:string)=>void}){
 const {semantic}=data(report),moments=momentsState(report),affinity=reportAffinity(report),momentOnly=report.captureKind==="moments",identity=reportIdentity(report);
 const score=validScore(affinity?.value)?Math.round(affinity!.value):null,partial=typeof affinity?.contextCount==="number"&&affinity.contextCount<(semantic.coverage?.receivedText||0);
 const upload=withAnalysisFocus(intakeHref("/analyze",{mode:"chat",subjectId:report.subjectId||"",returnTo:report.reportId||report.id?`/report?id=${report.reportId||report.id}`:""}),"intent");
 return <section className={styles.entry} aria-label="快速查看报告内容" data-history-entry data-moments-only={momentOnly||undefined}>
  {!momentOnly&&<button type="button" data-open-affinity onClick={()=>onSelect("interaction")}><span><Heart size={20}/>{identity.other}对你的好感度</span><strong>{score!==null&&!partial?<>{score}<small> / 100</small></>:partial?"需更新完整评估":"暂无可靠参考分"}</strong><small><span>{score!==null&&!partial?"互动参考值 · 看依据与限制":"先看真实好感信号与判断依据"}</span><ArrowRight size={16}/></small></button>}
  <button type="button" data-open-moments onClick={()=>onSelect("moments")}><span><Images size={20}/>朋友圈分析</span><strong>{moments.total!==null?`${moments.total} 条动态${moments.profileTotal?` · ${moments.profileTotal} 项封面／签名`:""}`:moments.imported?"已有动态线索":rows(report.sourceCoverage).length?"本报告未关联动态":"旧报告未记录动态范围"}</strong><small><span>{moments.summary?moments.summary:moments.imported?"查看动态、图片与聊天的联系":"打开核对材料范围"}</span><ArrowRight size={16}/></small></button>
  <a href={upload} data-new-sentence-analysis><span><MessageCircle size={20}/>{momentOnly?"上传聊天截图":"逐句意图"}</span><strong>{momentOnly?"再看 TA 怎么说":"上传新聊天，逐句看懂"}</strong><small><span>{momentOnly?"带上前后对话，再判断互动":"只解读这次新上传的部分"}</span><ArrowRight size={16}/></small></a>
 </section>;
}

export function HistoryReportReading({report,diagnosis,section,onSectionChange}:{report:Json;diagnosis?:Json|null;section?:string;onSectionChange?:(section:string)=>void}){
 const [local,setLocal]=useState(report.captureKind==="moments"?"moments":"interaction"),id=useId(),root=useRef<HTMLElement>(null),active=section||local;
 const sections=report.captureKind==="moments"?[{id:"moments",label:"朋友圈与图片",Icon:Images},{id:"profile",label:"人物解读",Icon:UserRound}]:[{id:"interaction",label:"好感与推理",Icon:Heart},{id:"profile",label:"人物解读",Icon:UserRound},{id:"moments",label:"朋友圈与图片",Icon:Images},{id:"risk",label:"风险与边界",Icon:ShieldCheck}];
 function select(next:string){setLocal(next);onSectionChange?.(next);if((root.current?.getBoundingClientRect().top??0)<100)root.current?.scrollIntoView({block:"start",behavior:"instant"});}
 return <section ref={root} className={styles.reading} aria-label="完整报告解读" data-history-reading>
  <div className={styles.sectionTabs} style={{gridTemplateColumns:`repeat(${sections.length},minmax(0,1fr))`}} role="tablist" aria-label="选择详细解读">{sections.map(({id:key,label,Icon},index)=><button key={key} type="button" role="tab" id={`${id}-tab-${key}`} aria-controls={`${id}-panel`} aria-selected={active===key} tabIndex={active===key?0:-1} onClick={()=>select(key)} onKeyDown={event=>{if(!["ArrowRight","ArrowLeft","Home","End"].includes(event.key))return;event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?sections.length-1:(index+(event.key==="ArrowRight"?1:-1)+sections.length)%sections.length;select(sections[next].id);document.getElementById(`${id}-tab-${sections[next].id}`)?.focus({preventScroll:true});}}><Icon size={19}/><span>{label}</span></button>)}</div>
  <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${active}`}>
   {active==="interaction"&&<HistoryReportInsights report={report} diagnosis={diagnosis}/>}
   {active==="profile"&&<HistoryProfileInsights report={report}/>}
   {active==="moments"&&<HistoryMomentsInsights report={report}/> }
   {active==="risk"&&<><RiskVerification report={report}/><RiskResponsePaths report={report}/></>}
  </div>
 </section>;
}

/** The full-history reader must expose saved reasoning even when lines=[];
 * those lines are only the optional, newly uploaded sentence-analysis input. */
export function HistoryReportInsights({report,diagnosis}:{report:Json;diagnosis?:Json|null}){
 const {semantic,findings,isMoment}=data(report),chatFindings=findings.filter(row=>sources(row).some(item=>!isMoment(item))),identity=reportIdentity(report);
 const affinity=reportAffinity(report),partial=typeof affinity?.contextCount==="number"&&affinity.contextCount<(semantic.coverage?.receivedText||0),known=validScore(affinity?.value)&&!partial,risk=riskAwarePresentation(report);
 const counterIds=new Set(Array.isArray(semantic.counterEvidenceIds)?semantic.counterEvidenceIds:[]);
 const unknowns=Array.isArray(semantic.unknowns)?semantic.unknowns.filter((value:unknown)=>text(value)):[];
 const signals=rows(semantic.affinitySignals).map(item=>({...item,evidence:referenced(item.evidenceIds,findings)} as Json)).filter(item=>text(item.signal)&&text(item.meaning)&&(!item.subject||item.subject==='other')&&(!item.toward||item.toward==='self')&&item.evidence.some((finding:Json)=>sources(finding).some(source=>source.senderRole==='other'&&source.basis!=='visual'&&!isMoment(source)))&&["support","counter","uncertain"].includes(item.direction));
 const coverage=semantic.coverage||{},read=count(coverage.analyzedText),received=count(coverage.receivedText);
 return <section className={styles.section} id="report-history-reasoning" data-history-insights>
  <header className={styles.heading}><div><span><Heart size={18}/>互动与人物解读</span><h2>{identity.other}对你的好感信号</h2></div>{known&&<div className={styles.affinity} data-history-affinity><small>已有互动信号参考</small><strong>{Math.round(affinity!.value)}<small> / 100</small></strong><span>不是喜欢你的概率</span></div>}</header>
  <p className={styles.lead}>{risk.mode!=="normal"?risk.title||"先核实边界与风险，再考虑推进。":"结合回应、实际投入与边界，理解对方在这段关系中的表现。"}</p>
  {affinity&&<p className={styles.scope}>{count(affinity.contextCount)!==null?`信号评估实际读取 ${affinity.contextCount} 条；` : "这份旧信号结果未记录评估范围；"}{affinity.unavailableReason||"数字不能代替原话与行动依据。"}</p>}
  {partial&&<p className={styles.scope}>这份旧信号评分只覆盖了部分记录，需重新生成完整报告后查看全部资料的参考分。</p>}
  {!partial&&rows(affinity?.dimensions).some(item=>validScore(item.value))&&<div className={styles.dimensions} data-history-affinity-dimensions>{rows(affinity?.dimensions).map((item,index)=><article key={item.key||index}><header><strong>{item.label||item.key}</strong><span>{validScore(item.value)?Math.round(item.value):"待了解"}</span></header>{validScore(item.value)&&<i><b style={{width:`${item.value}%`}}/></i>}{text(item.reason)&&<p>{item.reason}</p>}<SourceLinks findings={referenced(item.evidenceIds,findings)}/></article>)}</div>}
  <dl className={styles.signalCounts}><div><dt>可回看线索</dt><dd>{findings.length}<small> 条</small></dd></div><div><dt>相反或保留证据</dt><dd>{findings.filter(row=>counterIds.has(row.id)).length}<small> 条</small></dd></div><div><dt>仍待确认</dt><dd>{unknowns.length}<small> 项</small></dd></div></dl>
  {read!==null&&received!==null&&<p className={styles.scope}>已解读 {read} / {received} 条可读文字{semantic.status!=="complete"?" · 尚未全部完成":""}。这里展示可核对的线索，不把聊天条数换算成好感。</p>}
  {!findings.length&&!text(semantic.explanation)&&<p className={styles.empty}>这份报告尚未保存可回看的深层互动解读。已有统计仍可查看，暂不补造好感分数。</p>}
  {signals.length>0&&<div className={styles.affinitySignals} data-affinity-signals>{signals.slice(0,6).map((item,index)=><article key={index} data-direction={item.direction}><small>{item.direction==="support"?"支持靠近的信号":item.direction==="counter"?"需要保留的判断":"还不能确定"}</small><h3>{item.signal}</h3><p>{item.meaning}</p>{text(item.alternative)&&<p className={styles.alternative}>也可能：{item.alternative}</p>}<SourceLinks findings={item.evidence}/></article>)}</div>}
  <RelationshipDiagnosisPanel report={report} diagnosis={diagnosis} semanticHistory={{...semantic,findings:chatFindings}} hideCoverage hideFacts={!!report.chatActivity} pageSize={3}/>
 </section>;
}

export function HistoryChangeReading({report}:{report:Json}){
 if(reportGoal(report)==='risk')return <RiskVerification report={report}/>;
 return <HistoryInteractionChanges report={report}/>;
}
function HistoryInteractionChanges({report}:{report:Json}){
 const {semantic,findings}=data(report),[page,setPage]=useState(0),identity=reportIdentity(report);
 const changes=rows(semantic.changeInsights).filter(item=>text(item.title)&&text(item.meaning)&&referenced(item.before?.evidenceIds,findings).length&&referenced(item.after?.evidenceIds,findings).length);
 const timeline=rows(semantic.timeline).filter(item=>text(item.note)&&referenced(item.evidenceIds,findings).length);
 const current=Math.min(page,Math.max(0,changes.length-1)),entry=changes[current];
 return <section className={styles.section} data-history-changes><header className={styles.heading}><div><span><ChartNoAxesCombined size={18}/>把前后放在一起看</span><h2>{report.captureKind==="moments"?`${identity.other}的动态有什么变化`:`${identity.other}与你：互动发生了什么变化`}</h2></div>{semantic.trend&&<strong className={styles.trend}>{semantic.trend}</strong>}</header>
  {text(semantic.reciprocity)&&<p className={styles.lead}>{semantic.reciprocity}</p>}
  {entry?<article className={styles.changeReading} data-change-insight><h3>{entry.title}</h3><div className={styles.beforeAfter}>{[entry.before,entry.after].map((part,index)=><section key={index}><small>{index?"后来":"之前"}{part.at?` · ${reportEvidenceDate(part.at)}`:""}</small><p>{part.reading}</p><EvidenceQuotes report={report} findings={referenced(part.evidenceIds,findings)} limit={1}/></section>)}</div><h4>这个变化意味着什么</h4><p>{entry.meaning}</p>{text(entry.alternative)&&<p className={styles.alternative}>还要考虑：{entry.alternative}</p>}</article>:timeline.length?<div className={styles.turningPoints}>{timeline.slice(0,4).map((item,index)=><article key={index}><small>{item.at?reportEvidenceDate(item.at):"时间待确认"}</small><p>{item.note}</p><SourceLinks findings={referenced(item.evidenceIds,findings)}/></article>)}</div>:<p className={styles.empty}>{report.captureKind==="moments"?"这批动态还没有形成可比较的前后证据，暂不把发布频率或照片变化当成关系变化。":"这份材料还没有保存可核对的前后转折，暂不把聊天量变化解读成升温或降温。可以先看当前判断和原话依据。"}</p>}
  {changes.length>1&&<nav className={styles.pager} aria-label="关系转折分页"><button disabled={!current} onClick={()=>setPage(current-1)}><ArrowLeft size={16}/>上一处</button><span>转折 {current+1} / {changes.length}</span><button disabled={current===changes.length-1} onClick={()=>setPage(current+1)}>下一处<ArrowRight size={16}/></button></nav>}
 </section>;
}

export function HistoryActionReading({report,onAsk}:{report:Json;onAsk?:(goal:"connection"|"risk")=>void}){
 const {semantic,findings}=data(report),plan=semantic.actionPlan||{},steps=rows(plan.steps).filter(item=>text(item.action)&&referenced(item.evidenceIds,findings).length),[active,setActive]=useState(0);
 const index=Math.min(active,Math.max(0,steps.length-1)),step=steps[index],goal=reportGoal(report)==="risk"||plan.goal==="risk"?"risk":"connection",identity=reportIdentity(report);
 const fallback=referenced(semantic.actionEvidenceIds,findings);
 return <section className={styles.section} data-history-actions><header className={styles.heading}><div><span>{goal==="risk"?<ShieldCheck size={18}/>:<Send size={18}/>}给你的行动 · 面对{identity.other}</span><h2>{goal==="risk"?"你怎样核实和保护边界":report.captureKind==="moments"?"你可以从哪个话题开始":"你下一步怎样聊、怎样推进"}</h2></div></header>
  {text(plan.rationale)&&<p className={styles.lead}>{plan.rationale}</p>}
  {steps.length>1&&<div className={styles.actionStages} role="group" aria-label="行动步骤">{steps.map((item,n)=><button key={n} type="button" aria-pressed={n===index} onClick={()=>setActive(n)}><small>{String(n+1).padStart(2,"0")}</small>{item.title||`第 ${n+1} 步`}</button>)}</div>}
  {step?<article className={styles.actionReading} data-action-step><h3>{step.title||"当前这一步"}</h3><p className={styles.actionText}>{step.action}</p>{text(step.why)&&<div><h4>为什么先做这一步</h4><p>{step.why}</p><EvidenceQuotes report={report} findings={referenced(step.evidenceIds,findings)} limit={1}/></div>}{text(step.reply)&&<ReportReplyPreview text={step.reply} label={`你可以对${identity.other}这样说`}/>}<dl>{[["观察多久",step.observeFor],["什么回应值得继续",step.advanceWhen],["什么时候停下来重新判断",step.stopWhen]].filter(([,value])=>text(value)).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></article>:<SavedActionReading report={report} findings={fallback}/>}
  {onAsk&&<nav className={styles.goalLinks} aria-label="继续按目标追问"><span>还想具体解决什么</span><button type="button" onClick={()=>onAsk("connection")}><MessageCircle size={17}/>聊天与推进<ArrowRight size={16}/></button><button type="button" onClick={()=>onAsk("risk")}><ShieldCheck size={17}/>核实风险与边界<ArrowRight size={16}/></button></nav>}
  {goal==='risk'&&step&&<RiskResponsePaths report={report} existingReply={step.reply}/>}
 </section>;
}
function RiskResponsePaths({report,existingReply}:{report:Json;existingReply?:string}){
 const items=riskItems(report).filter(item=>rows(item.verify?.outcomes).length),[page,setPage]=useState(0),root=useRef<HTMLElement>(null),index=Math.min(page,Math.max(0,items.length-1)),item=items[index];
 if(!item)return null;
 return <section ref={root} className={styles.responsePaths} data-risk-response-paths><h3>{reportIdentity(report).other}这样回答，你怎么做</h3><p>{item.title}</p>{text(item.verify.question)&&norm(item.verify.question)!==norm(existingReply)&&<ReportReplyPreview text={item.verify.question} label="你可以这样确认"/>}<dl>{rows(item.verify.outcomes).map((outcome,n)=><div key={n}><dt>{outcome.when}</dt><dd>{outcome.nextStep}</dd></div>)}</dl>{items.length>1&&<nav className={styles.pager} aria-label="回应分支分页"><button disabled={!index} onClick={()=>{setPage(index-1);requestAnimationFrame(()=>root.current?.scrollIntoView({block:'start',behavior:'instant'}));}}>上一项</button><span>{index+1} / {items.length}</span><button disabled={index===items.length-1} onClick={()=>{setPage(index+1);requestAnimationFrame(()=>root.current?.scrollIntoView({block:'start',behavior:'instant'}));}}>下一项</button></nav>}</section>;
}
function SavedActionReading({report,findings}:{report:Json;findings:Json[]}){
 const {semantic}=data(report),risk=reportGoal(report)==='risk',tasks=risk?riskItems(report).filter(item=>text(item.verify?.action)):[],[index,setIndex]=useState(0),root=useRef<HTMLElement>(null);
 const item=tasks[Math.min(index,Math.max(0,tasks.length-1))];
 return <article ref={root} className={styles.actionReading} data-saved-action style={{scrollMarginTop:120}}>{item?<><h3>{item.title}</h3><p className={styles.actionText}>{item.verify.action}</p><EvidenceQuotes report={report} findings={item.evidence} limit={2}/>{text(item.verify.question)&&<ReportReplyPreview text={item.verify.question} label={`你可以向${reportIdentity(report).other}核实`}/>}<dl>{rows(item.verify.outcomes).map((outcome,n)=><div key={n}><dt>{outcome.when}</dt><dd>{outcome.nextStep}</dd></div>)}</dl>{tasks.length>1&&<nav className={styles.pager} aria-label="核实行动分页"><button disabled={!index} onClick={()=>{setIndex(index-1);requestAnimationFrame(()=>root.current?.scrollIntoView({block:'start',behavior:'instant'}));}}>上一项</button><span>{index+1} / {tasks.length}</span><button disabled={index===tasks.length-1} onClick={()=>{setIndex(index+1);requestAnimationFrame(()=>root.current?.scrollIntoView({block:'start',behavior:'instant'}));}}>下一项</button></nav>}</>:findings.length&&text(semantic.action)?<><p className={styles.actionText}>{semantic.action}</p><EvidenceQuotes report={report} findings={findings}/><dl>{[["观察窗口",semantic.observeWindow],["重新判断的条件",semantic.stopCondition]].filter(([,value])=>text(value)).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></>:<p>这份报告尚未保存与原话对应的行动方案。已保留的依据可以继续核对，暂不填入通用建议。</p>}</article>;
}

function HistoryProfileInsights({report}:{report:Json}){
 const {semantic,findings}=data(report),[page,setPage]=useState(0),root=useRef<HTMLElement>(null);
 const profile:Json[]=rows(semantic.profileInsights).map(item=>({...item,evidence:referenced(item.evidenceIds,findings)} as Json)).filter(item=>text(item.dimension)&&text(item.reading)&&item.evidence.length&&norm(item.reading)!==norm(semantic.explanation)&&norm(item.reading)!==norm(semantic.summary));
 const pages=Math.max(1,Math.ceil(profile.length/3)),current=Math.min(page,pages-1);
 function turn(next:number){setPage(next);requestAnimationFrame(()=>root.current?.scrollIntoView({block:"start",behavior:"instant"}));}
 return <section ref={root} className={styles.section} data-profile-insights>
  <header className={styles.heading}><div><span><UserRound size={18}/>从双方表达理解相处</span><h2>{reportIdentity(report).other}与你：人物解读</h2></div></header>
  {profile.length>0?<div className={styles.profileReadings}>{profile.slice(current*3,(current+1)*3).map((item,index)=><article key={item.dimension+index}><small>{item.subject==='self'?'关于你':item.subject==='other'?`关于${reportIdentity(report).other}`:item.subject==='interaction'?'关于双方互动':'原报告未标记人物归属，请结合下方发言人核对'}</small><h3>{item.dimension}</h3><p>{item.reading}</p><EvidenceQuotes report={report} findings={item.evidence} limit={1}/>{text(item.alternative)&&<p className={styles.alternative}>另一种可能：{item.alternative}</p>}</article>)}</div>:<><p className={styles.empty}>{Array.isArray(semantic.profileInsights)?text(semantic.profileUnavailableReason)||"现有材料还不足以形成独立的人物解读。":"这份旧报告没有保存独立的人物解读。"}下面保留已有线索，不把它们推断成固定性格。</p><RelationshipDiagnosisPanel report={report} semanticHistory={{findings,unknowns:semantic.unknowns}} hideCoverage hideFacts pageSize={3}/></>}
  {pages>1&&<nav className={styles.pager} aria-label="人物解读分页"><button disabled={!current} onClick={()=>turn(current-1)}>上一组</button><span>{current+1} / {pages}</span><button disabled={current===pages-1} onClick={()=>turn(current+1)}>下一组</button></nav>}
 </section>;
}

export function HistoryMomentsInsights({report}:{report:Json}){
 const {semantic,coverage,findings,isMoment}=data(report),[page,setPage]=useState(0),[imagePage,setImagePage]=useState(0);
 const chatLibrary=report.captureKind!=="moments"&&typeof report.archiveSnapshot?.libraryId==="string"?report.archiveSnapshot.libraryId:"";
 const importHref=captureMomentsSupplementHref(report.subjectId||'',chatLibrary,'/report?id='+(report.reportId||report.id||''),report.analysisQuestion||report.relationshipDiagnosis?.question||(reportGoal(report)==='risk'?'risk':undefined));
 const momentCoverage=coverage.filter(row=>row.kind==="moments"),momentFindings=findings.filter(row=>sources(row).some(isMoment));
 const snapshots=rows(report.relatedSnapshots).filter(row=>row.kind==="moments");
 const knownCounts=(momentCoverage.length?momentCoverage.map(row=>count(row.momentCount??row.total)):snapshots.map(row=>count(row.total??row.expectedTotal))).filter((value):value is number=>value!==null);
 const total=knownCounts.length?knownCounts.reduce((sum,value)=>sum+value,0):null;
 const visual=rows(report.mediaEvidence).filter(item=>text(item.observation)),uniqueVisual=visual.filter(item=>item.materialRole!=="moments-cover").filter((item,index,all)=>all.findIndex(other=>other.libraryId===item.libraryId&&other.sourceId===item.sourceId&&norm(other.observation)===norm(item.observation))===index);
 const insight=semantic.sourceInsights?.moments,insightEvidence=referenced(insight?.evidenceIds,findings),cross=insight?.crossSource,crossEvidence=referenced(cross?.evidenceIds,findings);
 const summary=insightEvidence.some(row=>sources(row).some(isMoment))?text(insight?.summary):"";
 const crossSupported=crossEvidence.some(row=>sources(row).some(isMoment))&&crossEvidence.some(row=>sources(row).some(item=>!isMoment(item)));
 const pages=Math.max(1,Math.ceil(momentFindings.length/3)),current=Math.min(page,pages-1),imagePages=Math.max(1,Math.ceil(uniqueVisual.length/3)),currentImage=Math.min(imagePage,imagePages-1);
 const materials=rows(report.profileMaterials),[materialPage,setMaterialPage]=useState(0),materialPages=Math.max(1,Math.ceil(materials.length/2)),currentMaterial=Math.min(materialPage,materialPages-1);
 const imported=materials.length>0||(total!==null?total>0:momentFindings.length>0||visual.some(isMoment));
 const expected=coverage.reduce((sum,row)=>sum+(count(row.imagesExpected)||0),0),analyzed=coverage.reduce((sum,row)=>sum+(count(row.imagesAnalyzed)||0),0);
 return <section className={styles.section} id="report-history-moments" data-history-moments>
  <header className={styles.heading}><div><span><Images size={18}/>聊天之外的材料</span><h2>朋友圈与图片</h2></div></header>
  <div className={styles.materialScope}><span>{total!==null?`已导入 ${total} 条动态`:imported?"已保留朋友圈线索":coverage.length?"未导入朋友圈到这份报告":"旧报告未记录朋友圈范围"}</span>{momentCoverage.some(row=>count(row.pinnedCount))&&<span>其中 {momentCoverage.reduce((sum,row)=>sum+(count(row.pinnedCount)||0),0)} 条置顶</span>}{materials.length>0&&<span>另有 {materials.length} 项封面／签名</span>}{expected>0&&<span>图片已解读 {analyzed} / {expected} 张</span>}</div>
  {materials.length>0&&<section className={styles.visuals} data-history-profile-materials><h3>封面与个性签名</h3><p className={styles.scope}>采集时的个人展示，单独保留；不计入动态和发布趋势。</p>{materials.slice(currentMaterial*2,(currentMaterial+1)*2).map((item,index)=>{const image=visual.find(source=>source.libraryId===item.libraryId&&source.sourceId===item.sourceId);return <article key={`${item.libraryId}:${item.sourceId}:${index}`}><small>{captureMaterialLabel(item)}</small>{item.materialRole==="profile-signature"?<blockquote>{item.text}</blockquote>:<p>{image?.observation||"封面来源已保留，尚未完成可见内容解读。"}</p>}<CaptureEvidence sourceIds={[item.sourceId]} libraryId={item.libraryId} sourceKind="moments" label={`查看${captureMaterialLabel(item)}来源`}/></article>})}{materialPages>1&&<nav className={styles.pager} aria-label="个人展示资料分页"><button disabled={!currentMaterial} onClick={()=>setMaterialPage(currentMaterial-1)}><ArrowLeft size={16}/>上一组</button><span>{currentMaterial+1} / {materialPages}</span><button disabled={currentMaterial===materialPages-1} onClick={()=>setMaterialPage(currentMaterial+1)}>下一组<ArrowRight size={16}/></button></nav>}</section>}
  {!imported&&<div className={styles.empty}><p>{coverage.length?"当前报告没有收到这个人的朋友圈。聊天导入完成，不代表朋友圈也已导入。":"这份旧报告没有保存朋友圈分析及覆盖信息，请先核对同一人物的材料。"}</p><a className={styles.importLink} data-import-moments href={importHref}>{chatLibrary?'补充朋友圈并更新报告':'导入 TA 的朋友圈'}<ArrowRight size={17}/></a></div>}
  {summary&&<div className={styles.sourceSummary} data-moments-synthesis><p>{summary}</p><SourceLinks findings={insightEvidence}/></div>}
  {imported&&!momentFindings.length&&!summary&&<p className={styles.empty}>朋友圈材料已保留，这份报告尚未提供可核对的朋友圈解读，不能把已导入当成已经分析。</p>}
  <div className={styles.findings}>{momentFindings.slice(current*3,(current+1)*3).map((finding,index)=><article key={finding.id||index} data-moments-finding><h3>{finding.claim}</h3>{sources(finding).filter(isMoment).slice(0,2).map((item,n)=><div key={`${item.sourceId}:${n}`}><small>{reportEvidenceSpeaker(report,item.senderRole,item.basis)} · {captureMaterialLabel(item)}{item.at&&!captureProfileMaterial(item)?` · ${reportEvidenceDate(item.at)}`:""}</small><blockquote>{item.quote}</blockquote><CaptureEvidence quote={item.quote} sourceIds={item.sourceId?[item.sourceId]:undefined} libraryId={item.libraryId} sourceKind="moments" label={captureProfileMaterial(item)?`查看${captureMaterialLabel(item)}来源`:item.basis==="visual"?"查看图片来源":"回看这条朋友圈"}/></div>)}{text(finding.alternative)&&<p className={styles.alternative}>也可能：{finding.alternative}</p>}</article>)}</div>
  {pages>1&&<nav className={styles.pager} aria-label="朋友圈线索分页"><button disabled={!current} onClick={()=>setPage(current-1)}><ArrowLeft size={16}/>上一组</button><span>{current+1} / {pages}</span><button disabled={current===pages-1} onClick={()=>setPage(current+1)}>下一组<ArrowRight size={16}/></button></nav>}
  {crossSupported&&text(cross.summary)&&<div className={styles.sourceSummary} data-cross-source-reading><h3>放回聊天一起看</h3><p>{cross.summary}</p><SourceLinks findings={crossEvidence}/></div>}
  {Array.isArray(insight?.unknowns)&&insight.unknowns.some((value:unknown)=>text(value))&&<div className={styles.unknowns}><strong>还需要核实</strong><ul>{insight.unknowns.filter((value:unknown)=>text(value)).map((value:string)=><li key={value}>{value}</li>)}</ul></div>}
  {uniqueVisual.length>0&&<section className={styles.visuals} data-history-images><h3><ScanEye size={19}/>图片里实际看到了什么</h3><p className={styles.scope}>以下来自已同步的预览或采集画面，只描述可见内容。</p>{uniqueVisual.slice(currentImage*3,(currentImage+1)*3).map((item,index)=><article key={item.mediaId||index}><small>{item.kind==="moments"?captureMaterialLabel(item)+"图片":"聊天图片"}{item.at?` · ${reportEvidenceDate(item.at)}`:""}</small><p>{item.observation}</p><CaptureEvidence quote={item.observation} sourceIds={item.sourceId?[item.sourceId]:undefined} libraryId={item.libraryId} sourceKind={item.kind} label="查看图片来源"/></article>)}{imagePages>1&&<nav className={styles.pager} aria-label="图片解读分页"><button disabled={!currentImage} onClick={()=>setImagePage(currentImage-1)}><ArrowLeft size={16}/>上一组</button><span>{currentImage+1} / {imagePages}</span><button disabled={currentImage===imagePages-1} onClick={()=>setImagePage(currentImage+1)}>下一组<ArrowRight size={16}/></button></nav>}</section>}
  {expected>analyzed&&<p className={styles.empty}>另有 {expected-analyzed} 张图片尚未完成解读，不计入已读图片依据。</p>}
 </section>;
}
