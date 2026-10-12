"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, MessageCircle, ChartNoAxesCombined, Quote, Layers3, HeartHandshake, Copy, ScanLine, Smile, CircleHelp, Heart, HandHeart, Meh, Frown, Angry, Eye, CircleCheck, Send, ArrowLeft, ArrowRight, Lightbulb, Image, Sticker, UserRound } from "lucide-react";
import { api, ErrorNotice, InlinePerson, followup, message, priceLabel, hasPrice, type Json } from "./client";
import { replyStyleSamples } from "@/lib/crush/reply-style";
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
export function Replies({ options, report, account, styleReportIds }: { options: Json[]; report?: Json; account: Json | null; styleReportIds?: string[] }) {
  const [rewrites, setRewrites] = useState<Record<number, Json>>({}), [busy, setBusy] = useState(-1), [error, setError] = useState(""), [copied, setCopied] = useState(-1);
  const ids = useState<Record<number, string>>({})[0], mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const eligible = !!report && replyStyleSamples(report.lines || []).eligible;
  async function copy(text: string, index: number) { try { await navigator.clipboard.writeText(text); setCopied(index); setError(""); } catch { setError("复制没有完成，可以选中回复文字复制。"); } }
  async function rewrite(index: number) {
    if (busy !== -1 || !report) return; if (!ids[index] && !hasPrice(account, "text")) { setError("改写价格暂未取回，请到账户核对后重试。"); return; } setBusy(index); setError("");
    try { ids[index] ||= crypto.randomUUID(); const result = await api("/api/web/rewrite", { reportId: report.id, optionIndex: index, confirmed: true, requestId: ids[index], ...(styleReportIds?.length ? { styleReportIds } : {}) }); if (!result.text || !["adjusted", "unchanged"].includes(result.status) || !result.note) throw new Error("改写未完整返回，原推荐仍可使用。"); if (mounted.current) { setRewrites(previous => ({ ...previous, [index]: result })); window.dispatchEvent(new Event("chengzi:credits-changed")); } }
    catch (e) { setError(message(e)); if ((e as any)?.details?.code === "CREDIT_RELEASED") delete ids[index]; }
    finally { if (mounted.current) setBusy(-1); }
  }
  return <div className="wa-replies">{options.map((option, index) => <article className="wa-reply" key={index}><span className="wa-pill">{index === 0 ? "本轮首选" : `备选 ${index + 1}`} · {option.style || "自然回应"}</span><p>{rewrites[index]?.status === "adjusted" ? rewrites[index].text : option.text}</p>{rewrites[index]?.status === "adjusted" && <p className="wa-muted">原推荐：{option.text}</p>}<div className={readerStyles.interpretation}><strong><Quote size={16}/>为什么适合这轮</strong><p>{option.reason || "结合当前对话自然承接。"}</p>{option.cost && <p className="wa-muted">留意：{option.cost}</p>}</div><div className="wa-actions"><button onClick={() => void copy(rewrites[index]?.status === "adjusted" ? rewrites[index].text : option.text, index)}>{copied === index ? "已复制" : "复制回复"}</button>{report && <button disabled={!eligible || busy !== -1 || (!ids[index] && !hasPrice(account, "text"))} onClick={() => void rewrite(index)}>{busy === index ? "调整中…" : `更像我 · ${priceLabel(account, "text")}`}</button>}</div>{rewrites[index]?.note && <p className="wa-muted">{rewrites[index].note}</p>}</article>)}{report && options.length > 0 && <small className="wa-muted">语气改写会使用本轮已确认的我方原话；至少需要 3 句、30 个可读字。推荐顺序不代表成功率。</small>}{report && !hasPrice(account, "text") && <p className="wa-muted">改写价格暂未取回，请<a href="/account">到账户核对</a>后再试。</p>}<ErrorNotice error={error}/></div>;
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
 function choose(next:number){setSelected(next);requestAnimationFrame(()=>{const target=list.current?.querySelector<HTMLElement>(`[data-line="${next}"]`);if(target&&list.current)list.current.scrollTo({top:target.offsetTop-list.current.offsetTop-8,behavior:'instant'});});}
 return <section className="wa-card" id="tone"><h2><MessageCircle size={21}/>逐句语气与意图</h2><p className="wa-muted">百分比表示这句话的不同解释权重，不是喜欢你的概率。</p>{line?<div className={readerStyles.toneLayout}><div className={readerStyles.conversation} ref={list} role="group" aria-label="选择一句原话">{lines.map((item,n)=><button type="button" key={item.id||n} data-line={n} aria-current={n===index} onClick={()=>choose(n)}><small>第 {n+1} 句 · {item.speaker==='self'?'我':item.speaker==='other'?'对方':'身份待确认'}{item.screenshotNumber?` · 图 ${item.screenshotNumber}`:''}</small><span>{item.text}</span></button>)}</div><article className={readerStyles.toneDetail}><div className={readerStyles.linePosition}><span><Quote size={16}/>第 {index+1} / {lines.length} 句 · {line.speaker==='self'?'我':'对方'}</span><span>{annotation?.evidence==='limited'?'线索有限':annotation?.evidence==='insufficient'?'依据不足':'文字线索'}</span></div><blockquote>{line.text}</blockquote>{annotation?<AnnotationSignal annotation={annotation}/>:<p className={readerStyles.empty}>这句暂未返回语气数据，不补造百分比。</p>}<div className={readerStyles.linePager}><button type="button" disabled={index===0} onClick={()=>choose(index-1)}><ArrowLeft size={16}/>上一句</button><button type="button" disabled={index===lines.length-1} onClick={()=>choose(index+1)}>下一句<ArrowRight size={16}/></button></div></article></div>:<p className={readerStyles.empty}>这张截图没有可解读的文字气泡。</p>}{report.decision?.mediaBubbles?.length>0&&<div className={readerStyles.interpretation}><strong><Image size={17}/>对话里的表情与图片</strong>{report.decision.mediaBubbles.map((bubble:Json,n:number)=><p key={n}><span className="wa-pill">{bubble.kind==='sticker'?<Sticker size={15}/>:<Image size={15}/>} {bubble.screenshotNumber ? `图 ${bubble.screenshotNumber} · ` : ""}第 {(bubble.lineIndex??n)+1} 个气泡 · {bubble.speaker==='self'?'我':'对方'}</span> {bubble.kind==='sticker'?'表情包':bubble.kind==='voice'?'语音':'图片'}{bubble.kind==='sticker'&&!bubble.text?'（无文字）':''}</p>)}</div>}<ChatPhotoClues clues={report.decision?.photoClues}/></section>;
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
  <ReportReader key={report.id||'chat-report'} items={chatSections}>{active=><>
   {active==='judgment'&&<><div className={readerStyles.overview}><article><h3><Sparkles size={18}/>当前判断</h3><p>{decision.judgment||decision.possibleIntent||'先核对本轮可见对话。'}</p></article><article><h3><Quote size={18}/>关键依据</h3><blockquote>{decision.evidence||decision.observation||'本轮暂未返回可引用的原话。'}</blockquote></article><article><h3><ArrowRight size={18}/>下一步</h3><p>{decision.nextStep||'结合原话和完整上下文决定如何回应。'}</p></article></div>{decision.partial&&<p className="wa-status">部分内容未识别，结论只覆盖当前可读材料。</p>}<InsightExplorer compact publicExample={publicExample} report={report} kind="chat" owner={publicExample?undefined:account?.account?.userId}/></>}
   {active==='tone'&&<ToneEvidence report={report}/>}
   {active==='signals'&&<><InteractionEvidence report={report} owner={publicExample?undefined:account?.account?.userId}/>{fit&&<FitReport fit={fit} current={Object.prototype.hasOwnProperty.call(report,'latestCompatibility')}/>}</>}
   {active==='replies'&&<><section className="wa-card" id="replies"><h2><Send size={21}/>现在怎么回</h2>{options.length?<Replies key={`${account?.account?.userId}:${report.id}`} options={options} report={preview||publicExample?undefined:report} account={account} styleReportIds={styleReportIds}/>:<p className={readerStyles.empty}>{report.lines?.at(-1)?.speaker==='self'?'最后一句是你发的，先等对方回应。':decision.nextStep||'这轮没有可靠的回复候选，先观察实际回应。'}</p>}{decision.replyReview&&<div className={readerStyles.interpretation}><strong>对原回复的回顾</strong><p>{decision.replyReview}</p></div>}</section>{!publicExample&&<div className="wa-actions"><button disabled={!account?.account?.userId} onClick={()=>{try{followup(report,account!.account.userId);}catch(e){setFollowupError(message(e));}}}><MessageCircle size={16}/>带着报告问军师</button>{report.subjectId&&<a className="wa-button" href={`/archive?subjectId=${report.subjectId}`}>人物档案</a>}</div>}<ErrorNotice error={followupError}/>{!preview&&!publicExample&&<ReportFollowUp report={report} owner={account?.account?.userId}/>}</>}
  </>}</ReportReader>
  <ReportActions report={report} publicExample={publicExample}/>
 </div>;
}
export function SocialReport({ report, account, subjectId, targetSelf, onSubjectChange, publicExample = false }: { report: Json; account: Json | null; subjectId: string; targetSelf: boolean; onSubjectChange?: (id: string) => void; publicExample?: boolean }) {
  const [consent, setConsent] = useState(false), [archiveTogether, setArchiveTogether] = useState(false), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState(""), [archiveSubject, setArchiveSubject] = useState(subjectId);
  const source = report.moments || report;
  const extraCommonPoints:Json[] = report.moments ? (source.commonPoints || []).filter((row:Json)=>!(report.commonPoints || []).some((other:Json)=>other.title===row.title && other.meaning===row.meaning)) : [];
  const extraFitSummary = report.moments && source.fitSummary !== report.fitSummary ? source.fitSummary : '';
  const photoClues:Json[] = [...(report.photoClues || []), ...(report.moments?.photoClues || [])].filter((row:Json,index:number,all:Json[])=>all.findIndex(other=>other.item===row.item && other.evidence===row.evidence && other.style===row.style)===index);
  const sections:ReadingSection[]=[
    {id:"overview",label:"人物判断",caption:"先了解这个人的可见特点",tone:"coral"},
    {id:"content",label:report.moments?"内容图表":"主页画像",caption:"从资料和图表看表达倾向",tone:"amber"},
    {id:"evidence",label:"依据适配",caption:"区分事实、线索与尚待了解的信息",tone:"teal"},
    {id:"next",label:"下一步",caption:"把分析变成一次自然交流",tone:"slate"},
  ];
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function save(nextSubject = archiveSubject) {
    if (publicExample || busy || saved || (!targetSelf && !nextSubject)) return;
    setBusy(true); setError("");
    try {
      const material = socialArchiveMaterial(report, targetSelf);
      if (!material.candidates.length && !material.basics.length) throw new Error("这组截图没有可保存的文字线索，请补充清晰的个人资料页。");
      const state = await api("/api/web/profile");
      if (!state.enabled || state.paused) await api("/api/web/profile", { action: "consent", enabled: true });
      await api("/api/web/profile", { action: "import-social", confirmed: true, target: targetSelf ? "self" : "subject", subjectId: targetSelf ? null : nextSubject, ...material, communicationReading: report.moments ? null : { summary: report.summary, hypotheses: report.hypotheses, approach: report.approach }, momentsReport: report.moments || null });
      if (mounted.current) { setSaved(true); setConsent(false); }
    } catch (e) { if (mounted.current) setError(message(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <div className={reportStyles.document}>
    <ReportReader key={report.id || (report.moments?"moments":"social")} items={sections}>{active=><>
    {active === "overview" && <><section className="wa-card"><h2><UserRound size={21}/>{targetSelf ? "我的资料印象" : report.moments ? "朋友圈人物分析" : "社交资料分析"}</h2><div className={readerStyles.overview}><article><h3><Sparkles size={18}/>当前判断</h3><p>{source.summary || report.summary}</p></article></div>{report.coverage && <p className="wa-muted">{report.coverage}</p>}{report.note && <small className="wa-muted">{report.note}</small>}</section><InsightExplorer compact publicExample={publicExample} report={{ ...report, subjectId: targetSelf ? "" : archiveSubject }} kind="social" owner={publicExample ? undefined : account?.account?.userId}/></>}
    {active === "content" && <SocialContentPanel report={report}/>}
    {active === "evidence" && <>
    {report.visibleFacts?.length > 0 && (report.moments || report.profileBasics?.length || report.profileContext?.length) && <section className="wa-card"><h2><ScanLine size={21}/>看得见的事实</h2><Findings rows={report.visibleFacts}/></section>}
    {(report.positives?.length > 0 || report.cautions?.length > 0) && <section className="wa-card">{report.positives?.length > 0 && <><h2>积极线索</h2><Findings rows={report.positives}/></>}{report.cautions?.length > 0 && <><h2>需要留意</h2><Findings rows={report.cautions}/></>}</section>}
    {report.fit?.length > 0 ? <FitReport fit={report}/> : report.commonPoints?.length > 0 && <section className="wa-card"><h2>你们的交集</h2><Findings rows={report.commonPoints}/></section>}
    {report.moments && <>
      {(source.behaviorClues?.length > 0 || source.statistics?.summaries?.length > 0) && <section className="wa-card"><h2><ChartNoAxesCombined size={21}/>从动态看相处线索</h2>{[...(source.behaviorClues || []), ...(source.statistics?.summaries || [])].map((row:Json,index:number)=><div className="wa-insight" key={index}><h3>{row.title || row.dimension}{row.sourceType ? ` · ${row.sourceType}` : ''}</h3>{row.support && <small className="wa-muted">{row.support}</small>}<p>{row.reading}</p>{row.quote && <blockquote>{row.quote}</blockquote>}{row.evidence && <p className="wa-muted">依据：{row.evidence}</p>}{row.alternative && <p>另一种可能：{row.alternative}</p>}</div>)}</section>}
      {source.themes?.length > 0 && <section className="wa-card"><h2><Layers3 size={21}/>反复出现的话题</h2><Findings rows={source.themes}/></section>}
      {source.statistics?.milestones?.length > 0 && <section className="wa-card"><h2><Layers3 size={21}/>动态中的重要事件</h2>{source.statistics.milestones.map((row:Json,index:number)=><div className="wa-insight" key={index}><h3>{row.title} · {row.date}</h3><blockquote>{row.quote}</blockquote><small className="wa-muted">{row.evidence} · 日期为动态发布日期</small></div>)}</section>}
      {source.visibility && <section className="wa-card"><h2><Eye size={21}/>可见范围 · {source.visibility.label}</h2><p>{source.visibility.reading}</p><small className="wa-muted">{source.visibility.evidence}</small>{source.visibility.possibilities?.map((line:string,index:number)=><p key={index}>{line}</p>)}</section>}
      {(extraCommonPoints.length > 0 || extraFitSummary) && <section className="wa-card"><h2><HeartHandshake size={21}/>动态里的相处交集</h2>{extraFitSummary && <p>{extraFitSummary}</p>}<Findings rows={extraCommonPoints}/></section>}
    </>}
    <SocialMaterialEvidence report={{...report, profileBasics: report.moments ? report.profileBasics : undefined, profileContext: report.moments ? report.profileContext : undefined, photoClues}}/></>}
    {active === "next" && <>
    <SocialNextAdvice report={report}/>
    <section className="wa-card"><h2><Layers3 size={21}/>接下来怎么了解</h2>{!targetSelf && <><h3>需要核实的信号 · {report.riskSignals?.length || 0} 条</h3>{report.riskSignals?.length ? <Findings rows={report.riskSignals}/> : <p className="wa-muted">本组资料未发现具体信号，相处中仍可继续观察。</p>}</>}{report.questions?.length > 0 && <><h3>可以问</h3>{report.questions.map((item: string, index: number) => <p key={index}>{item}</p>)}</>}{report.unknowns?.length > 0 && <><h3>还可以了解什么</h3>{report.unknowns.map((item: string, index: number) => <p key={index}>{item}</p>)}</>}{report.nextMaterials?.length > 0 && <><h3>想看得更完整，可以补充</h3>{report.nextMaterials.map((item: string, index: number) => <p key={index}>{item}</p>)}</>}{report.kind === "chat" && <a className="wa-button" href="/analyze?mode=chat">去分析聊天截图</a>}</section>
    {!publicExample && report.kind === "profile" && <section className="wa-card"><h2>{targetSelf ? "保存到我的档案" : "把线索放进人物档案"}</h2><p className="wa-muted">可见文字和基础信息先进入待核对区，确认后才补进档案；已有手填资料不覆盖，原图不长期保存。</p>{targetSelf || archiveSubject ? <><label className="wa-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy || saved}/>我确认这些资料属于{targetSelf ? "我" : "所选人物"}，同意启用或恢复档案并保存本次线索、分析摘要，之后可核对或删除。</label><button disabled={!consent || busy || saved} onClick={() => void save()}>{saved ? "已保存到档案" : busy ? "保存中…" : "确认归档"}</button></> : <><label className="wa-check"><input type="checkbox" checked={archiveTogether} disabled={busy} onChange={event => setArchiveTogether(event.target.checked)}/>建档后同时把本组可见线索与分析归档，之后可核对或删除。</label><InlinePerson disabled={busy} onCreated={async id => { setArchiveSubject(id); onSubjectChange?.(id); if (archiveTogether) await save(id); }}/></>}{(saved || archiveSubject || targetSelf) && <div className="wa-actions"><a className="wa-button" href={targetSelf ? "/archive?tab=self" : `/archive?subjectId=${archiveSubject}`}>{saved ? "去核对线索" : "查看档案"}</a></div>}{report.moments && <p className="wa-muted">归档后可在人物档案查看完整报告；再次归档会更新最新报告，推测不作为已确认事实。</p>}</section>}
    {!publicExample && <div className="wa-actions"><button disabled={!account?.account?.userId} onClick={() => { try { followup({ ...report, subjectId: targetSelf ? "" : archiveSubject }, account!.account.userId, report.moments ? "朋友圈分析" : "社交资料分析"); } catch (e) { setError(message(e)); } }}>带着报告问军师</button></div>}
    <ErrorNotice error={error}/></>}
  </>}</ReportReader><ReportActions report={report} kind="social" publicExample={publicExample}/></div>;
}
