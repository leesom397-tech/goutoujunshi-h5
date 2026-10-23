"use client";

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, MessageCircle, MessageCircleQuestion } from 'lucide-react';
import { computeReplyAttention, REPLY_ATTENTION_RULES_VERSION, type ReplyAttentionEvidence, type ReplyAttentionRow, type ReplyAttentionSummary } from '@/lib/reply-attention';
import { getCaptureLibrary, readReportSources } from '@/lib/desktop-capture-vault';
import { CaptureEvidence } from './CaptureEvidence';
import styles from './ReplyAttentionOverview.module.css';

type Report = Record<string, any>;
function savedSummary(input: unknown): ReplyAttentionSummary | null {
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const report=input as Report;
  const value=report.replyAttention||report.semanticHistory?.replyAttention;
  return value?.version===1&&value.rulesVersion===REPLY_ATTENTION_RULES_VERSION&&Array.isArray(value.questions)&&Array.isArray(value.initiations)&&typeof value.headline==='string'?value:null;
}
function availableRows(report: Report): ReplyAttentionRow[] | null {
  const full=report.analysisScope==='fullHistory'||report.analysisScope==='uploadedHistory'||report.captureFormat==='full-history';
  // The legacy recent-sentence sample was filtered by successful annotations.
  // It can omit replies, so only explicitly contiguous windows are eligible.
  const recent=report.recentSentenceAnalysis||report.semanticHistory?.recentSentenceAnalysis;
  if(recent?.contiguous===true&&Array.isArray(recent.lines))return recent.lines;
  if(!full&&!report.sentenceSampleNote&&!report.decision?.partial&&!report.unreadMediaCount&&Array.isArray(report.lines))return report.lines;
  return null;
}
const timeLabel=(at:string)=>{
  const time=Date.parse(at);
  return Number.isFinite(time)?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(time):at||'时间未识别';
};
function Quote({value}:{value:ReplyAttentionEvidence}) {
  return <blockquote className={styles.quote}><header><strong>{value.role==='self'?'我':'对方'}</strong><time>{timeLabel(value.at)}</time></header><p>{value.text||'这条消息没有可读文字'}</p><CaptureEvidence sourceIds={value.sourceId?[value.sourceId]:undefined} libraryId={value.libraryId} quote={value.text} label="核对原话"/></blockquote>;
}
const duration=(minutes:number)=>minutes>=1440?`${Math.floor(minutes/1440)} 天 ${Math.floor(minutes%1440/60)} 小时`:minutes>=60?`${Math.floor(minutes/60)} 小时 ${minutes%60} 分钟`:`${minutes} 分钟`;

/** Uses saved structured analysis, or re-reads existing local originals for old reports. No analysis fee or model request. */
export function ReplyAttentionOverview({report,ownerId}:{report:Report;ownerId?:string}) {
  const reportId=String(report.reportId||report.id||'');
  const supplied=useMemo(()=>savedSummary(report),[report]);
  const fallback=useMemo(()=>{const rows=availableRows(report);return rows?computeReplyAttention(rows,{scope:'recent-window'}):null;},[report]);
  const [local,setLocal]=useState<{key:string;summary:ReplyAttentionSummary;updated:boolean}|null>(null);
  const key=JSON.stringify([ownerId,reportId]);
  useEffect(()=>{
    let active=true;const controller=new AbortController();setLocal(null);
    if(supplied||!ownerId||!reportId||report.demo===true)return;
    void (async()=>{
      try {
        const link=await readReportSources(ownerId,reportId);
        const library=link?.kind==='chat'?await getCaptureLibrary(ownerId,link.libraryId):null;
        const expected=library?.cloud?.total;
        if(library?.records.length&&!(typeof expected==='number'&&library.records.length<expected)){
          const records=library.records.map((row,index)=>({...row,sequence:index}));
          const summary=computeReplyAttention(records,{scope:'full-history'});
          if(active)setLocal({key,summary,updated:true});
          return;
        }
      } catch { /* A new device can use the same owner's synchronized originals. */ }
      const response=await fetch(`/api/web/report/sentences?id=${encodeURIComponent(reportId)}&mode=attention`,{credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
      if(!response.ok)return;
      const value=await response.json(),summary=savedSummary(value);
      if(active&&summary)setLocal({key,summary,updated:true});
    })().catch(()=>{/* Existing report remains usable if this device has no originals. */});
    return()=>{active=false;controller.abort();};
  },[key,supplied,report.demo]);
  const refreshed=local?.key===key?local:null;
  const summary=supplied||refreshed?.summary||fallback;
  if(!summary||summary.status!=='ready')return null;
  const latest=summary.questions[0],run=summary.initiations[0];
  return <section className={styles.panel} data-reply-attention aria-label="最近的提问有没有被接住">
    <header className={styles.header}><span><MessageCircleQuestion size={18}/>最近的回应</span><small>{refreshed?.updated?'按当前已保存聊天更新':summary.scope==='full-history'?'从连续聊天核对':'仅核对当前片段'}</small></header>
    <h2>{summary.headline}</h2><p className={styles.reading}>{summary.reading}</p>
    {latest&&<article className={styles.latest} data-reply-status={latest.status}><Quote value={latest.question}/>{latest.responses[0]&&<><ArrowDownRight size={17} className={styles.arrow}/><Quote value={latest.responses[0]}/></>}
      {latest.elapsedMinutes!==null&&<p className={styles.time}>{latest.status==='cutoff'?`到材料截止相隔 ${duration(latest.elapsedMinutes)}；不是截至现在的等待时长。`:`下一次对方消息出现在 ${duration(latest.elapsedMinutes)} 后。`}</p>}
    </article>}
    {run&&<div className={styles.pattern}><MessageCircle size={19}/><div><strong>{run.attempts} 轮由你连续发起</strong><p>{run.reading}</p><small>{timeLabel(run.from)} — {timeLabel(run.to)}</small><CaptureEvidence sourceIds={run.evidence.map(row=>row.sourceId).filter(Boolean)} libraryId={run.evidence[0]?.libraryId} label="查看这几次发起"/></div></div>}
    {summary.comparison.status!=='insufficient'&&<p className={styles.comparison}>{summary.comparison.text}</p>}
    {(summary.questions.length>1||summary.limitations.length>0)&&<details className={styles.details}><summary>其他提问与核对范围</summary>
      {summary.questions.slice(1,5).map((q,index)=><article className={styles.question} key={`${q.question.sourceId}:${index}`} data-reply-status={q.status}><span>{q.label}</span><Quote value={q.question}/><p>{q.reading}</p>{q.responses[0]&&<Quote value={q.responses[0]}/>}</article>)}
      <p className={styles.scope}>已核对 {summary.messages} 条连续消息中的 {summary.questionCount} 次直接提问{summary.cutoffAt?`，材料截止 ${timeLabel(summary.cutoffAt)}`:''}。</p>
      {summary.limitations.map(value=><p key={value} className={styles.scope}>{value}</p>)}
      {summary.comparison.status==='insufficient'&&<p className={styles.scope}>{summary.comparison.text}</p>}
    </details>}
  </section>;
}
