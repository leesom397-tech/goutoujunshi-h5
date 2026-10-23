"use client";
import { useId, useState } from "react";
import { ArrowRight, ChartNoAxesCombined, Check, CircleHelp, MousePointer2 } from "lucide-react";
import type { ArchiveState } from "@/app/archive/types";
import "./chart-tools.css";

const known = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
type RadarRow = { label: string; value: number | null; count?: number; evidence?: string; description?: string };
const dimensionHints: Record<string, string> = {
  主动表达: "结合主动发起话题、提问和推进安排的具体表现理解。",
  回应承接: "看对方是否回应了你真正表达的内容与感受。",
  回应扩展: "看回复是否带来新的内容、追问或话题，而不只看字数。",
  邀约兑现: "邀约与实际赴约需要分开核对，口头表达不能代替行动。",
  边界尊重: "看明确表达的节奏、拒绝和个人边界是否被尊重。",
  互惠稳定: "结合一段时间内双方投入与回应的稳定性理解。",
  年龄阶段: "对照双方已知的人生阶段与年龄偏好。",
  见面距离: "对照常住地、实际见面条件与异地接受程度。",
  教育经历: "对照已知教育经历与明确表达的相处需求。",
  职业交集: "对照已知职业与生活安排，保留尚未确认的信息。",
  婚恋目标: "对照双方明确表达的关系期待与未来安排。",
  生活方式: "对照日常节奏、兴趣与已确认的生活偏好。",
};

