"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, HeartHandshake, MessageCircle, RotateCcw } from "lucide-react";
import { feedbackLabel, feedbackOutcomes, type ActionFeedback, type FeedbackOutcome } from "@/lib/relationship-feedback";
import type { FeedbackState } from "@/app/archive/types";
import { api, message, WebError, type Json } from "./client";
import "./report-follow-up.css";

type Card = FeedbackState["cards"][number];
type Draft = { outcome: FeedbackOutcome | ""; note: string; eventDate: string };
type Phase = "loading" | "ready" | "missing" | "paused" | "unavailable" | "login" | "error";
const initialDraft = (): Draft => ({ outcome: "", note: "", eventDate: "" });
const shortLabels: Record<FeedbackOutcome, string> = {
  not_done: "还没行动", waiting: "等回应中", positive: "有了进展",
  alternative: "换个安排", declined: "明确拒绝", uncomfortable: "我不舒服",
};
const short = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

// Remount all ephemeral drafts and receipts when the account, report or person changes.
export function ReportFollowUp({ report, owner }: { report: Json; owner?: string }) {
  return <FollowUp key={`${owner || ""}:${report.id || ""}:${report.subjectId || ""}`} report={report} owner={owner || ""}/>;
}

function FollowUp({ report, owner }: { report: Json; owner: string }) {
  const reportId = short(report.id, 64), subjectId = short(report.subjectId, 64);
  const [phase, setPhase] = useState<Phase>("loading"), [card, setCard] = useState<Card | null>(null);
  const [draft, setDraft] = useState<Draft>(initialDraft), [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const mounted = useRef(true), generation = useRef(0), writing = useRef(false);
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const draftStarted = useRef(false);
  const readController = useRef<AbortController | null>(null);
  const archiveUrl = `/archive?subjectId=${encodeURIComponent(subjectId)}&section=actions&followup=${encodeURIComponent(reportId)}`;
  const clearIdentity = useCallback(() => {
    setCard(null); setDraft(initialDraft()); setEditing(false); setSaved(false); pending.current = null; draftStarted.current = false; setPhase("login");
  }, []);

  const load = useCallback(async () => {
    const current = ++generation.current;
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    const active = () => mounted.current && current === generation.current && !controller.signal.aborted;
    setCard(null); setPhase("loading"); setError(""); setSaved(false);
    if (!owner) { clearIdentity(); return; }
    if (!reportId || !subjectId) { setPhase("missing"); return; }
    try {
      const identity = await api("/api/account/credits", undefined, controller.signal);
      if (!active()) return;
      if (identity.account?.userId !== owner) { clearIdentity(); return; }
      const result = await api(`/api/web/relationship-feedback?subjectId=${encodeURIComponent(subjectId)}`, undefined, controller.signal);
      if (!active()) return;
      if (result.subjectId !== subjectId || !Array.isArray(result.cards)) throw new Error("行动记录未完整返回，请重试。");
      const currentCard = (result.cards as Card[]).find(item => item.reportId === reportId && typeof item.action === "string" && item.action.trim());
      setCard(currentCard || null); setPhase(currentCard ? "ready" : "missing");
    } catch (cause) {
      if (!active()) return;
      if (cause instanceof WebError && cause.status === 401) clearIdentity();
      else if (cause instanceof WebError && cause.status === 403) { setPhase("paused"); setEditing(false); }
      else if (cause instanceof WebError && cause.status === 404) { setPhase("unavailable"); setEditing(false); }
      else { setPhase("error"); setError(message(cause)); }
    }
  }, [owner, reportId, subjectId, clearIdentity]);

  useEffect(() => {
    mounted.current = true; void load();
    const focus = () => { if (!document.hidden && !writing.current) void load(); };
    window.addEventListener("focus", focus);
    return () => { mounted.current = false; generation.current++; readController.current?.abort(); window.removeEventListener("focus", focus); };
  }, [load]);

  async function save() {
    if (writing.current || phase !== "ready" || !card || !draft.outcome) return;
    const payload = { subjectId, reportId, ...draft, confirmed: true };
    const fingerprint = JSON.stringify(payload);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID() };
    const id = pending.current.id, current = generation.current;
    const active = () => mounted.current && current === generation.current;
    writing.current = true; setBusy(true); setError(""); setSaved(false);
    try {
      const identity = await api("/api/account/credits");
      if (!active()) return;
      if (identity.account?.userId !== owner) { clearIdentity(); return; }
      const result = await api("/api/web/relationship-feedback", { ...payload, id });
      if (!active()) return;
      const feedback = result.feedback as ActionFeedback | undefined;
      if (!feedback || feedback.id !== id || feedback.reportId !== reportId || feedback.outcome !== draft.outcome || feedback.note !== draft.note.trim() || feedback.eventDate !== draft.eventDate) throw new Error("保存结果还未确认，草稿已保留，再试一次会核对同一条记录。");
      setCard({ ...card, latest: feedback, outcomeLabel: feedbackLabel(feedback.outcome), revisions: [...card.revisions.filter(item => item.id !== id), feedback], revisionCount: card.revisions.some(item => item.id === id) ? card.revisionCount : card.revisionCount + 1 });
      pending.current = null; setEditing(false); setSaved(true);
    } catch (cause) {
      if (!active()) return;
      if (cause instanceof WebError && cause.status === 401) clearIdentity();
      else { setError(message(cause)); if (cause instanceof WebError && [403, 404].includes(cause.status)) { setPhase(cause.status === 403 ? "paused" : "unavailable"); setCard(null); setEditing(false); } }
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  }

  async function continueChat() {
    if (writing.current || !card?.latest || phase !== "ready") return;
    const current = generation.current;
    writing.current = true; setBusy(true); setError("");
    try {
      const identity = await api("/api/account/credits");
      if (!mounted.current || current !== generation.current) return;
      if (identity.account?.userId !== owner) { clearIdentity(); return; }
      const latest = card.latest;
      const summary = ["这是我主动记录的行动反馈，不是对方意图的证明。请先复盘变化，再帮我选择下一步。", "当时判断（待验证）：" + short(report.decision?.judgment || card.sourceSummary, 180), "当时建议：" + short(card.action, 260), "我记录的实际结果：" + feedbackLabel(latest.outcome), "补充：" + (short(latest.note, 400) || "未填写"), "实际发生日期：" + (latest.eventDate || "未明确")].join("\n").slice(0, 1100);
      const key = crypto.randomUUID();
      try { sessionStorage.setItem(`web-followup:${key}`, JSON.stringify({ accountId: owner, reportId, title: "行动复盘", subjectId, summary, expiresAt: Date.now() + 30 * 60_000 })); }
      catch { throw new Error("浏览器未能保存复盘上下文，请允许此站点使用存储后重试。"); }
      window.location.href = `/chat?context=${key}`;
    } catch (cause) { if (mounted.current && current === generation.current) { if (cause instanceof WebError && cause.status === 401) clearIdentity(); else setError(message(cause)); } }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  }

  function openEditor() {
    // A failed save keeps its draft and id, including after a same-account reload.
    if (!draftStarted.current) setDraft(card?.latest ? { outcome: card.latest.outcome, note: card.latest.note || "", eventDate: card.latest.eventDate || "" } : initialDraft());
    draftStarted.current = true;
    setEditing(true); setSaved(false); setError("");
  }

  return <section className="wa-card report-follow-up" id="followup" aria-labelledby="report-follow-up-title">
    <div className="rf-heading"><div><span className="wa-eyebrow">从建议，到真实相处</span><h2 id="report-follow-up-title"><HeartHandshake size={22}/>后来，你们怎么样了？</h2></div><span className="rf-free">记录不扣积分</span></div>
    {phase === "loading" && <p className="wa-muted" role="status">正在查看这次建议的进展…</p>}
    {phase === "login" && <p className="wa-muted">账号状态已变化，请刷新页面后继续查看自己的报告。</p>}
    {phase === "paused" && <div className="rf-empty"><p>人物档案目前已暂停或尚未启用。恢复后，可以继续记录你的进展。</p><a href="/archive">前往人物档案<ArrowRight size={16}/></a></div>}
    {phase === "unavailable" && <div className="rf-empty"><p>这份报告关联的人物已无法读取。先确认人物档案，再决定是否保存新的进展。</p><a href="/archive">查看我的人物档案<ArrowRight size={16}/></a></div>}
    {phase === "missing" && <div className="rf-empty"><p>{!subjectId ? "这次分析还没有关联人物。下次分析时选择对应人物，建议和后续进展就能放在一起。" : "这份报告还没有可记录的归档建议。可以先核对人物线索；下次分析时，确认关联这个人物。"}</p><a href={subjectId ? `/archive?subjectId=${encodeURIComponent(subjectId)}&review=pending` : "/analyze?mode=chat"}>{subjectId ? "核对人物线索" : "关联人物开始分析"}<ArrowRight size={16}/></a></div>}
    {phase === "ready" && card && <>
      <div className="rf-suggestion"><span>当时建议</span><p>{card.action}</p></div>
      {card.latest ? <div className="rf-result"><span className="rf-result-label"><Check size={16}/>{card.outcomeLabel}</span>{card.latest.note && <p>{card.latest.note}</p>}<p className="rf-review">{card.latest.review}</p><small>{card.latest.eventDate ? `发生于 ${card.latest.eventDate}` : "实际发生日期未填"}{card.revisionCount > 1 ? ` · 已记录 ${card.revisionCount} 次反馈` : ""}</small></div> : <p className="wa-muted rf-intro">有进展、还在等，或暂时不想行动，都可以记下来。按自己的节奏来。</p>}
      {saved && <p className="rf-saved" role="status"><Check size={17}/>已记下。下次咨询时，可以带着这次结果一起聊。</p>}
      {!editing && <div className="wa-actions rf-actions"><button type="button" disabled={busy} onClick={openEditor}>{card.latest ? <RotateCcw size={16}/> : <Check size={16}/>} {card.latest ? "更新实际结果" : "记下后来发生的事"}</button>{card.latest && <button type="button" disabled={busy} onClick={() => void continueChat()}><MessageCircle size={16}/>带着结果继续聊</button>}<a href={archiveUrl}>查看完整进展<ArrowRight size={15}/></a></div>}
      {editing && <div className="rf-editor"><h3>这次实际发生了什么？</h3><p className="wa-muted">选好结果、补充想说的话，再点确认保存到这个人物档案。</p><div className="rf-outcomes" role="group" aria-label="实际结果">{feedbackOutcomes.map(value => <button key={value} type="button" disabled={busy} aria-pressed={draft.outcome === value} onClick={() => setDraft(previous => ({ ...previous, outcome: value }))}>{shortLabels[value]}</button>)}</div><label className="wa-field">补充一句（选填）<textarea maxLength={500} rows={3} value={draft.note} disabled={busy} onChange={event => setDraft(previous => ({ ...previous, note: event.target.value }))} placeholder="比如：约好了周六见面；或者，我决定先让自己缓一缓。"/></label><label className="wa-field rf-date">实际发生日期（选填）<input type="date" value={draft.eventDate} disabled={busy} max={new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)} onChange={event => setDraft(previous => ({ ...previous, eventDate: event.target.value }))}/></label><div className="wa-actions rf-actions"><button type="button" className="rf-save" disabled={busy || !draft.outcome} onClick={() => void save()}>{busy ? "正在确认保存…" : "确认记下结果"}</button><button type="button" disabled={busy} onClick={() => setEditing(false)}>暂时收起</button></div></div>}
    </>}
    {error && <p className="wa-error" role="alert">{error}{phase === "ready" ? " 输入还在，可以重试。" : ""}</p>}
    {phase === "error" && <button type="button" onClick={() => void load()}>重新读取进展</button>}
  </section>;
}
