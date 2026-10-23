"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, BookmarkCheck, Check, ChevronDown, CircleHelp, LoaderCircle, Quote, Sparkles, UserRound, UsersRound, X } from "lucide-react";
import { api, message, type Json } from "./web-analysis/client";
import { CaptureEvidence } from "./web-analysis/CaptureEvidence";
import styles from "./ConversationMemoryReview.module.css";

export type ConversationMemoryItem = {
  id: string; target: "self" | "subject"; field: string; label: string; value: string;
  quote: string; basis: "statement" | "inference"; sourceId?: string; sourceAt?: string;
  sourceReportId?: string; status: "pending" | "accepted"; conflict: boolean; currentValue?: string;
};
export type ConversationProfileMemory = {
  status: "pending" | "nothing_new" | "disabled" | "unavailable";
  sourceCount?: number; pendingCount?: number; selfCount?: number; subjectCount?: number;
  items?: ConversationMemoryItem[];
};
type Props = { memory?: ConversationProfileMemory | null; ownerId?: string; subjectId?: string };
type CurrentItem = ConversationMemoryItem & { currentStatus: "pending" | "accepted" | "removed" };
type ProfileState = { items: CurrentItem[]; enabled: boolean; paused: boolean };

/** Report candidates are a snapshot; the account's current facts decide whether an action is still available. */
function reconcile(memory: ConversationMemoryItem[], profile: Json, subjectId?: string): ProfileState {
  const facts = new Map<string, Json>((Array.isArray(profile.facts) ? profile.facts : []).map((fact: Json) => [String(fact.id), fact]));
  return {
    enabled: profile.enabled === true, paused: profile.paused === true,
    items: memory.map(item => {
      const fact = facts.get(item.id);
      const sameTarget = fact && (item.target === "self" ? !fact.subjectId : !!subjectId && fact.subjectId === subjectId);
      return { ...item, ...(sameTarget && typeof fact.value === "string" ? { value: fact.value } : {}), currentStatus: sameTarget ? fact.status === "accepted" ? "accepted" : "pending" : "removed" };
    }),
  };
}

export function ConversationMemoryReview(props: Props) {
  const items = (props.memory?.items || []).filter(item => item && item.id && item.value && ["self", "subject"].includes(item.target)).slice(0, 12);
  if (!props.memory || (!items.length && props.memory.status !== "disabled")) return null;
  return <MemoryReview key={`${props.ownerId || "guest"}:${items.map(item => item.id).join(":")}`} {...props} items={items}/>;
}

