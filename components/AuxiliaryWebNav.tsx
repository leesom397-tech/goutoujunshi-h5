"use client";
import { usePathname } from "next/navigation";
import { WebNav } from "./WebNav";
const pages = new Set(["/history", "/import", "/positioning", "/profile", "/crush", "/quick", "/risk", "/wechat", "/miniapp/link", "/miniapp/manage", "/consult"]);
export function AuxiliaryWebNav() {
  const pathname = usePathname();
  return pages.has(pathname) ? <div className="auxiliary-web-nav"><WebNav/></div> : null;
}
