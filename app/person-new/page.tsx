"use client";

import { useRef, useState } from "react";
import { UserRound, NotebookPen, Check, ShieldCheck } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { NumberedHeading } from "@/components/ArchiveVisuals";
import { archiveRequest, type ArchiveState } from "@/app/archive/types";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import styles from "@/app/archive/archive.module.css";

const pickers = [
  { key: "ageRange", label: "年龄", options: Array.from({ length: 83 }, (_, index) => `${index + 18} 岁`) },
  { key: "education", label: "学历", options: ["高中及以下", "大专", "本科", "硕士", "博士"] },
  { key: "relationshipStatus", label: "婚恋状态", options: ["单身", "恋爱中", "已婚", "离异", "丧偶"] },
  { key: "childrenPlan", label: "婚育想法", options: ["希望结婚生育", "希望结婚，生育未定", "不计划生育", "暂不考虑婚育", "已有孩子"] },
  { key: "howMet", label: "认识方式", options: ["朋友介绍", "相亲认识", "同事", "同学", "线下活动", "工作合作", "社交软件", "其他"] },
  { key: "stage", label: "目前关系", options: ["刚认识", "普通朋友", "正在了解", "暧昧中", "恋爱中", "已婚", "分开后重新联系"] },
];

export default function PersonNewPage() {
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const request = useRef<{ id: string; label: string; data: Record<string, string> } | null>(null);
  async function save() {
    if (busy || !agreed || !label.trim()) return;
    setBusy(true); setError(""); setSignedOut(false);
    try {
      const profile = await archiveRequest<ArchiveState>("profile");
      if (profile.enabled && profile.paused) throw new Error("档案已暂停，请先返回档案页恢复使用。");
      if (!profile.enabled) await archiveRequest("profile", { action: "consent", enabled: true });
      if (request.current) {
        const existing = profile.subjects.find(person => person.id === request.current!.id);
        if (existing) { window.location.assign(`/archive?subjectId=${encodeURIComponent(existing.id)}`); return; }
      }
      request.current ||= { id: crypto.randomUUID(), label: label.trim(), data: { ...fields } };
      const result = await archiveRequest<{ createdSubjectId: string }>("profile", { action: "create-manual", ...request.current, confirmed: true });
      if (result.createdSubjectId !== request.current.id) throw new Error("未确认建档结果，请返回人物列表核对。");
      window.location.assign(`/archive?subjectId=${encodeURIComponent(result.createdSubjectId)}&avatar=choose`);
    } catch (cause) { if ((cause as { status?: number }).status === 401) setSignedOut(true); setError(cause instanceof Error ? cause.message : "暂未保存，填写内容仍保留。"); }
    finally { setBusy(false); }
  }
  return <main className={styles.page}><WebNav /><div className={`${styles.wrap} ${styles.newPersonWrap}`}><AuroraPageHero eyebrow="新建人物" title="没有截图，也能建档。" description="只需一个称呼，知道多少填多少。"/><div className={styles.wizardSteps} aria-label="建档步骤"><span className={styles.wizardCurrent}><UserRound size={16} /> 一个称呼</span><i /><span><NotebookPen size={16} /> 补充资料</span><i /><span><Check size={16} /> 保存档案</span></div><form className={styles.column} onSubmit={event => { event.preventDefault(); void save(); }}><fieldset className={styles.formfieldset} disabled={busy || !!request.current}><div className={styles.column}><section className={`${styles.card} ${styles.formSection}`}><NumberedHeading number="01" title="从一个称呼开始" caption="用名字或代号，留下属于这段关系的位置。" /><label className={styles.field}><span>怎么称呼 TA · 必填</span><input required maxLength={60} autoComplete="off" placeholder="例如：小林 / 朋友介绍的人" value={label} onChange={event => setLabel(event.target.value)} /></label></section><section className={`${styles.card} ${styles.formSection}`}><NumberedHeading number="02" title="基础资料 · 均可跳过" caption="填写你已经了解的部分，剩下的以后再补。" /><div className={styles.fields}>{pickers.map(picker => <label className={styles.field} key={picker.key}><span>{picker.label}</span><select value={fields[picker.key] || ""} onChange={event => setFields({ ...fields, [picker.key]: event.target.value })}><option value="">暂不了解</option>{picker.options.map(option => <option value={option} key={option}>{option}</option>)}</select></label>)}{[["city", "常住地", "例如：浙江 杭州"], ["occupation", "职业", "例如：教师 / 设计师"], ["lifestyle", "生活方式", "例如：周末喜欢户外"]].map(([key, title, placeholder]) => <label className={styles.field} key={key}><span>{title}</span><input maxLength={100} value={fields[key] || ""} placeholder={placeholder} onChange={event => setFields({ ...fields, [key]: event.target.value })} /></label>)}</div></section><section className={`${styles.card} ${styles.formSection}`}><NumberedHeading number="03" title="再补充几句 · 可选" caption="真实的细节，会让之后的建议更贴近你们。" /><div className={styles.fields}>{[["values", "TA 明确表达的期待或价值观"], ["boundaries", "TA 明确表达的边界"], ["notes", "备注与已确认经历"]].map(([key, title]) => <label className={styles.field} key={key}><span>{title}</span><textarea maxLength={800} value={fields[key] || ""} placeholder="没说过的可以留空" onChange={event => setFields({ ...fields, [key]: event.target.value })} /></label>)}</div></section><label className={styles.check}><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /><span><ShieldCheck size={15} className={styles.consentIcon} />确认保存我有权提供的资料，用于关系分析；尚未启用时同时启用档案，可随时修改或删除。</span></label></div></fieldset>{error && <div className={styles.error} role="alert">{error}{request.current && <p>提交资料已保留；再次保存会核对同一次建档，成功后可以继续编辑。</p>}{signedOut && <a className={styles.link} href="/login?return_to=%2Fperson-new">登录后继续</a>}</div>}<button type="submit" className={styles.primary} disabled={busy || !agreed || !label.trim()}>{busy ? "正在保存…" : request.current ? "核对并重试本次建档" : "保存并查看人物档案 →"}</button></form></div></main>;
}
