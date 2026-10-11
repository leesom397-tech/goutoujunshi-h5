"use client";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { ArrowRight, ArrowUpRight, ScanLine, ScanFace, MessageCircle, AudioLines, Users, UserRound, BookOpen, FileInput, Sparkles, ShieldCheck, Orbit, Fingerprint, Layers3 } from "lucide-react";
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
  return <main className="workspace-page" onClickCapture={gateWorkspaceLinks}><WebNav/><div className="workspace-wrap">
    <div className="workspace-welcome"><span><i/> 陪你理清关系</span><a href="/account"><UserRound size={14}/>{loading ? "正在确认账号" : identity ? identity.name : "你的私人关系空间"}<ArrowUpRight size={14}/></a></div>
    {pendingTask && <a className="workspace-resume" href={`/analyze?mode=${pendingTask.mode}`}><span><b>接着上次</b><small>{pendingTask.mode === "chat" ? "聊天截图" : pendingTask.mode === "moments" ? "朋友圈" : "社交资料"} · {pendingTask.count} 张图片的任务已保留</small></span><span>继续查看 <ArrowUpRight size={16}/></span></a>}
    {identity ? <WorkspaceDashboard name={identity.name} owner={identity.id} balance={balance} active={active} admin={admin}/> : <><section className="workspace-hero" onPointerMove={event=>{if(event.pointerType!=="mouse")return;const rect=event.currentTarget.getBoundingClientRect();event.currentTarget.style.setProperty("--mx",((event.clientX-rect.left)/rect.width*100)+"%");event.currentTarget.style.setProperty("--my",((event.clientY-rect.top)/rect.height*100)+"%");}}>
      <div className="workspace-hero-copy"><span className="workspace-kicker"><Sparkles size={13}/> 成子 · 陪你看懂关系</span><h1>看懂关系。<br/><span>也照顾你的感受。</span></h1><p>从一句聊天，到一段关系。<br/>那些没说清的在意，我们一起慢慢理清。</p>
        <div className="workspace-identity">{loading ? <span className="workspace-loading" role="status">正在准备你的空间…</span> : identity ? <><a className="workspace-cta" href="/analyze?mode=chat">开始分析 <ArrowUpRight size={18}/></a><a className="workspace-text-link" href="/account">{balance===null ? "账户与积分" : balance+" 可用积分"}<ArrowRight size={14}/></a></> : <><button className="workspace-cta" type="button" onClick={() => preview()}>免费体验示例 <ArrowUpRight size={18}/></button><a className="workspace-text-link" href="/login">已有账号，登录 <ArrowRight size={14}/></a></>}</div>
        <p className="workspace-creator"><strong>成子</strong><span>心理学硕士 · 全网百万粉丝</span></p>
        <div className="workspace-trust"><ShieldCheck size={14}/><span>只处理你提供的内容 · 资料由你掌控</span></div>{error&&<p className="workspace-error" role="alert">{error}</p>}
      </div>
      <div className="workspace-visual feature-deck" aria-label="从这里开始">
        <a href="/analyze?mode=chat" onClick={openFeature} className="feature-deck-card deck-chat"><span className="deck-top"><ScanLine size={24}/><span>01 · 聊天分析</span><ArrowUpRight size={20}/></span><h2>这句话，<br/>到底什么意思？</h2><p>语气 · 意图 · 好感信号</p><span className="deck-bubble">“记得你说今天有面试，怎么样？”</span><span className="deck-foot">打开分析案例 <ArrowRight size={18}/></span></a>
        <a href="/analyze?mode=moments" onClick={openFeature} className="feature-deck-card deck-social"><span className="deck-top"><ScanFace size={23}/><span>02 · 社交资料</span><ArrowUpRight size={20}/></span><h2>动态背后，<br/>看见一个人。</h2><p>朋友圈 · 社交主页 · 相处线索</p><span className="deck-foot">看看能读出什么 <ArrowRight size={18}/></span></a>
      </div>
    </section>
    <div className="workspace-capability-strip"><span><ScanLine size={15}/> 多模态分析</span><i/><span><Layers3 size={15}/> 长期关系记忆</span><i/><span><AudioLines size={15}/> 实时语音</span><i/><a href="/privacy"><Fingerprint size={15}/> 由你掌控的数据</a></div>

    <section className="workspace-tools"><div className="workspace-section-heading"><div><span className="workspace-kicker">选择适合你的方式</span><h2>从这里，打开新的视角。</h2></div><p>先了解，再决定是否使用</p></div>
      <div className="workspace-entries">{entries.map(({href,title,text,detail,icon:Icon,accent,number},index)=><a href={href} key={href} className={"workspace-entry "+accent} style={{"--order":index} as CSSProperties} onClick={openFeature} onPointerMove={event=>{if(event.pointerType!=="mouse")return;const rect=event.currentTarget.getBoundingClientRect();event.currentTarget.style.setProperty("--cx",event.clientX-rect.left+"px");event.currentTarget.style.setProperty("--cy",event.clientY-rect.top+"px");}}><div className="workspace-entry-top"><div className={"workspace-entry-art art-"+number} aria-hidden="true"><span className="workspace-art-grid"/><span className="workspace-art-ring"/><span className="workspace-icon-tile"><Icon size={33} strokeWidth={1.4}/></span><i/><b/></div><span className="workspace-entry-number">{number}</span></div><small className="workspace-entry-detail">{detail}</small><h3>{title}</h3><p>{text}</p><span className="workspace-entry-go">开始探索 <ArrowUpRight size={17}/></span></a>)}</div>
    </section>
    <section className="workspace-bottom"><a className="workspace-people" href="/archive"><div className="workspace-people-copy"><span className="workspace-kicker">把每段关系接着了解</span><h2>每一次变化，<br/>都让你更了解彼此。</h2><p>人物档案 · 好感信号 · 适配分析 · 长期趋势</p><span className="workspace-entry-go">打开人物档案 <ArrowUpRight size={17}/></span></div><div className="workspace-people-art" aria-hidden="true"><div className="workspace-person-node one"><UserRound/></div><div className="workspace-person-node two"><Users/></div><div className="workspace-person-node three"><Orbit/></div><svg viewBox="0 0 220 180"><path d="M50 42 Q95 55 156 109 T191 48M50 42 Q55 140 156 109" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 6"/></svg><span className="workspace-network-ring"/></div></a>
      <div className="workspace-extras"><span className="workspace-extras-title">更完整的关系工具箱 <ArrowUpRight size={14}/></span><a href="/archive?tab=self"><span className="workspace-extra-icon"><UserRound size={19}/></span><span><b>先认识自己</b><small>我的资料与相处偏好</small></span><ArrowUpRight size={16}/></a><a href="/library"><span className="workspace-extra-icon"><BookOpen size={19}/></span><span><b>每个建议，都有依据</b><small>关系知识库与研究依据</small></span><ArrowUpRight size={16}/></a><a href="/history"><span className="workspace-extra-icon"><FileInput size={19}/></span><span><b>把长对话整理好</b><small>电脑端聊天记录导入</small></span><ArrowUpRight size={16}/></a></div>
    </section>
    <PublicReportExperience example={{ title: "从一句关心，到下一次见面。", question: "看一段聊天怎样走向判断、深层洞察与下一步。结论、图表和逐句解读都能回到原话核对。", analyzedAt: "2026 年 10 月 10 日", report: publicChatCase } as PublicAnalysisExample} onStart={mode => beginOwn(`/analyze?mode=${mode}`)}/>
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


