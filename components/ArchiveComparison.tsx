"use client";

import { useState } from "react";
import { Columns3, ChevronDown } from "lucide-react";
import type { ArchiveState } from "@/app/archive/types";
import { buildPersonComparison } from "@/lib/person-comparison.mjs";
import styles from "./archive-comparison.module.css";

export function ArchiveComparison({ state }: { state: ArchiveState }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [detailed, setDetailed] = useState(false);
  const view = buildPersonComparison(state, selected);
  return <section className={styles.panel} aria-label="人物对照">
    <div className={styles.heading}><div><span className={styles.kicker}>同一把尺，慢慢了解</span><h2><Columns3 size={21} />人物对照</h2><p>选 2–3 位人物，按你的期待逐项看资料与依据。</p></div><button className={styles.button} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "收起对照" : "开始对照"}<ChevronDown size={16} /></button></div>
    {open && <><p className={styles.note}>免费查看已有资料。各项参考保留原口径；资料多少不代表谁更合适，片段互动与完整记录分开标明。</p>
      <fieldset className={styles.selection}><legend>选择人物 · {view.count} / 3</legend>{view.choices.map(person => <label key={person.id} data-selected={person.selected}><input type="checkbox" checked={person.selected} disabled={person.disabled} onChange={() => setSelected(person.selected ? view.ids.filter(id => id !== person.id) : [...view.ids, person.id])} /><span>{person.label}</span></label>)}{!view.choices.length && <p>先建立至少 2 位人物档案，再来对照。</p>}</fieldset>
      {view.count === 3 && <p className={styles.note}>最多同时对照 3 位；取消一位后可以换人。</p>}
      {!view.ready ? <p className={styles.empty}>还需选择 {2 - view.count} 位人物。缺少的资料会显示“未提供”。</p> : <>
        <details className={styles.preferences}><summary>对照时，记得自己的期待</summary><dl>{view.preferences.map(item => <div key={item.key}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl><a href="/archive?tab=self">更新我的资料与期待 →</a></details>
        <div className={styles.tools}><label><input type="checkbox" checked={detailed} onChange={event => setDetailed(event.target.checked)} />展开基础资料与六项适配依据</label><span>窄屏可左右滑动</span></div>
        <div className={styles.scroll} role="region" aria-label="人物对照表，可左右滚动" tabIndex={0}><table className={styles.table}><caption>按已选顺序展示，不生成综合排名。资料更新时间与聊天发生日期分别标明。</caption><thead><tr><th scope="col">对照项目</th>{view.people.map(person => <th scope="col" key={person.id}><a href={`/archive?subjectId=${encodeURIComponent(person.id)}`}>{person.label} ↗</a><small>{person.updated}</small></th>)}</tr></thead><tbody>{view.rows.filter(row => detailed || !row.detail).map(row => <tr key={row.key}><th scope="row">{row.label}</th>{row.cells.map((value: { personId: string; text: string; source: string; caution: boolean; reportId: string }) => <td key={value.personId} data-caution={value.caution}><p>{value.text}</p>{value.source && <small>{value.source}</small>}{value.reportId && <a className={styles.source} href={`/report?id=${encodeURIComponent(value.reportId)}`}>查看分析依据 →</a>}</td>)}</tr>)}</tbody></table></div>
      </>}
    </>}
  </section>;
}
