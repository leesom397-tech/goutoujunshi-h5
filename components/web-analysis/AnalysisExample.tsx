"use client";

import { useId, useState } from "react";
import { ArrowRight, ArrowUpRight, BriefcaseBusiness, CalendarCheck, ChartNoAxesCombined, Check, ChevronDown, ChevronUp, FileText, Flag, Footprints, Heart, HeartHandshake, HelpCircle, Image, MessageCircle, MessagesSquare, Quote, ScanLine, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import publicChatCase from "@/data/public-chat-case.json";
import { publicMomentsCase, publicSocialCase } from "@/data/public-social-cases";
import { ChatReport, SocialReport } from "./ReportView";
import { visibleSignalProfile } from "./report-data";
import type { Json } from "./client";
import styles from "./AnalysisExample.module.css";

type ExampleMode = "chat" | "moments" | "social";
type ChartRow = { label: string; value: number; display: string; icon: LucideIcon; evidence: string[] };
type ExampleProps = { mode: ExampleMode; onUpload: () => void };

const descriptions: Record<ExampleMode, { label: string; title: string; benefits: string[] }> = {
  chat: { label: "聊天", title: "他主动约下一次，是礼貌还是靠近？", benefits: ["语气与意图", "互动信号", "风险与预期", "回复备选"] },
  moments: { label: "朋友圈", title: "一组动态，怎样找到相处的切入点？", benefits: ["内容分布", "动态里的线索", "风险与预期", "自然开场"] },
  social: { label: "社交主页", title: "一张主页，能看出哪些可聊线索？", benefits: ["可见资料", "事实与推测", "风险与预期", "可聊话题"] },
};
const signalIcons: LucideIcon[] = [ArrowUpRight, MessagesSquare, HeartHandshake, UserRound, Heart, CalendarCheck];

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
      focus: publicChatCase.decision.interactionInsight.label,
      focusNote: "订票、分享照片、主动约下次见面，已经有具体行动。",
      boundary: "积极信号，不等于长期承诺。",
      summary: publicChatCase.decision.judgment,
      nextStep: publicChatCase.decision.nextStep,
      excerptLabel: "关键原话 · 对方",
      excerpt: publicChatCase.decision.evidence.replace(/^对方原话：/, ""),
      scope: `${publicChatCase.lines.length} 条可读消息`,
      chartTitle: "本段六类互动线索",
      chartMetric: `${signals.filter(row => row.count > 0).length}`,
      chartMetricUnit: `/ ${signals.length} 类`,
      chartNote: "同一句话可属于多类；次数不是好感概率。",
      chartUnit: "匹配原话次数",
      chartEvidenceLabel: "匹配原话示例",
      chartRows: signals.map((row, index) => ({ label: row.label, value: row.count, display: `${row.count} 句`, icon: signalIcons[index], evidence: row.evidence.slice(0, 1).map(text => publicChatCase.lines.find(line => line.text.startsWith(text))?.text || text) })),
      chartMaximum: Math.max(1, ...signals.map(row => row.count)),
    };
  }
  if (mode === "moments") {
    const source = publicMomentsCase.moments;
    const icons = [BriefcaseBusiness, Image, Footprints];
    return {
      focus: source.hypotheses[0].title,
      focusNote: "工作、看展、散步；从对方已分享的细节打开话题。",
      boundary: `${source.posts.length} 条动态，只代表本批可见内容。`,
      summary: publicMomentsCase.summary,
      nextStep: source.starters[0].message,
      excerptLabel: `关键动态 · ${source.posts[0].date}`,
      excerpt: source.posts[0].content,
      scope: `${source.statistics.total} 条可见动态`,
      chartTitle: "这批动态的内容构成",
      chartMetric: `${source.statistics.total}`,
      chartMetricUnit: "条动态",
      chartNote: `只统计这 ${source.posts.length} 条虚构动态，不代表完整朋友圈。`,
      chartUnit: "条数与占比 · 分类可重叠",
      chartEvidenceLabel: "对应的动态",
      chartRows: source.statistics.visibleContent.map((row, index) => ({ label: row.label, value: row.percent, display: `${row.count} 条 · ${row.percent}%`, icon: icons[index % icons.length] || Image, evidence: [row.evidence || source.posts[0]?.evidence || "虚构动态"] })),
      chartMaximum: 100,
    };
  }
  const rows = [
    { label: "可见事实", value: publicSocialCase.visibleFacts.length, icon: FileText, evidence: publicSocialCase.visibleFacts.map(row => row.meaning) },
    { label: "积极线索", value: publicSocialCase.positives.length, icon: Sparkles, evidence: publicSocialCase.positives.map(row => row.meaning) },
    { label: "需要留意", value: publicSocialCase.cautions.length, icon: Flag, evidence: publicSocialCase.cautions.map(row => row.meaning) },
    { label: "仍待了解", value: publicSocialCase.unknowns.length, icon: HelpCircle, evidence: publicSocialCase.unknowns },
  ];
  return {
    focus: "从看展与摄影，找到具体话题。",
    focusNote: "简介与公开照片都留下了兴趣线索，可以从一件具体作品聊起。",
    boundary: "公开资料，不能直接推断对你的好感。",
    summary: publicSocialCase.summary,
    nextStep: publicSocialCase.questions[0],
    excerptLabel: "关键资料 · 主页简介",
    excerpt: publicSocialCase.visibleFacts[0].meaning,
    scope: `${publicSocialCase.visibleFacts.length} 条主页材料`,
    chartTitle: "这份主页报告有什么",
    chartMetric: `${publicSocialCase.visibleFacts.length}`,
    chartMetricUnit: "条事实",
    chartNote: "这是报告条目计数，不是人格、好感或适配评分。",
    chartUnit: "已有报告条目数",
    chartEvidenceLabel: "对应的报告条目",
    chartRows: rows.map(row => ({ ...row, display: `${row.value} 项` })),
    chartMaximum: Math.max(1, ...rows.map(row => row.value)),
  };
}

