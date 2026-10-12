"use client";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { QuickSearch } from "@/components/QuickSearch";
import { House, ScanLine, MessageCircle, Users, CircleUserRound, ArrowUpRight, ArrowLeft, ChevronRight, History } from "lucide-react";
import styles from "./WebNav.module.css";
const links = [
  { href: "/workspace", label: "工作台", icon: House },
  { href: "/analyze", label: "分析", icon: ScanLine },
  { href: "/reports", label: "历史", icon: History },
  { href: "/chat", label: "军师", icon: MessageCircle },
  { href: "/archive", label: "人物", icon: Users },
  { href: "/account", label: "账户", icon: CircleUserRound },
];
export function WebNav() {
  const pathname=usePathname();
  const active = pathname.startsWith("/report") ? "/reports" : pathname === "/voice" ? "/chat" : pathname === "/person-new" ? "/archive" : pathname.startsWith("/admin/") ? "/account" : pathname;
  const section = pathname.startsWith("/report") ? {href:"/reports",label:"历史报告"} : pathname === "/person-new" ? {href:"/archive",label:"人物档案"} : pathname === "/voice" ? {href:"/chat",label:"军师"} : {href:"/workspace",label:"工作台"};
  const titles:Record<string,string> = {"/analyze":"材料分析","/chat":"文字军师","/voice":"语音交流","/archive":"人物档案","/account":"账户与积分","/library":"资料库","/reports":"历史报告","/report":"分析报告","/person-new":"新建人物","/import":"导入聊天","/admin/credits":"会员管理"};
  return <><header className={`web-nav ${styles.nav}`}><a className="web-brand" href="/workspace"><span><BrandMark/></span><div>成子<small>陪你看懂关系</small></div></a><nav aria-label="主导航">{links.map(({href,label,icon:Icon})=><a key={href} href={href} title={href === "/reports" ? "历史报告" : label} aria-label={href === "/reports" ? "历史报告" : undefined} aria-current={active===href?"page":undefined}><Icon size={18} strokeWidth={1.7}/><span>{label}</span></a>)}</nav><div className="web-nav-tools"><QuickSearch/><a className="web-nav-contact" href="/account#contact">联系开通 <ArrowUpRight size={14}/></a></div></header>{pathname !== "/workspace" && pathname !== "/" && titles[pathname] && <nav className="page-trail" aria-label="当前位置"><a href={section.href === pathname ? "/workspace" : section.href}><ArrowLeft size={14}/>{section.href === pathname ? "工作台" : section.label}</a><ChevronRight size={12}/><span aria-current="page">{titles[pathname]}</span></nav>}</>;
}
export default WebNav;

