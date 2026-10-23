"use client";
import { ReportCoverage, reportSourceSummary } from "./ReportCoverage";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReportSessionState } from './ReportSessionState';
import { Sparkles, MessageCircle, ChartNoAxesCombined, Quote, HeartHandshake, Copy, Smile, CircleHelp, Heart, HandHeart, Meh, Frown, Angry, Eye, CircleCheck, Send, ArrowLeft, ArrowRight, Lightbulb, Image, Sticker, BookOpen, CalendarDays, Flag } from "lucide-react";
import { ErrorNotice, followup, message, type Json } from "./client";
import { ArchiveRadar } from "@/components/ArchiveCharts";
import { ChatPhotoClues, InteractionEvidence } from "./ReportEvidence";
import { validScore } from "./report-data";
import {ReportReader, type ReadingSection} from "./ReportReader";
import readerStyles from "./ReportReader.module.css";
import reportStyles from "./ReportCard.module.css";
import { ReportActions } from "./ReportActions";
import { InsightExplorer } from "./InsightExplorer";
import { ReportFollowUp, ReportActionFeedback } from "./ReportFollowUp";
import { RelationshipEvidenceCards } from "./RelationshipEvidenceCards";
import { RiskReview } from "./RiskReview";
import { riskAwarePresentation } from "@/lib/risk-aware-presentation";
import { RelationshipJourney } from "@/components/RelationshipJourney";
import { projectRelationshipContext } from "@/lib/relationship-context";
import { CaptureEvidence, CaptureEvidenceProvider } from "./CaptureEvidence";
import { reportIdentity, reportGoal } from "./report-context";
import { PersonalConnection } from "./PersonalConnection";
import { ChatActivity } from "@/components/ChatActivity";
import { RelationshipDiagnosisPanel } from "./RelationshipDiagnosisPanel";
import { buildRelationshipDiagnosis } from "@/lib/relationship-diagnosis";
import { directedCommitment } from "@/lib/conversation-context";
import { ConversationMemoryReview } from "@/components/ConversationMemoryReview";
import { ChatReportBrief, ReportChapterArt } from "./ReportBrief";
import { ReportVisualMetrics } from "./ReportVisualMetrics";
import { ReportDetails } from "./ReportDetails";
import { AffinityOverview } from "./AffinityOverview";
import { HistoryReportReading, HistoryChangeReading, HistoryActionReading } from "./HistoryReportInsights";
import { intakeHref } from "./intake-navigation";
import { withAnalysisFocus } from "@/lib/person-analysis-navigation";
import {MethodReferences} from "./ReportReadingTools";
import {ReportReturnLink} from "./ReportReturnLink";
import { Replies } from "./ReportReplies";
export { Replies } from "./ReportReplies";
import {reportReadingScope,reportLineKey,readReportPosition,saveReportPosition} from "@/lib/report-reading-position";
function Findings({ rows }: { rows?: Json[] }) { return <>{(rows || []).map((row, index) => <div className="wa-insight" key={index}><strong>{row.title || row.dimension || row.item || row.category}</strong>{row.level && <span className="wa-pill">{row.level}</span>}{(row.meaning || row.reading || row.style || row.valueHint || row.conclusion) && <p>{[row.meaning || row.reading || row.conclusion, row.style, row.valueHint].filter(Boolean).join("；")}</p>}{row.evidence && <p className="wa-muted">依据：{row.evidence}</p>}{row.check && <p>核实：{row.check}</p>}</div>)}</>; }
export function FitReport({fit,title="资料适配 · 你们合适吗？",current=false}:{fit:Json;title?:string;current?:boolean}){
 const rows:Json[]=fit.fit||[],known=rows.filter(row=>validScore(row.score)||validScore(row.value));
 return <section className="wa-card" id="fit"><h2><HeartHandshake size={21}/>{title}</h2><p>{fit.fitSummary}</p>
  {known.length?<><p className="wa-muted">已知 {known.length} / {Math.max(6,rows.length)} 项 · 资料适配参考</p><ArchiveRadar labels={rows.map(row=>row.dimension)} rows={rows.map(row=>({label:row.dimension,value:validScore(row.score)?row.score:validScore(row.value)?row.value:null}))}/></>:<p className={readerStyles.empty}>个人资料尚不完整，缺失项保留“待了解”，不算成 0 分。</p>}
  <Findings rows={fit.commonPoints}/>{rows.filter(row=>row.reading||row.conclusion||row.selfNeed||row.evidence).map((row,index)=><div className="wa-insight" key={index}><h3>{row.dimension} · {row.status || (validScore(row.score)?row.score+'/100':'待了解')}</h3>{row.selfNeed&&<p>我的需要：{row.selfNeed}</p>}{row.reading&&<p>{row.reading}</p>}{row.conclusion&&row.conclusion!==row.reading&&<p>{row.conclusion}</p>}{row.evidence&&<small className="wa-muted">依据：{row.evidence}</small>}</div>)}{current&&<small className="wa-muted">根据当前已确认档案计算。</small>}
 </section>;
}
const tagIcon=(key:string)=>({happy:Smile,caring:HandHeart,calm:Meh,sad:Frown,angry:Angry,confused:CircleHelp,surprised:Eye,shy:Heart,teasing:Smile,ask:CircleHelp,answer:MessageCircle,acknowledge:CircleCheck,care:HandHeart,invite:Send,clarify:CircleHelp}[key]||MessageCircle);
function AnnotationSignal({annotation}:{annotation:Json}){
 return <div><p className="wa-muted">横条是解释权重，不是喜欢程度。</p>{([['emotion','情绪倾向',Smile],['intent','表达意图',MessageCircle]] as const).map(([key,label,GroupIcon])=>{
  const tags=reportRows(annotation[key]).filter(tag=>typeof tag.label==="string");
  const legacyText=typeof annotation[key]==="string"?annotation[key].trim():"";
  return <div className={readerStyles.signalGroup} data-kind={key} key={key}><h3><GroupIcon size={17}/>{label}</h3>{tags.length?tags.map((tag:Json,index:number)=>{const Icon=tagIcon(tag.key),value=typeof tag.probability==='number'&&tag.probability>=0&&tag.probability<=1?tag.probability*100:typeof tag.weight==='number'&&tag.weight>=0&&tag.weight<=100?tag.weight:null;return <div className={readerStyles.signalRow} key={index}><Icon size={17}/><span>{tag.label}</span><span className={readerStyles.signalTrack} aria-hidden="true"><i style={{width:`${value??0}%`}}/></span><b>{value===null?'未评分':`${value>0&&value<1?'<1':Math.round(value)}%`}</b></div>}):<p className="wa-muted">{legacyText||"这句没有足够线索，暂不评分。"}</p>}</div>;
 })}{typeof annotation.note==="string"&&annotation.note&&<div className={readerStyles.interpretation}><strong><Lightbulb size={17}/>结合上下文看</strong><p>{annotation.note}</p></div>}</div>;
}
function ToneEvidence({report,storageKey}:{report:Json;storageKey?:string}){
 const lines:Json[]=report.lines||[],[selected,setSelected]=useReportSessionState('tone:'+storageKey,()=>{let saved;try{saved=readReportPosition(window.localStorage,storageKey)?.line;}catch{}return Math.max(0,saved?lines.findIndex((line,n)=>reportLineKey(line,n)===saved.key):lines.findIndex(line=>line.speaker==='other'));}),list=useRef<HTMLDivElement>(null);
 const selectedKey=useRef(reportLineKey(lines[selected]||{},selected));
 const located=lines.findIndex((item,n)=>reportLineKey(item,n)===selectedKey.current);
 const index=located>=0?located:Math.min(selected,Math.max(0,lines.length-1)),line=lines[index],annotation=(report.annotations||[]).find((row:Json)=>row.lineId===line?.id)||line?.annotation;
 function storage(){try{return window.localStorage;}catch{return undefined;}}
 function remember(){if(line)saveReportPosition(storage(),storageKey,{line:{key:selectedKey.current,listTop:list.current?.scrollTop||0}});}
 useLayoutEffect(()=>{
  const saved=readReportPosition(storage(),storageKey)?.line;
  const found=saved?lines.findIndex((item,n)=>reportLineKey(item,n)===saved.key):-1;
  let frame=0;
  if(found>=0&&saved){selectedKey.current=saved.key;setSelected(found);frame=requestAnimationFrame(()=>{if(list.current)list.current.scrollTop=saved.listTop;});}
  return()=>{cancelAnimationFrame(frame);remember();};
 },[storageKey]);
 function choose(next:number,fromPager=false){
  if(next<0||next>=lines.length)return;
  const target=list.current?.querySelector<HTMLElement>(`[data-line="${next}"]`),before=target?.getBoundingClientRect().top;
  selectedKey.current=reportLineKey(lines[next],next);setSelected(next);remember();
  requestAnimationFrame(()=>{
   const selectedButton=list.current?.querySelector<HTMLElement>(`[data-line="${next}"]`);if(!selectedButton||!list.current)return;
   {
    // Collapsing the previous inline answer must not move the sentence just tapped.
    const top=selectedButton.getBoundingClientRect().top;
    const dialog=selectedButton.closest('dialog');
    if(fromPager){const nav=dialog?.querySelector('header')||selectedButton.closest('[data-report-reader]')?.querySelector('[role="tablist"]')?.parentElement;const targetTop=(nav?.getBoundingClientRect().bottom??(dialog?dialog.getBoundingClientRect().top+72:100))+16;(dialog||window).scrollBy({top:top-targetTop,behavior:'instant'});selectedButton.focus({preventScroll:true});}
    else if(before!==undefined&&Math.abs(top-before)>1)(dialog||window).scrollBy({top:top-before,behavior:'instant'});
   }
  });
 }
 const detail=(inline=false)=><article className={`${readerStyles.toneDetail} ${inline?readerStyles.inlineToneDetail:readerStyles.desktopToneDetail}`} data-tone-detail={inline?'inline':'desktop'}><div className={readerStyles.linePosition}><span><Quote size={16}/>正在解读 · 第 {index+1} / {lines.length} 句 · {line?.speaker==='self'?'我':line?.speaker==='other'?'对方':'身份待确认'}</span><span>{annotation?.evidence==='limited'?'线索有限':annotation?.evidence==='insufficient'?'依据不足':'文字线索'}</span></div>{!inline&&<blockquote>{line?.text}</blockquote>}<CaptureEvidence quote={line?.text} sourceIds={line?.sourceId?[line.sourceId]:undefined} libraryId={line?.libraryId} sourceKind={line?.sourceKind}/>{annotation?<AnnotationSignal annotation={annotation}/>:<p className={readerStyles.empty}>这句已保留原文，暂未完成逐句解读。请结合完整对话与报告依据阅读。</p>}<div className={readerStyles.linePager}><button type="button" disabled={index===0} onClick={()=>choose(index-1,true)}><ArrowLeft size={16}/>上一句</button><button type="button" disabled={index===lines.length-1} onClick={()=>choose(index+1,true)}>下一句<ArrowRight size={16}/></button></div></article>;
 return <section className="wa-card" id="tone"><h2><MessageCircle size={21}/>逐句语气与意图</h2><p className="wa-muted">点击一句看解读。百分比表示解释权重，不是喜欢你的概率。</p>{line?<div className={readerStyles.toneLayout}><div className={readerStyles.conversation} ref={list} onScroll={remember} data-reading-list role="group" aria-label="选择一句原话">{lines.map((item,n)=><div className={readerStyles.conversationItem} data-selected={n===index} key={item.id||n}><button type="button" className={readerStyles.sentenceButton} data-line={n} data-reading-anchor={reportLineKey(item,n)} aria-pressed={n===index} onClick={()=>choose(n)}><small><span>第 {n+1} 句 · {item.speaker==='self'?'我':item.speaker==='other'?'对方':'身份待确认'}{item.screenshotNumber?` · 图 ${item.screenshotNumber}`:''}</span>{n===index&&<b><CircleCheck size={14}/>正在解读</b>}</small><span>{item.text}</span></button>{n===index&&detail(true)}</div>)}</div>{detail()}</div>:<p className={readerStyles.empty}>这张截图没有可解读的文字气泡。</p>}{report.decision?.mediaBubbles?.length>0&&<div className={readerStyles.interpretation}><strong><Image size={17}/>对话里的表情与图片</strong>{report.decision.mediaBubbles.map((bubble:Json,n:number)=><p key={n}><span className="wa-pill">{bubble.kind==='sticker'?<Sticker size={15}/>:<Image size={15}/>} {bubble.screenshotNumber ? `图 ${bubble.screenshotNumber} · ` : ""}第 {(bubble.lineIndex??n)+1} 个气泡 · {bubble.speaker==='self'?'我':bubble.speaker==='other'?'对方':'身份待确认'}</span> {bubble.kind==='sticker'?'表情包':bubble.kind==='voice'?'语音':'图片'}{bubble.kind==='sticker'&&!bubble.text?'（无文字）':''}</p>)}</div>}<ChatPhotoClues clues={report.decision?.photoClues}/></section>;
}
const chatSections:ReadingSection[]=[
 {id:'status',label:'结论',caption:'判断、好感信号与关键依据',tone:'coral'},
 {id:'moments',label:'朋友圈',caption:'动态、图片与聊天的联系',tone:'amber'},
 {id:'change',label:'聊天细节',caption:'推理、原话、风险与关系变化',tone:'teal'},
 {id:'next',label:'相处与回复',caption:'共同点、具体回法与下一步',tone:'slate'},
];
const screenshotSections:ReadingSection[]=[
 {id:'status',label:'好感信号',caption:'参考值与关键依据',tone:'coral'},
 {id:'change',label:'逐句意图',caption:'点一句看语气和含义',tone:'teal'},
 {id:'next',label:'怎么回',caption:'可复制的回复与下一步',tone:'slate'},
];
const fullMomentsSections:ReadingSection[]=[
 {id:'status',label:'结论',caption:'先看本次判断',tone:'coral'},
 {id:'moments',label:'朋友圈',caption:'动态、图片与自我呈现',tone:'amber'},
 {id:'change',label:'动态变化',caption:'有依据的前后变化',tone:'teal'},
 {id:'next',label:'相处与回复',caption:'话题切口与相处建议',tone:'slate'},
];
const reportRows=(value:unknown):Json[]=>Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];
const visibleClaimQuote=(value:unknown)=>typeof value==="string"?value.replace(/^(第 \d+ 句)(?: · .+?)?：“/,"$1：“"):"";
function RelationshipChanges({diagnosis,semantic}:{diagnosis:Json|null;semantic?:Json}){
 const claims=reportRows(diagnosis?.claimActions).filter(item=>item.id!=="claim-action:commitment"||directedCommitment(String(item.claimEvidence||"")));
 return <>
  {claims.length>0&&<section className={reportStyles.reportSection}><h2><Quote size={21}/>说法与行动</h2><div className={reportStyles.claimActions}>{claims.map((item,index)=><article key={item.id||index}><header><h3>{item.claim}</h3><small>{item.status}</small></header><p>{item.action}</p>{item.claimEvidence&&<blockquote>{visibleClaimQuote(item.claimEvidence)}<CaptureEvidence quote={item.claimEvidence} label="回看说法"/></blockquote>}{item.actionEvidence&&<blockquote>{visibleClaimQuote(item.actionEvidence)}<CaptureEvidence quote={item.actionEvidence} label="回看后续行动"/></blockquote>}{item.note&&<small>{item.note}</small>}</article>)}</div></section>}
 </>;
}
export function ChatReport({report,account,styleReportIds,preview=false,publicExample=false,initialFocus}:{report:Json;account:Json|null;styleReportIds?:string[];preview?:boolean;publicExample?:boolean;initialFocus?:'affinity'|'intent'|'reply'}){
 const [followupError,setFollowupError]=useState(''),documentRef=useRef<HTMLDivElement>(null);
 const decision=report.decision||{},fit=Object.prototype.hasOwnProperty.call(report,'latestCompatibility')?report.latestCompatibility:report.compatibility;
 const presentation=riskAwarePresentation(report), options=presentation.replyOptions, actionReport=presentation.viewReport;
 const readingScope=reportReadingScope(account?.account?.userId,report.reportId||report.id,report.subjectId,"chat",publicExample);
 const diagnosis=report.relationshipDiagnosis||(report.chatActivity?buildRelationshipDiagnosis(report.chatActivity,undefined,Array.isArray(report.lines)?report.lines:[]):null);
 const semantic=report.semanticHistory||diagnosis?.semanticHistory;
 const fullHistory=report.analysisScope==='fullHistory'||report.analysisScope==='uploadedHistory'||report.captureFormat==='full-history';
 const affinityFirst=!fullHistory&&initialFocus==='affinity'&&presentation.mode==='normal';
 const momentOnly=fullHistory&&report.captureKind==='moments';
 const identity=reportIdentity(report),goal=reportGoal(report);
 const recent=report.recentSentenceAnalysis||semantic?.recentSentenceAnalysis;
 const recentLines=fullHistory&&recent?.scope==='recent'?reportRows(recent.lines).filter(line=>['self','other'].includes(line.speaker)&&typeof line.text==='string'&&line.text.trim()):[];
 const recentTotal=Number.isSafeInteger(recent?.totalReadable)&&recent.totalReadable>=recentLines.length?recent.totalReadable:null;
 const recentReading=recentLines.length?<section data-history-recent-sentences><p className={readerStyles.sampleScope}>最近 {recentLines.length} 条逐句解读{recentTotal!==null?` · 全量已读 ${recentTotal} 条`:""}。这里只展示最近片段，整体判断和统计仍使用全部已读资料。</p>{recent.windowLabel&&<p className="wa-muted">{recent.windowLabel}</p>}<ToneEvidence key={readingScope+":recent"} report={{...report,lines:recentLines,annotations:reportRows(recent.annotations),decision:{}}} storageKey={readingScope?readingScope+":recent":undefined}/></section>:null;
 const hasCurrentLines=!fullHistory&&!report.sentenceSampleNote&&Array.isArray(report.lines)&&report.lines.length>0;
 const journey=report.relationshipContext||projectRelationshipContext({ownerId:"current",subjectId:report.subjectId||"current",reports:[{id:report.reportId||report.id||"current",owner_id:"current",subject_id:report.subjectId||"current",kind:"chat",status:"done",result:report,created_at:0}],activity:report.chatActivity||null,activityStatus:report.chatActivity?"saved":"missing"});
 const action= presentation.nextStep||diagnosis?.decision?.recommendation||'结合下一次真实回应，再更新判断。';
 const observe=semantic?.observeWindow||diagnosis?.decision?.observeWindow;
 const stop=semantic?.stopCondition||diagnosis?.decision?.stopCondition;
 const alternatives=reportRows(diagnosis?.decision?.options).filter(option=>option.action!==action);
 function askGoal(goal:'connection'|'risk'){try{followup(actionReport,account!.account.userId,'完整报告追问',{title:goal==='risk'?'核实风险与边界':'聊天与推进',summary:semantic?.explanation||semantic?.summary||action,question:goal==='risk'?'基于这个人的全部已保存资料，哪些具体风险值得核实？请区分原话证据、其他解释、我该怎样确认，以及什么回应需要暂停投入。':'结合这份报告的当前建议，我下一步具体怎么做？请给 2–3 个自然回法、各自适用条件，以及对方不同回应时我怎么接。如果现在需要暂停，就说明怎样收住。'});}catch(error){setFollowupError(message(error));}}
 const momentSourceRows=reportRows(report.sourceCoverage).filter(row=>row.kind==='moments');
 const historyCount=momentOnly?(momentSourceRows.length?momentSourceRows.reduce((sum,row)=>sum+(Number.isFinite(row.momentCount)?row.momentCount:Number(row.total)||0),0):report.archiveSnapshot?.total):semantic?.coverage?.totalImported??diagnosis?.coverage?.total??report.chatActivity?.messages;
 const newChatHref=withAnalysisFocus(intakeHref("/analyze",{mode:"chat",subjectId:report.subjectId||"",returnTo:report.reportId||report.id?`/report?id=${report.reportId||report.id}`:""}),"intent");
 return <CaptureEvidenceProvider ownerId={publicExample?undefined:account?.account?.userId} reportId={report.reportId||report.id} captureOrigin={report.captureOrigin===true} fullHistory={fullHistory} historyKind={momentOnly?'moments':'chat'} historyCount={historyCount} showSourceBar={false}><div ref={documentRef} className={reportStyles.document} data-report-mode={momentOnly?'moments':fullHistory?'full-history':'upload'}>
  <div className={reportStyles.participantScope} data-report-participants><span>{report.analysisScope==='supplement'?'补充解读':momentOnly?'完整朋友圈报告':report.analysisScope==='uploadedHistory'?(report.materialCoverage?.history==='user-declared-complete'?'完整关系报告':'阶段关系报告'):fullHistory?'完整关系报告':'本次聊天报告'}</span><strong>{momentOnly?identity.other:identity.direction}</strong><small data-report-source-scope>{report.analysisScope==='uploadedHistory'?report.scopeNote:reportSourceSummary(report)}<CaptureEvidence label="查看原话依据"/></small></div>
  <ReportReader key={readingScope||report.reportId||report.id||"chat-report"} embedded={publicExample} storageKey={readingScope} initialSection={initialFocus==='reply'?'next':initialFocus==='intent'?'change':initialFocus==='affinity'?'status':undefined} items={!fullHistory?screenshotSections:momentOnly?fullMomentsSections:chatSections}>{active=><>
   {active==='status'&&<>
    {affinityFirst&&<><AffinityOverview report={report}/><Replies compact options={options} report={report} account={account} publicExample={publicExample}/></>}
    <ChatReportBrief report={report} diagnosis={diagnosis} showMetrics={fullHistory&&!momentOnly}/>
    {fullHistory&&!momentOnly&&<AffinityOverview report={report}/>}
    {!fullHistory&&!affinityFirst&&<><AffinityOverview report={report}/><Replies compact options={options} report={report} account={account} publicExample={publicExample}/></>}
    {decision.partial&&<p className="wa-status">部分材料未识别；下方依据只覆盖可读内容。</p>}
    <RiskReview report={report} summaryOnly={fullHistory} onInspect={fullHistory&&!momentOnly?()=>documentRef.current?.querySelector('[data-report-chat-risk]')?.scrollIntoView({block:'start',behavior:'instant'}):undefined}/>
    {!preview&&!publicExample&&<ReportFollowUp report={actionReport} owner={account?.account?.userId}/>}
    <details className={readerStyles.supplemental}><summary>分析范围、资料来源与我的档案</summary><ReportCoverage report={report}/>
     <MethodReferences sources={report.knowledgeSources||semantic?.knowledgeSources||report.decision?.knowledgeSources}/>
     {!fullHistory&&(diagnosis||semantic)&&<ReportDetails title="为什么这样判断" description="详细解读、相反证据与其他可能"><RelationshipDiagnosisPanel diagnosis={diagnosis} semanticHistory={semantic} hideCoverage={!!report.sourceCoverage?.length}/></ReportDetails>}

     {!preview&&!publicExample&&report.profileMemory&&<ReportDetails title="这次对我的新了解" description="查看从你的表达中整理的信息，也可以纠正"><ConversationMemoryReview memory={report.profileMemory} ownerId={account?.account?.userId} subjectId={report.subjectId}/></ReportDetails>}
     {!diagnosis&&!semantic&&<ReportDetails title="查看完整分析" description="这份报告保留的详细线索与解释"><InsightExplorer compact publicExample={publicExample} report={report} kind="chat" owner={publicExample?undefined:account?.account?.userId}/></ReportDetails>}
    </details>
   </>}
   {active==='moments'&&fullHistory&&<HistoryReportReading report={report} diagnosis={diagnosis} section="moments"/>}
   {active==='change'&&<>
    {!fullHistory ? <><ToneEvidence key={readingScope||"public-tone"} report={report} storageKey={readingScope}/>{hasCurrentLines&&<ReportDetails title="本次上传中的回应与边界" description="只统计当前上传的行为线索"><ReportVisualMetrics report={report}/><InteractionEvidence report={report} owner={publicExample?undefined:account?.account?.userId}/></ReportDetails>}</> : <>
    <HistoryReportReading report={report} diagnosis={diagnosis} section={momentOnly?'profile':'chat'} recentReading={recentReading}/>
    <ReportChapterArt kind="change"/>
    {fullHistory?<HistoryChangeReading report={report}/>:<RelationshipJourney embedded context={journey} currentReportId={report.reportId||report.id}/>}
    <RelationshipChanges diagnosis={diagnosis} semantic={semantic}/>
    {publicExample&&report.demo===true&&report.publicEvidenceReview&&<section className="wa-card"><RelationshipEvidenceCards review={report.publicEvidenceReview} publicExample/></section>}
    {report.chatActivity&&<ChatActivity summary={report.chatActivity} friend={identity.other}/>}
    {fullHistory&&<details className={readerStyles.supplemental}><summary>完整相处历程与来源</summary><RelationshipJourney embedded context={journey} currentReportId={report.reportId||report.id}/></details>}
    </>}
   </>}
   {active==='next'&&<>
    <section className="wa-card" id="replies"><Replies key={`${account?.account?.userId}:${report.id}`} options={options} report={report} account={account} styleReportIds={styleReportIds} publicExample={publicExample}/></section>
    <section className="wa-card" data-report-connection><h2><HeartHandshake size={21}/>怎么与{identity.other}相处</h2>{report.guidanceUpdatedAt&&!Number.isNaN(Date.parse(report.guidanceUpdatedAt))&&<p className="wa-muted" data-guidance-updated>建议更新于 {new Date(report.guidanceUpdatedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false})}</p>}<PersonalConnection report={report} publicExample={publicExample} embedded/>{fit&&<FitReport fit={fit} current={Object.prototype.hasOwnProperty.call(report,'latestCompatibility')}/>}</section>
    {fullHistory?<HistoryActionReading report={report} onAsk={!publicExample&&account?.account?.userId?askGoal:undefined}/>:<section className={reportStyles.nextAction}><header><span>把判断变成行动</span><h2>接下来先做这一件<ArrowRight size={23}/></h2></header><p>{action}</p><dl>{observe&&<div><dt><CalendarDays size={17}/>观察窗口</dt><dd>{observe}</dd></div>}{stop&&<div><dt><Flag size={17}/>何时重新判断</dt><dd>{stop}</dd></div>}</dl></section>}
    {!preview&&!publicExample&&<ReportActionFeedback report={actionReport} owner={account?.account?.userId}/>}
    {decision.replyReview&&<div className={readerStyles.interpretation}><strong>对原回复的回顾</strong><p>{decision.replyReview}</p></div>}
    {!fullHistory&&presentation.mode==='normal'&&alternatives.length>0&&<ReportDetails title="如果情况变化，还有哪些选择" description="比较其他做法及适用条件"><div className={reportStyles.actionOptions}>{alternatives.slice(0,4).map((option,index)=><article key={option.label||index}><h3>{option.label}</h3><p>{option.action}</p><dl><div><dt>观察</dt><dd>{option.observeWindow}</dd></div><div><dt>停止条件</dt><dd>{option.stopCondition}</dd></div></dl></article>)}</div></ReportDetails>}
    {!publicExample&&<div className="wa-actions"><button disabled={!account?.account?.userId} onClick={()=>{try{followup(actionReport,account!.account.userId);}catch(e){setFollowupError(message(e));}}}><MessageCircle size={16}/>{fullHistory?'基于全部资料继续问成子':'带着报告问成子'}</button>{report.subjectId&&<ReportReturnLink reportId={report.reportId||report.id} className="wa-button" href={`/archive?subjectId=${report.subjectId}`}>人物档案</ReportReturnLink>}</div>}
    {fullHistory&&!publicExample&&<ReportReturnLink reportId={report.reportId||report.id} className={reportStyles.supplementAction} href={newChatHref} data-new-sentence-analysis><MessageCircle size={18}/>补充新聊天，逐句解读<ArrowRight size={17}/></ReportReturnLink>}
    <ErrorNotice error={followupError}/>
   </>}
  </>}</ReportReader>
  <ReportActions report={actionReport} publicExample={publicExample}/>
 </div></CaptureEvidenceProvider>;
}
export {SocialReport} from './SocialReport';
