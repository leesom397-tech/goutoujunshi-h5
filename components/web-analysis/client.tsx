"use client";
import { useEffect, useRef, useState } from "react";
import ui from "@/components/AuroraUI.module.css";
export type Json = Record<string, any>;
export class WebError extends Error { constructor(message: string, public status = 0, public details: Json = {}) { super(message); } }
export async function api(path: string, body?: Json, signal?: AbortSignal): Promise<Json> {
  let response: Response;
  try { response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json", ...(body.taskId || body.requestId ? { "X-Request-Id": String(body.taskId || body.requestId) } : {}) }, body: JSON.stringify(body) } : {}), signal }); }
  catch (error) { if (signal?.aborted) throw error; throw new WebError("连接中断，输入与任务已保留，请重试。"); }
  const data = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new WebError(data.error || (response.status === 401 ? "请登录后继续。" : "暂时无法完成，请稍后重试。"), response.status, data);
  return data;
}
export const message = (error: unknown) => error instanceof Error ? error.message : "暂时无法完成，请稍后重试。";
export function useAccount() {
  const [account, setAccount] = useState<Json | null>(null), [people, setPeople] = useState<Json[]>([]), [error, setError] = useState(""), [unauthorized, setUnauthorized] = useState(false);
  const generation = useRef(0), mounted = useRef(true), owner = useRef<string | null>(null);
  async function refresh() {
    const current = ++generation.current;
    const active = () => mounted.current && current === generation.current;
    try {
      const value = await api("/api/account/credits"); if (!active()) return;
      if (owner.current !== value.account?.userId) { setPeople([]); owner.current = value.account?.userId || null; }
      setAccount(value); setUnauthorized(false); setError("");
      const profile = await api("/api/web/profile").catch(e => { if (e instanceof WebError && e.status === 401) throw e; return null; }); if (active() && profile) setPeople(profile.enabled && !profile.paused ? profile.subjects || [] : []);
    } catch (e) { if (!active()) return; setError(message(e)); const loggedOut = e instanceof WebError && e.status === 401; setUnauthorized(loggedOut); if (loggedOut) { setAccount(null); setPeople([]); owner.current = null; } }
  }
  useEffect(() => { mounted.current = true; void refresh(); const focus = () => { if (!document.hidden) void refresh(); }; window.addEventListener("focus", focus); window.addEventListener("chengzi:credits-changed", focus); return () => { mounted.current = false; generation.current++; window.removeEventListener("focus", focus); window.removeEventListener("chengzi:credits-changed", focus); }; }, []);
  return { account, people, error, unauthorized, refresh };
}
export function ErrorNotice({ error }: { error: string }) { return error ? <p className="wa-error" role="alert">{error}</p> : null; }
export function AccountNotice({ state }: { state: ReturnType<typeof useAccount> }) {
  if (state.unauthorized) return <section className={`${ui.panel} ${ui.notice}`}><h2>登录后开始</h2><p>使用你的网页账号查看积分与人物档案。</p><a className={ui.primary} href={`/login?return_to=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/analyze")}`}>登录账号</a></section>;
  if (state.error) return <section className={`${ui.panel} ${ui.notice}`}><ErrorNotice error={state.error}/><button className={ui.secondary} onClick={() => void state.refresh()}>重新连接</button></section>;
  return null;
}
export function PersonSelect({ people, value, onChange, disabled = false, empty = "本次不使用人物档案" }: { people: Json[]; value: string; onChange: (value: string) => void; disabled?: boolean; empty?: string }) {
  return <label className="wa-field">关联人物<select value={value} onChange={event => onChange(event.target.value)} disabled={disabled}><option value="">{empty}</option>{people.map(person => <option key={person.id} value={person.id}>{person.label}</option>)}</select></label>;
}
export function hasPrice(account: Json | null, key: string) { const price = account?.prices?.[key]; return typeof price === "number" && Number.isFinite(price) && price >= 0; }
export function priceLabel(account: Json | null, key: string, suffix = "积分") { return hasPrice(account, key) ? `${account!.prices[key]} ${suffix}` : "价格暂未取回"; }
export function saveLocal(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
export function readLocal<T>(key: string): T | null { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } }
export function followup(report: Json, accountId: string, source = "聊天分析", focus?: { title: string; summary: string; question: string }) {
  if (!accountId) throw new Error("请登录后继续追问。");
  const value = report.moments || report.decision || report;
  const short = (text: unknown, max: number) => typeof text === "string" ? text.replace(/[\r\n]+/g, " ").slice(0, max) : "";
  const parts = ["这是待验证的分析，不是已确认事实。", "总评：" + short(value.summary || value.judgment || value.possibleIntent, 140)];
  if (value.interactionInsight) { const row = value.interactionInsight; parts.push("深层推测：" + short(row.interpretation, 100), "观察依据：" + short(row.observed, 100), "另一种解释：" + short(row.alternative, 70), "下一轮观察：" + short(row.verify, 70)); }
  if (value.evidence) parts.push("依据：" + short(value.evidence, 120));
  if (value.nextStep) parts.push("下一步：" + short(value.nextStep, 100));
  for (const row of (value.hypotheses || []).slice(0, 2)) parts.push("待验证推测：" + short(row.possibility, 70), "依据：" + short(row.evidence, 55), "另一种可能：" + short(row.alternative, 45), "可观察：" + short(row.verify, 35));
  if (value.approach) for (const [key, label] of [["attitude", "相处态度"], ["emotion", "情绪承接"], ["pace", "节奏"], ["avoid", "避免"], ["evidence", "建议依据"], ["adjustWhen", "何时调整"]]) if (value.approach[key]) parts.push(label + "：" + short(value.approach[key], 35));
  for (const row of (report.lines || []).slice(-4)) parts.push((row.speaker === "self" ? "我" : row.speaker === "other" ? "对方" : "待确认") + "：" + short(row.text, 70));
  for (const row of (report.moments ? value.behaviorClues || [] : report.visibleFacts || []).slice(0, 2)) parts.push("可见材料：" + short(row.quote || row.title, 25) + "；" + short(row.evidence, 40));
  // A focused question must carry the selected evidence before the general
  // summary; otherwise long reports can crowd the requested detail out.
  const summary = focus
    ? ["这是用户选中的待验证分析，不是已确认事实。", focus.summary.trim().slice(0, 900), "本轮总评：" + short(value.summary || value.judgment || value.possibleIntent, 120)].join("\n").slice(0, 1100)
    : parts.filter(Boolean).join("\n").slice(0, 1100);
  const key = crypto.randomUUID();
  try { sessionStorage.setItem(`web-followup:${key}`, JSON.stringify({ accountId, reportId: report.id || "", title: focus ? short(focus.title, 80) : source, subjectId: report.subjectId || "", summary, ...(focus ? { question: focus.question.trim().slice(0, 1500) } : {}), expiresAt: Date.now() + 30 * 60_000 })); }
  catch { throw new Error("浏览器未能保存追问上下文，请允许此站点使用存储后重试。"); }
  window.location.href = `/chat?context=${key}`;
}
export function encodeBase64(bytes: Uint8Array) { let output = ""; for (let i = 0; i < bytes.length; i += 8192) output += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(output); }




export function InlinePerson({ disabled = false, onCreated }: { disabled?: boolean; onCreated: (id: string) => void | Promise<void> }) {
  const [name, setName] = useState(""), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false);
  const pending = useRef<{ id: string; label: string } | null>(null);
  async function create() { if (!name.trim() || !consent || busy) return; setBusy(true); setError(""); try { const state = await api("/api/web/profile"); if (!state.enabled || state.paused) await api("/api/web/profile", { action: "consent", enabled: true }); pending.current ||= { id: crypto.randomUUID(), label: name.trim() }; const created = await api("/api/web/profile", { action: "create-manual", ...pending.current, data: {}, confirmed: true }); if (created.createdSubjectId !== pending.current.id) throw new Error("建档结果尚未确认，再次点击会核对同一人物。"); await onCreated(created.createdSubjectId); setDone(true); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  if (done) return <p className="wa-muted" role="status">已建立「{name}」的人物档案。</p>;
  return <details><summary>还没有档案？在这里新建人物</summary><label className="wa-field">人物称呼<input maxLength={60} disabled={disabled || busy || !!pending.current} value={name} onChange={e => setName(e.target.value)} placeholder="例如：小林"/></label><label className="wa-check"><input type="checkbox" checked={consent} disabled={disabled || busy || !!pending.current} onChange={e => setConsent(e.target.checked)}/>同意保存我有权提供的资料用于关系分析，并启用或恢复人物档案。</label><button disabled={disabled || busy || !consent || !name.trim()} onClick={() => void create()}>{busy ? "建档中…" : pending.current ? "核对并重试建档" : "建立并选择此人物"}</button><ErrorNotice error={error}/></details>;
}
