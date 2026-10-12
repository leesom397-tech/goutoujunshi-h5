"use client";

import { useState } from "react";
import { Sparkles, MessageCircle, Layers3 } from "lucide-react";
import type { MomentsReport, Reading } from "@/app/archive/types";
import styles from "@/app/archive/archive.module.css";

export function CommunicationReading({ report, hideApproach = false }: { report: Reading; hideApproach?: boolean }) {
  return <div className={styles.insights}><h2><Sparkles size={20} />人物相处评价</h2><small>基于已提供材料的推测，结合新表现继续核对。</small>{report.summary && <p>{report.summary}</p>}{(report.hypotheses || []).map((finding, index) => <article key={index}><h3>{finding.title}</h3><p>{finding.possibility}</p>{finding.verify && <p>{finding.verify}</p>}<details><summary>依据与其他解释</summary><small>依据 · {finding.evidence}</small><p>另一种可能 · {finding.alternative}</p></details></article>)}{!hideApproach && <Approach value={report.approach} />}</div>;
}

function Approach({ value }: { value: Reading["approach"] }) {
  if (!value) return null;
  return <section><h3><MessageCircle size={17} />怎么相处，怎么聊</h3><dl className={styles.dataGrid}>{([["attitude", "态度"], ["emotion", "回应"], ["pace", "节奏"], ["avoid", "少做"]] as const).map(([key, label]) => value[key] ? <div key={key}><dt>{label}</dt><dd>{value[key]}</dd></div> : null)}</dl><small>依据 · {value.evidence}</small>{value.adjustWhen && <p>何时换方式 · {value.adjustWhen}</p>}</section>;
}

export function MomentsReportView({ report, hideFindings = false, expandedStats = false, chartsFirst = false }: { report: MomentsReport; hideFindings?: boolean; expandedStats?: boolean; chartsFirst?: boolean }) {
  const [copied, setCopied] = useState("");
  const stats = report.statistics;
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setCopied(text); } catch { setCopied("无法自动复制，请长按选中文字。"); } }
  const statisticsPanel = stats && <details open={chartsFirst || expandedStats ? true : undefined}><summary>内容构成与文案统计 · {stats.total} 条动态</summary>{([{ title: "内容构成", rows: stats.visibleContent || [] }, { title: "文案表达", rows: stats.visibleCopy || [] }]).map(group => group.rows.length ? <section key={group.title}><h3>{group.title}</h3><div className={styles.bars}>{group.rows.map(row => <div key={row.label}><div className={styles.barHead}><span>{row.label}</span><span>{row.count} / {row.total} 条 · {row.percent}%</span></div><div className={styles.track}><span style={{ width: `${Math.max(0, Math.min(100, row.percent))}%` }} /></div></div>)}</div></section> : null)}<small>已识别去重 {stats.total} 条，其中 {stats.classified} 条可分类，{stats.unclassified} 条未分类。</small><small>{stats.scope}</small><small>文案表达：{stats.copyTotal} 条可分类文案；一条文案可有多种表达，纯照片或文字不清不计入。</small>{stats.selfie && (stats.selfie.known > 0 ? <p>自拍：{stats.selfie.count} / {stats.selfie.known} 条可判断动态（{stats.selfie.percent}%），另有 {stats.selfie.unknown} 条无法判断。</p> : <p>自拍：尚无可判断的动态，{stats.selfie.unknown} 条无法判断。</p>)}</details>;
  return <div className={styles.insights}>{chartsFirst && statisticsPanel}<span className={styles.eyebrow}><Layers3 size={14} />这批朋友圈 · 人物总评</span><h2>{report.summary}</h2>{!hideFindings && (report.hypotheses || []).map((finding, index) => <article key={index}><h3>{finding.title}</h3><p>{finding.possibility}</p>{finding.verify && <p>{finding.verify}</p>}<details><summary>查看推测依据</summary><small>{finding.evidence}</small><p>另一种可能 · {finding.alternative}</p></details></article>)}<Approach value={report.approach} />
    {!!report.starters?.length && <section><h3>挑一句顺口的，接着聊</h3>{report.starters.map((item, index) => <article key={index}><blockquote>{item.message}</blockquote><small>{item.reason || item.topic}</small><details><summary>对应动态</summary><p>{item.evidence}</p></details><button type="button" className={styles.link} onClick={() => void copy(item.message)}>{copied === item.message ? "已复制" : "复制这句话"}</button></article>)}{copied.startsWith("无法") && <small role="status">{copied}</small>}</section>}
    {!!report.commonPoints?.length && <section><h3>你们的交集</h3>{report.commonPoints.map((item, index) => <article key={index}><strong>{item.title}</strong><p>{item.meaning}</p></article>)}</section>}
    {!chartsFirst && statisticsPanel}
    {!!report.posts?.length && <details><summary>动态时间线 · {report.posts.length} 条</summary><small>日期为截图内标注；未明确的时间保留原文。</small><div className={styles.timeline}>{report.posts.map((post, index) => <article key={index}><small>{post.date}</small><p>{post.content}</p><small>{post.evidence}</small></article>)}</div></details>}
    <details><summary>完整依据、行为与照片线索</summary>
      {(report.behaviorClues || []).map((item, index) => <article key={`behavior-${index}`}><h3>{item.dimension} · {item.sourceType}</h3><p>{item.reading}</p><blockquote>{item.quote}</blockquote><small>{item.evidence}</small><p>另一种可能 · {item.alternative}</p></article>)}
      {(stats?.summaries || []).map((item, index) => <article key={`summary-${index}`}><h3>{item.title}</h3><small>{item.support}</small><p>{item.reading}</p><small>{item.evidence}</small><p>另一种可能 · {item.alternative}</p></article>)}
      {(stats?.milestones || []).map((item, index) => <article key={`milestone-${index}`}><h3>{item.title} · {item.date}</h3><p>{item.quote}</p><small>{item.evidence} · 日期为动态发布日期</small></article>)}
      {report.visibility && <article><h3>可见范围 · {report.visibility.label}</h3><p>{report.visibility.reading}</p><small>{report.visibility.evidence}</small>{report.visibility.possibilities?.map((line, index) => <p key={index}>{line}</p>)}</article>}
      {(report.themes || []).map((item, index) => <article key={`theme-${index}`}><h3>{item.title}</h3><p>{item.meaning}</p><small>{item.evidence}</small></article>)}
      {(report.photoClues || []).map((item, index) => <article key={`photo-${index}`}><h3>{item.item}</h3><p>{item.style}</p><small>{item.evidence}</small></article>)}
      {report.fitSummary && <p>{report.fitSummary}</p>}
    </details>
  </div>;
}
