"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowRight, GitCompareArrows, UserRound, History, FileText } from "lucide-react";
import { ProductHome } from "@/components/ProductHome";
import { WebNav } from "@/components/WebNav";

import { AnalysisAuthGate } from "@/components/AnalysisAuthGate";
import { uploadStore } from "@/components/web-analysis/uploads";
import { clearIntakeDraftOwner } from "@/components/web-analysis/intake-drafts";
import "./workspace.css";
import styles from "./Workspace.module.css";
export default function Workspace() {
  const previousIdentity = useRef(""), previousOwner = useRef("");
  const [recent, setRecent] = useState<{sessionId:string; reports:{id:string;kind:string;label:string;summary:string;createdAt:number}[]}|null>(null);
  const [identity, setIdentity] = useState<{name: string; id: string} | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [admin, setAdmin] = useState(false);
  const [pendingTask, setPendingTask] = useState<{ mode: string; count: number } | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const destination = useRef("/workspace");
  const beginOwn = (href: string) => { if (loading || error) return; destination.current = href; setShowAuth(true); };
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
      const nextIdentity = data.loggedIn ? data.user.id : "";
      if (previousIdentity.current !== nextIdentity) { setRecent(null); setPendingTask(null); if (previousOwner.current) void clearIntakeDraftOwner(previousOwner.current).catch(()=>{}); previousOwner.current=""; }
      previousIdentity.current = nextIdentity;
      if (!data.loggedIn) { setIdentity(null); setPendingTask(null); setRecent(null); }
      if (data.loggedIn) {
        setIdentity(data.user);
        void fetch("/api/account/credits", { cache: "no-store" }).then(async r => {
          if (r.ok) {
            const credits = await r.json() as { account: { balance: number; userId: string; active: boolean }; admin?: boolean };
            if (disposed || current !== generation) return;
            previousOwner.current = credits.account.userId;
            setBalance(credits.account.balance);
            setActive(credits.account.active); setAdmin(!!credits.admin);
            const task = await uploadStore(credits.account.userId).catch(() => null);
            if (!disposed && current === generation) setPendingTask(task?.owner === credits.account.userId && task.expiresAt > Date.now() && ["chat", "moments", "social"].includes(task.mode) ? { mode: task.mode, count: task.files.length } : null);
            if (disposed || current !== generation) return;
            const response = await fetch('/api/web/report/list?page=1&pageSize=3',{cache:'no-store'});
            if (!response.ok) return;
            const saved = await response.json() as {reports?:any[]};
            if (!disposed && current === generation && Array.isArray(saved.reports)) setRecent({sessionId:data.user.id,reports:saved.reports.filter((report:any)=>typeof report?.id==='string' && /^[a-f0-9-]{36}$/i.test(report.id)).slice(0,3)});
          }
        }).catch(() => {});
      }
    }).catch(cause => { if (!disposed && current === generation) { setIdentity(null); setPendingTask(null); setRecent(null); setError(cause.message); } }).finally(() => { if (!disposed && current === generation) setLoading(false); });
    };
    refresh(); window.addEventListener("focus", refresh);
    return () => { disposed = true; generation++; window.removeEventListener("focus", refresh); };
  }, []);
  return <main className={styles.shell}><WebNav/><div className={styles.wrap}>
    <div className="workspace-welcome"><span><i/> 陪你理清关系</span><a href="/account" aria-busy={loading}><UserRound size={14}/><span className={styles.accountLabel}>{identity ? identity.name : "我的账户"}</span><ArrowUpRight size={14}/></a></div>
    {identity && <section className={styles.compareEntry} aria-labelledby="workspace-compare-title" data-workspace-compare><span className={styles.compareIcon} aria-hidden="true"><GitCompareArrows size={28} strokeWidth={1.6}/></span><div className={styles.compareCopy}><h2 id="workspace-compare-title">人物对照</h2><p>选 2–3 位人物，对照与你的共同点、相处差异和下一步。</p><span>已有资料一起看，缺什么也会告诉你</span></div><a className={styles.compareAction} href="/archive?compare=1">开始对照<ArrowRight size={19}/></a></section>}
    {pendingTask && <a className="workspace-resume" href={`/analyze?mode=${pendingTask.mode}`}><span><b>接着上次</b><small>{pendingTask.mode === "chat" ? "聊天截图" : pendingTask.mode === "moments" ? "朋友圈" : "社交资料"} · {pendingTask.count} 张图片的任务已保留</small></span><span>继续查看 <ArrowUpRight size={16}/></span></a>}
    {identity && recent?.sessionId === identity.id && recent.reports.length > 0 && <section className={styles.recent} aria-labelledby="workspace-recent-title"><header><h2 id="workspace-recent-title"><History size={22}/>接着看，报告一直都在</h2><a href="/reports">全部报告<ArrowRight size={16}/></a></header><div>{recent.reports.map(report=><a className={styles.recentItem} key={report.id} href={'/report?id='+encodeURIComponent(report.id)+'#report-detail-action'}><span><FileText size={18}/>{report.kind==='moments'?'朋友圈':report.kind==='social'?'社交主页':'聊天分析'}{report.createdAt>0&&<small>{new Date(report.createdAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</small>}</span><strong>{report.summary || '打开这次分析报告'}</strong><p>{report.label || '未关联人物'}<span>继续阅读<ArrowRight size={16}/></span></p></a>)}</div></section>}
    <ProductHome loading={loading} error={error} onRetry={()=>window.dispatchEvent(new Event("focus"))} signedIn={!!identity} onStart={href => { if (href.startsWith("/analyze?")) { window.location.assign(href); return; } if (loading || error) return; if (identity) window.location.assign(href); else beginOwn(href); }}/>
  </div><AnalysisAuthGate open={showAuth} onClose={() => setShowAuth(false)} returnTo={destination.current} contextLabel={destination.current.startsWith("/voice") ? "语音交流" : destination.current.startsWith("/archive") ? "人物与资料" : destination.current.startsWith("/reports") ? "历史报告" : destination.current.startsWith("/import") ? "导入聊天" : "文字军师"}/><footer className="web-footer"><span>成子 · 陪你看懂关系</span><div><a href="/privacy">数据与隐私</a><a href="/account#contact">联系客服</a><a href="/sales">服务介绍</a></div></footer></main>;
}


