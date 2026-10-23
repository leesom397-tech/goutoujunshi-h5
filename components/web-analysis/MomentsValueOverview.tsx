"use client";
import { Quote, ArrowUpRight, ScanEye, Layers3 } from "lucide-react";
import { reportMomentsValue, type MomentsValueItem } from "@/lib/report-moments-value";
import { reportEvidenceDate } from "@/lib/report-reading";
import type { Json } from "./client";
import { CaptureEvidence } from "./CaptureEvidence";
import { ReportExcerpt } from "./ReportExcerpt";
import { SocialNextAdvice } from "./SocialReadingPanels";
import { ReportEvidenceImage } from "./ReportEvidenceImage";
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
  const concreteContrast = [...item.alternative.matchAll(/[“「]([^”」]{6,})[”」]/g)].some(match => item.evidence.some(source => String(source.quote).includes(match[1])));
  const visual = item.observation && item.evidence.find(source => source.basis === "visual" && source.libraryId && source.sourceId);
  return <article className={compact ? styles.saved : styles.card} data-moments-finding={!compact || undefined} data-moments-saved-reading={compact || undefined} data-interpretation-basis={item.basis}>
    <header><span>{item.category || (item.label !== "已保存的推测" ? item.label : "相处线索")}</span><small>{item.sourceCount ? `${item.sourceCount} 处图像来源` : `${item.evidence.length} 条依据`}</small></header>
    {!compact && visual && <ReportEvidenceImage libraryId={visual.libraryId} sourceId={visual.sourceId} label="查看这条图片线索的原图"/>}
    {item.observation && <div className={styles.observation} data-reading-kind="fact"><small><ScanEye size={15}/>看得见的细节</small><ReportExcerpt value={item.observation} limit={170}/></div>}
    {item.reading && <div className={styles.reading} data-reading-kind="inference">{item.observation && <small>结合材料的判断</small>}<ReportExcerpt value={item.reading} limit={190}/></div>}
    {item.nextStep && <div className={styles.nextStep}><ArrowUpRight size={18}/><div><small>你可以这样接上</small><ReportExcerpt value={item.nextStep} limit={150}/></div></div>}
    {concreteContrast && <p className={styles.alternative}>结合这条原文看：{item.alternative}</p>}
    <details className={styles.savedEvidence}><summary><Quote size={16}/>查看对应原文与图片</summary><ValueEvidence items={item.evidence} reading={item.reading} compare={item.label === "图文对照" || item.label === "聊天对照"}/></details>
  </article>;
}

export function MomentsValueOverview({ report, part = "all" }: { report: Json; part?: "all" | "lead" | "rest" }) {
  const value = reportMomentsValue(report);
  const limits = [...value.primary, ...value.other].filter(item => item.alternative).filter((item, index, all) => all.findIndex(other => other.alternative === item.alternative) === index);
  const primary = part === "rest" ? [] : value.featured;
  const other = value.remaining;
  if (!value.featured.length && !value.crossSource && !value.legacySource) return null;
  if (part === "lead" && !primary.length) return null;
  return <div className={styles.root} data-moments-value data-moments-value-part={part}>
    {primary.length > 0 && <section aria-label="生活线索与话题"><div className={styles.sectionHeading}><div><span>从照片细节，到怎么相处</span><h3>值得你关注的 {primary.length} 个线索</h3></div><ScanEye size={23}/></div><div className={styles.grid}>{primary.map(item => <ValueCard key={item.id} item={item}/>)}</div></section>}
    {part !== "lead" && <>
    {value.crossSource && <section className={styles.cross} data-cross-source-reading><h3>{value.crossSource.label}</h3><ReportExcerpt value={value.crossSource.reading}/><ValueEvidence items={value.crossSource.evidence} reading={value.crossSource.reading} compare/></section>}
    {other.length > 0 && <details className={styles.complete} data-moments-complete-readings><summary><Layers3 size={18}/>展开另外 {other.length} 条人物与图片线索</summary><div className={styles.savedGrid}>{other.map(item => <ValueCard key={item.id} item={item} compact/>)}</div></details>}
    {value.unknowns.length > 0 && <details className={styles.unknowns}><summary>还需要进一步了解的 {value.unknowns.length} 件事</summary><ul>{value.unknowns.map(item => <li key={item}>{item}</li>)}</ul></details>}
    {limits.length > 0 && <details className={styles.limits} data-moments-reading-limits><summary>原判断的限定说明</summary>{limits.map(item => <p key={item.id}><strong>{item.label}</strong>{item.alternative}</p>)}</details>}
    {value.legacySource && <SocialNextAdvice report={{ ...report, moments: value.legacySource }}/>}</>}</div>;
}
