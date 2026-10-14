"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Camera, CheckCheck, Eye, HeartHandshake, Lightbulb, MessageCircle, Quote, ScanLine, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { api, ErrorNotice, InlinePerson, followup, message, type Json } from "./client";
import { socialArchiveMaterial, validScore } from "./report-data";
import { momentsFit } from "@/lib/moments-fit";
import { SocialContentPanel, SocialNextAdvice } from "./SocialReadingPanels";
import { ReportReader, type ReadingSection } from "./ReportReader";
import { ReportActions } from "./ReportActions";
import { RiskReview } from "./RiskReview";
import { CaptureEvidence, CaptureEvidenceProvider } from "./CaptureEvidence";
import { relationshipRiskReview } from "@/lib/relationship-risk";
import reportStyles from "./ReportCard.module.css";
import styles from "./SocialReport.module.css";
import { PersonalConnection } from "./PersonalConnection";
import { ReportReplyPreview } from "./ReportBrief";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const rows = (value: unknown): Json[] => Array.isArray(value) ? value.filter(row => row && typeof row === "object" && !Array.isArray(row)) : [];
const distinct = (items: Json[]) => items.filter((row, index, all) => all.findIndex(other => (other.title || other.dimension || other.item) === (row.title || row.dimension || row.item) && (other.possibility || other.reading || other.meaning) === (row.possibility || row.reading || row.meaning)) === index);

function Evidence({ value }: { value: unknown }) {
  return text(value) ? <><p className={styles.evidence}><Quote size={16}/><span>依据：{text(value)}</span></p><CaptureEvidence quote={value}/></> : null;
}

function Findings({ items }: { items: Json[] }) {
  return <div className={styles.findings}>{items.map((row, index) => <article key={index}><h3>{row.title || row.dimension || row.item || row.category}{row.level && <span className={styles.badge}>{row.level}</span>}</h3><p>{row.meaning || row.reading || row.conclusion || row.valueHint || row.style}</p><Evidence value={row.evidence}/>{row.check && <p className={styles.action}><ArrowRight size={16}/>{row.check}</p>}</article>)}</div>;
}

function InferenceCards({ report }: { report: Json }) {
  const source = report.moments || report;
  const hypotheses = distinct([...rows(source.hypotheses), ...rows(report.moments ? report.hypotheses : [])]).filter(row => text(row.evidence) && text(row.possibility));
  const additional = distinct([...rows(source.behaviorClues), ...rows(source.statistics?.summaries)]).filter(row => text(row.reading) && text(row.evidence) && !hypotheses.some(other => other.possibility === row.reading));
  const items: Json[] = [...hypotheses, ...additional.map(row => ({ ...row, title: row.title || row.dimension, possibility: row.reading }))].slice(0, 6);
  if (!items.length) return <section className={styles.panel}><h2><Lightbulb size={22}/>从材料看相处线索</h2><Findings items={distinct([...rows(report.positives), ...rows(source.themes)]).filter(row => row.evidence && (row.meaning || row.reading))}/>{!report.positives?.length && !source.themes?.length && <p>这份旧报告只保存了总体判断。新增分析会同时保留每条推论、依据和相处建议。</p>}</section>;
  return <section className={styles.panel}><header className={styles.heading}><div><h2><Lightbulb size={22}/>更值得留意的相处线索</h2><p>每条推测都带上理由，以及你可以怎么做。</p></div><span className={styles.badge}>{items.length} 条推测</span></header><div className={styles.inferenceGrid}>{items.map((row, index) => <article className={styles.inference} key={index}><header><span className={styles.number}>{String(index + 1).padStart(2, "0")}</span><h3>{row.title}</h3></header><p className={styles.interpretation}>{row.possibility}</p><Evidence value={row.evidence}/>{row.alternative && <p className={styles.alternative}><Eye size={16}/><span><strong>也可能：</strong>{row.alternative}</span></p>}{row.verify && <p className={styles.action}><ArrowRight size={17}/><span><strong>相处时留意：</strong>{row.verify}</span></p>}</article>)}</div></section>;
}

