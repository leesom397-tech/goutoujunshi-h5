"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

type MiniWx = Window & { wx?: { miniProgram?: { navigateBack: (options: { delta: number }) => void; getEnv: (callback: (value: { miniprogram?: boolean }) => void) => void } } };
const validTicket = (value: string) => /^[a-f0-9]{64}$/.test(value);

export default function MiniappLinkPage() {
  const [ticket, setTicket] = useState("");
  const [authenticated, setAuthenticated] = useState<"loading" | "yes" | "no">("loading");
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(false);
  const [inMiniapp, setInMiniapp] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("ticket") || "";
    const timer = window.setTimeout(() => setTicket(value), 0);
    void fetch("/api/auth/session", { cache: "no-store" }).then(async response => await response.json() as { loggedIn?: boolean }).then(data => setAuthenticated(data.loggedIn ? "yes" : "no")).catch(() => setAuthenticated("no"));
    return () => window.clearTimeout(timer);
  }, []);
  async function bind() {
    if (busy || !validTicket(ticket) || !inMiniapp) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/miniapp/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "绑定暂未完成。");
      setLinked(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "绑定暂未完成。"); }
    finally { setBusy(false); }
  }
  function back() { (window as MiniWx).wx?.miniProgram?.navigateBack({ delta: 1 }); }
  const returnTo = "/miniapp/link?ticket=" + ticket;
  return <main className="mini-link"><Script src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js" strategy="afterInteractive" onReady={() => (window as MiniWx).wx?.miniProgram?.getEnv(value => setInMiniapp(value.miniprogram === true))}/><div className="mini-link-brand">成 <span>成子</span></div><div className="mini-link-card"><span className="mini-link-step">账号关联 · 一次即可</span><h1>{linked ? "已经关联成功" : "把小程序接入你的关系档案"}</h1><p>{linked ? "返回小程序，就能在同一 成子 账号下查看对象和提交截图；不会另建一份档案。" : "只有你亲自确认后，当前微信小程序身份才会关联到已登录的 成子 账号。它与微信客服身份不同，不会自动合并。可随时在账号设置里解除关联。"}</p>{!validTicket(ticket) ? <p className="mini-link-error">关联链接无效，请从小程序重新打开。</p> : !inMiniapp ? <p className="mini-link-error">请从 成子 官方微信小程序打开关联页；网页链接不能直接绑定账号。</p> : authenticated === "no" ? <a className="mini-link-primary" href={"/login?return_to=" + encodeURIComponent(returnTo)}>登录已有 成子 账号 →</a> : authenticated === "yes" && !linked ? <button className="mini-link-primary" disabled={busy} onClick={() => void bind()}>{busy ? "正在关联…" : "确认关联当前账号 →"}</button> : linked ? <button className="mini-link-primary" onClick={back}>返回小程序 →</button> : <p>正在核对登录状态…</p>}{error && <p className="mini-link-error" role="alert">{error}</p>}</div><p className="mini-link-foot">关联不会读取你的微信私聊。聊天内容只有在你主动上传并授权后才会处理。</p></main>;
}
