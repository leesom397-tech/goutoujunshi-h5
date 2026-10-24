"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, MessageCircle, MessageCircleQuestion } from 'lucide-react';
import { computeReplyAttention, REPLY_ATTENTION_RULES_VERSION, type ReplyAttentionEvidence, type ReplyAttentionRow, type ReplyAttentionSummary } from '@/lib/reply-attention';
import { getCaptureLibrary, readReportSources } from '@/lib/desktop-capture-vault';
import { CaptureEvidence } from './CaptureEvidence';
import { api } from './client';
import styles from './ReplyAttentionOverview.module.css';

type Report = Record<string, any>;
const validEvidence=(value:any)=>value&&typeof value==='object'&&typeof value.sourceId==='string'&&typeof value.text==='string'&&typeof value.at==='string'&&['self','other','unknown'].includes(value.role);
function savedSummary(input: unknown): ReplyAttentionSummary | null {
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const report=input as Report;
  const value=report.replyAttention||report.semanticHistory?.replyAttention;
  return value?.version===1&&value.rulesVersion===REPLY_ATTENTION_RULES_VERSION&&['ready','insufficient'].includes(value.status)
    &&Array.isArray(value.questions)&&value.questions.every((row:any)=>row&&validEvidence(row.question)&&Array.isArray(row.responses)&&row.responses.every(validEvidence)&&typeof row.reading==='string'&&typeof row.label==='string')
    &&Array.isArray(value.initiations)&&value.initiations.every((row:any)=>row&&Array.isArray(row.evidence)&&row.evidence.every(validEvidence)&&typeof row.from==='string'&&typeof row.to==='string'&&typeof row.reading==='string')
    &&Array.isArray(value.limitations)&&value.limitations.every((value:any)=>typeof value==='string')
    &&typeof value.headline==='string'&&typeof value.reading==='string'&&value.comparison&&typeof value.comparison.text==='string'?value:null;
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
type Loading = {key:string;phase:'loading'|'ready'|'insufficient'|'error'|'unauthorized'|'cancelled';summary?:ReplyAttentionSummary;source?:'local'|'cloud';updated?:boolean;reason?:'timeout'|'invalid'|'unavailable'};

/** A blocked/slow IndexedDB open must not prevent the authorized cloud fallback. */
function localDeadline<T>(work:Promise<T>,signal:AbortSignal):Promise<T|null> {
  return new Promise((resolve,reject)=>{
    const done=(value:T|null)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);resolve(value);};
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason||new DOMException('Aborted','AbortError'));};
    const timer=setTimeout(()=>done(null),800);
    signal.addEventListener('abort',abort,{once:true});
    work.then(done,()=>done(null));
    if(signal.aborted)abort();
  });
}

