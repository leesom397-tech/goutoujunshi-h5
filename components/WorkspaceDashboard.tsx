"use client";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, ScanLine, Images, ScanFace, MessageCircle, AudioLines, Users, Sparkles, Clock3, FileText, ShieldCheck, RefreshCw, Coins } from "lucide-react";

import {KnowledgeEvidence} from "./ProductHome";
import "./workspace-dashboard.css";


export type WorkspaceData = {
  archive: { enabled: boolean; paused: boolean; pendingFacts: number; selfReady: boolean };
  people: { id: string; label: string; stage: string; updatedAt: number }[];
  reports: { id: string; label: string; summary: string; subjectId: string | null; createdAt: number; expiresAt: number }[];
  peopleTotal: number; total: number; page: number; pageSize: number;
  pendingFollowups?: number;
  followups?: { subjectId: string; label: string; reportId: string; action: string; suggestedAt: number | null; outcome: string | null; outcomeLabel: string; recordedAt: number | null; sourceAvailable: boolean; reportAvailable: boolean }[];
};
export function shortDate(time: number) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(time)); }
const actions = [
  { href: "/analyze?mode=chat", icon: ScanLine, title: "聊天截图", description: "看语气、意图与下一句", tone: "teal" },
  { href: "/analyze?mode=moments", icon: Images, title: "朋友圈分析", description: "从动态里了解一个人", tone: "amber" },
  { href: "/analyze?mode=social", icon: ScanFace, title: "社交主页", description: "整理资料与适配线索", tone: "green" },
  { href: "/chat", icon: MessageCircle, title: "问问军师", description: "把眼前的困惑说清楚", tone: "teal" },
  { href: "/voice", icon: AudioLines, title: "语音聊聊", description: "开口说，边聊边梳理", tone: "amber" },
  { href: "/archive", icon: Users, title: "人物档案", description: "查看记录、趋势与人物资料", tone: "green" },
];

