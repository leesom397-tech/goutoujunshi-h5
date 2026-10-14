"use client";

import { useId, useRef, useState } from "react";
import { ArrowRight, Check, Copy, GitCompareArrows, HeartHandshake, Lightbulb, MessageCircle, Quote, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { personalConnection, type PersonalEvidence, type PersonalInsight } from "@/lib/personal-context";
import { personalConversationStarter } from "@/lib/personal-starters";
import { riskAwarePresentation } from "@/lib/risk-aware-presentation";
import { CaptureEvidence } from "./CaptureEvidence";
import type { Json } from "./client";
import styles from "./PersonalConnection.module.css";

const sourceName: Record<PersonalEvidence["source"], string> = {
  "self-profile": "你的资料", "subject-profile": "人物档案", chat: "聊天原话", moments: "朋友圈动态", "social-profile": "主页自述",
};

const topicWords: Record<string, RegExp> = {
  photography: /摄影|拍照|拍摄|胶片|相机|街拍/, art: /展|艺术|美术|设计|审美|博物馆/, outdoors: /徒步|登山|爬山|露营|潜水|滑雪|骑行|户外|散步/,
  quiet: /独处|安静|空间/, planning: /提前|约好|安排|时间/, career: /事业|工作|项目|职业|创业|学习|成长/, expectation: /关系|恋爱|承诺|结婚/,
};
function evidenceExcerpt(quote: string, insightId: string) {
  const match = topicWords[insightId.replace(/^(common|entry|topic|difference)-/, "")];
  const clauses = match ? quote.split(/(?<=[。！？；;])|[，,]/u).filter(clause => match.test(clause)) : [];
  const excerpt = clauses.length ? clauses.join("，") : quote;
  return excerpt.length > 125 ? excerpt.slice(0, 125) + "…" : excerpt;
}

function Sources({ rows, insightId }: { rows: PersonalEvidence[]; insightId: string }) {
  return <div className={styles.sources}>{rows.map(row => <div className={styles.source} data-side={row.side} key={row.id}>
    <span><UserRound size={15}/>{row.side === "self" ? "你" : "对方"}<small>{row.label || sourceName[row.source]}</small></span>
    <blockquote>{evidenceExcerpt(row.quote, insightId)}</blockquote>
    {row.source !== "self-profile" && row.source !== "subject-profile" && <CaptureEvidence quote={row.quote}/>}
  </div>)}</div>;
}

function ConversationStarter({ text, title }: { text: string; title: string }) {
  const id = useId(), input = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(text), [notice, setNotice] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(draft.trim()); setNotice("已复制，可以按你的习惯调整后再发。"); }
    catch {
      input.current?.focus(); input.current?.select();
      let copied = false;
      try { copied = document.execCommand("copy"); } catch { /* Keep the text selected for manual copying. */ }
      setNotice(copied ? "已复制，可以按你的习惯调整后再发。" : "文字已选中，请手动复制。");
    }
  }
  return <div className={styles.starter} data-personal-starter>
    <label htmlFor={id}><MessageCircle size={16}/>从这个话题接一句</label>
    <textarea ref={input} id={id} rows={2} maxLength={500} aria-label={`${title}的开场白`} value={draft} onChange={event => { setDraft(event.target.value); setNotice(""); }}/>
    <div><small>可以直接改字，复制后由你决定是否发送。</small><button type="button" disabled={!draft.trim()} onClick={() => void copy()}><Copy size={15}/>{notice.startsWith("已复制") ? "已复制" : "复制这句话"}</button></div>
    {notice && <p role="status">{notice}</p>}
  </div>;
}

