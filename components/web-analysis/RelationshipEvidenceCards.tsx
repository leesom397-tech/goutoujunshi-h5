import { ArrowUpRight, Quote, GitCompareArrows, Lightbulb } from "lucide-react";
import type { RelationshipEvidenceReview } from "@/lib/relationship-evidence";
import styles from "./RelationshipEvidenceCards.module.css";

/** Only concrete differences are shown; no extra intake or empty-state task. */
export function RelationshipEvidenceCards({ review, publicExample = false }: { review?: RelationshipEvidenceReview; publicExample?: boolean }) {
  if (!review?.cards.length) return null;
  const cards = review.cards.slice(0, 3);
  return <div className={styles.review} aria-label="新旧材料对照"><h3 className={styles.heading}><GitCompareArrows size={18}/>{cards.some(card=>card.kind==="pattern"||card.kind==="repair")?"互动模式与修复进展":cards.some(card=>card.kind!=="feedback")?"说法与行动 · 资料一致性":"你补充的新经过"}</h3>
    {cards.map((card, index) => <article className={styles.card} key={card.title + index}>
      <h3>{card.title}</h3><p>{card.reading}</p>{card.steps?.length&&<ol className={styles.steps} aria-label="修复进展">{card.steps.map((step,index)=><li key={step.label} data-status={step.status}><span>{String(index+1).padStart(2,"0")} · {step.label}</span><strong>{step.detail}</strong></li>)}</ol>}{card.explanation&&<p className={styles.possibility}><Lightbulb size={16}/><span>{card.kind==="repair"||card.kind==="pattern"?"判断范围：":"可能解释："}{card.explanation.match(/^.*?[。！？]/)?.[0]||card.explanation.slice(0,110)}</span></p>}
    </article>)}
    <details className={styles.details}><summary>查看原文依据与可能解释{review.cards.length > 3 ? " · 还有 " + (review.cards.length - 3) + " 条对照" : ""}</summary>
      {review.cards.map((card, index) => <div key={card.title + index}><h4>{card.title}</h4><div className={styles.sources}>{card.sources.map((source, sourceIndex) => <blockquote key={source.reportId + sourceIndex}>
        <span><Quote size={14}/>{source.label} · {source.date || "材料日期未明确"}</span><p>{source.text}</p>{!publicExample && source.reportId && <a href={"/report?id=" + encodeURIComponent(source.reportId)}>回看来源<ArrowUpRight size={13}/></a>}
      </blockquote>)}</div><p>{card.explanation}</p>{card.question && <p><strong>可以自然问：</strong>{card.question}</p>}<p className={styles.observe}><strong>接着看：</strong>{card.observe}</p></div>)}
      <small>{review.note}</small>
    </details>
  </div>;
}
