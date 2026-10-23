"use client";

import { useState } from "react";
import { ArrowRight, FileText, HeartHandshake, ScanLine, ShieldCheck } from "lucide-react";
import { publicReports, publicExpectationCase } from "@/data/public-report-cases";
import { ChatReport, SocialReport } from "./ReportView";
import styles from "./AnalysisExample.module.css";

type ExampleMode = "chat" | "moments" | "social";
const descriptions = {
  chat: { label: "聊天", title: "聊得热，也有行动：下一步怎么判断？" },
  moments: { label: "朋友圈", title: "从动态找到共同点，知道怎样自然接话。" },
  social: { label: "社交主页", title: "资料哪里相近，相处时又要留意什么？" },
};

/** Public cases use the same reader, charts and reply controls as a real report. */
export function AnalysisExample({ mode, onUpload }: { mode: ExampleMode; onUpload: () => void }) {
  return <ExampleContent key={mode} mode={mode} onUpload={onUpload}/>;
}

function ExampleContent({ mode, onUpload }: { mode: ExampleMode; onUpload: () => void }) {
  const [expectation, setExpectation] = useState(false);
  const description = descriptions[mode];
  const report = mode === "chat" && expectation ? publicExpectationCase : publicReports[mode];
  return <section className={styles.example} data-public-example="true" data-example-mode={mode} aria-label={description.label + "分析案例"}>
    <header className={styles.heading}><h2>{mode === "chat" && expectation ? "有共同点，但你们想要的是同一种关系吗？" : description.title}</h2></header>
    <div className={styles.caseLabel}><strong><FileText size={17}/>虚构演示案例</strong><p>{mode === "chat" ? report.lines.length + " 句 · " + (expectation ? "10 月 9—12 日" : "10 月 9—11 日") : mode === "moments" ? "4 张材料 · 8 条动态" : "3 张主页材料"} · 人物、材料与解读均为虚构，可免费点选。</p></div>
    {mode === "chat" && <div className={styles.scenarios} role="group" aria-label="选择聊天案例情境">
      <button type="button" title="看原话怎样对应行动" aria-pressed={!expectation} onClick={() => setExpectation(false)}><HeartHandshake size={18}/><span>双向靠近</span></button>
      <button type="button" title="同一故事新增2句，判断和回复随期待变化调整" aria-pressed={expectation} onClick={() => setExpectation(true)}><ShieldCheck size={18}/><span>新信息：期待不同</span></button>
    </div>}
    <div className={styles.report}>
      {mode === "chat" ? <ChatReport key={expectation ? "expectation" : "mutual"} report={report} account={null} preview publicExample/> : <SocialReport key={mode} report={report} account={null} subjectId="" targetSelf={false} publicExample/>}
    </div>
    <footer className={styles.footer}><p>带上你的{description.label}，看清自己的处境。<small>案例免费查看；使用自己的材料时，分析前显示所需积分。</small></p><button className={styles.upload} type="button" onClick={onUpload}><ScanLine size={19}/>分析我的{description.label}<ArrowRight size={18}/></button></footer>
  </section>;
}

