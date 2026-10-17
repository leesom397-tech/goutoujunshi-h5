"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { ProductHome } from "@/components/ProductHome";
import { WebNav } from "@/components/WebNav";

import { uploadStore } from "@/components/web-analysis/uploads";
import { clearIntakeDraftOwner } from "@/components/web-analysis/intake-drafts";
import "./workspace.css";
import styles from "./Workspace.module.css";
export default function Workspace() {
  const previousIdentity = useRef(""), previousOwner = useRef("");
  const [identity, setIdentity] = useState<{name: string; id: string} | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingTask, setPendingTask] = useState<{ mode: string; count: number } | null>(null);
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
      if (previousIdentity.current !== nextIdentity) { setPendingTask(null); if (previousOwner.current) void clearIntakeDraftOwner(previousOwner.current).catch(()=>{}); previousOwner.current=""; }
      previousIdentity.current = nextIdentity;
      if (!data.loggedIn) { setIdentity(null); setPendingTask(null); }
      if (data.loggedIn) {
        setIdentity(data.user);
        void fetch("/api/account/credits", { cache: "no-store" }).then(async r => {
          if (r.ok) {
            const credits = await r.json() as { account: { userId: string } };
            if (disposed || current !== generation) return;
            previousOwner.current = credits.account.userId;
            const task = await uploadStore(credits.account.userId).catch(() => null);
            if (!disposed && current === generation) setPendingTask(task?.owner === credits.account.userId && task.expiresAt > Date.now() && ["chat", "moments", "social"].includes(task.mode) ? { mode: task.mode, count: task.files.length } : null);
          }
        }).catch(() => {});
      }
    }).catch(cause => { if (!disposed && current === generation) { setIdentity(null); setPendingTask(null); setError(cause.message); } }).finally(() => { if (!disposed && current === generation) setLoading(false); });
    };
    refresh(); window.addEventListener("focus", refresh);
    return () => { disposed = true; generation++; window.removeEventListener("focus", refresh); };
  }, []);
  const continuation = <>
    {pendingTask && <a className="workspace-resume" href={`/analyze?mode=${pendingTask.mode}`}><span><b>接着上次</b><small>{pendingTask.mode === "chat" ? "聊天截图" : pendingTask.mode === "moments" ? "朋友圈" : "社交资料"} · {pendingTask.count} 张图片的任务已保留</small></span><span>继续查看 <ArrowUpRight size={16}/></span></a>}
  </>;
  return <main className={styles.shell}><WebNav/><div className={styles.wrap}>
    {identity && <div className={styles.welcome}><span>你好，{identity.name}</span><a href="/archive?tab=self">我的资料<ArrowUpRight size={14}/></a></div>}
    <ProductHome afterHero={continuation} loading={loading} error={error} onRetry={()=>window.dispatchEvent(new Event("focus"))} signedIn={!!identity} onStart={href => window.location.assign(href)}/>
  </div><footer className="web-footer"><span>成子 · 陪你看懂关系</span><div><a href="/privacy">数据与隐私</a><a href="/account#contact">联系客服</a><a href="/sales">服务介绍</a></div></footer></main>;
}


