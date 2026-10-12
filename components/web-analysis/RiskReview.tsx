"use client";

import { ArrowRight, Eye, HeartHandshake, Quote, Repeat2, Shield, TriangleAlert } from "lucide-react";
import { relationshipRiskReview } from "@/lib/relationship-risk";
import type { Json } from "./client";
import styles from "./RiskReview.module.css";

const kinds = {
  safety: { label: "安全与边界", Icon: Shield },
  expectation: { label: "关系预期", Icon: HeartHandshake },
  pattern: { label: "相处模式", Icon: Repeat2 },
};

export function RiskReview({ report }: { report: Json }) {
  if (report.targetSelf || report.target === "self") return null;
  const review = relationshipRiskReview(report);
  const signals = review.signals.slice(0, 4);
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
      return <article className={styles.signal} key={`${signal.kind}:${signal.title}:${index}`} data-risk-kind={signal.kind}>
        <div className={styles.signalType}><span><Icon size={17}/>{kind.label}</span><b>{signal.kind === "safety" && signal.level === "警惕" ? <><TriangleAlert size={15}/>警惕</> : "需确认"}</b></div>
        <h3>{signal.title}</h3>
        <div className={styles.evidence}><span><Quote size={15}/>材料依据</span><blockquote>{signal.evidence}</blockquote></div>
        <div className={styles.meaning}><strong>可能影响</strong><p>{signal.reading}</p></div>
        {signal.alternative && <p className={styles.alternative}><Eye size={16}/><span><strong>也可能：</strong>{signal.alternative}</span></p>}
        <div className={styles.action}><ArrowRight size={18}/><div><strong>你可以怎么做</strong><p>{signal.action}</p></div></div>
      </article>;
    })}</div>}
  </section>;
}
