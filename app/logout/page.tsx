"use client";

import { useEffect, useRef, useState } from "react";
import { clearCaptureConnectionSessions } from "@/lib/capture-connection-session";

export default function LogoutPage() {
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [cleanupPending, setCleanupPending] = useState(false);
  const serverLoggedOut = useRef(false);
  useEffect(() => {
    let active = true;
    setError("");
    void (async () => {
      try {
        let cleanupFailed = false;
        try { await clearCaptureConnectionSessions(); } catch { cleanupFailed = true; }
        // A browser storage failure must never prevent the server from ending
        // the account session. Keep cleanup visible after a successful logout.
        if (!serverLoggedOut.current) {
          const response = await fetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error("退出未完成，请重试。");
          serverLoggedOut.current = true;
        }
        if (cleanupFailed) { if (active) setCleanupPending(true); return; }
        if ("caches" in window) await caches.delete("lovetalk-local-share-v1").catch(() => false);
        if (active) window.location.replace("/login");
      } catch {
        if (active) setError("退出未完成，请检查网络后重试。");
      }
    })();
    return () => { active = false; };
  }, [attempt]);
  return <main className="login-screen"><div className="login-panel"><h1>{error ? "退出未完成" : cleanupPending ? "账号已退出" : "正在退出…"}</h1>{error ? <><p role="alert">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重新退出</button></> : cleanupPending ? <><p role="status">本机助手的连接信息尚未清理。请关闭其他成子页面后重试清理。</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重试清理连接信息</button></> : <p>正在结束这台设备上的登录。</p>}</div></main>;
}
