"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, Download, Check, FileText } from "lucide-react";
import type { Json } from "./client";
import "./report-actions.css";

function summaryText(report: Json, kind: "chat" | "social") {
  const data = kind === "chat" ? report.decision || {} : report.moments || report;
  const lines = ["成子 · 关系分析摘要", "", "当前判断", data.judgment || data.possibleIntent || data.summary || report.summary || "请结合报告原文查看", ""];
  if (data.evidence) lines.push("关键依据", data.evidence, "");
  if (data.interactionInsight) {
    const insight = data.interactionInsight;
    lines.push("暂定推测 · " + insight.label, "观察：" + insight.observed, "可能的解释：" + insight.interpretation, "另一种解释：" + insight.alternative, "接下来观察：" + insight.verify, "");
  }
  for (const finding of (Array.isArray(data.hypotheses) ? data.hypotheses : []).slice(0, 3)) {
    lines.push("暂定推测 · " + finding.title, "依据：" + finding.evidence, "可能的解释：" + finding.possibility, "另一种解释：" + finding.alternative, "验证：" + (finding.verify || "结合后续实际反馈再判断"), "");
  }
  if (data.nextStep) lines.push("建议下一步", data.nextStep, "");
  if (data.approach) { lines.push("相处建议"); for (const [key, label] of [["attitude", "态度"], ["emotion", "情绪承接"], ["pace", "节奏"], ["adjustWhen", "何时调整"]]) if (data.approach[key]) lines.push(label + "：" + data.approach[key]); lines.push(""); }
  lines.push("这些是基于当前材料的分析与待验证推测，不代表对方的确定想法。请结合原话、边界和后续实际反馈判断。");
  return lines.filter(value => typeof value === "string").join("\n");
}
export function ReportActions({ report, kind = "chat" }: { report: Json; kind?: "chat" | "social" }) {
  const [status, setStatus] = useState(""), [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(summaryText(report, kind)); setCopied(true); setStatus("分析摘要已复制，可粘贴到你的笔记。"); if (timeout.current) clearTimeout(timeout.current); timeout.current = setTimeout(() => setCopied(false), 2200); }
    catch { setStatus("浏览器未允许复制，可以下载摘要保存。"); }
  }
  function download() {
    const blob = new Blob([summaryText(report, kind)], { type: "text/plain;charset=utf-8" }); const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `成子-${kind === "chat" ? "聊天" : "资料"}分析摘要-${new Date().toISOString().slice(0, 10)}.txt`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setStatus("已准备摘要文件，请在浏览器下载中查看。");
  }
  return <div className="report-tools"><div className="report-tools-heading"><FileText size={16}/><span>把有用的判断，留在手边</span></div><div className="report-tools-actions"><button type="button" onClick={() => void copy()}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? "已复制" : "复制摘要"}</button><button type="button" onClick={download}><Download size={15}/> 下载摘要</button></div>{status && <p role="status">{status}</p>}</div>;
}
