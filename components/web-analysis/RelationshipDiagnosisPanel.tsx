"use client";
import { useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, History, Quote, Sparkles } from "lucide-react";
import { CaptureEvidence } from "./CaptureEvidence";
import { reportPersonLabel } from "@/components/report-person-label";
import { reportEvidenceDate } from "@/lib/report-reading";
import styles from "./RelationshipDiagnosisPanel.module.css";
import {reportEvidenceSpeaker} from "./report-context";
import { ReportExcerpt } from "./ReportExcerpt";

type Json = Record<string, any>;
const rows = (value: unknown): Json[] => Array.isArray(value) ? value.filter(item => item && typeof item === "object") : [];
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const normalized = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, "");
const uniqueText = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];

/** Supporting reading only. The report overview owns the judgment and next step. */
export function RelationshipDiagnosisPanel({ diagnosis, semanticHistory: standalone, report={}, folded = false, hideCoverage = false, pageSize, hideFacts = false, compactEvidence = false }: { diagnosis?: Json | null; semanticHistory?: Json | null; report?:Json; folded?: boolean; hideCoverage?: boolean; pageSize?:number; hideFacts?:boolean; compactEvidence?:boolean }) {
  const [page,setPage]=useState(0);
  const evidenceRoot=useRef<HTMLElement>(null);
  function turn(next:number){setPage(next);requestAnimationFrame(()=>evidenceRoot.current?.scrollIntoView({block:'start',behavior:'instant'}));}
  const semantic = standalone || diagnosis?.semanticHistory;
  if (!diagnosis && !semantic) return null;
  const coverage = diagnosis?.coverage || {}, semanticCoverage = semantic?.coverage;
  const facts = rows(diagnosis?.facts).filter(row => row.id !== "activity:coverage");
  // The same sentence about two people, or supported by different sources, is not a duplicate.
  const findings = rows(semantic?.findings).filter((row, index, all) => all.findIndex(other =>
    row.id ? other.id === row.id : other.subject === row.subject
      && normalized(text(other.claim)) === normalized(text(row.claim))
      && JSON.stringify(rows(other.evidence)) === JSON.stringify(rows(row.evidence))
  ) === index);
  const counterIds = new Set(uniqueText(semantic?.counterEvidenceIds));
  // Keep at least one contrary finding in the first reading page.
  const ordered=pageSize&&findings.length>pageSize&&findings.slice(0,pageSize).every(row=>!counterIds.has(row.id))&&findings.some(row=>counterIds.has(row.id))?[...findings.slice(0,pageSize-1),findings.find(row=>counterIds.has(row.id))!,...findings.slice(pageSize-1).filter(row=>!counterIds.has(row.id)),...findings.filter(row=>counterIds.has(row.id)).slice(1)]:findings;
  const pages=pageSize?Math.max(1,Math.ceil(ordered.length/pageSize)):1,currentPage=Math.min(page,pages-1),visibleFindings=pageSize?ordered.slice(currentPage*pageSize,(currentPage+1)*pageSize):ordered;
  const hypotheses = rows(diagnosis?.hypotheses);
  const unknowns = [...new Set([...uniqueText(semantic?.unknowns), ...uniqueText(diagnosis?.unknowns)])];
  const alternatives = uniqueText(semantic?.alternatives);
  const explanation = text(semantic?.explanation);
  return <section className={styles.reading} aria-label="判断依据与其他解释" data-folded={folded}>
    {explanation && normalized(explanation) !== normalized(text(semantic?.summary)) && <section className={`${styles.readingBlock} ${styles.inferenceBlock}`} data-reading-kind="inference">
      <h3><Sparkles size={18}/>为什么这样判断{semantic?.confidence && <small>把握度：{semantic.confidence}</small>}</h3>
      <ReportExcerpt value={explanation} limit={240}/>
    </section>}
    {findings.length > 0 && <section ref={evidenceRoot} style={{scrollMarginTop:120}} className={styles.readingBlock} data-history-findings><h3><Quote size={18}/>支持与相反线索</h3><div className={styles.findings}>
      {visibleFindings.map((finding, index) => <article key={finding.id || index} data-finding-id={finding.id} data-reading-kind={counterIds.has(finding.id) ? "counter" : "inference"}>
        <header><small className={styles.kindLabel}>{counterIds.has(finding.id) ? "相反证据" : "根据材料的推测"}{finding.confidence ? ` · 把握度 ${finding.confidence}` : ""}</small><strong>{finding.claim}</strong></header>
        {rows(finding.evidence).map((item, evidenceIndex) => <div className={compactEvidence?styles.evidenceLink:styles.findingEvidence} key={`${item.sourceId}-${evidenceIndex}`} data-reading-kind="fact"><small>原文事实 · {reportEvidenceSpeaker(report,item.senderRole,item.basis)}{item.at ? ` · ${reportEvidenceDate(item.at)}` : ""}</small>{!compactEvidence&&<ReportExcerpt value={item.quote} quote limit={160}/>}<CaptureEvidence quote={item.quote} sourceIds={item.sourceId ? [item.sourceId] : undefined} libraryId={item.libraryId} sourceKind={item.sourceKind} label={item.basis==="visual"?"查看图片来源":undefined}/></div>)}
        {finding.alternative && <div className={styles.alternative} data-reading-kind="alternative"><strong>另一种解释</strong><ReportExcerpt value={finding.alternative}/></div>}
      </article>)}
    </div>{pages>1&&<nav className={styles.evidencePager} aria-label="判断线索分页"><button disabled={!currentPage} onClick={()=>turn(currentPage-1)}><ChevronLeft size={16}/>上一组</button><span>{currentPage+1} / {pages} · 共 {findings.length} 条线索</span><button disabled={currentPage===pages-1} onClick={()=>turn(currentPage+1)}>下一组<ChevronRight size={16}/></button></nav>}</section>}
    {!findings.length && hypotheses.length > 0 && <section className={styles.readingBlock}><h3><Sparkles size={18}/>从行为看到的线索</h3><div className={styles.findings}>{hypotheses.map((item, index) => <article key={item.id || index}><header><strong>{item.claim}</strong><small>把握度 {item.confidence || "低"}</small></header>{uniqueText(item.alternatives).map(value => <p className={styles.alternative} key={value}>其他解释：{value}</p>)}{item.whatToObserve && <p>接着观察：{item.whatToObserve}</p>}</article>)}</div></section>}
    {alternatives.length > 0 && <section className={styles.readingBlock}><h3><CircleHelp size={18}/>还存在这些解释</h3><ul>{alternatives.map(value => <li key={value}>{value}</li>)}</ul></section>}
    {!hideFacts && facts.length > 0 && <section className={styles.readingBlock}><h3><CheckCircle2 size={18}/>可核对的行为事实</h3><div className={styles.factList}>{facts.map((fact, index) => <article key={fact.id || index}><strong>{fact.claim}</strong>{fact.metric && <small>{fact.metric}</small>}</article>)}</div></section>}
    {unknowns.length > 0 && <section className={styles.readingBlock}><h3><CircleHelp size={18}/>目前还不知道什么</h3><ul>{unknowns.map(value => <li key={value}>{value}</li>)}</ul></section>}
    {!hideCoverage && <section className={styles.readingBlock}><h3><History size={18}/>这份报告看了哪些材料</h3>
      <dl className={styles.readingCoverage}>
        <div><dt>已统计消息</dt><dd>{coverage.total ?? semanticCoverage?.totalImported ?? "待确认"}</dd></div>
        <div><dt>已解读文字</dt><dd>{semanticCoverage ? `${semanticCoverage.analyzedText} / ${semanticCoverage.receivedText} 条` : "本次上传的可读文字"}</dd></div>
        {coverage.voiceCount > 0 && <div><dt>语音已有转写</dt><dd>{coverage.voiceTranscribed || 0} / {coverage.voiceCount} 条</dd></div>}
      </dl>
      {coverage.startDate && <p>{coverage.startDate} — {coverage.endDate || "结束日期待确认"}</p>}
      {semanticCoverage?.limitation && <p className={styles.alternative}>{semanticCoverage.limitation}</p>}
    </section>}
  </section>;
}
