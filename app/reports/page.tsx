"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, BookmarkCheck, FileText, History, Images, RefreshCw, ScanFace, ScanLine, Search } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import ui from "@/components/AuroraUI.module.css";
import { AccountNotice, useAccount, api } from "@/components/web-analysis/client";
import { shortDate } from "@/components/WorkspaceDashboard";
import "@/components/web-analysis/web-analysis.css";
import styles from "./ReportsPage.module.css";
type SavedReport = { format?:string; id: string; kind: "chat" | "moments" | "social"; label: string; summary: string; createdAt: number; imageCount?: number; analysisScope?: string; captureKind?: string; generatedAt?: string; supplementOf?: { reportId: string; generatedAt?: string; scope: string } };
type ReportList = { reports: SavedReport[]; total: number; page: number; pageSize: number };
const kinds = { chat: { label: "聊天分析", icon: ScanLine }, moments: { label: "朋友圈分析", icon: Images }, social: { label: "社交主页", icon: ScanFace } };
export default function ReportsPage() {
  const account = useAccount(), owner = account.account?.account?.userId;
  const [query, setQuery] = useState(""), [page, setPage] = useState(1), [revision, setRevision] = useState(0), [data, setData] = useState<ReportList | null>(null), [dataOwner, setDataOwner] = useState<string | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const currentData = owner && dataOwner === owner ? data : null;
  useEffect(() => { setQuery(""); setPage(1); setData(null); setDataOwner(null); setError(""); }, [owner]);
  useEffect(() => {
    if (!owner) return;
    const abort = new AbortController(); setLoading(true); setError(""); setData(null);
    const timer = setTimeout(() => { api(`/api/web/report/list?q=${encodeURIComponent(query.trim())}&page=${page}`, undefined, abort.signal).then(raw => {
      const value = raw as ReportList;
      if (!Array.isArray(value.reports) || typeof value.total !== "number" || !(value.pageSize > 0)) throw Error("报告列表未完整返回，请重新读取。");
      if (!abort.signal.aborted) { setData(value); setDataOwner(owner); }
    }).catch(cause => { if (!abort.signal.aborted) setError(cause.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); }); }, query ? 200 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [owner, query, page, revision]);
  return <div className={ui.page}><WebNav/><main className={`${ui.wrap} ${styles.content}`}>
    <AuroraPageHero eyebrow="每一次分析，都可以接着看" title="分析记录" description="聊天、朋友圈和社交主页的分析统一保存在这里，随时回来继续查看。"><a className={ui.primary} href="/analyze?mode=chat"><ScanLine size={18}/>开始新分析</a></AuroraPageHero>
    {account.loading && !owner && <p role="status">正在确认登录状态…</p>}
    {account.unauthorized && <section className={styles.empty}><div className={styles.emptyMark} aria-hidden="true"><FileText size={32}/></div><h2>登录后查看分析记录</h2><p>完成一次分析后，判断会留在这里。</p><a href={`/login?return_to=${encodeURIComponent("/reports")}`}>登录并继续 <ArrowRight size={16}/></a></section>}
    {!account.loading && !account.unauthorized && <AccountNotice state={account}/>}{owner && <>
      <div className={styles.retention}><BookmarkCheck size={20}/><span><strong>报告长期保存</strong>完成后自动保存到当前账号，由你决定何时删除。原截图不归档。</span></div>
      <div className={styles.toolbar}><label><Search size={19}/><span className={styles.srOnly}>搜索人物或报告内容</span><input type="search" maxLength={80} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="搜索人物称呼或分析内容"/></label><span>{currentData ? <><b>{currentData.total}</b> 份{query.trim() ? "相关报告" : "已保存报告"}</> : loading ? "正在读取…" : "分析记录"}</span></div>
      {error && <div className={styles.message} role="alert"><p>{error}</p><button type="button" onClick={() => setRevision(value => value + 1)}><RefreshCw size={16}/>重新读取</button></div>}{loading && !currentData && <div className={styles.loading} role="status"><History size={22}/>正在查找报告…</div>}
      {currentData && !loading && (currentData.reports.length ? <div className={styles.grid}>{currentData.reports.map(report => { const type = report.analysisScope === "supplement" ? { label: "补充解读", icon: ScanLine } : report.analysisScope === "fullHistory" ? { label: report.captureKind === "moments" ? "完整朋友圈报告" : "完整关系报告", icon: FileText } : report.format==="risk"?{label:"关系提醒",icon:FileText}:report.format==="import"?{label:"导入聊天",icon:FileText}:kinds[report.kind] || kinds.chat, Icon = type.icon; return <a className={styles.item} key={report.id} href={`/report?id=${encodeURIComponent(report.id)}`} data-kind={report.kind}><div className={styles.itemTop}><span><Icon size={19}/>{type.label}</span><small>{shortDate(report.createdAt)}</small></div><h2>{report.summary || `${type.label}报告`}</h2><p>{report.label || "本次未关联人物"}{report.imageCount && report.imageCount > 1 ? ` · ${report.imageCount} 张截图` : ""}</p><div className={styles.itemBottom}><small><BookmarkCheck size={14}/>已保存</small><span>打开报告 <ArrowUpRight size={16}/></span></div></a>; })}</div> : <div className={styles.empty}><div className={styles.emptyMark} aria-hidden="true"><FileText size={32}/></div><h2>{query ? "没有找到相关报告" : "还没有已保存的报告"}</h2><p>{query ? "换一个人物称呼或关键词试试。" : "完成一次分析后，报告会自动保存在这里。以后打开首页，点击「记录」就能找回。"}</p>{query ? <button type="button" onClick={() => { setQuery(""); setPage(1); }}>查看全部报告<ArrowRight size={16}/></button> : <a href="/analyze?mode=chat">开始第一次分析<ArrowRight size={16}/></a>}</div>)}
      {currentData && currentData.total > currentData.pageSize && <nav className={styles.pagination} aria-label="报告分页"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}><ArrowLeft size={16}/>上一页</button><span>第 {page} / {Math.ceil(currentData.total / currentData.pageSize)} 页</span><button type="button" disabled={page * currentData.pageSize >= currentData.total || loading} onClick={() => setPage(value => value + 1)}>下一页<ArrowRight size={16}/></button></nav>}
    </>}</main></div>;
}