function SocialFit({ report }: { report: Json }) {
  const fit = report.moments && report.fitMethod !== "moments-visible-1" ? momentsFit({}, report.moments) : report;
  const basics = [...rows(report.profileBasics), ...rows(report.profileContext)];
  const meaningful = (value: unknown) => !!text(value) && !/^(?:待了解|未知|未提供|缺少|尚无|暂未|暂无|资料不足|无法判断|双方资料不|没有足够)/.test(text(value));
  const items = rows(fit.fit).flatMap(row => {
    const hasScore = validScore(row.score) || validScore(row.value);
    const field = /婚恋|关系目标|关系期待/.test(row.dimension) ? "relationshipStatus" : /距离|城市|常住/.test(row.dimension) ? "city" : "";
    const basis = !report.moments && field ? basics.find(item => item.field === field && text(item.value)) : null;
    if (basis && !hasScore && (!meaningful(row.reading) || /待了解|不足|未知/.test(row.status || ""))) {
      return [{ ...row, status: "资料已明确", score: null, value: null, reading: basis.value, evidence: basis.evidence,
        conclusion: field === "relationshipStatus" ? "对方已经明确表达了关系现状或目标，可以直接围绕双方期待交流；是否与你合拍，要继续看实际互动。" : report.knownContext?.sameCity ? "你已确认双方同城，接下来对照方便见面的区域、作息与时间。" : "已知对方常住地；结合你自己的城市与作息安排见面，不从一方所在地推定双方距离。" }];
    }
    if (!hasScore && !meaningful(row.evidence) && !meaningful(row.reading)) return [];
    return [row];
  });
  const known = basics.filter(row => ["relationshipStatus", "city", "values", "boundaries"].includes(row.field));
  if (!items.length && !known.length && !fit.commonPoints?.length) return null;
  return <section className={styles.panel}><header className={styles.heading}><div><h2><HeartHandshake size={22}/>{report.moments ? "从朋友圈看相处适配" : "你们怎么相处更合适"}</h2><p>{report.moments ? `${items.length} 项相处线索 · 先看对方的表达，再对照你的需要。` : fit.fitSummary || "对照看得见的偏好与实际相处需要。"}</p></div></header>{known.length > 0 && <div className={styles.knownContext}>{known.map((row, index) => <article key={index}><strong>{({ relationshipStatus: "已表达的婚恋目标", city: "资料里的常住地", values: "看重什么", boundaries: "边界偏好" } as Record<string, string>)[row.field]}</strong><p>{row.value}</p><Evidence value={row.evidence}/></article>)}</div>}
    {items.length > 0 && <div className={styles.fitTable} role="table" aria-label="相处适配线索"><div className={styles.fitTableHead} role="row"><span role="columnheader">相处维度</span><span role="columnheader">材料表达了什么</span><span role="columnheader">对你们意味着什么</span></div>{items.map((row, index) => { const value = validScore(row.score) ? row.score : validScore(row.value) ? row.value : null; return <div className={styles.fitRow} role="row" key={index}><div role="cell"><HeartHandshake size={19}/><strong>{row.dimension}</strong>{value !== null && <span className={styles.fitScore}>{value}<small>/100</small><span className={styles.fitTrack}><i style={{ width: `${value}%` }}/></span></span>}</div><div role="cell">{row.reading || row.evidence || row.conclusion}<Evidence value={row.reading ? row.evidence : ""}/></div><div role="cell">{row.selfNeed && <p><strong>你的需要：</strong>{row.selfNeed}</p>}<p>{row.conclusion && row.conclusion !== row.reading ? row.conclusion : row.meaning || row.suggestion || (row.selfNeed ? "结合双方在这一点的表达，观察实际相处是否一致。" : "先作为了解对方的切入点；补充你的偏好后再做双方对照。")}</p></div></div>; })}</div>}
    {fit.commonPoints?.length > 0 && <Findings items={fit.commonPoints}/>}
  </section>;
}

function PhotoInterpretations({ clues }: { clues: Json[] }) {
  if (!clues.length) return null;
  return <section className={styles.panel}><header className={styles.heading}><div><h2><Camera size={22}/>照片透露的生活线索</h2><p>结合场景与配文，读出可聊的话题和可能的相处偏好。</p></div></header><div className={styles.photoGrid}>{clues.map((row, index) => <article className={styles.photo} key={index}><h3><Camera size={18}/>{row.item || `照片线索 ${index + 1}`}</h3>{row.category && <span className={styles.badge}>{row.category}</span>}<div><span className={styles.fieldLabel}>看见的内容</span><p>{row.style || row.observation || row.evidence}</p></div><Evidence value={row.style || row.observation ? row.evidence : ""}/>{(row.inference || row.valueHint) && <div className={styles.photoMeaning}><span className={styles.fieldLabel}><Lightbulb size={16}/>可能说明</span><p>{row.inference || row.valueHint}</p></div>}{row.alternative && <p className={styles.alternative}><Eye size={16}/><span>也可能：{row.alternative}</span></p>}{row.verify && <p className={styles.action}><MessageCircle size={17}/><span>{row.verify}</span></p>}</article>)}</div></section>;
}

