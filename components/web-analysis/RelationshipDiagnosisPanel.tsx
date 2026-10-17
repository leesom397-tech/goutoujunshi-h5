import { Activity, ArrowRight, CheckCircle2, CircleHelp, Gauge, History, ShieldAlert, Sparkles } from "lucide-react";
import { CaptureEvidence } from "./CaptureEvidence";
import styles from "./RelationshipDiagnosisPanel.module.css";

type Json = Record<string, any>;
type SemanticEvidence = { sourceId: string; at: string; senderRole: "self" | "other"; quote: string };
type SemanticFinding = { id: string; claim: string; confidence: "高" | "中" | "低"; alternative: string; evidence: SemanticEvidence[] };
type SemanticHistory = {
  status: "complete" | "no_text" | "unavailable";
  coverage: { totalImported: number | null; receivedText: number; analyzedText: number; missingFromText: number | null; chunkCount: number; selectedLineCount: number; limitation: string };
  summary: string;
  summaryEvidenceIds: string[];
  trend: "升温" | "降温" | "相对稳定" | "待了解";
  reciprocity: string;
  action: string;
  actionEvidenceIds: string[];
  findings: SemanticFinding[];
};

export function RelationshipDiagnosisPanel({ diagnosis, semanticHistory: standaloneSemanticHistory, folded = false }: { diagnosis?: Json | null; semanticHistory?: Json | null; folded?: boolean }) {
  if (standaloneSemanticHistory && !diagnosis?.semanticHistory) diagnosis = { ...diagnosis, semanticHistory: standaloneSemanticHistory };
  if (!diagnosis) return null;
  const coverage = diagnosis.coverage || {}, relationship = diagnosis.relationship || {}, decision = diagnosis.decision || {};
  const facts: Json[] = Array.isArray(diagnosis.facts) ? diagnosis.facts : [];
  const hypotheses: Json[] = Array.isArray(diagnosis.hypotheses) ? diagnosis.hypotheses : [];
  const claimActions: Json[] = Array.isArray(diagnosis.claimActions) ? diagnosis.claimActions : [];
  const personalConnection = diagnosis.personalConnection || {};
  const commonPoints: Json[] = Array.isArray(personalConnection.commonPoints) ? personalConnection.commonPoints : [];
  const unknowns: string[] = Array.isArray(diagnosis.unknowns) ? diagnosis.unknowns : [];
  const options: Json[] = Array.isArray(decision.options) ? decision.options : [];
  const semanticHistory: SemanticHistory | null = diagnosis.semanticHistory && typeof diagnosis.semanticHistory === "object" && diagnosis.semanticHistory.coverage ? diagnosis.semanticHistory : null;
  const semanticCoverage = semanticHistory?.coverage;
  const semanticFindings = Array.isArray(semanticHistory?.findings) ? semanticHistory.findings : [];
  const hasActivity = typeof coverage.total === "number";
  const trend = relationship.trend || "待了解";
  return <section className={styles.panel} aria-label="关系诊断">
    {hasActivity && <><header className={styles.header}>
      <div><p className={styles.kicker}><Sparkles size={16}/>成子关系诊断 · {diagnosis.questionLabel || "这份材料的关系概况"}</p><h2>先看清现在，再决定投入多少。</h2><p className={styles.subhead}>根据已导入材料整理可核对的事实、带依据的推测和下一步选择。具体分析范围见下方。</p></div>
      <div className={styles.coverage}><strong>{coverage.total ?? "—"}</strong><span>条统计消息</span><small>{coverage.startDate && coverage.endDate ? `${coverage.startDate} — ${coverage.endDate}` : "日期待确认"}</small></div>
    </header>
    <div className={styles.summaryGrid}>
      <article className={styles.state}><span className={styles.label}><Activity size={16}/>当前关系状态</span><strong>{relationship.currentState || "待了解"}</strong><span className={`${styles.trend} ${styles[trend === "升温" ? "up" : trend === "降温" ? "down" : "steady"]}`}>{trend === "升温" ? "↑" : trend === "降温" ? "↓" : "·"} {trend}</span></article>
      <article><span className={styles.label}><Gauge size={16}/>互动互惠</span><p>{relationship.reciprocity || "材料不足，暂不判断。"}</p></article>
      <article><span className={styles.label}><ArrowRight size={16}/>首选下一步</span><strong>{decision.recommendation || "先补齐材料"}</strong><p>{decision.observeWindow || "观察后再更新判断。"}</p></article>
    </div></>}
    {semanticHistory && semanticCoverage && <details open={!folded}><summary>展开历史文字依据</summary><section className={styles.semanticHistory} aria-label="历史文字整体分析">
      <div className={styles.semanticHeading}><h3><History size={19}/>历史文字整体分析</h3><span>{semanticHistory.status === "complete" ? "已分析收到的可读文字" : semanticHistory.status === "unavailable" ? "整体分析暂未完成" : "缺少可读历史文字"}</span></div>
      <dl className={styles.semanticCoverage}>
        <div><dt>收到统计元数据</dt><dd>{semanticCoverage.totalImported === null ? "未知" : `${semanticCoverage.totalImported} 条`}</dd></div>
        <div><dt>收到可读文字</dt><dd>{semanticCoverage.receivedText} 条</dd></div>
        <div><dt>完成语义分析</dt><dd>{semanticCoverage.analyzedText} 条</dd></div>
        <div><dt>未提供可读文字或范围差额</dt><dd>{semanticCoverage.missingFromText === null ? "未知" : `${semanticCoverage.missingFromText} 条`}</dd></div>
        <div><dt>本轮逐句解读</dt><dd>{semanticCoverage.selectedLineCount} 条</dd></div>
      </dl>
      <p className={styles.semanticLimit}>{semanticCoverage.chunkCount > 0 ? `可读文字分 ${semanticCoverage.chunkCount} 批处理。` : ""}{semanticCoverage.limitation}</p>
      {semanticHistory.summary && <p className={styles.semanticSummary}>{semanticHistory.summary}</p>}
      {semanticHistory.status === "complete" && <div className={styles.semanticOverview}>
        {semanticHistory.trend && <p><strong>走势：</strong>{semanticHistory.trend}</p>}
        {semanticHistory.reciprocity && <p><strong>互动：</strong>{semanticHistory.reciprocity}</p>}
        {semanticHistory.action && <p><strong>下一步：</strong>{semanticHistory.action}</p>}
      </div>}
      {semanticFindings.length > 0 && <div className={styles.semanticFindings}><h4>从历史文字中看到的线索</h4>{semanticFindings.map((finding, index) => <article key={finding.id || index}>
        <div className={styles.semanticFindingTitle}><strong>{finding.claim}</strong><span>把握度：{finding.confidence}</span></div>
        {Array.isArray(finding.evidence) && finding.evidence.length > 0 && <ul>{finding.evidence.map((item, evidenceIndex) => <li key={`${item.sourceId}-${evidenceIndex}`}><blockquote>“{item.quote}”</blockquote><small>{item.senderRole === "self" ? "我" : "TA"} · {item.at || "时间待确认"} · 来源 ID：<code>{item.sourceId}</code></small><CaptureEvidence quote={item.quote} sourceIds={[item.sourceId]} label="回看这条历史原文"/></li>)}</ul>}
        {finding.alternative && <p className={styles.semanticAlternative}>其他可能的解释：{finding.alternative}</p>}
      </article>)}</div>}
    </section></details>}
    {hasActivity && <details open={!folded}><summary>展开事实、说法与行动、其他解释和还不知道什么</summary><div className={styles.bodyGrid}>
      <div className={styles.column}>
        <section className={styles.block}><h3><CheckCircle2 size={18}/>客观事实</h3><div className={styles.factList}>{facts.map((fact, index) => <article key={fact.id || index}><strong>{fact.claim}</strong>{fact.value && <span>{fact.value}</span>}{fact.metric && <small>{fact.metric}</small>}</article>)}</div></section>
        <section className={styles.block}><h3><Sparkles size={18}/>可能的关系线索</h3>{hypotheses.length ? hypotheses.map((item, index) => <article className={styles.hypothesis} key={item.id || index}><strong>{item.claim}</strong><span className={styles.confidence}>把握度：{item.confidence || "低"}</span>{item.alternatives?.length ? <p>其他解释：{item.alternatives.join("；")}</p> : null}<small>接下来观察：{item.whatToObserve || "结合下一轮真实互动核对。"}</small></article>) : <p className={styles.empty}>当前材料还不足以提出稳定推测，先看事实。</p>}</section>
        {claimActions.length ? <section className={styles.block}><h3><ArrowRight size={18}/>说法与行动对照</h3><p className={styles.blockIntro}>把同一个人的表达和后续行为放在一起看；没有后续原话就保留为待核对。</p><div className={styles.claimList}>{claimActions.map((item, index) => <article className={styles.claim} key={item.id || index}><div className={styles.claimHeader}><strong>{item.claim || "一条表达"}</strong><span className={item.status === "已有后续线索" ? styles.claimDone : styles.claimPending}>{item.status || "待核对"}</span></div><p>{item.action || "待核对"}</p><small>说法：{item.claimEvidence}</small>{item.actionEvidence && <small>行动线索：{item.actionEvidence}</small>}<small>{item.note}</small></article>)}</div></section> : null}
      </div>
      <aside className={styles.column}>
        {relationship.risks?.length ? <section className={`${styles.block} ${styles.risk}`}><h3><ShieldAlert size={18}/>需要留意</h3><ul>{relationship.risks.map((risk: string, index: number) => <li key={index}>{risk}</li>)}</ul></section> : null}
        <section className={styles.block}><h3><ArrowRight size={18}/>可选行动</h3><div className={styles.optionList}>{options.slice(0, 4).map((option, index) => <details key={option.label || index}><summary><span>{option.label}</span></summary><p>{option.action}</p><small>观察：{option.observeWindow}</small><small>停止条件：{option.stopCondition}</small></details>)}</div><p className={styles.stop}><CircleHelp size={15}/> {decision.stopCondition || "当事实发生变化时，再更新这份判断。"}</p></section>
        <section className={styles.block}><h3><History size={18}/>还不知道什么</h3>{unknowns.length ? <ul className={styles.unknowns}>{unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className={styles.empty}>目前没有额外缺口。</p>}</section>
        {commonPoints.length ? <section className={styles.block}><h3><CheckCircle2 size={18}/>你们的共同点</h3><p className={styles.blockIntro}>{personalConnection.fit || "只展示双方都有原话或资料依据的交集。"}</p><div className={styles.commonList}>{commonPoints.slice(0, 4).map((item, index) => <article key={item.id || index}><strong>{typeof item === "string" ? item : item.title || item.label || "共同点"}</strong>{typeof item !== "string" && (item.reading || item.meaning) && <p>{item.reading || item.meaning}</p>}</article>)}</div></section> : null}
      </aside>
    </div>
    <footer className={styles.footer}>统计来源：已导入聊天 · 语音 {coverage.voiceTranscribed ?? 0} / {coverage.voiceCount ?? 0} 条已有文字 · {coverage.identityNote || "身份信息待确认"}。新增聊天后会生成前后变化。</footer></details>}
  </section>;
}
