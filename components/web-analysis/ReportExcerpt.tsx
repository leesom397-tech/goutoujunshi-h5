"use client";

import { ChevronDown } from "lucide-react";
import styles from "./ReportExcerpt.module.css";

/** Keep the full saved text; the fold only changes how much is shown at once. */
export function ReportExcerpt({ value, limit = 180, quote = false }: { value: unknown; limit?: number; quote?: boolean }) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  let cut = text.length > limit ? limit : text.length;
  if (cut < text.length) {
    const boundary = Math.max(text.lastIndexOf("。", cut), text.lastIndexOf("；", cut), text.lastIndexOf("\n", cut));
    if (boundary >= limit * .55) cut = boundary + 1;
  }
  const first = text.slice(0, cut), rest = text.slice(cut);
  return <div className={styles.excerpt} data-report-excerpt data-quote={quote || undefined}>
    {quote ? <blockquote>{first}</blockquote> : <p>{first}</p>}
    {rest && <details><summary>展开{quote ? "完整原话" : "详细解读"}<ChevronDown size={16}/></summary><div className={styles.remainder}>{quote ? <blockquote>{rest}</blockquote> : <p>{rest}</p>}</div></details>}
  </div>;
}
