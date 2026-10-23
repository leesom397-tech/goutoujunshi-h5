"use client";

import { useState } from "react";
import { replyStyleSamples } from "@/lib/crush/reply-style";
import { rankedReplyOptions } from "@/lib/crush/reply-options";
import { visiblePossibleIntent } from "@/lib/crush/visible-intent";
import type { CrushResult } from "@/lib/crush/types";

export function DecisionPanel({ result }: { result: CrushResult }) {
  const [rewrites, setRewrites] = useState<Record<number, { text: string; status: "adjusted" | "unchanged"; note: string }>>({});
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [error, setError] = useState<Record<number, string>>({});
  const decision = result.decision;
  if (!decision) return null;
  const lastOther = result.lines.filter(line => line.speaker === "other").at(-1);
  const annotation = result.annotations.find(item => item.lineId === lastOther?.id);
  const possibleIntent = visiblePossibleIntent(lastOther?.text, decision.possibleIntent || annotation?.intent[0]?.label, annotation?.evidence);
  const evidence = decision.evidence || (lastOther ? "对方原话：「" + lastOther.text.slice(0, 100) + (lastOther.text.length > 100 ? "…" : "") + "」" : "本轮没有已确认来自对方的可读原话。");
  const options = rankedReplyOptions(decision.replyOptions);
  const canPersonalize = replyStyleSamples(result.lines).eligible;
  const ranked = options.length > 0 && options.every(option => typeof option.weight === "number");
  async function requestRewrite(index: number) {
    if (busyIndex !== null || !canPersonalize) return;
    setBusyIndex(index);
    setError(current => ({ ...current, [index]: "" }));
    try {
      const response = await fetch("/api/crush/rewrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId: result.id, optionIndex: index, confirmed: true }) });
      const data = await response.json() as { text?: string; status?: "adjusted" | "unchanged"; note?: string; error?: string };
      if (!response.ok || !data.text || !data.status || !data.note) throw new Error(data.error || "云端改写暂未完成，原推荐仍可使用。");
      setRewrites(current => ({ ...current, [index]: { text: data.text!, status: data.status!, note: data.note! } }));
    } catch (cause) { setError(current => ({ ...current, [index]: cause instanceof Error ? cause.message : "云端改写暂未完成。" })); }
    finally { setBusyIndex(null); }
  }

  return <section className="decision-panel" aria-label="本轮分析与回复建议">
    <div className="decision-section"><span>01 · 对方可能的意图</span><strong>{possibleIntent}</strong><p>{decision.judgment}</p></div>
    <div className="decision-section"><span>02 · 依据</span><blockquote>{evidence}</blockquote>{decision.observation && <p>{decision.observation}</p>}</div>
    <div className="decision-section"><span>03 · 军师建议</span><strong>{decision.nextStep}</strong></div>
    {options.length === 0 && <p className="decision-options-empty">这轮没有可靠的候选回复。先按上面的建议行动，不必为了发而发。</p>}
    {options.length > 0 && <div className="decision-options">
      <div className="decision-options-head"><h3>现在可以怎么回</h3><small>{ranked ? "按本轮推荐优先级排序；不是成功率" : "按原报告的推荐顺序"}</small></div>
      {options.map((option, index) => {
        const rewrite = rewrites[index];
        return <article className="decision-option" key={index}>
          <div className="decision-option-head"><span>{index === 0 ? "本轮首选" : "备选 " + (index + 1)}</span><b>{option.style}</b></div>
          <p className="decision-option-text">「{rewrite?.status === "adjusted" ? rewrite.text : option.text}」</p>
          {rewrite?.status === "adjusted" && <small>原推荐：「{option.text}」</small>}
          <details><summary>为什么这样回 · 理由与代价</summary><p><b>理由：</b>{option.reason}</p><p><b>代价：</b>{option.cost || "这份旧报告没有评估代价；发送前请结合对方的边界判断。"}</p></details>
          <button type="button" disabled={!canPersonalize || busyIndex !== null || result.id === "demo"} onClick={() => void requestRewrite(index)}>{busyIndex === index ? "正在调整语气…" : "更像我一点"}</button>
          {!canPersonalize && <small>本轮我方原话不足，无法可靠调整语气。</small>}
          {canPersonalize && <small>使用这条候选回复与本轮已确认的我方原话调整表达。<a href="/privacy#ai-processing" target="_blank" rel="noreferrer">数据处理说明</a></small>}
          {rewrite && <small role="status">{rewrite.note}</small>}
          {error[index] && <small role="alert">{error[index]}</small>}
        </article>;
      })}
    </div>}
  </section>;
}