function PreviewBars({ rows, maximum, selected, onSelect, evidenceId }: { rows: ChartRow[]; maximum: number; selected: number; onSelect: (index: number) => void; evidenceId: string }) {
  return <div className={styles.bars} role="group" aria-label="点击图表项目查看依据">
    {rows.map((row, index) => <button className={styles.barRow} key={row.label} type="button" aria-pressed={selected === index} aria-controls={evidenceId} aria-label={`${row.label}，${row.display}，查看依据`} onClick={() => onSelect(index)}>
      <span className={styles.barLabel}><row.icon size={17} aria-hidden="true"/>{row.label}</span>
      <span className={styles.track} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, row.value / maximum * 100))}%` }}/></span>
      <b>{row.display}</b>
    </button>)}
  </div>;
}

export function AnalysisExample({ mode, onUpload }: ExampleProps) {
  return <ExampleContent key={mode} mode={mode} onUpload={onUpload}/>;
}

function ExampleContent({ mode, onUpload }: ExampleProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedChart, setSelectedChart] = useState(0);
  const regionId = useId(), evidenceId = useId();
  const description = descriptions[mode], data = previewData(mode);
  const selectedRow = data.chartRows[selectedChart];
  const Chevron = expanded ? ChevronUp : ChevronDown;

  return <section className={styles.example} data-public-example="true" data-example-mode={mode} aria-label={`${description.label}分析案例`}>
    <header className={styles.heading}>
      <div><span className={styles.eyebrow}><Sparkles size={17}/>先看看，你会得到什么</span><h2>{description.title}</h2></div>
      <div className={styles.benefits} aria-label="分析内容">{description.benefits.map(item => <span key={item}><Check size={15}/>{item}</span>)}</div>
    </header>

    <div className={styles.caseLabel}><span><FileText size={16}/>虚构演示案例</span><p>用于展示功能，不是真实客户记录。</p></div>

    <div className={styles.preview}>
      <article className={styles.summaryCard}>
        <div className={styles.cardKicker}><MessageCircle size={18}/><span>先看判断</span><small>{data.scope}</small></div>
        <h3 className={styles.caseTitle}>{data.focus}</h3>
        <p className={styles.judgment}>{data.focusNote}</p>
        <div className={styles.context}>
          <div className={styles.excerpt}><Quote size={19}/><div><span>{data.excerptLabel}</span><blockquote>{data.excerpt}</blockquote></div></div>
          <div className={styles.nextStep}><span><ArrowRight size={18}/>{mode === "chat" ? "建议下一步" : "可以这样开场"}</span><p>{data.nextStep}</p></div>
        </div>
        <p className={styles.boundary}><HelpCircle size={15}/>{data.boundary}</p>
        <details className={styles.explanation}><summary>查看判断说明<ChevronDown size={16}/></summary><p>{data.summary}</p></details>
      </article>
      <article className={styles.chartCard}>
        <div className={styles.chartTop}><h3><ChartNoAxesCombined size={21}/>{data.chartTitle}</h3><div className={styles.metric}><b>{data.chartMetric}</b><span>{data.chartMetricUnit}</span></div></div>
        <div className={styles.chartCaption}><span>{data.chartUnit}</span><span>点选看依据<ChevronDown size={14}/></span></div>
        <PreviewBars rows={data.chartRows} maximum={data.chartMaximum} selected={selectedChart} onSelect={setSelectedChart} evidenceId={evidenceId}/>
        <div className={styles.chartEvidence} id={evidenceId} aria-live="polite" aria-atomic="true">
          <div><selectedRow.icon size={17}/><span>{selectedRow.label}</span><small>{data.chartEvidenceLabel}</small></div>
          <ul>{selectedRow.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
        <p className={styles.chartNote}>{data.chartNote}</p>
      </article>
    </div>

    <button className={styles.detailsToggle} type="button" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpanded(value => !value)}><FileText size={19}/>{expanded ? "收起完整案例分析" : `查看完整${description.label}案例分析`}<Chevron size={19}/></button>

    {expanded && <div className={styles.expanded} id={regionId} role="region" aria-label={`${description.label}虚构案例完整报告`}>
      <div className={styles.expandedHeading}><span><FileText size={16}/>完整案例 · 虚构材料</span><button className={styles.close} type="button" onClick={() => setExpanded(false)}>收起<ChevronUp size={16}/></button></div>
      {mode === "chat" ? <ChatReport report={reports.chat} account={null} preview publicExample/> : <SocialReport report={reports[mode]} account={null} subjectId="" targetSelf={false} publicExample/>}
    </div>}

    <footer className={styles.footer}><p>带上你的{description.label}，看清自己的处境。<small>分析自己的材料前，会显示所需积分。</small></p><button className={styles.upload} type="button" onClick={onUpload}><ScanLine size={19}/>分析我的{description.label}<ArrowRight size={18}/></button></footer>
  </section>;
}
