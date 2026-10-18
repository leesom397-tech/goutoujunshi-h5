"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, MessageCircle, Quote } from "lucide-react";
import { chatActivityTimeline, type ChatActivitySummary } from "@/lib/chat-activity";
import { reportPersonLabel } from "./report-person-label";
import { ReportDetails } from "./web-analysis/ReportDetails";
import { CaptureEvidence } from "./web-analysis/CaptureEvidence";
import styles from "./RelationshipJourney.module.css";

type Source = { basis?: string; libraryId?: string; sourceKind?: string; mediaId?: string; reportId?: string; sourceId?: string; factId?: string; quote: string; speaker: "self" | "other" | "unknown"; at: string };
export type JourneyContext = { version: number; subjectId: string; coverage: { reportCount: number; sourceKinds: string[]; archiveMessages: number; activityStatus: string }; activity: ChatActivitySummary | null; activityReportId?: string; events: Array<{ id: string; kind: string; basis: string; title: string; detail: string; eventDate: string; dateKind: string; recordedAt: number; sources: Source[] }>; limitations: string[] };
const shortDate = (date: string) => date.slice(5, 10).replace("-", "/");
const kinds: Record<string, string> = { chat: "聊天", moments: "朋友圈", social: "主页", "user-event": "相处经历", feedback: "行动反馈" };
const eventTitle = (event: JourneyContext["events"][number]) => /聊天中的变化|原话支持的观察|聊天资料支持的观察|动态中的变化|动态支持的观察|朋友圈内容记录|聊天中的关键表达|档案中保存的朋友圈/.test(event.title) ? (event.detail.length > 76 ? event.detail.slice(0, 76) + "…" : event.detail) : event.title;
const bases: Record<string, string> = { quote: "原话", interpretation: "分析线索", "user-report": "本人补充", profile: "已确认资料" };

/** Only measured behavior appears here; message shares never become affection scores. */
export function RelationshipSnapshot({ activity, friend = "对方" }: { activity?: ChatActivitySummary | null; friend?: string }) {
  if (!activity?.messages) return <p className={styles.gap}>还没有可核对的聊天统计，先按已提供的原话阅读。</p>;
  const total = activity.self + activity.other + activity.unknown;
  return <div className={styles.snapshot} data-relationship-snapshot>
    <div className={styles.snapshotHead}><span><MessageCircle size={16}/>双方发言</span><small>{activity.messages} 条{activity.activeDays ? ` · ${activity.activeDays} 个聊天日` : ""}</small></div>
    <div className={styles.share} role="img" aria-label={`我 ${activity.self} 条，对方 ${activity.other} 条，身份待确认 ${activity.unknown} 条`}>
      <i data-side="self" style={{ width: `${activity.self / Math.max(1, total) * 100}%` }}/><i data-side="other" style={{ width: `${activity.other / Math.max(1, total) * 100}%` }}/>{activity.unknown > 0 && <i data-side="unknown" style={{ width: `${activity.unknown / total * 100}%` }}/>}</div>
    <div className={styles.legend}><span><i data-side="self"/>我 <b>{activity.self}</b></span><span><i data-side="other"/>{reportPersonLabel(friend)} <b>{activity.other}</b></span>{activity.unknown > 0 && <span>身份待确认 {activity.unknown}</span>}</div>
    {activity.starts?.comparable > 0 && <div className={styles.starts}><span>重新开启对话</span><b>我 {activity.starts.self} 次</b><b>对方 {activity.starts.other} 次</b></div>}
    <small className={styles.scope}>消息量与发起次数用于看互动节奏。</small>
  </div>;
}

