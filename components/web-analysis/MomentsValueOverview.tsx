"use client";
import { Quote, ArrowUpRight } from "lucide-react";
import { reportMomentsValue, type MomentsValueItem } from "@/lib/report-moments-value";
import { reportEvidenceDate } from "@/lib/report-reading";
import type { Json } from "./client";
import { CaptureEvidence } from "./CaptureEvidence";
import { ReportExcerpt } from "./ReportExcerpt";
import { SocialNextAdvice } from "./SocialReadingPanels";
import styles from "./MomentsValueOverview.module.css";

function ValueEvidence({ items, reading = "", compare = false }: { items: Json[]; reading?: string; compare?: boolean }) {
  const fragments = [...reading.matchAll(/[“「]([^”」]{2,})[”」]/g)].map(match => match[1]);
  const score = (source: Json) => fragments.reduce((sum, part) => sum + (String(source.quote).includes(part) ? part.length : 0), 0);
  const ordered = [...items].sort((a, b) => score(b) - score(a));
  const primary = ordered.slice(0, 1);
  if (compare && primary.length) {
    const counterpart = ordered.find(item => primary[0].sourceKind === "chat" ? item.sourceKind === "moments" : item.sourceKind === "chat") || ordered.find(item => item.basis !== primary[0].basis);
    if (counterpart) primary.push(counterpart);
  }
  const remaining = ordered.filter(item => !primary.includes(item));
  const render = (item: Json, index: number) => <div className={styles.quote} key={`${item.sourceId}:${index}`} data-reading-kind="fact">
    <small>{item.sourceKind === "chat" ? "聊天原话" : item.basis === "visual" ? "已读画面" : "动态配文"}{item.at ? ` · ${reportEvidenceDate(item.at)}` : ""}</small>
    <ReportExcerpt value={item.quote} quote limit={150}/>
    <CaptureEvidence quote={item.quote} sourceIds={item.sourceId ? [item.sourceId] : undefined} libraryId={item.libraryId} sourceKind={item.sourceKind} label={item.basis === "visual" ? "回看这张图片" : "回看这条原文"}/>
  </div>;
  return <div className={styles.evidence}>{primary.map(render)}{remaining.length > 0 && <details><summary>另外 {remaining.length} 条对应依据</summary>{remaining.map(render)}</details>}</div>;
}

function ValueCard({ item, compact = false }: { item: MomentsValueItem; compact?: boolean }) {
  const old = item.basis !== "saved-interpretation";
  const concreteContrast = [...item.alternative.matchAll(/[“「]([^”」]{6,})[”」]/g)].some(match => item.evidence.some(source => String(source.quote).includes(match[1])));
  return <article className={compact ? styles.saved : styles.card} data-moments-finding={!compact || undefined} data-moments-saved-reading={compact || undefined} data-interpretation-basis={item.basis}>
    <header>{item.label !== "已保存的推测" && <span>{item.label}</span>}{old && <small>原报告推测</small>}</header>
    <div className={styles.reading} data-reading-kind="inference"><ReportExcerpt value={item.reading} limit={240}/></div>
    {!compact && <ValueEvidence items={item.evidence} reading={item.reading} compare={item.label === "图文对照" || item.label === "聊天对照"}/>}
    {item.nextStep && <div className={styles.nextStep}><ArrowUpRight size={18}/><div><small>这条线索可以怎么聊</small><ReportExcerpt value={item.nextStep} limit={220}/></div></div>}
    {concreteContrast && <p className={styles.alternative}>结合这条原文看：{item.alternative}</p>}
    {compact && <details className={styles.savedEvidence}><summary><Quote size={16}/>核对原文与图片</summary><ValueEvidence items={item.evidence} reading={item.reading}/></details>}
  </article>;
}

export function MomentsValueOverview({ report, part = "all" }: { report: Json; part?: "all" | "lead" | "rest" }) {
  const value = reportMomentsValue(report);
  const limits = [...value.primary, ...value.other].filter(item => item.alternative).filter((item, index, all) => all.findIndex(other => other.alternative === item.alternative) === index);
  const lead = value.primary[0] || value.other[0];
  const primary = part === "lead" ? lead ? [lead] : [] : part === "rest" ? value.primary.slice(1) : value.primary;
  const other = part === "rest" && !value.primary.length ? value.other.slice(1) : value.other;
  if (!value.primary.length && !value.other.length && !value.crossSource && !value.legacySource) return null;
  if (part === "lead" && !lead) return null;
  return <div className={styles.root} data-moments-value data-moments-value-part={part}>
    {primary.length > 0 && <section aria-label="生活线索与话题"><h3>{part === "rest" ? "更多生活与相处线索" : "先看这个具体线索"}</h3><div className={styles.grid}>{primary.map(item => <ValueCard key={item.id} item={item}/>)}</div></section>}
    {part !== "lead" && <>
    {value.crossSource && <section className={styles.cross} data-cross-source-reading><h3>{value.crossSource.label}</h3><ReportExcerpt value={value.crossSource.reading}/><ValueEvidence items={value.crossSource.evidence} reading={value.crossSource.reading} compare/></section>}
    {value.unknowns.length > 0 && <section className={styles.unknowns}><h3>现在还不知道的事</h3><ul>{value.unknowns.map(item => <li key={item}>{item}</li>)}</ul></section>}
    {other.length > 0 && <section className={styles.complete} data-moments-complete-readings><header><h3>完整人物与图片线索</h3><span>{other.length} 条已保存解读</span></header><p className={styles.scope}>保留原报告的其他判断及其来源。</p><div className={styles.savedGrid}>{other.map(item => <ValueCard key={item.id} item={item} compact/>)}</div></section>}
    {limits.length > 0 && <details className={styles.limits} data-moments-reading-limits><summary>原判断的限定说明</summary>{limits.map(item => <p key={item.id}><strong>{item.label}</strong>{item.alternative}</p>)}</details>}
    {value.legacySource && <SocialNextAdvice report={{ ...report, moments: value.legacySource }}/>}</>}</div>;
}
