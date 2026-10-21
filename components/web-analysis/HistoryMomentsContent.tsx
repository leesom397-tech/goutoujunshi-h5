"use client";
import { useState } from "react";
import type { Json } from "./client";
import { momentsContent } from "@/lib/moments-content";
import { CaptureEvidence } from "./CaptureEvidence";
import styles from "./HistoryMomentsStatistics.module.css";

export function HistoryMomentsContent({report,compact=false}:{report:Json;compact?:boolean}) {
  const content=momentsContent(report),[selected,setSelected]=useState(""),[limit,setLimit]=useState(8);
  if(!content.evidence.length)return null;
  const shown=content.evidence.filter((row:Json)=>!selected||row.categories.includes(selected));
  return <section className={styles.statistics} data-moments-content>
    <header><h3>自拍、工作与生活主题</h3></header>
    <dl className={styles.metrics}>
      <div><dt>可确认的自拍画面</dt><dd>{content.selfieMinimum?`至少 ${content.selfieMinimum}`:"未确认"}<small> 处</small></dd></div>
      <div><dt>含自拍线索的动态</dt><dd>{content.selfiePosts||"未确认"}<small> 条</small></dd></div>
      <div><dt>已保存图片解读</dt><dd>{content.posts}<small> 条动态</small></dd></div>
    </dl>
    <p className={styles.scope}>自拍数量是可见画面的下限，同一动态的重复画面不累加；不等于本人自拍总数。未展开的照片和无法确认的画面不计数。</p>
    <div className={`${styles.bars} ${styles.themes}`} aria-label="朋友圈内容主题">{content.groups.map((row:Json)=><button type="button" key={row.label} aria-pressed={selected===row.label} onClick={()=>{setSelected(selected===row.label?"":row.label);setLimit(8);}}><span>{row.label}</span><i aria-hidden="true"><b style={{width:`${row.percent}%`}}/></i><strong>{row.count} 条 · {row.percent}%</strong></button>)}</div>
    <p className={styles.scope}>{content.scope}</p>
    {!compact&&<>
      <div className={styles.clues}>{content.hypotheses.map((row:Json)=><article key={row.title}><h4>{row.title}</h4><small>{row.support}</small><p>{row.reading}</p><p><strong>另一种解释：</strong>{row.alternative}</p><CaptureEvidence sourceIds={row.evidence.map((e:Json)=>e.sourceId)} libraryId={row.evidence[0]?.libraryId} sourceKind="moments" label="查看相关动态"/></article>)}</div>
      <h4>{selected?`${selected} · `:""}逐图线索与原文</h4>
      <div className={styles.clues}>{shown.slice(0,limit).map((row:Json)=><article key={`${row.libraryId}:${row.mediaId}`}><strong>{row.categories.join(" · ")||"主题待确认"}</strong><p>{row.observation}</p><CaptureEvidence sourceIds={[row.sourceId]} libraryId={row.libraryId} sourceKind="moments" label="查看这条朋友圈"/></article>)}</div>
      {shown.length>limit&&<button type="button" onClick={()=>setLimit(limit+8)}>继续看图片线索（还有 {shown.length-limit} 条）</button>}
    </>}
  </section>;
}
