"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCheck, LoaderCircle, RefreshCw } from "lucide-react";
import { api, type Json } from "./web-analysis/client";
import styles from "./CaptureAnalysisStatus.module.css";

export function CaptureAnalysisStatus({owner, onSettled, onStatus, onChecking, visible = true, enabled = true, libraryId, subjectId, taskId, initialJob, hideCompleted = false}:{
  owner:string;onSettled?:()=>void;onStatus?:(job:Json|null)=>void;onChecking?:(checking:boolean)=>void;
  visible?:boolean;enabled?:boolean;libraryId?:string;subjectId?:string;taskId?:string;initialJob?:Json|null;hideCompleted?:boolean;
}) {
  const [job,setJob]=useState<Json|null>(null),[offline,setOffline]=useState(false),[retry,setRetry]=useState(0);
  const callbacks=useRef({onStatus,onChecking,onSettled});
  callbacks.current={onStatus,onChecking,onSettled};
  const seed=useRef(initialJob);seed.current=initialJob;
  useEffect(()=>{
    if(!owner||!enabled){setJob(null);setOffline(false);callbacks.current.onStatus?.(null);callbacks.current.onChecking?.(false);return;}
    const initial=seed.current && (!taskId||seed.current.taskId===taskId) && (!libraryId||seed.current.libraryId===libraryId) ? seed.current : null;
    setJob(initial);setOffline(false);callbacks.current.onStatus?.(initial);callbacks.current.onChecking?.(!initial);
    let live=true,timer:ReturnType<typeof setTimeout>,lastStatus=initial?.status||"",lastCreditStatus=initial?.creditTaskStatus||"",sequence=0;
    const controller=new AbortController();
    const params=new URLSearchParams();
    params.set("summary","1");
    if(taskId)params.set("taskId",taskId);
    if(libraryId)params.set("libraryId",libraryId);
    if(subjectId)params.set("subjectId",subjectId);
    const poll=async()=>{
      const request=++sequence;
      try{
        const next=await api('/api/web/capture/analyze'+(params.size?'?'+params.toString():''),undefined,controller.signal);
        if(!live||request!==sequence)return;
        const belongs=(!libraryId||next.libraryId===libraryId)&&(!subjectId||next.subjectId===subjectId);
        const current=next.status==='none'||next.status==='removed'||!belongs?null:next;
        setJob(current);setOffline(false);callbacks.current.onStatus?.(current);callbacks.current.onChecking?.(false);
        if(lastStatus && (lastStatus!==next.status || lastCreditStatus!==next.creditTaskStatus) && ['done','error'].includes(next.status))callbacks.current.onSettled?.();
        lastStatus=next.status;lastCreditStatus=next.creditTaskStatus;
        if(['queued','running','retrying'].includes(next.status) || ['done','error'].includes(next.status) && next.creditTaskStatus==='reserved')timer=setTimeout(poll,3000);
      }catch{if(live&&request===sequence){setOffline(true);callbacks.current.onChecking?.(false);timer=setTimeout(poll,8000);}}
    };
    const refresh=()=>{clearTimeout(timer);void poll();};
    void poll();window.addEventListener('chengzi:capture-analysis',refresh);
    return()=>{live=false;controller.abort();clearTimeout(timer);window.removeEventListener('chengzi:capture-analysis',refresh);};
  },[owner,enabled,libraryId,subjectId,taskId,retry]);
  // UI visibility must not clear the identity or progress of a running task.
  if(!visible || job?.status==='done'&&hideCompleted)return null;
  if(!job)return offline?<section className={styles.panel} role="status"><strong>暂时无法读取报告进度</strong><p>已提交的任务会保留，连接恢复后自动继续查看。</p><button onClick={()=>setRetry(value=>value+1)}><RefreshCw size={16}/>重新连接进度</button></section>:null;
  const busy=['queued','running','retrying'].includes(job.status);
  const moments=job.kind==='moments',readCount=moments?job.completedCaptions||0:job.completedText||0;
  const phase:Record<string,string>={preparing:'正在核对材料',images:'正在读图片线索',segments:moments?'正在梳理全部朋友圈':'正在梳理全部聊天',synthesis:'正在整理判断与建议',complete:moments?'完整朋友圈报告已保存':'完整关系报告已保存'};
  const finishedAt=job.completedAt||job.updatedAt;
  const relatedCount=Array.isArray(job.relatedSnapshots)?job.relatedSnapshots.reduce((total:number,value:Json)=>total+Number(value.expectedTotal??value.total??0),0):0;
  const scopeText=`${job.totalCount} 条${moments?"朋友圈":"聊天"}${!moments&&relatedCount?` + ${relatedCount} 条朋友圈`:""}`;
  return <section className={styles.panel} data-capture-analysis={job.status} aria-live="polite">
    <div className={styles.heading}>{busy?<LoaderCircle size={21} className={styles.spin}/>:<CheckCheck size={21}/>}<strong>{job.status==='error'?'这次分析未完成':phase[job.phase]||'正在后台生成报告'}</strong></div>
    <p>{job.friend ? `${job.friend} · ` : ''}{busy?`已核对 ${readCount} 条${moments?'动态文字':'聊天'}${!moments&&job.completedCaptions?`、${job.completedCaptions} 条动态文字`:''}${job.completedImages?`、${job.completedImages} 张图片`:''} · ${scopeText}` : job.status==='done'?`基于 ${scopeText}${finishedAt?' · '+new Date(finishedAt).toLocaleString('zh-CN',{hour12:false}):''}` : job.error}</p>
    {busy && <><progress aria-label={moments?'已核对的朋友圈文字':'已核对的聊天文字'} max={Math.max(job.totalCount,1)} value={["preparing","images","synthesis"].includes(job.phase)?undefined:Math.min(readCount,job.totalCount)}/><p className={styles.secondary}>{offline?'暂时连不上进度，后台任务仍保留。':job.status==='retrying'?job.error:'报告生成后会保存在这里，可以离开此页。无需重复提交。'}</p></>}
    {job.status==='error' && <p className={styles.secondary}>{job.creditTaskStatus==='released'?'本次积分已退回。重新生成时会复用已完成且未变化的段落。':'正在核对结算，请稍后查看。'}</p>}
    {job.status==='done' && <a href={`/report?id=${encodeURIComponent(job.taskId)}`}>打开完整报告<ArrowRight size={17}/></a>}
    {offline && <button onClick={()=>setRetry(value=>value+1)}><RefreshCw size={16}/>重新连接进度</button>}
  </section>;
}
