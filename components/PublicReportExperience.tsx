"use client";

import { useState } from "react";
import { ChatReport, SocialReport } from "@/components/web-analysis/ReportView";
import type { Json } from "@/components/web-analysis/client";
import { publicSocialCase, publicMomentsCase } from "@/data/public-social-cases";
import "@/components/web-analysis/web-analysis.css";

/** Only curated reports from fictional inputs belong here, never account exports. */
export type PublicAnalysisExample = {
  title: string;
  question: string;
  analyzedAt: string;
  report: Json;
};

type CaseMode = "chat" | "social" | "moments";
const cases: { key: CaseMode; label: string; kicker: string; title: string; question: string }[] = [
  { key: "chat", label: "聊天截图", kicker: "案例 01 · 聊天分析", title: "他主动约下一次，是礼貌还是靠近？", question: "先看一句判断、两条原话和互动信号，再决定怎么回。" },
  { key: "social", label: "社交主页", kicker: "案例 02 · 主页分析", title: "一张主页，能看出哪些可聊线索？", question: "从简介和照片找到开场，也看清哪些仍要靠相处验证。" },
  { key: "moments", label: "朋友圈", kicker: "案例 03 · 动态分析", title: "三条动态，怎样找到自然话题？", question: "看内容构成和发布时间，再选一句适合接上的话。" },
];

export function PublicReportExperience({ example, onStart }: {
  example: PublicAnalysisExample;
  onStart: (mode: CaseMode) => void;
}) {
  const [mode, setMode] = useState<CaseMode>("chat");
  const current = cases.find(item => item.key === mode)!;
  // Do not carry production identifiers into the anonymous demonstration.
  // Without an account, the shared report cannot read history or submit followups.
  const report: Json = { ...example.report, id: "", subjectId: "", owner: "", ownerId: "", userId: "" };
  const lines: Json[] = Array.isArray(report.lines) ? report.lines : [];
  const opening = lines.find(line => typeof line.text === "string" && line.text.includes("记得你说三点"))?.text;
  const turningPoint = lines.find(line => typeof line.text === "string" && line.text.includes("挺喜欢跟你相处"))?.text;
  return <section className="wa-shell public-report-example" id="experience" tabIndex={-1} aria-label="功能报告案例">
    <div className="public-case-switch" role="tablist" aria-label="选择报告案例">{cases.map(item => <button key={item.key} type="button" role="tab" id={`case-tab-${item.key}`} aria-controls="case-panel" aria-selected={mode === item.key} onClick={() => setMode(item.key)}>{item.label}</button>)}</div>
    <div id="case-panel" role="tabpanel" aria-labelledby={`case-tab-${mode}`}>
    <header className="public-case-intro">
      <div className="public-case-copy">
        <span className="public-case-kicker">{current.kicker} <i/> 虚构材料 · 报告界面</span>
        <h2>{current.title}</h2>
        <p>{current.question}</p>
        {mode === "chat" ? <><div className="public-case-facts"><span><strong>{lines.length}</strong> 句聊天</span><span><strong>6</strong> 类可见线索</span><span>逐句有依据</span></div><small>真实分析流程生成；公开前校正了说话人和文字 · {example.analyzedAt}</small></> : <><div className="public-case-facts"><span><strong>{mode === "moments" ? "3" : "2"}</strong> 条可见材料</span><span>推测与另一种解释</span><span>可查看完整依据</span></div><small>演示内容根据下方虚构材料编写，用真实产品报告组件展示。</small></>}
        <a className="public-case-detail-prompt" href="#report-detail-action"><span aria-hidden="true">↓</span> 点击下方蓝色按钮，查看完整分析</a>
      </div>
      <div className="public-case-excerpt" aria-label="案例原话摘录">
        <span>{mode === "chat" ? "先看两句原话" : mode === "social" ? "示例主页可见内容" : "示例朋友圈原文"}</span>
        {mode === "chat" ? <>{opening && <p><small>对方</small>{opening}</p>}{turningPoint && <p><small>对方</small>{turningPoint}</p>}<em>语气和好感信号，都回到原话核对。</em></> : mode === "social" ? <><p><small>简介</small>周末常看展，最近在学摄影。</p><p><small>照片配文</small>喜欢傍晚的光。</p><em>主页能提示话题，不能证明对你有好感。</em></> : <div className="public-moments-feed" aria-label="虚构朋友圈样式示例"><div className="public-moments-head"><span className="public-moments-avatar">林</span><div><strong>林然</strong><small>10 月 2 日 · 公开</small></div></div><p className="public-moments-body">这次布光改了三版，终于接近想要的感觉。</p><div className="public-moments-images"><i/><i/><i/></div><div className="public-moments-meta"><span>♡</span><span>评论</span><span>赞</span></div><div className="public-moments-comment"><b>成子</b>：最后最满意的是哪一处？</div><div className="public-moments-next"><span className="public-moments-avatar small">林</span><div><strong>林然</strong><small>10 月 5 日</small><p>今天这场展值得慢慢看。</p></div></div><em>虚构朋友圈界面 · 3 条动态进入右侧统计图表</em></div>}
      </div>
    </header>
    {mode === "chat" ? <ChatReport report={report} account={null} preview/> : <SocialReport key={mode} report={mode === "social" ? publicSocialCase : publicMomentsCase} account={null} subjectId="" targetSelf={false}/>}
    <div className="wa-card">
      <h3>带上你的{mode === "chat" ? "聊天" : mode === "social" ? "社交主页" : "朋友圈"}，看清自己的处境。</h3>
      <p>案例可免费查看。使用自己的材料时登录，分析前会显示积分费用。</p>
      <button type="button" onClick={() => onStart(mode)}>分析我的{mode === "chat" ? "聊天" : mode === "social" ? "社交主页" : "朋友圈"}</button>
    </div>
    </div>
  </section>;
}
