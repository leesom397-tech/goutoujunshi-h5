"use client";

import { useId, useState } from "react";
import { ArrowRight, ChartNoAxesCombined, Check, ChevronDown, ChevronUp, FileText, MessageCircle, Quote, ScanLine, Sparkles } from "lucide-react";
import publicChatCase from "@/data/public-chat-case.json";
import { publicMomentsCase, publicSocialCase } from "@/data/public-social-cases";
import { ChatReport, SocialReport } from "./ReportView";
import { visibleSignalProfile } from "./report-data";
import type { Json } from "./client";
import styles from "./AnalysisExample.module.css";

type ExampleMode = "chat" | "moments" | "social";
type ChartRow = { label: string; value: number; display: string };
type ExampleProps = { mode: ExampleMode; onUpload: () => void };

const descriptions: Record<ExampleMode, { label: string; title: string; benefits: string[] }> = {
  chat: { label: "聊天", title: "他主动约下一次，是礼貌还是靠近？", benefits: ["读懂语气与意图", "核对互动信号", "获得回复备选"] },
  moments: { label: "朋友圈", title: "三条动态，怎样找到自然话题？", benefits: ["看清内容构成", "理解动态里的线索", "找到自然开场"] },
  social: { label: "社交主页", title: "一张主页，能看出哪些可聊线索？", benefits: ["提取可见资料", "分清事实与推测", "找到可聊话题"] },
};

// Only the existing fictional public fixtures are accepted here. No account,
// upload, production report identifier, or historical profile enters a demo.
const anonymous = { id: "", subjectId: "", owner: "", ownerId: "", userId: "", kind: "demo" };
const reports: Record<ExampleMode, Json> = {
  chat: { ...publicChatCase, ...anonymous },
  moments: { ...publicMomentsCase, ...anonymous },
  social: { ...publicSocialCase, ...anonymous },
};

function previewData(mode: ExampleMode) {
  if (mode === "chat") {
    const signals = visibleSignalProfile(publicChatCase.lines);
    return {
      summary: publicChatCase.decision.judgment,
      nextStep: publicChatCase.decision.nextStep,
      excerptLabel: "案例原话 · 对方",
      excerpt: publicChatCase.lines.find(line => line.text.includes("挺喜欢跟你相处"))?.text || publicChatCase.lines[0].text,
      scope: `${publicChatCase.lines.length} 条可读消息`,
      chartTitle: "本段六类互动线索",
      chartMetric: `${signals.filter(row => row.count > 0).length} / ${signals.length} 类`,
      chartNote: "条形按对方原话的匹配次数绘制。同一句话可属于多类，不是好感概率。",
      chartUnit: "匹配原话次数",
      chartRows: signals.map(row => ({ label: row.label, value: row.count, display: `${row.count} 句` })),
      chartMaximum: Math.max(1, ...signals.map(row => row.count)),
    };
  }
  if (mode === "moments") {
    const source = publicMomentsCase.moments;
    return {
      summary: publicMomentsCase.summary,
      nextStep: source.starters[0].message,
      excerptLabel: `案例动态 · ${source.posts[0].date}`,
      excerpt: source.posts[0].content,
      scope: `${source.statistics.total} 条可见动态`,
      chartTitle: "这批动态的内容构成",
      chartMetric: `${source.statistics.total} 条`,
      chartNote: source.statistics.scope,
      chartUnit: "原报告中的条数与占比",
      chartRows: source.statistics.visibleContent.map(row => ({ label: row.label, value: row.percent, display: `${row.count} 条 · ${row.percent}%` })),
      chartMaximum: 100,
    };
  }
  const rows = [
    { label: "可见事实", value: publicSocialCase.visibleFacts.length },
    { label: "积极线索", value: publicSocialCase.positives.length },
    { label: "需要留意", value: publicSocialCase.cautions.length },
    { label: "仍待了解", value: publicSocialCase.unknowns.length },
  ];
  return {
    summary: publicSocialCase.summary,
    nextStep: publicSocialCase.questions[0],
    excerptLabel: "案例主页 · 简介",
    excerpt: publicSocialCase.visibleFacts[0].meaning,
    scope: `${publicSocialCase.visibleFacts.length} 条主页材料`,
    chartTitle: "这份主页报告有什么",
    chartMetric: `${publicSocialCase.visibleFacts.length} 条事实`,
    chartNote: "按本案例已有报告条目计数，各类可能围绕同一材料。不是人格、好感或适配评分。",
    chartUnit: "已有报告条目数",
    chartRows: rows.map(row => ({ ...row, display: `${row.value} 项` })),
    chartMaximum: Math.max(1, ...rows.map(row => row.value)),
  };
}

