"use client";
import {isStickerPhotoClue} from "@/lib/screenshot-photo";
import { useEffect, useState } from "react";
import { ChartNoAxesCombined, Images, BookOpen, UserRound, ArrowUpRight, MessageCircle, HeartHandshake, Heart, CalendarCheck, CircleHelp, History, ShieldAlert, Quote, ArrowRight } from "lucide-react";
import { api, type Json } from "./client";
import { historicalTrend, interactionMetrics, profileLabels, reportAffinity, validScore, visibleSignalProfile } from "./report-data";
import styles from "./ReportEvidence.module.css";

export function AffinityRadar({ dimensions }: { dimensions: Json[] }) {
  const icons = [ArrowUpRight, MessageCircle, HeartHandshake, UserRound, Heart, CalendarCheck];
  const items: Json[] = dimensions.slice(0, 6).map(row => ({ ...row, value: row.status !== "insufficient" && validScore(row.value) ? Math.round(row.value) : null }));
  const known = items.filter(row => row.value !== null).length;
  const xy = (index: number, radius: number) => [210 + Math.cos(-Math.PI / 2 + index * Math.PI / 3) * radius, 154 + Math.sin(-Math.PI / 2 + index * Math.PI / 3) * radius];
  return <div className={styles.dimensions}>
    <div className={styles.plot}>
      <div className={styles.plotHeading}><ChartNoAxesCombined size={17}/><span>本轮六维信号</span><small>已知 {known} / 6</small></div>
      {known ? <svg viewBox="0 0 420 326" role="img" aria-label={items.map(row => `${row.label}：${row.value === null ? "待了解" : `${row.value}/100 参考指数`}`).join("；")}>
        {[25, 50, 75, 100].map(level => <polygon key={level} className={styles.grid} points={Array.from({ length: 6 }, (_, index) => xy(index, level).join(",")).join(" ")}/>)}
        {items.map((_, index) => { const edge = xy(index, 100); return <line key={index} className={styles.axis} x1="210" y1="154" x2={edge[0]} y2={edge[1]}/>; })}
        {known === 6 && <polygon className={styles.area} points={items.map((row, index) => xy(index, row.value!).join(",")).join(" ")}/>}
        {items.map((row, index) => { const label = xy(index, 128), point = row.value === null ? null : xy(index, row.value); return <g key={row.key || index}>
          {point && <>{known < 6 && <line className={styles.signalRay} x1="210" y1="154" x2={point[0]} y2={point[1]}/>}<circle className={styles.point} cx={point[0]} cy={point[1]} r="4.5"/></>}
          <text className={styles.axisLabel} x={label[0]} y={label[1] - 5} textAnchor="middle">{row.label}</text><text className={styles.axisValue} data-unknown={row.value === null} x={label[0]} y={label[1] + 15} textAnchor="middle">{row.value === null ? "待了解" : row.value}</text>
        </g>; })}
      </svg> : <div className={styles.empty}><CircleHelp size={30}/><strong>这段材料还不足以给出六维指数</strong><p>已识别原话仍可在「逐句语气」中查看。</p></div>}
      <p className={styles.chartNote}>数值为互动参考指数，非喜欢你的概率。未知项留空。</p>
    </div>
    <div className={styles.dimensionList}>{items.map((row, index) => { const Icon = icons[index] || ChartNoAxesCombined; return <div className={styles.dimension} key={row.key || index}>
      <span className={styles.dimensionIcon}><Icon size={20} aria-hidden="true"/></span><div className={styles.dimensionBody}><div><strong>{row.label}</strong><span className={styles.value} data-unknown={row.value === null}>{row.value === null ? "待了解" : <>{row.value}<small>/100</small></>}</span></div><div className={styles.track} data-unknown={row.value === null} aria-hidden="true"><i style={{ width: `${row.value || 0}%` }}/></div><small>{row.value === null ? "本段缺少可判断的场景" : row.status === "ambiguous" ? "有线索，仍有其他解释" : "有可见互动依据"}</small></div>
    </div>; })}</div>
  </div>;
}

