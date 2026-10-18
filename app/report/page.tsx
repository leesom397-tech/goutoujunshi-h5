"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookmarkCheck, ScanLine, Trash2 } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import ui from "@/components/AuroraUI.module.css";
import { AccountNotice, ErrorNotice, api, message, useAccount, WebError, type Json } from "@/components/web-analysis/client";
import { ChatReport, SocialReport } from "@/components/web-analysis/ReportView";
import { mergeChatReports } from "@/components/web-analysis/report-data";
import "@/components/web-analysis/web-analysis.css";
import styles from "./ReportPage.module.css";
import { AnalysisCard, ConversationPanel, RiskResult } from "@/components/MaterialReport";
import { intakeHref, intakeReturnTo } from "@/components/web-analysis/intake-navigation";
export default function ReportPage() {
  const account = useAccount(), owner = account.account?.account?.userId;
  const [saved, setSaved] = useState<Json | null>(null), [reportOwner, setReportOwner] = useState<string | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [deleting, setDeleting] = useState(false), generation = useRef(0);
  const current = owner && owner === reportOwner ? saved : null;
  const kind = current?.kind === "moments" ? "moments" : current?.kind === "social" ? "social" : "chat";
  const title = current?.report.riskAnalysis ? "关系提醒报告" : current?.report.importAnalysis ? "导入聊天分析报告" : kind === "moments" ? "朋友圈分析报告" : kind === "social" ? "社交主页分析报告" : current?.report.analysisScope === "fullHistory" ? "完整关系报告" : "聊天分析报告";
  const returnTo = current ? intakeReturnTo('/report?id=' + (current.report.reportId || current.report.id)) : '';
  const continueHref = current?.report.riskAnalysis ? "/risk" : current?.report.importAnalysis ? "/import" : intakeHref('/analyze',{mode:kind,subjectId:current?.subjectId || current?.report.subjectId || '',targetSelf:!!current?.targetSelf,returnTo});
  async function load() {
    const ticket = ++generation.current, scope = owner; if (!scope) return;
    setLoading(true); setError(""); setSaved(null);
    try {
      const id = new URLSearchParams(window.location.search).get("id");
      if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("报告编号无效，请返回分析记录重新打开。");
      let value: Json;
      try { value = await api(`/api/web/report?id=${encodeURIComponent(id)}`); }
      catch (first) {
        // A transient identity lookup must not strand a just-saved report. Retry
        // this read once only after independently confirming the same account.
        if (!(first instanceof WebError) || ![401, 502, 503, 504].includes(first.status)) throw first;
        const verified = await api("/api/account/credits");
        if (ticket !== generation.current) return;
        if (verified.account?.userId !== scope) throw first;
        value = await api(`/api/web/report?id=${encodeURIComponent(id)}`);
      }
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
    <header className={styles.reportHeader}><div><span className={styles.eyebrow}><BookmarkCheck size={16}/>{current ? "已保存 · 随时回看" : "正在打开报告"}</span><h1>{current ? title : "分析报告"}</h1>{current && <p>{current.report.importAnalysis ? "导入材料的分析结果已保存，原始文件不保留。" : current.report.captureOrigin ? `本次分析 ${current.totalCount || 1} 条采集记录，原文可在下方查看。` : current.totalCount > 1 ? `本次分析 ${current.totalCount} 张截图，按上传顺序整理。` : "先看判断，再看依据与下一步。"}</p>}</div><nav aria-label="报告操作"><a className={ui.secondary} href="/reports"><ArrowLeft size={17}/>分析记录</a>{current && <a className={ui.secondary} href={continueHref}><ScanLine size={17}/>补充材料</a>}</nav></header>
    <AccountNotice state={account}/><ErrorNotice error={error}/>{error && <button className={ui.secondary} onClick={() => void load()}>重新读取报告</button>}{loading && owner && !error && <p role="status">正在读取报告…</p>}
    {current && <>{current.report.riskAnalysis ? <div className={styles.materialReport}><RiskResult result={current.report.riskAnalysis}/></div> : current.report.importAnalysis ? <section className={styles.materialReport}><AnalysisCard title="本次总结" result={current.report.importAnalysis.result} main/><ConversationPanel result={current.report.importAnalysis.batches?.at(-1)||current.report.importAnalysis.result} me={current.report.importAnalysis.me} other={current.report.importAnalysis.other} ready/><details><summary>查看每批分析</summary>{current.report.importAnalysis.batches?.map((item: any,index:number)=><AnalysisCard key={index} title={`第 ${index+1} 批`} result={item}/>)}</details></section> : kind === "chat" ? <ChatReport key={current.report.reportId} report={current.report} account={account.account} styleReportIds={current.entries?.map((entry: Json) => entry.id).filter(Boolean)}/> : <SocialReport key={current.report.reportId} report={current.report} account={account.account} subjectId={current.subjectId || current.report.subjectId || ""} targetSelf={!!current.targetSelf}/>}<div className={styles.footer}><a href="/reports"><ArrowLeft size={16}/>返回分析记录</a><button type="button" disabled={deleting} onClick={() => void remove()}><Trash2 size={16}/>{deleting ? "正在删除…" : "删除这份报告"}</button></div></>}
  </main></div>;
}
