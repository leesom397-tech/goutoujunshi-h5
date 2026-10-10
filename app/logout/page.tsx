"use client";

import { useEffect, useState } from "react";

export default function LogoutPage() {
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void (async () => {
      try {
        const response = await fetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error("退出未完成，请重试。");
        if ("caches" in window) await caches.delete("lovetalk-local-share-v1").catch(() => false);
        if (active) window.location.replace("/login");
      } catch {
        if (active) setError("退出未完成，请检查网络后重试。");
      }
    })();
    return () => { active = false; };
  }, [attempt]);
  return <main className="login-screen"><div className="login-panel"><h1>{error ? "退出未完成" : "正在退出…"}</h1>{error ? <><p role="alert">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重新退出</button></> : <p>正在结束这台设备上的登录。</p>}</div></main>;
}
