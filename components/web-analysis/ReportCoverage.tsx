"use client";
import {captureMaterialLabel,captureProfileMaterial} from "@/lib/capture-material";
import { useState } from "react";
import { Image, MessageCircle } from "lucide-react";
import { ReportDetails } from "./ReportDetails";
import { CaptureEvidence } from "./CaptureEvidence";
import type { Json } from "./client";
import styles from "./ReportCoverage.module.css";

const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
/** Keep the scope visible without implying that an imported image has been read. */
export function reportSourceSummary(report: Json): string {
  const full = report.analysisScope === "fullHistory" || report.captureFormat === "full-history";
  if (!full) {
    const lines: Json[] = Array.isArray(report.lines) ? report.lines : [];
    const images = new Set(lines.map(row => row.screenshotNumber).filter(Number.isSafeInteger));
    return ["本次上传", images.size ? `${images.size} 张截图` : "", `${lines.length} 条可读聊天`].filter(Boolean).join(" · ");
  }
  const rows: Json[] = Array.isArray(report.sourceCoverage) ? report.sourceCoverage : [];
  const chatRows = rows.filter(row => row.kind === "chat"), momentRows = rows.filter(row => row.kind === "moments");
  const chat = chatRows.length ? chatRows.reduce((sum, row) => sum + count(row.total), 0) : count(report.chatActivity?.messages);
  const moments = momentRows.reduce((sum, row) => sum + count(row.momentCount ?? row.total), 0);
  const expected = rows.reduce((sum, row) => sum + count(row.imagesExpected), 0);
  const analyzed = rows.reduce((sum, row) => sum + count(row.imagesAnalyzed), 0);
  const coverage = report.semanticHistory?.coverage || report.relationshipDiagnosis?.semanticHistory?.coverage;
  const voice = report.relationshipDiagnosis?.coverage;
  return [
    "本报告关联的全部资料",
    chatRows.length || chat ? `${chat.toLocaleString("zh-CN")} 条聊天` : "",
    momentRows.length ? `${moments.toLocaleString("zh-CN")} 条朋友圈` : "",
    expected ? `图片已读 ${analyzed} / ${expected}` : "",
    count(voice?.voiceCount) ? `语音已转写 ${count(voice.voiceTranscribed)} / ${count(voice.voiceCount)}` : "",
    count(coverage?.receivedText) > count(coverage?.analyzedText) ? `文字已解读 ${count(coverage.analyzedText)} / ${count(coverage.receivedText)}` : "",
  ].filter(Boolean).join(" · ");
}
export function ReportCoverage({ report }: { report: Json }) {
  const [page,setPage]=useState(0);
  const rows:Json[]=Array.isArray(report.sourceCoverage)?report.sourceCoverage:[];
  if(!rows.length)return null;
  const images:Json[]=Array.isArray(report.mediaEvidence)?report.mediaEvidence:[];
  const chat=rows.filter(row=>row.kind==="chat").reduce((sum,row)=>sum+count(row.total),0),moments=rows.filter(row=>row.kind==="moments").reduce((sum,row)=>sum+count(row.momentCount??row.total),0),profiles=rows.reduce((sum,row)=>sum+count(row.profileMaterialCount),0);
  const expected=rows.reduce((sum,row)=>sum+count(row.imagesExpected),0),analyzed=rows.reduce((sum,row)=>sum+count(row.imagesAnalyzed),0);
  const description=[chat?`${chat} 条聊天`:"",moments?`${moments} 条朋友圈`:"",profiles?`${profiles} 项封面／签名`:"",expected?`已看 ${analyzed} / ${expected} 张图片`:""].filter(Boolean).join(" · ");
  const pages=Math.max(1,Math.ceil(images.length/6)),currentPage=Math.min(page,pages-1);
  return <div data-report-coverage><ReportDetails title="这份报告看了哪些材料" description={description||"查看材料数量与缺失部分"}>
    <div className={styles.coverage}>{rows.map((row,index)=><article key={row.libraryId||index} data-source-coverage><h3>{row.kind==="moments"?<Image size={18}/>:<MessageCircle size={18}/>}<span>{row.kind==="moments"?"朋友圈":"聊天记录"}</span><small>{row.status==="complete"?"已完成":"部分材料待补齐"}</small></h3><dl><div><dt>{row.kind==="moments"?"已导入动态":"已导入"}</dt><dd>{count(row.kind==="moments"?row.momentCount??row.total:row.total)} 条</dd></div>{count(row.profileMaterialCount)>0&&<div><dt>封面／签名</dt><dd>{count(row.profileMaterialCount)} 项</dd></div>}{count(row.pinnedCount)>0&&<div><dt>其中置顶动态</dt><dd>{count(row.pinnedCount)} 条</dd></div>}<div><dt>已解读文字</dt><dd>{count(row.textRead)} 条</dd></div>{count(row.imagesExpected)>0&&<div><dt>已看图片</dt><dd>{count(row.imagesAnalyzed)} / {count(row.imagesExpected)} 张</dd></div>}</dl>{count(row.imagesMissing)>0&&<p>{count(row.imagesMissing)} 张图片尚未同步可读内容。</p>}{count(row.imagesFailed)>0&&<p>{count(row.imagesFailed)} 张图片暂未完成识别。</p>}{count(row.imagesExpected)>0&&<small>图片判断基于已同步的预览或采集画面。</small>}</article>)}</div>
    {images.length>0&&<section className={styles.visuals}><h3>图片可见内容</h3>{images.slice(currentPage*6,(currentPage+1)*6).map((item,index)=><article key={item.mediaId||index} data-visual-evidence><small>{item.kind==="moments"?captureMaterialLabel(item):"聊天图片"}{captureProfileMaterial(item)?" · 采集时可见":item.at?` · ${item.at}`:" · 日期待确认"}</small><p>{item.observation}</p><CaptureEvidence quote={item.observation} sourceIds={item.sourceId?[item.sourceId]:undefined} libraryId={item.libraryId} sourceKind={item.kind} label="查看图片来源"/></article>)}{pages>1&&<nav><button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage+1} / {pages}</span><button disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}</section>}
  </ReportDetails></div>;
}
