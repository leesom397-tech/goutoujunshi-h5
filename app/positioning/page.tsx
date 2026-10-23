"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Compass, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { positioningGoals, positioningPriorities, type PositioningInput, type PositioningReport } from "@/lib/positioning";

const initial: PositioningInput = { goal: "long-term", priorities: [], selfPicture: "", constraints: "", boundaries: "", pattern: "" };

export default function PositioningPage() {
  const [input, setInput] = useState<PositioningInput>(initial);
  const [report, setReport] = useState<PositioningReport | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void fetch("/api/positioning", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) { setSignedOut(true); return; }
      if (!response.ok) throw new Error("已保存的定位暂时无法读取，你仍可以填写新问卷。");
      const data = await response.json() as { input: PositioningInput | null; report: PositioningReport | null; updatedAt: number | null };
      if (data.input) setInput(data.input);
      if (data.report) setReport(data.report);
      setSavedAt(data.updatedAt);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "读取失败，请稍后再试。"))
      .finally(() => setLoading(false));
  }, []);

  function edit(next: PositioningInput) { setInput(next); setReport(null); setError(""); setNotice(""); }
  function togglePriority(id: string) {
    const priorities = input.priorities.includes(id) ? input.priorities.filter((item) => item !== id) : [...input.priorities, id].slice(0, 3);
    edit({ ...input, priorities });
  }
  async function post(action: "generate" | "save") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/positioning", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input, ...(action === "save" ? { report } : {}) }),
      });
      const data = await response.json() as { input?: PositioningInput; report?: PositioningReport; updatedAt?: number; error?: string };
      if (!response.ok || !data.report) throw new Error(data.error || "暂时无法生成定位，请重试。");
      setReport(data.report);
      if (action === "save") { setSavedAt(data.updatedAt || Date.now()); setNotice("已保存。以后可以回来修改或删除。"); }
      else setNotice("定位报告已生成；这份新报告还没有保存。");
      window.setTimeout(() => document.getElementById("positioning-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "网络连接失败，请重试。"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm("删除已保存的择偶定位？删除后无法恢复。")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/positioning", { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "删除失败，请重试。");
      setInput(initial); setReport(null); setSavedAt(null); setNotice("已删除保存的定位资料。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败，请重试。"); }
    finally { setBusy(false); }
  }

  return <main className="positioning-page"><div className="positioning-wrap">
    <header className="profile-top"><a href="/" className="back-link"><ArrowLeft size={18} /> 返回工作台</a><span>成子 · 择偶定位</span></header>
    <section className="positioning-intro"><span className="eyebrow">不是给人标价，是减少无效试错</span><h1>你要找的，<br />究竟是哪一种关系？</h1><p>先厘清目标、底线和可协商的部分，再决定去哪里认识人、见面时观察什么。</p></section>
    {loading ? <section className="positioning-card" role="status">正在读取你的定位…</section> : signedOut ?
      <section className="positioning-card"><h2>先登录，再做定位</h2><p>填写的资料只对你的账号可见。</p><a className="positioning-primary" href="/login?return_to=%2Fpositioning">用 成子 账号登录 <ArrowRight size={18} /></a></section> :
      <div className="positioning-layout"><section className="positioning-card positioning-form" aria-label="择偶定位问卷">
        <div className="positioning-card-head"><Compass size={21} /><div><span>01 / 认识自己</span><h2>先定方向，不用填满所有条件</h2></div></div>
        <fieldset><legend>现在最想建立怎样的关系？</legend><div className="choice-grid">{positioningGoals.map((item) => <button key={item.id} type="button" className={input.goal === item.id ? "choice selected" : "choice"} aria-pressed={input.goal === item.id} onClick={() => edit({ ...input, goal: item.id })}>{item.label}</button>)}</div></fieldset>
        <fieldset><legend>最重要的 2–3 项是什么？</legend><p className="positioning-hint">只选真正会影响你长期相处的因素。</p><div className="priority-grid">{positioningPriorities.map((item) => <button key={item.id} type="button" className={input.priorities.includes(item.id) ? "choice selected" : "choice"} aria-pressed={input.priorities.includes(item.id)} onClick={() => togglePriority(item.id)}>{item.label}</button>)}</div></fieldset>
        <label className="positioning-field"><span>你现在的生活状态，以及能投入一段关系的时间与精力 <b>必填</b></span><textarea value={input.selfPicture} maxLength={500} rows={3} onChange={(event) => edit({ ...input, selfPicture: event.target.value })} placeholder="例如：工作比较忙，但周末有时间见面；希望双方能认真了解，不想长期只在线上聊天。" /></label>
        <div className="positioning-two-fields"><label className="positioning-field"><span>现实限制 <small>可留空</small></span><textarea value={input.constraints} maxLength={300} rows={3} onChange={(event) => edit({ ...input, constraints: event.target.value })} placeholder="城市、作息、未来计划、家庭安排…" /></label><label className="positioning-field"><span>我的底线 <small>可留空</small></span><textarea value={input.boundaries} maxLength={300} rows={3} onChange={(event) => edit({ ...input, boundaries: event.target.value })} placeholder="哪些事不能接受？例如不尊重拒绝、长期失约。" /></label></div>
        <label className="positioning-field"><span>过去反复遇到的关系模式 <small>可留空</small></span><textarea value={input.pattern} maxLength={300} rows={2} onChange={(event) => edit({ ...input, pattern: event.target.value })} placeholder="例如：我容易被很热情的人吸引，后来发现只有我在推进。" /></label>
        <div className="positioning-actions"><button type="button" className="positioning-primary" disabled={busy} onClick={() => void post("generate")}>{busy ? "正在整理…" : "生成我的择偶定位"}<ArrowRight size={18} /></button><span><ShieldCheck size={15} /> 站内整理；问卷不发送至外部分析服务，点击保存前不会入库。</span></div>
      </section>
      <aside className="positioning-aside"><section className="positioning-card"><span className="eyebrow">定位之后能得到什么</span><h2>不是一张“你值几分”的表</h2><ol><li>优先找什么样的相处方式</li><li>哪些条件是底线，哪些可以再聊</li><li>初识与约会时怎样验证</li><li>本周能做的一个小动作</li></ol></section><section className="positioning-card positioning-note"><strong>一个重要提醒</strong><p>偏好是起点，不是对陌生人的判决。真正的适配，要看双方持续投入、边界和兑现。</p>{savedAt && <button type="button" className="positioning-delete" disabled={busy} onClick={() => void remove()}><Trash2 size={15} /> 删除已保存的定位</button>}</section></aside></div>}
    {error && <div className="positioning-message error" role="alert">{error}</div>}{notice && <div className="positioning-message" role="status">{notice}</div>}
    {!signedOut && report && <section className="positioning-result" id="positioning-result" aria-label="择偶定位报告"><div className="positioning-result-head"><div><span className="eyebrow">02 / 你的定位底稿</span><h2>把偏好变成可验证的选择</h2></div><span className="positioning-status">{savedAt && !notice.includes("没有保存") && !notice.includes("还没有保存") ? "有已保存版本" : "尚未保存"}</span></div><p className="positioning-lead">{report.position}</p><div className="positioning-report-grid"><article><h3>更适合认识的人</h3><p>{report.bestFit}</p></article><article><h3>优先守住</h3><ul>{report.mustHave.map((item, index) => <li key={index}>{item}</li>)}</ul></article><article><h3>可以先不判死</h3><ul>{report.flexible.map((item, index) => <li key={index}>{item}</li>)}</ul></article><article><h3>容易误判的点</h3><ul>{report.watchOut.map((item, index) => <li key={index}>{item}</li>)}</ul></article><article><h3>从哪里开始认识</h3><ul>{report.whereToMeet.map((item, index) => <li key={index}>{item}</li>)}</ul></article><article><h3>见面时怎么验证</h3><ul>{report.verify.map((item, index) => <li key={index}>{item}</li>)}</ul></article></div><div className="positioning-next"><span>本周只做一件事</span><p>{report.nextAction}</p></div><div className="positioning-result-actions"><button type="button" className="positioning-primary" disabled={busy} onClick={() => void post("save")}>{busy ? "保存中…" : "保存这份定位"}</button><button type="button" className="positioning-secondary" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><RotateCcw size={16} /> 返回修改</button><a href="/profile">去关系档案看正在接触的人 →</a></div><p className="positioning-disclaimer">这是根据你填写的条件整理出的定位底稿，不是人格测验、市场身价或对某个人的匹配结论。对方是否适合，仍要靠双方真实相处验证。</p></section>}
  </div></main>;
}

