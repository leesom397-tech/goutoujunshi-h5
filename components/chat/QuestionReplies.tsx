"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function QuestionReplies({ options }: { options: { text?: string; style?: string }[] }) {
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState("");
  async function copy(text: string, index: number) {
    try { await navigator.clipboard.writeText(text); setCopied(index); setError(""); }
    catch { setError("复制未完成，可以选中这句文字复制。"); }
  }
  return <div className="chat-quick-replies" aria-label="可直接用的回复">
    {options.filter(item => typeof item.text === "string" && item.text.trim()).slice(0, 3).map((item, index) => <div className="chat-quick-reply" key={index}>
      <div><small>{item.style || "可以这样回"}</small><p>{item.text}</p></div>
      <button type="button" aria-label={`复制回复 ${index + 1}`} onClick={() => void copy(item.text!, index)}>{copied === index ? <Check size={16}/> : <Copy size={16}/>}<span role="status">{copied === index ? "已复制" : "复制"}</span></button>
    </div>)}
    {error && <p role="alert">{error}</p>}
  </div>;
}
