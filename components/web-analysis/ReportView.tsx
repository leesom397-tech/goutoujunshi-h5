"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, MessageCircle, ChartNoAxesCombined, Quote, Layers3, HeartHandshake, Copy, ScanLine, Smile, CircleHelp, Heart, HandHeart, Meh, Frown, Angry, Eye, CircleCheck, Send, ArrowLeft, ArrowRight, Lightbulb, Image, Sticker, UserRound } from "lucide-react";
import { api, ErrorNotice, InlinePerson, followup, message, priceLabel, hasPrice, type Json } from "./client";
import { personalizeReplyText, replyStyleSamples } from "@/lib/crush/reply-style";
import { ArchiveRadar } from "@/components/ArchiveCharts";
import { SocialContentPanel, SocialNextAdvice } from "./SocialReadingPanels";
import { ChatPhotoClues, InteractionEvidence, SocialMaterialEvidence } from "./ReportEvidence";
import { socialArchiveMaterial, validScore, visibleSignalProfile } from "./report-data";
import {ReportReader, type ReadingSection} from "./ReportReader";
import readerStyles from "./ReportReader.module.css";
import reportStyles from "./ReportCard.module.css";
import { ReportActions } from "./ReportActions";
import { InsightExplorer } from "./InsightExplorer";
import { ReportFollowUp } from "./ReportFollowUp";
import { RelationshipEvidenceCards } from "./RelationshipEvidenceCards";
import { RiskReview, RiskActionNotice } from "./RiskReview";
import { riskAwarePresentation, riskReplyAllowed } from "@/lib/risk-aware-presentation";
import { CaptureEvidence, CaptureEvidenceProvider } from "./CaptureEvidence";
import { PersonalConnection } from "./PersonalConnection";
import { ChatActivity } from "@/components/ChatActivity";
import { RelationshipDiagnosisPanel } from "./RelationshipDiagnosisPanel";
import { buildRelationshipDiagnosis } from "@/lib/relationship-diagnosis";
import { activityChart } from "@/lib/chat-activity";
import { ConversationMemoryReview } from "@/components/ConversationMemoryReview";
import { ReportReplyPreview, ChatReportBrief } from "./ReportBrief";
import {KeyEvidenceList, ReplyDifference} from "./ReportReadingTools";
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
    if(fromPager){const nav=selectedButton.closest('[data-report-reader]')?.querySelector('[role="tablist"]')?.parentElement;window.scrollBy({top:top-(nav?.getBoundingClientRect().height||100)-16,behavior:'instant'});selectedButton.focus({preventScroll:true});}
    else if(before!==undefined&&Math.abs(top-before)>1)window.scrollBy({top:top-before,behavior:'instant'});
   }else if(fromPager){
    const bounds=list.current.getBoundingClientRect(),rect=selectedButton.getBoundingClientRect();
    if(rect.top<bounds.top+8)list.current.scrollBy({top:rect.top-bounds.top-8,behavior:'instant'});
    else if(rect.bottom>bounds.bottom-8)list.current.scrollBy({top:rect.bottom-bounds.bottom+8,behavior:'instant'});
   }
  });
 }
 const detail=(inline=false)=><article className={`${readerStyles.toneDetail} ${inline?readerStyles.inlineToneDetail:readerStyles.desktopToneDetail}`} data-tone-detail={inline?'inline':'desktop'}><div className={readerStyles.linePosition}><span><Quote size={16}/>正在解读 · 第 {index+1} / {lines.length} 句 · {line?.speaker==='self'?'我':line?.speaker==='other'?'对方':'身份待确认'}</span><span>{annotation?.evidence==='limited'?'线索有限':annotation?.evidence==='insufficient'?'依据不足':'文字线索'}</span></div>{!inline&&<blockquote>{line?.text}</blockquote>}<CaptureEvidence quote={line?.text} sourceIds={line?.sourceId?[line.sourceId]:undefined}/>{annotation?<AnnotationSignal annotation={annotation}/>:line?.text?<AnnotationSignal annotation={{evidence:"limited",note:"这句还没有模型解读。下面只按字数、问号和安排用词计数，不是情绪判断。",emotion:[{key:"length",label:"语句长度",weight:Math.min(100,Math.round(line.text.length/40*100))}],intent:[{key:"ask",label:"问句",weight:/[?？]/.test(line.text)?80:10},{key:"plan",label:"时间或安排",weight:/周|明天|后天|点|见面|一起/.test(line.text)?70:8}]}}/>:<p className={readerStyles.empty}>这句暂未返回语气数据，不补造百分比。</p>}<div className={readerStyles.linePager}><button type="button" disabled={index===0} onClick={()=>choose(index-1,true)}><ArrowLeft size={16}/>上一句</button><button type="button" disabled={index===lines.length-1} onClick={()=>choose(index+1,true)}>下一句<ArrowRight size={16}/></button></div></article>;
 return <section className="wa-card" id="tone"><h2><MessageCircle size={21}/>逐句语气与意图</h2><p className="wa-muted">点击一句看解读。百分比表示解释权重，不是喜欢你的概率。</p>{line?<div className={readerStyles.toneLayout}><div className={readerStyles.conversation} ref={list} onScroll={remember} data-reading-list role="group" aria-label="选择一句原话">{lines.map((item,n)=><div className={readerStyles.conversationItem} data-selected={n===index} key={item.id||n}><button type="button" className={readerStyles.sentenceButton} data-line={n} data-reading-anchor={reportLineKey(item,n)} aria-pressed={n===index} onClick={()=>choose(n)}><small><span>第 {n+1} 句 · {item.speaker==='self'?'我':item.speaker==='other'?'对方':'身份待确认'}{item.screenshotNumber?` · 图 ${item.screenshotNumber}`:''}</span>{n===index&&<b><CircleCheck size={14}/>正在解读</b>}</small><span>{item.text}</span></button>{n===index&&detail(true)}</div>)}</div>{detail()}</div>:<p className={readerStyles.empty}>这张截图没有可解读的文字气泡。</p>}{report.decision?.mediaBubbles?.length>0&&<div className={readerStyles.interpretation}><strong><Image size={17}/>对话里的表情与图片</strong>{report.decision.mediaBubbles.map((bubble:Json,n:number)=><p key={n}><span className="wa-pill">{bubble.kind==='sticker'?<Sticker size={15}/>:<Image size={15}/>} {bubble.screenshotNumber ? `图 ${bubble.screenshotNumber} · ` : ""}第 {(bubble.lineIndex??n)+1} 个气泡 · {bubble.speaker==='self'?'我':'对方'}</span> {bubble.kind==='sticker'?'表情包':bubble.kind==='voice'?'语音':'图片'}{bubble.kind==='sticker'&&!bubble.text?'（无文字）':''}</p>)}</div>}<ChatPhotoClues clues={report.decision?.photoClues}/></section>;
}
const chatSections:ReadingSection[]=[
 {id:'status',label:'看清现状',caption:'态度、投入、风险和匹配',tone:'coral'},
 {id:'change',label:'看见变化',caption:'升温、降温、转折和前后差异',tone:'teal'},
 {id:'next',label:'决定下一步',caption:'怎么验证、怎么回、何时停止',tone:'slate'},
];
export function ChatReport({report,account,styleReportIds,preview=false,publicExample=false}:{report:Json;account:Json|null;styleReportIds?:string[];preview?:boolean;publicExample?:boolean}){
 const [followupError,setFollowupError]=useState('');
 const decision=report.decision||{},fit=Object.prototype.hasOwnProperty.call(report,'latestCompatibility')?report.latestCompatibility:report.compatibility;
 const presentation=riskAwarePresentation(report), options=presentation.replyOptions, actionReport=presentation.viewReport;
 const readingScope=reportReadingScope(account?.account?.userId,report.reportId||report.id,report.subjectId,"chat",publicExample);
 return <CaptureEvidenceProvider ownerId={publicExample?undefined:account?.account?.userId} reportId={report.reportId||report.id} captureOrigin={report.captureOrigin===true}><div className={reportStyles.document}>
  {report.captureMediaNote && <p className="wa-status"><Image size={18}/>{report.captureMediaNote}</p>}
  <p className="wa-muted">先看趋势和谁在投入，再看逐句语气。一次回复慢说明不了什么。聊天只是一个渠道，线下见面和通话不在这些数字里。</p>
  <ReportReader key={readingScope||report.reportId||report.id||"chat-report"} storageKey={readingScope} items={chatSections}>{active=><>
   {active==='status'&&<><ChatReportBrief report={report}/><div className={readerStyles.overview} data-brief data-risk-priority={presentation.mode}><article><h3><Sparkles size={18}/>一句判断</h3>{presentation.title&&<h2 className={readerStyles.verdictTitle}>{presentation.title}</h2>}<p data-has-title={!!presentation.title}>{presentation.judgment||'先核对本轮可见对话。'}</p><CaptureEvidence quote={presentation.evidence} label="查看判断所用原话"/></article><article><h3><Quote size={18}/>三条关键证据</h3><KeyEvidenceList report={report} priorityEvidence={presentation.mode!=="normal"?presentation.evidence:undefined}/></article><article><h3><ChartNoAxesCombined size={18}/>一条关系趋势</h3><p>{(report.relationshipDiagnosis?.relationship?.trend || (report.chatActivity ? buildRelationshipDiagnosis(report.chatActivity).relationship.trend : "待了解"))}</p><small>{report.relationshipDiagnosis?.relationship?.reciprocity || "趋势只根据已有互动变化，不代表喜欢程度。"}</small></article><article><h3><ArrowRight size={18}/>本周只做这一件</h3><p>{presentation.nextStep||report.relationshipDiagnosis?.decision?.recommendation||'结合原话和完整上下文决定如何回应。'}</p><small>{report.relationshipDiagnosis?.decision?.observeWindow ? `观察 ${report.relationshipDiagnosis.decision.observeWindow}。停止：${report.relationshipDiagnosis.decision.stopCondition || "事实变化后再更新。"}` : ""}</small></article></div><RelationshipDiagnosisPanel folded diagnosis={report.relationshipDiagnosis || (report.chatActivity ? buildRelationshipDiagnosis(report.chatActivity, undefined, report.lines) : undefined)} semanticHistory={report.semanticHistory}/><RiskReview report={report}/>{publicExample&&report.demo===true&&report.publicEvidenceReview&&<section className="wa-card"><RelationshipEvidenceCards review={report.publicEvidenceReview} publicExample/></section>}{!preview&&!publicExample&&<ReportFollowUp report={actionReport} owner={account?.account?.userId}/>} {decision.partial&&<p className="wa-status">部分内容未识别，结论只覆盖当前可读材料。</p>}<ReportReplyPreview text={options[0]?.text} reason={options[0]?.reason} label={presentation.mode==="safety"?"如需回应，先说清边界":presentation.mode==="expectation"?"先确认双方期待":"现在可以这样回"}/>{!preview&&!publicExample&&<ConversationMemoryReview memory={report.profileMemory} ownerId={account?.account?.userId} subjectId={report.subjectId}/>}<PersonalConnection report={report} publicExample={publicExample}/><InsightExplorer compact publicExample={publicExample} report={report} kind="chat" owner={publicExample?undefined:account?.account?.userId}/>{Array.isArray(report.lines)&&report.lines.length>0&&<><p className="wa-muted">{report.sentenceSampleNote||"点一句看情绪和意图。横条是解释权重，不是喜欢程度。"}</p><ToneEvidence key={readingScope||"public-tone"} report={report} storageKey={readingScope}/></>} </>}
   {active==='change'&&<>{report.chatActivity&&<ChatActivity summary={report.chatActivity}/>}{report.chatActivity&&<section className="wa-card"><h2>互动构成</h2><ArchiveRadar labels={activityChart(report.chatActivity).dimensions.map(row=>row.label)} rows={activityChart(report.chatActivity).dimensions.map(row=>({label:row.label,value:row.value}))}/></section>}{Array.isArray(report.relationshipDiagnosis?.periods)&&report.relationshipDiagnosis.periods.length>0&&<section className="wa-card"><h2>前后两段</h2>{report.relationshipDiagnosis.periods.map((period:Json)=><p key={period.label}><strong>{period.label}</strong> {period.range} · {period.sample} 条 · 你 {period.self} · TA {period.other}</p>)}</section>}{Array.isArray(report.relationshipDiagnosis?.claimActions)&&report.relationshipDiagnosis.claimActions.length>0&&<section className="wa-card"><h2>说法与行动</h2>{report.relationshipDiagnosis.claimActions.map((item:Json)=><article key={item.id}><strong>{item.claim}</strong><p>{item.status} · {item.action}</p><small>{item.claimEvidence}</small>{item.actionEvidence&&<small>{item.actionEvidence}</small>}</article>)}</section>}<InteractionEvidence report={report} owner={publicExample?undefined:account?.account?.userId}/>{fit&&<FitReport fit={fit} current={Object.prototype.hasOwnProperty.call(report,'latestCompatibility')}/>}</>}
   {active==='next'&&<>{(report.relationshipDiagnosis?.decision?.options||[]).length>0&&<section className="wa-card"><h2>四个选择，本周只做一个</h2>{report.relationshipDiagnosis.decision.options.slice(0,4).map((option:Json)=><article key={option.label}><strong>{option.label}</strong><p>{option.action}</p><small>观察 {option.observeWindow}。停止：{option.stopCondition}</small></article>)}</section>}<section className="wa-card" id="replies"><h2><Send size={21}/>现在怎么回</h2><RiskActionNotice presentation={presentation}/>{options.length?<Replies key={`${account?.account?.userId}:${report.id}`} options={options} report={report} account={account} styleReportIds={styleReportIds} publicExample={publicExample}/>:<p className={readerStyles.empty}>{report.lines?.at(-1)?.speaker==='self'?'最后一句是你发的，先等对方回应。':presentation.nextStep||'这轮没有可靠的回复候选，先观察实际回应。'}</p>}{decision.replyReview&&<div className={readerStyles.interpretation}><strong>对原回复的回顾</strong><p>{decision.replyReview}</p></div>}</section>{!publicExample&&<div className="wa-actions"><button disabled={!account?.account?.userId} onClick={()=>{try{followup(actionReport,account!.account.userId);}catch(e){setFollowupError(message(e));}}}><MessageCircle size={16}/>带着报告问成子</button>{report.subjectId&&<a className="wa-button" href={`/archive?subjectId=${report.subjectId}`}>人物档案</a>}</div>}<ErrorNotice error={followupError}/></>}
  </>}</ReportReader>
  <ReportActions report={actionReport} publicExample={publicExample}/>
 </div></CaptureEvidenceProvider>;
}
export {SocialReport} from './SocialReport';