export function ArchiveRadar({ rows, labels = [], mode = "score" }: { rows: RadarRow[]; labels?: string[]; mode?: "score" | "evidence" }) {
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, rows.findIndex(item => known(item.value))));
  const detailId = useId();
  const items = Array.from({ length: 6 }, (_, index) => ({
    label: rows[index]?.label || labels[index] || "维度 " + (index + 1),
    value: known(rows[index]?.value) ? rows[index].value : null,
    count: Number.isInteger(rows[index]?.count) && rows[index].count! >= 0 ? rows[index].count! : null,
    evidence: rows[index]?.evidence || "",
    description: rows[index]?.description || "",
  }));
  const knownCount = items.filter(item => item.value !== null).length;
  // Legacy evidence callers used 25 units per match; new callers pass the
  // actual count separately so normalizing the plot never changes its labels.
  const evidenceCount = (item: typeof items[number]) => item.count ?? (item.value === null ? null : Math.round(item.value / 25));
  const displayValue = (item: typeof items[number]) => item.value === null ? "待了解" : mode === "evidence" ? `${evidenceCount(item)} 句` : `${item.value} / 100`;
  const active = items[Math.min(selectedIndex, 5)];
  const xy = (index: number, radius: number) => [180 + Math.cos(-Math.PI / 2 + index * Math.PI / 3) * radius, 145 + Math.sin(-Math.PI / 2 + index * Math.PI / 3) * radius];
  if (!knownCount || mode === "evidence" && !items.some(item => (evidenceCount(item) || 0) > 0)) return <p className="cz-chart-note">这组材料还不足以绘制分项图，已有依据仍保留在报告中。</p>;
  return <div className="cz-chart-tool cz-radar-tool">
    <div className="cz-chart-toolbar"><span className="cz-chart-coverage"><ChartNoAxesCombined size={15}/>{mode === "evidence" ? "已展示" : "已知"} {knownCount} / 6 项</span><span><MousePointer2 size={13}/>点选维度查看</span></div>
    {knownCount ? <svg className="cz-data-chart cz-radar-chart" viewBox="0 0 360 295" role="group" aria-label={mode === "evidence" ? "六类可见线索次数图，可点选查看本段匹配次数" : "六维参考图，选择圆点或下方维度查看数值与依据"}>
      {[25, 50, 75, 100].map(level => <polygon key={level} points={items.map((_, index) => xy(index, level).join(",")).join(" ")} className="cz-chart-grid"/>)}
      {items.map((_, index) => { const edge = xy(index, 100); return <line key={index} x1="180" y1="145" x2={edge[0]} y2={edge[1]} className="cz-chart-axis"/>; })}
      {knownCount === 6 && <polygon className="cz-radar-area" points={items.map((item, index) => xy(index, item.value!).join(",")).join(" ")} pathLength="1"/>}
      {items.map((item, index) => {
        const label = xy(index, 126), point = item.value === null ? null : xy(index, item.value);
        return <g key={index} className="cz-radar-node" data-selected={selectedIndex === index}>
          <text x={label[0]} y={label[1]} textAnchor="middle" dominantBaseline="middle" className={item.value === null ? "cz-chart-unknown" : ""}>{item.label}</text>
          {point && <g role="button" tabIndex={0} aria-pressed={selectedIndex === index} aria-label={item.label + "，" + displayValue(item) + "，查看依据"} aria-describedby={detailId} onClick={() => setSelectedIndex(index)} onFocus={() => setSelectedIndex(index)} onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); setSelectedIndex(index); } }}>
            <circle className="cz-chart-hit" cx={point[0]} cy={point[1]} r="14"/>
            <circle className="cz-chart-selection" cx={point[0]} cy={point[1]} r="10"/>
            <circle className="cz-chart-dot" cx={point[0]} cy={point[1]} r="4.5"/>
          </g>}
        </g>;
      })}
    </svg> : <div className="cz-chart-empty"><CircleHelp size={24}/><strong>再多一些资料，判断会更清楚。</strong><p>目前六项均待了解；补充材料后再展示参考值。</p></div>}
    <div className="cz-dimension-controls" aria-label="选择查看的维度">
      {items.map((item, index) => <button className="cz-dimension-button" type="button" key={index} aria-pressed={selectedIndex === index} aria-controls={detailId} onClick={() => setSelectedIndex(index)}>
        <span><span>{item.label}</span>{selectedIndex === index && <Check size={13}/>}</span>
        <strong>{displayValue(item)}</strong>
        {item.value !== null && <span className="cz-dimension-track" aria-hidden="true"><i style={{ width: item.value + "%" }}/></span>}
      </button>)}
    </div>
    <div className="cz-chart-detail" id={detailId} aria-live="polite" aria-atomic="true">
      <div><strong>{active.label}</strong><span>{active.value === null ? "材料待补充" : displayValue(active)}</span></div>
      <p>{active.evidence || (mode === "evidence" ? active.value === null ? "这项材料待补充，暂不统计。" : evidenceCount(active) ? `本段匹配 ${evidenceCount(active)} 句，原话在图表下方可核对。` : "本段未见对应原话；不代表对方没有这种表现。" : active.value === null ? "这项还没有足够材料，保留为空，不纳入已知维度参考。" : active.description || dimensionHints[active.label] || "这是已有材料下的维度参考值，可结合原话与实际互动核对。")}</p>
      {active.evidence && active.description && <small>{active.description}</small>}
    </div>
    <p className="cz-chart-note">{mode === "evidence" ? "图形比较本段匹配次数，不是好感概率。同一句可属于多类；0 句表示本段未见。" : "未知项保留空缺；六项齐全时连接成图。分数用于对照材料，不是喜欢你的概率。"}</p>
  </div>;
}