/** Common-point counts require two visible sources; one-sided material stays a conversation lead. */
export function PersonalConnection({ report, publicExample = false, compact = false }: { report: Json; publicExample?: boolean; compact?: boolean }) {
  const id = useId(), result = personalConnection(report), risk = riskAwarePresentation(report);
  if (result.status === "self") return null;
  const evidenceFor = (item: PersonalInsight) => result.sources.filter(source => item.evidenceIds.includes(source.id) && source.quote.trim());
  const bothSides = (item: PersonalInsight) => {
    const evidence = evidenceFor(item);
    return evidence.some(row => row.side === "self") && evidence.some(row => row.side === "other");
  };
  const common = result.commonPoints.filter(item => item.kind === "supported" && bothSides(item));
  const topics = [...result.entryPoints, ...result.commonPoints.filter(item => !common.includes(item))]
    .filter((item, index, all) => evidenceFor(item).length > 0 && !common.some(point => point.evidenceIds.length === item.evidenceIds.length && point.evidenceIds.every(sourceId => item.evidenceIds.includes(sourceId))) && all.findIndex(other => other.id === item.id || other.title === item.title) === index);
  const differences = result.differences.filter(item => evidenceFor(item).length > 0);
  const hasSelf = result.sources.some(source => source.side === "self" && source.quote.trim());
  const reportId = report.reportId || report.id;
  const quickHref = "/archive?tab=self&quick=1" + (reportId ? "&returnTo=" + encodeURIComponent(`/report?id=${encodeURIComponent(reportId)}`) : "");
  const showRows = (items: PersonalInsight[], category: "common" | "topic" | "difference") => items.map(item => {
    const starter = category !== "difference" && risk.mode === "normal" ? personalConversationStarter(item, result.sources) : "";
    return <article className={styles.insight} data-personal-kind={category} key={item.id}>
    <header><h3>{category === "common" ? <Check size={18}/> : category === "difference" ? <GitCompareArrows size={18}/> : <MessageCircle size={18}/>}<span>{item.title}</span></h3><span className={styles.badge}>{category === "common" ? "双方有依据" : "相处推测"}</span></header>
    <p>{item.reading}</p>
    <Sources rows={evidenceFor(item)} insightId={item.id}/>
    {category !== "common" && item.alternative && <p className={styles.alternative}><Lightbulb size={16}/><span>也可能：{item.alternative}</span></p>}
    {item.action && !starter && (risk.mode === "normal" || risk.mode === "expectation" && category === "difference") && <div className={styles.action}><ArrowRight size={17}/><div><strong>{category === "difference" ? "相处时留意" : "可以这样接近"}</strong><p>{item.action}</p></div></div>}
    {starter && <ConversationStarter key={`${reportId || "current"}:${item.id}:${evidenceFor(item).map(row => row.quote).join("|")}`} title={item.title} text={starter}/>}
  </article>; });

  return <section className={styles.connection} data-personal-connection data-personal-status={result.status} aria-labelledby={`${id}-heading`}>
    <header className={styles.heading}><div><span className={styles.eyebrow}><HeartHandshake size={19}/>与你有关{publicExample && <small>虚构案例</small>}</span><h2 id={`${id}-heading`}>{common.length ? <>你们的共同点 <span>· {common.length}</span></> : hasSelf ? "从你们各自的表达，找到切入点" : "先从这份材料，找到可聊的话题"}</h2><p>{result.summary || (hasSelf ? "对照已有资料和当前原话，看你们哪里相近、怎样自然接话。" : "目前还没有足够的本人信息，不把对方的兴趣当成你们的共同点。")}</p></div>{!publicExample && (!hasSelf || result.status === "limited") && <a className={styles.quickLink} href={quickHref}><UserRound size={17}/>快速补充我<ArrowRight size={16}/></a>}</header>
    {risk.mode !== "normal" && !compact && <p className={styles.priority} data-personal-priority><ShieldCheck size={18}/>{risk.mode === "safety" ? "共同点仍可核对；当前先处理上方的安全与边界提醒，再决定是否继续接近。" : "共同点可以帮助了解，但请先确认双方的关系期待是否一致。上方已准备了确认期待的回复。"}</p>}
    {common.length > 0 && <><div className={styles.chips} aria-label="有双侧依据的共同点">{common.map(item => <span key={item.id}><Check size={16}/>{item.title}</span>)}</div>{!compact && <div className={styles.grid}>{showRows(common, "common")}</div>}{compact && <p className={styles.compactNote}><UsersRound size={17}/>案例中的本人资料与对方材料都已对照；展开完整案例，可查看每条双侧来源。</p>}</>}
    {!compact && topics.length > 0 && <div className={styles.group}><h3 className={styles.groupTitle}><MessageCircle size={20}/>可以聊的话题 <small>有材料可接，不假装已经相同</small></h3><div className={styles.grid}>{showRows(topics, "topic")}</div></div>}
    {!compact && differences.length > 0 && <div className={styles.group} data-personal-differences><h3 className={styles.groupTitle}><GitCompareArrows size={20}/>相处时，留意这些不同</h3><div className={styles.grid}>{showRows(differences, "difference")}</div></div>}
    {!common.length && !topics.length && !differences.length && <p className={styles.empty}><Quote size={18}/>{hasSelf ? "当前材料还不足以找到可核对的交集。先按上方建议回应，后续明确表达会继续补充对照。" : "先看当前材料中的判断与建议；你之后补充的偏好和明确原话，可以让建议更贴近你。"}</p>}
    {!compact && !hasSelf && result.missing.length > 0 && <p className={styles.missing}>{result.missing.slice(0, 2).join(" ")} 不影响继续看本次报告。</p>}
  </section>;
}
