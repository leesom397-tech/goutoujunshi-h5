"use client";
import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { QuickSearch } from "@/components/QuickSearch";
import {TOUR_EVENT} from "./FirstUseTour";
import { webAccountStore } from "@/lib/web-account-session";
import { House, ScanLine, MessageCircle, Users, CircleUserRound, ArrowLeft, ChevronRight, History, CircleHelp, Download } from "lucide-react";
import styles from "./WebNav.module.css";
import { RELATIONSHIP_ANALYSIS_LABEL } from "@/lib/product-labels";
const links = [
  { href: "/workspace", label: "首页", icon: House },
  { href: "/chat", label: "问成子", icon: MessageCircle },
  { href: "/archive", label: "人物", icon: Users },
  { href: "/reports", label: "记录", icon: History },
  { href: "/support", label: "下载", icon: Download },
];
export function WebNav({guideReady=false}:{guideReady?:boolean}={}) {
  const pathname=usePathname();
  // Observe existing account state without starting requests on public pages.
  const account = useSyncExternalStore(webAccountStore.subscribe, webAccountStore.getSnapshot, webAccountStore.getServerSnapshot);
  const connectionIssue = !!(account.error || account.refreshError);
  const accountState = account.unauthorized ? "signed-out" : connectionIssue ? "connection-error" : account.account ? "ready" : "pending";
  const accountLabel = account.unauthorized ? "我的账户与积分：尚未登录" : connectionIssue ? "我的账户与积分：连接暂时中断，点击查看并重试" : "我的账户与积分";
  const active = pathname.startsWith("/report") ? "/reports" : pathname === "/voice" ? "/chat" : pathname === "/person-new" ? "/archive" : pathname.startsWith("/admin/") ? "/account" : pathname === "/capture" || pathname === "/relationship" ? "/relationship" : pathname;
  const section = pathname.startsWith("/report") ? {href:"/reports",label:"分析记录"} : pathname === "/person-new" ? {href:"/archive",label:"人物档案"} : pathname === "/voice" ? {href:"/chat",label:"问成子"} : {href:"/workspace",label:"首页"};
  const titles:Record<string,string> = {"/support":"帮助与下载","/relationship":RELATIONSHIP_ANALYSIS_LABEL,"/capture":"导入微信资料","/analyze":"截图分析","/chat":"问成子","/voice":"语音交流","/archive":"人物档案","/account":"账户与积分","/library":"资料库","/reports":"分析记录","/report":"分析报告","/person-new":"新建人物","/import":"导入聊天","/admin/credits":"会员管理"};
  return <><header className={`web-nav ${styles.nav}`}><a className="web-brand" href="/workspace"><span><BrandMark/></span><div>成子<small>陪你看懂关系</small></div></a><nav aria-label="主导航">{links.map(({href,label,icon:Icon})=><a key={href} href={href} title={href === "/reports" ? "分析记录" : href === "/support" ? "帮助与下载" : label} aria-label={href === "/reports" ? "分析记录" : href === "/support" ? "帮助与下载" : undefined} aria-current={active===href?"page":undefined}><Icon size={18} strokeWidth={1.7}/><span>{label}</span></a>)}</nav><div className="web-nav-tools"><QuickSearch/><a className={styles.analyzeAction} href="/relationship" aria-current={active === "/relationship" ? "page" : undefined}><ScanLine size={17}/><span>{RELATIONSHIP_ANALYSIS_LABEL}</span></a><a className={styles.accountAction} href="/account" aria-label={accountLabel} title={accountLabel} data-account-state={accountState} aria-current={active === "/account" ? "page" : undefined}><CircleUserRound size={23}/>{connectionIssue && <span className={styles.accountStatus} aria-hidden="true"/>}</a></div></header>{pathname !== "/workspace" && pathname !== "/" && titles[pathname] && <nav className="page-trail" aria-label="当前位置"><a href={section.href === pathname ? "/workspace" : section.href}><ArrowLeft size={14}/>{section.href === pathname ? "首页" : section.label}</a><ChevronRight size={12}/><span aria-current="page">{titles[pathname]}</span>{["/capture","/analyze"].includes(pathname)&&<button type="button" className={styles.tourHelp} disabled={!guideReady} aria-label="重看本页操作引导" onClick={()=>window.dispatchEvent(new CustomEvent(TOUR_EVENT,{detail:{page:pathname.slice(1)}}))}><CircleHelp size={17}/><span>操作帮助</span></button>}</nav>}</>;
}
export default WebNav;
