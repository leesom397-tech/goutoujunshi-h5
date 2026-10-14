"use client";

import { ArrowRight, Eye, HeartHandshake, Quote, Repeat2, Shield, TriangleAlert } from "lucide-react";
import { relationshipRiskReview } from "@/lib/relationship-risk";
import {riskEvidenceOccurrences} from "@/lib/report-reading";
import type { Json } from "./client";
import styles from "./RiskReview.module.css";
import { CaptureEvidence } from "./CaptureEvidence";
import type { RiskAwarePresentation } from "@/lib/risk-aware-presentation";

const kinds = {
  safety: { label: "安全与边界", Icon: Shield },
  expectation: { label: "关系预期", Icon: HeartHandshake },
  pattern: { label: "相处模式", Icon: Repeat2 },
};

export function RiskActionNotice({ presentation }: { presentation: RiskAwarePresentation }) {
  if (presentation.mode === "normal" || !presentation.priority) return null;
  return <aside className={styles.actionNotice} data-risk-action={presentation.mode}><strong><Shield size={19}/>{presentation.title}</strong><p>{presentation.nextStep}</p><small>{presentation.mode === "safety" ? "回复已优先围绕这条明确要求处理边界；是否继续回应，由你决定。" : "先对齐双方当前想法；短期取向本身不代表品德问题。"}</small><CaptureEvidence quote={presentation.priority.evidence}/></aside>;
}

export function RiskReview({ report }: { report: Json }) {
  if (report.targetSelf || report.target === "self") return null;
  const review = relationshipRiskReview(report);
  const signals = review.signals.slice(0, 4);
  if (!signals.length) return null;
  const state = signals.length ? "signals" : review.assessed ? "clear" : "unassessed";
  return <section className={styles.review} data-risk-review data-risk-state={state} aria-label="风险与关系预期">
    <header className={styles.heading}>
      <h2><Shield size={22}/>风险与关系预期</h2>
      <span className={styles.count}>{signals.length ? `${signals.length} 条需核对` : review.assessed ? "本次材料" : "尚未评估"}</span>
    </header>
    <p className={styles.summary}>{review.summary || (review.assessed ? "本次材料暂未显示明确的风险信号，仍需结合后续相处。" : "现有资料不足，尚未评估风险。补充更多原话和互动后再看。")}</p>
    {signals.length > 0 && <div className={styles.grid}>{signals.map((signal, index) => {
      const kind = kinds[signal.kind] || kinds.pattern;
      const Icon = kind.Icon;
      const occurrences=riskEvidenceOccurrences(report,signal.evidence);
      return <article className={styles.signal} key={`${signal.kind}:${signal.title}:${index}`} data-risk-kind={signal.kind}>
        <div className={styles.signalType}><span><Icon size={17}/>{kind.label}</span><b>{signal.kind === "safety" && signal.level === "警惕" ? <><TriangleAlert size={15}/>警惕</> : "需确认"}</b></div>
        <h3>{signal.title}</h3><p className={styles.occurrences} data-risk-occurrences>{occurrences.count>0?"本次材料 "+occurrences.count+" 处 · 相同截图原话已去重":"已保留依据，暂不能核对具体处数"}{occurrences.dates.length>0&&<span>{occurrences.dates.slice(0,3).join("、")}</span>}</p>
        <div className={styles.evidence}><span><Quote size={15}/>材料依据</span><blockquote>{signal.evidence}</blockquote><CaptureEvidence quote={signal.evidence}/></div>
        <div className={styles.meaning}><strong>可能影响</strong><p>{signal.reading}</p></div>
        {signal.alternative && <p className={styles.alternative}><Eye size={16}/><span><strong>也可能：</strong>{signal.alternative}</span></p>}
        <div className={styles.action}><ArrowRight size={18}/><div><strong>你可以怎么做</strong><p>{signal.action}</p></div></div>
      </article>;
    })}</div>}
  </section>;
}
