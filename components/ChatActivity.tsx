"use client";

import { useId, useMemo, useState } from "react";
import { Activity, CalendarDays, ChartNoAxesCombined, ChevronDown, Clock3, Gauge, MessageCircle, Mic, MoveUpRight } from "lucide-react";
import { chatActivityTimeline, computeChatActivity, type ChatActivityRecord, type ChatActivitySummary } from "@/lib/chat-activity";
import styles from "./ChatActivity.module.css";

export type ChatActivityProps = { records?: readonly ChatActivityRecord[]; summary?: ChatActivitySummary; account?: string; friend?: string; compact?: boolean; className?: string };
const shortDate = (value: string) => `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;

/** A passive summary by default; the chart is the only optional interaction. */
export function ChatActivity({ records = [], summary: supplied, account, friend = "TA", compact = false, className = "" }: ChatActivityProps) {
  const summary = useMemo(() => supplied || computeChatActivity(records, { account }), [supplied, records, account]);
  const timeline = useMemo(() => chatActivityTimeline(summary), [summary]);
  const [selectedDate, setSelectedDate] = useState("");
  const [expanded, setExpanded] = useState(false);
  const titleId = useId(), detailId = useId(), expandedId = useId();
  const selected = timeline.find(day => day.date === selectedDate) || timeline.at(-1);
  const max = Math.max(1, ...timeline.map(day => day.total));
  const totalStarts = summary.starts.comparable;
  const selfRatio = summary.starts.selfPercent || 0;
  const responses = summary.responses || { selfToOther: 0, otherToSelf: 0, selfCoverage: null, otherCoverage: null, averageSelfReplyMinutes: null, averageOtherReplyMinutes: null, comparableTurns: 0 };
  const otherName = friend === "TA" ? "TA" : friend;
  if (!summary.messages) return null;
  return <section className={`${styles.panel} ${compact ? styles.compact : ""} ${className}`} aria-labelledby={titleId} data-chat-activity="true">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}><Activity size={16}/>从实际聊天记录看互动</p><h2 id={titleId}>聊天节奏与主动联系</h2></div>
      <span className={styles.source}>{summary.sourceMode === "database" ? "按微信消息时间统计" : "按已导入片段统计"}</span>
    </header>
    {compact && <>
      {!expanded && <><div className={styles.compactMetrics}>
        <span><CalendarDays size={16}/><strong>{summary.datedMessages ? summary.activeDays : "—"}<small> 天</small></strong><small>有聊天记录</small></span>
        <span><MessageCircle size={16}/><strong>{summary.messages}<small> 条</small></strong><small>参与统计的消息</small></span>
        <span><MoveUpRight size={16}/><strong>{summary.starts.comparable ? summary.starts.self : "—"}<small> 次</small></strong><small>我先重新开口</small></span>
        <span><MoveUpRight size={16}/><strong>{summary.starts.comparable ? summary.starts.other : "—"}<small> 次</small></strong><small>TA先重新开口</small></span>
      </div><p className={styles.compactReading}>{summary.starts.comparable ? `可判断的 ${summary.starts.comparable} 轮中，双方先开口次数如上；结合回应与实际安排，才能看清投入。` : "已自动统计聊天量；时间或轮次不足时，先保留对主动性的判断。"}{summary.supplementalRecords ? ` ${summary.supplementalRecords} 条旧记录可能重复，未并入统计。` : ""}</p></>}
      <button type="button" className={styles.expandButton} aria-expanded={expanded} aria-controls={expandedId} onClick={() => setExpanded(!expanded)}>{expanded ? "收起聊天统计" : "查看频率与发起详情"}<ChevronDown size={16} style={{ transform: expanded ? "rotate(180deg)" : undefined }}/></button>
    </>}
    <div id={expandedId} hidden={compact && !expanded}>
    <div className={styles.metrics}>
      <div><CalendarDays size={19}/><span>材料覆盖</span><strong>{summary.spanDays === null ? "日期待确认" : <>{summary.spanDays}<small> 天</small></>}</strong><p>{summary.startDate ? `${summary.startDate} — ${summary.endDate}` : "不使用导入时间代替聊天时间"}</p></div>
      <div><Activity size={19}/><span>有聊天记录的天数</span><strong>{summary.datedMessages ? <>{summary.activeDays}<small> 天</small></> : "待确认"}</strong><p>只计算本次已经导入的日期</p></div>
      <div><MessageCircle size={19}/><span>参与统计的消息</span><strong>{summary.messages}<small> 条</small></strong><p>含 {summary.voices} 条语音，转写不重复计数</p></div>
    </div>
    <div className={styles.charts}>
      <div className={styles.card}>
        <h3><MoveUpRight size={20}/>谁先重新开启聊天</h3>
        <div className={styles.initiation}>
          <svg className={styles.ring} viewBox="0 0 120 120" role="img" aria-label={totalStarts ? `可判断${totalStarts}轮：我先发起${summary.starts.self}次，TA先发起${summary.starts.other}次` : `按消息条数：我 ${summary.self} 条，TA ${summary.other} 条`}>
            <circle cx="60" cy="60" r="46" fill="none" stroke="#eae4dd" strokeWidth="13"/>
            {(totalStarts > 0 || summary.self + summary.other > 0) && <><circle cx="60" cy="60" r="46" fill="none" stroke="#608b7b" strokeWidth="13"/><circle cx="60" cy="60" r="46" fill="none" stroke="#b66c55" strokeWidth="13" pathLength="100" strokeDasharray={`${totalStarts ? selfRatio : Math.round(summary.self / Math.max(1, summary.self + summary.other) * 100)} ${100 - (totalStarts ? selfRatio : Math.round(summary.self / Math.max(1, summary.self + summary.other) * 100))}`} transform="rotate(-90 60 60)"/></>}
            <text x="60" y="58" textAnchor="middle" className={styles.ringNumber}>{totalStarts || summary.self + summary.other}</text><text x="60" y="77" textAnchor="middle" className={styles.ringLabel}>{totalStarts ? "可判断轮次" : "消息条数"}</text>
          </svg>
          <div className={styles.legend}>
            <div><i className={styles.selfDot}/><span>我先发起</span><strong>{summary.starts.self}<small> 次{summary.starts.selfPercent === null ? "" : ` · ${summary.starts.selfPercent}%`}</small></strong></div>
            <div><i className={styles.otherDot}/><span title={otherName}>{otherName}先发起</span><strong>{summary.starts.other}<small> 次{summary.starts.otherPercent === null ? "" : ` · ${summary.starts.otherPercent}%`}</small></strong></div>
            <p>{summary.starts.unknown ? `${summary.starts.unknown} 轮起点或身份不确定，未计入比例` : "比例仅表示重新开口的次数构成"}</p>
          </div>
        </div>
        <p className={styles.note}><Clock3 size={14}/>间隔 ≥ {summary.sessionGapHours} 小时记为新一轮；首轮起点未知。这里统计开口行为，不是好感概率。</p>
      </div>
      <div className={`${styles.card} ${styles.responseCard}`}>
        <h3><Gauge size={20}/>回应是否接得住</h3>
        <p className={styles.responseIntro}>只统计有完整先后顺序的消息，回答“有没有接住”，不把消息数量直接当成好感。</p>
        <div className={styles.responseMetrics}>
          <div><span>TA 接住你的消息</span><strong>{responses.selfToOther}<small> 次</small></strong><em>{responses.otherCoverage === null ? "覆盖待了解" : `约 ${responses.otherCoverage}%`}</em></div>
          <div><span>你接住 TA 的消息</span><strong>{responses.otherToSelf}<small> 次</small></strong><em>{responses.selfCoverage === null ? "覆盖待了解" : `约 ${responses.selfCoverage}%`}</em></div>
          <div><span>可比较回应</span><strong>{responses.comparableTurns}<small> 次</small></strong><em>{responses.averageSelfReplyMinutes === null ? "间隔待了解" : `TA 平均约 ${responses.averageSelfReplyMinutes} 分钟`}</em></div>
        </div>
        <p className={styles.note}><Clock3 size={14}/>回应覆盖受导入范围、缺失消息和时间精度影响；它描述互动质量的一部分，不是关系结论。</p>
      </div>
      <div className={styles.card}>
        <h3><ChartNoAxesCombined size={20}/>聊天量怎样变化</h3>
        {timeline.length ? <>
          <div className={styles.chartLegend}><span><i className={styles.selfDot}/>我</span><span><i className={styles.otherDot}/>{otherName}</span>{summary.unknown > 0 && <span><i className={styles.unknownDot}/>身份待确认</span>}</div>
          <div className={styles.timeline} role="group" aria-label="按日期查看消息数量">
            {timeline.map(day => <button type="button" key={day.date} className={styles.barButton} aria-pressed={selected?.date === day.date} aria-controls={detailId} aria-label={`${day.date}${day.endDate !== day.date ? `至${day.endDate}` : ""}，${day.total}条消息`} onClick={() => setSelectedDate(day.date)} onFocus={() => setSelectedDate(day.date)}>
              <span className={styles.bar} style={{ height: `${Math.max(day.total ? 4 : 1, day.total / max * 100)}%` }} aria-hidden="true">{day.unknown > 0 && <i className={styles.unknownBar} style={{ flex: day.unknown }}/>}<i className={styles.otherBar} style={{ flex: day.other }}/><i className={styles.selfBar} style={{ flex: day.self }}/></span>
            </button>)}
          </div>
          <div className={styles.axis}><span>{shortDate(timeline[0].date)}</span><span>{timeline.some(day => day.date !== day.endDate) ? "按日期分组汇总" : "每天消息量"}</span><span>{shortDate(timeline.at(-1)!.endDate)}</span></div>
          <p className={styles.selection} id={detailId} aria-live="polite">{selected && <><strong>{shortDate(selected.date)}{selected.endDate !== selected.date ? `—${shortDate(selected.endDate)}` : ""}</strong>我 {selected.self} 条 · TA {selected.other} 条{selected.unknown ? ` · 身份待确认 ${selected.unknown} 条` : ""}<span>共 {selected.total} 条</span></>}</p>
          <p className={styles.note}>空白日期表示本次没有收录记录，不能直接视为没联系。</p>
        </> : <div className={styles.timeline} role="group" aria-label="双方消息数量">{[{ label: "我", total: summary.self }, { label: otherName, total: summary.other }].map(row => <div key={row.label} className={styles.barButton}><span className={styles.bar} style={{ height: `${Math.max(row.total ? 8 : 4, row.total / Math.max(1, summary.self, summary.other) * 100)}%` }} aria-hidden="true"><i className={row.label === "我" ? styles.selfBar : styles.otherBar} style={{ flex: Math.max(row.total, 1) }}/></span><small>{row.label} {row.total}</small></div>)}</div>}
      </div>
    </div>
    <div className={styles.messageSplit} aria-label="双方消息与语音数量">
      <span><MessageCircle size={17}/><strong>我 {summary.self} 条</strong><small><Mic size={13}/>语音 {summary.selfVoices} 条</small></span>
      <span><MessageCircle size={17}/><strong title={otherName}>{otherName} {summary.other} 条</strong><small><Mic size={13}/>语音 {summary.otherVoices} 条</small></span>
      {summary.unknown > 0 && <span className={styles.note}>另有 {summary.unknown} 条身份待确认</span>}
    </div>
    <div className={styles.readings}>{summary.reading.slice(0, 2).map(item => <div key={item.title}><h3>{item.title}</h3><p>{item.text}</p></div>)}</div>
    <footer className={styles.footer}><p>{summary.sourceMode === "database" ? `已核对 ${summary.messages} 条消息来源` : "目前只有可见片段，不能代表完整聊天历史"}{summary.duplicates > 0 ? `，排除 ${summary.duplicates} 条重复来源` : ""}。{summary.supplementalRecords > 0 ? `另有 ${summary.supplementalRecords} 条旧界面记录尚不能确认是否重复，保留原文，未并入统计。` : ""}{summary.ignored > 0 ? `${summary.ignored} 条系统提示或未能归类的记录未作为单条消息统计。` : ""}</p>{summary.limitations.filter(text => !text.startsWith("仅统计") && !text.includes("条旧界面记录")).map(text => <p key={text}>{text}</p>)}</footer>
    </div>
  </section>;
}
export default ChatActivity;
