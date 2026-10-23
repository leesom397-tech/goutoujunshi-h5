"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowLeft,ArrowRight,ChevronDown,LoaderCircle,MessageCircle,Square} from "lucide-react";
import type {SentenceAnnotation,SentencePage} from "@/lib/capture-sentence-reading";
import {api,message,type Json} from "./client";
import {CaptureEvidence} from "./CaptureEvidence";
import {useReportSessionState} from "./ReportSessionState";
import styles from "./HistorySentenceReader.module.css";

const endpoint="/api/web/report/sentences";
function storedPage(report:Json):SentencePage|null{
  const recent=report.recentSentenceAnalysis||report.semanticHistory?.recentSentenceAnalysis;
  if(!recent||!Array.isArray(recent.lines)||!recent.lines.length)return null;
  const lines=recent.lines.filter((line:Json)=>line&&typeof line.text==="string"&&["self","other"].includes(line.speaker));
  const ids=new Set(lines.map((line:Json)=>line.id)),annotations=(Array.isArray(recent.annotations)?recent.annotations:[]).filter((item:Json)=>ids.has(item.lineId));
  return {offset:0,nextOffset:lines.length,totalReadable:recent.totalReadable||lines.length,totalAnalyzed:annotations.length,lines,annotations,status:annotations.length===lines.length?"complete":"partial",pageKey:"saved-sample",cost:0};
}
function Signals({annotation}:{annotation:SentenceAnnotation}){
  return <div className={styles.signals}>{([["emotion","语气"],["intent","意图"]] as const).map(([key,label])=><div key={key}><h4>{label}</h4>{annotation[key]?.length?annotation[key].map(tag=><div className={styles.signal} key={tag.key}><span>{tag.label}</span><span className={styles.track} aria-hidden="true"><i style={{width:`${tag.probability*100}%`}}/></span><b>{Math.round(tag.probability*100)}%</b></div>):<p>线索不足，暂不评分</p>}</div>)}<p className={styles.note}>{annotation.note}</p></div>;
}
export function HistorySentenceReader({report,publicExample=false}:{report:Json;publicExample?:boolean}){
  const id=String(report.reportId||report.id||""),scope=id+":"+(report.archiveSnapshot?.revision??"legacy");
  const [page,setPage]=useReportSessionState<SentencePage|null>("sentence-page:"+scope,()=>storedPage(report));
  const [selected,setSelected]=useReportSessionState<string>("sentence-selected:"+scope,"");
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [elapsed,setElapsed]=useState(0),[cancelling,setCancelling]=useState(false);
  const current=useRef(0),mounted=useRef(true),request=useRef<{id:string;offset:number;count:number}|null>(null),root=useRef<HTMLElement>(null),readController=useRef<AbortController|null>(null);
  const canBrowse=!publicExample&&!!report.archiveSnapshot?.libraryId&&report.analysisScope==="fullHistory";
  async function load(selection:{offset?:number;before?:number;count?:number},scroll=false){
    const ticket=++current.current;readController.current?.abort();const controller=new AbortController();readController.current=controller;
    setLoading(true);setError("");setNotice("");
    try{
      const query=new URLSearchParams({id,...Object.fromEntries(Object.entries(selection).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)]))});
      const data=await api(endpoint+"?"+query,undefined,controller.signal) as SentencePage;
      if(!mounted.current||ticket!==current.current)return;
      setPage(data);setSelected("");
      if(scroll)requestAnimationFrame(()=>root.current?.scrollIntoView({block:"start",behavior:"instant"}));
    }catch(cause){if(mounted.current&&ticket===current.current&&!controller.signal.aborted)setError(message(cause));}
    finally{if(mounted.current&&ticket===current.current)setLoading(false);}
  }
  useEffect(()=>{
    mounted.current=true;
    // Paint cached originals immediately, then verify the library revision.
    // Repairing images or adding messages must not pin this reader to old data.
    if(canBrowse)void load(page&&page.pageKey!=="saved-sample"?{offset:page.offset,count:page.lines.length||undefined}:{before:20_000});
    return()=>{mounted.current=false;current.current++;readController.current?.abort();};
  },[scope,canBrowse]);
  useEffect(()=>{if(!busy)return;const started=Date.now(),timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[busy]);
  // Reopening a running page observes the existing lease; it never starts a
  // model request automatically. The saved original page stays visible.
  useEffect(()=>{
    if(busy||!page||!["running","cancelling"].includes(page.status)||!canBrowse)return;
    const timer=setTimeout(()=>void load({offset:page.offset,count:page.lines.length}),2000);
    return()=>clearTimeout(timer);
  },[page,busy,canBrowse]);
  async function analyze(){
    if(!page||busy||loading||request.current||!canBrowse||page.pageKey==="saved-sample")return;
    const task={id:crypto.randomUUID(),offset:page.offset,count:page.lines.length},ticket=++current.current;
    request.current=task;setBusy(true);setCancelling(false);setElapsed(0);setError("");setNotice("");
    try{
      const data=await api(endpoint,{id,action:"analyze",confirmed:true,offset:task.offset,count:task.count,requestId:task.id},AbortSignal.timeout(60_000)) as SentencePage;
      if(mounted.current&&ticket===current.current){setPage(data);setNotice(data.status==="complete"?"本页解读已保存，下次直接查看。":"已保存本次完成的解读，其余句子可继续补充。");}
    }catch(cause){if(mounted.current&&ticket===current.current){
      setError(message(cause));
      // A response can be lost after the server acquired its lease. Read its
      // actual state before offering another request, never assume failure.
      try{const state=await api(endpoint+"?"+new URLSearchParams({id,offset:String(task.offset),count:String(task.count)})) as SentencePage;if(mounted.current&&ticket===current.current)setPage(state);}catch{/* Keep the original page and explicit retry message. */}
    }}
    finally{request.current=null;if(mounted.current&&ticket===current.current){setBusy(false);setCancelling(false);}}
  }
  async function cancel(){
    const task=request.current||(page?.requestId?{id:page.requestId,offset:page.offset,count:page.lines.length}:null);
    if(!task||cancelling)return;setCancelling(true);setError("");
    try{
      const data=await api(endpoint,{id,action:"cancel",offset:task.offset,count:task.count,requestId:task.id},AbortSignal.timeout(10_000)) as SentencePage;
      if(!mounted.current)return;
      setPage(data);setNotice(data.status==="cancelling"?"已请求停止，正在结束本次解读。原文和已保存结果保留。":"已停止本次补充。");
    }catch(cause){if(mounted.current){setError("停止尚未确认："+message(cause));setCancelling(false);}}
  }
  const sample=page?.pageKey==="saved-sample",running=busy||page?.status==="running"||page?.status==="cancelling";
  const annotations=new Map((page?.annotations||[]).map(item=>[item.lineId,item]));
  const total=page?.totalReadable??report.semanticHistory?.coverage?.receivedText??0;
  return <section ref={root} className={styles.reader} data-history-sentence-reader aria-label="全部聊天的逐句解读">
    <header><div><span className={styles.eyebrow}><MessageCircle size={18}/>一句一句看明白</span><h2>逐句语气与意图</h2></div><strong className={styles.coverage}>已解读 {page?.totalAnalyzed||0}<small> / {total} 句</small></strong></header>
    <p className={styles.caption}>百分比是语气与意图的解释权重。未解读的原话也可以先看。</p>
    {page?.sourceUpdated&&<p className={styles.status} data-sentence-current-source>按当前保存资料补充；原报告结论未重新分析。</p>}
    {loading&&<p className={styles.status} role="status"><LoaderCircle size={17} className={styles.spin}/>正在读取这一页原话…</p>}
    {page&&<>
      <div className={styles.pageHeading}><strong>{sample?"报告已保存的片段":`第 ${page.lines.length?page.offset+1:0}–${page.nextOffset} 句`}</strong><span>{sample?"尚未加载完整原文":page.annotations.length===page.lines.length?"本页全部已解读":`本页 ${page.annotations.length}/${page.lines.length} 句已解读`}</span></div>
      <div className={styles.sentences}>{page.lines.map((line,index)=>{
        const annotation=annotations.get(line.id),open=selected===line.id;
        return <article className={styles.sentence} data-role={line.speaker} data-open={open} key={line.id}>
          <button type="button" className={styles.sentenceToggle} aria-expanded={open} onClick={()=>setSelected(open?"":line.id)}>
            <span className={styles.sentenceMeta}><span>{sample?"原话":`${page.offset+index+1}`} · {line.speaker==="self"?"我":report.participants?.other?.label||"对方"}</span><small>{annotation?"已解读":"未解读"}<ChevronDown size={16}/></small></span>
            <span className={styles.original}>{line.text}</span>
            {!!annotation?.intent?.[0]&&<span className={styles.quickTag}>{annotation.intent[0].label} <b>{Math.round(annotation.intent[0].probability*100)}%</b></span>}
          </button>
          {open&&<div className={styles.detail}>{line.at&&<time>{line.at.replace("T"," ").replace(/\.\d{3}Z$/,"")}</time>}{annotation?<Signals annotation={annotation}/>:<p>这句尚未逐句解读。补充本页后会保存结果。</p>}<CaptureEvidence quote={line.text} sourceIds={[line.sourceId]} libraryId={line.libraryId} sourceKind="chat"/></div>}
        </article>;
      })}</div>
      {!sample&&canBrowse&&<nav className={styles.pager} aria-label="全部聊天分页"><button type="button" disabled={loading||!!running||page.offset===0} onClick={()=>void load({before:page.offset},true)}><ArrowLeft size={17}/>更早的聊天</button><span>{page.offset+1}–{page.nextOffset} / {page.totalReadable}</span><button type="button" disabled={loading||!!running||page.nextOffset>=page.totalReadable} onClick={()=>void load({offset:page.nextOffset},true)}>更近的聊天<ArrowRight size={17}/></button></nav>}
    </>}
    {canBrowse&&(!page||sample)&&<button type="button" className={styles.primary} disabled={loading} onClick={()=>void load({before:20_000})}>查看全部聊天</button>}
    {canBrowse&&page&&!sample&&page.annotations.length<page.lines.length&&<div className={styles.supplement}>
      {running?<><span role="status"><LoaderCircle size={17} className={styles.spin}/>{cancelling||page.status==="cancelling"?"正在停止…":`正在解读这 ${page.lines.length-page.annotations.length} 句${busy?` · ${elapsed} 秒`:""}`}</span><button type="button" disabled={cancelling||page.status==="cancelling"} onClick={()=>void cancel()}><Square size={15}/>停止</button></>:<><div><strong>还有 {page.lines.length-page.annotations.length} 句未解读</strong><small>仅补充本页 · 免费 · 不改整份报告</small></div><button type="button" className={styles.primary} disabled={loading} onClick={()=>void analyze()}>补充本页解读</button></>}
    </div>}
    {notice&&<p className={styles.status} role="status">{notice}</p>}{error&&<p className={styles.error} role="alert">{error}</p>}
    {!canBrowse&&!page&&<p className={styles.caption}>这份旧报告没有保存逐句解读；完整原话已同步后，可在完整聊天报告中按页查看。</p>}
  </section>;
}
