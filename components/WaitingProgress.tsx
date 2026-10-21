"use client";
import {useEffect,useRef,useState} from "react";
import {Clock3} from "lucide-react";
import {remainingTimeRange,waitingDuration} from "@/lib/waiting-time";
import styles from "./WaitingProgress.module.css";

type Work={completed:number;total:number;reuseKey?:number};
export function WaitingProgress({startedAt,phaseStartedAt,phaseKey,steps,step,detail,work,offline=false}:{
  startedAt?:number;phaseStartedAt?:number;phaseKey:string;steps?:string[];step?:number;detail:string;work?:Work;offline?:boolean;
}) {
  const [now,setNow]=useState(Date.now());
  const observedAt=useRef(Date.now());
  const sample=useRef<{key:string;at:number;completed:number;total:number;lastCompleted:number;lastAt:number;updates:number}|null>(null);
  useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[startedAt,phaseKey]);
  const key=`${phaseKey}:${work?.reuseKey??0}:${offline}`;
  useEffect(()=>{
    if(!work||offline){sample.current=null;return;}
    const previous=sample.current;
    if(!previous||previous.key!==key||previous.total!==work.total||work.completed<previous.lastCompleted){sample.current={key,at:Date.now(),completed:work.completed,total:work.total,lastCompleted:work.completed,lastAt:Date.now(),updates:0};return;}
    if(work.completed>previous.lastCompleted){previous.updates++;previous.lastCompleted=work.completed;previous.lastAt=Date.now();}
  },[key,work?.completed,work?.total,offline]);
  const baseline=sample.current;
  // Only extrapolate this phase's measured progress, never cached work or another task.
  const estimate=work&&baseline?.key===key&&baseline.updates>=2&&now-baseline.at>=8000&&now-baseline.lastAt<60000&&!offline?
    remainingTimeRange(work.completed-baseline.completed,work.total-work.completed,now-baseline.at):null;
  return <div className={styles.waiting} data-waiting-progress>
    <div className={styles.time} aria-live="off"><Clock3 size={18}/><span>{startedAt?'已用时':'本页已等待'} <strong>{waitingDuration(now-(startedAt||observedAt.current))}</strong></span>{!!phaseStartedAt&&phaseStartedAt!==startedAt&&<span className={styles.phaseTime}>本阶段 {waitingDuration(now-phaseStartedAt)}</span>}</div>
    {!!steps?.length&&<ol className={styles.steps} aria-label="处理流程">{steps.map((label,index)=><li key={label} data-active={index===step} data-passed={typeof step==="number"&&index<step} aria-current={index===step?"step":undefined}><span aria-hidden="true">{index+1}</span>{label}</li>)}</ol>}
    <p className={styles.detail}>{estimate?`按当前速度，本阶段约还需 ${estimate}。后续仍需汇总报告，用时会随材料与网络变化。`:detail}</p>
  </div>;
}
