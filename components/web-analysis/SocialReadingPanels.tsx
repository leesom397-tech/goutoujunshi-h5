"use client";

import { useState } from "react";
import { BookOpen, BriefcaseBusiness, Camera, ChartNoAxesCombined, Check, CircleHelp, Clock3, Coffee, Copy, FileText, HandHeart, House, Layers3, MapPin, Megaphone, MessageCircle, Plane, Quote, Repeat2, ScanLine, Send, ShieldCheck, Smile, Sparkles, Trophy, UserRound, Users, type LucideIcon } from "lucide-react";
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

function StatisticsBars({ title, items, icon: Icon, tone }: { title: string; items: Json[]; icon: LucideIcon; tone: "teal" | "amber" }) {
  return <section className="srp-stat-group" data-tone={tone} aria-label={title}>
    <h3><Icon size={19}/>{title}</h3>
    {items.length ? <div className="srp-bars">{items.map((row, index) => {
      const label = text(row.label) || "未命名类别", RowIcon = categoryIcons[label] || Layers3;
      const total = count(row.total), amount = count(row.count), value = total === 0 ? null : percent(row.percent);
      return <div className="srp-bar-row" key={`${label}-${index}`}>
        <div className="srp-bar-heading"><span><RowIcon size={17}/>{label}</span><span className="srp-bar-value"><small>{amount !== null && total !== null ? `${amount} / ${total} 条` : "数量待确认"}</small><strong>{value === null ? "—" : `${value}%`}</strong></span></div>
        <div className="srp-track" aria-hidden="true"><span style={{ width: `${value ?? 0}%` }}/></div>
        <SourceEvidence value={row.evidence}/>
      </div>;
    })}</div> : <p className="srp-muted">这批材料没有可分类的{title === "文案表达" ? "文案" : "动态"}。</p>}
  </section>;
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
      <div className="srp-stat-grid"><StatisticsBars title="内容主题" items={content} icon={Layers3} tone="teal"/><StatisticsBars title="文案表达" items={copy} icon={MessageCircle} tone="amber"/></div>
      <div className="srp-stat-scope">
        {count(stats.total) !== null && count(stats.classified) !== null && count(stats.unclassified) !== null && <p><ScanLine size={16}/><span>已识别去重 {stats.total} 条，其中 {stats.classified} 条可分类，{stats.unclassified} 条未分类。</span></p>}
        {text(stats.scope) && <p><CircleHelp size={16}/><span>{stats.scope}</span></p>}
        {count(stats.copyTotal) !== null && <p><FileText size={16}/><span>文案表达：{stats.copyTotal} 条可分类文案；一条文案可有多种表达，纯照片或文字不清不计入。</span></p>}
      </div>
      {selfie && <section className="srp-selfie" aria-label="自拍统计"><div><Camera size={20}/><strong>自拍</strong><b>{selfiePercent === null ? "—" : `${selfiePercent}%`}</b></div>{count(selfie.known) !== null && selfie.known > 0 ? <p>{selfie.count} / {selfie.known} 条可判断动态；另有 {selfie.unknown} 条无法判断。</p> : <p>尚无可判断的动态{count(selfie.unknown) !== null ? `，${selfie.unknown} 条无法判断` : ""}。</p>}</section>}
    </section>}
    {posts.length > 0 && <section className="wa-card srp-card" aria-labelledby="social-timeline-title"><header className="srp-heading"><div><h2 id="social-timeline-title"><Clock3 size={22}/>动态时间线</h2><p className="srp-muted">{posts.length} 条动态 · 日期沿用截图标注。</p></div></header><ol className="srp-timeline">{posts.map((post, index) => <li key={index}><span className="srp-timeline-dot" aria-hidden="true"/><article><div className="srp-post-heading"><span>{text(post.date) || "日期未明确"}</span><small>第 {index + 1} 条</small></div>{text(post.content) && <p className="srp-post-content">{post.content}</p>}<SourceEvidence value={post.evidence}/>{(Array.isArray(post.contentTags) || Array.isArray(post.copyTags)) && <div className="srp-tags">{[...new Set([...(post.contentTags || []), ...(post.copyTags || [])].filter(item => typeof item === "string" && item.trim()))].map(label => <span key={label}>{label}</span>)}</div>}</article></li>)}</ol></section>}
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

/** Content and visible profile data only; interpretation and advice have their own reading steps. */
export function SocialContentPanel({ report }: { report: Json }) {
  if (report.moments) return <MomentsContent source={report.moments}/>;
  const basics = [...rows(report.profileBasics), ...rows(report.profileContext)];
  const facts = basics.length ? [] : rows(report.visibleFacts);
  return <div className="social-reading-panels"><section className="wa-card srp-card"><header className="srp-heading"><div><h2><UserRound size={22}/>主页里的可见画像</h2><p className="srp-muted">保留资料自述与原文依据。</p></div></header>{basics.length > 0 ? <dl className="srp-profile-grid">{basics.map((row, index) => { const Icon = basicIcons[row.field] || UserRound; return <div key={`${row.field}-${index}`}><dt><Icon size={18}/>{profileLabels[row.field] || text(row.field) || "资料线索"}</dt><dd>{text(row.value)}</dd><SourceEvidence value={row.evidence}/></div>; })}</dl> : facts.length ? <div className="srp-visible-facts">{facts.map((row, index) => <article key={index}><h3><ScanLine size={18}/>{text(row.title || row.dimension || row.item || row.category) || "可见线索"}</h3>{text(row.level) && <span className="srp-muted">{row.level}</span>}{[...new Set([row.meaning, row.reading, row.conclusion, row.style, row.valueHint].map(text).filter(Boolean))].map((value, detailIndex) => <p key={detailIndex}>{value}</p>)}<SourceEvidence value={row.evidence}/>{text(row.check) && <p>核实：{row.check}</p>}</article>)}</div> : <p className="srp-muted">这组资料尚未返回可核对的基础画像。</p>}<CommunicationProfile value={report.communicationApproach}/></section></div>;
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
