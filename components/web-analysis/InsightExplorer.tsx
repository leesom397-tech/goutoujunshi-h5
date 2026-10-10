"use client";

import { useId, useState, type CSSProperties } from "react";
import { ArrowRight, ChartNoAxesCombined, CheckCheck, ChevronRight, GitBranch, Lightbulb, MessageCircle, ScanEye, Sparkles } from "lucide-react";
import { followup, message, type Json } from "./client";
import "./insight-explorer.css";

type Insight = { title: string; observed: string; interpretation: string; alternative: string; verify: string };
type StepKey = "observed" | "interpretation" | "alternative" | "verify";
type FollowupAction = "verify" | "alternative" | "wording";
const words = (value: unknown, limit = 500) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const records = (value: unknown): Json[] => Array.isArray(value) ? value.filter(row => row && typeof row === "object" && !Array.isArray(row)) : [];
const score = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const steps: { key: StepKey; label: string; caption: string; icon: typeof ScanEye }[] = [
  { key: "observed", label: "观察依据", caption: "先看材料里发生了什么", icon: ScanEye },
  { key: "interpretation", label: "深层推测", caption: "这些线索可能怎样关联", icon: Lightbulb },
  { key: "alternative", label: "另一种解释", caption: "保留能改变判断的可能", icon: GitBranch },
  { key: "verify", label: "验证观察", caption: "让下一轮真实反馈说话", icon: CheckCheck },
];
const followupActions: { key: FollowupAction; label: string; icon: typeof ScanEye }[] = [
  { key: "verify", label: "核实这个判断", icon: ScanEye },
  { key: "alternative", label: "还有哪些解释", icon: GitBranch },
  { key: "wording", label: "帮我想个自然问法", icon: MessageCircle },
];

/** Carry only the chosen hypothesis and available evidence; a question is not a new finding. */
export function insightFollowupFocus(insight: Insight, selectedStep: StepKey, action: FollowupAction) {
  const selected = steps.find(item => item.key === selectedStep) || steps[1];
  const title = words(insight.title, 60) || "这条推测";
  const parts = ["这是报告中的待验证推测，不是已确认的人物事实。", `我正在看：${title}`, `所选步骤：${selected.label}`, `所选内容：${words(insight[selected.key], 300)}`];
  for (const item of steps) if (item.key !== selected.key && words(insight[item.key])) parts.push(`${item.label}：${words(insight[item.key], item.key === "observed" || item.key === "interpretation" ? 180 : 100)}`);
  const questions: Record<FollowupAction, string> = {
    verify: `关于「${title}」，现在最缺哪条信息？帮我想一个不施压、不反复试探的核实方式。请先对照已有依据。`,
    alternative: `关于「${title}」，还可能有哪些更普通的解释？请分清已有证据和猜测，说说什么新信息会让这个判断改变。`,
    wording: `关于「${title}」里的${selected.label}，帮我想一句自然、尊重边界的话。如果现在不适合发消息，也请直说，并给我一个更合适的下一步。`,
  };
  return { title: `${title} · ${selected.label}`, summary: parts.join("\n").slice(0, 900), question: questions[action] };
}

/** Every displayed measure is derived from the supplied report, never from invented confidence. */
export function insightExplorerData(report: Json, kind: "chat" | "social") {
  const source = kind === "chat" ? report.decision || {} : report.moments || report;
  const insights: Insight[] = [];
  const pattern = source.interactionInsight;
  if (pattern && words(pattern.observed) && words(pattern.interpretation)) insights.push({ title: words(pattern.label, 60) || "本轮互动线索", observed: words(pattern.observed), interpretation: words(pattern.interpretation), alternative: words(pattern.alternative), verify: words(pattern.verify) });
  for (const row of records(source.hypotheses).slice(0, 6)) {
    const insight = { title: words(row.title, 60), observed: words(row.evidence), interpretation: words(row.possibility), alternative: words(row.alternative), verify: words(row.verify) };
    if (insight.title && insight.observed && insight.interpretation && !insights.some(item => item.title === insight.title || item.interpretation === insight.interpretation)) insights.push(insight);
  }
  const lines = kind === "chat" ? records(report.lines).filter(row => words(row.text)).map(row => ({ speaker: row.speaker === "self" ? "self" : row.speaker === "other" ? "other" : "unknown", text: words(row.text, 160) })) : [];
  const counts = { self: 0, other: 0, unknown: 0 };
  for (const line of lines) counts[line.speaker as keyof typeof counts]++;
  const fit = report.latestCompatibility ?? report.compatibility ?? report;
  const dimensions = kind === "social" ? records(fit?.fit).filter(row => words(row.dimension)) : [];
  const known = dimensions.filter(row => score(row.score) || score(row.value)).length;
  return { judgment: words(source.judgment || source.summary || source.possibleIntent || report.summary, 360), insights, lines, counts, coverage: dimensions.length ? { known, total: dimensions.length } : null };
}

