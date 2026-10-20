"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { ProductHome } from "@/components/ProductHome";
import { WebNav } from "@/components/WebNav";

import { uploadStore } from "@/components/web-analysis/uploads";
import { clearIntakeDraftOwner } from "@/components/web-analysis/intake-drafts";
import "./workspace.css";
import styles from "./Workspace.module.css";
import { useAccount } from '@/components/web-analysis/client';
export default function Workspace() {
  const previousOwner = useRef("");
  const session = useAccount(), owner = session.account?.account?.userId || '';
  const [pendingTask, setPendingTask] = useState<{ mode: string; count: number } | null>(null);
  useEffect(() => {
    let disposed = false;
    if (previousOwner.current !== owner) {
      setPendingTask(null);
      if (previousOwner.current) void clearIntakeDraftOwner(previousOwner.current).catch(() => {});
      previousOwner.current = owner;
    }
    if (owner) void uploadStore(owner).then(task => {
      if (!disposed) setPendingTask(task && task.owner === owner && task.expiresAt > Date.now() && ['chat', 'moments', 'social'].includes(task.mode) ? { mode: task.mode, count: task.files.length } : null);
    }).catch(() => {});
    return () => { disposed = true; };
  }, [owner]);
  const continuation = <>
    {pendingTask && <a className="workspace-resume" href={`/analyze?mode=${pendingTask.mode}`}><span><b>接着上次</b><small>{pendingTask.mode === "chat" ? "聊天截图" : pendingTask.mode === "moments" ? "朋友圈" : "社交资料"} · {pendingTask.count} 张图片的任务已保留</small></span><span>继续查看 <ArrowUpRight size={16}/></span></a>}
  </>;
  return <main className={styles.shell}><WebNav/><div className={styles.wrap}>
    <ProductHome afterHero={continuation} signedIn={!!owner} onStart={href => window.location.assign(href)}/>
  </div><footer className="web-footer"><span>成子 · 陪你看懂关系</span><div><a href="/privacy">数据与隐私</a><a href="/account#contact">联系客服</a><a href="/sales">服务介绍</a></div></footer></main>;
}


