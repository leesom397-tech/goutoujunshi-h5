"use client";

import { useState } from "react";
import { ArrowRight, BookOpen, BriefcaseBusiness, Camera, ChartNoAxesCombined, Check, CircleHelp, Clock3, Coffee, Copy, Eye, FileText, HandHeart, House, Layers3, Lightbulb, MapPin, Megaphone, MessageCircle, Plane, Quote, Repeat2, ScanLine, Send, ShieldCheck, Smile, Sparkles, Trophy, UserRound, Users, type LucideIcon } from "lucide-react";
import type { Json } from "./client";
import { profileLabels } from "./report-data";
import "./social-reading-panels.css";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const rows = (value: unknown): Json[] => Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) : [];
const count = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const percent = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const categoryIcons: Record<string, LucideIcon> = { 工作: BriefcaseBusiness, 自拍: Camera, 家庭: House, 旅行: Plane, 社交: Users, 日常: Coffee, 转发: Repeat2, 其他: Layers3, 生活记录: BookOpen, 成就展示: Trophy, 情绪表达: Smile, 观点态度: MessageCircle, 互动提问: CircleHelp, 推广分享: Megaphone };
const basicIcons: Record<string, LucideIcon> = { ageRange: UserRound, city: MapPin, education: BookOpen, occupation: BriefcaseBusiness, relationshipStatus: HandHeart, childrenPlan: House, lifestyle: Coffee, stage: Users, howMet: MessageCircle, values: Sparkles, boundaries: ShieldCheck };

function SourceEvidence({ value }: { value: unknown }) {
  const evidence = text(value);
  return evidence ? <p className="srp-evidence"><Quote size={15}/><span>依据：{evidence}</span></p> : null;
}

function StatisticsBars({ title, items, icon: Icon, tone, source }: { title: string; items: Json[]; icon: LucideIcon; tone: "teal" | "amber"; source: Json }) {
  const visible = items.filter(row => count(row.count) !== null && row.count > 0), totalMentions = visible.reduce((sum, row) => sum + row.count, 0);
  const postTotal = Math.max(0, ...items.map(row => count(row.total) ?? 0));
  const colors = tone === "teal" ? ["#397f72", "#719687", "#a4b7a1", "#bac8b5", "#8f7857", "#d5bf98", "#c0a189", "#e6dacc"] : ["#b38b4c", "#d0a967", "#a76b48", "#dfc594", "#87735c", "#ebdabc", "#c19872"];
  const [selectedLabel, setSelectedLabel] = useState("");
  const selected = visible.find(row => row.label === selectedLabel) || visible[0];
  const relatedPosts = selected ? rows(source.posts).filter(post => [...(post.contentTags || []), ...(post.copyTags || [])].includes(selected.label)) : [];
  const interpretation = selected ? [...rows(source.themes), ...rows(source.statistics?.summaries)].find(row => text(row.title).includes(selected.label)) : null;
  let offset = 0;
  return <section className="srp-stat-group" data-tone={tone} aria-label={title}>
    <h3><Icon size={19}/>{title}</h3>
    {visible.length ? <><div className="srp-composition-layout"><div className="srp-donut"><svg viewBox="0 0 190 190" role="img" aria-label={`${title}，按标签出现次数占比：${visible.map(row => `${row.label} ${Math.round(row.count / totalMentions * 100)}%`).join('；')}`}><circle cx="95" cy="95" r="73" fill="none" stroke="#eee5d8" strokeWidth="24"/>{visible.map((row, index) => { const size = row.count / totalMentions * 100, start = offset; offset += size; return <circle key={index} cx="95" cy="95" r="73" fill="none" stroke={colors[index % colors.length]} strokeWidth={selected?.label === row.label ? "29" : "24"} pathLength="100" strokeDasharray={`${size} ${100 - size}`} strokeDashoffset={-start} transform="rotate(-90 95 95)"><title>{row.label} · {row.count} 次</title></circle>; })}</svg><div><strong>{totalMentions}</strong><span>{totalMentions > postTotal ? "次主题标签" : "条可分类"}</span></div></div><div className="srp-bars">{visible.map((row, index) => {
      const label = text(row.label) || "未命名类别", RowIcon = categoryIcons[label] || Layers3;
      const total = count(row.total), amount = count(row.count), value = totalMentions ? Math.round(row.count / totalMentions * 100) : null;
      return <button type="button" className="srp-bar-row" aria-pressed={selected?.label === row.label} onClick={() => setSelectedLabel(row.label)} key={`${label}-${index}`}>
        <div className="srp-bar-heading"><span><i className="srp-chart-dot" style={{ background: colors[index % colors.length] }}/><RowIcon size={17}/>{label}</span><span className="srp-bar-value"><strong>{value === null ? "—" : `${value}%`}</strong></span></div>
        <div className="srp-track" aria-hidden="true"><span style={{ width: `${value ?? 0}%`, background: colors[index % colors.length] }}/></div><small className="srp-legend-count">{amount !== null && total !== null ? `${amount} / ${total} 条动态涉及` : `${amount} 次标签`}</small>
      </button>;
    })}</div></div><p className="srp-ring-note">{totalMentions > postTotal ? `主题标签构成 · 一条动态可有多个标签；圆盘按 ${totalMentions} 次标签计算比例。` : "圆盘按本批已分类内容的数量计算比例。"} 点选图例看依据。</p>{selected && <div className="srp-chart-selection" aria-live="polite"><strong><Quote size={16}/>{selected.label} · {selected.count} 条相关动态</strong><p>{interpretation?.meaning || interpretation?.reading || (relatedPosts.length ? relatedPosts.map(post => post.content).slice(0, 2).join("；") : "以下是这一类内容的原始依据。")}</p><SourceEvidence value={selected.evidence || relatedPosts.map(post => post.evidence).slice(0, 2).join("；")}/>{interpretation?.alternative && <p className="srp-muted">另一种解释：{interpretation.alternative}</p>}</div>}</> : <p className="srp-muted">这批材料没有可分类的{title === "文案表达" ? "文案" : "动态"}。</p>}
  </section>;
}

