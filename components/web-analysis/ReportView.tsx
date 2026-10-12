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
    if (busy !== -1 || rewrites[index]) return;
    if (publicExample) { const value = personalizeReplyText(options[index].text, report?.lines || []); setRewrites(previous => ({ ...previous, [index]: { ...value, note: `案例演示，不扣积分。${value.note}` } })); setError(""); return; }
    if (!report || unavailable) { setError(unavailable); return; } setBusy(index); setError("");
    try { ids[index] ||= crypto.randomUUID(); const result = await api("/api/web/rewrite", { reportId: report.id, optionIndex: index, confirmed: true, requestId: ids[index], ...(styleReportIds?.length ? { styleReportIds } : {}) }); if (!result.text || !["adjusted", "unchanged"].includes(result.status) || !result.note) throw new Error("改写未完整返回，原推荐仍可使用。"); if (mounted.current) { setRewrites(previous => ({ ...previous, [index]: result })); window.dispatchEvent(new Event("chengzi:credits-changed")); } }
    catch (e) { setError(message(e)); if ((e as any)?.details?.code === "CREDIT_RELEASED") delete ids[index]; }
    finally { if (mounted.current) setBusy(-1); }
  }
  return <div className="wa-replies">{options.length > 0 && <div className={readerStyles.rewriteGuide}><Sparkles size={20}/><div><strong>把回复改得更像你</strong><p>{publicExample ? "先试案例演示；分析自己的聊天后，会参考你本人的用词和语气。" : "参考本轮你的原话调整用词、句长和标点。"}</p>{unavailable && <p>{unavailable}</p>}{!publicExample && report && !loggedIn && <a href={`/login?return_to=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/reports")}`}>登录后使用 →</a>}{!publicExample && loggedIn && eligible && !hasPrice(account, "text") && <a href="/account">查看账户 →</a>}</div></div>}{options.map((option, index) => <article className="wa-reply" key={index}><span className="wa-pill">{index === 0 ? "本轮首选" : `备选 ${index + 1}`} · {option.style || "自然回应"}</span><p>{rewrites[index]?.status === "adjusted" ? rewrites[index].text : option.text}</p>{rewrites[index]?.status === "adjusted" && <p className="wa-muted">原推荐：{option.text}</p>}<div className={readerStyles.replyActions}><button type="button" onClick={() => void copy(rewrites[index]?.status === "adjusted" ? rewrites[index].text : option.text, index)}><Copy size={16}/>{copied === index ? "已复制" : "复制回复"}</button><button type="button" className={readerStyles.personalizeButton} disabled={!!unavailable || busy !== -1 || !!rewrites[index]} onClick={() => void rewrite(index)}><Sparkles size={17}/>{busy === index ? "正在贴近你的语气…" : rewrites[index] ? "已核对我的语气" : "改得更像我"}{!rewrites[index] && <small>{publicExample ? "案例演示 · 免费" : priceLabel(account, "text")}</small>}</button></div>{rewrites[index]?.note && <p className={readerStyles.rewriteResult} role="status">{rewrites[index].note}</p>}<div className={readerStyles.interpretation}><strong><Quote size={16}/>为什么适合这轮</strong><p>{option.reason || "结合当前对话自然承接。"}</p>{option.cost && <p className="wa-muted">留意：{option.cost}</p>}</div></article>)}<ErrorNotice error={error}/></div>;
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
 return <div>{([['emotion','情绪倾向',Smile],['intent','表达意图',MessageCircle]] as const).map(([key,label,GroupIcon])=><div className={readerStyles.signalGroup} data-kind={key} key={key}><h3><GroupIcon size={17}/>{label}</h3>{annotation[key]?.length?annotation[key].map((tag:Json,index:number)=>{const Icon=tagIcon(tag.key),value=typeof tag.probability==='number'&&tag.probability>=0&&tag.probability<=1?tag.probability*100:typeof tag.weight==='number'&&tag.weight>=0&&tag.weight<=100?tag.weight:null;return <div className={readerStyles.signalRow} key={index}><Icon size={17}/><span>{tag.label}</span><span className={readerStyles.signalTrack} aria-hidden="true"><i style={{width:`${value??0}%`}}/></span><b>{value===null?'—':value>0&&value<1?'<1%':`${Math.round(value)}%`}</b></div>}):<p className="wa-muted">这句没有足够线索，暂不评分。</p>}</div>)}{annotation.note&&<div className={readerStyles.interpretation}><strong><Lightbulb size={17}/>结合上下文看</strong><p>{annotation.note}</p></div>}</div>;
}
function ToneEvidence({report}:{report:Json}){
 const lines:Json[]=report.lines||[],[selected,setSelected]=useState(()=>Math.max(0,lines.findIndex(line=>line.speaker==='other'))),list=useRef<HTMLDivElement>(null);
 const index=Math.min(selected,Math.max(0,lines.length-1)),line=lines[index],annotation=(report.annotations||[]).find((row:Json)=>row.lineId===line?.id)||line?.annotation;
 function choose(next:number,fromPager=false){
  if(next<0||next>=lines.length)return;
  const mobile=window.matchMedia('(max-width:700px)').matches,target=list.current?.querySelector<HTMLElement>(`[data-line="${next}"]`),before=target?.getBoundingClientRect().top;
  setSelected(next);
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
 const detail=(inline=false)=><article className={`${readerStyles.toneDetail} ${inline?readerStyles.inlineToneDetail:readerStyles.desktopToneDetail}`} data-tone-detail={inline?'inline':'desktop'}><div className={readerStyles.linePosition}><span><Quote size={16}/>正在解读 · 第 {index+1} / {lines.length} 句 · {line?.speaker==='self'?'我':line?.speaker==='other'?'对方':'身份待确认'}</span><span>{annotation?.evidence==='limited'?'线索有限':annotation?.evidence==='insufficient'?'依据不足':'文字线索'}</span></div>{!inline&&<blockquote>{line?.text}</blockquote>}{annotation?<AnnotationSignal annotation={annotation}/>:<p className={readerStyles.empty}>这句暂未返回语气数据，不补造百分比。</p>}<div className={readerStyles.linePager}><button type="button" disabled={index===0} onClick={()=>choose(index-1,true)}><ArrowLeft size={16}/>上一句</button><button type="button" disabled={index===lines.length-1} onClick={()=>choose(index+1,true)}>下一句<ArrowRight size={16}/></button></div></article>;
 return <section className="wa-card" id="tone"><h2><MessageCircle size={21}/>逐句语气与意图</h2><p className="wa-muted">点击一句看解读。百分比表示解释权重，不是喜欢你的概率。</p>{line?<div className={readerStyles.toneLayout}><div className={readerStyles.conversation} ref={list} role="group" aria-label="选择一句原话">{lines.map((item,n)=><div className={readerStyles.conversationItem} data-selected={n===index} key={item.id||n}><button type="button" className={readerStyles.sentenceButton} data-line={n} aria-pressed={n===index} onClick={()=>choose(n)}><small><span>第 {n+1} 句 · {item.speaker==='self'?'我':item.speaker==='other'?'对方':'身份待确认'}{item.screenshotNumber?` · 图 ${item.screenshotNumber}`:''}</span>{n===index&&<b><CircleCheck size={14}/>正在解读</b>}</small><span>{item.text}</span></button>{n===index&&detail(true)}</div>)}</div>{detail()}</div>:<p className={readerStyles.empty}>这张截图没有可解读的文字气泡。</p>}{report.decision?.mediaBubbles?.length>0&&<div className={readerStyles.interpretation}><strong><Image size={17}/>对话里的表情与图片</strong>{report.decision.mediaBubbles.map((bubble:Json,n:number)=><p key={n}><span className="wa-pill">{bubble.kind==='sticker'?<Sticker size={15}/>:<Image size={15}/>} {bubble.screenshotNumber ? `图 ${bubble.screenshotNumber} · ` : ""}第 {(bubble.lineIndex??n)+1} 个气泡 · {bubble.speaker==='self'?'我':'对方'}</span> {bubble.kind==='sticker'?'表情包':bubble.kind==='voice'?'语音':'图片'}{bubble.kind==='sticker'&&!bubble.text?'（无文字）':''}</p>)}</div>}<ChatPhotoClues clues={report.decision?.photoClues}/></section>;
}
const chatSections:ReadingSection[]=[
 {id:'judgment',label:'先看结论',caption:'抓住这轮互动的重点',tone:'coral'},
 {id:'tone',label:'逐句语气',caption:'一条原话，一份语气与意图分析',tone:'amber'},
 {id:'signals',label:'好感信号',caption:'看整体指数，再看具体依据',tone:'teal'},
 {id:'replies',label:'怎么回复',caption:'选一个适合现在的行动',tone:'slate'},
];
export function ChatReport({report,account,styleReportIds,preview=false,publicExample=false}:{report:Json;account:Json|null;styleReportIds?:string[];preview?:boolean;publicExample?:boolean}){
 const [followupError,setFollowupError]=useState('');
 const decision=report.decision||{},fit=Object.prototype.hasOwnProperty.call(report,'latestCompatibility')?report.latestCompatibility:report.compatibility;
 const options=[...(decision.replyOptions||[])].sort((a:Json,b:Json)=>(b.weight??-1)-(a.weight??-1)).slice(0,3);
 return <div className={reportStyles.document}>
  <ReportReader key={report.reportId||report.id||'chat-report'} storageKey={!publicExample && account?.account?.userId && (report.reportId||report.id) ? `${account.account.userId}:${report.reportId||report.id}:chat` : undefined} items={chatSections}>{active=><>
   {active==='judgment'&&<><div className={readerStyles.overview}><article><h3><Sparkles size={18}/>当前判断</h3><p>{decision.judgment||decision.possibleIntent||'先核对本轮可见对话。'}</p></article><article><h3><Quote size={18}/>关键依据</h3><blockquote>{decision.evidence||decision.observation||'本轮暂未返回可引用的原话。'}</blockquote></article><article><h3><ArrowRight size={18}/>下一步</h3><p>{decision.nextStep||'结合原话和完整上下文决定如何回应。'}</p></article></div>{decision.partial&&<p className="wa-status">部分内容未识别，结论只覆盖当前可读材料。</p>}<InsightExplorer compact publicExample={publicExample} report={report} kind="chat" owner={publicExample?undefined:account?.account?.userId}/></>}
   {active==='tone'&&<ToneEvidence report={report}/>}
   {active==='signals'&&<><InteractionEvidence report={report} owner={publicExample?undefined:account?.account?.userId}/>{fit&&<FitReport fit={fit} current={Object.prototype.hasOwnProperty.call(report,'latestCompatibility')}/>}</>}
   {active==='replies'&&<><section className="wa-card" id="replies"><h2><Send size={21}/>现在怎么回</h2>{options.length?<Replies key={`${account?.account?.userId}:${report.id}`} options={options} report={report} account={account} styleReportIds={styleReportIds} publicExample={publicExample}/>:<p className={readerStyles.empty}>{report.lines?.at(-1)?.speaker==='self'?'最后一句是你发的，先等对方回应。':decision.nextStep||'这轮没有可靠的回复候选，先观察实际回应。'}</p>}{decision.replyReview&&<div className={readerStyles.interpretation}><strong>对原回复的回顾</strong><p>{decision.replyReview}</p></div>}</section>{!publicExample&&<div className="wa-actions"><button disabled={!account?.account?.userId} onClick={()=>{try{followup(report,account!.account.userId);}catch(e){setFollowupError(message(e));}}}><MessageCircle size={16}/>带着报告问军师</button>{report.subjectId&&<a className="wa-button" href={`/archive?subjectId=${report.subjectId}`}>人物档案</a>}</div>}<ErrorNotice error={followupError}/>{!preview&&!publicExample&&<ReportFollowUp report={report} owner={account?.account?.userId}/>}</>}
  </>}</ReportReader>
  <ReportActions report={report} publicExample={publicExample}/>
 </div>;
}
export {SocialReport} from './SocialReport';
