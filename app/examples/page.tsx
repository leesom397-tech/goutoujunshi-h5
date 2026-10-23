"use client";

import {useEffect,useState} from "react";
import {ArrowLeft,ArrowRight,MessageCircle,Images,UserRound,BookOpen} from "lucide-react";
import {WebNav} from "@/components/WebNav";
import {AnalysisExample} from "@/components/web-analysis/AnalysisExample";
import "@/components/web-analysis/web-analysis.css";
import styles from "./examples.module.css";

type Mode="chat"|"moments"|"social";
const cases=[
  {mode:"chat" as const,icon:MessageCircle,label:"聊天分析",detail:"态度、投入与怎么回复"},
  {mode:"moments" as const,icon:Images,label:"朋友圈分析",detail:"生活线索、共同点与话题"},
  {mode:"social" as const,icon:UserRound,label:"社交主页分析",detail:"人物特点与相处适配"},
];
export default function ExamplesPage(){
  const [mode,setMode]=useState<Mode>("chat");
  useEffect(()=>{const value=new URLSearchParams(location.search).get("mode");if(value==="chat"||value==="moments"||value==="social")setMode(value);},[]);
  const select=(value:Mode)=>{setMode(value);const url=new URL(location.href);url.searchParams.set("mode",value);history.replaceState(null,"",url.pathname+url.search);};
  return <><WebNav/><main className={styles.page}>
    <a className={styles.back} href="/workspace"><ArrowLeft size={16}/>返回工作台</a>
    <header className={styles.heading}><div><h1>分析示例</h1><p>看判断、核对原话。自己的材料请从聊天开始。</p></div><a href="/library#references"><BookOpen size={18}/>资料依据<ArrowRight size={16}/></a></header>
    <div className={styles.tabs} role="tablist" aria-label="选择分析案例">{cases.map(({mode:value,icon:Icon,label,detail},index)=><button type="button" key={value} id={`example-tab-${value}`} role="tab" aria-selected={mode===value} aria-controls="current-example" tabIndex={mode===value?0:-1} onClick={()=>select(value)} onKeyDown={event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const next=cases[event.key==="Home"?0:event.key==="End"?cases.length-1:(index+(event.key==="ArrowRight"?1:-1)+cases.length)%cases.length].mode;select(next);document.getElementById(`example-tab-${next}`)?.focus();}}><Icon size={22}/><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={17}/></button>)}</div>
    <div id="current-example" role="tabpanel" tabIndex={0} aria-labelledby={`example-tab-${mode}`}><AnalysisExample key={mode} mode={mode} onUpload={()=>location.assign(`/analyze?mode=${mode}`)}/></div>
  </main></>;
}
