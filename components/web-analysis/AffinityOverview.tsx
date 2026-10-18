import { Heart, MessageCircle, Send } from "lucide-react";
import { reportAffinity, validScore } from "./report-data";
import type { Json } from "./client";
import styles from "./AffinityOverview.module.css";

export function AffinityOverview({ report }: { report: Json }) {
  const signal = reportAffinity(report), value = signal?.value;
  const dimensions: Json[] = (signal?.dimensions || []).filter((row: Json) => row.status !== "insufficient" && validScore(row.value));
  const known = validScore(value);
  function selectTab(button: HTMLButtonElement, tab: string) { button.closest("[data-report-reader]")?.querySelector<HTMLButtonElement>(`[role="tab"][aria-controls$="-panel-${tab}"]`)?.click(); }
  return <section className={styles.panel} aria-label="好感探测器" data-affinity-overview>
    <div className={styles.score}><span><Heart size={19}/>好感探测器</span><strong>{known ? Math.round(value) : "待判断"}{known && <small>/ 100</small>}</strong><p>{known ? "好感参考值 · 基于本次聊天线索" : "本次材料还不足以给出好感参考值"}</p></div>
    <div className={styles.details}>{dimensions.length > 0 ? <div className={styles.dimensions}>{dimensions.map(row => <div key={row.key || row.label}><span>{row.label}</span><i><b style={{width: `${row.value}%`}}/></i><strong>{Math.round(row.value)}</strong></div>)}</div> : <p>先看具体原话与回应，补充上下文后再核对。</p>}<small>{signal?.valueScope === "partial" ? "部分维度可判断，参考值仍有不确定性。" : "分数概括可见互动线索，不代表对方喜欢你的概率。"}</small></div>
    <nav aria-label="继续解读本次聊天"><button type="button" onClick={event => selectTab(event.currentTarget, "change")}><MessageCircle size={18}/>逐句意图</button><button type="button" onClick={event => selectTab(event.currentTarget, "next")}><Send size={18}/>怎么回</button></nav>
  </section>;
}
