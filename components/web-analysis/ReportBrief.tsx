"use client";

import { useEffect, useState } from "react";
import { riskAwarePresentation } from "@/lib/risk-aware-presentation";
import { ArrowRight, ChartNoAxesCombined, Check, CircleHelp, Copy, Lightbulb, MessageCircle, Quote, ScanEye, Sparkles } from "lucide-react";
import type { Json } from "./client";
import styles from "./ReportCard.module.css";
import readerStyles from "./ReportReader.module.css";
import { RelationshipSnapshot } from "@/components/RelationshipJourney";
import {KeyEvidenceList} from "./ReportReadingTools";

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

export function ChatReportBrief({ report, diagnosis }: { report: Json; diagnosis?: Json | null }) {
  const presentation = riskAwarePresentation(report);
  const source = diagnosis || report.relationshipDiagnosis || {};
  const semantic = report.semanticHistory || source.semanticHistory;
  const coverage = source.coverage || {};
  const fullHistory = report.analysisScope === "fullHistory" || report.captureFormat === "full-history";
  const judgment = presentation.judgment || source.relationship?.currentState || "材料还不足以形成稳定判断。";
  const trend = semantic?.status === "complete" ? semantic.trend : source.relationship?.trend;
  const action = presentation.nextStep || source.decision?.recommendation || "结合下一次真实回应，再更新判断。";
  return <section className={styles.relationshipBrief} aria-label="报告速读" data-report-brief data-risk-priority={presentation.mode}>
    <header><span><Sparkles size={18}/>{fullHistory ? "完整关系报告" : "这次聊天，先看结论"}</span>{typeof coverage.total === "number" && <small>{coverage.total} 条消息{coverage.startDate && coverage.endDate ? ` · ${coverage.startDate} — ${coverage.endDate}` : ""}</small>}</header>
    <div className={styles.briefTopline}><div className={styles.briefJudgment}>
      <h2>{presentation.mode !== "normal" && presentation.title ? presentation.title : "当前判断"}</h2>
      <p>{judgment}</p>
    </div><RelationshipSnapshot activity={report.chatActivity || report.relationshipContext?.activity}/></div>
    <div className={styles.briefEvidence}><h3><Quote size={17}/>关键依据</h3><KeyEvidenceList report={report} priorityEvidence={presentation.mode !== "normal" ? presentation.evidence : undefined}/></div>
    <div className={styles.briefDirection}>
      <article><h3><ChartNoAxesCombined size={17}/>关系趋势</h3><p>{trend || "材料不足，暂不判断变化。"}</p>{!semantic || semantic.status !== "complete" ? <small>已完成的统计可在「看见变化」查看；文字解读是否完成见分析范围。</small> : null}</article>
      <article><h3><ArrowRight size={17}/>下一步</h3><p>{action}</p></article>
    </div>
    {!report.sourceCoverage?.length && semantic?.coverage && <p className={styles.briefCoverage}>已解读 {semantic.coverage.analyzedText} / {semantic.coverage.receivedText} 条可读文字{typeof coverage.voiceCount === "number" && coverage.voiceCount > 0 ? ` · 语音转写 ${coverage.voiceTranscribed || 0} / ${coverage.voiceCount} 条` : ""}{semantic.status !== "complete" ? " · 文字分析尚未全部完成" : ""}</p>}
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
