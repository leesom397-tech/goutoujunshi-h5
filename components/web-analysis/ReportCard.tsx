"use client";

import { ArrowUpRight, ChevronUp, MessageCircle, ChartNoAxesCombined, Sparkles, Quote, Compass } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

export type ReportCardItem = {
  id: string;
  label: string;
  summary: string;
  value: string;
  bars: number[];
  tone: "teal" | "gold" | "blue" | "sage" | "ink" | "slate";
};

export function ReportTabs({ items, active, onSelect }: { items: ReportCardItem[]; active: string; onSelect: (id: string) => void }) {
  return <nav className="report-card-tabs" aria-label="选择报告内容">{items.map(item => <button key={item.id} type="button" aria-pressed={active === item.id} onClick={() => onSelect(item.id)}>{item.label}</button>)}</nav>;
}

export function ReportCard({ item, open, onToggle, children }: { item: ReportCardItem; open: boolean; onToggle: () => void; children: ReactNode }) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => { if (!open) return; const frame = requestAnimationFrame(() => card.current?.scrollIntoView({behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",block:"start"})); return () => cancelAnimationFrame(frame); }, [open]);
  const Icon = item.id === "tone" ? MessageCircle : item.id === "signals" || item.id === "content" ? ChartNoAxesCombined : item.id === "insights" ? Sparkles : item.id === "lines" || item.id === "evidence" ? Quote : Compass;
  return <article ref={card} id={`card-${item.id}`} className={`report-card report-card-${item.tone}${open ? " is-open" : ""}`}>
    <button id={`card-${item.id}-heading`} className="report-card-head" type="button" aria-expanded={open} aria-controls={`card-${item.id}-body`} onClick={onToggle}>
      <span className="report-card-text"><small><Icon size={18}/>{item.label}</small><strong>{item.summary}</strong></span>
      <span className="report-card-visual" aria-hidden="true"><b>{item.value}</b><span className="report-card-spark">{item.bars.map((height, index) => <i key={index} data-empty={height <= 0 ? "true" : undefined} style={{ height: `${Math.max(0, Math.min(100, height))}%` }}/>)}</span></span>
      <span className="report-card-toggle">{open ? "收起详情" : "查看分析"}{open ? <ChevronUp size={18}/> : <ArrowUpRight size={18}/>}</span>
    </button>
    {open && <div role="region" aria-labelledby={`card-${item.id}-heading`} id={`card-${item.id}-body`} className="report-card-body">{children}</div>}
  </article>;
}
