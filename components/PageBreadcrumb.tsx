"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, CircleHelp } from "lucide-react";
import { pageBackLink, pageTitles } from "@/lib/page-navigation";
import { TOUR_EVENT } from "./FirstUseTour";
import styles from "./PageBreadcrumb.module.css";

export function PageBreadcrumb({backHref,backLabel,reportReturn=false,guideReady=false}:{backHref?:string;backLabel?:string;reportReturn?:boolean;guideReady?:boolean}){
  const pathname=usePathname(),search=useSearchParams();
  if(pathname==="/workspace"||pathname==="/"||!pageTitles[pathname])return null;
  const back=pageBackLink(pathname,search.toString(),backHref);
  const title=pathname==="/analyze"?(search.get("focus")==="affinity"?"好感探测器":search.get("mode")==="moments"?"朋友圈分析":search.get("mode")==="social"?"社交主页":"聊天解读"):pageTitles[pathname];
  return <nav className={`page-trail ${styles.trail}`} data-page-navigation aria-label="页面返回导航">
    <a href={back.href} data-page-back data-report-return={reportReturn?true:undefined} className={styles.back}><ArrowLeft size={20}/><span>{backLabel||back.label}</span></a>
    <span className={styles.current} aria-current="page">{title}</span>
    {["/capture","/analyze"].includes(pathname)&&<button type="button" className={styles.help} disabled={!guideReady} aria-label="重看本页操作引导" onClick={()=>window.dispatchEvent(new CustomEvent(TOUR_EVENT,{detail:{page:pathname.slice(1)}}))}><CircleHelp size={19}/><span>帮助</span></button>}
  </nav>;
}
