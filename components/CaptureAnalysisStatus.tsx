"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCheck, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { api, type Json } from "./web-analysis/client";
import {WaitingProgress} from "./WaitingProgress";
import {waitingDuration} from "@/lib/waiting-time";
import styles from "./CaptureAnalysisStatus.module.css";

export function CaptureAnalysisStatus({owner, onSettled, onStatus, onChecking, visible = true, enabled = true, libraryId, subjectId, taskId, initialJob, hideCompleted = false}:{
  owner:string;onSettled?:()=>void;onStatus?:(job:Json|null)=>void;onChecking?:(checking:boolean)=>void;
  visible?:boolean;enabled?:boolean;libraryId?:string;subjectId?:string;taskId?:string;initialJob?:Json|null;hideCompleted?:boolean;
}) {
  const [job,setJob]=useState<Json|null>(null),[offline,setOffline]=useState(false),[retry,setRetry]=useState(0),[loadedScope,setLoadedScope]=useState("");
  const scope=JSON.stringify([owner,enabled,libraryId||"",subjectId||"",taskId||""]);
  const callbacks=useRef({onStatus,onChecking,onSettled,scope});
  callbacks.current={onStatus,onChecking,onSettled,scope};
  const seed=useRef(initialJob);seed.current=initialJob;
  useEffect(()=>{
    setLoadedScope(scope);
    if(!owner||!enabled){setJob(null);setOffline(false);callbacks.current.onStatus?.(null);callbacks.current.onChecking?.(false);return;}
    const initial=seed.current && (!taskId||seed.current.taskId===taskId) && (!libraryId||seed.current.libraryId===libraryId) && (!subjectId||seed.current.subjectId===subjectId) ? seed.current : null;
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
        if(!live||request!==sequence||callbacks.current.scope!==scope)return;
        if(!['none','removed','queued','running','retrying','done','error'].includes(next.status))throw Error('报告进度暂时不完整');
        const belongs=(!libraryId||next.libraryId===libraryId)&&(!subjectId||next.subjectId===subjectId);
        const current=next.status==='none'||next.status==='removed'||!belongs?null:next;
        setJob(current);setOffline(false);callbacks.current.onStatus?.(current);callbacks.current.onChecking?.(false);
        if(lastStatus && (lastStatus!==next.status || lastCreditStatus!==next.creditTaskStatus) && ['done','error'].includes(next.status))callbacks.current.onSettled?.();
        lastStatus=next.status;lastCreditStatus=next.creditTaskStatus;
        if(['queued','running','retrying'].includes(next.status) || ['done','error'].includes(next.status) && next.creditTaskStatus==='reserved')timer=setTimeout(poll,3000);
      }catch{if(live&&request===sequence&&callbacks.current.scope===scope){setOffline(true);callbacks.current.onChecking?.(false);timer=setTimeout(poll,8000);}}
    };
    const refresh=()=>{clearTimeout(timer);void poll();};
    void poll();window.addEventListener('chengzi:capture-analysis',refresh);
    return()=>{live=false;controller.abort();clearTimeout(timer);window.removeEventListener('chengzi:capture-analysis',refresh);};
  },[owner,enabled,libraryId,subjectId,taskId,retry,scope]);
  // UI visibility must not clear the identity or progress of a running task.
  if(loadedScope!==scope || !visible || job?.status==='done'&&hideCompleted)return null;
  if(!job)return offline?<section className={styles.panel} role="status"><strong>暂时无法读取报告进度</strong><p>已提交的任务会保留，连接恢复后自动继续查看。</p><button onClick={()=>setRetry(value=>value+1)}><RefreshCw size={16}/>重新连接进度</button></section>:null;
  const busy=['queued','running','retrying'].includes(job.status);
  const moments=job.kind==='moments',readCount=moments?job.completedCaptions||0:job.completedText||0;
  const phase:Record<string,string>={preparing:'正在核对材料',images:'正在读图片线索',segments:moments?'正在梳理全部朋友圈':'正在梳理全部聊天',synthesis:'正在整理判断与建议',saving:'正在保存报告',complete:moments?'完整朋友圈报告已保存':'完整关系报告已保存'};
  const finishedAt=job.completedAt||job.updatedAt;
  const relatedCount=Array.isArray(job.relatedSnapshots)?job.relatedSnapshots.reduce((total:number,value:Json)=>total+Number(value.expectedTotal??value.total??0),0):0;
  const scopeText=`${job.totalCount} 条${moments?"朋友圈":"聊天"}${!moments&&relatedCount?` + ${relatedCount} 条朋友圈`:""}`;
  const stageIndex:Record<string,number>={preparing:0,images:1,segments:2,synthesis:3,saving:3,complete:3};
  const knownSegments=job.phase==='segments'&&Number.isSafeInteger(job.totalSegments)&&job.totalSegments>0;
  const phaseDetail:Record<string,string>={preparing:'先核对已上传的资料。已有内容会复用，无需再次上传。',images:'正在结合配文读取图片。图片复杂度不同，暂时无法可靠估算剩余时间。',segments:'正在逐组核对上下文。后续还会汇总关系判断和建议。',synthesis:'资料梳理已完成，正在汇总判断、依据与回复建议。此步骤暂时无法可靠估算剩余时间。',saving:'分析已完成，正在保存报告与原文依据。保存完成后即可打开。'};
  const heading=job.status==='error'?'这次分析未完成':job.status==='retrying'?'正在恢复当前步骤':phase[job.phase]||'正在后台生成报告';
  return <section className={styles.panel} data-capture-analysis={job.status} aria-live="polite">
    <div className={styles.heading}>{busy?<LoaderCircle size={21} className={styles.spin}/>:job.status==='error'?<CircleAlert size={21}/>:<CheckCheck size={21}/>}<strong>{heading}</strong></div>
    <p>{job.friend ? `${job.friend} · ` : ''}{busy?`已核对 ${readCount} 条${moments?'动态文字':'聊天'}${!moments&&job.completedCaptions?`、${job.completedCaptions} 条动态文字`:''}${job.completedImages?`、${job.completedImages} 张图片`:''} · ${scopeText}` : job.status==='done'?`基于 ${scopeText}${finishedAt?' · '+new Date(finishedAt).toLocaleString('zh-CN',{hour12:false}):''}` : job.error}</p>
    {busy && <><progress aria-label={knownSegments?'当前材料梳理进度':'正在处理当前阶段'} max={knownSegments?job.totalSegments:1} value={knownSegments?Math.min(job.completedSegments||0,job.totalSegments):undefined}/>{knownSegments&&<p className={styles.secondary}>已梳理 {job.completedSegments||0} / {job.totalSegments} 组材料</p>}<WaitingProgress startedAt={job.startedAt} phaseStartedAt={job.phaseStartedAt} phaseKey={`${job.taskId}:${job.phase}:${job.retryCount||0}`} steps={['核对资料','读取图片','梳理上下文','生成报告']} step={stageIndex[job.phase]??0} offline={offline||job.status==='retrying'} work={knownSegments?{completed:job.completedSegments||0,total:job.totalSegments,reuseKey:job.reusedSegments||0}:undefined} detail={offline?'暂时连不上进度，正在自动重连。原任务已保留。':job.status==='retrying'?'正在重试当前步骤，已完成的部分会保留，无需重新提交。':phaseDetail[job.phase]||'完成后会显示报告，无需重复提交。'}/><p className={styles.secondary}>{!offline&&job.error?job.error:'报告生成后会保存在这里，可以离开此页，从「分析记录」回来查看。无需重复提交。'}</p></>}
    {job.status==='done'&&job.startedAt&&finishedAt&&<p className={styles.secondary}>生成用时 {waitingDuration(finishedAt-job.startedAt)}{job.reusedSteps?' · 已复用此前完成的资料分析':''}</p>}
    {job.status==='error' && <p className={styles.secondary}>{job.creditTaskStatus==='released'?'本次积分已退回。重新生成时会复用已完成且未变化的段落。':'正在核对结算，请稍后查看。'}</p>}
    {job.status==='done' && <a href={`/report?id=${encodeURIComponent(job.taskId)}`}>打开完整报告<ArrowRight size={17}/></a>}
    {offline && <button onClick={()=>setRetry(value=>value+1)}><RefreshCw size={16}/>重新连接进度</button>}
  </section>;
}
