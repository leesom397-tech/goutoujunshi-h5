"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, Eye, HeartHandshake, Repeat2, Shield } from "lucide-react";
import { relationshipRiskReview } from "@/lib/relationship-risk";
import {riskEvidenceOccurrences,reportEvidenceDate} from "@/lib/report-reading";
import type { Json } from "./client";
import styles from "./RiskReview.module.css";
import visual from "./RiskVisual.module.css";
import { CaptureEvidence } from "./CaptureEvidence";
import type { RiskAwarePresentation } from "@/lib/risk-aware-presentation";
import { reportIdentity } from "./report-context";
import { ReportExcerpt } from "./ReportExcerpt";

const kinds = {
  safety: { label: "安全与边界", Icon: Shield },
  expectation: { label: "关系预期", Icon: HeartHandshake },
  pattern: { label: "相处模式", Icon: Repeat2 },
};

export function RiskActionNotice({ presentation }: { presentation: RiskAwarePresentation }) {
  if (presentation.mode === "normal" || !presentation.priority) return null;
  return <aside className={styles.actionNotice} data-risk-action={presentation.mode}><strong><Shield size={19}/>{presentation.title}</strong><p>{presentation.nextStep}</p><small>{presentation.mode === "safety" ? "回复已优先围绕这条明确要求处理边界；是否继续回应，由你决定。" : "先对齐双方当前想法；短期取向本身不代表品德问题。"}</small><CaptureEvidence quote={presentation.priority.evidence}/></aside>;
}

