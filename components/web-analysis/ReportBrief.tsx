"use client";

import { useEffect, useState } from "react";
import { riskAwarePresentation } from "@/lib/risk-aware-presentation";
import { ArrowRight, ChartNoAxesCombined, Check, CircleHelp, Copy, Lightbulb, MessageCircle, Quote, ScanEye, Sparkles } from "lucide-react";
import type { Json } from "./client";
import styles from "./ReportCard.module.css";
import readerStyles from "./ReportReader.module.css";
import { GlassStudy } from "@/components/GlassStudy";
import { ReportVisualMetrics } from "./ReportVisualMetrics";
import visual from "./RelationshipBriefVisual.module.css";
import {KeyEvidenceList} from "./ReportReadingTools";
import {reportIdentity,reportGoal} from "./report-context";
import { reportGuidanceProvenance } from "@/lib/report-guidance-provenance";
import { projectReportDecisionInsights } from "@/lib/report-decision-insights";
import { ReportDecisionInsights } from "./ReportDecisionInsights";
import { ReportSectionLink } from "./ReportReader";
import { reportAffinity, validScore } from "./report-data";

/** A usable reply in the first reading surface, without another navigation step. */
export function ReportReplyPreview({ text, reason, label = "现在可以这样回" }: { text?: string; reason?: string; label?: string }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState("");
  useEffect(() => { setCopied(false); setError(""); }, [text]);
  if (!text?.trim()) return null;
  async function copy() {
    try { await navigator.clipboard.writeText(text!); setCopied(true); setError(""); }
    catch { setError("复制没有完成，可以选中这段文字复制。"); }
  }
  return <section className={readerStyles.quickReply} data-report-quick-reply aria-label={label}><header><h3><MessageCircle size={20}/>{label}</h3><button type="button" onClick={() => void copy()}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? "已复制" : "复制"}</button></header><blockquote>{text}</blockquote>{reason && <p>{reason}</p>}{error && <p role="alert">{error}</p>}</section>;
}

const firstSentence = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text.match(/^.{1,150}?[。！？]/)?.[0] || text.slice(0, 115);
};
const entries = (value: unknown): unknown[] => Array.isArray(value) ? value.filter(Boolean) : [];

export function ReportChapterArt({kind}:{kind:"change"|"next"}) {
  return <div className={visual.chapterArt} data-report-art={kind}><GlassStudy imageSrc={`/images/report-aurora-${kind}-v3.webp`} variant="report"/></div>;
}

