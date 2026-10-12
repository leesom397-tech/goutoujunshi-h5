"use client";
import {useId,useRef,useState,type ReactNode} from "react";
import {ArrowLeft,ArrowRight,Check,Compass,MessageCircle,ChartNoAxesCombined,Send,Quote,UserRound} from "lucide-react";
import styles from "./ReportReader.module.css";

export type ReadingSection={id:string;label:string;caption:string;tone:"coral"|"amber"|"teal"|"slate"};
const iconFor=(id:string)=>id==="tone"?MessageCircle:id==="signals"||id==="content"?ChartNoAxesCombined:id==="replies"||id==="next"?Send:id==="evidence"?Quote:id==="overview"?UserRound:Compass;

export function ReportReader({items,children}:{items:ReadingSection[];children:(active:string)=>ReactNode}){
 const id=useId(),root=useRef<HTMLDivElement>(null),[active,setActive]=useState(items[0].id),[seen,setSeen]=useState<string[]>([items[0].id]);
 const index=Math.max(0,items.findIndex(item=>item.id===active)),item=items[index];
 function choose(next:number,focusTab=false){
  const target=items[next];if(!target)return;
  setActive(target.id);setSeen(previous=>previous.includes(target.id)?previous:[...previous,target.id]);
  requestAnimationFrame(()=>{if(root.current && root.current.getBoundingClientRect().top<0)root.current.scrollIntoView({block:"start",behavior:"instant"});if(focusTab)document.getElementById(`${id}-tab-${target.id}`)?.focus({preventScroll:true});});
 }
 return <div ref={root} id="report-detail-action" className={styles.reader} data-report-reader data-tone={item.tone}>
  <div className={styles.navigation}>
   <div className={styles.position}><span>第 <b>{index+1}</b> / {items.length} 部分 · {item.label}</span><span>已查看 {seen.length} / {items.length}</span></div>
   <div className={styles.progress} aria-label={`已查看 ${seen.length} 个部分，共 ${items.length} 个`}>{items.map(part=><i key={part.id} data-seen={seen.includes(part.id)} data-active={active===part.id}/>)}</div>
   <div role="tablist" aria-label="报告阅读顺序" className={styles.tabs}>{items.map((part,n)=>{const Icon=iconFor(part.id);return <button type="button" role="tab" key={part.id} id={`${id}-tab-${part.id}`} aria-controls={`${id}-panel-${part.id}`} aria-selected={active===part.id} tabIndex={active===part.id?0:-1} data-tone={part.tone} onClick={()=>choose(n)} onKeyDown={event=>{if(!["ArrowRight","ArrowLeft","Home","End"].includes(event.key))return;event.preventDefault();choose(event.key==="Home"?0:event.key==="End"?items.length-1:(n+(event.key==="ArrowRight"?1:-1)+items.length)%items.length,true);}}><Icon size={20}/><span>{part.label}</span><small>{seen.includes(part.id)&&active!==part.id?<Check size={13}/>:String(n+1).padStart(2,"0")}</small></button>})}</div>
  </div>
  {items.map((part,n)=>seen.includes(part.id)&&<section key={part.id} hidden={part.id!==active} role="tabpanel" id={`${id}-panel-${part.id}`} aria-labelledby={`${id}-tab-${part.id}`} tabIndex={0} className={styles.panel}>
   <div className={styles.panelCaption}><span>{String(n+1).padStart(2,"0")}</span>{part.caption}</div>
   {children(part.id)}
  </section>)}
  <footer className={styles.pager}><button type="button" disabled={index===0} onClick={()=>choose(index-1,true)}><ArrowLeft size={17}/>上一部分</button><span>{index+1} / {items.length}</span>{index<items.length-1?<button type="button" onClick={()=>choose(index+1,true)}>下一部分 · {items[index+1].label}<ArrowRight size={17}/></button>:<span className={styles.finished}><Check size={17}/>{seen.length===items.length?"已查看全部部分":"已到最后一部分"}</span>}</footer>
 </div>;
}
