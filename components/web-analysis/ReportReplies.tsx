"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Send, Sparkles, ArrowRight } from "lucide-react";
import { personalizeReplyText, replyStyleSamples } from "@/lib/crush/reply-style";
import { riskAwarePresentation, riskReplyAllowed } from "@/lib/risk-aware-presentation";
import { api, ErrorNotice, hasPrice, message, priceLabel, type Json } from "./client";
import { ReplyDifference } from "./ReportReadingTools";
import styles from "./ReportReplies.module.css";

/** Choosing a saved option never starts another model request. */
export function Replies({ options, report, account, styleReportIds, publicExample = false, compact = false }: {
  options: Json[]; report?: Json; account: Json | null; styleReportIds?: string[]; publicExample?: boolean; compact?: boolean;
}) {
  const [rewrites, setRewrites] = useState<Record<number, Json>>({});
  const [busy, setBusy] = useState(-1), [error, setError] = useState(""), [copied, setCopied] = useState(-1);
  const [selected, setSelected] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<{ index: number; price: string } | null>(null);
  const ids = useRef<Record<number, string>>({}), mounted = useRef(true), working = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const variants = options.map((option, index) => ({ ...option, index } as Json & { index: number }))
    .filter((option, index, all) => typeof option.text === "string" && option.text.trim() && all.findIndex(other => typeof other.text === "string" && other.text.trim() === option.text.trim()) === index).slice(0, 3);
  const samples = replyStyleSamples(report?.lines || []), loggedIn = !!account?.account?.userId;
  const eligible = !!report && samples.eligible;
  const unavailable = publicExample ? "" : !report?.id ? "这份结果尚未保存，暂不能按我的习惯改写。" : !loggedIn ? "登录后可参考你已确认的原话调整语气。" : !eligible ? "你的原话样本还不足。可以先复制已有方案，之后补充你自己的回复。" : !hasPrice(account, "text") ? "改写费用暂未取回，请到账户重试。" : "";
  const quotedPrice = publicExample ? "案例演示 · 免费" : priceLabel(account, "text");
  async function copy(text: string, index: number) {
    try { await navigator.clipboard.writeText(text); setCopied(index); setError(""); }
    catch { setError("复制没有完成，可以选中回复文字复制。"); }
  }
  function choose(index: number | null) {
    setSelected(index); setConfirmation(null);
  }
  function openReplySection(button: HTMLButtonElement) {
    button.closest("[data-report-reader]")?.querySelector<HTMLButtonElement>('[role="tab"][aria-controls$="-panel-next"]')?.click();
  }
  async function rewrite(index: number) {
    if (working.current || rewrites[index] || options[index]?.adjusted || options[index]?.originalIndex === null || confirmation?.index !== index || unavailable) return;
    if (confirmation.price !== quotedPrice) { setConfirmation({ index, price: quotedPrice }); setError("费用已更新，请核对后再确认。"); return; }
    if (publicExample) {
      const value = personalizeReplyText(options[index].text, report?.lines || []);
      setRewrites(previous => ({ ...previous, [index]: { ...value, note: `案例演示，不扣积分。${value.note}` } }));
      setConfirmation(null); setError(""); return;
    }
    if (!report) return;
    working.current = true; setBusy(index); setError("");
    try {
      ids.current[index] ||= crypto.randomUUID();
      const result = await api("/api/web/rewrite", { reportId: report.id, optionIndex: options[index].originalIndex ?? index, confirmed: true, requestId: ids.current[index], ...(styleReportIds?.length ? { styleReportIds } : {}) });
      if (!result.text || !["adjusted", "unchanged"].includes(result.status) || !result.note) throw new Error("改写未完整返回，原推荐仍可使用。");
      if (!riskReplyAllowed(riskAwarePresentation(report), result.text)) throw new Error("这次改写偏离了当前边界建议，先保留原推荐。");
      if (mounted.current) { setRewrites(previous => ({ ...previous, [index]: result })); setConfirmation(null); window.dispatchEvent(new Event("chengzi:credits-changed")); }
    } catch (cause) {
      const details = (cause as any)?.details, released = details?.creditTaskStatus === "released" || details?.code === "CREDIT_RELEASED";
      if (released) { delete ids.current[index]; window.dispatchEvent(new Event("chengzi:credits-changed")); }
      if (mounted.current) setError(message(cause) + (released ? " 本次积分已退回，可以再试。" : ""));
    } finally { working.current = false; if (mounted.current) setBusy(-1); }
  }
  if (!variants.length) return <section className={styles.empty} data-reply-empty><h2><Send size={21}/>这一轮先怎么做</h2><p>{report ? riskAwarePresentation(report).nextStep || "这份报告没有保留可直接发送的回复。" : "这份报告没有保留可直接发送的回复。"}</p><small>当前没有可复制的方案；先按这一步行动。</small></section>;
  return <section className={`${styles.board} ${compact ? "" : "wa-replies"}`} data-reply-board data-reply-preview={compact || undefined}>
    <header className={styles.heading}><div><span><Send size={18}/>怎么回</span><h2>选一句，直接用</h2></div><small>{variants.length > 1 ? `${variants.length} 种已生成方案` : "本轮保留 1 种方案"}</small></header>
    {variants.length > 1 && <div className={styles.selector} role="group" aria-label="选择回复目的或语气">
      <button type="button" aria-pressed={selected === null} onClick={() => choose(null)}>全部方案</button>
      {variants.map(option => <button type="button" key={option.index} aria-pressed={selected === option.index} onClick={() => choose(option.index)}>{option.style || `方案 ${option.index + 1}`}</button>)}
    </div>}
    <div className={styles.cards} data-show-all={selected === null}>
      {variants.map(option => {
        const index = option.index, revised = rewrites[index], body = revised?.status === "adjusted" ? revised.text : option.text;
        const canRewrite = (report || publicExample) && !option.adjusted && option.originalIndex !== null;
        return <article key={index} className={`${styles.card} ${compact ? "" : "wa-reply"}`} hidden={selected !== null && selected !== index} data-saved-reply data-reply-index={index}>
          <header><span className={styles.badge}>{index === 0 ? "本轮首选" : `方案 ${index + 1}`}</span><h3>{option.style || "自然回应"}</h3>{option.adjusted && <small>边界建议</small>}</header>
          <p className={styles.replyText}>{body}</p>
          <button type="button" className={styles.copy} data-copy-reply onClick={() => void copy(body, index)}>{copied === index ? <Check size={18}/> : <Copy size={18}/>} {copied === index ? "已复制" : "复制这句"}</button>
          <details className={styles.details}>
            <summary>{compact ? "为什么这样回" : "理由与语气调整"}<ChevronDown size={17}/></summary>
            {option.reason && <div><strong>适合这轮的原因</strong><p>{option.reason}</p></div>}
            {option.cost && <div><strong>发送前留意</strong><p>{option.cost}</p></div>}
            <ReplyDifference options={options} index={index}/>
            {revised?.status === "adjusted" && <div><strong>原方案</strong><p>{option.text}</p></div>}
            {compact && canRewrite && <button type="button" className={styles.customize} onClick={event => openReplySection(event.currentTarget)}><Sparkles size={17}/>调整为我的语气<ArrowRight size={16}/></button>}
            {!compact && canRewrite && <div className={styles.personalize}>
              <button type="button" className={styles.customize} disabled={!!unavailable || busy !== -1 || !!revised} onClick={() => { setConfirmation({ index, price: quotedPrice }); setError(""); }}><Sparkles size={17}/>{busy === index ? "正在调整…" : revised ? "已核对我的语气" : "改得更像我"}{!revised && <small>{quotedPrice}</small>}</button>
              {unavailable && <p>{unavailable}{!loggedIn ? <a href={`/login?return_to=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/reports")}`}>登录</a> : eligible && !hasPrice(account, "text") ? <a href="/account">查看账户</a> : null}</p>}
              {confirmation?.index === index && <div className={styles.confirmation} data-rewrite-confirmation role="region" aria-label="确认语气改写">
                <strong>这次改写 · {confirmation.price}</strong><p>参考你已确认的表达习惯，调整这一句。<a href="/privacy#ai-processing" target="_blank" rel="noreferrer">数据处理说明</a></p>
                <div><button type="button" disabled={busy !== -1} onClick={() => void rewrite(index)} data-confirm-rewrite>确认改写 · {confirmation.price}</button><button type="button" disabled={busy !== -1} onClick={() => setConfirmation(null)}>先不改</button></div>
              </div>}
            </div>}
            {revised?.note && <p className={styles.result} role="status">{revised.note}</p>}
            {revised?.experienceEvidence?.map((item: Json) => <blockquote className={styles.result} key={item.id}><strong>已确认的共同经历</strong><p>{item.quote}</p><a href={"/report?id=" + encodeURIComponent(item.sourceReportId)}>回看来源</a></blockquote>)}
          </details>
        </article>;
      })}
    </div>
    <ErrorNotice error={error}/>
  </section>;
}