export function ChatReportBrief({ report, diagnosis, showMetrics=true }: { report: Json; diagnosis?: Json | null; showMetrics?:boolean }) {
  const presentation = riskAwarePresentation(report);
  const identity=reportIdentity(report),goal=reportGoal(report);
  const source = diagnosis || report.relationshipDiagnosis || {};
  const semantic = report.semanticHistory || source.semanticHistory;
  const coverage = source.coverage || {};
  const fullHistory = report.analysisScope === "fullHistory" || report.analysisScope === "uploadedHistory" || report.captureFormat === "full-history";
  const momentOnly = fullHistory && report.captureKind === "moments";
  const affinity=reportAffinity(report),score=validScore(affinity?.value)?Math.round(affinity!.value):null;
  const judgment = presentation.judgment || semantic?.summary || source.relationship?.currentState || "材料还不足以形成稳定判断。";
  const trend = semantic?.status === "complete" ? semantic.trend : source.relationship?.trend;
  const action = presentation.nextStep || semantic?.action || source.decision?.recommendation || "结合下一次真实回应，再更新判断。";
  const provenance=reportGuidanceProvenance(report),updated=fullHistory&&provenance.hasGuidanceUpdate;
  const replyCount=Array.isArray(presentation.replyOptions)?presentation.replyOptions.length:0;
  const currentStep=Array.isArray(semantic?.actionPlan?.steps)?semantic.actionPlan.steps[0]:null;
  const headline=updated?(currentStep?.title||firstSentence(action)):firstSentence(judgment);
  const observation=typeof currentStep?.observeFor==='string'?currentStep.observeFor:semantic?.observeWindow;
  const hasDecisionInsights=projectReportDecisionInsights(report).length>0;
  const savedContext=<>{fullHistory&&goal!=='risk'&&trend&&<div className={visual.trend}><ChartNoAxesCombined size={17}/><span>{updated?'原分析趋势':momentOnly?'动态变化':'关系趋势'}</span><strong>{trend}</strong></div>}{fullHistory&&coverage.startDate&&coverage.endDate&&<p className={visual.scope}>{coverage.startDate} — {coverage.endDate}</p>}</>;
  return <section className={visual.brief} aria-label="报告速读" data-report-brief data-risk-priority={presentation.mode}>
    <div className={visual.hero} data-report-decision-summary>
      <div className={visual.verdict}>
        <div className={visual.kicker}><span className={visual.liveDot}/>{updated?"当前先处理":goal==='risk'?"先看风险判断":momentOnly?"先看这个人":fullHistory?"现在是什么情况":"这次对话透露了什么"}</div>
        <span className={visual.verdictLabel}>{presentation.mode !== "normal" && presentation.title ? presentation.title : momentOnly?`${identity.other}的自我呈现`:goal==='risk'?`关于${identity.other}的风险判断`:`${identity.direction}`}</span>
        {fullHistory&&!momentOnly&&<div className={visual.summaryScore} data-brief-affinity-score><span>好感信号{updated?' · 原评分':''}</span><strong>{score===null?'待判断':score}{score!==null&&<small>/100</small>}</strong><small>{score===null?'当前没有可用评分':updated?'建议已更新，分数未重算':'互动综合评分，非喜欢概率'}</small></div>}
        <h2>{headline}</h2>
        {updated&&<p className={visual.verdictBody}>{action}</p>}
        {!updated&&judgment!==headline&&<p className={visual.verdictBody} data-complete-judgment>{judgment.startsWith(headline)?judgment.slice(headline.length):judgment}</p>}
        {updated?<><p className={visual.scope} data-guidance-provenance>建议更新于 {provenance.guidanceAt}</p><details open className={visual.originalAnalysis} data-original-analysis><summary>原分析与本次更新说明</summary><p>{provenance.note}</p><p className={visual.scope}>原分析生成于 {provenance.analysisAt||"时间未记录"}</p><p>{judgment}</p>{savedContext}</details></>:<>{provenance.analysisAt&&<p className={visual.scope} data-analysis-generated>分析生成于 {provenance.analysisAt}</p>}{savedContext}</>}
      </div>
      <aside className={visual.action}><span className={visual.actionLabel}>{updated&&observation?"这一步之后":"接下来怎么做"}</span><h3>{updated&&observation?"留意对方的具体回应":updated?"选一句适合你的回复":"下一步"}</h3>{updated&&observation?<p>{observation}</p>:!updated?<p>{action}</p>:null}<ReportSectionLink section="next">{replyCount?`看 ${replyCount} 种回法与相处建议`:"看具体相处建议"}<ArrowRight size={17}/></ReportSectionLink><div className={visual.actionContour} aria-hidden="true"/></aside>
    </div>
    {hasDecisionInsights?<ReportDecisionInsights report={report}/>:<div className={visual.readingGrid}>
      <div className={visual.evidence} data-brief-evidence><header><span className={visual.chapter}>01</span><h3>{updated?"原判断引用的依据":"判断从这里来"}</h3><Quote size={23}/></header>{updated?<details><summary>核对原话依据</summary><KeyEvidenceList report={report} priorityEvidence={presentation.mode !== "normal" ? presentation.evidence : undefined} showReferences={false}/></details>:<KeyEvidenceList report={report} priorityEvidence={presentation.mode !== "normal" ? presentation.evidence : undefined} showReferences={false}/>}</div>
    </div>}
    {showMetrics&&<ReportVisualMetrics report={report}/>}
    {!report.sourceCoverage?.length && semantic?.coverage && <p className={visual.coverage}>已解读 {semantic.coverage.analyzedText} / {semantic.coverage.receivedText} 条可读文字{typeof coverage.voiceCount === "number" && coverage.voiceCount > 0 ? ` · 语音转写 ${coverage.voiceTranscribed || 0} / ${coverage.voiceCount} 条` : ""}{semantic.status !== "complete" ? " · 文字分析尚未全部完成" : ""}</p>}
  </section>;
}

