"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { ArrowRight, ChevronDown, CircleHelp, Columns3, HeartHandshake, ListChecks, MessageCircle, Quote, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import type { ArchiveState } from "@/app/archive/types";
import { buildPersonComparison, comparisonSelection } from "@/lib/person-comparison.mjs";
import { buildComparisonGuidance, type ComparisonFinding, type ComparisonSource } from "@/lib/comparison-guidance";
import { reportPersonLabel } from "./report-person-label";
import styles from "./archive-comparison.module.css";

const basisLabels = { confirmed: "已有资料", report: "报告判断", inference: "相处推测", missing: "尚待了解", pending: "未确认" };
const brief = (value: string, max = 100) => value.length > max ? value.slice(0, max) + "…" : value;
function Sources({ rows, compact = false }: { rows: ComparisonSource[]; compact?: boolean }) {
  return rows.length ? <div className={styles.sources}>{rows.map((source, index) => <div key={index} data-side={source.side}>
    <span><Quote size={14} />{source.side === "self" || source.side === "other" ? reportPersonLabel(source.side) : reportPersonLabel(source.label)}</span>
    <p>{compact ? brief(source.quote, 76) : source.quote}</p>{!compact && (source.side === "self" || source.side === "other") ? <small>{reportPersonLabel(source.label)}</small> : null}
    {source.reportId && <a href={`/report?id=${encodeURIComponent(source.reportId)}`}>核对原报告 <ArrowRight size={14} /></a>}
  </div>)}</div> : null;
}
function Finding({ value }: { value: ComparisonFinding }) {
  return <div className={styles.finding} data-basis={value.basis}><div className={styles.findingTitle}><strong>{value.title}</strong><span>{basisLabels[value.basis]}</span></div><p>{value.reading}</p><Sources rows={value.sources} /></div>;
}
function BasicComparison({ view }: { view: ReturnType<typeof buildPersonComparison> }) {
  const keys = ["ageRange", "city", "education", "occupation", "relationshipStatus", "childrenPlan"];
  const all = keys.map(key => view.rows.find(row => row.key === key)).filter((row): row is NonNullable<typeof row> => !!row);
  const visible = all.filter(row => row.cells.some((cell: {text:string}) => cell.text !== "未提供"));
  const missing = all.filter(row => !visible.includes(row)).map(row => row.label);
  return <section className={styles.basicComparison} data-basic-comparison aria-label="基础资料对照"><header><h3><UserRound size={20}/>基础资料，一起看</h3><p>只用已确认档案；完整内容与来源在下方依据区。</p></header>{visible.length ? <div className={styles.basicScroll}><table className={styles.basicTable}><thead><tr><th scope="col">资料</th>{view.people.map(person => <th scope="col" key={person.id}>{person.label}</th>)}</tr></thead><tbody>{visible.map(row => <tr key={row.key}><th scope="row">{row.label}</th>{row.cells.map((cell: {text:string;personId:string}) => <td key={cell.personId} data-missing={cell.text === "未提供"}><span>{cell.text}</span></td>)}</tr>)}</tbody></table></div> : <p className={styles.note}>这些人物还没有已确认的基础资料，先看下方可核对的互动与共同点。</p>}{missing.length > 0 && visible.length > 0 && <p className={styles.basicMissing}>本次档案尚未提供：{missing.join("、")}。</p>}</section>;
}
export function ArchiveComparison({ state, openByDefault = false }: { state: ArchiveState; openByDefault?: boolean }) {
  const [open, setOpen] = useState(openByDefault);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { if (openByDefault) setOpen(true); }, [openByDefault]);
  useEffect(() => {
    const restore = () => setSelected(comparisonSelection(state.subjects, (new URLSearchParams(window.location.search).get("ids") || "").split(",")));
    restore(); window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [state.subjects]);
  const view = buildPersonComparison(state, selected);
  const guidance = buildComparisonGuidance(state, view.ids);
  function choose(ids: string[]) {
    const next = comparisonSelection(state.subjects, ids); setSelected(next);
    const url = new URL(window.location.href);
    if (next.length) url.searchParams.set("ids", next.join(",")); else url.searchParams.delete("ids");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
  const returnTo = `/archive?compare=1${view.ids.length ? `&ids=${encodeURIComponent(view.ids.join(","))}` : ""}`;
  const profileHref = `/archive?tab=self&quick=1&returnTo=${encodeURIComponent(returnTo)}`;
  return <section id="person-comparison" data-person-comparison className={styles.panel} aria-label="人物对照">
    <div className={styles.heading}><div><span className={styles.kicker}>从你的期待出发</span><h2><Columns3 size={27} />人物对照</h2><p>谁与你有共同话题，哪些差异要先聊清，下一步怎么了解。</p></div>{!openByDefault && <button className={styles.button} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "收起对照" : "开始对照"}<ChevronDown size={17} /></button>}</div>
    {open && (guidance.disabled ? <p className={styles.empty}>档案已暂停。恢复后，可继续对照已有资料。</p> : <>
      <fieldset className={styles.selection}><legend>选择 2–3 位人物 <span>已选 {view.count} / 3</span></legend>{view.choices.map(person => <label key={person.id} data-selected={person.selected}><input type="checkbox" checked={person.selected} disabled={person.disabled} onChange={() => choose(person.selected ? view.ids.filter(id => id !== person.id) : [...view.ids, person.id])} /><UserRound size={17} /><span>{person.label}</span></label>)}{!view.choices.length && <p>先建立至少 2 位人物档案，再来对照。</p>}</fieldset>
      <div className={styles.preferenceBar}><div><strong><HeartHandshake size={19} />你的期待，参与这次判断</strong><p>{guidance.hasSelf ? guidance.preferences.slice(0, 3).map(source => source.quote).join(" · ") : "先看每个人已有的线索；补充你的偏好，就能看双方真正的共同点。"}</p></div><a href={profileHref}>{guidance.hasSelf ? "调整我的期待" : "快速补充我的资料"}<ArrowRight size={16} /></a></div>
      {!view.ready ? <p className={styles.empty}>再选 {2 - view.count} 位，就能看到共同点、相处差异和下一步。</p> : <>
        <BasicComparison view={view}/><div className={styles.sectionHeading}><h3><ListChecks size={22} />先看各自的重点</h3><p>按你的选择顺序展示。资料多少不代表谁更合适。</p></div>
        <div className={styles.guidanceGrid} style={{ "--people-count": view.count } as CSSProperties}>
          {guidance.people.map(person => <article key={person.id} className={styles.personGuide} data-tone={person.tone} data-person-id={person.id}>
            <header><a href={`/archive?subjectId=${encodeURIComponent(person.id)}`}>{person.label}<ArrowRight size={17} /></a><span>{person.tone === "verify" ? "先核实期待" : person.tone === "explore" ? "有共同话题" : "继续观察"}</span></header>
            <h4>{person.headline}</h4><p className={styles.summary}>{person.summary}</p>
            <section className={styles.nextStep}><h5><MessageCircle size={19} />下一步怎么做</h5><p>{person.nextStep}</p><span>可以这样确认</span><blockquote>{person.verifyQuestion}</blockquote></section>
            <section className={styles.group}><h5><HeartHandshake size={19} />共同点 · {person.commonPoints.length}</h5>{person.commonPoints.length ? <><div className={styles.chips}>{person.commonPoints.map(item => <span key={item.title}>{item.title}</span>)}</div><Sources rows={person.commonPoints[0].sources} compact /></> : <p className={styles.note}>尚无双方都明确表达的共同点，可以先从对方已有兴趣聊起。</p>}</section>
            {person.cautions[0] && <section className={styles.concern}><h5><CircleHelp size={18} />{person.cautions[0].title}</h5><p><span>{basisLabels[person.cautions[0].basis]}</span>{brief(person.cautions[0].reading, 110)}</p></section>}
            <dl className={styles.quickFacts}><div><dt><ShieldCheck size={16} />投入</dt><dd>{brief(person.investment.reading, 92)}{person.reportId && <a href={`/report?id=${encodeURIComponent(person.reportId)}`}>看原报告 →</a>}</dd></div><div><dt><ShieldCheck size={16} />边界</dt><dd>{person.boundaries.sources.length ? person.boundaries.sources.map(source => (source.side === "self" ? "你：" : "对方：") + brief(source.quote, 42)).join("；") : "暂无明确记录，先看具体需要是否被尊重。"}<small>自述需要，不等于已在行动中做到。</small></dd></div><div><dt><Sparkles size={16} />期待</dt><dd>{brief(person.expectation.reading, 100)}</dd></div></dl>
          </article>)}
        </div>
        <details className={styles.fullTable}><summary><Columns3 size={19} />查看完整判断依据与资料表<ChevronDown size={17} /></summary><div className={styles.detailEvidence}>{guidance.people.map(person => <section key={person.id}><h4>{person.label} · 判断依据</h4>{person.commonPoints.map(item => <Finding key={item.title} value={item} />)}{person.cautions.map(item => <Finding key={item.title} value={item} />)}<Finding value={person.investment} /><Finding value={person.boundaries} />{!person.cautions.some(item => item.title === person.expectation.title) && <Finding value={person.expectation} />}</section>)}</div><p className={styles.note}>所有原始对照项目都在这里；窄屏可左右滑动表格。</p>
          <div className={styles.scroll} role="region" aria-label="人物对照表，可左右滚动" tabIndex={0}><table className={styles.table}><caption>保留各项原口径；资料更新时间与聊天发生日期分别标明。</caption><thead><tr><th scope="col">对照项目</th>{view.people.map(person => <th scope="col" key={person.id}>{person.label}<small>{person.updated}</small></th>)}</tr></thead><tbody>{view.rows.map(row => <tr key={row.key}><th scope="row">{row.label}</th>{row.cells.map((value: { personId: string; text: string; source: string; caution: boolean; reportId: string }) => <td key={value.personId} data-caution={value.caution}><p>{value.text}</p>{value.source && <small>{value.source}</small>}{value.reportId && <a className={styles.source} href={`/report?id=${encodeURIComponent(value.reportId)}`}>查看分析依据 →</a>}</td>)}</tr>)}</tbody></table></div>
        </details>
      </>}
    </>)}
  </section>;
}