function ReadingConclusion({ value, label = "这些内容可能说明什么" }: { value: Json | null | undefined; label?: string }) {
  if (!value || !text(value.conclusion || value.reading)) return null;
  return <article className="srp-conclusion"><span><Lightbulb size={18}/>{label}</span>{text(value.title) && <h3>{value.title}</h3>}<p>{value.conclusion || value.reading}</p><SourceEvidence value={value.evidence || value.support}/>{text(value.alternative) && <p className="srp-reading-alternative"><Eye size={16}/><span>也可能：{value.alternative}</span></p>}</article>;
}

function postReading(post: Json, source: Json) {
  if (text(post.inference || post.reading)) return { conclusion: text(post.inference || post.reading), alternative: text(post.alternative) };
  const excerpt = text(post.content).slice(0, 16);
  if (excerpt.length < 5) return null;
  const related = [...rows(source.hypotheses), ...rows(source.behaviorClues)].find(row => (text(row.quote).length >= 5 && text(post.content).includes(text(row.quote))) || text(row.evidence).includes(excerpt));
  return related ? { title: related.title || related.dimension, conclusion: related.possibility || related.reading, alternative: related.alternative } : null;
}

function MomentsContent({ source }: { source: Json }) {
  const stats = source.statistics, posts = rows(source.posts);
  // The full lists retain zero-count categories. Older reports may only carry visible rows.
  const content = rows(stats?.content).length ? rows(stats.content) : rows(stats?.visibleContent);
  const copy = rows(stats?.copy).length ? rows(stats.copy) : rows(stats?.visibleCopy);
  const selfie = stats?.selfie;
  const selfiePercent = count(selfie?.known) === 0 ? null : percent(selfie?.percent);
  return <div className="social-reading-panels">
    {stats && <section className="wa-card srp-card" aria-labelledby="social-statistics-title">
      <header className="srp-heading"><div><h2 id="social-statistics-title"><ChartNoAxesCombined size={22}/>这批朋友圈的内容构成</h2><p className="srp-muted">按本次看得见的动态统计。</p></div>{count(stats.total) !== null && <div className="srp-total"><strong>{stats.total}</strong><span>条已识别动态</span></div>}</header>
      <div className="srp-stat-grid"><StatisticsBars title="内容主题" items={content} icon={Layers3} tone="teal" source={source}/><StatisticsBars title="文案表达" items={copy} icon={MessageCircle} tone="amber" source={source}/></div>
      <ReadingConclusion value={source.compositionReading || rows(stats.summaries)[0]}/>
      <div className="srp-stat-scope">
        {count(stats.total) !== null && count(stats.classified) !== null && count(stats.unclassified) !== null && <p><ScanLine size={16}/><span>已识别去重 {stats.total} 条，其中 {stats.classified} 条可分类，{stats.unclassified} 条未分类。</span></p>}
        {text(stats.scope) && <p><CircleHelp size={16}/><span>{stats.scope}</span></p>}
        {count(stats.copyTotal) !== null && <p><FileText size={16}/><span>文案表达：{stats.copyTotal} 条可分类文案；一条文案可有多种表达，纯照片或文字不清不计入。</span></p>}
      </div>
      {selfie && <section className="srp-selfie" aria-label="自拍统计"><div><Camera size={20}/><strong>自拍</strong><b>{selfiePercent === null ? "—" : `${selfiePercent}%`}</b></div>{count(selfie.known) !== null && selfie.known > 0 ? <p>{selfie.count} / {selfie.known} 条可判断动态；另有 {selfie.unknown} 条无法判断。</p> : <p>尚无可判断的动态{count(selfie.unknown) !== null ? `，${selfie.unknown} 条无法判断` : ""}。</p>}</section>}
    </section>}
    {posts.length > 0 && <section className="wa-card srp-card" aria-labelledby="social-timeline-title"><header className="srp-heading"><div><h2 id="social-timeline-title"><Clock3 size={22}/>动态时间线</h2><p className="srp-muted">{posts.length} 条动态 · 日期沿用截图标注。</p></div></header><ReadingConclusion value={source.timelineReading} label="连起来看，可能有什么变化"/><ol className="srp-timeline">{posts.map((post, index) => <li key={index}><span className="srp-timeline-dot" aria-hidden="true"/><article><div className="srp-post-heading"><span>{text(post.date) || "日期未明确"}</span><small>第 {index + 1} 条</small></div>{text(post.content) && <p className="srp-post-content">{post.content}</p>}<SourceEvidence value={post.evidence}/>{(Array.isArray(post.contentTags) || Array.isArray(post.copyTags)) && <div className="srp-tags">{[...new Set([...(post.contentTags || []), ...(post.copyTags || [])].filter(item => typeof item === "string" && item.trim()))].map(label => <span key={label}>{label}</span>)}</div>}<ReadingConclusion value={postReading(post, source)} label="结合这条动态的推测"/></article></li>)}</ol></section>}
    {!stats && !posts.length && <section className="wa-card srp-card"><h2><ChartNoAxesCombined size={22}/>内容图表</h2><p className="srp-muted">本次未返回可统计的动态数据。</p></section>}
  </div>;
}

