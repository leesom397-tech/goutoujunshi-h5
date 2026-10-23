"use client";
import {createContext,useContext,useEffect,useLayoutEffect,useId,useRef,useState,type AnchorHTMLAttributes,type ReactNode} from "react";
import styles from "./ReportReader.module.css";
import {readReportPosition,saveReportPosition,type ReportPanelPosition} from "@/lib/report-reading-position";

export type ReadingSection={id:string;label:string;caption:string;tone:"coral"|"amber"|"teal"|"slate"};
const ReadingContext=createContext<{href:(section:string)=>string;jump:(section:string)=>void}|null>(null);

/** The nearest reader owns the target, including a free example inside a dialog. */
export function ReportSectionLink({section,children,onClick,...props}:Omit<AnchorHTMLAttributes<HTMLAnchorElement>,"href">&{section:string;children:ReactNode}){
 const reader=useContext(ReadingContext);
 return <a {...props} href={reader?.href(section)||`#report-section-${section}`} onClick={event=>{onClick?.(event);if(!event.defaultPrevented&&reader&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0){event.preventDefault();reader.jump(section);}}}>{children}</a>;
}

export function ReportReader({items,children,storageKey,initialSection,embedded=false}:{items:ReadingSection[];children:(section:string)=>ReactNode;storageKey?:string;initialSection?:string;embedded?:boolean}){
 const instance=useId().replace(/[^a-zA-Z0-9_-]/g,""),prefix=embedded?`report-example-${instance}`:"report-section";
 const root=useRef<HTMLDivElement>(null),navigation=useRef<HTMLElement>(null),[active,setActive]=useState(items[0].id);
 const activeRef=useRef(active),ready=useRef(false),itemsRef=useRef(items);itemsRef.current=items;
 function storage(){try{return window.localStorage;}catch{return undefined;}}
 const element=(section:string)=>root.current?.querySelector<HTMLElement>(`[data-reading-section="${section}"]`);
 function selected(){
  const threshold=(navigation.current?.getBoundingClientRect().bottom||0)+28;
  let current=itemsRef.current[0].id;
  for(const item of itemsRef.current){const panel=element(item.id);if(panel&&panel.getBoundingClientRect().top<=threshold)current=item.id;}
  return current;
 }
 function writeFragment(section:string){
  if(embedded||!root.current||root.current.closest('dialog'))return;
  const hash=`#report-section-${section}`;
  if(location.hash!==hash)history.replaceState(history.state,"",location.pathname+location.search+hash);
 }
 function snapshot(persist=true){
  if(!ready.current||!root.current)return;
  const section=selected(),panel=element(section);if(!panel)return;
  activeRef.current=section;setActive(previous=>previous===section?previous:section);writeFragment(section);
  if(!persist||!storageKey)return;
  const position:ReportPanelPosition={offset:Math.round(-panel.getBoundingClientRect().top)};
  const header=navigation.current?.getBoundingClientRect().bottom||0;
  const anchor=Array.from(panel.querySelectorAll<HTMLElement>('[data-reading-anchor]')).find(node=>{const r=node.getBoundingClientRect();return r.bottom>header&&r.top<innerHeight;});
  if(anchor){position.anchor=anchor.dataset.readingAnchor;position.anchorTop=Math.round(anchor.getBoundingClientRect().top);}
  const openDetails:string[]=[];
  for(const item of itemsRef.current)element(item.id)?.querySelectorAll('details').forEach((detail,n)=>{if(detail.open)openDetails.push(`${item.id}:${n}`);});
  saveReportPosition(storage(),storageKey,{active:section,seen:itemsRef.current.map(item=>item.id),layout:'continuous',openDetails,panels:{[section]:position}});
 }
 function jump(section:string){
  const panel=element(section);if(!panel)return;
  snapshot();panel.scrollIntoView({block:'start',behavior:'instant'});activeRef.current=section;setActive(section);writeFragment(section);
  panel.focus({preventScroll:true});snapshot();
 }
 useLayoutEffect(()=>{
  ready.current=false;
  const saved=readReportPosition(storage(),storageKey),hash=!embedded?location.hash.match(/^#report-section-([a-z]+)$/)?.[1]:undefined;
  const valid=(value:unknown):value is string=>typeof value==='string'&&itemsRef.current.some(item=>item.id===value);
  const requested=valid(hash)?hash:valid(initialSection)?initialSection:undefined;
  const next=requested||(valid(saved?.active)?saved!.active:itemsRef.current[0].id);
  activeRef.current=next;setActive(next);
  if(saved?.layout==='continuous')for(const key of saved.openDetails||[]){const [section,index]=key.split(':');const details=element(section)?.querySelectorAll('details');if(details?.[Number(index)])details[Number(index)].open=true;}
  const position=saved?.layout==='continuous'&&saved.active===next?saved.panels[next]:undefined;
  const mustRestore=!!requested||!!saved;
  let frame=0,cancelled=false;const timers:ReturnType<typeof setTimeout>[]=[];
  let resize:ResizeObserver|undefined;
  const finish=()=>{cancelled=true;ready.current=true;};
  const restore=(last=false)=>{
   if(cancelled)return;const panel=element(next);if(!panel)return finish();
   if(position){
    const anchor=position.anchor?panel.querySelector<HTMLElement>(`[data-reading-anchor="${position.anchor}"]`):null;
    const y=anchor&&position.anchorTop!==undefined?scrollY+anchor.getBoundingClientRect().top-position.anchorTop:scrollY+panel.getBoundingClientRect().top+position.offset;
    window.scrollTo({top:Math.max(0,y),behavior:'instant'});
    ready.current=true;if(last)finish();
   }else{panel.scrollIntoView({block:'start',behavior:'instant'});ready.current=true;if(last)finish();}
  };
  if(mustRestore){
   // Cached report data and selected lines are available on the first commit.
   // Restore before paint instead of flashing the top for two animation frames.
   restore();
   // Profile/feedback children can resolve immediately after the first commit.
   // Keep the same viewport anchor through those layout changes, stopping as
   // soon as the reader interacts and never fighting later manual scrolling.
   if(root.current&&typeof ResizeObserver!=='undefined'){resize=new ResizeObserver(()=>restore());resize.observe(root.current);}
   if(!cancelled)frame=requestAnimationFrame(()=>{restore();if(!cancelled)for(const delay of [120,350,750,1200])timers.push(setTimeout(()=>restore(delay===1200),delay));});
  }
  else ready.current=true;
  const interrupt=()=>finish();
  for(const event of ['wheel','touchstart','pointerdown','keydown'])window.addEventListener(event,interrupt,{passive:true,once:true});
  return()=>{cancelled=true;resize?.disconnect();cancelAnimationFrame(frame);timers.forEach(clearTimeout);for(const event of ['wheel','touchstart','pointerdown','keydown'])window.removeEventListener(event,interrupt);};
 },[storageKey,initialSection,embedded]);
 useEffect(()=>{
  let frame=0,timer:ReturnType<typeof setTimeout>|undefined;const scrollTarget=root.current?.closest('dialog')||window;
  const flush=()=>{if(timer)clearTimeout(timer);timer=undefined;snapshot();};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;snapshot(false);});if(timer)clearTimeout(timer);timer=setTimeout(flush,220);};
  const onHash=()=>{const section=location.hash.match(/^#report-section-([a-z]+)$/)?.[1];if(!embedded&&section&&element(section))jump(section);};
  scrollTarget.addEventListener('scroll',schedule,{passive:true});window.addEventListener('pagehide',flush);window.addEventListener('chengzi:report-leaving',flush);window.addEventListener('hashchange',onHash);
  const node=root.current;node?.addEventListener('click',flush,true);
  return()=>{scrollTarget.removeEventListener('scroll',schedule);window.removeEventListener('pagehide',flush);window.removeEventListener('chengzi:report-leaving',flush);window.removeEventListener('hashchange',onHash);node?.removeEventListener('click',flush,true);cancelAnimationFrame(frame);flush();};
 },[storageKey,embedded]);
 const item=items.find(part=>part.id===active)||items[0];
 return <ReadingContext.Provider value={{href:section=>`#${prefix}-${section}`,jump}}><div ref={root} id={embedded?undefined:"report-detail-action"} className={`${styles.reader} ${styles.continuous}`} data-report-reader data-tone={item.tone} data-embedded={embedded||undefined}>
  <nav ref={navigation} className={styles.navigation} aria-label="报告目录"><div className={styles.directory} style={{gridTemplateColumns:`repeat(${items.length},minmax(0,1fr))`}}>{items.map(part=><ReportSectionLink key={part.id} section={part.id} data-report-section-link={part.id} aria-current={active===part.id?'location':undefined}>{part.label}</ReportSectionLink>)}</div></nav>
  {items.map((part,n)=><section key={part.id} id={`${prefix}-${part.id}`} aria-labelledby={`${prefix}-${part.id}-heading`} tabIndex={-1} className={styles.panel} data-reading-section={part.id} data-tone={part.tone}>
   <header className={styles.chapterHeading}><span aria-hidden="true">{String(n+1).padStart(2,'0')}</span><h2 id={`${prefix}-${part.id}-heading`}>{part.label}</h2></header>
   {children(part.id)}
  </section>)}
 </div></ReadingContext.Provider>;
}