/** Uses saved structured analysis, or re-reads existing local originals for old reports. No analysis fee or model request. */
export function ReplyAttentionOverview({report,ownerId}:{report:Report;ownerId?:string}) {
  const reportId=String(report.reportId||report.id||'');
  const supplied=useMemo(()=>savedSummary(report),[report]);
  const fallback=useMemo(()=>{const rows=availableRows(report);return rows?computeReplyAttention(rows,{scope:'recent-window'}):null;},[report]);
  const standalone=fallback?.status==='ready'&&!['fullHistory','uploadedHistory'].includes(report.analysisScope)&&report.captureFormat!=='full-history';
  const [loaded,setLoaded]=useState<Loading|null>(null),[attempt,setAttempt]=useState(0);
  const cancel=useRef<null|(()=>void)>(null);
  const key=JSON.stringify([ownerId,reportId,report.subjectId,report.archiveSnapshot?.libraryId,report.archiveSnapshot?.epoch,report.archiveSnapshot?.revision]);
  useEffect(()=>{
    let active=true,localAllowed=true;const controller=new AbortController();
    if(supplied?.status==='ready'||standalone||!ownerId||!reportId||report.demo===true)return;
    setLoaded({key,phase:'loading'});
    const stop=()=>{if(active){controller.abort();setLoaded({key,phase:'cancelled'});}};
    cancel.current=stop;
    const timer=setTimeout(()=>controller.abort(new DOMException('Timeout','TimeoutError')),30000);
    const current=()=>active&&!controller.signal.aborted;
    void (async()=>{
      const localTask=(async()=>{
        if(attempt>0)return null;
        const link=await readReportSources(ownerId,reportId);
        if(!current()||!localAllowed)return null;
        const library=link?.kind==='chat'?await getCaptureLibrary(ownerId,link.libraryId):null;
        if(!current()||!localAllowed||!library||library.ownerId!==ownerId||library.kind!=='chat'||library.id!==link?.libraryId||library.cloud?.retired)return null;
        const snapshot=report.archiveSnapshot,sourceLibrary=library.cloud?.id||library.id;
        if(snapshot?.libraryId&&snapshot.libraryId!==sourceLibrary)return null;
        if(snapshot?.epoch!==undefined&&library.cloud?.epoch!==snapshot.epoch)return null;
        const expected=[library.cloud?.total,snapshot?.total].filter(value=>typeof value==='number'&&Number.isFinite(value)&&value>0) as number[];
        const complete=expected.length?library.records.length>=Math.max(...expected):library.coverage?.complete===true&&library.coverage.recordCount===library.records.length;
        if(library.records.length&&complete){
          // Keep original account/session metadata. A mixed source must fall
          // back, never be made to look continuous by stripping its identity.
          return computeReplyAttention(library.records.map((row,index)=>({...row,libraryId:sourceLibrary,sourceKind:'chat',sequence:index})),{scope:'full-history'});
        }
        return null;
      })();
      const local=await localDeadline(localTask,controller.signal);localAllowed=false;
      if(!current())return;
      if(local?.status==='ready'){setLoaded({key,phase:'ready',summary:local,source:'local',updated:true});return;}
      const value=await api(`/api/web/report/sentences?id=${encodeURIComponent(reportId)}&mode=attention`,undefined,controller.signal),summary=savedSummary(value);
      if(!current())return;
      if(!summary){setLoaded({key,phase:'error',reason:'invalid'});return;}
      setLoaded({key,phase:summary.status,summary,source:'cloud',updated:value.sourceUpdated===true});
    })().catch(error=>{
      if(!active||controller.signal.aborted&&controller.signal.reason?.name!=='TimeoutError')return;
      const status=Number(error?.status);
      setLoaded({key,phase:status===401?'unauthorized':'error',reason:controller.signal.reason?.name==='TimeoutError'?'timeout':[404,409,413].includes(status)?'unavailable':undefined});
    }).finally(()=>{clearTimeout(timer);if(cancel.current===stop)cancel.current=null;});
    return()=>{active=false;localAllowed=false;controller.abort();clearTimeout(timer);if(cancel.current===stop)cancel.current=null;};
  },[key,supplied,report.demo,attempt,standalone]);
  const refreshed=loaded?.key===key?loaded:null;
  const canLoad=!!ownerId&&!!reportId&&report.demo!==true&&!standalone;
  const summary=supplied?.status==='ready'?supplied:refreshed?.summary||(standalone?fallback:null)||supplied;
  const phase=refreshed?.phase|| (canLoad?'loading':summary?.status||'unauthorized');
  const retry=()=>setAttempt(value=>value+1);
  if(!summary||summary.status!=='ready'){
    // Pure Moments/public examples have no reply history to request. All real
    // chat reports retain an observable loading/empty/failure state.
    if(report.captureKind==='moments'||report.demo===true&&!summary)return null;
    const state=canLoad?phase:ownerId?'insufficient':'unauthorized';
    const title=state==='loading'?'正在核对近期回应':state==='cancelled'?'已停止本次核对':state==='unauthorized'?'登录后核对近期回应':state==='error'?'近期回应暂未读取成功':'近期回应尚不能核对';
    const description=state==='loading'?'正在读取已保存的连续聊天。':state==='cancelled'?'已保存的报告和聊天保持不变。':state==='unauthorized'?'请登录原账号，再读取这份报告的聊天。':state==='error'?(refreshed?.reason==='unavailable'?'对应聊天暂时无法读取，请重试或确认原始资料仍已保存。':refreshed?.reason==='invalid'?'核对结果暂未更新完整，请稍后重试。':'连接暂时未完成，可以重新读取。'):
      summary?.limitations.find(value=>value.includes('会话'))||summary?.reading||'需要连续的原始聊天，才能看清问题后的回应。';
    return <section className={styles.panel} data-reply-attention data-reply-attention-state={state} aria-label="最近的提问有没有被接住" aria-busy={state==='loading'}>
      <header className={styles.header}><span><MessageCircleQuestion size={18}/>最近的回应</span><small>核对已保存聊天 · 不扣积分</small></header>
      <h2>{title}</h2><p className={styles.reading} role={state==='error'?'alert':'status'}>{description}</p>
      <div className="wa-actions">{state==='loading'?<button className="wa-btn wa-btn-secondary" onClick={()=>cancel.current?.()}>停止核对</button>:state==='unauthorized'?<a className="wa-btn wa-btn-secondary" href={`/login?return_to=${encodeURIComponent(`/report?id=${reportId}`)}`}>登录账号</a>:canLoad?<button className="wa-btn wa-btn-secondary" onClick={retry}>重新核对</button>:null}</div>
    </section>;
  }
  const latest=summary.questions[0],run=summary.initiations[0];
  return <section className={styles.panel} data-reply-attention data-reply-attention-state="ready" data-reply-attention-source={refreshed?.source||'saved'} aria-label="最近的提问有没有被接住">
    <header className={styles.header}><span><MessageCircleQuestion size={18}/>最近的回应</span><small>{refreshed?.source==='local'?'按本机已保存聊天核对':refreshed?.updated?'按当前已保存聊天更新':summary.scope==='full-history'?'从连续聊天核对':'仅核对当前片段'}</small></header>
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
