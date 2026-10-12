"use client";

import { ArrowUpRight, ChevronUp, MessageCircle, ChartNoAxesCombined, Sparkles, Quote, Compass, HeartHandshake, Images, Send, UserRound } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./ReportCard.module.css";

export type ReportCardItem = {
  id: string;
  label: string;
  summary: string;
  value: string;
  bars: number[];
  tone: "teal" | "gold" | "blue" | "sage" | "ink" | "slate";
};

const cardIcon = (id: string) => id === "tone" ? MessageCircle : id === "signals" || id === "content" ? ChartNoAxesCombined : id === "insights" ? Sparkles : id === "lines" || id === "evidence" ? Quote : id === "fit" ? HeartHandshake : id === "photos" ? Images : id === "replies" ? Send : id === "overview" ? UserRound : Compass;

export function ReportTabs({ items, active, onSelect }: { items: ReportCardItem[]; active: string; onSelect: (id: string) => void }) {
  return <nav className={styles.tabs} aria-label="选择报告内容">{items.map(item => { const Icon = cardIcon(item.id); return <button key={item.id} type="button" aria-pressed={active === item.id} aria-controls={`card-${item.id}`} onClick={() => onSelect(item.id)}><Icon size={17} aria-hidden="true"/>{item.label}</button>; })}</nav>;
}

export function ReportCard({ item, open, onToggle, children }: { item: ReportCardItem; open: boolean; onToggle: () => void; children: ReactNode }) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => { if (!open) return; const frame = requestAnimationFrame(() => card.current?.scrollIntoView({behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",block:"start"})); return () => cancelAnimationFrame(frame); }, [open]);
  const Icon = cardIcon(item.id);
  const first = item.summary.match(/^.*?[。！？]/)?.[0] || item.summary;
  const rest = item.summary.slice(first.length);
  return <article ref={card} id={`card-${item.id}`} className={`${styles.card}${open ? ` ${styles.open}` : ""}`}>
    <button id={`card-${item.id}-heading`} className={styles.head} type="button" aria-expanded={open} aria-controls={`card-${item.id}-body`} onClick={onToggle}>
      <span className={styles.text}><small><span className={styles.icon}><Icon size={20} aria-hidden="true"/></span>{item.label}</small><span className={styles.summary}><strong>{first}</strong>{rest && <span>{rest}</span>}</span></span>
      <span className={styles.visual}><b>{item.value}</b><ReportMiniChart item={item}/></span>
      <span className={styles.toggle}>{open ? "收起详情" : "查看分析"}{open ? <ChevronUp size={16}/> : <ArrowUpRight size={16}/>}</span>
    </button>
    {open && <div role="region" aria-labelledby={`card-${item.id}-heading`} id={`card-${item.id}-body`} className={styles.body}>{children}</div>}
  </article>;
}

function ReportMiniChart({item}:{item:ReportCardItem}) {
 const values=item.bars.map(n=>Math.max(0,Math.min(100,n)));
 if(item.id==="signals" || item.id==="fit") {
   const labels=item.id==="signals"?["主动","回应","关心","开放","亲近","行动"]:["年龄","距离","学历","职业","目标","生活"];
   return <span className={styles.dimensions} role="img" aria-label={item.id==="signals"?"本段六类互动线索覆盖，非好感概率":"资料适配维度，详见展开后的依据"}>{labels.map((label,i)=><span key={label}><i><em style={{height:`${values[i]||0}%`}}/></i><small>{label}</small></span>)}</span>;
 }
 if(item.id==="judgment") return <span className={styles.steps} aria-label="判断、依据、行动"><span>判断</span><i/><span>依据</span><i/><span>行动</span></span>;
 if(item.id==="lines") return <span className={styles.share} role="img" aria-label="本段说话人构成"><span>{values.map((v,i)=><i key={i} style={{flex:v||0,display:v?'block':'none'}}/>)}</span><small>我 · 对方 · 其他</small></span>;
 if(item.id==="content")return <span className={styles.share} role="img" aria-label="材料内容构成，展开查看分类"><span>{values.map((v,i)=><i key={i} style={{flex:v||0,display:v?'block':'none'}}/>)}</span><small>内容构成</small></span>;
 const count=values.filter(v=>v>0).length;
 return <span className={styles.items} aria-label={`${count} 项可展开内容`}><span>{Array.from({length:Math.min(count,6)},(_,i)=><i key={i}/>)}</span><small>{item.id==="tone"?"语气线索":item.id==="replies"?"回复方案":item.id==="insights"?"推测依据":"可见材料"}</small></span>;
}
