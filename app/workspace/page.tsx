"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, UserRound } from "lucide-react";
import { ProductHome } from "@/components/ProductHome";
import { WebNav } from "@/components/WebNav";

import { AnalysisAuthGate } from "@/components/AnalysisAuthGate";
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
    <div className="workspace-welcome"><span><i/> 陪你理清关系</span><a href="/account" aria-busy={loading}><UserRound size={14}/><span className={styles.accountLabel}>{identity ? identity.name : "我的账户"}</span><ArrowUpRight size={14}/></a></div>
    {pendingTask && <a className="workspace-resume" href={`/analyze?mode=${pendingTask.mode}`}><span><b>接着上次</b><small>{pendingTask.mode === "chat" ? "聊天截图" : pendingTask.mode === "moments" ? "朋友圈" : "社交资料"} · {pendingTask.count} 张图片的任务已保留</small></span><span>继续查看 <ArrowUpRight size={16}/></span></a>}
    <ProductHome loading={loading} error={error} onRetry={()=>window.dispatchEvent(new Event("focus"))} signedIn={!!identity} onStart={href => { if (href.startsWith("/analyze?")) { window.location.assign(href); return; } if (loading || error) return; if (identity) window.location.assign(href); else beginOwn(href); }}/>
  </div><AnalysisAuthGate open={showAuth} onClose={() => setShowAuth(false)} returnTo={destination.current} contextLabel={destination.current.startsWith("/voice") ? "语音交流" : destination.current.startsWith("/archive") ? "人物与资料" : destination.current.startsWith("/reports") ? "历史报告" : destination.current.startsWith("/import") ? "导入聊天" : "文字军师"}/><footer className="web-footer"><span>成子 · 陪你看懂关系</span><div><a href="/privacy">数据与隐私</a><a href="/account#contact">联系客服</a><a href="/sales">服务介绍</a></div></footer></main>;
}


