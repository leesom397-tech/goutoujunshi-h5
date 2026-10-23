"use client";

import { useEffect, useState } from "react";

type LinkRow = { id: string; createdAt: number };

export default function MiniappManagePage() {
  const [items, setItems] = useState<LinkRow[]>([]);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loggedOut, setLoggedOut] = useState(false);
  async function load() {
    const response = await fetch("/api/miniapp/link", { cache: "no-store" });
    if (response.status === 401) { setLoggedOut(true); return; }
    const data = await response.json() as { links?: LinkRow[]; error?: string };
    if (!response.ok) throw new Error(data.error || "暂时无法读取绑定设备。");
    setItems(data.links || []);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch(cause => setError(cause instanceof Error ? cause.message : "暂时无法读取绑定设备。")).finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function unlink(id: string) {
    if (!window.confirm("解除这个小程序身份的关联？它将立即无法读取你的对象、档案和报告，已有档案不会删除。")) return;
    setBusy(id); setError("");
    try {
      const response = await fetch("/api/miniapp/link", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ openId: id }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "解除关联暂时失败。");
      setItems(current => current.filter(item => item.id !== id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "解除关联暂时失败。"); }
    finally { setBusy(""); }
  }
  return <main className="mini-link"><div className="mini-link-brand">成 <span>成子</span></div><div className="mini-link-card"><span className="mini-link-step">账号与隐私</span><h1>小程序关联管理</h1><p>只有你确认关联过的微信小程序身份，才能通过小程序访问这份 成子 资料。解除后，所有对应小程序会话立即失效，不删除你的网页档案。</p>{loading ? <p>正在读取…</p> : loggedOut ? <a className="mini-link-primary" href="/login?return_to=%2Fminiapp%2Fmanage">登录后查看 →</a> : items.length ? <div className="mini-devices">{items.map(item => <div key={item.id}><div><strong>微信小程序身份 · {item.id.slice(-6)}</strong><span>关联于 {new Date(item.createdAt).toLocaleDateString("zh-CN")}</span></div><button type="button" disabled={!!busy} onClick={() => void unlink(item.id)}>{busy === item.id ? "正在解除…" : "解除关联"}</button></div>)}</div> : <p>目前没有关联的小程序身份。</p>}{error && <p className="mini-link-error" role="alert">{error}</p>}</div><p className="mini-link-foot"><a href="/archive">返回关系档案</a></p></main>;
}