export function SocialReport({ report, account, subjectId, targetSelf, onSubjectChange, publicExample = false, avatarSources }: { report: Json; account: Json | null; subjectId: string; targetSelf: boolean; onSubjectChange?: (id: string) => void; publicExample?: boolean; avatarSources?: File[] }) {
  const [consent, setConsent] = useState(false), [archiveTogether, setArchiveTogether] = useState(false), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState(""), [archiveSubject, setArchiveSubject] = useState(subjectId), [createdHere, setCreatedHere] = useState(false);
  const source = report.moments || report;
  const riskEvidence = new Set(relationshipRiskReview(report).signals.map(signal => signal.evidence.trim()));
  const leadEvidence = rows(source.hypotheses).find(row => text(row.evidence))?.evidence || rows(report.visibleFacts).find(row => text(row.evidence))?.evidence;
  const firstStarter = rows(source.starters).find(row => text(row.message));
  const nextAction = source.approach?.attitude || report.approach?.attitude || rows(source.hypotheses).find(row => text(row.verify))?.verify || firstStarter?.reason;
  const cautions = rows(report.cautions).filter(row => !riskEvidence.has(text(row.evidence)));
  const photoClues = [...rows(report.photoClues), ...rows(source === report ? [] : source.photoClues)].filter((row, index, all) => all.findIndex(other => other.item === row.item && other.evidence === row.evidence) === index);
  const sections: ReadingSection[] = [
    { id: "overview", label: "人物判断", caption: "先看判断，再读具体的相处启发", tone: "coral" },
    { id: "content", label: report.moments ? "内容图表" : "主页画像", caption: "看构成、变化，以及它们可能说明什么", tone: "amber" },
    { id: "evidence", label: "相处适配", caption: "结合生活线索、照片和你的需要", tone: "teal" },
    { id: "next", label: "下一步", caption: "带着一个自然的话题开始了解", tone: "slate" },
  ];
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setArchiveSubject(subjectId); }, [subjectId]);
  async function save(nextSubject = archiveSubject) {
    if (publicExample || busy || saved || (!targetSelf && !nextSubject)) return;
    setBusy(true); setError("");
    try {
      const material = socialArchiveMaterial(report, targetSelf);
      if (!material.candidates.length && !material.basics.length) throw new Error("这组截图没有可保存的文字线索，请补充清晰的个人资料页。");
      const state = await api("/api/web/profile");
      if (!state.enabled || state.paused) await api("/api/web/profile", { action: "consent", enabled: true });
      await api("/api/web/profile", { action: "import-social", confirmed: true, target: targetSelf ? "self" : "subject", subjectId: targetSelf ? null : nextSubject, ...material, communicationReading: report.moments ? null : { summary: report.summary, hypotheses: report.hypotheses, approach: report.approach }, momentsReport: report.moments || null });
      if (mounted.current) { setSaved(true); setConsent(false); }
    } catch (e) { if (mounted.current) setError(message(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <CaptureEvidenceProvider ownerId={publicExample?undefined:account?.account?.userId} reportId={report.reportId||report.id} captureOrigin={report.captureOrigin===true}><div className={`${reportStyles.document} ${styles.report}`}><ReportReader key={report.reportId || report.id || (report.moments ? "moments" : "social")} storageKey={!publicExample && account?.account?.userId && (report.reportId || report.id) ? `${account.account.userId}:${report.reportId || report.id}:social` : undefined} items={sections}>{active => <>
    {active === "overview" && <><section className={`${styles.panel} ${styles.summary}`}><span className={styles.eyebrow}><UserRound size={18}/>{targetSelf ? "我的资料印象" : report.moments ? "朋友圈人物分析" : "社交主页分析"}</span><h2><Sparkles size={22}/>先看这一点</h2><p className={styles.verdict}>{source.summary || report.summary}</p><CaptureEvidence label="查看本次判断的原始材料"/>{(leadEvidence || nextAction) && <div className={styles.summarySteps}>{leadEvidence && <article><h3><Quote size={18}/>关键依据</h3><p>{leadEvidence}</p><CaptureEvidence quote={leadEvidence}/></article>}{nextAction && <article><h3><ArrowRight size={18}/>下一步</h3><p>{nextAction}</p></article>}</div>}<div className={styles.summaryMeta}>{source.posts?.length > 0 && <span><ScanLine size={16}/>{source.posts.length} 条动态</span>}{photoClues.length > 0 && <span><Camera size={16}/>{photoClues.length} 处照片线索</span>}<span><Lightbulb size={16}/>推测与依据分别呈现</span></div>{report.coverage && <p className={styles.muted}>{report.coverage}</p>}</section>{!targetSelf && <><RiskReview report={report}/><ReportReplyPreview text={firstStarter?.message || report.questions?.[0]} reason={firstStarter?.reason} label="可以这样自然开场"/></>}<PersonalConnection report={{...report,targetSelf}} publicExample={publicExample}/><InferenceCards report={report}/>{cautions.length > 0 && <section className={styles.panel}><h2><ShieldCheck size={22}/>相处中值得留意</h2><Findings items={cautions}/></section>}</>}
    {active === "content" && <SocialContentPanel report={report}/>}
    {active === "evidence" && <><SocialFit report={report}/><PhotoInterpretations clues={photoClues}/>{report.visibleFacts?.length > 0 && <section className={styles.panel}><h2><ScanLine size={22}/>判断用到的材料</h2><Findings items={report.visibleFacts}/></section>}{report.moments && source.visibility?.evidence && !/未提供|未知|没有.*信息|未明确/.test(source.visibility.evidence) && <section className={styles.panel}><h2><Eye size={22}/>可见范围 · {source.visibility.label}</h2><p>{source.visibility.reading}</p><Evidence value={source.visibility.evidence}/></section>}{report.knowledgeSources?.length > 0 && <section className={styles.panel}><h2><BookOpen size={22}/>本次参考的方法</h2><div className={styles.sources}>{report.knowledgeSources.map((row: Json, index: number) => <span className={styles.badge} key={index}><BookOpen size={16}/>{row.label}</span>)}</div></section>}</>}
    {active === "next" && <><SocialNextAdvice report={report}/>{(report.questions?.length > 0 || report.unknowns?.length > 0) && <section className={styles.panel}><h2><CheckCheck size={22}/>在相处中核实</h2><ul className={styles.questions}>{[...new Set([...report.questions || [], ...report.unknowns || []])].map((item, index) => <li key={index}>{String(item)}</li>)}</ul></section>}
      {!publicExample && report.kind === "profile" && <section className={styles.panel}><h2><UserRound size={22}/>{targetSelf ? "保存到我的档案" : "把线索放进人物档案"}</h2><p className={styles.muted}>资料先进入待核对区，已有手填资料不覆盖。原图不长期保存。</p>{!targetSelf && !archiveSubject && <label className="wa-check"><input type="checkbox" checked={archiveTogether} disabled={busy} onChange={event => setArchiveTogether(event.target.checked)}/>建档后同时把本组可见线索与分析归档，之后可核对或删除。</label>}{!targetSelf && (!archiveSubject || createdHere) && <InlinePerson disabled={busy} avatarSources={avatarSources} avatarCandidates={report.avatarCandidates || []} onCreated={async id => { setCreatedHere(true); setArchiveSubject(id); onSubjectChange?.(id); if (archiveTogether) await save(id); }}/>} {(targetSelf || archiveSubject) && <><label className="wa-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy || saved}/>我确认这些资料属于{targetSelf ? "我" : "所选人物"}，同意启用或恢复档案并保存本次线索、分析摘要，之后可核对或删除。</label><button disabled={!consent || busy || saved} onClick={() => void save()}>{saved ? "已保存到档案" : busy ? "保存中…" : "确认归档"}</button></>}{(saved || archiveSubject || targetSelf) && <div className="wa-actions"><a className="wa-button" href={targetSelf ? "/archive?tab=self" : `/archive?subjectId=${archiveSubject}`}>{saved ? "去核对线索" : "查看档案"}</a></div>}</section>}
      {!publicExample && <div className="wa-actions"><button disabled={!account?.account?.userId} onClick={() => { try { followup({ ...report, subjectId: targetSelf ? "" : archiveSubject }, account!.account.userId, report.moments ? "朋友圈分析" : "社交资料分析"); } catch (e) { setError(message(e)); } }}><MessageCircle size={17}/>带着报告问军师</button></div>}<ErrorNotice error={error}/></>}
  </>}</ReportReader><ReportActions report={{...report,targetSelf}} kind="social" publicExample={publicExample}/></div></CaptureEvidenceProvider>;
}