export function WorkspaceDashboard({ name, owner, balance, active, admin }: { name: string; owner: string; balance: number | null; active: boolean | null; admin: boolean }) {
  const [data, setData] = useState<WorkspaceData | null>(null), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError("");
    fetch("/api/web/workspace", { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json() as WorkspaceData & { error?: string }; if (!response.ok) throw Error(value.error || "暂时无法读取工作台。");
      if (!controller.signal.aborted) setData(value);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [owner, revision]);
  const next = data?.archive.paused ? { label: "人物档案已暂停", text: "准备继续记录时，可以在人物页恢复。", href: "/archive", action: "管理档案" }
    : data?.archive.pendingFacts ? { label: `${data.archive.pendingFacts} 条资料等你核对`, text: "确认准确的线索，让后续建议更了解你们。", href: "/archive?review=pending", action: "去核对线索" }
    : data?.reports.length ? { label: "接着看看上次的分析", text: "回到具体的依据与建议，想聊的部分可以继续问。", href: `/report?id=${encodeURIComponent(data.reports[0].id)}`, action: "继续上次分析" }
    : { label: "先从最近的一段聊天开始", text: "上传截图，确认哪边是你，就能看到判断依据与回复建议。", href: "/analyze?mode=chat", action: "开始第一次分析" };
  return <div className="desk" data-testid="member-workspace">
    <section className="desk-hero">
      <div className="desk-hero-copy"><span className="desk-eyebrow"><span/> 我的关系空间</span><h1>工作台</h1><p>{name}，选择功能或继续最近的分析。</p><div className="desk-hero-actions"><a className="desk-primary" href={data?.reports[0] ? `/report?id=${encodeURIComponent(data.reports[0].id)}` : "/analyze?mode=chat"}>{data?.reports[0] ? <Clock3 size={18}/> : <ScanLine size={18}/>} {data?.reports[0] ? "继续上次分析" : "开始新分析"} <ArrowUpRight size={18}/></a>{!!data?.reports.length && <a className="desk-secondary" href="/analyze?mode=chat">上传新材料 <ArrowRight size={16}/></a>}</div></div>

    </section>
    <section className="desk-metrics" aria-label="我的空间概况"><a href="/archive"><Users size={19}/><span><strong>{data ? data.peopleTotal : "—"}</strong><small>人物档案</small></span><ArrowUpRight size={16}/></a><a href="/reports"><FileText size={19}/><span><strong>{data ? data.total : "—"}</strong><small>已保存的分析报告</small></span><ArrowUpRight size={16}/></a><a href="/account"><Coins size={19}/><span><strong>{balance ?? "—"}</strong><small>可用积分</small></span><ArrowUpRight size={16}/></a></section>
    {active === false && <div className="desk-access"><ShieldCheck size={20}/><div><b>先准备资料，开通后就能分析</b><p>联系客服确认服务与积分；人物档案可以先建立。</p></div><a href="/account#contact">联系开通 <ArrowRight size={16}/></a></div>}
    <KnowledgeEvidence/><section className="desk-actions-section"><div className="desk-heading"><div><span className="desk-eyebrow">此刻想做什么</span><h2>从一个问题开始</h2></div><span>选择材料，或者直接聊聊</span></div><div className="desk-actions">{actions.map(({ href, icon: Icon, title, description, tone }) => <a href={href} key={href} data-tone={tone}><span className="desk-action-icon"><Icon size={23} strokeWidth={1.7}/></span><span><b>{title}</b><small>{description}</small></span><ArrowUpRight className="desk-action-arrow" size={16}/></a>)}</div></section>
    {error ? <div className="desk-error" role="alert"><span>{error}</span><button onClick={() => setRevision(value => value + 1)}><RefreshCw size={16}/>重新读取</button></div> : !data ? <div className="desk-loading" role="status"><span/><span/><span/><p>正在整理你的最近记录…</p></div> : <div className="desk-columns">
      <div className="desk-main"><section className="desk-panel"><div className="desk-heading"><h2><Clock3 size={20}/> 最近分析报告</h2><a href="/reports">查看全部 <ArrowRight size={15}/></a></div>{data.reports.length ? <div className="desk-report-list">{data.reports.slice(0, 4).map(report => <a key={report.id} href={`/report?id=${report.id}`}><span className="desk-report-icon"><FileText size={20}/></span><span className="desk-report-copy"><b>{report.summary}</b><small>{report.label || "未关联人物"} · {shortDate(report.createdAt)} 分析</small></span><ArrowUpRight size={17}/></a>)}</div> : <div className="desk-empty"><span className="desk-empty-icon"><FileText size={25}/></span><h3>{data.archive.paused ? "已暂停展示历史分析" : "让第一份分析，从这里开始"}</h3><p>{data.archive.paused ? "恢复档案后，再继续回看和跟进。" : "完成的聊天报告会在这里保留入口，方便接着看、继续问。"}</p><a href={data.archive.paused ? "/archive" : "/analyze?mode=chat"}>{data.archive.paused ? "管理档案" : "上传聊天截图"}<ArrowRight size={15}/></a></div>}<p className="desk-panel-note">分析报告长期保存，可在「历史」继续查看。</p></section>
      <section className="desk-panel"><div className="desk-heading"><h2><Users size={20}/> 最近的人物</h2><a href="/archive">打开档案 <ArrowRight size={15}/></a></div>{data.people.length ? <div className="desk-people">{data.people.slice(0, 4).map((person, index) => <a href={`/archive?subjectId=${person.id}`} key={person.id}><span className="desk-avatar" data-tone={index % 3}>{person.label.slice(0, 1)}</span><span><b>{person.label}</b><small>{person.stage || "关系阶段待记录"}</small></span><ArrowUpRight size={16}/></a>)}</div> : <div className="desk-empty compact"><Users size={23}/><p>{data.archive.paused ? "档案暂停期间不展示人物。" : "给对方一个称呼，让每次分析都能接着上次。"}</p><a href={data.archive.paused ? "/archive" : "/person-new"}>{data.archive.paused ? "查看档案设置" : "建立第一个人物"}<ArrowRight size={15}/></a></div>}</section></div>
      <aside className="desk-aside"><section className="desk-next"><span className="desk-eyebrow"><Sparkles size={15}/> 下一步值得做</span><h2>{next.label}</h2><p>{next.text}</p><a href={next.href}>{next.action}<ArrowRight size={17}/></a></section>{admin && <a className="desk-admin" href="/admin/credits"><ShieldCheck size={19}/><span><b>会员管理后台</b><small>会员、积分与权限</small></span><ArrowUpRight size={17}/></a>}<p className="desk-privacy"><ShieldCheck size={16}/> 你决定保存什么，也可以随时暂停或删除。</p></aside>
    </div>}
  </div>;
}