export function RiskReview({ report,summaryOnly=false,onInspect }: { report: Json;summaryOnly?:boolean;onInspect?:(kind:keyof typeof kinds)=>void }) {
  const [selected, setSelected] = useState<keyof typeof kinds | null>(null);
  if (report.targetSelf || report.target === "self") return null;
  const review = relationshipRiskReview(report);
  const identity=reportIdentity(report);
  const signals = review.signals;
  const fullHistory = review.scope === "full-history";
  if (!fullHistory && !signals.length) return null;
  const state = signals.length ? "signals" : review.assessed ? "clear" : "unassessed";
  const active = selected || signals[0]?.kind || "safety";
  const selectedSignals=signals.filter(signal=>signal.kind===active),preview=selectedSignals[0];
  const count = (signal: typeof signals[number]) => fullHistory ? signal.occurrences || signal.sources?.length || 0 : riskEvidenceOccurrences(report, signal.evidence).count;
  return <section className={visual.review} data-risk-review data-risk-state={state} aria-label={fullHistory ? "全历史风险核实" : "风险与关系预期"}>
    <header className={visual.heading}>
      <div><span className={visual.eyebrow}><Shield size={15}/>值得多看一眼</span><h2>{identity.other}与你：风险与期待</h2></div>
      <span className={visual.coverage}>{fullHistory ? `${review.coverage?.readable || 0} 条可读聊天` : "本次上传材料"}</span>
    </header>
    <div className={visual.categories} role="group" aria-label="按类型查看待核实的表达">{(Object.keys(kinds) as Array<keyof typeof kinds>).map(key => {
      const { Icon, label } = kinds[key], matches = signals.filter(signal => signal.kind === key), total = matches.reduce((sum, signal) => sum + count(signal), 0);
      const card=<><span className={visual.categoryIcon}><Icon size={22}/></span><span className={visual.categoryLabel}>{label}</span><span className={visual.categoryCount}><b>{total || (matches.length || !review.assessed ? "—" : "0")}</b><small>{total ? "条表达" : matches.length ? "待核对处数" : review.assessed ? "条明确表达" : "尚未评估"}</small></span></>;
      return <button type="button" key={key} data-risk-category={key} aria-pressed={active === key} onClick={()=>setSelected(key)}>{card}</button>;
    })}</div>
    {!signals.length && <p className={visual.clear}>{review.summary || "资料还不足以排除风险，继续结合实际相处核实。"}</p>}
    {summaryOnly&&signals.length>0&&<div className={visual.summaryDetail} data-risk-summary-detail>{preview?<><h3>{preview.title}</h3><ReportExcerpt value={preview.reading}/><div className={visual.summaryQuote}><small>{identity.other}的原话依据</small><ReportExcerpt value={preview.sources?.[0]?.quote||preview.evidence} limit={130} quote/></div>{preview.alternative&&<div className={visual.summaryAlternative}><strong>另一种解释</strong><ReportExcerpt value={preview.alternative} limit={140}/></div>}{onInspect&&<button type="button" onClick={()=>onInspect(active)}>逐项核实原话与后续<ArrowRight size={17}/></button>}</>:<p className={visual.clear}>本报告未检出这类明确表达，不能据此认定已经排除风险。{onInspect&&<button type="button" onClick={()=>onInspect(active)}>查看已保留的核实项<ArrowRight size={17}/></button>}</p>}</div>}
    {!summaryOnly&&signals.length > 0 && <>
      <div className={visual.signals}>{signals.filter(signal => signal.kind === active).map((signal, index) => {
        const sources = signal.sources?.length ? signal.sources : [{sourceId:"", at:"", quote:signal.evidence}];
        return <details className={visual.signal} key={`${signal.kind}:${signal.title}:${index}`} data-risk-kind={signal.kind}>
          <summary><span className={visual.signalNumber}>{String(index + 1).padStart(2,"0")}</span><span className={visual.signalTitle}><small>当前待核实</small><strong>{signal.title}</strong></span><span className={visual.expand}>看原话<ChevronDown size={18}/></span></summary>
          <div className={visual.detail}>
            <div className={visual.interpretation}><p>{signal.reading}</p>{signal.alternative && <p className={visual.alternative}><Eye size={16}/><span>{signal.alternative}</span></p>}</div>
            <div className={visual.timelineHeading}><h3>原话与后续回应</h3><span data-risk-occurrences>{count(signal) ? `${count(signal)} 条表达` : "具体处数待核对"}</span></div>
            <ol className={visual.timeline}>{sources.map((source, sourceIndex) => <li key={`${source.sourceId}:${sourceIndex}`} data-risk-conversation>
              <div className={visual.timelineDate}><i aria-hidden="true"/><span>{source.at ? reportEvidenceDate(source.at).split(" ")[0] : fullHistory ? "日期待确认" : "本次截图"}</span></div>
              <div className={visual.conversation}><div className={visual.other}><small>{identity.other}说{source.at && ` · ${reportEvidenceDate(source.at)}`}</small><blockquote>{source.quote}</blockquote><CaptureEvidence sourceIds={source.sourceId ? [source.sourceId] : undefined} libraryId={"libraryId" in source ? source.libraryId : undefined} sourceKind="chat" quote={source.quote} label="回看这条原话"/></div>{"response" in source && source.response && <div className={visual.self}><small>你随后说 · {reportEvidenceDate(source.response.at)}</small><blockquote>{source.response.quote}</blockquote><CaptureEvidence sourceIds={[source.response.sourceId]} libraryId={source.libraryId} sourceKind="chat" quote={source.response.quote} label="回看回应"/></div>}</div>
            </li>)}</ol>
            {(signal.occurrences || 0) > sources.length && <p className={visual.retained}>共 {signal.occurrences} 条表达，这里保留最早和最近的 {sources.length} 条依据。</p>}
            <div className={visual.action}><span><ArrowRight size={18}/></span><div><strong>下一步核实</strong><p>{signal.action}</p></div></div>
          </div>
        </details>;
      })}</div>
      {!signals.some(signal => signal.kind === active) && <p className={visual.clear}>这批可读材料中，未检出此类明确表达。缺少线索不能当作已经排除风险。</p>}
      <p className={visual.caption}>按可核对的原话计数 · 未检出不代表已排除</p>
    </>}
  </section>;
}