function CompositionRing({ rows, total, label }: { rows: { key: string; label: string; value: number }[]; total: number; label: string }) {
  let offset = 0;
  return <div className="ix-composition"><div className="ix-ring"><svg viewBox="0 0 160 160" role="img" aria-label={rows.map(row => `${row.label} ${row.value}，共 ${total}`).join("；")}><circle className="ix-ring-base" cx="80" cy="80" r="62" fill="none" strokeWidth="12"/>{rows.filter(row => row.value > 0).map(row => { const value = row.value / total * 100, start = offset; offset += value; return <circle key={row.key} className={"ix-ring-value ix-tone-" + row.key} cx="80" cy="80" r="62" fill="none" strokeWidth="12" pathLength="100" strokeDasharray={`${value} ${100 - value}`} strokeDashoffset={-start} transform="rotate(-90 80 80)"/>; })}</svg><div><strong>{total}</strong><span>{label}</span></div></div><div className="ix-counts">{rows.map(row => <div key={row.key}><span><i className={"ix-dot ix-tone-" + row.key}/>{row.label}</span><b>{row.value}<small> / {total}</small></b></div>)}</div></div>;
}

export function InsightExplorer({ report, kind, owner }: { report: Json; kind: "chat" | "social"; owner?: string }) {
  const id = useId(), [selectedIndex, setSelectedIndex] = useState(0), [selectedStep, setSelectedStep] = useState<StepKey>("interpretation");
  const [followupError, setFollowupError] = useState("");
  const data = insightExplorerData(report, kind), insight = data.insights[Math.min(selectedIndex, data.insights.length - 1)];
  const availableSteps = insight ? steps.filter(step => insight[step.key]) : [];
  const step = availableSteps.find(item => item.key === selectedStep) || availableSteps[0];
  const chart = data.lines.length > 0 || !!data.coverage;
  if (!insight && !chart) return null;
  const Icon = step?.icon || ScanEye;
  function askAbout(action: FollowupAction) {
    if (!owner || !insight || !step) return;
    setFollowupError("");
    try { followup(report, owner, kind === "chat" ? "聊天洞察追问" : report.moments ? "朋友圈洞察追问" : "社交洞察追问", insightFollowupFocus(insight, step.key, action)); }
    catch (cause) { setFollowupError(message(cause)); }
  }
  return <section className="insight-explorer" id="insights" aria-label="互动洞察画布">
    <header className="ix-heading"><div><span className="ix-eyebrow"><Sparkles size={15}/>洞察，可以继续深入</span><h2>从看见的线索，到可验证的判断。</h2><p>{insight ? "展开每一步，看清推测从哪里来，也看看它何时需要改变。" : "先读本组材料的真实构成，再结合上下文理解。"}</p></div>{insight && <span className="ix-evidence-badge"><ScanEye size={15}/>{data.insights.length} 条有材料依据的推测</span>}</header>
    <div className={"ix-layout" + (chart && insight ? " ix-with-chart" : "")}>
      {insight && <div className="ix-reasoning">
        {data.insights.length > 1 && <div className="ix-hypotheses" role="group" aria-label="选择想展开的推测">{data.insights.map((item, index) => <button type="button" key={item.title} aria-pressed={item === insight} onClick={() => setSelectedIndex(index)}><span>{String(index + 1).padStart(2, "0")}</span>{item.title}<ChevronRight size={14}/></button>)}</div>}
        <div className="ix-map">
          <div className="ix-hub"><span className="ix-hub-orbit one" aria-hidden="true"/><span className="ix-hub-orbit two" aria-hidden="true"/><div className="ix-hub-icon"><Sparkles size={25} strokeWidth={1.5}/></div><span className="ix-hub-label">当前材料下的暂定判断</span><h3>{data.judgment || insight.title}</h3><span className="ix-hub-foot">随着新线索，继续修正<ArrowRight size={13}/></span></div>
          <div className="ix-path" role="tablist" aria-label="展开推测过程">{availableSteps.map((item, index) => { const StepIcon = item.icon; const selected = item.key === step?.key; return <button className={"ix-node ix-node-" + item.key} type="button" key={item.key} role="tab" id={`${id}-${item.key}`} aria-controls={`${id}-detail`} aria-selected={selected} tabIndex={selected ? 0 : -1} style={{ "--ix-order": index } as CSSProperties} onClick={() => setSelectedStep(item.key)} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? availableSteps.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + availableSteps.length) % availableSteps.length; setSelectedStep(availableSteps[next].key); document.getElementById(`${id}-${availableSteps[next].key}`)?.focus(); }}><span className="ix-node-top"><StepIcon size={20} strokeWidth={1.6}/><small>0{index + 1}</small></span><strong>{item.label}</strong><span className="ix-node-caption">{item.caption}</span><ArrowRight className="ix-node-arrow" size={14}/></button>; })}</div>
        </div>
        {step && <div className={"ix-detail ix-detail-" + step.key} id={`${id}-detail`} role="tabpanel" aria-labelledby={`${id}-${step.key}`} tabIndex={0}><div className="ix-detail-title"><span><Icon size={18}/>{step.label}</span><small>{insight.title}</small></div><p key={`${insight.title}-${step.key}`}>{insight[step.key]}</p><div className="ix-detail-nav">{availableSteps.map(item => <button type="button" key={item.key} aria-label={`查看${item.label}`} aria-pressed={step.key === item.key} onClick={() => setSelectedStep(item.key)}><span/></button>)}</div></div>}
        {step && <div className="ix-followup" aria-label="围绕当前洞察继续问"><div className="ix-followup-heading"><MessageCircle size={17}/><strong>这一点，还想聊聊？</strong><span>围绕「{insight.title}」</span></div><div className="ix-followup-actions">{followupActions.map(action => { const ActionIcon = action.icon; return <button type="button" key={action.key} data-followup={action.key} disabled={!owner} onClick={() => askAbout(action.key)}><ActionIcon size={16}/>{action.label}<ArrowRight size={14}/></button>; })}</div><p className="ix-followup-note">{owner ? "会带上当前这条洞察和问题。进入聊天后可修改，确认发送时按文字咨询计费。" : "登录后可带着当前洞察继续问。"}</p>{followupError && <p className="ix-followup-error" role="alert">{followupError}</p>}</div>}
        <p className="ix-scope"><GitBranch size={14}/>推测不是已确认事实。新回应、完整上下文和明确边界都可能改变判断。</p>
      </div>}
      {chart && <aside className="ix-materials" aria-label="本组材料构成">{data.lines.length > 0 ? <><div className="ix-chart-heading"><MessageCircle size={19}/><h3>本组消息构成</h3></div><CompositionRing total={data.lines.length} label="条可读消息" rows={[{key:"self",label:"我发出的",value:data.counts.self},{key:"other",label:"对方发出的",value:data.counts.other},...(data.counts.unknown ? [{key:"unknown",label:"身份未明确",value:data.counts.unknown}] : [])]}/><div className="ix-sequence"><div><strong>发送顺序</strong><small>{data.lines.length > 32 ? "最近 32 条" : "按材料中的顺序"}</small></div><ol aria-label="本组可读消息的发送顺序">{data.lines.slice(-32).map((line, index, all) => <li key={index} className={"ix-tone-" + line.speaker} style={{ "--ix-order": index } as CSSProperties} title={`${data.lines.length - all.length + index + 1}. ${line.speaker === "self" ? "我" : line.speaker === "other" ? "对方" : "身份未明确"}：${line.text}`}><span>{line.speaker === "self" ? "我" : line.speaker === "other" ? "TA" : "?"}</span></li>)}</ol></div><p className="ix-chart-note">只统计本组已识别消息，数量和排列不代表投入程度、回复速度或喜欢的概率。</p></> : data.coverage ? <><div className="ix-chart-heading"><ChartNoAxesCombined size={19}/><h3>适配资料覆盖</h3></div><CompositionRing total={data.coverage.total} label="项报告维度" rows={[{key:"known",label:"可计分维度",value:data.coverage.known},{key:"unknown",label:"仍待了解",value:data.coverage.total-data.coverage.known}]}/><p className="ix-chart-note">只按报告已返回的数字参考计数。资料缺失保留待了解，不作为零分，也不等于不适合。</p></> : null}</aside>}
    </div>
  </section>;
}