function CommunicationProfile({ value }: { value: unknown }) {
  if (!value) return null;
  if (typeof value === "string") return <section className="srp-profile-communication"><h3><MessageCircle size={19}/>沟通线索</h3><p>{value}</p></section>;
  const items = Array.isArray(value) ? rows(value) : typeof value === "object" ? [value as Json] : [];
  const labels: Record<string, string> = { summary: "表达特点", style: "表达方式", reading: "可见线索", description: "可见线索", text: "可见线索", value: "可见线索", attitude: "态度", emotion: "回应", pace: "节奏", avoid: "少做", adjustWhen: "何时调整" };
  return items.length ? <section className="srp-profile-communication"><h3><MessageCircle size={19}/>沟通线索</h3>{items.map((item, index) => <article key={index}>{text(item.title) && <h4>{item.title}</h4>}{Object.entries(item).filter(([key, value]) => !["title", "evidence"].includes(key) && text(value)).map(([key, value]) => <p key={key}><strong>{labels[key] || "可见线索"}：</strong>{text(value)}</p>)}<SourceEvidence value={item.evidence}/></article>)}</section> : null;
}

function profileMeaning(row: Json, report: Json) {
  if (text(row.inference || row.meaning)) return text(row.inference || row.meaning);
  const linked = rows(report.hypotheses).find(item => text(row.value).length > 4 && text(item.evidence).includes(text(row.value)));
  if (linked) return text(linked.possibility);
  if (row.field === "relationshipStatus") {
    if (/不.*(?:结婚|婚姻)|暂不.*(?:结婚|恋爱)/.test(row.value)) return "对方已经表达了关系边界；先对照你的期待，不把它当成等待你去改变的态度。";
    if (/认真|长期|稳定|结婚|婚姻/.test(row.value)) return "有认真发展关系的自述意向。适合继续了解相处节奏与未来安排；具体对象和时间表仍要通过互动确认。";
    return "这是对方对关系现状或目标的自述，可以直接作为后续交流的起点。";
  }
  if (row.field === "boundaries") return "相处时留出对方明确需要的空间，邀请和联系频率可以直接商量。";
  if (row.field === "values") return "这些是对方主动强调的相处原则，可以通过具体选择和实际行动了解是否一致。";
  if (row.field === "lifestyle") return "这些兴趣和生活场景能转成具体话题或见面安排，比泛泛聊日常更容易展开。";
  if (row.field === "city" && report.knownContext?.sameCity) return "你已确认双方同城，可以把重点放到作息、常去区域与方便见面的时间。";
  return "";
}