function MemoryReview({ memory, items, ownerId, subjectId }: Props & { items: ConversationMemoryItem[] }) {
  const [state, setState] = useState<ProfileState | null>(null), [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()), [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const active = useRef(true), initialised = useRef(false), request = useRef(0), heading = useId(), listId = useId();
  const abort = useRef<AbortController | null>(null);
  const lastRead = useRef(0);
  const archiveHref = subjectId ? `/archive?subjectId=${encodeURIComponent(subjectId)}` : "/archive?tab=self";

  function apply(profile: Json) {
    const next = reconcile(items, profile, subjectId);
    setState(next);
    const pendingIds = new Set(next.items.filter(item => item.currentStatus === "pending").map(item => item.id));
    const alreadyInitialised = initialised.current;
    setSelected(prior => alreadyInitialised
      ? new Set([...prior].filter(id => pendingIds.has(id)))
      : new Set(next.items.filter(item => item.currentStatus === "pending" && item.basis === "statement" && !item.conflict).map(item => item.id)));
    initialised.current = true;
    lastRead.current = Date.now();
  }

  async function refresh() {
    if (!ownerId) return;
    const generation = ++request.current;
    abort.current?.abort(); const control = new AbortController(); abort.current = control;
    setLoading(true); setError("");
    try {
      const profile = await api("/api/web/profile", undefined, control.signal);
      if (active.current && generation === request.current) apply(profile);
    } catch (cause) { if (active.current && generation === request.current && !control.signal.aborted) setError(message(cause)); }
    finally { if (active.current && generation === request.current) setLoading(false); }
  }

  useEffect(() => {
    active.current = true; void refresh();
    return () => { active.current = false; request.current++; abort.current?.abort(); };
  }, [ownerId]);

  function toggleReview() {
    setOpen(value => !value);
    // Only recheck when the user opens this review. Returning from WeChat must
    // not refetch the full profile or interrupt the current report.
    if (!open && !busy && !loading && Date.now() - lastRead.current > 60_000) void refresh();
  }

  async function decide(ids: string[], decision: "accept" | "reject") {
    if (!ownerId || busy || loading || !state?.enabled || state.paused || !ids.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api("/api/web/profile", decision === "accept"
        ? { action: "fact-decide-many", ids, decision, expectedOwnerId: ownerId }
        : { action: "fact-decide", id: ids[0], decision, expectedOwnerId: ownerId });
      if (!active.current) return;
      apply(result);
      const updated = reconcile(items, result, subjectId);
      const saved = updated.items.filter(item => ids.includes(item.id) && item.currentStatus === "accepted").length;
      setNotice(decision === "accept" ? saved ? `已保存 ${saved} 条资料，后续分析会结合这些信息。` : "这些资料已处理，已更新当前状态。" : "已忽略这条资料。");
      window.dispatchEvent(new Event("chengzi:profile-changed"));
    } catch (cause) { if (active.current) setError(message(cause)); }
    finally { if (active.current) setBusy(false); }
  }

  const current = state?.items || items.map(item => ({ ...item, currentStatus: item.status }));
  const pending = current.filter(item => item.currentStatus === "pending");
  const accepted = current.filter(item => item.currentStatus === "accepted");
  const selfCount = pending.filter(item => item.target === "self").length, subjectCount = pending.length - selfCount;
  const disabled = state ? !state.enabled || state.paused : memory?.status === "disabled";
  const blocked = !state || disabled || loading || busy || !!error;
  const selectedIds = pending.filter(item => selected.has(item.id)).map(item => item.id);
  const shown = current.filter(item => item.currentStatus !== "removed");
  const sourceCount = Number.isFinite(memory?.sourceCount) ? Math.max(0, Math.floor(memory!.sourceCount!)) : 0;

  return <section className={styles.card} aria-labelledby={heading} data-conversation-memory>
    <div className={styles.overview}>
      <div className={styles.heading}><span className={styles.symbol}><Sparkles size={22}/></span><div>
        <h3 id={heading}>{disabled ? "让聊天逐渐完善双方资料" : pending.length ? "聊天里，也有关于你们的资料" : accepted.length ? "这些资料，之后还能用" : "这次资料已核对"}</h3>
        <p>{disabled ? "启用档案后，成子智能体可以从原话整理资料，供你核对保存。" : pending.length ? `${sourceCount ? `从 ${sourceCount} 条已导入文字整理，` : "从聊天原话整理，"}核对一次，后续分析就能用。` : accepted.length ? `已保存 ${accepted.length} 条；可在档案里修改或删除。` : "当前没有待保存的资料。"}</p>
      </div></div>
      {disabled ? <a className={styles.review} href="/archive?tab=self">{state?.paused ? "恢复档案" : "启用档案"}<ArrowUpRight size={17}/></a>
        : !ownerId ? <a className={styles.review} href="/login?return_to=%2Farchive">登录后核对<ArrowUpRight size={17}/></a>
        : shown.length > 0 && <button type="button" className={styles.review} aria-expanded={open} aria-controls={listId} onClick={toggleReview}>{open ? "收起资料" : pending.length ? "核对并保存" : "查看已保存资料"}<ChevronDown size={18} className={open ? styles.rotated : undefined}/></button>}
    </div>
    {!disabled && pending.length > 0 && <div className={styles.counts}><span className={styles.selfBadge}><UserRound size={16}/>关于我 <strong>{selfCount}</strong> 条</span><span className={styles.subjectBadge}><UsersRound size={16}/>关于对方 <strong>{subjectCount}</strong> 条</span></div>}
    {loading && !state && <p className={styles.status} role="status"><LoaderCircle size={16} className={styles.spinning}/>正在核对保存状态…</p>}
    {error && <div className={styles.error} role="alert"><span>{error}</span><button type="button" disabled={loading || busy} onClick={() => void refresh()}>重新核对状态</button></div>}
    {notice && <p className={styles.notice} role="status"><BookmarkCheck size={17}/>{notice}</p>}
    {open && !disabled && <div id={listId} className={styles.reviewArea}>
      <p className={styles.hint}>勾选你认可的资料。推测和与旧资料不同的内容，需要你单独核对。</p>
      <div className={styles.list} tabIndex={0} aria-label="核对本次整理的双方资料">
        {(["self", "subject"] as const).map(target => {
          const group = shown.filter(item => item.target === target);
          if (!group.length) return null;
          return <div key={target} className={styles.group} data-memory-target={target}>
            <h4>{target === "self" ? <UserRound size={18}/> : <UsersRound size={18}/>} {target === "self" ? "关于我" : "关于对方"}</h4>
            {group.map(item => <article key={item.id} className={styles.item} data-conversation-memory-row={item.id}>
              <div className={styles.itemTop}>{item.currentStatus === "accepted" ? <span className={styles.saved}><Check size={16}/>已保存</span> : <label className={styles.select}><input type="checkbox" checked={selected.has(item.id)} disabled={blocked} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })}/><span>{item.label || "资料线索"}</span></label>}
                <span className={`${styles.basis} ${item.basis === "inference" ? styles.inference : ""}`}>{item.basis === "inference" ? <><CircleHelp size={14}/>待核对推测</> : "原话陈述"}</span>
              </div>
              <p className={styles.value}>{item.value}</p>
              {item.conflict && <p className={styles.conflict}><CircleHelp size={15}/><span>与原资料不同{item.currentValue ? `：${item.currentValue}` : "，请核对时间和含义"}。保存后保留这条新线索，原资料不会被替换。</span></p>}
              {item.quote && <blockquote><Quote size={15}/><span>{item.quote}</span></blockquote>}
              <div className={styles.itemFoot}><span>{item.sourceAt || (target === "self" ? "来自你的原话" : "来自对方的原话")}</span><CaptureEvidence quote={item.quote} sourceIds={item.sourceId ? [item.sourceId] : undefined} label="回看原话"/>{item.currentStatus === "pending" && <button type="button" className={styles.ignore} disabled={blocked} aria-label={`忽略${target === "self" ? "我的" : "对方的"}${item.label || "资料"}：${item.value}`} onClick={() => void decide([item.id], "reject")}><X size={14}/>忽略</button>}</div>
            </article>)}
          </div>;
        })}
        {!shown.length && <p className={styles.hint}>本次整理的资料已处理。</p>}
      </div>
      <footer className={styles.footer}><a href={archiveHref}>管理双方档案<ArrowUpRight size={15}/></a>{pending.length > 0 && <button type="button" className={styles.save} disabled={blocked || !selectedIds.length} onClick={() => void decide(selectedIds, "accept")}>{busy ? <LoaderCircle size={18} className={styles.spinning}/> : <BookmarkCheck size={18}/>} {busy ? "保存中…" : `保存选中的 ${selectedIds.length} 条`}</button>}</footer>
    </div>}
  </section>;
}
