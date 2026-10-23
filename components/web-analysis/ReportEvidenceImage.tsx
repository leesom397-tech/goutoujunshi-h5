"use client";
import { useEffect, useRef, useState } from "react";
import { Expand, ImageOff } from "lucide-react";
import { useCaptureEvidenceContext } from "./CaptureEvidence";
import { readReportLibrarySources } from "./ReportSourceLibrary";
import styles from "./ReportEvidenceImage.module.css";

/** Load only the first verified preview of a cited source when it enters view. */
export function ReportEvidenceImage({libraryId,sourceId,label="查看画面依据"}:{libraryId?:string;sourceId?:string;label?:string}) {
  const context=useCaptureEvidenceContext(),owner=context?.ownerId;
  const root=useRef<HTMLDivElement>(null),[visibleKey,setVisibleKey]=useState(''),[retry,setRetry]=useState(0);
  const key=JSON.stringify([owner,libraryId,sourceId]),[image,setImage]=useState<{key:string;src:string;failed:boolean}|null>(null);
  const visible=visibleKey===key;
  useEffect(()=>{
    const node=root.current;if(!node)return;
    if(typeof IntersectionObserver==='undefined'){setVisibleKey(key);return;}
    const observer=new IntersectionObserver(([entry])=>{if(entry?.isIntersecting){setVisibleKey(key);observer.disconnect();}},{rootMargin:"180px"});
    observer.observe(node);return()=>observer.disconnect();
  },[key]);
  useEffect(()=>{
    if(!visible||!owner||!libraryId||!sourceId)return;
    let live=true;const controller=new AbortController();setImage(null);
    void readReportLibrarySources(owner,libraryId,[sourceId],controller.signal,true).then(value=>{
      const item=value.records[0]?.images?.[0];
      const src=item&&/^image\/(png|jpeg|webp)$/.test(item.mime)&&/^[A-Za-z0-9+/=\s]+$/.test(item.data)?`data:${item.mime};base64,${item.data}`:"";
      if(live)setImage({key,src,failed:!src});
    }).catch(()=>{if(live)setImage({key,src:"",failed:true});});
    return()=>{live=false;controller.abort();};
  },[visible,owner,libraryId,sourceId,key,retry]);
  if(!owner||!libraryId||!sourceId)return null;
  const current=image?.key===key?image:null;
  return <div className={styles.frame} ref={root} data-report-evidence-image>
    {current?.src?<button type="button" className={styles.picture} disabled={!context?.visible} onClick={event=>context?.open({libraryId,sourceIds:[sourceId],label},event.currentTarget)} aria-label={context?.visible?label:'这条判断引用的已同步图片，原文入口正在准备'}><img loading="lazy" src={current.src} alt="这条判断引用的已同步图片" onError={()=>setImage({key,src:'',failed:true})}/>{context?.visible&&<span><Expand size={15}/>{label}</span>}</button>:current?.failed?<button className={styles.retry} type="button" onClick={()=>setRetry(value=>value+1)}><ImageOff size={19}/>图片暂未载入，点此重试</button>:<div className={styles.loading} role="status">正在载入这条线索的画面</div>}
  </div>;
}
