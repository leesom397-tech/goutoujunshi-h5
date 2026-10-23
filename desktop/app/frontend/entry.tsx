import { Component, Suspense, lazy, useEffect, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AuxiliaryWebNav } from "@/components/AuxiliaryWebNav";
import { MotionPolicy } from "@/components/MotionPolicy";
import { ReportSessionNavigation } from "@/components/web-analysis/ReportSessionNavigation";
import { installDesktopNavigation, navigate, useDesktopLocation } from "./navigation";
import "@/app/globals.css";
import "@/app/login.css";
import "@/app/positioning.css";
import "@/app/wechat.css";
import "@/app/knowledge.css";
import "@/app/crush.css";
import "@/app/quick.css";
import "@/app/decision.css";
import "@/app/miniapp.css";
import "@/app/history.css";
import "@/app/history-consistency.css";
import "@/app/web.css";
import "@/app/web-auxiliary.css";
import "@/app/product-redesign.css";
import "@/app/aurora-ui.css";
import "@/app/interaction-motion.css";
import "./local.css";
import "./desktop-theme.css";

const modules = import.meta.glob("../../../app/**/page.tsx") as Record<string, () => Promise<{ default: ComponentType }>>;
const pages = new Map(Object.entries(modules).map(([file, load]) => [file.replace("../../../app", "").replace(/\/page\.tsx$/, "") || "/", lazy(load)]));
pages.set("/support", lazy(() => import("./DesktopSupport")));
pages.set("/workspace", lazy(() => import("./DesktopWorkbench").then(module => ({default: module.DesktopHome}))));
const Reports = lazy(() => import("./DesktopWorkbench").then(module => ({default: module.DesktopReports})));
pages.set("/reports", Reports);
pages.set("/report", Reports);
pages.set("/capture", lazy(() => import("./DesktopWorkbench").then(module => ({default: module.DesktopCapture}))));
installDesktopNavigation(new Set(pages.keys()));

class RouteBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="desktop-route-message"><h1>这个页面暂时没有打开</h1><p>已保存的资料不受影响。</p><button onClick={() => location.reload()}>重新打开</button><a href="/workspace">返回工作台</a></main> : this.props.children; }
}
function HomeRedirect() { useEffect(() => navigate("/workspace", true), []); return null; }
function App() {
  const url = useDesktopLocation();
  const path = new URL(url, location.origin).pathname.replace(/\/$/, "") || "/";
  const Page = path === "/" ? HomeRedirect : pages.get(path);
  const routeKey = path === '/reports' || path === '/report' ? 'report-library' : path;
  return <><ReportSessionNavigation/><MotionPolicy/><AuxiliaryWebNav/><RouteBoundary key={routeKey}><Suspense fallback={<main className="desktop-route-message" role="status">正在打开…</main>}>{Page ? <Page key={routeKey === 'report-library' ? routeKey : path + new URL(url, location.origin).search}/> : <main className="desktop-route-message"><h1>页面不存在</h1><a href="/workspace">返回工作台</a></main>}</Suspense></RouteBoundary></>;
}
document.body.classList.add('cz-desktop');
createRoot(document.getElementById("root")!).render(<App/>);
