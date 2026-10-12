"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookmarkCheck, ScanLine, Trash2 } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import ui from "@/components/AuroraUI.module.css";
import { AccountNotice, ErrorNotice, api, message, useAccount, type Json } from "@/components/web-analysis/client";
import { ChatReport, SocialReport } from "@/components/web-analysis/ReportView";
import { mergeChatReports } from "@/components/web-analysis/report-data";
import "@/components/web-analysis/web-analysis.css";
import styles from "./ReportPage.module.css";
export default function ReportPage() {
  const account = useAccount(), owner = account.account?.account?.userId;
  const [saved, setSaved] = useState<Json | null>(null), [reportOwner, setReportOwner] = useState<string | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [deleting, setDeleting] = useState(false), generation = useRef(0);
  const current = owner && owner === reportOwner ? saved : null;
  const kind = current?.kind === "moments" ? "moments" : current?.kind === "social" ? "social" : "chat";
  const title = kind === "moments" ? "朋友圈分析报告" : kind === "social" ? "社交主页分析报告" : "聊天分析报告";
  async function load() {
    const ticket = ++generation.current, scope = owner; if (!scope) return;
    setLoading(true); setError(""); setSaved(null);
    try {
      const id = new URLSearchParams(window.location.search).get("id");
      if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("报告编号无效，请返回历史报告重新打开。");
      const value = await api(`/api/web/report?id=${encodeURIComponent(id)}`);
      if (ticket !== generation.current) return;
      if (!value.report || (value.reportId || value.report.id) !== id) throw new Error("报告未完整返回，请重试。");
      const entries: Json[] = Array.isArray(value.entries) ? value.entries : [];
      const report = value.kind === "chat" && entries.length ? mergeChatReports(entries) : value.report;
      if (!report) throw new Error("报告正文暂未返回，请重试。");
      setSaved({ ...value, kind: value.kind || "chat", report: { ...report, reportId: value.reportId || id }, entries }); setReportOwner(scope);
    } catch (e) { if (ticket === generation.current) setError(message(e)); }
    finally { if (ticket === generation.current) setLoading(false); }
  }
  useEffect(() => { generation.current++; setSaved(null); setReportOwner(null); if (owner) void load(); return () => { generation.current++; }; }, [owner]);
  async function remove() {
    if (!current || deleting || !window.confirm("删除这份报告？这次分析中的全部解读将一起删除，删除后不能恢复。")) return;
    const scope = owner, ticket = generation.current;
    setDeleting(true); setError("");
    try { const response = await fetch(`/api/web/report?id=${encodeURIComponent(current.report.reportId || current.report.id)}`, { method: "DELETE", cache: "no-store" }); const result = await response.json().catch(() => ({})) as Json; if (!response.ok) throw new Error(result.error || "报告暂未删除，请重试。"); if (scope === owner && ticket === generation.current) window.location.assign("/reports"); }
    catch (e) { if (ticket === generation.current) setError(message(e)); }
    finally { if (ticket === generation.current) setDeleting(false); }
  }
  return <div className={ui.page}><WebNav/><main className={ui.wrap}>
    <AuroraPageHero eyebrow="已保存的分析" title={title} description="回到这次分析，接着查看原话、依据与下一步。"><a className={ui.secondary} href="/reports"><ArrowLeft size={17}/>返回历史报告</a><a className={ui.primary} href={`/analyze?mode=${kind}`}><ScanLine size={17}/>继续分析新材料</a></AuroraPageHero>
    <AccountNotice state={account}/><ErrorNotice error={error}/>{error && <button className={ui.secondary} onClick={() => void load()}>重新读取报告</button>}{loading && owner && !error && <p role="status">正在读取报告…</p>}
    {current && <><div className={styles.saved}><BookmarkCheck size={20}/><span><strong>完整报告已保存</strong>{current.report.captureOrigin ? `本次分析包含 ${current.totalCount || 1} 条采集记录，可从判断旁回看本机原文。` : current.totalCount > 1 ? `包含 ${current.totalCount} 张截图，按上传顺序整理。` : "长期保存在当前账号，可随时从「历史」打开。"}</span></div>{kind === "chat" ? <ChatReport key={current.report.reportId} report={current.report} account={account.account} styleReportIds={current.entries?.map((entry: Json) => entry.id).filter(Boolean)}/> : <SocialReport key={current.report.reportId} report={current.report} account={account.account} subjectId={current.subjectId || current.report.subjectId || ""} targetSelf={!!current.targetSelf}/>}<div className={styles.footer}><a href="/reports"><ArrowLeft size={16}/>返回历史报告</a><button type="button" disabled={deleting} onClick={() => void remove()}><Trash2 size={16}/>{deleting ? "正在删除…" : "删除这份报告"}</button></div></>}
  </main></div>;
}
