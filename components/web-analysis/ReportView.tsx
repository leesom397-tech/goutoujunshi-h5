"use client";
import { ReportCoverage } from "./ReportCoverage";
import { useEffect, useRef, useState } from "react";
import { Sparkles, MessageCircle, ChartNoAxesCombined, Quote, HeartHandshake, Copy, Smile, CircleHelp, Heart, HandHeart, Meh, Frown, Angry, Eye, CircleCheck, Send, ArrowLeft, ArrowRight, Lightbulb, Image, Sticker, BookOpen, CalendarDays, Flag } from "lucide-react";
import { api, ErrorNotice, followup, message, priceLabel, hasPrice, type Json } from "./client";
import { personalizeReplyText, replyStyleSamples } from "@/lib/crush/reply-style";
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
import { riskAwarePresentation, riskReplyAllowed } from "@/lib/risk-aware-presentation";
import { RelationshipJourney } from "@/components/RelationshipJourney";
import { projectRelationshipContext } from "@/lib/relationship-context";
import { CaptureEvidence, CaptureEvidenceProvider } from "./CaptureEvidence";
import { reportIdentity, reportGoal } from "./report-context";
import { PersonalConnection } from "./PersonalConnection";
import { ChatActivity } from "@/components/ChatActivity";
import { RelationshipDiagnosisPanel } from "./RelationshipDiagnosisPanel";
import { buildRelationshipDiagnosis } from "@/lib/relationship-diagnosis";
import { ConversationMemoryReview } from "@/components/ConversationMemoryReview";
import { ChatReportBrief, ReportChapterArt } from "./ReportBrief";
import { ReportDetails } from "./ReportDetails";
import { AffinityOverview } from "./AffinityOverview";
import { HistoryReportReading, HistoryReportEntry, HistoryChangeReading, HistoryActionReading } from "./HistoryReportInsights";
import {ReplyDifference} from "./ReportReadingTools";
import {reportReadingScope,reportLineKey,readReportPosition,saveReportPosition} from "@/lib/report-reading-position";
export function Replies({ options, report, account, styleReportIds, publicExample = false }: { options: Json[]; report?: Json; account: Json | null; styleReportIds?: string[]; publicExample?: boolean }) {
  const [rewrites, setRewrites] = useState<Record<number, Json>>({}), [busy, setBusy] = useState(-1), [error, setError] = useState(""), [copied, setCopied] = useState(-1);
  const ids = useState<Record<number, string>>({})[0], mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const style = replyStyleSamples(report?.lines || []), eligible = !!report && style.eligible;
  const sampleLength = style.samples.join("").replace(/[\s\p{P}\p{S}]/gu, "").length;
  const loggedIn = !!account?.account?.userId;
  const unavailable = publicExample ? "" : !report?.id ? "请先上传聊天截图生成报告，才能参考你的原话调整语气。" : !loggedIn ? "登录后可使用这份报告里的我方原话。" : !eligible ? `目前有 ${style.samples.length} 句、${sampleLength} 个可读字；至少需要 3 句、30 个字，补充含你本人回复的聊天截图后即可使用。` : !hasPrice(account, "text") ? "改写价格尚未取回，请到账户核对后再试。" : "";
  async function copy(text: string, index: number) { try { await navigator.clipboard.writeText(text); setCopied(index); setError(""); } catch { setError("复制没有完成，可以选中回复文字复制。"); } }
  async function rewrite(index: number) {
    if (busy !== -1 || rewrites[index] || options[index]?.adjusted || options[index]?.originalIndex === null) return;
    if (publicExample) { const value = personalizeReplyText(options[index].text, report?.lines || []); setRewrites(previous => ({ ...previous, [index]: { ...value, note: `案例演示，不扣积分。${value.note}` } })); setError(""); return; }
    if (!report || unavailable) { setError(unavailable); return; } setBusy(index); setError("");
    try { ids[index] ||= crypto.randomUUID(); const result = await api("/api/web/rewrite", { reportId: report.id, optionIndex: options[index].originalIndex ?? index, confirmed: true, requestId: ids[index], ...(styleReportIds?.length ? { styleReportIds } : {}) }); if (!result.text || !["adjusted", "unchanged"].includes(result.status) || !result.note) throw new Error("改写未完整返回，原推荐仍可使用。"); if (!riskReplyAllowed(riskAwarePresentation(report), result.text)) throw new Error("这次改写偏离了当前边界建议，先保留原推荐。"); if (mounted.current) { setRewrites(previous => ({ ...previous, [index]: result })); window.dispatchEvent(new Event("chengzi:credits-changed")); } }
    catch (e) { const details=(e as any)?.details,released=details?.creditTaskStatus==='released'||details?.code==='CREDIT_RELEASED';if(released){delete ids[index];window.dispatchEvent(new Event('chengzi:credits-changed'));}if(mounted.current)setError(message(e)+(released?' 本次积分已退回，可以再试。':'')); }
    finally { if (mounted.current) setBusy(-1); }
  }
  return <div className="wa-replies">{(report || publicExample) && options.some(option=>!option.adjusted && option.originalIndex !== null) && <div className={readerStyles.rewriteGuide}><Sparkles size={20}/><div><strong>把回复改得更像你</strong><p>{publicExample ? "先试案例演示；分析自己的聊天后，会参考你本人的用词和语气。" : "参考你的用词、句长和标点；有已确认且相关的共同经历时，也可以自然带入。"}</p>{unavailable && <p>{unavailable}</p>}{!publicExample && report && !loggedIn && <a href={`/login?return_to=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/reports")}`}>登录后使用 →</a>}{!publicExample && loggedIn && eligible && !hasPrice(account, "text") && <a href="/account">查看账户 →</a>}</div></div>}{options.map((option, index) => <article className="wa-reply" key={index}><span className="wa-pill">{index === 0 ? "本轮首选" : `备选 ${index + 1}`} · {option.style || "自然回应"}</span><p>{rewrites[index]?.status === "adjusted" ? rewrites[index].text : option.text}</p>{rewrites[index]?.status === "adjusted" && <p className="wa-muted">原推荐：{option.text}</p>}<ReplyDifference options={options} index={index}/><div className={readerStyles.replyActions}><button type="button" onClick={() => void copy(rewrites[index]?.status === "adjusted" ? rewrites[index].text : option.text, index)}><Copy size={16}/>{copied === index ? "已复制" : "复制回复"}</button>{(report || publicExample) && !option.adjusted && option.originalIndex !== null && <button type="button" className={readerStyles.personalizeButton} disabled={!!unavailable || busy !== -1 || !!rewrites[index]} onClick={() => void rewrite(index)}><Sparkles size={17}/>{busy === index ? "正在贴近你的语气…" : rewrites[index] ? "已核对我的语气" : "改得更像我"}{!rewrites[index] && <small>{publicExample ? "案例演示 · 免费" : priceLabel(account, "text")}</small>}</button>}</div>{rewrites[index]?.note && <p className={readerStyles.rewriteResult} role="status">{rewrites[index].note}</p>}{rewrites[index]?.experienceEvidence?.map((item:Json)=><blockquote className={readerStyles.rewriteResult} key={item.id}><strong>已确认的共同经历</strong><p>{item.quote}</p><a href={"/report?id="+encodeURIComponent(item.sourceReportId)}>回看来源 →</a></blockquote>)}<div className={readerStyles.interpretation}><strong><Quote size={16}/>为什么适合这轮</strong><p>{option.reason || "结合当前对话自然承接。"}</p>{option.cost && <p className="wa-muted">留意：{option.cost}</p>}</div></article>)}<ErrorNotice error={error}/></div>;
}
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
 return <div><p className="wa-muted">横条是解释权重，不是喜欢程度。</p>{([['emotion','情绪倾向',Smile],['intent','表达意图',MessageCircle]] as const).map(([key,label,GroupIcon])=><div className={readerStyles.signalGroup} data-kind={key} key={key}><h3><GroupIcon size={17}/>{label}</h3>{annotation[key]?.length?annotation[key].map((tag:Json,index:number)=>{const Icon=tagIcon(tag.key),value=typeof tag.probability==='number'&&tag.probability>=0&&tag.probability<=1?tag.probability*100:typeof tag.weight==='number'&&tag.weight>=0&&tag.weight<=100?tag.weight:null;return <div className={readerStyles.signalRow} key={index}><Icon size={17}/><span>{tag.label}</span><span className={readerStyles.signalTrack} aria-hidden="true"><i style={{width:`${value??0}%`}}/></span><b>{value===null?'—':`权重 ${value>0&&value<1?'<1':Math.round(value)}`}</b></div>}):<p className="wa-muted">这句没有足够线索，暂不评分。</p>}</div>)}{annotation.note&&<div className={readerStyles.interpretation}><strong><Lightbulb size={17}/>结合上下文看</strong><p>{annotation.note}</p></div>}</div>;
}
function ToneEvidence({report,storageKey}:{report:Json;storageKey?:string}){
 const lines:Json[]=report.lines||[],[selected,setSelected]=useState(()=>Math.max(0,lines.findIndex(line=>line.speaker==='other'))),list=useRef<HTMLDivElement>(null);
 const selectedKey=useRef(reportLineKey(lines[selected]||{},selected));
 const located=lines.findIndex((item,n)=>reportLineKey(item,n)===selectedKey.current);
 const index=located>=0?located:Math.min(selected,Math.max(0,lines.length-1)),line=lines[index],annotation=(report.annotations||[]).find((row:Json)=>row.lineId===line?.id)||line?.annotation;
 function storage(){try{return window.localStorage;}catch{return undefined;}}
 function remember(){if(line)saveReportPosition(storage(),storageKey,{line:{key:selectedKey.current,listTop:list.current?.scrollTop||0}});}
 useEffect(()=>{
  const saved=readReportPosition(storage(),storageKey)?.line;
  const found=saved?lines.findIndex((item,n)=>reportLineKey(item,n)===saved.key):-1;
  let frame=0;
  if(found>=0&&saved){selectedKey.current=saved.key;setSelected(found);frame=requestAnimationFrame(()=>{if(list.current)list.current.scrollTop=saved.listTop;});}
  return()=>{cancelAnimationFrame(frame);remember();};
 },[storageKey]);
 function choose(next:number,fromPager=false){
  if(next<0||next>=lines.length)return;
  const mobile=window.matchMedia('(max-width:700px)').matches,target=list.current?.querySelector<HTMLElement>(`[data-line="${next}"]`),before=target?.getBoundingClientRect().top;
  selectedKey.current=reportLineKey(lines[next],next);setSelected(next);remember();
  requestAnimationFrame(()=>{
   const selectedButton=list.current?.querySelector<HTMLElement>(`[data-line="${next}"]`);if(!selectedButton||!list.current)return;
   if(mobile){
    // Collapsing the previous inline answer must not move the sentence just tapped.
    const top=selectedButton.getBoundingClientRect().top;
    const dialog=selectedButton.closest('dialog');
    if(fromPager){const nav=dialog?.querySelector('header')||selectedButton.closest('[data-report-reader]')?.querySelector('[role="tablist"]')?.parentElement;const targetTop=dialog?dialog.getBoundingClientRect().top+(nav?.getBoundingClientRect().height||72)+16:(nav?.getBoundingClientRect().height||100)+16;(dialog||window).scrollBy({top:top-targetTop,behavior:'instant'});selectedButton.focus({preventScroll:true});}
    else if(before!==undefined&&Math.abs(top-before)>1)(dialog||window).scrollBy({top:top-before,behavior:'instant'});
   }else if(fromPager){
    const bounds=list.current.getBoundingClientRect(),rect=selectedButton.getBoundingClientRect();
    if(rect.top<bounds.top+8)list.current.scrollBy({top:rect.top-bounds.top-8,behavior:'instant'});
    else if(rect.bottom>bounds.bottom-8)list.current.scrollBy({top:rect.bottom-bounds.bottom+8,behavior:'instant'});
   }
  });
 }
 const detail=(inline=false)=><article className={`${readerStyles.toneDetail} ${inline?readerStyles.inlineToneDetail:readerStyles.desktopToneDetail}`} data-tone-detail={inline?'inline':'desktop'}><div className={readerStyles.linePosition}><span><Quote size={16}/>正在解读 · 第 {index+1} / {lines.length} 句 · {line?.speaker==='self'?'我':line?.speaker==='other'?'对方':'身份待确认'}</span><span>{annotation?.evidence==='limited'?'线索有限':annotation?.evidence==='insufficient'?'依据不足':'文字线索'}</span></div>{!inline&&<blockquote>{line?.text}</blockquote>}<CaptureEvidence quote={line?.text} sourceIds={line?.sourceId?[line.sourceId]:undefined}/>{annotation?<AnnotationSignal annotation={annotation}/>:<p className={readerStyles.empty}>这句已保留原文，暂未完成逐句解读。请结合完整对话与报告依据阅读。</p>}<div className={readerStyles.linePager}><button type="button" disabled={index===0} onClick={()=>choose(index-1,true)}><ArrowLeft size={16}/>上一句</button><button type="button" disabled={index===lines.length-1} onClick={()=>choose(index+1,true)}>下一句<ArrowRight size={16}/></button></div></article>;
 return <section className="wa-card" id="tone"><h2><MessageCircle size={21}/>逐句语气与意图</h2><p className="wa-muted">点击一句看解读。百分比表示解释权重，不是喜欢你的概率。</p>{line?<div className={readerStyles.toneLayout}><div className={readerStyles.conversation} ref={list} onScroll={remember} data-reading-list role="group" aria-label="选择一句原话">{lines.map((item,n)=><div className={readerStyles.conversationItem} data-selected={n===index} key={item.id||n}><button type="button" className={readerStyles.sentenceButton} data-line={n} data-reading-anchor={reportLineKey(item,n)} aria-pressed={n===index} onClick={()=>choose(n)}><small><span>第 {n+1} 句 · {item.speaker==='self'?'我':item.speaker==='other'?'对方':'身份待确认'}{item.screenshotNumber?` · 图 ${item.screenshotNumber}`:''}</span>{n===index&&<b><CircleCheck size={14}/>正在解读</b>}</small><span>{item.text}</span></button>{n===index&&detail(true)}</div>)}</div>{detail()}</div>:<p className={readerStyles.empty}>这张截图没有可解读的文字气泡。</p>}{report.decision?.mediaBubbles?.length>0&&<div className={readerStyles.interpretation}><strong><Image size={17}/>对话里的表情与图片</strong>{report.decision.mediaBubbles.map((bubble:Json,n:number)=><p key={n}><span className="wa-pill">{bubble.kind==='sticker'?<Sticker size={15}/>:<Image size={15}/>} {bubble.screenshotNumber ? `图 ${bubble.screenshotNumber} · ` : ""}第 {(bubble.lineIndex??n)+1} 个气泡 · {bubble.speaker==='self'?'我':bubble.speaker==='other'?'对方':'身份待确认'}</span> {bubble.kind==='sticker'?'表情包':bubble.kind==='voice'?'语音':'图片'}{bubble.kind==='sticker'&&!bubble.text?'（无文字）':''}</p>)}</div>}<ChatPhotoClues clues={report.decision?.photoClues}/></section>;
}
const chatSections:ReadingSection[]=[
 {id:'status',label:'看清现状',caption:'判断、依据，以及与你的关系',tone:'coral'},
 {id:'change',label:'看见变化',caption:'时间线、聊天节奏与说法和行动',tone:'teal'},
 {id:'next',label:'决定下一步',caption:'做什么、观察多久、何时停止',tone:'slate'},
];
const screenshotSections:ReadingSection[]=[
 {id:'status',label:'好感探测器',caption:'参考值与关键依据',tone:'coral'},
 {id:'change',label:'逐句意图',caption:'点一句看语气和含义',tone:'teal'},
 {id:'next',label:'怎么回',caption:'可复制的回复与下一步',tone:'slate'},
];
const fullMomentsSections:ReadingSection[]=[
 {id:'status',label:'朋友圈解读',caption:'动态、图片与自我呈现',tone:'coral'},
 {id:'change',label:'动态变化',caption:'有依据的前后变化',tone:'teal'},
 {id:'next',label:'聊什么',caption:'话题切口与相处建议',tone:'slate'},
];
const riskSections:ReadingSection[]=[
 {id:'status',label:'风险结论',caption:'哪些值得警惕，哪些还不能下结论',tone:'coral'},
 {id:'change',label:'证据核实',caption:'谁说了什么，后来有没有澄清',tone:'teal'},
 {id:'next',label:'如何应对',caption:'你怎样核实，什么回应值得停下来',tone:'slate'},
];
const connectionSections:ReadingSection[]=[
 {id:'status',label:'TA的态度',caption:'对你的好感信号与实际投入',tone:'coral'},
 {id:'change',label:'互动变化',caption:'谁变了，哪些行为支持变化',tone:'teal'},
 {id:'next',label:'怎么聊推进',caption:'给你的表达与下一步',tone:'slate'},
];
const reportRows=(value:unknown):Json[]=>Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];
function RelationshipChanges({diagnosis,semantic}:{diagnosis:Json|null;semantic?:Json}){
 const claims=reportRows(diagnosis?.claimActions);
 return <>
  {claims.length>0&&<section className={reportStyles.reportSection}><h2><Quote size={21}/>说法与行动</h2><div className={reportStyles.claimActions}>{claims.map((item,index)=><article key={item.id||index}><header><h3>{item.claim}</h3><small>{item.status}</small></header><p>{item.action}</p>{item.claimEvidence&&<blockquote>{item.claimEvidence}<CaptureEvidence quote={item.claimEvidence} label="回看说法"/></blockquote>}{item.actionEvidence&&<blockquote>{item.actionEvidence}<CaptureEvidence quote={item.actionEvidence} label="回看后续行动"/></blockquote>}{item.note&&<small>{item.note}</small>}</article>)}</div></section>}
 </>;
}
export function ChatReport({report,account,styleReportIds,preview=false,publicExample=false,initialFocus}:{report:Json;account:Json|null;styleReportIds?:string[];preview?:boolean;publicExample?:boolean;initialFocus?:'affinity'|'intent'|'reply'}){
 const [followupError,setFollowupError]=useState('');
 const [historySection,setHistorySection]=useState(report.captureKind==='moments'?'moments':'interaction');
 const decision=report.decision||{},fit=Object.prototype.hasOwnProperty.call(report,'latestCompatibility')?report.latestCompatibility:report.compatibility;
 const presentation=riskAwarePresentation(report), options=presentation.replyOptions, actionReport=presentation.viewReport;
 const readingScope=reportReadingScope(account?.account?.userId,report.reportId||report.id,report.subjectId,"chat",publicExample);
 const diagnosis=report.relationshipDiagnosis||(report.chatActivity?buildRelationshipDiagnosis(report.chatActivity,undefined,Array.isArray(report.lines)?report.lines:[]):null);
 const semantic=report.semanticHistory||diagnosis?.semanticHistory;
 const fullHistory=report.analysisScope==='fullHistory'||report.captureFormat==='full-history';
 const momentOnly=fullHistory&&report.captureKind==='moments';
 const identity=reportIdentity(report),goal=reportGoal(report);
 const hasCurrentLines=!fullHistory&&!report.sentenceSampleNote&&Array.isArray(report.lines)&&report.lines.length>0;
 const journey=report.relationshipContext||projectRelationshipContext({ownerId:"current",subjectId:report.subjectId||"current",reports:[{id:report.reportId||report.id||"current",owner_id:"current",subject_id:report.subjectId||"current",kind:"chat",status:"done",result:report,created_at:0}],activity:report.chatActivity||null,activityStatus:report.chatActivity?"saved":"missing"});
 const action= presentation.nextStep||diagnosis?.decision?.recommendation||'结合下一次真实回应，再更新判断。';
 const observe=semantic?.observeWindow||diagnosis?.decision?.observeWindow;
 const stop=semantic?.stopCondition||diagnosis?.decision?.stopCondition;
 const alternatives=reportRows(diagnosis?.decision?.options).filter(option=>option.action!==action);
 function openHistory(section:string){setHistorySection(section);requestAnimationFrame(()=>document.querySelector('[data-history-reading]')?.scrollIntoView({block:'start',behavior:'instant'}));}
 function askGoal(goal:'connection'|'risk'){try{followup(actionReport,account!.account.userId,'完整报告追问',{title:goal==='risk'?'核实风险与边界':'聊天与推进',summary:semantic?.explanation||semantic?.summary||action,question:goal==='risk'?'基于这个人的全部已保存资料，哪些具体风险值得核实？请区分原话证据、其他解释、我该怎样确认，以及什么回应需要暂停投入。':'基于这个人的全部已保存资料，我下一步怎样自然聊天或推进？请给具体表达、这样说的原因、合适时机，以及对方不同回应时我怎么接。'});}catch(error){setFollowupError(message(error));}}
 const historyCount=momentOnly?report.archiveSnapshot?.total??reportRows(report.sourceCoverage).filter(row=>row.kind==='moments').reduce((sum,row)=>sum+(Number.isFinite(row.total)?row.total:0),0):semantic?.coverage?.totalImported??diagnosis?.coverage?.total??report.chatActivity?.messages;
 return <CaptureEvidenceProvider ownerId={publicExample?undefined:account?.account?.userId} reportId={report.reportId||report.id} captureOrigin={report.captureOrigin===true} fullHistory={fullHistory} historyKind={momentOnly?'moments':'chat'} historyCount={historyCount}><div className={reportStyles.document}>
  <div className={reportStyles.participantScope} data-report-participants><span>正在分析</span><strong>{identity.direction}</strong><small>{goal==='risk'?`核实${identity.other}在这段关系中的风险与边界`:goal==='connection'?`看${identity.other}对你的态度，给你下一步建议`:`看清${identity.other}与你的互动、变化与下一步`}</small></div>
  <ReportReader key={readingScope||report.reportId||report.id||"chat-report"} storageKey={readingScope} initialSection={initialFocus==='reply'?'next':initialFocus==='intent'&&!fullHistory?'change':initialFocus==='affinity'||initialFocus==='intent'?'status':undefined} items={hasCurrentLines ? screenshotSections : momentOnly?fullMomentsSections:goal==='risk'?riskSections:goal==='connection'?connectionSections:chatSections}>{active=><>
   {active==='status'&&<>
    {fullHistory&&goal!=='risk'&&<HistoryReportEntry report={report} onSelect={openHistory}/>}
    {!preview&&!publicExample&&<ReportFollowUp report={actionReport} owner={account?.account?.userId}/>}
    {hasCurrentLines&&<AffinityOverview report={report}/>}
    <ChatReportBrief report={report} diagnosis={diagnosis} showMetrics={!fullHistory}/>
    {decision.partial&&<p className="wa-status">部分材料未识别；下方依据只覆盖可读内容。</p>}
    <RiskReview report={report} summaryOnly={fullHistory&&goal==='risk'}/>
    {fullHistory&&goal==='risk'&&<HistoryReportEntry report={report} onSelect={openHistory}/>}
    {fullHistory&&<HistoryReportReading report={report} diagnosis={diagnosis} section={historySection} onSectionChange={setHistorySection}/>}
    <div className={reportStyles.detailLinks}><h2><BookOpen size={19}/>深入读这份报告</h2><ReportCoverage report={report}/>
     {!fullHistory&&(diagnosis||semantic)&&<ReportDetails title="为什么这样判断" description="详细解读、相反证据与其他可能"><RelationshipDiagnosisPanel diagnosis={diagnosis} semanticHistory={semantic} hideCoverage={!!report.sourceCoverage?.length}/></ReportDetails>}
     <ReportDetails title="我们之间：共同点与相处差异" description="双方的共同点、期待与需要磨合的地方"><PersonalConnection report={report} publicExample={publicExample}/>{fit&&<FitReport fit={fit} current={Object.prototype.hasOwnProperty.call(report,'latestCompatibility')}/>}</ReportDetails>
     {!preview&&!publicExample&&report.profileMemory&&<ReportDetails title="这次对我的新了解" description="查看从你的表达中整理的信息，也可以纠正"><ConversationMemoryReview memory={report.profileMemory} ownerId={account?.account?.userId} subjectId={report.subjectId}/></ReportDetails>}
     {!diagnosis&&!semantic&&<ReportDetails title="查看完整分析" description="这份报告保留的详细线索与解释"><InsightExplorer compact publicExample={publicExample} report={report} kind="chat" owner={publicExample?undefined:account?.account?.userId}/></ReportDetails>}
    </div>
   </>}
   {active==='change'&&<>
    {hasCurrentLines ? <><ToneEvidence key={readingScope||"public-tone"} report={report} storageKey={readingScope}/><ReportDetails title="本次上传中的回应与边界" description="只统计当前上传的行为线索"><InteractionEvidence report={report} owner={publicExample?undefined:account?.account?.userId}/></ReportDetails></> : <>
    <ReportChapterArt kind="change"/>
    {fullHistory?<HistoryChangeReading report={report}/>:<RelationshipJourney embedded context={journey} currentReportId={report.reportId||report.id}/>}
    <RelationshipChanges diagnosis={diagnosis} semantic={semantic}/>
    {publicExample&&report.demo===true&&report.publicEvidenceReview&&<section className="wa-card"><RelationshipEvidenceCards review={report.publicEvidenceReview} publicExample/></section>}
    {report.chatActivity&&(goal==='risk'?<ReportDetails title="互动统计" description="核实联系与回应的背景"><ChatActivity summary={report.chatActivity} friend={identity.other}/></ReportDetails>:<ChatActivity summary={report.chatActivity} friend={identity.other}/>)}
    {fullHistory&&<ReportDetails title="完整相处历程与来源" description="按日期核对聊天、动态与已确认经历"><RelationshipJourney embedded context={journey} currentReportId={report.reportId||report.id}/></ReportDetails>}
    </>}
   </>}
   {active==='next'&&<>
    <ReportChapterArt kind="next"/>
    {fullHistory?<HistoryActionReading report={report} onAsk={!publicExample&&account?.account?.userId?askGoal:undefined}/>:<section className={reportStyles.nextAction}><header><span>把判断变成行动</span><h2>接下来先做这一件<ArrowRight size={23}/></h2></header><p>{action}</p><dl>{observe&&<div><dt><CalendarDays size={17}/>观察窗口</dt><dd>{observe}</dd></div>}{stop&&<div><dt><Flag size={17}/>何时重新判断</dt><dd>{stop}</dd></div>}</dl></section>}
    {!preview&&!publicExample&&<ReportActionFeedback report={actionReport} owner={account?.account?.userId}/>}
    {options.length>0&&<section className="wa-card" id="replies"><h2><Send size={21}/>需要回复时，可以这样说</h2><Replies key={`${account?.account?.userId}:${report.id}`} options={options} report={report} account={account} styleReportIds={styleReportIds} publicExample={publicExample}/>{decision.replyReview&&<div className={readerStyles.interpretation}><strong>对原回复的回顾</strong><p>{decision.replyReview}</p></div>}</section>}
    {!fullHistory&&presentation.mode==='normal'&&alternatives.length>0&&<ReportDetails title="如果情况变化，还有哪些选择" description="比较其他做法及适用条件"><div className={reportStyles.actionOptions}>{alternatives.slice(0,4).map((option,index)=><article key={option.label||index}><h3>{option.label}</h3><p>{option.action}</p><dl><div><dt>观察</dt><dd>{option.observeWindow}</dd></div><div><dt>停止条件</dt><dd>{option.stopCondition}</dd></div></dl></article>)}</div></ReportDetails>}
    {!publicExample&&<div className="wa-actions"><button disabled={!account?.account?.userId} onClick={()=>{try{followup(actionReport,account!.account.userId);}catch(e){setFollowupError(message(e));}}}><MessageCircle size={16}/>{fullHistory?'基于全部资料继续问成子':'带着报告问成子'}</button>{report.subjectId&&<a className="wa-button" href={`/archive?subjectId=${report.subjectId}`}>人物档案</a>}</div>}
    <ErrorNotice error={followupError}/>
   </>}
  </>}</ReportReader>
  <ReportActions report={actionReport} publicExample={publicExample}/>
 </div></CaptureEvidenceProvider>;
}
export {SocialReport} from './SocialReport';
