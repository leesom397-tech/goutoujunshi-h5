"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Send, Sparkles, ArrowRight, PencilLine, RotateCcw } from "lucide-react";
import { personalizeReplyText, replyStyleSamples } from "@/lib/crush/reply-style";
import { riskAwarePresentation, riskReplyAllowed } from "@/lib/risk-aware-presentation";
import { api, ErrorNotice, hasPrice, message, priceLabel, type Json } from "./client";
import styles from "./ReportReplies.module.css";
import { ReportSectionLink } from "./ReportReader";
import { ReportReturnLink } from "./ReportReturnLink";
import { useReportSessionState } from './ReportSessionState';
import { reportLineKey } from '@/lib/report-reading-position';

type RepliesProps = {
  options: Json[]; report?: Json; account: Json | null; styleReportIds?: string[]; publicExample?: boolean; compact?: boolean;
};
/** Keep drafts and in-flight receipts isolated when the report or account changes. */
export function Replies(props: RepliesProps) {
  const scope = JSON.stringify([props.account?.account?.userId, props.report?.reportId || props.report?.id, props.report?.subjectId, props.publicExample, props.options.map(option => [option.text, option.style, option.originalIndex, option.adjusted])]);
  return <ReplyOptions key={scope} {...props}/>;
}

/** Choosing or manually editing a saved option never starts another model request. */
function ReplyOptions({ options, report, account, styleReportIds, publicExample = false, compact = false }: RepliesProps) {
  const optionKey=reportLineKey({text:JSON.stringify(options.map(option=>[option.text,option.style]))},0);
  const [rewrites, setRewrites] = useReportSessionState<Record<number, Json>>('reply-rewrites:'+optionKey,{});
  const [busy, setBusy] = useState(-1), [error, setError] = useState("");
  const [copied, setCopied] = useState<{index:number;text:string}|null>(null);
  const [drafts, setDrafts] = useReportSessionState<Record<number,{text:string;editing:boolean}>>('reply-drafts:'+optionKey,{});
  const editorId = useId(), editor = useRef<HTMLTextAreaElement>(null);
  const [confirmation, setConfirmation] = useState<{ index: number; price: string } | null>(null);
  const ids = useRef<Record<number, string>>({}), mounted = useRef(true), working = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const variants = options.map((option, index) => ({ ...option, index } as Json & { index: number }))
    .filter((option, index, all) => typeof option.text === "string" && option.text.trim() && all.findIndex(other => typeof other.text === "string" && other.text.trim() === option.text.trim()) === index).slice(0, 3);
  const samples = replyStyleSamples(report?.lines || []), loggedIn = !!account?.account?.userId;
  const eligible = !!report && samples.eligible;
  const savedReportId=report?.reportId||report?.id;
  const unavailable = publicExample ? "" : !savedReportId ? "这份结果尚未保存，暂不能按我的习惯改写。" : !loggedIn ? "登录后可参考你已确认的原话调整语气。" : !eligible ? "你的原话样本还不足。可以先复制已有方案，之后补充你自己的回复。" : !hasPrice(account, "text") ? "改写费用暂未取回，请到账户重试。" : "";
  const quotedPrice = publicExample ? "案例演示 · 免费" : priceLabel(account, "text");
  function editDraft(index:number,text:string,editing=true){setDrafts(previous=>({...Object.fromEntries(Object.entries(previous).map(([key,value])=>[key,{...value,editing:false}])),[index]:{text,editing}}));}
  function clearDraft(index:number){setDrafts(previous=>{const next={...previous};delete next[index];return next;});setCopied(null);}
  async function copy(text: string, index: number) {
    try { await navigator.clipboard.writeText(text); if (mounted.current) { setCopied({index,text}); setError(""); } }
    catch {
      if (!mounted.current) return;
      setCopied(null);
      editDraft(index,text);
      setError("复制没有完成，可以在输入框中长按或按 Ctrl/Cmd+C 复制。");
      requestAnimationFrame(() => { editor.current?.focus(); editor.current?.select(); });
    }
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
      const result = await api("/api/web/rewrite", { reportId: savedReportId, optionIndex: options[index].originalIndex ?? index, confirmed: true, requestId: ids.current[index], ...(styleReportIds?.length ? { styleReportIds } : {}) });
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
    <div className={styles.cards} data-show-all="true" data-option-count={variants.length}>
      {variants.map(option => {
        const index = option.index, revised = rewrites[index], original = revised?.status === "adjusted" ? revised.text : option.text;
        const localDraft = drafts[index], body = localDraft?.text ?? original;
        const manuallyChanged = !!localDraft && localDraft.text !== original, copyDone = copied?.index === index && copied.text === body;
        const canRewrite = (report || publicExample) && !option.adjusted && option.originalIndex !== null;
        return <article key={index} className={`${styles.card} ${compact ? "" : "wa-reply"}`} data-saved-reply data-reply-index={index}>
          <header><span className={styles.badge}>{index === 0 ? "本轮首选" : `方案 ${index + 1}`}</span><h3>{option.style || "自然回应"}</h3>{option.adjusted && <small>边界建议</small>}</header>
          {localDraft?.editing ? <div className={styles.editor} data-reply-editor>
            <label htmlFor={editorId}>按你的习惯改一句</label>
            <textarea id={editorId} ref={editor} value={body} rows={4} autoFocus aria-describedby={editorId+"-hint"} onChange={event => { editDraft(index,event.target.value); setCopied(null); }}/>
            <p id={editorId+"-hint"}>手动修改免费，改另一句时会保留这一句；刷新页面后还原。</p>
            <div><button type="button" disabled={!body.trim()} onClick={() => manuallyChanged ? editDraft(index,body,false) : clearDraft(index)}><Check size={16}/>完成编辑</button><button type="button" onClick={() => clearDraft(index)}><RotateCcw size={16}/>还原这句</button></div>
          </div> : <p className={styles.replyText} data-reply-text>{body}</p>}
          <div className={styles.replyActions}>
            <button type="button" className={styles.copy} disabled={!body.trim()} data-copy-reply onClick={() => void copy(body, index)}>{copyDone ? <Check size={18}/> : <Copy size={18}/>} {copyDone ? "已复制" : "复制这句"}</button>
            {!localDraft?.editing && <button type="button" className={styles.edit} disabled={busy !== -1} data-edit-reply onClick={() => { editDraft(index,body); setConfirmation(null); setError(""); }}><PencilLine size={17}/>{manuallyChanged ? "继续修改" : "自己改一句"}</button>}
          </div>
          {option.reason&&<p className={styles.reason}>{option.reason}</p>}
          {manuallyChanged && <p className={styles.editNote}>已手动修改；适用理由仍对应原方案。{!localDraft?.editing&&<button type="button" onClick={() => clearDraft(index)}>还原这句</button>}</p>}
          <details className={styles.details}>
            <summary>发送前留意与更多调整<ChevronDown size={17}/></summary>
            {option.cost && <div><strong>发送前留意</strong><p>{option.cost}</p></div>}
            {revised?.status === "adjusted" && <div><strong>原方案</strong><p>{option.text}</p></div>}
            {compact && canRewrite && <ReportSectionLink className={styles.customize} section="next"><Sparkles size={17}/>到回复区调整语气<ArrowRight size={16}/></ReportSectionLink>}
            {!compact && canRewrite && <div className={styles.personalize}>
              <button type="button" className={styles.customize} disabled={!!unavailable || busy !== -1 || !!revised || !!localDraft} onClick={() => { setConfirmation({ index, price: quotedPrice }); setError(""); }}><Sparkles size={17}/>{busy === index ? "正在调整…" : revised ? "已核对我的语气" : "改得更像我"}{!revised && <small>{quotedPrice}</small>}</button>
              {localDraft && <p>还原这句后，可以使用语气改写。</p>}
              {unavailable && <p>{unavailable}{!loggedIn ? <a href={`/login?return_to=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/reports")}`}>登录</a> : eligible && !hasPrice(account, "text") ? <a href="/account">查看账户</a> : null}</p>}
              {confirmation?.index === index && <div className={styles.confirmation} data-rewrite-confirmation role="region" aria-label="确认语气改写">
                <strong>这次改写 · {confirmation.price}</strong><p>参考你已确认的表达习惯，调整这一句。<a href="/privacy#ai-processing" target="_blank" rel="noreferrer">数据处理说明</a></p>
                <div><button type="button" disabled={busy !== -1} onClick={() => void rewrite(index)} data-confirm-rewrite>确认改写 · {confirmation.price}</button><button type="button" disabled={busy !== -1} onClick={() => setConfirmation(null)}>先不改</button></div>
              </div>}
            </div>}
            {revised?.note && <p className={styles.result} role="status">{revised.note}</p>}
            {revised?.experienceEvidence?.map((item: Json) => <blockquote className={styles.result} key={item.id}><strong>已确认的共同经历</strong><p>{item.quote}</p><ReportReturnLink reportId={savedReportId||""} href={"/report?id=" + encodeURIComponent(item.sourceReportId)}>回看来源</ReportReturnLink></blockquote>)}
          </details>
        </article>;
      })}
    </div>
    <ErrorNotice error={error}/>
  </section>;
}
