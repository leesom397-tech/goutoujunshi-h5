"use client";
import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import {ArrowLeft,ArrowRight,Check,Compass,MessageCircle,ChartNoAxesCombined,Send,Quote,UserRound} from "lucide-react";
import styles from "./ReportReader.module.css";
import {readReportPosition,saveReportPosition,type ReportPanelPosition} from "@/lib/report-reading-position";

export type ReadingSection={id:string;label:string;caption:string;tone:"coral"|"amber"|"teal"|"slate"};
const iconFor=(id:string)=>id==="tone"||id==="status"?MessageCircle:id==="signals"||id==="content"||id==="change"?ChartNoAxesCombined:id==="replies"||id==="next"?Send:id==="evidence"?Quote:id==="overview"?UserRound:Compass;

export function ReportReader({items,children,storageKey,initialSection}:{items:ReadingSection[];children:(active:string)=>ReactNode;storageKey?:string;initialSection?:string}){
 const id=useId(),root=useRef<HTMLDivElement>(null),[active,setActive]=useState(items[0].id),[seen,setSeen]=useState<string[]>([items[0].id]);
 const activeRef=useRef(active),seenRef=useRef(seen),canSave=useRef(false);
 const [restore,setRestore]=useState<{section:string;position:ReportPanelPosition;focus:boolean}|null>(null);
 function storage(){try{return window.localStorage;}catch{return undefined;}}
 function snapshot(){
  if(!storageKey||!canSave.current||!root.current)return;
  const top=root.current.getBoundingClientRect().top,position:ReportPanelPosition={offset:Math.round(-top)};
  const header=root.current.querySelector('[role="tablist"]')?.parentElement?.getBoundingClientRect().bottom||0;
  const panel=root.current.querySelector<HTMLElement>('[data-reading-section="'+activeRef.current+'"]');
  const anchor=Array.from(panel?.querySelectorAll<HTMLElement>('[data-reading-anchor]')||[]).find(node=>{
   const r=node.getBoundingClientRect(),list=node.closest('[data-reading-list]')?.getBoundingClientRect();
   return r.bottom>Math.max(header,list?.top||0)&&r.top<Math.min(innerHeight,list?.bottom||innerHeight);
  });
  if(anchor){position.anchor=anchor.dataset.readingAnchor;position.anchorTop=Math.round(anchor.getBoundingClientRect().top);}
  saveReportPosition(storage(),storageKey,{active:activeRef.current,seen:seenRef.current,panels:{[activeRef.current]:position}});
 }
 useEffect(()=>{
  canSave.current=false;
  const saved=readReportPosition(storage(),storageKey),explicit=items.some(part=>part.id===initialSection),valid=!explicit&&saved&&items.some(part=>part.id===saved.active),next=explicit?initialSection!:valid?saved.active:items[0].id;
  const nextSeen=valid?[...new Set([items[0].id,...saved.seen.filter(value=>items.some(part=>part.id===value)),next])]:[...new Set([items[0].id,next])];
  activeRef.current=next;seenRef.current=nextSeen;setActive(next);setSeen(nextSeen);
  if(valid&&saved.panels[next])setRestore({section:next,position:saved.panels[next],focus:false});
  else {setRestore(null);canSave.current=true;}
 },[storageKey,initialSection]);
 useEffect(()=>{
  if(!restore)return;
  canSave.current=false;let cancelled=false,frame=0;const timers:ReturnType<typeof setTimeout>[]=[];
  const finish=()=>{cancelled=true;canSave.current=true;};
  const interrupt=()=>finish();
  const attempt=(last=false)=>{
   if(cancelled||!root.current)return;
   const selector=restore.position.anchor?'[data-reading-anchor="'+restore.position.anchor+'"]':"";
   const anchor=selector?root.current.querySelector<HTMLElement>('[data-reading-section="'+restore.section+'"] '+selector):null;
   const y=anchor&&restore.position.anchorTop!==undefined?scrollY+anchor.getBoundingClientRect().top-restore.position.anchorTop:scrollY+root.current.getBoundingClientRect().top+restore.position.offset;
   window.scrollTo({top:Math.max(0,y),behavior:"instant"});
   if(last||document.documentElement.scrollHeight-innerHeight>=y-2){
    if(restore.focus)document.getElementById(id+"-tab-"+restore.section)?.focus({preventScroll:true});
    finish();
   }
  };
  // Give the selected sentence and panel two frames to lay out, then restore once.
  // A short bounded retry only handles content shorter than the saved position.
  frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{attempt();if(!cancelled)for(const delay of [120,350,750])timers.push(setTimeout(()=>attempt(delay===750),delay));});});
  for(const event of ["wheel","touchstart","pointerdown","keydown"])window.addEventListener(event,interrupt,{passive:true,once:true});
  return()=>{cancelled=true;cancelAnimationFrame(frame);timers.forEach(clearTimeout);for(const event of ["wheel","touchstart","pointerdown","keydown"])window.removeEventListener(event,interrupt);};
 },[restore]);
 useEffect(()=>{
  if(!storageKey)return;let frame=0;
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;snapshot();});};
  const save=()=>snapshot();
  window.addEventListener("scroll",schedule,{passive:true});window.addEventListener("pagehide",save);
  return()=>{window.removeEventListener("scroll",schedule);window.removeEventListener("pagehide",save);cancelAnimationFrame(frame);snapshot();};
 },[storageKey]);
 const index=Math.max(0,items.findIndex(item=>item.id===active)),item=items[index];
 function choose(next:number,focusTab=false){
  const target=items[next];if(!target||target.id===activeRef.current)return;
  snapshot();const targetPosition=readReportPosition(storage(),storageKey)?.panels[target.id];
  const top=root.current?.getBoundingClientRect().top||0;
  const nextSeen=seenRef.current.includes(target.id)?seenRef.current:[...seenRef.current,target.id];
  activeRef.current=target.id;seenRef.current=nextSeen;setActive(target.id);setSeen(nextSeen);
  saveReportPosition(storage(),storageKey,{active:target.id,seen:nextSeen});
  if(targetPosition||top<0)setRestore({section:target.id,position:targetPosition||{offset:0},focus:focusTab});
  else {canSave.current=true;if(focusTab)requestAnimationFrame(()=>document.getElementById(id+"-tab-"+target.id)?.focus({preventScroll:true}));}
 }
 return <div ref={root} id="report-detail-action" className={styles.reader} data-report-reader data-tone={item.tone}>
  <div className={styles.navigation}>
   <div role="tablist" aria-label="报告阅读顺序" className={styles.tabs} style={{gridTemplateColumns:`repeat(${items.length},minmax(0,1fr))`}}>{items.map((part,n)=>{const Icon=iconFor(part.id);return <button type="button" role="tab" key={part.id} id={`${id}-tab-${part.id}`} aria-controls={`${id}-panel-${part.id}`} aria-selected={active===part.id} tabIndex={active===part.id?0:-1} data-tone={part.tone} onClick={()=>choose(n)} onKeyDown={event=>{if(!["ArrowRight","ArrowLeft","Home","End"].includes(event.key))return;event.preventDefault();choose(event.key==="Home"?0:event.key==="End"?items.length-1:(n+(event.key==="ArrowRight"?1:-1)+items.length)%items.length,true);}}><Icon size={20}/><span>{part.label}</span><small>{seen.includes(part.id)&&active!==part.id?<Check size={13}/>:String(n+1).padStart(2,"0")}</small></button>})}</div>
  </div>
  {items.map((part,n)=>seen.includes(part.id)&&<section key={part.id} hidden={part.id!==active} role="tabpanel" id={`${id}-panel-${part.id}`} aria-labelledby={`${id}-tab-${part.id}`} tabIndex={0} className={styles.panel} data-reading-section={part.id}>
   {children(part.id)}
  </section>)}
  <footer className={styles.pager}><button type="button" disabled={index===0} onClick={()=>choose(index-1,true)}><ArrowLeft size={16}/>上一部分</button><span className={styles.pageDots} aria-label={`第 ${index+1} 部分，共 ${items.length} 部分`}>{items.map((part,n)=><i key={part.id} data-current={n===index} aria-hidden="true"/>)}</span>{index<items.length-1?<button type="button" className={styles.nextPage} onClick={()=>choose(index+1,true)}>{items[index+1].label}<ArrowRight size={16}/></button>:<span className={styles.finished}><Check size={16}/>{seen.length===items.length?"已看完报告":"已到最后一部分"}</span>}</footer>
 </div>;
}