export function InteractionEvidence({ report, owner }: { report: Json; owner?: string }) {
  const affinity = reportAffinity(report), dimensions: Json[] = Array.isArray(affinity?.dimensions) ? affinity.dimensions.filter((row: Json) => row && typeof row.label === "string").slice(0, 6) : [], score = validScore(affinity?.value) ? Math.round(affinity.value) : null, metrics = interactionMetrics(report.lines);
  const visibleProfile = visibleSignalProfile(report.lines || []);
  const maximumMatches = Math.max(1, ...visibleProfile.map(row => row.count));
  const knownDimensions = dimensions.filter(row => row.status !== "insufficient" && validScore(row.value)).length;
  const visibleCount = visibleProfile.filter(row => row.count > 0).length;
  const brief = (value: unknown, max = 110) => {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    const sentence = text.match(/^.*?[。！？]/)?.[0] || text;
    return sentence.length > max ? sentence.slice(0, max) + "…" : sentence;
  };
  const judgment = brief(report.decision?.judgment);
  const evidence = typeof report.decision?.evidence === "string" ? report.decision.evidence.trim() : "";
  const nextStep = brief(report.decision?.nextStep, 150);
  const scoreScope = affinity?.valueScope === "full" ? "六维完整参考" : affinity?.valueScope === "partial" ? "已知维度参考" : "本轮参考";
  const insufficientReason = knownDimensions ? "单项已有数据；当前材料不足以合成总分。" : metrics.otherTurnCount ? "暂未生成模型指数，以下展示原话中可数的线索。" : "缺少可读的对方原话，暂不计分。";
  const [memory, setMemory] = useState<Json | null>(null);
  const [trend, setTrend] = useState({ title: "待对照历史", note: "本次未关联人物，暂不对照历史。" }), [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setTrend({ title: "待对照历史", note: "本次未关联人物，暂不对照历史。" }); setMemory(null); setLoading(false);
    if (!owner || !report.subjectId || !report.id) return () => controller.abort();
    setLoading(true);
    void api("/api/web/profile", undefined, controller.signal).then(profile => {
      if (controller.signal.aborted) return;
      if (!profile.enabled || profile.paused || !(profile.subjects || []).some((person: Json) => person.id === report.subjectId)) { setTrend({ title: "待对照历史", note: "当前人物档案未启用，暂不读取长期趋势。" }); return; }
      setTrend(historicalTrend((profile.trends || []).find((item: Json) => item.subjectId === report.subjectId)?.points, report.subjectId, report.id));
      setMemory((profile.signalHistory || []).filter((item: Json) => item.subjectId === report.subjectId && item.reportId !== report.id && Array.isArray(item.dimensions)).at(-1) || null);
    }).catch(() => { if (!controller.signal.aborted) setTrend({ title: "历史暂未取回", note: "本次分析仍可查看，稍后可到人物档案查看长期趋势。" }); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [owner, report.id, report.subjectId]);
  const signalIcons = [ArrowUpRight, MessageCircle, HeartHandshake, UserRound, Heart, CalendarCheck];
  return <section className={`wa-card ${styles.section}`} id="signals">
    <h2><HeartHandshake size={23}/>好感信号</h2>
    <div className={styles.affinitySummary} data-scored={score !== null}>
      {score !== null ? <div className={styles.scoreRing} role="img" aria-label={`好感信号指数 ${score}/100，${scoreScope}；不是喜欢你的概率`}>
        <svg viewBox="0 0 180 180" aria-hidden="true"><circle className={styles.ringTrack} cx="90" cy="90" r="78"/><circle className={styles.ringValue} cx="90" cy="90" r="78" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - score} style={{ opacity: score === 0 ? 0 : 1 }}/></svg>
        <div className={styles.ringContent}><Heart size={18} aria-hidden="true"/><strong>{score}<small>/100</small></strong><span>好感信号指数</span></div>
      </div> : <div className={styles.scoreMissing}><CircleHelp size={24} aria-hidden="true"/><span>{knownDimensions ? "已有可判断的维度" : "本段可见线索"}</span><strong>{knownDimensions || visibleCount}<small>/6 项</small></strong><small>总指数待了解</small></div>}
      <div className={styles.signalContext}>
        <div className={styles.scopePills}><span>{score === null ? "暂不合成总分" : scoreScope}</span><span>有依据 {knownDimensions} / 6 维</span></div>
        {judgment && <h3>{judgment}</h3>}
        {score === null && <p className={styles.insufficient}>{insufficientReason}</p>}
        <p className={styles.scoreNote}>指数来自本轮可见互动，不是对方喜欢你的概率。缺失维度不当作 0 分。</p>
      </div>
    </div>
    {(affinity?.boundaryApplied || metrics.boundary) && <p className={styles.boundary}><ShieldAlert size={19}/>对方表达了明确边界，先停止推进。</p>}
    {(evidence || nextStep) && <div className={styles.signalBasis}>
      {evidence && <div><span><Quote size={17} aria-hidden="true"/>判断依据 · 原话</span><blockquote>{evidence}</blockquote></div>}
      {nextStep && <div><span><ArrowRight size={17} aria-hidden="true"/>接下来怎么做</span><p>{nextStep}</p></div>}
    </div>}
    {knownDimensions > 0 ? <AffinityRadar dimensions={dimensions}/> : <div className={styles.fallback}>
      <h3><ChartNoAxesCombined size={18}/>原话线索 · 按出现次数</h3>
      <div className={styles.countGrid}>{visibleProfile.map((row, index) => { const Icon = signalIcons[index]; return <div className={styles.countRow} key={row.key}><div><span><Icon size={19}/>{row.label}</span><strong>{metrics.otherTurnCount ? <>{row.count}<small>句</small></> : "待了解"}</strong></div><div className={styles.track} aria-hidden="true"><i style={{ width: `${row.count / maximumMatches * 100}%` }}/></div><p>{row.evidence[0] ? `“${row.evidence[0]}”` : "本段未见对应原话"}</p></div>; })}</div>
      <p className={styles.chartNote}>仅按可见原话统计；0 句表示本段未见，不是对方没有好感。</p>
    </div>}
    {owner && report.subjectId && <div className={styles.history}><History size={19}/><div><strong>{loading ? "正在对照之前的互动…" : trend.title}</strong><p>{trend.note}</p>{memory && <small>上次记录：{(memory.dimensions || []).filter((row: Json) => validScore(row.value)).length} 项有数据。历史记录与本次材料分别保留。</small>}</div></div>}
    {report.affinityError && !knownDimensions && <p className={styles.chartNote}>{report.affinityError}</p>}
  </section>;
}

export function ChatPhotoClues({ clues }: { clues?: Json[] }) {
  clues=clues?.filter(clue=>!isStickerPhotoClue(clue));
  if (!clues?.length) return null;
  return <section className="wa-card" id="photos"><h2><Images size={21}/>对话里的照片线索</h2>{clues.map((clue, index) => <div className="wa-insight" key={index}><strong>{clue.location || `照片 ${index + 1}`}</strong>{clue.speaker && <p className="wa-muted">{clue.speaker === "other" ? "对方发送的图片" : clue.speaker === "self" ? "我发送的图片" : "发送者待确认"} · 不代表发送者本人拍摄</p>}<p>看到了：{clue.observation}</p>{clue.inference && <p>可能说明：{clue.inference}</p>}{clue.alternative && <p>也可能：{clue.alternative}</p>}{clue.verify && <p>可以聊聊：{clue.verify}</p>}</div>)}</section>;
}

export function SocialMaterialEvidence({ report }: { report: Json }) {
  return <>{report.photoClues?.length > 0 && <section className="wa-card"><h2><Images size={21}/>照片里的可聊线索</h2>{report.photoClues.map((row: Json, index: number) => <div className="wa-insight" key={index}><span className="wa-pill">{row.category}</span><h3>{row.item}</h3>{row.style && <p>{row.style}</p>}<p className="wa-muted">依据：{row.evidence}</p>{row.valueHint && <p>{row.valueHint}</p>}</div>)}</section>}{(report.profileBasics?.length > 0 || report.profileContext?.length > 0) && <section className="wa-card"><h2><UserRound size={21}/>识别到的基础资料</h2><p className="wa-muted">资料自述与可见线索，归档后仍需你核对。</p><div className="wa-observable-grid">{[...(report.profileBasics || []), ...(report.profileContext || [])].map((row: Json, index: number) => <div key={`${row.field}-${index}`}><small>{profileLabels[row.field] || row.field}</small><strong>{row.value}</strong>{row.evidence && <span>{row.evidence}</span>}</div>)}</div></section>}{report.knowledgeSources?.length > 0 && <section className="wa-card"><h2><BookOpen size={21}/>本次参考的方法</h2><div className="wa-actions">{report.knowledgeSources.map((row: Json, index: number) => <span className="wa-pill" key={row.anchor || index}>{row.label}</span>)}</div><p className="wa-muted">结合本次资料选取的关系主题笔记。</p></section>}</>;
}
