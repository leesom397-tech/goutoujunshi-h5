import { CheckCircle2, CircleHelp, History, Quote, Sparkles } from "lucide-react";
import { CaptureEvidence } from "./CaptureEvidence";
import { reportPersonLabel } from "@/components/report-person-label";
import styles from "./RelationshipDiagnosisPanel.module.css";

type Json = Record<string, any>;
const rows = (value: unknown): Json[] => Array.isArray(value) ? value.filter(item => item && typeof item === "object") : [];
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const normalized = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, "");
const uniqueText = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];

/** Supporting reading only. The report overview owns the judgment and next step. */
export function RelationshipDiagnosisPanel({ diagnosis, semanticHistory: standalone, folded = false }: { diagnosis?: Json | null; semanticHistory?: Json | null; folded?: boolean }) {
  const semantic = standalone || diagnosis?.semanticHistory;
  if (!diagnosis && !semantic) return null;
  const coverage = diagnosis?.coverage || {}, semanticCoverage = semantic?.coverage;
  const facts = rows(diagnosis?.facts).filter(row => row.id !== "activity:coverage");
  const findings = rows(semantic?.findings).filter((row, index, all) => all.findIndex(other => normalized(text(other.claim)) === normalized(text(row.claim))) === index);
  const counterIds = new Set(uniqueText(semantic?.counterEvidenceIds));
  const hypotheses = rows(diagnosis?.hypotheses);
  const unknowns = [...new Set([...uniqueText(semantic?.unknowns), ...uniqueText(diagnosis?.unknowns)])];
  const alternatives = uniqueText(semantic?.alternatives);
  const explanation = text(semantic?.explanation);
  return <section className={styles.reading} aria-label="判断依据与其他解释" data-folded={folded}>
    {explanation && normalized(explanation) !== normalized(text(semantic?.summary)) && <section className={styles.readingBlock}>
      <h3><Sparkles size={18}/>为什么这样判断{semantic?.confidence && <small>把握度：{semantic.confidence}</small>}</h3>
      {explanation.split(/\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    </section>}
    {findings.length > 0 && <section className={styles.readingBlock}><h3><Quote size={18}/>支持与相反线索</h3><div className={styles.findings}>
      {findings.map((finding, index) => <article key={finding.id || index}>
        <header><strong>{finding.claim}</strong><small>{counterIds.has(finding.id) ? "相反证据" : "材料线索"}{finding.confidence ? ` · 把握度 ${finding.confidence}` : ""}</small></header>
        {rows(finding.evidence).map((item, evidenceIndex) => <div className={styles.findingEvidence} key={`${item.sourceId}-${evidenceIndex}`}><blockquote>{item.quote}</blockquote><small>{reportPersonLabel(item.senderRole)}{item.at ? ` · ${item.at}` : ""}</small><CaptureEvidence quote={item.quote} sourceIds={item.sourceId ? [item.sourceId] : undefined}/></div>)}
        {finding.alternative && <p className={styles.alternative}><strong>也可能：</strong>{finding.alternative}</p>}
      </article>)}
    </div></section>}
    {!findings.length && hypotheses.length > 0 && <section className={styles.readingBlock}><h3><Sparkles size={18}/>从行为看到的线索</h3><div className={styles.findings}>{hypotheses.map((item, index) => <article key={item.id || index}><header><strong>{item.claim}</strong><small>把握度 {item.confidence || "低"}</small></header>{uniqueText(item.alternatives).map(value => <p className={styles.alternative} key={value}>其他解释：{value}</p>)}{item.whatToObserve && <p>接着观察：{item.whatToObserve}</p>}</article>)}</div></section>}
    {alternatives.length > 0 && <section className={styles.readingBlock}><h3><CircleHelp size={18}/>还存在这些解释</h3><ul>{alternatives.map(value => <li key={value}>{value}</li>)}</ul></section>}
    {facts.length > 0 && <section className={styles.readingBlock}><h3><CheckCircle2 size={18}/>可核对的行为事实</h3><div className={styles.factList}>{facts.map((fact, index) => <article key={fact.id || index}><strong>{fact.claim}</strong>{fact.metric && <small>{fact.metric}</small>}</article>)}</div></section>}
    {unknowns.length > 0 && <section className={styles.readingBlock}><h3><CircleHelp size={18}/>目前还不知道什么</h3><ul>{unknowns.map(value => <li key={value}>{value}</li>)}</ul></section>}
    <section className={styles.readingBlock}><h3><History size={18}/>这份报告看了哪些材料</h3>
      <dl className={styles.readingCoverage}>
        <div><dt>已统计消息</dt><dd>{coverage.total ?? semanticCoverage?.totalImported ?? "待确认"}</dd></div>
        <div><dt>已解读文字</dt><dd>{semanticCoverage ? `${semanticCoverage.analyzedText} / ${semanticCoverage.receivedText} 条` : "本次上传的可读文字"}</dd></div>
        {coverage.voiceCount > 0 && <div><dt>语音已有转写</dt><dd>{coverage.voiceTranscribed || 0} / {coverage.voiceCount} 条</dd></div>}
      </dl>
      {coverage.startDate && <p>{coverage.startDate} — {coverage.endDate || "结束日期待确认"}</p>}
      {semanticCoverage?.limitation && <p className={styles.alternative}>{semanticCoverage.limitation}</p>}
    </section>
  </section>;
}