export function RelationshipJourney({ context, friend = "对方", currentReportId, embedded = false }: { context: JourneyContext; friend?: string; currentReportId?: string; embedded?: boolean }) {
  const [range, setRange] = useState(""), [page, setPage] = useState(0), [undated, setUndated] = useState(false);
  useEffect(() => { setRange(""); setPage(0); setUndated(false); }, [context.subjectId]);
  const activity = context.activity;
  const days = useMemo(() => activity ? chatActivityTimeline(activity, 28) : [], [activity]);
  const max = Math.max(1, ...days.flatMap(day => [day.self, day.other]));
  const selected = days.find(day => day.date === range);
  const events = context.events || [];
  const known = events.filter(event => !!event.eventDate), unknown = events.filter(event => !event.eventDate);
  const showingUndated = undated || !known.length;
  const matching = (showingUndated ? unknown : known).filter(event => !selected || showingUndated || event.eventDate.slice(0, 10) >= selected.date && event.eventDate.slice(0, 10) <= selected.endDate);
  const count = Math.max(1, Math.ceil(matching.length / 6)), shownPage = Math.min(page, count - 1);
  const filtered = matching.slice(shownPage * 6, (shownPage + 1) * 6);
  function choose(date: string) { setRange(date === range ? "" : date); setPage(0); setUndated(false); }
  return <section className={styles.journey} data-relationship-journey data-embedded={embedded || undefined}>
    <header className={styles.heading}><div><h2><CalendarDays size={21}/>你们的相处历程</h2><p>{activity?.startDate ? `${activity.startDate} — ${activity.endDate || activity.startDate}` : "有明确日期的经历按发生时间排列。"}{!!activity?.undatedMessages && ` · ${activity.undatedMessages} 条日期待确认`}</p></div>{context.coverage.activityStatus === "saved" && <small>统计来自已保存报告</small>}</header>
    {days.some(day => day.self + day.other > 0) ? <div className={styles.chart} data-relationship-activity-chart>
      <div className={styles.legend}><span><i data-side="self"/>我</span><span><i data-side="other"/>{reportPersonLabel(friend)}</span><small>点击日期，核对当天发生的事</small></div>
      <div className={styles.bars} role="group" aria-label="双方按日期的消息数量">
        {days.map((day, index) => <button key={day.date} type="button" className={styles.day} aria-pressed={range === day.date} aria-label={`${day.date}${day.endDate !== day.date ? ` 至 ${day.endDate}` : ""}，我 ${day.self} 条，对方 ${day.other} 条`} title={`${day.date} · 我 ${day.self} 条 · 对方 ${day.other} 条`} onClick={() => choose(day.date)}>
          <span className={styles.upper}><i style={{ height: `${day.self / max * 100}%` }}/></span><span className={styles.lower}><i style={{ height: `${day.other / max * 100}%` }}/></span>
          <small>{index === 0 || index === days.length - 1 || days.length <= 10 || index % Math.ceil(days.length / 6) === 0 ? shortDate(day.date) : ""}</small>
        </button>)}
      </div>
      <div className={styles.chartSelection} aria-live="polite">{selected ? <><strong>{selected.date}{selected.endDate !== selected.date ? ` — ${selected.endDate}` : ""}</strong><span>我 {selected.self} 条 · 对方 {selected.other} 条{selected.unknown ? ` · 身份待确认 ${selected.unknown} 条` : ""}</span><button type="button" onClick={() => setRange("")}>查看完整历程</button></> : <span>上下两侧按同一刻度显示消息量，具体态度与行动看对应依据。{!!activity?.unknown && ` 另有 ${activity.unknown} 条身份待确认。`}</span>}</div>
    </div> : <p className={styles.gap}>{activity?.messages ? days.length ? "部分记录的说话人待确认，暂不绘制双方对比。" : `${activity.messages} 条聊天暂缺可比较的日期，保留原话依据。` : "还没有可按日期统计的聊天；下方保留已有经历与材料。"}</p>}
    <div className={styles.eventHead}><h3>{selected && !showingUndated ? "这段时间的线索" : "关键经历与依据"}</h3>{unknown.length > 0 && <div role="group" aria-label="时间线日期范围"><button type="button" aria-pressed={!showingUndated} onClick={() => { setUndated(false); setPage(0); }}>日期已知 {known.length}</button><button type="button" aria-pressed={showingUndated} onClick={() => { setUndated(true); setPage(0); }}>日期待确认 {unknown.length}</button></div>}</div>
    {filtered.length ? <div className={styles.events}>{filtered.map(event => <article key={event.id} data-journey-event={event.id}>
      <div className={styles.eventDate}><span>{event.eventDate ? event.eventDate.slice(0, 10) : "日期待确认"}</span><small>{kinds[event.kind] || "关系记录"} · {bases[event.basis] || "材料线索"}</small></div>
      <ReportDetails title={eventTitle(event)} description="查看这件事与原话依据">
        <div className={styles.eventDetail}>{!event.sources.some(source => source.quote.trim() === event.detail.trim()) && <p>{event.detail}</p>}{event.sources.map((source, index) => <div className={styles.source} key={source.sourceId || source.factId || index}><small><Quote size={15}/>{source.basis==="visual"?"图片可见内容":reportPersonLabel(source.speaker)}{source.at ? ` · ${source.at}` : ""}</small><blockquote>{source.quote}</blockquote>{source.reportId && source.reportId !== currentReportId ? <a href={`/report?id=${encodeURIComponent(source.reportId)}`}>查看来源报告<ArrowUpRight size={14}/></a> : <CaptureEvidence quote={source.quote} sourceIds={source.sourceId ? [source.sourceId] : undefined} libraryId={source.libraryId} sourceKind={source.sourceKind} label={source.basis==="visual"?"查看图片来源":undefined}/>}</div>)}</div>
      </ReportDetails>
    </article>)}</div> : <p className={styles.gap}>{selected ? "这个日期范围有聊天统计，尚无单独保留的关键事件。可以回到完整历程查看其他线索。" : showingUndated ? "目前没有日期待确认的事件。" : "还没有保留可定位的关键事件；新报告与已确认经历会接入这里。"}</p>}
    {count > 1 && <nav className={styles.pages} aria-label="历程分页"><button disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}><ChevronLeft size={16}/>上一页</button><span>{shownPage + 1} / {count}</span><button disabled={shownPage >= count - 1} onClick={() => setPage(shownPage + 1)}>下一页<ChevronRight size={16}/></button></nav>}
    {context.limitations?.length > 0 && <details className={styles.limitations}><summary>材料范围与待补充信息</summary>{context.limitations.map(value => <p key={value}>{value}</p>)}</details>}
  </section>;
}
