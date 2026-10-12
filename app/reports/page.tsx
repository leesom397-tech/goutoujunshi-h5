"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, FileText, Search, ScanLine, Clock3, RefreshCw, Users } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import ui from "@/components/AuroraUI.module.css";
import { AccountNotice, useAccount } from "@/components/web-analysis/client";
import { shortDate, type WorkspaceData } from "@/components/WorkspaceDashboard";
import "@/components/web-analysis/web-analysis.css";
import styles from "./ReportsPage.module.css";
export default function ReportsPage() {
  const account = useAccount(), owner = account.account?.account?.userId;
  const [query, setQuery] = useState(""), [page, setPage] = useState(1), [revision, setRevision] = useState(0), [data, setData] = useState<WorkspaceData | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  useEffect(() => { setQuery(""); setPage(1); setData(null); setError(""); }, [owner]);
  useEffect(() => {
    if (!owner) return;
    const abort = new AbortController(); setLoading(true); setError(""); setData(null);
    const timer = setTimeout(() => { fetch(`/api/web/workspace?q=${encodeURIComponent(query)}&page=${page}`, { cache: "no-store", signal: abort.signal }).then(async response => {
      const value = await response.json() as WorkspaceData & { error?: string }; if (!response.ok) throw Error(value.error || "报告暂未取回。");
      if (!abort.signal.aborted) setData(value);
    }).catch(cause => { if (!abort.signal.aborted) setError(cause.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); }); }, query ? 200 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [owner, query, page, revision]);
  return <div className={ui.page}><WebNav/><main className={`${ui.wrap} ${styles.content}`}><AuroraPageHero eyebrow="接着上次，继续了解" title="我的聊天报告" description="回看判断与依据，带着同一份材料继续追问。"><a className={ui.primary} href="/analyze?mode=chat"><ScanLine size={18}/> 新分析</a></AuroraPageHero><AccountNotice state={account}/>{owner && <><div className={styles.toolbar}><label><Search size={19}/><span className={styles.srOnly}>搜索人物或报告内容</span><input type="search" maxLength={80} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="搜索人物称呼或报告结论"/></label><span>{data ? `${data.total} 份可回看` : "正在读取…"}</span></div><div className={styles.retention}><Clock3 size={17}/><span>报告保留 7 天，列表仅展示仍在保留期内的聊天分析。</span><a href="/archive"><Users size={16}/>朋友圈与社交资料</a></div>{error && <div className={styles.message} role="alert"><p>{error}</p><button onClick={() => setRevision(value => value + 1)}><RefreshCw size={16}/>重新读取</button></div>}{loading && <div className={styles.loading} role="status">正在查找报告…</div>}{data && !loading && (data.reports.length ? <div className={styles.grid}>{data.reports.map(report => <a className={styles.item} key={report.id} href={`/report?id=${report.id}`}><div className={styles.itemTop}><span><FileText size={19}/> 聊天分析</span><small>{shortDate(report.createdAt)}</small></div><h2>{report.summary}</h2><p>{report.label || "本次未关联人物"}</p><div className={styles.itemBottom}><small>{shortDate(report.expiresAt)} 到期</small><span>打开报告 <ArrowUpRight size={16}/></span></div></a>)}</div> : <div className={styles.empty}><div className={styles.emptyMark} aria-hidden="true"><FileText size={32}/></div><h2>{data.archive.paused ? "档案已暂停" : query ? "没有找到相关报告" : "还没有可回看的报告"}</h2><p>{data.archive.paused ? "恢复档案后，再继续查看历史分析。" : query ? "换一个人物称呼或关键词试试。" : "完成聊天截图分析后，报告会出现在这里；到期的报告不会继续显示。"}</p><a href={data.archive.paused ? "/archive" : "/analyze?mode=chat"}>{data.archive.paused ? "管理档案" : "开始聊天分析"}<ArrowRight size={16}/></a></div>)}{data && data.total > data.pageSize && <nav className={styles.pagination} aria-label="报告分页"><button disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}><ArrowLeft size={16}/>上一页</button><span>第 {page} / {Math.ceil(data.total / data.pageSize)} 页</span><button disabled={page * data.pageSize >= data.total || loading} onClick={() => setPage(value => value + 1)}>下一页<ArrowRight size={16}/></button></nav>}</>}</main></div>;
}
