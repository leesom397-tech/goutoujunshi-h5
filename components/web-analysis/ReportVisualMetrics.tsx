"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { readReportVisualMetrics, visualMetricsDays } from "./report-visual-metrics";
import styles from "./ReportVisualMetrics.module.css";

const number = (value: number) => value.toLocaleString("zh-CN");
const shortDate = (value: string) => value.slice(5).replace("-", "/");
const SIDES = [{ key: "self", label: "我" }, { key: "other", label: "对方" }, { key: "unknown", label: "未确认" }] as const;

/** Counts, calendar dates and observed turns; no sentiment probability or fabricated trend. */
export function ReportVisualMetrics({ report }: { report: unknown }) {
  const metrics = readReportVisualMetrics(report);
  const [requestedPage, setPage] = useState(0), [selectedDate, setSelectedDate] = useState("");
  const [chartWidth, setChartWidth] = useState(610), chartRef = useRef<SVGSVGElement>(null);
  const headingId = useId(), chartId = useId();
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setChartWidth(Math.max(230, Math.round(entry.contentRect.width))));
    observer.observe(chart);
    return () => observer.disconnect();
  }, [metrics?.spanDays, metrics?.days.length]);
  if (!metrics) return null;
  const { days, page, pages } = visualMetricsDays(metrics, requestedPage);
  const showTimeline = metrics.days.length > 1;
  const selectedIndex = Math.max(0, days.findIndex(day => day.date === selectedDate));
  const activeIndex = selectedDate && days.some(day => day.date === selectedDate) ? selectedIndex : Math.max(0, days.length - 1);
  const selected = days[activeIndex];
  const plot = { left: 46, right: chartWidth - 20, top: 15, bottom: 143 };
  const max = Math.max(1, ...days.flatMap(day => [day.self, day.other, day.unknown]));
  const x = (index: number) => plot.left + index / Math.max(1, days.length - 1) * (plot.right - plot.left);
  const y = (value: number) => plot.bottom - value / max * (plot.bottom - plot.top);
  const path = (key: "self" | "other" | "unknown") => days.map((day, index) => `${index ? "L" : "M"}${x(index)},${y(day[key])}`).join(" ");
  const circumference = 2 * Math.PI * 62;
  let offset = 0;
  function pageTo(value: number) { setPage(value); setSelectedDate(""); }
  function moveDay(event: KeyboardEvent<SVGGElement>, index: number) {
    const target = event.key === "ArrowRight" ? Math.min(days.length - 1, index + 1) : event.key === "ArrowLeft" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? days.length - 1 : null;
    if (target !== null) { event.preventDefault(); setSelectedDate(days[target].date); document.getElementById(`${chartId}-day-${target}`)?.focus(); }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedDate(days[index].date); }
  }
  return <section className={styles.metrics} data-report-visual-metrics aria-labelledby={headingId}>
    <header className={styles.heading}><h3 id={headingId}>互动概览</h3><p>{metrics.startDate ? `${metrics.startDate} — ${metrics.endDate}` : "基于已导入的聊天"}</p></header>
    <div className={styles.visuals}>
      <figure className={styles.composition} aria-label="双方消息构成">
        <div className={styles.ring}>
          <svg viewBox="0 0 168 168" role="img" aria-label={`消息总量 ${metrics.total} 条；我 ${metrics.self} 条，对方 ${metrics.other} 条，未确认 ${metrics.unknown} 条`} data-message-composition>
            <circle cx="84" cy="84" r="62" fill="none" className={styles.ringTrack} strokeWidth="14"/>
            {SIDES.map(side => { const length = metrics[side.key] / metrics.total * circumference, start = offset; offset += length; return metrics[side.key] ? <circle key={side.key} cx="84" cy="84" r="62" fill="none" strokeWidth="14" data-side={side.key} className={styles.ringSegment} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-start} transform="rotate(-90 84 84)"><title>{`${side.label} ${number(metrics[side.key])} 条`}</title></circle> : null; })}
          </svg>
          <div className={styles.ringValue} aria-hidden="true"><strong>{number(metrics.total)}</strong><span>条消息</span></div>
        </div>
        <figcaption><h4>双方发言构成</h4><div className={styles.legend}>{SIDES.map(side => <div key={side.key}><i data-side={side.key}/><span>{side.label}</span><strong>{number(metrics[side.key])}<small> 条</small></strong></div>)}</div><p>只统计这份材料里的消息。</p></figcaption>
      </figure>
      {showTimeline ? <figure className={styles.activity} data-daily-activity>
        <div className={styles.chartHeading}><h4>每日消息</h4><div className={styles.chartLegend}><span><i data-side="self"/>我</span><span><i data-side="other"/>对方</span>{metrics.unknown > 0 && <span><i data-side="unknown"/>未确认</span>}</div></div>
        <svg ref={chartRef} viewBox={`0 0 ${chartWidth} 175`} className={styles.chart} role="group" aria-label="每日消息数量，可用左右方向键选择日期">
          {[0, max / 2, max].map((value, index) => <g key={index} aria-hidden="true"><line x1={plot.left} x2={plot.right} y1={y(value)} y2={y(value)} className={styles.gridLine}/><text x={plot.left - 8} y={y(value) + 3} textAnchor="end" className={styles.axisText}>{index === 1 && max < 2 ? "" : Number.isInteger(value) ? value : ""}</text></g>)}
          <path d={`${path("self")} L${plot.right},${plot.bottom} L${plot.left},${plot.bottom} Z`} className={styles.area} aria-hidden="true"/>
          {SIDES.filter(side => side.key !== "unknown" || metrics.unknown > 0).map(side => <path key={side.key} d={path(side.key)} data-side={side.key} className={styles.series} aria-hidden="true"/>)}
          {selected && <line x1={x(activeIndex)} x2={x(activeIndex)} y1={plot.top} y2={plot.bottom} className={styles.cursor} aria-hidden="true"/>}
          {days.map((day, index) => <g key={day.date} id={`${chartId}-day-${index}`} role="button" tabIndex={index === activeIndex ? 0 : -1} aria-pressed={index === activeIndex} aria-label={`${day.date}，我 ${day.self} 条，对方 ${day.other} 条，未确认 ${day.unknown} 条`} onClick={() => setSelectedDate(day.date)} onFocus={() => setSelectedDate(day.date)} onKeyDown={event => moveDay(event, index)} className={styles.dayTarget} data-activity-date={day.date}>
            <rect x={x(index) - Math.max(6, (plot.right - plot.left) / days.length / 2)} y={plot.top - 6} width={Math.max(12, (plot.right - plot.left) / days.length)} height={plot.bottom - plot.top + 12} fill="transparent"/>
            {SIDES.filter(side => side.key !== "unknown" || day.unknown > 0).map(side => <circle key={side.key} cx={x(index)} cy={y(day[side.key])} r={index === activeIndex ? 4.5 : days.length <= 9 ? 2.5 : 1.8} className={styles.point} data-side={side.key}/>)}
            <title>{`${day.date}：我 ${day.self}，对方 ${day.other}，未确认 ${day.unknown}`}</title>
          </g>)}
          {[...new Set([0, ...(days.length > 4 ? [Math.floor((days.length - 1) / 2)] : []), days.length - 1])].map(index => <text key={index} x={x(index)} y="169" textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"} className={styles.axisText} aria-hidden="true">{shortDate(days[index].date)}</text>)}
        </svg>
        <figcaption className={styles.chartCaption}>
          <div className={styles.selectedDay} aria-live="polite" data-selected-activity-day>{selected && <><strong>{selected.date}</strong><span>我 <b>{selected.self}</b> · 对方 <b>{selected.other}</b>{selected.unknown > 0 && <> · 未确认 <b>{selected.unknown}</b></>} 条</span></>}</div>
          {pages > 1 && <div className={styles.paging}><button type="button" aria-label="查看更早的日期" disabled={page + 1 >= pages} onClick={() => pageTo(page + 1)}><ChevronLeft size={16}/></button><span>{days[0]?.date} — {days.at(-1)?.date}</span><button type="button" aria-label="查看更近的日期" disabled={page === 0} onClick={() => pageTo(page - 1)}><ChevronRight size={16}/></button></div>}
          <p>点击日期查看条数；空白日期表示这份材料中没有记录。{metrics.undated > 0 && `另有 ${number(metrics.undated)} 条日期未确认。`}</p>
        </figcaption>
      </figure> : <div className={styles.noTimeline} data-metrics-date-limited>
        <h4>观察范围</h4>
        <div className={styles.dateScope}>
          <div className={styles.calendar} data-date-state={metrics.days.length ? "known" : "unknown"} aria-label={metrics.startDate || "日期尚未确认"}>
            <svg viewBox="0 0 116 120" aria-hidden="true"><path d="M18 15h80a9 9 0 0 1 9 9v77a9 9 0 0 1-9 9H18a9 9 0 0 1-9-9V24a9 9 0 0 1 9-9Z"/><path d="M9 40h98M34 8v17M82 8v17"/></svg>
            <span className={styles.calendarMonth}>{metrics.startDate ? `${metrics.startDate.slice(0, 4)} / ${metrics.startDate.slice(5, 7)}` : "日期待确认"}</span>
            <strong>{metrics.startDate ? metrics.startDate.slice(8, 10) : "—"}</strong>
          </div>
          <div className={styles.scopeReading}><span className={styles.scopeStatus}>{metrics.days.length ? "单日记录" : "尚无可比较的日期"}</span><p>{metrics.days.length ? <><b>1</b> 个有记录的日期</> : "等待可靠的时间信息"}</p>{metrics.days.length > 0 && <small>有日期的消息 {number(metrics.dated)} 条{metrics.undated > 0 ? ` · ${number(metrics.undated)} 条待确认` : ""}</small>}</div>
        </div>
        <p>{metrics.days.length === 1 ? "目前仅有一天的记录，暂不判断多日趋势。" : "确认日期后，再比较前后的互动变化。"}</p>
      </div>}
    </div>
    {(metrics.activeDays > 0 || metrics.starts || metrics.replies) && <dl className={styles.measures}>
      {metrics.activeDays > 0 && <div><dt>有记录的聊天日</dt><dd>{number(metrics.activeDays)}<small> 天</small></dd><span>跨越 {number(metrics.spanDays)} 个自然日</span></div>}
      {metrics.starts && <div><dt>重新开启聊天</dt><dd><span>我 <b>{metrics.starts.self}</b></span><i>／</i><span>对方 <b>{metrics.starts.other}</b><small> 次</small></span></dd><span>{metrics.starts.gapHours ? `间隔至少 ${metrics.starts.gapHours} 小时计新一轮` : "按可确认的聊天轮次统计"}{metrics.starts.unknown > 0 ? ` · ${metrics.starts.unknown} 轮未确认` : ""}</span></div>}
      {metrics.replies && <div><dt>接续对方的回应</dt><dd><span>我 <b>{metrics.replies.self}</b></span><i>／</i><span>对方 <b>{metrics.replies.other}</b><small> 次</small></span></dd><span>同一轮内，说话人发生切换的次数</span></div>}
    </dl>}
  </section>;
}