export function SocialReportBrief({ report }: { report: Json }) {
  const presentation = riskAwarePresentation(report);
  const source = presentation.viewReport.moments || presentation.viewReport;
  const hypotheses: Json[] = Array.isArray(source.hypotheses) ? source.hypotheses : [];
  const stats: Json | undefined = source.statistics;
  const rows: Json[] = Array.isArray(stats?.visibleContent) ? stats.visibleContent : [];
  const counts = [
    { label: "可见事实", value: entries(report.visibleFacts).length, icon: ScanEye },
    { label: "待验证推测", value: hypotheses.length, icon: Lightbulb },
    { label: "仍待了解", value: entries(report.unknowns).length, icon: CircleHelp },
  ];
  const total = counts.reduce((sum, row) => sum + row.value, 0);
  const max = Math.max(1, ...counts.map(row => row.value));
  return <section className={`report-brief report-brief-social ${styles.brief}`} aria-label="报告速读">
    <div className="report-brief-heading"><span><Sparkles size={20} aria-hidden="true"/>先看这 30 秒</span><small>看见 → 推测 → 怎么聊</small></div>
    <div className="report-brief-grid">
      <article className="report-brief-main"><span className="report-brief-number"><ScanEye size={19} aria-hidden="true"/>01 / 看到什么</span><h3>{firstSentence(source.summary || report.summary)}</h3><p className="report-brief-caption">{report.coverage || "仅根据这批可见材料"}</p></article>
      <article className="report-brief-evidence"><span className="report-brief-number"><Quote size={19} aria-hidden="true"/>02 / 关键依据</span><KeyEvidenceList report={report} priorityEvidence={presentation.mode!=="normal"?presentation.evidence:undefined}/></article>
      <article className="report-brief-action"><span className="report-brief-number"><ArrowRight size={19} aria-hidden="true"/>03 / 下一步</span><p>{firstSentence(presentation.mode !== "normal" ? presentation.nextStep : hypotheses[0]?.verify || source.approach?.attitude || report.approach?.attitude) || "从一个具体话题开始，观察真实回应。"}</p></article>
    </div>
    {rows.length > 0 ? <div className="report-brief-chart"><div className="report-brief-score"><ChartNoAxesCombined size={20} aria-hidden="true"/><span>本批内容构成</span><strong>{stats?.total || 0}<span> 条动态</span></strong><small>仅统计可见动态</small></div><div className="report-brief-bars" role="img" aria-label={rows.map(row => `${row.label} ${row.count} 条，${row.percent}%`).join("；")}>{rows.slice(0, 6).map(row => <div key={row.label}><span>{row.label}</span><i><b style={{ width: `${Math.max(0, Math.min(100, Number(row.percent) || 0))}%` }}/></i><em>{row.percent}% · {row.count} 条</em></div>)}</div></div> : <div className="report-brief-chart report-brief-count-chart"><div className="report-brief-score"><ChartNoAxesCombined size={20} aria-hidden="true"/><span>本次报告的线索</span><strong>{total}<span> 项记录</span></strong><small>按报告条目计数，非概率</small></div><div className="report-brief-counts" role="img" aria-label={counts.map(row => `${row.label} ${row.value} 项`).join("；")}>{counts.map(row => { const Icon = row.icon; return <div key={row.label}><span><Icon size={17} aria-hidden="true"/>{row.label}</span><strong>{row.value}<small>项</small></strong><i><b style={{width:`${row.value / max * 100}%`}}/></i></div>; })}</div></div>}
    <p className="report-brief-hint"><ScanEye size={17} aria-hidden="true"/>点下方标签，查看对应图表与依据。</p>
  </section>;
}
