"use client";
import { reportPersonLabel } from "./report-person-label";
import { useState } from "react";
import { ReplyPaths } from "@/components/ReplyPaths";
import { KnowledgeBasis } from "@/components/KnowledgeBasis";
import type { ReplyPaths as Paths } from "@/lib/reply-paths";
import type { KnowledgeSource } from "@/lib/knowledge-public";
export type Analysis = {summary:string;observations:Array<{claim:string;evidence:string;uncertainty:string}>;questions:string[];lineInsights:Array<{quote:string;speaker:string;signal:string;alternative:string;certainty:string}>;replyOptions:Array<{text:string;when:string;next?:Paths}>;knowledgeSources?:KnowledgeSource[];reportId?:string};

export function AnalysisCard({ title, result, main = false }: { title: string; result: Analysis; main?: boolean }) {
  return <article className={"analysis-card " + (main ? "main" : "")}><h3>{title}</h3><p>{result.summary}</p>{result.observations.length > 0 && <div className="observation-list">{result.observations.map((item, index) => <div key={index}><strong>{item.claim}</strong><small>依据：{item.evidence || "材料未提供可核对原话"}</small><small>仍未知：{item.uncertainty || "需结合线下实际行为"}</small></div>)}</div>}{result.questions.length > 0 && <p className="next-questions">继续判断前可核对：{result.questions.join("；")}</p>}<KnowledgeBasis sources={result.knowledgeSources} /></article>;
}

export function ConversationPanel({ result, me, other, ready }: { result: Analysis; me: string; other: string; ready: boolean }) {
  const [copied, setCopied] = useState<number | null>(null);
  const [copyError, setCopyError] = useState("");
  const labels = ["稳妥回应", "主动推进", "说明边界"];
  async function copy(text: string, index: number) {
    try { await navigator.clipboard.writeText(text); setCopyError(""); setCopied(index); window.setTimeout(() => setCopied(null), 2200); }
    catch { setCopied(null); setCopyError("暂时无法自动复制，请长按或选中文字复制。"); }
  }
  return <section className="conversation-panel" aria-label="逐句线索与回复方向">
    <div className="conversation-head"><div><span className="eyebrow">逐句看信号</span><h3>看得见的原话，和还不能确定的事</h3></div><span>仅展示最近一批可辨认的关键句</span></div>
    {result.lineInsights?.length > 0 ? <div className="conversation-lines">{result.lineInsights.map((line, index) => <article key={index} className={"conversation-line " + (line.speaker === me ? "mine" : "") }><div className="conversation-bubble"><div className="conversation-speaker"><strong>{line.speaker === me ? "我" : reportPersonLabel(line.speaker === other ? other : line.speaker)}</strong><span>{line.certainty}</span></div><p>“{line.quote}”</p></div><div className="conversation-reading"><strong>{line.signal}</strong><span>另一种解释：{line.alternative}</span></div></article>)}</div> : <p className="conversation-empty">这批材料暂时无法可靠地分出原话和说话人。可以补充带称呼、时间的文字记录，或更清楚的截图。</p>}
    <div className="conversation-replies"><div className="conversation-replies-head"><h4>如果现在要回复</h4><span>根据最后一批材料，选择符合你真实意愿的一条</span></div>{!ready ? <p className="conversation-empty">全部材料分析完成后，再看回复方向。</p> : result.replyOptions?.length === 3 ? <div className="conversation-reply-grid">{result.replyOptions.map((option, index) => <article key={index} className="conversation-reply"><div><strong>{labels[index]}</strong><button type="button" onClick={() => void copy(option.text, index)} aria-label={"复制" + labels[index]}>{copied === index ? "已复制" : "复制"}</button></div><p>{option.text}</p><small>{option.when}</small><ReplyPaths paths={option.next} /></article>)}</div> : <p className="conversation-empty">这批材料暂时不足以给出可靠的回复备选，或当前情境不适合直接发话术。先看上方总结与待核对的问题。</p>}{copyError && <p className="conversation-empty" role="status">{copyError}</p>}<span className="sr-only" role="status">{copied !== null ? "回复已复制" : ""}</span></div>
  </section>;
}


export function RiskResult({result}:{result:{summary:string;alerts:Array<{title:string;level:string;evidence:string;uncertainty:string;nextStep:string}>;questions:string[];knowledgeSources?:KnowledgeSource[]}}){
  const labels:Record<string,string>={safety:"优先保护自己",boundary:"注意边界",clarify:"值得澄清"};
  return <section className="risk-results"><h2>关系提醒</h2><p className="risk-summary">{result.summary}</p>{result.alerts.map((alert,i)=><article className={"risk-alert "+alert.level} key={i}><span>{labels[alert.level]||"值得留意"}</span><h3>{alert.title}</h3><p><b>材料依据：</b>{alert.evidence}</p><p><b>还不能确定：</b>{alert.uncertainty}</p><p><b>下一步：</b>{alert.nextStep}</p></article>)}{result.questions.length>0&&<section><h3>还可以核对</h3><ul>{result.questions.map((question,i)=><li key={i}>{question}</li>)}</ul></section>}<KnowledgeBasis sources={result.knowledgeSources}/></section>;
}
