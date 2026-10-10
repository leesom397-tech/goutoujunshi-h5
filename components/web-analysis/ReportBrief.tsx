"use client";

import { ArrowRight, Heart, MessageCircle, ScanEye, Sparkles } from "lucide-react";
import type { Json } from "./client";
import { validScore, visibleSignalProfile } from "./report-data";

const firstSentence = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text.match(/^.{1,150}?[。！？]/)?.[0] || text.slice(0, 115);
};

export function ChatReportBrief({ report }: { report: Json }) {
  const decision = report.decision || {};
  const lines: Json[] = Array.isArray(report.lines) ? report.lines : [];
  const annotations: Json[] = Array.isArray(report.annotations) ? report.annotations : [];
  const signals = visibleSignalProfile(lines);
  const seen = signals.filter(row => row.count > 0);
  const affinity = report.affinity || decision.affinityPreview;
  const score = validScore(affinity?.value) ? Math.round(affinity.value) : null;
  const quote = typeof decision.evidence === "string" ? decision.evidence.match(/“([^”]+)”/)?.[1] || "" : "";
  const tone = annotations.flatMap(row => {
    const line = lines.find(item => item.id === row.lineId);
    return line?.speaker === "other" ? (row.emotion || []).map((item: Json) => item.label).filter(Boolean) : [];
  }).filter((label: string, index: number, all: string[]) => all.indexOf(label) === index).slice(0, 2);
  return <section className="report-brief" aria-label="报告速读">
    <div className="report-brief-heading"><span><Sparkles size={15}/> 先看这 30 秒</span><small>判断 → 依据 → 下一步</small></div>
    <div className="report-brief-grid">
      <article className="report-brief-main"><span className="report-brief-number">01 / 当前判断</span><h3>{firstSentence(decision.judgment || decision.possibleIntent) || "先从本轮可见材料判断。"}</h3><p>本轮暂定判断</p></article>
      <article className="report-brief-evidence"><span className="report-brief-number">02 / 关键原话</span><blockquote>{quote || lines.find(line => line.speaker === "other")?.text || "查看下方逐句依据"}</blockquote><div className="report-brief-tags"><MessageCircle size={15}/>{tone.length ? `文字语气：${tone.join("、")}` : "语气要结合上下文核对"}</div></article>
      <article className="report-brief-action"><span className="report-brief-number">03 / 下一步</span><p>{firstSentence(decision.nextStep) || "先观察对方真实回应，再决定下一步。"}</p><ArrowRight size={20} aria-hidden="true"/></article>
    </div>
    <div className="report-brief-chart"><div className="report-brief-score"><Heart size={16}/><span>好感与互动信号</span><strong>{score === null ? `${seen.length}/6 类` : `${score}/100`}</strong><small>{score === null ? "已看到的线索类别，不是好感概率" : "本轮互动参考指数，不是喜欢你的概率"}</small></div><div className="report-brief-bars" role="img" aria-label={signals.map(row => `${row.label} ${row.count} 句`).join("；")}>{signals.map(row => <div key={row.key}><span>{row.label}</span><i><b style={{ width: `${Math.max(0, Math.min(100, row.value))}%` }}/></i><em>{Math.round(row.value)}% · {row.count}句</em></div>)}</div></div>
    <p className="report-brief-hint"><ScanEye size={15}/> 点下方标签，按需查看依据。</p>
  </section>;
}

export function SocialReportBrief({ report }: { report: Json }) {
  const source = report.moments || report;
  const hypotheses: Json[] = Array.isArray(source.hypotheses) ? source.hypotheses : [];
  const stats: Json | undefined = source.statistics;
  const rows: Json[] = Array.isArray(stats?.visibleContent) ? stats.visibleContent : [];
  return <section className="report-brief report-brief-social" aria-label="报告速读"><div className="report-brief-heading"><span><Sparkles size={15}/> 先看这 30 秒</span><small>看见 → 推测 → 怎么聊</small></div><div className="report-brief-grid"><article className="report-brief-main"><span className="report-brief-number">01 / 看到什么</span><h3>{firstSentence(source.summary || report.summary)}</h3><p>{report.coverage || "仅根据这批可见材料"}</p></article><article className="report-brief-evidence"><span className="report-brief-number">02 / 可以怎样理解</span><h3>{hypotheses[0]?.title || "先分清可见事实与推测"}</h3><p>{firstSentence(hypotheses[0]?.possibility) || "更多材料有助于校正判断。"}</p></article><article className="report-brief-action"><span className="report-brief-number">03 / 下一步</span><p>{firstSentence(hypotheses[0]?.verify || source.approach?.attitude || report.approach?.attitude) || "从一个具体话题开始，观察真实回应。"}</p><ArrowRight size={20} aria-hidden="true"/></article></div>{rows.length > 0 && <div className="report-brief-chart"><div className="report-brief-score"><Heart size={16}/><span>本批内容构成</span><strong>{stats?.total || 0} 条</strong><small>只统计可见动态，不代表完整朋友圈</small></div><div className="report-brief-bars" role="img" aria-label={rows.map(row => `${row.label} ${row.percent}%`).join("；")}>{rows.slice(0, 6).map(row => <div key={row.label}><span>{row.label}</span><i><b style={{ width: `${Math.max(0, Math.min(100, Number(row.percent) || 0))}%` }}/></i><em>{row.percent}% · {row.count}条</em></div>)}</div></div>}<p className="report-brief-hint"><ScanEye size={15}/> 点下方标签，按需查看图表与依据。</p></section>;
}
