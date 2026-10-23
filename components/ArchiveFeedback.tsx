"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, History } from "lucide-react";
import { archiveRequest, type ArchiveFact, type FeedbackState } from "@/app/archive/types";
import { feedbackOutcomes, feedbackLabel, type FeedbackOutcome } from "@/lib/relationship-feedback";
import styles from "@/app/archive/archive.module.css";
import { RelationshipEvidenceCards } from "./web-analysis/RelationshipEvidenceCards";

export function EventDateEditor({ fact, disabled, onSave }: { fact: ArchiveFact; disabled: boolean; onSave: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [date, setDate] = useState(fact.eventDate || "");
  const [open, setOpen] = useState(false);
  const request = useRef<{ date: string; id: string } | null>(null);
  if (!fact.eventTitle) return null;
  async function save() {
    if (request.current?.date !== date) request.current = { date, id: crypto.randomUUID() };
    if (await onSave({ action: "event-date", id: fact.id, requestId: request.current.id, eventDate: date, expectedDate: fact.eventDate || "", confirmed: true })) setOpen(false);
  }
  return <><button type="button" className={styles.link} disabled={disabled} onClick={() => { setDate(fact.eventDate || ""); setOpen(!open); }}>{open ? "收起日期更正" : "更正聊天日期"}</button>{open && <div className={styles.form}><p className={styles.muted}>当前日期：{fact.eventDate || "未明确"}。更正保留截图来源；其他设备已修改时会提示刷新。</p><label className={styles.field}><span>聊天日期（未知可清空）</span><input type="date" value={date} disabled={disabled} onChange={event => setDate(event.target.value)} /></label><div className={styles.actions}><button type="button" className={styles.primary} disabled={disabled} onClick={() => void save()}>确认保存日期</button><button type="button" className={styles.button} disabled={disabled} onClick={() => setDate("")}>日期未知</button></div></div>}</>;
}

export function ArchiveFeedback({ subjectId, disabled, revision, view = "actions", facts, onFactAction }: { subjectId: string; disabled: boolean; revision: number; view?: "actions" | "events"; facts: ArchiveFact[]; onFactAction: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [storedData, setData] = useState<FeedbackState>({ subjectId, cards: [], events: [] });
  const data: FeedbackState = storedData.subjectId === subjectId && !disabled ? storedData : { subjectId, cards: [], events: [] };
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState<{ outcome: FeedbackOutcome | ""; note: string; eventDate: string }>({ outcome: "", note: "", eventDate: "" });
  const drafts = useRef<Record<string, typeof draft>>({});
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const generation = useRef(0);
  const scope = useRef(0);
  const handledTarget = useRef("");
  useEffect(() => { scope.current++; return () => { scope.current++; }; }, [subjectId, disabled]);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError(""); setData(previous => previous.subjectId === subjectId ? previous : {subjectId,cards:[],events:[]});
    try { const result = await archiveRequest<FeedbackState>(`relationship-feedback?subjectId=${encodeURIComponent(subjectId)}`); if (result.subjectId !== subjectId) throw new Error("人物记录已变化，请重新打开档案。"); if (current === generation.current) setData(result); }
    catch (cause) { if (current === generation.current) { setError(cause instanceof Error ? cause.message : "读取行动记录失败。"); if ([401, 403, 404].includes((cause as { status?: number }).status || 0)) { setData({ subjectId, cards: [], events: [] }); setEditing(""); setDraft({ outcome: "", note: "", eventDate: "" }); drafts.current = {}; setNotice(""); } } }
    finally { if (current === generation.current) setLoading(false); }
  }, [subjectId]);
  useEffect(() => { if (!disabled) void load(); else { setData({ subjectId, cards: [], events: [] }); setEditing(""); setDraft({ outcome: "", note: "", eventDate: "" }); drafts.current = {}; setNotice(""); setBusy(false); setLoading(false); } return () => { generation.current++; }; }, [load, disabled, revision, subjectId]);
  useEffect(() => {
    if (view !== "actions" || loading || disabled || error || data.subjectId !== subjectId) return;
    const query = new URLSearchParams(window.location.search), target = query.get("followup") || "";
    if (!target || query.get("subjectId") !== subjectId || handledTarget.current === target) return;
    handledTarget.current = target;
    const card = data.cards.find(item => item.reportId === target);
    if (!card?.latest) { setNotice("这条建议已不在当前档案中，可以查看下面的其他进展。"); return; }
    setEditing(target); setDraft({ outcome: card.latest?.outcome || "", note: card.latest?.note || "", eventDate: card.latest?.eventDate || "" });
    requestAnimationFrame(() => document.getElementById(`feedback-${target}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" }));
  }, [view, loading, disabled, error, data, subjectId]);
  async function save(nextDraft = draft) {
    if (busy || disabled || !editing || !nextDraft.outcome) return;
    const currentScope = scope.current;
    setDraft(nextDraft); drafts.current[editing] = nextDraft;
    const payload = { subjectId, reportId: editing, ...nextDraft, confirmed: true }, fingerprint = JSON.stringify(payload);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true); setError(""); setNotice("");
    try { await archiveRequest("relationship-feedback", { ...payload, id: request.current.id }); if (currentScope !== scope.current) return; request.current = null; delete drafts.current[editing]; setEditing(""); setNotice("已记下这次进展，后续咨询可以结合这条反馈。记录反馈不扣积分。"); await load(); }
    catch (cause) { if (currentScope === scope.current) setError(cause instanceof Error ? cause.message : "反馈暂未保存，内容已保留。"); }
    finally { if (currentScope === scope.current) setBusy(false); }
  }
  async function remove(reportId: string) {
    if (busy || disabled || !window.confirm("删除这条建议的全部反馈与更正记录？原分析和基础资料会保留。")) return;
    const currentScope = scope.current;
    setBusy(true); setError(""); setNotice("");
    try { await archiveRequest("relationship-feedback", { subjectId, reportId, confirmed: true }, "DELETE"); if (currentScope !== scope.current) return; delete drafts.current[reportId]; setEditing(""); setNotice("反馈记录已删除。"); await load(); }
    catch (cause) { if (currentScope === scope.current) setError(cause instanceof Error ? cause.message : "反馈暂未删除。"); }
    finally { if (currentScope === scope.current) setBusy(false); }
  }
  return <section className={styles.card}><span className={styles.eyebrow}>{view === "actions" ? "自动对照新进展" : "聊天与行动"}</span><h2>{view === "actions" ? <MessageCircle size={20} /> : <History size={20} />}{view === "actions" ? "补充新聊天，接着看变化" : "关系进展记录"}</h2>{loading && <p role="status" className={styles.muted}>正在读取行动记录…</p>}{disabled && <p className={styles.muted}>恢复档案后可继续查看与记录。</p>}{!loading && !disabled && !error && !(view === "actions" ? data.cards.length : data.events.length) && <p className={styles.empty}>新的聊天会与这个人的既有材料对照；无需另外填写后续结果。</p>}
    {notice && <p role="status" className={styles.muted}>{notice}</p>}
    {view === "actions" && !disabled && <>{!data.automatic?.evidenceReview?.cards.length && data.automatic?.current && data.automatic.previous && <details className={styles.fact}><summary>回看两次分析摘要</summary><p><small>此前分析摘要</small><br/>{data.automatic.previous.summary}</p><p><small>本次分析摘要</small><br/>{data.automatic.current.summary}</p><p>{data.automatic.note}</p></details>}<a className={styles.primary} href={"/analyze?mode=chat&subjectId=" + encodeURIComponent(subjectId) + "&returnTo=" + encodeURIComponent("/archive?subjectId=" + subjectId + "&section=trend")}>补充新聊天 →</a></>}
    {view === "actions" && !disabled && data.subjectId === subjectId && <RelationshipEvidenceCards review={data.automatic?.evidenceReview}/>}
    {view === "actions" ? (data.cards.some(card => card.latest) && <details open={editing ? true : undefined} className={styles.footerGap}><summary>已记录的经历 · 查看与更正</summary><div className={styles.facts}>{data.cards.filter(card => card.latest).map(card => <article id={`feedback-${card.reportId}`} data-report-id={card.reportId} className={styles.fact} key={card.reportId}><span className={styles.badge}>{card.outcomeLabel}</span><p>{card.action}</p><small>{card.suggestedAt ? `建议记录于 ${new Date(card.suggestedAt).toLocaleDateString("zh-CN")}` : "历史建议"}</small><details><summary>当时判断与建议来源</summary><p>{card.sourceAvailable ? card.sourceSummary : "原判断摘要已不在当前历史中；保留原建议和反馈。"}</p><small>{card.sourceEventStart ? `${card.sourceEventStart}${card.sourceEventEnd && card.sourceEventEnd !== card.sourceEventStart ? ` 至 ${card.sourceEventEnd}` : ""}` : "材料发生日期未明确"}</small><a className={styles.link} href={`/report?id=${encodeURIComponent(card.reportId)}`}>查看分析报告 →</a></details>{card.latest && <><p>{card.latest.review}</p>{card.latest.note && <blockquote>{card.latest.note}</blockquote>}<small>发生于 {card.latest.eventDate || "日期未填"} · 反馈记录于 {new Date(card.latest.recordedAt).toLocaleDateString("zh-CN")}</small><details><summary>反馈历史 · {card.revisions.length} 次记录</summary>{card.revisions.map(item => <article key={item.id}><p>{item.revisionOf ? "更新反馈" : "首次反馈"} · {feedbackLabel(item.outcome)} · {item.eventDate || "日期未填"}</p><p>{item.review}</p><small>{item.note} · 记录于 {new Date(item.recordedAt).toLocaleString("zh-CN")}</small></article>)}</details></>}
      <div className={styles.actions}><button type="button" className={styles.button} disabled={busy || disabled} onClick={() => { if (editing) drafts.current[editing] = draft; setEditing(card.reportId); setDraft(drafts.current[card.reportId] || { outcome: card.latest?.outcome || "", note: card.latest?.note || "", eventDate: card.latest?.eventDate || "" }); }}>{card.latest ? "更新结果" : "记录结果"}</button>{card.latest && <button type="button" className={styles.danger} disabled={busy || disabled} onClick={() => void remove(card.reportId)}>删除反馈</button>}</div>
      {editing === card.reportId && <div className={styles.form}><h3>记录你确认发生的结果</h3><p className={styles.muted}>先选择结果，可以补充经过，确认后一起保存。</p><div className={styles.actions}>{([["not_done", "还没行动"], ["positive", "有进展"], ["waiting", "还在等回应"], ["uncomfortable", "让我不舒服"]] as const).map(([outcome, label]) => <button type="button" className={styles.button} key={outcome} aria-pressed={draft.outcome === outcome} disabled={busy || disabled} onClick={() => setDraft({ ...draft, outcome })}>{label}</button>)}</div><label className={styles.field}><span>实际结果</span><select value={draft.outcome} disabled={busy} onChange={event => setDraft({ ...draft, outcome: event.target.value as FeedbackOutcome })}><option value="">请选择</option>{feedbackOutcomes.map(value => <option value={value} key={value}>{feedbackLabel(value)}</option>)}</select></label><label className={styles.field}><span>补充一句（选填）</span><textarea maxLength={500} value={draft.note} disabled={busy} onChange={event => setDraft({ ...draft, note: event.target.value })} /></label><label className={styles.field}><span>实际发生日期（选填）</span><input type="date" value={draft.eventDate} disabled={busy} onChange={event => setDraft({ ...draft, eventDate: event.target.value })} /></label><div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || !draft.outcome} onClick={() => void save()}>{busy ? "正在保存…" : "确认记下结果"}</button><button type="button" className={styles.button} disabled={busy} onClick={() => { drafts.current[editing] = draft; setEditing(""); }}>收起</button></div></div>}
    </article>)}</div></details>) : <div className={styles.timeline}>{data.events.map(event => { const fact = facts.find(item => item.id === event.id); return <article key={event.id}><small>{event.eventDate || "日期未填"}{"dateKind" in event ? ` · ${event.dateKind}` : ""}</small><h3>{event.title}</h3><p>{event.action}</p>{event.note && <p>{event.note}</p>}<small>{event.source}{event.revisionCount > 1 ? " · 已更新结果" : ""}</small>{fact && <EventDateEditor fact={fact} disabled={busy || disabled} onSave={onFactAction} />}</article>; })}</div>}
    {error && <div className={styles.error} role="alert">{error}<div><button type="button" className={styles.link} disabled={busy} onClick={() => void load()}>重新读取记录</button></div></div>}
  </section>;
}
