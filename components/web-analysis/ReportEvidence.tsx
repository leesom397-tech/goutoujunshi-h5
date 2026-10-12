"use client";
import { useEffect, useState } from "react";
import { ChartNoAxesCombined, Images, BookOpen, UserRound } from "lucide-react";
import { api, type Json } from "./client";
import { ArchiveRadar } from "@/components/ArchiveCharts";
import { historicalTrend, interactionMetrics, profileLabels, validScore, visibleSignalProfile } from "./report-data";

export function AffinityRadar({ dimensions }: { dimensions: Json[] }) {
  return <ArchiveRadar
    labels={["主动表达", "回应承接", "回应扩展", "邀约兑现", "边界尊重", "互惠稳定"]}
    rows={dimensions.slice(0, 6).map(row => ({
      label: typeof row.label === "string" ? row.label : "",
      value: validScore(row.value) ? row.value : null,
      evidence: typeof row.evidence === "string" ? row.evidence : "",
      description: typeof row.description === "string" ? row.description : "",
    }))}
  />;
}

export function InteractionEvidence({ report, owner }: { report: Json; owner?: string }) {
  const affinity = report.affinity || report.decision?.affinityPreview, dimensions: Json[] = affinity?.dimensions || [], score = validScore(affinity?.value) ? Math.round(affinity.value) : null, metrics = interactionMetrics(report.lines);
  const visibleProfile = visibleSignalProfile(report.lines || []);
  const maximumMatches = Math.max(1, ...visibleProfile.map(row => row.count));
  const visibleRows = visibleProfile.map(row => ({ label: row.label, value: row.count / maximumMatches * 100, count: row.count, evidence: row.evidence.length ? `原话：“${row.evidence.join("” · “")}”` : "" }));
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
  return <section className="wa-card" id="signals"><h2><ChartNoAxesCombined size={21}/>好感与互动信号</h2><div className="wa-metric"><small>{score === null ? "本段可见线索" : affinity?.valueScope === "partial" ? "已知维度参考指数" : "本轮互动参考指数"}</small><strong>{score === null ? `${visibleProfile.filter(row => row.count).length}/6 类` : `${score}/100`}</strong><small>{score === null ? "统计本段出现的线索类别；没有出现不等于对方没有好感。" : "来自已识别互动，不是对方喜欢你的概率。缺失维度不计为 0。"}</small></div><h3 className="wa-evidence-title">本段六类可见线索</h3><p className="wa-muted">图形比较本段匹配的发言次数，最外圈对应本段最高次数。它不是好感概率；同一句原话可以属于多类。</p><ArchiveRadar mode="evidence" labels={visibleProfile.map(row => row.label)} rows={visibleRows}/><div className="wa-bars">{visibleProfile.map(row => <div key={row.key}><div><span>{row.label}</span><b>{row.count} 句</b></div><div className="wa-track"><i style={{ width: `${row.count / maximumMatches * 100}%` }}/></div><p className="wa-muted">{row.evidence.length ? `原话：“${row.evidence.join("” · “")}”` : "本段未见对应原话，继续观察即可。"}</p></div>)}</div>{memory && <div className="wa-memory-chart"><h3 className="wa-evidence-title">人物档案 · 上次记录的互动</h3><p className="wa-muted">来自你已启用的人物档案；与本段线索分开展示，不把旧记录当作本次原话。</p><ArchiveRadar labels={(memory.dimensions || []).map((row: Json) => row.label)} rows={(memory.dimensions || []).map((row: Json) => ({ label: row.label, value: validScore(row.value) ? row.value : null }))}/></div>}<h3 className="wa-evidence-title">{loading ? "正在对照之前的互动…" : trend.title}</h3><p className="wa-muted">{trend.note}</p>{(affinity?.boundaryApplied || metrics.boundary) && <p className="wa-error">对方表达了明确边界，先停止推进。</p>}<div className="wa-observable-grid"><div><small>本轮线索</small><strong>{metrics.stage}</strong></div><div><small>提问 / 推进表达</small><strong>{metrics.activeRate === null ? "暂无样本" : `${metrics.activeRate}%`}</strong><span>{metrics.activeCount} / {metrics.otherTurnCount} 个对方发言回合</span></div><div><small>回应扩展线索</small><strong>{metrics.replyExpansion === null ? "暂无完整回应" : `${metrics.replyExpansion}%`}</strong><span>{metrics.expandedCount} / {metrics.responseCount} 次回应含追问或较多内容</span></div><div><small>邀约线索</small><strong>{metrics.invitationCount} 个发言回合</strong><span>兑现需对应约定和实际结果</span></div></div><details><summary>核对本轮边界、推进线索与样本限制</summary><p>边界提醒：{metrics.redFlag}</p><p>推进线索：{metrics.opportunity}</p><p>{metrics.stopAdvice}</p>{metrics.issues.map(item => <p key={item}>{item}</p>)}</details>{score !== null && dimensions.length > 0 && <><h3 className="wa-evidence-title">模型参考 · 六维互动信号</h3><AffinityRadar dimensions={dimensions}/></>}{report.affinityError && <p className="wa-muted">{report.affinityError}</p>}</section>;
}

export function ChatPhotoClues({ clues }: { clues?: Json[] }) {
  if (!clues?.length) return null;
  return <section className="wa-card" id="photos"><h2><Images size={21}/>对话里的照片线索</h2>{clues.map((clue, index) => <div className="wa-insight" key={index}><strong>{clue.location || `照片 ${index + 1}`}</strong>{clue.speaker && <p className="wa-muted">{clue.speaker === "other" ? "对方发送的图片" : clue.speaker === "self" ? "我发送的图片" : "发送者待确认"} · 不代表发送者本人拍摄</p>}<p>看到了：{clue.observation}</p>{clue.inference && <p>可能说明：{clue.inference}</p>}{clue.alternative && <p>也可能：{clue.alternative}</p>}{clue.verify && <p>可以聊聊：{clue.verify}</p>}</div>)}</section>;
}

export function SocialMaterialEvidence({ report }: { report: Json }) {
  return <>{report.photoClues?.length > 0 && <section className="wa-card"><h2><Images size={21}/>照片里的可聊线索</h2>{report.photoClues.map((row: Json, index: number) => <div className="wa-insight" key={index}><span className="wa-pill">{row.category}</span><h3>{row.item}</h3>{row.style && <p>{row.style}</p>}<p className="wa-muted">依据：{row.evidence}</p>{row.valueHint && <p>{row.valueHint}</p>}</div>)}</section>}{(report.profileBasics?.length > 0 || report.profileContext?.length > 0) && <section className="wa-card"><h2><UserRound size={21}/>识别到的基础资料</h2><p className="wa-muted">资料自述与可见线索，归档后仍需你核对。</p><div className="wa-observable-grid">{[...(report.profileBasics || []), ...(report.profileContext || [])].map((row: Json, index: number) => <div key={`${row.field}-${index}`}><small>{profileLabels[row.field] || row.field}</small><strong>{row.value}</strong>{row.evidence && <span>{row.evidence}</span>}</div>)}</div></section>}{report.knowledgeSources?.length > 0 && <section className="wa-card"><h2><BookOpen size={21}/>本次参考的方法</h2><div className="wa-actions">{report.knowledgeSources.map((row: Json, index: number) => <span className="wa-pill" key={row.anchor || index}>{row.label}</span>)}</div><p className="wa-muted">结合本次资料选取的关系主题笔记。</p></section>}</>;
}
