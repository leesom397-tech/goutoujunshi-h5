"use client";
import { useState } from "react";
import { ChartNoAxesCombined, FileText, Images, Pin } from "lucide-react";
import type { Json } from "./client";
import { CaptureEvidence } from "./CaptureEvidence";
import { SocialContentPanel } from "./SocialReadingPanels";
import styles from "./HistoryMomentsStatistics.module.css";

const count=(value:unknown):number|null=>Number.isSafeInteger(value)&&Number(value)>=0?Number(value):null;
const rows=(value:unknown):Json[]=>Array.isArray(value)?value.filter(item=>item&&typeof item==="object"):[];
export function savedMomentsStatistics(report:Json):Json|null{
  const value=report.momentsStatistics;
  return value?.basis==="capture-records"&&count(value.total)!==null?value:null;
}
export function HistoryMomentsStatistics({report,compact=false}:{report:Json;compact?:boolean}){
  const stats=savedMomentsStatistics(report),[selected,setSelected]=useState("");
  if(!stats){
    const legacy=report.moments?.statistics?report.moments:report.captureKind==="moments"&&report.statistics?report:null;
    if(legacy&&!compact)return <section data-legacy-moments-statistics><p className={styles.scope}>保留原报告已统计的截图范围；这些分类不代表全部历史动态。</p><SocialContentPanel report={{...report,moments:legacy}}/></section>;
    return compact?null:<p className={styles.scope} data-moments-statistics-unavailable>这份旧报告没有保存可核验的动态统计；下方仍保留已有解读和图片依据。</p>;
  }
  const months=rows(stats.months).filter(row=>/^\d{4}-\d{2}$/.test(row.month)&&count(row.count)!==null&&row.count>0);
  const max=Math.max(1,...months.map(row=>row.count)),active=months.find(row=>row.month===selected);
  const shown=compact?months.slice(-12):months;
  return <section className={styles.statistics} data-moments-statistics data-compact={compact||undefined}>
    <header><ChartNoAxesCombined size={20}/><h3>这批动态的真实分布</h3>{stats.startDate&&stats.endDate&&<span>{stats.startDate} — {stats.endDate}</span>}</header>
    <dl className={styles.metrics}>
      {[[FileText,"有可读配文",count(stats.withText),` / ${stats.total} 条`],[Images,"已同步预览",count(stats.previewsAvailable)," 幅"],[Pin,"明确置顶",count(stats.pinnedCount)," 条"]].map(([Icon,label,value,suffix])=>{const Symbol=Icon as typeof FileText;return <div key={String(label)}><dt><Symbol size={17}/>{String(label)}</dt><dd>{value===null?"未记录":String(value)}<small>{value!==null?String(suffix):""}</small></dd></div>;})}
    </dl>
    {shown.length?<div className={styles.chart} data-moments-month-chart>
      <h4>按发布月份 · {stats.dated} 条日期明确的动态</h4>
      <div className={styles.bars} role="group" aria-label="已保存动态按月分布">{shown.map(row=><button type="button" key={row.month} aria-pressed={selected===row.month} onClick={()=>setSelected(selected===row.month?"":row.month)} aria-label={`${row.month}，${row.count} 条动态`}><span>{row.month}</span><i aria-hidden="true"><b style={{width:`${row.count/max*100}%`}}/></i><strong>{row.count}<small> 条</small></strong></button>)}</div>
      {compact&&months.length>shown.length&&<p className={styles.scope}>图示最近 {shown.length} 个有记录的月份，完整分布在朋友圈专段。</p>}
      {active&&<div className={styles.selection} data-moments-month-evidence><strong>{active.month} · {active.count} 条动态</strong>{rows(active.sourceRefs).map((ref,index)=><CaptureEvidence key={`${ref.libraryId}:${ref.sourceId}:${index}`} sourceIds={[ref.sourceId]} libraryId={ref.libraryId} sourceKind="moments" label={`核对本月原文 ${index+1}`}/>)}</div>}
    </div>:<p className={styles.scope}>动态没有明确的完整年月日，暂不绘制发布趋势。</p>}
    <p className={styles.scope}>{count(stats.undated)!==null&&stats.undated>0?`${stats.undated} 条日期不完整，未计入月份。`:""}预览画面不等于原照片数量；未显示的月份不代表没有发布。</p>
    {!compact&&<details className={styles.method}><summary>统计范围与口径</summary><p>{stats.scope}</p><p>去重后 {stats.total} 条动态{count(stats.duplicates)!==null?`，合并 ${stats.duplicates} 条重复来源`:""}{count(stats.excludedProfileMaterials)!==null?`，另有 ${stats.excludedProfileMaterials} 项封面／签名不计入`:""}。</p></details>}
  </section>;
}
