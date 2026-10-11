"use client";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { ArrowRight, ArrowUpRight, ScanLine, ScanFace, MessageCircle, AudioLines, Users, UserRound, BookOpen, FileInput, Sparkles, ShieldCheck, Orbit, Fingerprint, Layers3 } from "lucide-react";
import { PlayfulHome } from "@/components/PlayfulHome";
import { WebNav } from "@/components/WebNav";

import { PhoneRegisterForm } from "@/components/PhoneRegisterForm";
import { uploadStore } from "@/components/web-analysis/uploads";
import { WorkspaceDashboard } from "@/components/WorkspaceDashboard";
import { PublicReportExperience, type PublicAnalysisExample } from "@/components/PublicReportExperience";
import publicChatCase from "@/data/public-chat-case.json";
import "./workspace.css";
const entries = [
  { href: "/analyze?mode=chat", title: "读懂每一句话", text: "聊天截图、语气与意图，让模糊的信号变得清晰。", detail: "聊天分析", icon: ScanLine, accent: "cyan", number: "01" },
  { href: "/analyze?mode=social", title: "看见更完整的对方", text: "朋友圈、社交主页与照片，整理有依据的相处线索。", detail: "社交资料", icon: ScanFace, accent: "amber", number: "02" },
  { href: "/chat", title: "你的专属军师", text: "把困惑说出来，一起找到更有把握的下一步。", detail: "随时聊聊", icon: MessageCircle, accent: "silver", number: "03" },
  { href: "/voice", title: "让想法自然流动", text: "直接开口，带着你们的故事继续聊。", detail: "语音交流", icon: AudioLines, accent: "mint", number: "04" },
];
export default function Workspace() {
  const [identity, setIdentity] = useState<{name: string; id: string} | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [admin, setAdmin] = useState(false);
  const [pendingTask, setPendingTask] = useState<{ mode: string; count: number } | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const destination = useRef("/workspace");
  const preview = (href = "/analyze?mode=chat") => {
    window.dispatchEvent(new CustomEvent("public-case-select", { detail: new URL(href, window.location.origin).searchParams.get("mode") || "chat" }));
    window.setTimeout(() => { const section = document.getElementById("experience"); section?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }); section?.focus({ preventScroll: true }); }, 0);
  };
  const beginOwn = (href: string) => { destination.current = href; setShowRegister(true); };
  useEffect(() => {
    if (!showRegister) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const priorFocus = document.activeElement as HTMLElement | null;
    const focus = window.setTimeout(() => document.querySelector<HTMLInputElement>('.workspace-gate input[name="username"]')?.focus(), 40);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowRegister(false);
      if (event.key === "Tab") {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>('.workspace-gate a[href], .workspace-gate button:not(:disabled), .workspace-gate input:not(:disabled)')).filter(node => node.getClientRects().length);
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", escape);
    return () => { window.clearTimeout(focus); document.body.style.overflow = previous; window.removeEventListener("keydown", escape); priorFocus?.focus(); };
  }, [showRegister]);
  const openFeature = (event: MouseEvent<HTMLAnchorElement>) => {
    if (identity) return;
    event.preventDefault();
    const href = event.currentTarget.getAttribute("href") || "/workspace";
    if (href === "/register") beginOwn("/workspace"); else preview(href);
  };
  const gateWorkspaceLinks = (event: MouseEvent<HTMLElement>) => {
    if (identity || showRegister || (event.target as HTMLElement).closest('.workspace-gate')) return;
    const link = (event.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!link) return;
    // Main navigation must behave identically on every page, including for guests.
    if (link.closest('.web-nav')) return;
    const url = new URL(link.href, window.location.origin);
    if (url.origin !== window.location.origin || ['/privacy', '/sales', '/login', '/library'].includes(url.pathname) || url.pathname.startsWith('/examples/') || url.pathname === '/account' && url.hash === '#contact') return;
    if (url.pathname === "/workspace" && (!url.hash || url.hash === "#experience")) return;
    event.preventDefault();
    if (["/analyze", "/chat", "/voice", "/archive"].includes(url.pathname)) { event.stopPropagation(); preview(url.pathname + url.search); return; }
    destination.current = url.pathname === "/register" ? "/workspace" : url.pathname + url.search + url.hash;
    setShowRegister(true);
  };
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const refresh = () => {
    if (document.hidden) return;
    const current = ++generation;
    setIdentity(null); setBalance(null); setActive(null); setAdmin(false); setPendingTask(null); setLoading(true);
    void fetch("/api/auth/session", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw Error("身份服务暂时无法连接。");
      const data = await response.json() as { loggedIn: boolean; user: {name: string; id: string} };
      if (disposed || current !== generation) return;
      setError("");
      if (data.loggedIn) {
        setIdentity(data.user);
        void fetch("/api/account/credits", { cache: "no-store" }).then(async r => {
          if (r.ok) {
            const credits = await r.json() as { account: { balance: number; userId: string; active: boolean }; admin?: boolean };
            if (disposed || current !== generation) return;
            setBalance(credits.account.balance);
            setActive(credits.account.active); setAdmin(!!credits.admin);
            const task = await uploadStore(credits.account.userId).catch(() => null);
            if (!disposed && current === generation && task?.owner === credits.account.userId && ["chat", "moments", "social"].includes(task.mode)) setPendingTask({ mode: task.mode, count: task.files.length });
          }
        }).catch(() => {});
      }
    }).catch(cause => { if (!disposed && current === generation) setError(cause.message); }).finally(() => { if (!disposed && current === generation) setLoading(false); });
    };
    refresh(); window.addEventListener("focus", refresh);
    return () => { disposed = true; generation++; window.removeEventListener("focus", refresh); };
  }, []);
  return <main className="workspace-page"><WebNav/><div className="workspace-wrap">
    <div className="workspace-welcome"><span><i/> 陪你理清关系</span><a href="/account"><UserRound size={14}/>{loading ? "正在确认账号" : identity ? identity.name : "你的私人关系空间"}<ArrowUpRight size={14}/></a></div>
    {pendingTask && <a className="workspace-resume" href={`/analyze?mode=${pendingTask.mode}`}><span><b>接着上次</b><small>{pendingTask.mode === "chat" ? "聊天截图" : pendingTask.mode === "moments" ? "朋友圈" : "社交资料"} · {pendingTask.count} 张图片的任务已保留</small></span><span>继续查看 <ArrowUpRight size={16}/></span></a>}
    {identity ? <WorkspaceDashboard name={identity.name} owner={identity.id} balance={balance} active={active} admin={admin}/> : <><PlayfulHome onExample={preview} onStart={beginOwn}/><PublicReportExperience example={{ title: "从一句关心，到下一次见面。", question: "看一段聊天怎样走向判断、深层洞察与下一步。结论、图表和逐句解读都能回到原话核对。", analyzedAt: "2026 年 10 月 10 日", report: publicChatCase } as PublicAnalysisExample} onStart={mode => beginOwn(`/analyze?mode=${mode}`)}/>
    <div className="workspace-footnote"><ShieldCheck size={15}/><p>分析前显示积分费用。是否保存资料，始终由你决定。</p><a href="/privacy">了解数据使用 <ArrowRight size={13}/></a></div></>}
  </div>{showRegister && <div className="workspace-gate-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowRegister(false); }}>
    <section className="workspace-gate" role="dialog" aria-modal="true" aria-labelledby="workspace-gate-title">
      <button className="workspace-gate-close" type="button" aria-label="关闭注册弹窗" onClick={() => setShowRegister(false)}>×</button>
      <div className="workspace-gate-preview"><span className="workspace-kicker">成子 · 关系决策智能体</span><h2 id="workspace-gate-title">把关系里的线索，<br/><em>变成下一步。</em></h2><p>就在这里创建账户，继续探索你的关系空间。</p>
        <div className="workspace-gate-features"><span><ScanLine size={18}/>聊天截图 · 语气与意图</span><span><ScanFace size={18}/>朋友圈 · 社交资料分析</span><span><MessageCircle size={18}/>长期人物档案与关系趋势</span><span><AudioLines size={18}/>实时语音军师</span></div>
        <small>分析前会显示积分费用，资料由你掌控。</small>
      </div>
      <div className="workspace-gate-form"><PhoneRegisterForm compact returnTo={destination.current} onSuccess={() => window.location.assign(destination.current)}/></div>
    </section>
  </div>}<footer className="web-footer"><span>成子 · 陪你看懂关系</span><div><a href="/privacy">数据与隐私</a><a href="/account#contact">联系客服</a><a href="/sales">服务介绍</a></div></footer></main>;
}