function PreviewBars({ rows, maximum }: { rows: ChartRow[]; maximum: number }) {
  return <span className={styles.bars} role="img" aria-label={rows.map(row => `${row.label}：${row.display}`).join("；")}>
    {rows.map(row => <span className={styles.barRow} key={row.label}>
      <span>{row.label}</span>
      <span className={styles.track} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, row.value / maximum * 100))}%` }}/></span>
      <b>{row.display}</b>
    </span>)}
  </span>;
}

export function AnalysisExample({ mode, onUpload }: ExampleProps) {
  return <ExampleContent key={mode} mode={mode} onUpload={onUpload}/>;
}

function ExampleContent({ mode, onUpload }: ExampleProps) {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  const description = descriptions[mode], data = previewData(mode);
  const Chevron = expanded ? ChevronUp : ChevronDown;

  return <section className={styles.example} data-public-example="true" data-example-mode={mode} aria-label={`${description.label}分析案例`}>
    <header className={styles.heading}>
      <div><span className={styles.eyebrow}><Sparkles size={15}/>先看看，你会得到什么</span><h2>{description.label}分析，从这些线索开始。</h2></div>
      <div className={styles.benefits} aria-label="分析内容">{description.benefits.map(item => <span key={item}><Check size={14}/>{item}</span>)}</div>
    </header>

    <div className={styles.caseLabel}><span><FileText size={14}/>虚构演示案例</span><p>以下材料与报告仅用于展示功能，不是真实客户记录。</p></div>

    <div className={styles.preview}>
      <button className={styles.summaryCard} type="button" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpanded(value => !value)}>
        <span className={styles.cardKicker}><MessageCircle size={15}/>案例判断<span>{data.scope}</span></span>
        <strong className={styles.caseTitle}>{description.title}</strong>
        <span className={styles.judgment}>{data.summary}</span>
        <span className={styles.cardAction}>{expanded ? "收起完整案例" : "展开完整判断与依据"}<Chevron size={17}/></span>
      </button>
      <button className={styles.chartCard} type="button" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpanded(value => !value)}>
        <span className={styles.chartTop}><span><ChartNoAxesCombined size={16}/>{data.chartTitle}</span><b>{data.chartMetric}</b></span>
        <small className={styles.chartUnit}>{data.chartUnit}</small>
        <PreviewBars rows={data.chartRows} maximum={data.chartMaximum}/>
        <span className={styles.chartNote}>{data.chartNote}</span>
        <span className={styles.cardAction}>{expanded ? "收起完整案例" : "展开图表与分析"}<Chevron size={17}/></span>
      </button>
    </div>

    <div className={styles.context}>
      <div className={styles.excerpt}><Quote size={19}/><div><small>{data.excerptLabel}</small><blockquote>{data.excerpt}</blockquote></div></div>
      <div className={styles.nextStep}><span><ArrowRight size={15}/>{mode === "chat" ? "建议下一步" : "可以这样开场"}</span><p>{data.nextStep}</p></div>
    </div>

    <button className={styles.detailsToggle} type="button" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpanded(value => !value)}><FileText size={17}/>{expanded ? "收起完整案例分析" : `查看完整${description.label}案例分析`}<Chevron size={17}/></button>

    {expanded && <div className={styles.expanded} id={regionId} role="region" aria-label={`${description.label}虚构案例完整报告`}>
      <div className={styles.expandedHeading}><span><FileText size={16}/>完整案例 · 虚构材料</span><button className={styles.close} type="button" onClick={() => setExpanded(false)}>收起<ChevronUp size={16}/></button></div>
      {mode === "chat" ? <ChatReport report={reports.chat} account={null} preview publicExample/> : <SocialReport report={reports[mode]} account={null} subjectId="" targetSelf={false} publicExample/>}
    </div>}

    <footer className={styles.footer}><p>带上你的{description.label}，看清自己的处境。<small>案例可直接展开；分析自己的材料前会显示所需积分。</small></p><button className={styles.upload} type="button" onClick={onUpload}><ScanLine size={17}/>分析我的{description.label}<ArrowRight size={16}/></button></footer>
  </section>;
}