/** Keep the original self-description beside its practical relationship implication. */
export function SocialContentPanel({ report }: { report: Json }) {
  if (report.moments) return <MomentsContent source={report.moments}/>;
  const basics = [...rows(report.profileBasics), ...rows(report.profileContext)];
  const facts = basics.length ? [] : rows(report.visibleFacts);
  return <div className="social-reading-panels"><section className="wa-card srp-card"><header className="srp-heading"><div><h2><UserRound size={22}/>主页画像与相处启发</h2><p className="srp-muted">把对方怎么介绍自己，转成你能用上的了解方向。</p></div></header>{basics.length > 0 ? <dl className="srp-profile-grid">{basics.map((row, index) => { const Icon = basicIcons[row.field] || UserRound, meaning = profileMeaning(row, report); return <div key={`${row.field}-${index}`} data-important={row.field === "relationshipStatus" || row.field === "boundaries"}><dt><Icon size={18}/>{row.field === "relationshipStatus" ? "婚恋状态与目标" : row.field === "stage" ? "当前阶段线索" : profileLabels[row.field] || text(row.field) || "资料线索"}</dt><dd>{text(row.value)}</dd><SourceEvidence value={row.evidence}/>{meaning && <div className="srp-profile-meaning"><strong><Lightbulb size={16}/>相处启发</strong><p>{meaning}</p></div>}</div>; })}</dl> : facts.length ? <div className="srp-visible-facts">{facts.map((row, index) => <article key={index}><h3><ScanLine size={18}/>{text(row.title || row.dimension || row.item || row.category) || "可见线索"}</h3>{text(row.level) && <span className="srp-muted">{row.level}</span>}{[...new Set([row.meaning, row.reading, row.conclusion, row.style, row.valueHint].map(text).filter(Boolean))].map((value, detailIndex) => <p key={detailIndex}>{value}</p>)}<SourceEvidence value={row.evidence}/>{text(row.check) && <p>核实：{row.check}</p>}</article>)}</div> : <p className="srp-muted">这组资料尚未返回可核对的基础画像。</p>}<CommunicationProfile value={report.communicationApproach}/></section></div>;
}

/** Advice and complete source evidence stay visible; copying is the only action here. */
export function SocialNextAdvice({ report }: { report: Json }) {
  const source = report.moments || report, approach = source.approach, starters = rows(source.starters);
  const [copied, setCopied] = useState<number | null>(null), [copyError, setCopyError] = useState("");
  async function copyMessage(value: string, index: number) {
    try { await navigator.clipboard.writeText(value); setCopied(index); setCopyError(""); }
    catch { setCopyError("复制没有完成，可以选中这句话手动复制。"); }
  }
  const fields: [string, string, LucideIcon][] = [["attitude", "交流态度", HandHeart], ["emotion", "怎样回应", MessageCircle], ["pace", "聊天节奏", Clock3], ["avoid", "少做什么", ShieldCheck], ["adjustWhen", "何时调整", Repeat2]];
  if (!approach && !starters.length) return null;
  return <div className="social-reading-panels">
    {approach && <section className="wa-card srp-card"><h2><HandHeart size={22}/>怎么相处，怎么聊</h2><dl className="srp-advice-grid">{fields.filter(([key]) => text(approach[key])).map(([key, label, Icon]) => <div key={key}><dt><Icon size={18}/>{label}</dt><dd>{approach[key]}</dd></div>)}</dl><SourceEvidence value={approach.evidence}/></section>}
    {starters.length > 0 && <section className="wa-card srp-card"><h2><Send size={22}/>选一句自然地接着聊</h2><div className="srp-starters">{starters.map((item, index) => <article key={index}><header><span>{text(item.topic) || `开场句 ${index + 1}`}</span>{text(item.message) && <button type="button" onClick={() => void copyMessage(item.message, index)}>{copied === index ? <Check size={16}/> : <Copy size={16}/>}<span>{copied === index ? "已复制" : "复制这句话"}</span></button>}</header>{text(item.message) && <blockquote>{item.message}</blockquote>}{text(item.reason) && <p>{item.reason}</p>}<SourceEvidence value={item.evidence}/></article>)}</div><span className="srp-copy-status" role="status">{copyError || (copied !== null ? `已复制第 ${copied + 1} 句话` : "")}</span></section>}
  </div>;
}
