"use client";
import { useState } from "react";
import { Image, MessageCircle } from "lucide-react";
import { ReportDetails } from "./ReportDetails";
import { CaptureEvidence } from "./CaptureEvidence";
import type { Json } from "./client";
import styles from "./ReportCoverage.module.css";

const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
export function ReportCoverage({ report }: { report: Json }) {
  const [page,setPage]=useState(0);
  const rows:Json[]=Array.isArray(report.sourceCoverage)?report.sourceCoverage:[];
  if(!rows.length)return null;
  const images:Json[]=Array.isArray(report.mediaEvidence)?report.mediaEvidence:[];
  const chat=rows.filter(row=>row.kind==="chat").reduce((sum,row)=>sum+count(row.total),0),moments=rows.filter(row=>row.kind==="moments").reduce((sum,row)=>sum+count(row.total),0);
  const expected=rows.reduce((sum,row)=>sum+count(row.imagesExpected),0),analyzed=rows.reduce((sum,row)=>sum+count(row.imagesAnalyzed),0);
  const description=[chat?`${chat} 条聊天`:"",moments?`${moments} 条朋友圈`:"",expected?`已看 ${analyzed} / ${expected} 张图片`:""].filter(Boolean).join(" · ");
  const pages=Math.max(1,Math.ceil(images.length/6)),currentPage=Math.min(page,pages-1);
  return <div data-report-coverage><ReportDetails title="这份报告看了哪些材料" description={description||"查看材料数量与缺失部分"}>
    <div className={styles.coverage}>{rows.map((row,index)=><article key={row.libraryId||index} data-source-coverage><h3>{row.kind==="moments"?<Image size={18}/>:<MessageCircle size={18}/>}<span>{row.kind==="moments"?"朋友圈":"聊天记录"}</span><small>{row.status==="complete"?"已完成":"部分材料待补齐"}</small></h3><dl><div><dt>已导入</dt><dd>{count(row.total)} 条</dd></div><div><dt>已解读文字</dt><dd>{count(row.textRead)} 条</dd></div>{count(row.imagesExpected)>0&&<div><dt>已看图片</dt><dd>{count(row.imagesAnalyzed)} / {count(row.imagesExpected)} 张</dd></div>}</dl>{count(row.imagesMissing)>0&&<p>{count(row.imagesMissing)} 张图片尚未同步可读内容。</p>}{count(row.imagesFailed)>0&&<p>{count(row.imagesFailed)} 张图片暂未完成识别。</p>}{count(row.imagesExpected)>0&&<small>图片判断基于已同步的预览或采集画面。</small>}</article>)}</div>
    {images.length>0&&<section className={styles.visuals}><h3>图片可见内容</h3>{images.slice(currentPage*6,(currentPage+1)*6).map((item,index)=><article key={item.mediaId||index} data-visual-evidence><small>{item.kind==="moments"?"朋友圈图片":"聊天图片"}{item.at?` · ${item.at}`:" · 日期待确认"}</small><p>{item.observation}</p><CaptureEvidence quote={item.observation} sourceIds={item.sourceId?[item.sourceId]:undefined} libraryId={item.libraryId} sourceKind={item.kind} label="查看图片来源"/></article>)}{pages>1&&<nav><button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage+1} / {pages}</span><button disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}</section>}
  </ReportDetails></div>;
}
