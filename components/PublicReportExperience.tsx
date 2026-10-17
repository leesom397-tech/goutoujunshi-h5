"use client";

import { useEffect, useId, useState } from "react";
import { AnalysisExample } from "@/components/web-analysis/AnalysisExample";
import type { Json } from "@/components/web-analysis/client";
import "@/components/web-analysis/web-analysis.css";

/** Legacy caller shape; only curated fictional fixtures are rendered. */
export type PublicAnalysisExample = { title: string; question: string; analyzedAt: string; report: Json };
type CaseMode = "chat" | "social" | "moments";
const cases: { key: CaseMode; label: string }[] = [{ key: "chat", label: "聊天截图" }, { key: "moments", label: "朋友圈" }, { key: "social", label: "社交主页" }];

export function PublicReportExperience({ onStart }: { example?: PublicAnalysisExample; onStart: (mode: CaseMode) => void }) {
  const [mode, setMode] = useState<CaseMode>("chat"), id = useId();
  useEffect(() => { const select = (event: Event) => { const value = (event as CustomEvent).detail; if (cases.some(item => item.key === value)) setMode(value); }; window.addEventListener("public-case-select", select); return () => window.removeEventListener("public-case-select", select); }, []);
  return <section className="wa-shell public-report-example" id="experience" tabIndex={-1} aria-label="功能报告案例">
    <div className="public-case-switch" role="tablist" aria-label="选择报告案例">{cases.map(item => <button key={item.key} type="button" role="tab" id={id + "-" + item.key} aria-selected={mode === item.key} aria-controls={id} onClick={() => setMode(item.key)}>{item.label}</button>)}</div>
    <div id={id} role="tabpanel" aria-labelledby={id + "-" + mode}><AnalysisExample mode={mode} onUpload={() => onStart(mode)}/></div>
  </section>;
}