export function ArchiveTrend({ points }: { points: ArchiveState["trends"][number]["points"] }) {
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const detailId = useId();
  const dated = points.filter(point => point.eventStart).slice(-8);
  const selectedIndex = Math.max(0, selectedReport && dated.some(item => item.reportId === selectedReport) ? dated.findIndex(item => item.reportId === selectedReport) : dated.length - 1);
  const active = dated[selectedIndex];
  const x = (index: number) => dated.length === 1 ? 190 : 42 + index * 310 / (dated.length - 1);
  const y = (score: number) => 174 - score * 1.4;
  const connected = (index: number) => index > 0 && known(dated[index].score) && known(dated[index - 1].score) && dated[index].connectPrevious && dated[index].previousReportId === dated[index - 1].reportId;
  const comparable = active && connected(selectedIndex);
  const delta = comparable ? active.score! - dated[selectedIndex - 1].score! : null;
  if (!dated.some(point => known(point.score))) return <p className="cz-chart-note">还没有可比较的日期记录，先核对已保存的经历与原话。</p>;
  return <div className="cz-chart-tool cz-trend-tool">
    <div className="cz-chart-toolbar"><span className="cz-chart-coverage"><ChartNoAxesCombined size={15}/>最近 {dated.length} 个有日期的节点</span><span><MousePointer2 size={13}/>点选记录回看</span></div>
    <svg className="cz-data-chart cz-trend-chart" viewBox="0 0 395 245" role="group" aria-label="最近八个有日期节点的互动分数，未知分数留空，只有可比的材料连接趋势">
      {[0, 25, 50, 75, 100].map(score => <g key={score}><line x1="37" x2="362" y1={y(score)} y2={y(score)} className="cz-chart-grid"/><text x="27" y={y(score) + 4} textAnchor="end">{score}</text></g>)}
      {known(active.score) && <line x1={x(selectedIndex)} x2={x(selectedIndex)} y1="29" y2="183" className="cz-trend-cursor"/>}
      {dated.map((item, index) => <g key={item.reportId}>
        {connected(index) && <line className="cz-trend-line" x1={x(index - 1)} y1={y(dated[index - 1].score!)} x2={x(index)} y2={y(item.score!)} pathLength="1"/>}
        <g role="button" className="cz-trend-node" data-selected={selectedIndex === index} tabIndex={0} aria-pressed={selectedIndex === index} aria-label={(item.dateLabel || item.eventStart) + "，" + (known(item.score) ? item.score + " 分" : "分数待了解") + "，查看记录"} aria-describedby={detailId} onClick={() => setSelectedReport(item.reportId)} onFocus={() => setSelectedReport(item.reportId)} onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); setSelectedReport(item.reportId); } }}>
          {known(item.score) ? <><circle className="cz-chart-hit" cx={x(index)} cy={y(item.score)} r="14"/><circle className="cz-chart-selection" cx={x(index)} cy={y(item.score)} r="10"/><circle className="cz-chart-dot" cx={x(index)} cy={y(item.score)} r="5"/><text x={x(index)} y={y(item.score) - 14} textAnchor="middle">{item.score}</text></> : <><rect x={x(index) - 16} y="176" width="32" height="25" className="cz-chart-hit"/><text x={x(index)} y="190" textAnchor="middle" className="cz-chart-unknown">—</text></>}
          <text x={x(index)} y={index % 2 ? "223" : "207"} textAnchor="middle" className="cz-chart-date">{item.axisLabel || item.eventStart.slice(5)}</text>
        </g>
      </g>)}
    </svg>
    <div className="cz-trend-controls" aria-label="选择互动记录">
      {dated.map((item, index) => <button className="cz-trend-button" type="button" key={item.reportId} aria-pressed={index === selectedIndex} aria-controls={detailId} onClick={() => setSelectedReport(item.reportId)}><span>{item.axisLabel || item.eventStart.slice(5)}</span><strong>{known(item.score) ? item.score : "待了解"}</strong></button>)}
    </div>
    <div className="cz-chart-detail cz-trend-detail" id={detailId} aria-live="polite" aria-atomic="true">
      <div><strong>{active.dateLabel || active.eventStart}</strong><span>{known(active.score) ? active.score + " / 100" : "分数待了解"}</span></div>
      {delta !== null && <span className="cz-trend-change">较上一条可比记录 {delta > 0 ? "+" : ""}{delta} 分</span>}
      <p>{active.summary || "可结合对应聊天分析查看原话与判断依据。"}</p>
      {active.changeSummary && <p>{active.changeSummary}</p>}
      {!comparable && selectedIndex > 0 && <small>与上一条未建立可比关系，本节点独立展示。</small>}
      <a href={"/report?id=" + encodeURIComponent(active.reportId)}>查看这次分析<ArrowRight size={15}/></a>
    </div>
    <p className="cz-chart-note">按记录顺序展示最近 8 个有日期的节点。未知分数、不可比记录不连线，完整记录见下方时间线。</p>
  </div>;
}

