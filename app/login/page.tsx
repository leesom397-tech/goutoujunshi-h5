"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { AuthArtwork } from "@/components/AuthArtwork";
import authStyles from "@/components/AuthShell.module.css";
import { BrandMark } from "@/components/BrandMark";
import { announceAccountChange } from '@/lib/web-account-session';
function returnPath(): string {
  const value = new URLSearchParams(window.location.search).get("return_to") || "/workspace";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/workspace";
  try { const url = new URL(value, window.location.origin); return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : "/workspace"; } catch { return "/workspace"; }
}
export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [returnTo, setReturnTo] = useState("/workspace");
  useEffect(() => { setReturnTo(returnPath()); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "登录失败，请检查账号密码。");
      announceAccountChange();
      window.location.assign(returnPath());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "网络异常，请稍后重试。"); setBusy(false); }
  }
  return <main className={`login-screen ${authStyles.screen}`}><div className="login-showcase"><div className="showcase-intro"><span className="showcase-kicker">成子 · 关系决策智能体</span><h1>看懂关系，<br/>清醒选择。</h1><p>从聊天与社交资料开始，持续记下你们的变化。</p></div><AuthArtwork/></div><div className="login-panel"><a className="login-brand" href="/workspace"><span className="brand-mark"><BrandMark/></span><span>成子</span></a><div className="login-symbol"><LockKeyhole size={24}/></div><h2>登录你的账户</h2><p>登录后查看报告、人物档案和积分。开通状态在账户页核对。</p><form onSubmit={submit}><label>用户名<input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={100}/></label><label>密码<input value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete="current-password" required maxLength={256}/></label>{error && <div className="login-error" role="alert">{error}</div>}<button disabled={busy} type="submit">{busy ? "正在登录…" : "登录并继续"}<ArrowRight size={18}/></button></form><div className="login-help">还没有账号？<a href={"/register?return_to=" + encodeURIComponent(returnTo)}>创建成子账号</a></div><div className="login-sales-link"><a href="/account#contact">开通服务 / 登录遇到问题</a></div><p className="login-data-note"><a href="/privacy">数据与使用说明</a> · <a href="/sales">查看服务介绍</a></p></div></main>;
}


