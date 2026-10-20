"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCheck, LoaderCircle, RefreshCw } from "lucide-react";
import { api, type Json } from "./web-analysis/client";
import styles from "./CaptureAnalysisStatus.module.css";

export function CaptureAnalysisStatus({owner, onSettled, onStatus, visible = true}:{owner:string;onSettled?:()=>void;onStatus?:(job:Json|null)=>void;visible?:boolean}) {
  const [job,setJob]=useState<Json|null>(null),[offline,setOffline]=useState(false),[retry,setRetry]=useState(0);
  const onStatusRef=useRef(onStatus);
  useEffect(()=>{onStatusRef.current=onStatus;},[onStatus]);
  useEffect(()=>{
    setJob(null);setOffline(false);onStatusRef.current?.(null);
    if(!owner||!visible)return;
    let live=true,timer:ReturnType<typeof setTimeout>,lastStatus="",lastCreditStatus="";
    const controller=new AbortController();
    const poll=async()=>{
      try{
        const next=await api('/api/web/capture/analyze',undefined,controller.signal);
        if(!live)return;
        const current=next.status==='none'||next.status==='removed'?null:next;
        setJob(current);setOffline(false);onStatusRef.current?.(current);
        if(lastStatus && (lastStatus!==next.status || lastCreditStatus!==next.creditTaskStatus) && ['done','error'].includes(next.status))onSettled?.();
        lastStatus=next.status;lastCreditStatus=next.creditTaskStatus;
        if(['queued','running','retrying'].includes(next.status) || ['done','error'].includes(next.status) && next.creditTaskStatus==='reserved')timer=setTimeout(poll,3000);
      }catch{if(live){setOffline(true);timer=setTimeout(poll,8000);}}
    };
    const refresh=()=>{clearTimeout(timer);void poll();};
    void poll();window.addEventListener('chengzi:capture-analysis',refresh);
    return()=>{live=false;controller.abort();clearTimeout(timer);window.removeEventListener('chengzi:capture-analysis',refresh);};
  },[owner,retry,visible]);
  if(!job)return null;
  const busy=['queued','running','retrying'].includes(job.status);
  const moments=job.kind==='moments',readCount=moments?job.completedCaptions||0:job.completedText||0;
  const phase:Record<string,string>={preparing:'正在核对材料',images:'正在读图片线索',segments:moments?'正在梳理全部朋友圈':'正在梳理全部聊天',synthesis:'正在整理判断与建议',complete:moments?'完整朋友圈报告已保存':'完整关系报告已保存'};
  return <section className={styles.panel} data-capture-analysis={job.status} aria-live="polite">
    <div className={styles.heading}>{busy?<LoaderCircle size={21} className={styles.spin}/>:<CheckCheck size={21}/>}<strong>{job.status==='error'?'这次分析未完成':phase[job.phase]||'正在后台生成报告'}</strong></div>
    <p>{job.friend ? `${job.friend} · ` : ''}{busy?`已核对 ${readCount} 条${moments?'动态文字':'聊天'}${!moments&&job.completedCaptions?`、${job.completedCaptions} 条动态文字`:''}${job.completedImages?`、${job.completedImages} 张图片`:''} · 导入 ${job.totalCount} 条` : job.status==='done'?`基于 ${job.totalCount} 条已导入记录` : job.error}</p>
    {busy && <><progress aria-label={moments?'已核对的朋友圈文字':'已核对的聊天文字'} max={Math.max(job.totalCount,1)} value={Math.min(readCount,job.totalCount)}/><p className={styles.secondary}>{offline?'暂时连不上进度，后台任务仍保留。':job.status==='retrying'?job.error:'可以离开此页，回来继续查看。'}</p></>}
    {job.status==='error' && <p className={styles.secondary}>{job.creditTaskStatus==='released'?'本次积分已退回。重新生成时会复用已完成且未变化的段落。':'正在核对结算，请稍后查看。'}</p>}
    {job.status==='done' && <a href={`/report?id=${encodeURIComponent(job.taskId)}`}>打开完整报告<ArrowRight size={17}/></a>}
    {offline && <button onClick={()=>setRetry(value=>value+1)}><RefreshCw size={16}/>重新连接进度</button>}
  </section>;
}
