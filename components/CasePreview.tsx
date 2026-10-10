"use client";
import { useState } from "react";

const examples = [
  { label: "暧昧推进", question: "TA 说周五没空，但主动提出周日见。我要继续吗？", known: "推迟见面的同时，提出了替代时间。", unknown: "愿意见面，还不等于想确立关系。", next: "可以确认一个具体时间；看双方能否落实安排。" },
  { label: "分手之后", question: "我们分手了。我现在很想发一大段话挽回。", known: "你很想重新建立联系，眼下的情绪也很强。", unknown: "尚不清楚分手原因、对方的边界和你的联系目的。", next: "先把想发的话写下来，理清这一轮究竟想表达什么，再决定是否联系。" },
  { label: "关系预警", question: "我说不愿发私密照片，TA 说：不给就是不信任我。", known: "你已表达不愿意，对方仍将提供照片与信任绑定。", unknown: "这一段不能证明所有动机，但你的拒绝不需要被说服。", next: "守住不发送的决定；若对方继续施压或威胁，优先保护隐私并寻求支持。" },
];

export function CasePreview({ compact = false }: { compact?: boolean }) {
  const [index, setIndex] = useState(0);
  const example = examples[index];
  return <section className={compact ? "case-preview compact" : "case-preview"} aria-label="关系分析示例"><div className="case-preview-head"><span>先看一个分析示例</span><span>示例情境</span></div><div className="case-switcher" role="group" aria-label="切换示例情境">{examples.map((item, i) => <button key={item.label} type="button" aria-pressed={index === i} onClick={() => setIndex(i)}>{item.label}</button>)}</div><p className="case-question">“{example.question}”</p><div className="case-findings"><div><span className="finding-label">已知</span><p>{example.known}</p></div><div><span className="finding-label">不能确定</span><p>{example.unknown}</p></div><div className="finding-action"><span className="finding-label">下一步</span><p>{example.next}</p></div></div><small>以上为预设示例，演示分析方式；提交自己的材料后才会生成你的分析。</small></section>;
}
