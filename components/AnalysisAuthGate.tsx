"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, X } from "lucide-react";
import { PhoneRegisterForm } from "@/components/PhoneRegisterForm";
import styles from "./AnalysisAuthGate.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  returnTo: string;
  contextLabel?: string;
  /** When provided, the caller refreshes its account state and closes the gate. */
  onSuccess?: () => void | Promise<void>;
};

function safeDestination(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/workspace";
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : "/workspace";
  } catch { return "/workspace"; }
}

/** No authentication request is sent until the user submits the active form. */
export function AnalysisAuthGate(props: Props) {
  return props.open ? <AuthDialog {...props} /> : null;
}

function AuthDialog({ onClose, returnTo, contextLabel = "当前分析", onSuccess }: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    active.current = true;
    const element = dialog.current;
    const priorFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => {
      active.current = false;
      element?.close();
      document.body.style.overflow = previousOverflow;
      priorFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => dialog.current?.querySelector<HTMLInputElement>(`[data-auth-panel="${mode}"] input:not(:disabled)`)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  function switchMode(next: "login" | "register") {
    if (busy || registerBusy) return;
    setMode(next);
    setError("");
  }

  async function complete() {
    if (!active.current) return;
    setBusy(true);
    setPassword("");
    try {
      if (onSuccess) await onSuccess();
      else window.location.assign(safeDestination(returnTo));
    } catch {
      if (active.current) setError("登录已完成，账户信息暂未刷新。请关闭弹窗后重试。");
    } finally {
      if (active.current) setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw Error(data.error || "登录失败，请检查账号密码。");
      await complete();
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "网络异常，请稍后重试。");
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <button type="button" className={styles.close} aria-label="关闭登录注册弹窗" onClick={onClose}><X size={20} /></button>
    <header className={styles.header}>
      <span className={styles.eyebrow}>继续 · {contextLabel}</span>
      <h2 id={`${id}-title`}>登录后，接着了解。</h2>
      <p id={`${id}-description`}>保存你的材料与分析，让每次理解接上前面的故事。</p>
    </header>
    <div className={styles.body}>
      <div className={styles.tabs} role="tablist" aria-label="登录或注册" onKeyDown={event => {
        if (busy || registerBusy || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "login" : event.key === "End" ? "register" : mode === "login" ? "register" : "login";
        switchMode(next);
        document.getElementById(`${id}-${next}-tab`)?.focus();
      }}>
        <button id={`${id}-login-tab`} role="tab" type="button" aria-selected={mode === "login"} aria-controls={`${id}-login-panel`} tabIndex={mode === "login" ? 0 : -1} disabled={busy || registerBusy} onClick={() => switchMode("login")}>登录账户</button>
        <button id={`${id}-register-tab`} role="tab" type="button" aria-selected={mode === "register"} aria-controls={`${id}-register-panel`} tabIndex={mode === "register" ? 0 : -1} disabled={busy || registerBusy} onClick={() => switchMode("register")}>创建账户</button>
      </div>

      <section id={`${id}-login-panel`} role="tabpanel" aria-labelledby={`${id}-login-tab`} data-auth-panel="login" hidden={mode !== "login"} className={styles.pane}>
        <form className={styles.loginForm} onSubmit={submit}>
          <label>用户名<input name="username" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={100} disabled={busy} /></label>
          <label>密码<input name="password" value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete="current-password" required maxLength={256} disabled={busy} /></label>
          
          <button className={styles.submit} disabled={busy} type="submit">{busy ? "正在登录…" : "登录并继续"}<ArrowRight size={17} /></button>
        </form>
        <p className={styles.help}>还没有账户？<button type="button" onClick={() => switchMode("register")} disabled={busy}>在这里注册</button></p>
      </section>

      <section id={`${id}-register-panel`} role="tabpanel" aria-labelledby={`${id}-register-tab`} data-auth-panel="register" hidden={mode !== "register"} className={styles.pane}>
        <fieldset className={styles.fields} disabled={busy} aria-busy={busy || registerBusy}><PhoneRegisterForm compact returnTo={returnTo} onSuccess={() => void complete()} onLogin={() => switchMode("login")} onBusyChange={setRegisterBusy} /></fieldset>
      </section>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <p className={styles.privacy}><LockKeyhole size={13} />资料由你掌控 · <a href="/privacy" target="_blank" rel="noreferrer">数据与使用说明</a></p>
    </div>
  </dialog>;
}
