"use client";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { QuickSearch } from "@/components/QuickSearch";
import { House, ScanLine, MessageCircle, Users, CircleUserRound, ArrowUpRight } from "lucide-react";
const links = [
  { href: "/workspace", label: "工作台", icon: House },
  { href: "/analyze", label: "分析", icon: ScanLine },
  { href: "/chat", label: "军师", icon: MessageCircle },
  { href: "/archive", label: "人物", icon: Users },
  { href: "/account", label: "账户", icon: CircleUserRound },
];
export function WebNav() {
  const pathname=usePathname();
  const active = pathname.startsWith("/report") ? "/analyze" : pathname === "/voice" ? "/chat" : pathname === "/person-new" ? "/archive" : pathname.startsWith("/admin/") ? "/account" : pathname;
  return <header className="web-nav"><a className="web-brand" href="/workspace"><span><BrandMark/></span><div>成子<small>陪你看懂关系</small></div></a><nav aria-label="主导航">{links.map(({href,label,icon:Icon})=><a key={href} href={href} aria-current={active===href?"page":undefined}><Icon size={18} strokeWidth={1.7}/><span>{label}</span></a>)}</nav><div className="web-nav-tools"><QuickSearch/><a className="web-nav-contact" href="/account#contact">联系开通 <ArrowUpRight size={14}/></a></div></header>;
}
export default WebNav;

