"use client";

import { ArrowRight, HeartHandshake, Link2, MessageCircle, ShieldAlert, TrendingUp } from "lucide-react";
import type { ArchiveState, Person } from "@/app/archive/types";
import styles from "@/app/archive/archive.module.css";

type Section = "overview" | "profile" | "evidence" | "trend";
type Props = {
  person: Person;
  signal?: ArchiveState["signals"][number];
  recent?: ArchiveState["trends"][number]["points"][number];
  onSection: (section: Section) => void;
};

/** A short entry to existing evidence. Full reports remain in the evidence section. */
export function PersonOverview({ person, signal, recent, onSection }: Props) {
  const saved = person.savedAnalysis;
  const savedChat = person.savedChatAnalysis;
  const diagnosis = savedChat?.diagnosis;
  const currentSignal = savedChat && (!signal || savedChat.createdAt > signal.updatedAt) ? undefined : signal;
  const reading = person.communicationReading || saved?.reading || null;
  const moments = person.momentsReport || saved?.moments || null;
  const diagnosisCommon = (diagnosis?.personalConnection?.commonPoints || []).map((item: any, index) => typeof item === "string" ? { title: item, meaning: "来自双方已提供材料的共同线索。" } : item && typeof item === "object" ? { title: String(item.title || item.label || `共同点 ${index + 1}`), meaning: String(item.meaning || item.reading || item.text || "来自双方已提供材料的共同线索。") } : null).filter(Boolean) as { title: string; meaning: string }[];
  const common = [...(moments?.commonPoints || []), ...diagnosisCommon];
  const fit = person.compatibility;
  const meaningfulFit = fit && (fit.coverage > 0 || fit.fit.some(row => row.status !== "待了解"));
  const risks = moments?.riskReview?.signals || (diagnosis?.relationship?.risks || []).map((reading, index) => ({ title: `风险线索 ${index + 1}`, reading, action: "结合后续真实互动核对，不按单条记录下结论。" }));
  const judgement = diagnosis?.relationship?.currentState || currentSignal?.summary || savedChat?.summary || saved?.summary || reading?.summary || moments?.summary || "还没有分析过这位人物。补充一段材料，就能接着了解 TA。";
  const next = diagnosis?.decision?.recommendation || currentSignal?.nextStep || moments?.approach?.attitude || reading?.approach?.attitude;
  const hasEvidence = !!(reading || moments || meaningfulFit || currentSignal?.reportId || savedChat?.reportId || saved?.reportId);
  return <div className={styles.overview}>
    <section className={`${styles.card} ${styles.overviewLead}`} aria-label="人物关系概览">
      <div className={styles.sectionHead}><h2><HeartHandshake size={21}/>眼下最值得知道的</h2>{currentSignal?.score != null && <span className={styles.badge}>互动参考 {currentSignal.score} / 100{currentSignal.estimated ? " · 片段" : ""}</span>}</div>
      <p className={styles.overviewJudgement}>{judgement}</p>
      {next && <div className={styles.overviewNext}><ArrowRight size={19}/><div><strong>下一步</strong><p>{next}</p></div></div>}
      <div className={styles.overviewFoot}>{currentSignal?.eventStart ? <small>{currentSignal.eventStart}{currentSignal.eventEnd && currentSignal.eventEnd !== currentSignal.eventStart ? ` 至 ${currentSignal.eventEnd}` : ""}的已分析材料</small> : <small>{hasEvidence ? "依据已保存的分析；新材料会继续更新判断。" : "可以先问一个疑问，也可以补充材料做完整分析。"}</small>}{hasEvidence && <button className={styles.link} onClick={() => onSection("evidence")}>查看完整依据 <ArrowRight size={15}/></button>}</div>
    </section>

    <div className={styles.overviewGrid}>
      {(recent && (recent.changeSummary || recent.summary && recent.summary !== judgement) || diagnosis?.relationship?.trend && diagnosis.relationship.trend !== "待了解") && <section className={`${styles.card} ${styles.overviewBrief}`}>
        <h2><TrendingUp size={20}/>{recent?.changeSummary ? "最近有什么变化" : "最近的分析记录"}</h2>
        <p>{recent?.changeSummary || recent?.summary || `当前互动趋势：${diagnosis?.relationship?.trend}`}</p>
        <small>{recent?.dateLabel || "根据已导入聊天统计"}{recent && !recent.changeSummary ? " · 最近分析摘要" : ""}</small>
        <button className={styles.link} onClick={() => onSection("trend")}>看前后对照与趋势 <ArrowRight size={15}/></button>
      </section>}

      {(common.length > 0 || meaningfulFit) && <section className={`${styles.card} ${styles.overviewBrief}`}>
        <h2><Link2 size={20}/>{common.length ? "与你有关的交集" : "和你的期待合不合"}</h2>
        {common.length ? <ul className={styles.overviewList}>{common.slice(0, 2).map((point, index) => <li key={index}><strong>{point.title}</strong><p>{point.meaning}</p></li>)}</ul> : <p>{fit?.fitSummary}</p>}
        <button className={styles.link} onClick={() => onSection("evidence")}>{common.length > 2 ? `查看全部 ${common.length} 个交集与依据` : "看交集与适配依据"} <ArrowRight size={15}/></button>
      </section>}

      {risks.length > 0 && <section className={`${styles.card} ${styles.overviewBrief} ${styles.overviewRisk}`}>
        <h2><ShieldAlert size={20}/>先留意这件事</h2>
        <strong>{risks[0].title}</strong><p>{risks[0].reading}</p><p className={styles.muted}>{risks[0].action}</p>
        <button className={styles.link} onClick={() => onSection("evidence")}>查看{risks.length > 1 ? ` ${risks.length} 条` : ""}线索与原话 <ArrowRight size={15}/></button>
      </section>}

      {currentSignal?.messageCount != null && currentSignal.messageCount > 0 && <section className={`${styles.card} ${styles.overviewBrief}`}>
        <h2><MessageCircle size={20}/>这次聊了多少</h2>
        <p><strong>{currentSignal.messageCount} 条</strong>消息{currentSignal.eventDayCount ? `，分布在 ${currentSignal.eventDayCount} 个有明确日期的聊天日。` : "，以这次已分析的材料为准。"}</p>
        <small>这是已分析片段的数量，全部导入记录可在材料库查看。</small>
        <button className={styles.link} onClick={() => onSection("trend")}>查看日期与互动依据 <ArrowRight size={15}/></button>
      </section>}
    </div>
  </div>;
}
