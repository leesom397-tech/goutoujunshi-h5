"use client";
import { useReportSessionState } from './ReportSessionState';
import { Camera, ChartNoAxesCombined } from "lucide-react";
import type { Json } from "./client";
import { momentsContent } from "@/lib/moments-content";
import { CaptureEvidence } from "./CaptureEvidence";
import styles from "./HistoryMomentsStatistics.module.css";

export function HistoryMomentsContent({report,compact=false}:{report:Json;compact?:boolean}) {
  const content=momentsContent(report),[selected,setSelected]=useReportSessionState('moments-category:'+compact,""),[limit,setLimit]=useReportSessionState('moments-limit:'+compact,6);
  if(!content.evidence.length)return null;
  const shown=content.evidence.filter((row:Json)=>!selected||row.categories.includes(selected));
  return <section className={styles.statistics} data-moments-content>
    <header><ChartNoAxesCombined size={19}/><h3>内容占比</h3><span>{content.posts} 条已有解读</span></header>
    <dl className={styles.metrics}>
      <div><dt><Camera size={17}/>可确认自拍</dt><dd>{content.selfieMinimum?`≥ ${content.selfieMinimum}`:"未确认"}<small>{content.selfieMinimum?" 处画面":""}</small></dd></div>
      <div><dt>含自拍的动态</dt><dd>{content.selfiePosts||"未确认"}<small>{content.selfiePosts?` 条 · ${Math.round(content.selfiePosts/content.posts*100)}%`:""}</small></dd></div>
      <div><dt>待分类</dt><dd>{content.unclassified}<small> 条动态</small></dd></div>
    </dl>
    <div className={`${styles.bars} ${styles.themes}`} aria-label="朋友圈内容主题">{content.groups.map((row:Json)=><button type="button" key={row.label} aria-pressed={selected===row.label} aria-label={`${row.label}，${row.count} 条，占 ${row.percent}%，查看依据`} onClick={()=>{setSelected(selected===row.label?"":row.label);setLimit(6);}}><span>{row.label}</span><i aria-hidden="true"><b style={{width:`${row.percent}%`}}/></i><strong>{row.percent}<small>% · {row.count} 条</small></strong></button>)}</div>
    <p className={styles.scope}>占比以 {content.posts} 条已有解读的动态为分母；一条可有多个主题，合计可能超过 100%。</p>
    {!compact&&content.overlaps.length>0&&<p className={styles.overlaps} data-moments-overlaps><strong>经常一起出现</strong>{content.overlaps.map((row:Json)=><span key={row.labels.join(":")}>{row.labels.join(" + ")} <b>{row.count} 条</b></span>)}</p>}
      {selected&&<div className={styles.categoryEvidence} data-moments-category-evidence><header><strong>{selected} · 分类依据</strong><button type="button" aria-label="收起分类依据" onClick={()=>setSelected("")}>收起</button></header><div className={styles.clues}>{shown.slice(0,limit).map((row:Json)=><article key={`${row.libraryId}:${row.mediaId}`}><p>{row.observation}</p><CaptureEvidence sourceIds={[row.sourceId]} libraryId={row.libraryId} sourceKind="moments" label="核对这条动态"/></article>)}</div>{shown.length>limit&&<button className={styles.moreButton} type="button" onClick={()=>setLimit(limit+6)}>再看 {Math.min(6,shown.length-limit)} 条依据</button>}</div>}
      {!compact&&<details className={styles.method}><summary>自拍与分类怎样计算</summary><p>{content.scope}</p><p>自拍是可确认画面的下限；同一动态重复画面不累加。未读照片不计数，也不能据此确定画中人就是本人。</p></details>}
  </section>;
}
