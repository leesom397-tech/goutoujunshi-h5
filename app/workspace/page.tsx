"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, ScanLine, ScanFace, MessageCircle, AudioLines, Users, UserRound, BookOpen, FileInput, Sparkles, ShieldCheck, Orbit, Fingerprint, Layers3 } from "lucide-react";
import { ProductHome } from "@/components/ProductHome";
import { WebNav } from "@/components/WebNav";

import { PhoneRegisterForm } from "@/components/PhoneRegisterForm";
import { uploadStore } from "@/components/web-analysis/uploads";
import "./workspace.css";
import styles from "./Workspace.module.css";
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
  const beginOwn = (href: string) => { if (loading || error) return; destination.current = href; setShowRegister(true); };
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
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const refresh = () => {
    if (document.hidden) return;
    const current = ++generation;
    setLoading(true);
    void fetch("/api/auth/session", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw Error("身份服务暂时无法连接。");
      const data = await response.json() as { loggedIn: boolean; user: {name: string; id: string} };
      if (disposed || current !== generation) return;
      setError("");
      if (!data.loggedIn) { setIdentity(null); setPendingTask(null); }
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
    }).catch(cause => { if (!disposed && current === generation) { setIdentity(null); setPendingTask(null); setError(cause.message); } }).finally(() => { if (!disposed && current === generation) setLoading(false); });
    };
    refresh(); window.addEventListener("focus", refresh);
    return () => { disposed = true; generation++; window.removeEventListener("focus", refresh); };
  }, []);
  return <main className={styles.shell}><WebNav/><div className={styles.wrap}>
    <div className="workspace-welcome"><span><i/> 陪你理清关系</span><a href="/account"><UserRound size={14}/>{loading ? "正在确认账号" : identity ? identity.name : "你的私人关系空间"}<ArrowUpRight size={14}/></a></div>
    {pendingTask && <a className="workspace-resume" href={`/analyze?mode=${pendingTask.mode}`}><span><b>接着上次</b><small>{pendingTask.mode === "chat" ? "聊天截图" : pendingTask.mode === "moments" ? "朋友圈" : "社交资料"} · {pendingTask.count} 张图片的任务已保留</small></span><span>继续查看 <ArrowUpRight size={16}/></span></a>}
    <ProductHome loading={loading} error={error} onRetry={()=>window.dispatchEvent(new Event("focus"))} signedIn={!!identity} onStart={href => { if (loading || error) return; if (identity) window.location.assign(href); else beginOwn(href); }}/>
  </div>{showRegister && <div className="workspace-gate-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowRegister(false); }}>
    <section className="workspace-gate" role="dialog" aria-modal="true" aria-labelledby="workspace-gate-context">
      <button className="workspace-gate-close" type="button" aria-label="关闭注册弹窗" onClick={() => setShowRegister(false)}>×</button>
      <div className="workspace-gate-preview"><span className="workspace-kicker">成子 · 关系决策智能体</span><h2 id="workspace-gate-title">把关系里的线索，<br/><em>变成下一步。</em></h2><p>就在这里创建账户，继续探索你的关系空间。</p>
        <div className="workspace-gate-features"><span><ScanLine size={18}/>聊天截图 · 语气与意图</span><span><ScanFace size={18}/>朋友圈 · 社交资料分析</span><span><MessageCircle size={18}/>长期人物档案与关系趋势</span><span><AudioLines size={18}/>实时语音军师</span></div>
        <small>分析前会显示积分费用，资料由你掌控。</small>
      </div>
      <div className="workspace-gate-form"><p id="workspace-gate-context" className="gate-context">登录后继续 · {destination.current.includes("mode=moments") ? "朋友圈分析" : destination.current.includes("mode=social") ? "社交主页" : destination.current.startsWith("/analyze") ? "聊天分析" : destination.current.startsWith("/voice") ? "语音交流" : destination.current.startsWith("/archive") ? "人物与资料" : destination.current.startsWith("/reports") ? "历史报告" : destination.current.startsWith("/import") ? "导入聊天" : "文字军师"}</p><PhoneRegisterForm compact returnTo={destination.current} onSuccess={() => window.location.assign(destination.current)}/></div>
    </section>
  </div>}<footer className="web-footer"><span>成子 · 陪你看懂关系</span><div><a href="/privacy">数据与隐私</a><a href="/account#contact">联系客服</a><a href="/sales">服务介绍</a></div></footer></main>;
}


