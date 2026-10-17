"use client";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { QuickSearch } from "@/components/QuickSearch";
import {TOUR_EVENT} from "./FirstUseTour";
import { House, ScanLine, MessageCircle, Users, CircleUserRound, ArrowLeft, ChevronRight, History, CircleHelp } from "lucide-react";
import styles from "./WebNav.module.css";
const links = [
  { href: "/workspace", label: "首页", icon: House },
  { href: "/chat", label: "问成子", icon: MessageCircle },
  { href: "/archive", label: "人物", icon: Users },
  { href: "/reports", label: "历史", icon: History },
];
export function WebNav({guideReady=false}:{guideReady?:boolean}={}) {
  const pathname=usePathname();
  const active = pathname.startsWith("/report") ? "/reports" : pathname === "/voice" ? "/chat" : pathname === "/person-new" ? "/archive" : pathname.startsWith("/admin/") ? "/account" : pathname === "/capture" ? "/analyze" : pathname;
  const section = pathname.startsWith("/report") ? {href:"/reports",label:"历史报告"} : pathname === "/person-new" ? {href:"/archive",label:"人物档案"} : pathname === "/voice" ? {href:"/chat",label:"问成子"} : {href:"/workspace",label:"首页"};
  const titles:Record<string,string> = {"/capture":"微信材料采集","/analyze":"材料分析","/chat":"问成子","/voice":"语音交流","/archive":"人物档案","/account":"账户与积分","/library":"资料库","/reports":"历史报告","/report":"分析报告","/person-new":"新建人物","/import":"导入聊天","/admin/credits":"会员管理"};
  return <><header className={`web-nav ${styles.nav}`}><a className="web-brand" href="/workspace"><span><BrandMark/></span><div>成子<small>陪你看懂关系</small></div></a><nav aria-label="主导航">{links.map(({href,label,icon:Icon})=><a key={href} href={href} title={href === "/reports" ? "历史报告" : label} aria-label={href === "/reports" ? "历史报告" : undefined} aria-current={active===href?"page":undefined}><Icon size={18} strokeWidth={1.7}/><span>{label}</span></a>)}</nav><div className="web-nav-tools"><QuickSearch/><a className={styles.analyzeAction} href="/analyze" aria-current={active === "/analyze" ? "page" : undefined}><ScanLine size={17}/><span>完整分析</span></a><a className={styles.accountAction} href="/account" aria-label="我的账户与积分" title="我的账户与积分" aria-current={active === "/account" ? "page" : undefined}><CircleUserRound size={23}/></a></div></header>{pathname !== "/workspace" && pathname !== "/" && titles[pathname] && <nav className="page-trail" aria-label="当前位置"><a href={section.href === pathname ? "/workspace" : section.href}><ArrowLeft size={14}/>{section.href === pathname ? "首页" : section.label}</a><ChevronRight size={12}/><span aria-current="page">{titles[pathname]}</span>{["/capture","/analyze"].includes(pathname)&&<button type="button" className={styles.tourHelp} disabled={!guideReady} aria-label="重看本页操作引导" onClick={()=>window.dispatchEvent(new CustomEvent(TOUR_EVENT,{detail:{page:pathname.slice(1)}}))}><CircleHelp size={17}/><span>操作帮助</span></button>}</nav>}</>;
}
export default WebNav;

