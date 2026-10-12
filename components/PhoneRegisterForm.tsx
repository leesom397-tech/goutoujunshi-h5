"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import "./phone-register-form.css";

type Props = { onSuccess?: () => void; onLogin?: () => void; onBusyChange?: (busy: boolean) => void; compact?: boolean; returnTo?: string };

function destination(override?: string) {
  const raw = override || new URLSearchParams(window.location.search).get("return_to") || "/account";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/account";
  try { const url = new URL(raw, window.location.origin); return url.origin === window.location.origin ? url.pathname + url.search + url.hash : "/account"; } catch { return "/account"; }
}

export function PhoneRegisterForm({ onSuccess, onLogin, onBusyChange, compact = false, returnTo }: Props) {
  const [username, setUsername] = useState(""); const [phone, setPhone] = useState(""); const [code, setCode] = useState("");
  const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [agree, setAgree] = useState(false); const [busy, setBusy] = useState(false); const [sending, setSending] = useState(false);
  const [error, setError] = useState(""); const [codeError, setCodeError] = useState(""); const [notice, setNotice] = useState(""); const [loginRequired, setLoginRequired] = useState(false);
  const [seconds, setSeconds] = useState(0); const deadline = useRef(0); const inFlight = useRef(false);
  const [loginHref, setLoginHref] = useState("/login");
  useEffect(() => { setLoginHref("/login?return_to=" + encodeURIComponent(destination(returnTo))); }, [returnTo]);
  useEffect(() => { const timer = window.setInterval(() => setSeconds(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))), 500); return () => window.clearInterval(timer); }, []);
  useEffect(() => { onBusyChange?.(busy || sending); }, [busy, sending, onBusyChange]);

  async function sendCode() {
    if (inFlight.current || busy || deadline.current > Date.now()) return;
    if (!/^1[3-9]\d{9}$/.test(phone)) { setCodeError("请先填写正确的 11 位手机号。"); return; }
    if (!agree) { setCodeError("请先勾选下方的数据与使用说明。"); return; }
    inFlight.current = true; setSending(true); setCodeError(""); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/register/send-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, agree: true }) });
      const data = await response.json() as { ok?: boolean; error?: string; resendSeconds?: number };
      if (!response.ok || !data.ok) {
        const retry = Math.min(3600, Math.max(0, Number(response.headers.get("retry-after")) || 0));
        if (retry) { deadline.current = Date.now() + retry * 1000; setSeconds(retry); }
        throw Error(data.error || "验证码暂未发送，请稍后重试。");
      }
      const wait = Math.min(600, Math.max(60, data.resendSeconds || 60)); deadline.current = Date.now() + wait * 1000; setSeconds(wait);
      setNotice("验证码已发送，请查看手机短信。");
    } catch (cause) { setCodeError(cause instanceof Error ? cause.message : "网络异常，请重试。"); }
    finally { inFlight.current = false; setSending(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current || busy || loginRequired) return;
    if (!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(username.trim())) { setError("注册名需以字母开头，3–20 位字母、数字或下划线。"); return; }
    if (!/^1[3-9]\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) { setError("请填写手机号和 6 位短信验证码。"); return; }
    if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { setError("密码需为 8–128 位，同时包含字母和数字。"); return; }
    if (password !== confirm) { setError("两次密码不一致。"); return; }
    if (!agree) { setError("请阅读并同意数据与使用说明。"); return; }
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: username.trim(), phone, code, password, password2: confirm, agree: true }) });
      const data = await response.json() as { ok?: boolean; error?: string; loginRequired?: boolean };
      if (!response.ok || !data.ok) throw Error(data.error || "注册失败，请重试。");
      if (data.loginRequired) { setLoginRequired(true); setNotice("注册成功，请使用注册名和密码登录。"); setPassword(""); setConfirm(""); setCode(""); }
      else if (onSuccess) onSuccess();
      else window.location.assign(destination());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "网络异常，请重试。"); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className={"phone-register-form" + (compact ? " phone-register-compact" : "")}>
    <h2>创建你的账户</h2><p>手机验证后，用注册名和密码登录。积分与功能需联系客服开通。</p>
    <form onSubmit={submit}>
      <label>注册名<input name="username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={20} pattern="[A-Za-z][A-Za-z0-9_]{2,19}" placeholder="3–20 位，字母开头" disabled={busy || loginRequired}/></label>
      <label>手机号<input type="tel" value={phone} onChange={e => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 11)); setCode(""); setCodeError(""); setNotice(""); }} autoComplete="tel-national" inputMode="numeric" required pattern="1[3-9][0-9]{9}" maxLength={11} placeholder="11 位手机号" disabled={busy || sending || loginRequired}/></label>
      <div className="register-code-row"><label>短信验证码<input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="one-time-code" inputMode="numeric" required pattern="[0-9]{6}" maxLength={6} placeholder="6 位验证码" disabled={busy || loginRequired}/></label><button type="button" className="register-code-button" onClick={() => void sendCode()} disabled={sending || busy || seconds > 0 || loginRequired}>{sending ? "发送中…" : seconds ? `${seconds} 秒后重发` : "获取验证码"}</button></div>
      {codeError && <div className="register-code-error" role="alert">{codeError}</div>}
      <label>密码<input value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" type="password" required minLength={8} maxLength={128} placeholder="至少 8 位，含字母和数字" disabled={busy || loginRequired}/></label>
      <label>确认密码<input value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" type="password" required minLength={8} maxLength={128} disabled={busy || loginRequired}/></label>
      <label className="register-consent"><input type="checkbox" required checked={agree} onChange={e => { setAgree(e.target.checked); setCodeError(""); }} disabled={busy || sending}/><span>我已阅读并同意<a href="/privacy" target="_blank" rel="noreferrer">数据与使用说明</a>，用于手机号验证及账户注册。</span></label>
      {error && <div className="login-error" role="alert">{error}</div>}{notice && <div className="register-notice" role="status">{notice}</div>}
      {loginRequired ? onLogin ? <button type="button" className="phone-register-submit" onClick={onLogin}>前往登录<ArrowRight size={18}/></button> : <a className="phone-register-submit" href={loginHref}>前往登录<ArrowRight size={18}/></a> : <button className="phone-register-submit" disabled={busy || sending} type="submit">{busy ? "正在创建…" : "创建账户"}<ArrowRight size={18}/></button>}
    </form><div className="phone-register-help">已有账号？{onLogin ? <button type="button" onClick={onLogin} disabled={busy || sending}>直接登录</button> : <a href={loginHref}>直接登录</a>}</div>
  </div>;
}
