"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, MessageCircle, Pencil, Quote, RefreshCw, Trash2, X } from "lucide-react";
import styles from "./SelfChatMemory.module.css";

type Item = { id: string; field: string; label: string; value: string; quote: string; at?: string; basis: "statement" | "correction" };
type Summary = { id: string; version: number; summary: string; updatedAt: string | number; items: Item[] };
type Memory = { version: number; status: "ready" | "disabled"; summaries: Summary[] };
type State = { enabled?: boolean; paused?: boolean; selfMemory?: Memory; error?: string };
const date = (value?: string | number) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleDateString("zh-CN") : "日期未明确";

/** Derived first-person notes stay separate from the user's explicitly entered profile. */
export function SelfChatMemory({ enabled = true, paused = false }: { enabled?: boolean; paused?: boolean }) {
  const [state, setState] = useState<State | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(""), [draft, setDraft] = useState("");
  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/web/profile", { cache: "no-store", credentials: "same-origin" });
      const next = await response.json() as State;
      if (!response.ok) throw new Error(next.error || "聊天中整理的资料暂时无法读取。");
      setState(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法读取，请重试。"); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (enabled) void load(); }, [enabled, paused]);
  async function act(action: "correctSelfMemory" | "removeSelfMemory", memoryId: string, itemId: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/web/profile", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, memoryId, itemId, ...(action === "correctSelfMemory" ? { value: draft.trim() } : {}) }) });
      const next = await response.json() as State;
      if (!response.ok) throw new Error(next.error || "暂时未能保存，请重试。");
      setState(next); setEditing("");
      setNotice(action === "correctSelfMemory" ? "已按你的纠正更新，之后优先使用这个版本。" : "已移除这条记忆，之后不再使用。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "暂时未能保存，请重试。"); }
    finally { setBusy(false); }
  }
  if (!enabled) return null;
  const disabled = paused || state?.paused || state?.selfMemory?.status === "disabled";
  const summaries = disabled ? [] : state?.selfMemory?.summaries || [];
  return <section className={styles.card} aria-labelledby="self-chat-memory-title" data-self-chat-memory>
    <header><MessageCircle size={22}/><div><h2 id="self-chat-memory-title">从聊天中了解我</h2><p>整理你自己说过的偏好与需要，已确认资料优先。每条都可以纠正或移除。</p></div></header>
    {loading ? <p role="status">正在读取…</p> : disabled ? <p className={styles.empty}>档案已暂停，暂不使用聊天中整理的信息。</p> : summaries.length ? <div className={styles.summaries}>{summaries.map(memory => <details key={memory.id}>
      <summary><span><strong>{memory.summary || "查看从本人自述整理的线索"}</strong><small>{date(memory.updatedAt)} · 第 {memory.version} 版 · {memory.items.length} 条</small></span><ChevronDown size={18}/></summary>
      <div className={styles.items}>{memory.items.map(item => <article key={item.id} data-self-memory-item>
        <div className={styles.itemHeading}><strong>{item.label || "本人自述"}</strong>{item.basis === "correction" && <span><Check size={13}/>已由我纠正</span>}</div>
        {editing === `${memory.id}:${item.id}` ? <form onSubmit={event => { event.preventDefault(); void act("correctSelfMemory", memory.id, item.id); }}><label>修改这条信息（最多 180 字）<textarea autoFocus rows={3} maxLength={180} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)}/></label><div className={styles.actions}><button disabled={busy || !draft.trim()} type="submit"><Check size={15}/>保存纠正</button><button type="button" disabled={busy} onClick={() => setEditing("")}><X size={15}/>取消</button></div></form> : <><p>{item.value}</p><div className={styles.actions}><button type="button" disabled={busy} onClick={() => { setEditing(`${memory.id}:${item.id}`); setDraft(item.value); }}><Pencil size={15}/>纠正</button><button type="button" disabled={busy} onClick={() => void act("removeSelfMemory", memory.id, item.id)}><Trash2 size={15}/>移除</button></div></>}
        <div className={styles.evidence}><small><Quote size={14}/>我的原话 · {date(item.at)}</small><blockquote>{item.quote || "这条线索暂未附原话，可纠正或移除。"}</blockquote></div>
      </article>)}</div>
    </details>)}</div> : !error && <p className={styles.empty}>还没有可核对的本人线索。导入聊天后，会从你自己的明确表达中逐渐整理。</p>}
    {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={15}/>重新读取</button></div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
  </section>;
}
