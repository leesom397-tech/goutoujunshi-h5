"use client";
import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { QuickSearch } from "@/components/QuickSearch";
import { PageBreadcrumb } from "./PageBreadcrumb";
import { webAccountStore } from "@/lib/web-account-session";
import { House, ScanLine, MessageCircle, Users, CircleUserRound, History, Download } from "lucide-react";
import styles from "./WebNav.module.css";
import { RELATIONSHIP_ANALYSIS_LABEL } from "@/lib/product-labels";
const links = [
  { href: "/workspace", label: "首页", icon: House },
  { href: "/chat", label: "问成子", icon: MessageCircle },
  { href: "/archive", label: "人物", icon: Users },
  { href: "/reports", label: "记录", icon: History },
  { href: "/support", label: "下载", icon: Download },
];
export function WebNav({guideReady=false,backHref,backLabel,reportReturn=false}:{guideReady?:boolean;backHref?:string;backLabel?:string;reportReturn?:boolean}={}) {
  const pathname=usePathname();
  // Observe existing account state without starting requests on public pages.
  const account = useSyncExternalStore(webAccountStore.subscribe, webAccountStore.getSnapshot, webAccountStore.getServerSnapshot);
  const connectionIssue = !!(account.error || account.refreshError);
  const accountState = account.unauthorized ? "signed-out" : connectionIssue ? "connection-error" : account.account ? "ready" : "pending";
  const accountLabel = account.unauthorized ? "我的账户与积分：尚未登录" : connectionIssue ? "我的账户与积分：连接暂时中断，点击查看并重试" : "我的账户与积分";
  const active = pathname.startsWith("/report") ? "/reports" : pathname === "/voice" ? "/chat" : pathname === "/person-new" ? "/archive" : pathname.startsWith("/admin/") ? "/account" : pathname === "/capture" || pathname === "/relationship" ? "/relationship" : pathname;
  return <><header className={`web-nav ${styles.nav}`}><a className="web-brand" href="/workspace"><span><BrandMark/></span><div>成子<small>陪你看懂关系</small></div></a><nav aria-label="主导航">{links.map(({href,label,icon:Icon})=><a key={href} href={href} title={href === "/reports" ? "分析记录" : href === "/support" ? "帮助与下载" : label} aria-label={href === "/reports" ? "分析记录" : href === "/support" ? "帮助与下载" : undefined} aria-current={active===href?"page":undefined}><Icon size={18} strokeWidth={1.7}/><span>{label}</span></a>)}</nav><div className="web-nav-tools"><QuickSearch/><a className={styles.analyzeAction} href="/relationship" aria-current={active === "/relationship" ? "page" : undefined}><ScanLine size={17}/><span>{RELATIONSHIP_ANALYSIS_LABEL}</span></a><a className={styles.accountAction} href="/account" aria-label={accountLabel} title={accountLabel} data-account-state={accountState} aria-current={active === "/account" ? "page" : undefined}><CircleUserRound size={23}/>{connectionIssue && <span className={styles.accountStatus} aria-hidden="true"/>}</a></div></header><PageBreadcrumb guideReady={guideReady} backHref={backHref} backLabel={backLabel} reportReturn={reportReturn}/></>;
}
export default WebNav;
