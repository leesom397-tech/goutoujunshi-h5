"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

type ReplyOption = { text?: string; style?: string; reason?: string; cost?: string; weight?: number };
export function QuestionReplies({ options, onRewrite, rewriteCost, disabled = false }: { options: ReplyOption[]; onRewrite?: (text: string, tone: string) => void; rewriteCost?: string; disabled?: boolean }) {
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState("");
  async function copy(text: string, index: number) {
    try { await navigator.clipboard.writeText(text); setCopied(index); setError(""); }
    catch { setError("复制未完成，可以选中这句文字复制。"); }
  }
  const seen = new Set<string>();
  const distinct = options.filter(item => typeof item.text === "string" && item.text.trim()).sort((a, b) => (b.weight || 0) - (a.weight || 0)).filter(item => { const key = item.text!.replace(/[\s\p{P}]/gu, ""); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 3);
  return <div className="chat-quick-replies" aria-label="可直接用的回复">
    {distinct.map((item, index) => <div className="chat-quick-reply" data-recommended={index === 0} key={item.text}>
      <div className="chat-reply-content"><small>{index === 0 ? "优先考虑 · " : "另一种表达 · "}{item.style || "自然回应"}</small><p>{item.text}</p>
        {(item.reason || item.cost) && <details className="chat-reply-conditions"><summary>为什么这样回 · 适用条件</summary>{item.reason && <p><strong>为什么：</strong>{item.reason}</p>}{item.cost && <p><strong>先考虑：</strong>{item.cost}</p>}</details>}
        {onRewrite && <div className="chat-rewrite"><span>调整这句话</span>{["更口语", "更简短"].map(tone => <button key={tone} type="button" disabled={disabled} onClick={() => onRewrite(item.text!, tone)}>{tone}</button>)}<small>先填入草稿，确认发送才扣 {rewriteCost || "本次提问费用"}。</small></div>}
      </div>
      <button type="button" aria-label={`复制回复 ${index + 1}`} onClick={() => void copy(item.text!, index)}>{copied === index ? <Check size={16}/> : <Copy size={16}/>}<span role="status">{copied === index ? "已复制" : "复制"}</span></button>
    </div>)}
    {error && <p role="alert">{error}</p>}
  </div>;
}
