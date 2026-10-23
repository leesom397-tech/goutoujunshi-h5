"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from 'next/navigation';
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
import { personAnalysisHref, withAnalysisFocus, withCaptureQuestion } from "@/lib/person-analysis-navigation";
import { reportIdentity, reportGoal } from "@/components/web-analysis/report-context";
import { ReportReturnLink } from "@/components/web-analysis/ReportReturnLink";
import { ReportTimestamp } from "@/components/web-analysis/ReportTimestamp";
import { cachedReport, rememberReport, forgetReport, reportSessionRevision } from '@/lib/report-session-cache';
import { ReportSessionContext } from '@/components/web-analysis/ReportSessionState';
export default function ReportPage() {
  const account=useAccount(),search=useSearchParams(),id=search.get('id'),owner=account.account?.account?.userId;
  return <SavedReportPage key={JSON.stringify([owner,id])} account={account} id={id}/>;
}
function SavedReportPage({account,id}:{account:ReturnType<typeof useAccount>;id:string|null}) {
  const owner = account.account?.account?.userId;
  const [saved, setSaved] = useState<Json | null>(()=>cachedReport(owner,id)?.value||null), [reportOwner, setReportOwner] = useState<string | null>(()=>cachedReport(owner,id)?owner:null), [error, setError] = useState(""), [loading, setLoading] = useState(()=>!cachedReport(owner,id)), [deleting, setDeleting] = useState(false), generation = useRef(0);
  const [refreshing,setRefreshing]=useState(false),[refreshError,setRefreshError]=useState(''),[updated,setUpdated]=useState<Json|null>(null);
  const restored=useRef(!!cachedReport(owner,id));
  const focusValue = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("focus") : null;
  const initialFocus = focusValue === "affinity" || focusValue === "intent" || focusValue === "reply" ? focusValue : undefined;
  const current = owner && owner === reportOwner ? saved : null;
  const kind = current?.kind === "moments" ? "moments" : current?.kind === "social" ? "social" : "chat";
  const fullMoments = current?.report.analysisScope === "fullHistory" && current?.report.captureKind === "moments";
  const supplement = current?.report.analysisScope === "supplement" ? current.report.supplementOf : null;
  const parentHref = supplement?.scope === "fullHistory" && /^[a-f0-9-]{36}$/i.test(supplement.reportId || "") ? `/report?id=${encodeURIComponent(supplement.reportId)}` : "";
  const identity = current ? reportIdentity(current.report) : null;
  const baseTitle = supplement ? "补充解读" : current?.report.riskAnalysis ? "关系提醒报告" : current?.report.importAnalysis ? "导入聊天分析报告" : fullMoments ? "完整朋友圈报告" : kind === "moments" ? "朋友圈分析报告" : kind === "social" ? "社交主页分析报告" : current?.report.analysisScope === "fullHistory" ? reportGoal(current.report)==="risk" ? "风险核实报告" : "完整关系报告" : "聊天分析报告";
  const title = identity?.known && !current?.targetSelf ? `${identity.other} · ${baseTitle}` : baseTitle;
  const readerHasHeading = !!current && !current.report.riskAnalysis && !current.report.importAnalysis && (kind === "chat" || fullMoments);
  const returnTo = current ? intakeReturnTo('/report?id=' + (current.report.reportId || current.report.id)) : '';
  const continueTarget = fullMoments ? intakeHref('/capture',{kind:'moments',method:'library',subjectId:current?.subjectId || current?.report.subjectId || '',libraryId:current?.report.archiveSnapshot?.libraryId || '',returnTo}) : current?.report.analysisScope === "fullHistory" ? current.report.archiveSnapshot?.libraryId ? intakeHref('/capture',{kind:'chat',method:'library',subjectId:current.subjectId || current.report.subjectId || '',libraryId:current.report.archiveSnapshot.libraryId,returnTo}) : personAnalysisHref(current?.subjectId || current?.report.subjectId || '') : current?.report.riskAnalysis ? "/risk" : current?.report.importAnalysis ? "/import" : intakeHref('/analyze',{mode:kind,subjectId:current?.subjectId || current?.report.subjectId || '',targetSelf:!!current?.targetSelf,returnTo});
  const continueHref = withAnalysisFocus(withCaptureQuestion(continueTarget,current?.report.analysisQuestion||current?.report.relationshipDiagnosis?.question||(current&&reportGoal(current.report)==='risk'?'risk':undefined)),continueTarget.startsWith("/analyze") ? initialFocus : undefined);
  async function load() {
    const ticket = ++generation.current, scope = owner, revision=reportSessionRevision(); if (!scope) return;
    const prior=cachedReport(scope,id);
    setLoading(!prior); setRefreshing(!!prior); setError(""); setRefreshError('');
    try {
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
      if (ticket !== generation.current || revision!==reportSessionRevision()) return;
      if (!value.report || (value.reportId || value.report.id) !== id) throw new Error("报告未完整返回，请重试。");
      const entries: Json[] = Array.isArray(value.entries) ? value.entries : [];
      const report = value.kind === "chat" && entries.length && value.report.analysisScope !== 'uploadedHistory' ? mergeChatReports(entries) : value.report;
      if (!report) throw new Error("报告正文暂未返回，请重试。");
      const scopeMetadata = value.report.analysisScope === "supplement" ? { analysisScope: "supplement", supplementOf: value.report.supplementOf, scopeNote: value.report.scopeNote, generatedAt: value.report.generatedAt } : {};
      const normalized={ ...value, kind: value.kind || "chat", report: { ...report, ...scopeMetadata, reportId: value.reportId || id }, entries };
      // Do not replace an open chapter underneath the reader. A changed saved
      // report becomes an explicit refresh; unchanged data preserves all UI state.
      if(prior&&prior.serialized!==JSON.stringify(normalized))setUpdated(normalized);
      else {const entry=rememberReport(scope,revision,id,normalized);setSaved(entry?.value||normalized);setReportOwner(scope);setUpdated(null);}
    } catch (e) { if (ticket === generation.current) {
      if(e instanceof WebError&&[401,403,404].includes(e.status)){forgetReport(scope,id);setSaved(null);setReportOwner(null);setUpdated(null);setError(message(e));}
      else if(prior)setRefreshError('暂未核对最新版本，当前保留你上次打开的报告。');
      else setError(message(e));
    } }
    finally { if (ticket === generation.current) {setLoading(false);setRefreshing(false);} }
  }
  useEffect(() => { if (owner) void load(); return () => { generation.current++; }; }, [owner,id]);
  function showUpdated(){if(!updated||!owner||!id)return;const entry=rememberReport(owner,reportSessionRevision(),id,updated);setSaved(entry?.value||updated);setReportOwner(owner);setUpdated(null);setRefreshError('');}
  async function remove() {
    if (!current || deleting || !window.confirm("删除这份报告？这次分析中的全部解读将一起删除，删除后不能恢复。")) return;
    const scope = owner, ticket = generation.current;
    setDeleting(true); setError("");
    try { const response = await fetch(`/api/web/report?id=${encodeURIComponent(current.report.reportId || current.report.id)}`, { method: "DELETE", cache: "no-store" }); const result = await response.json().catch(() => ({})) as Json; if (!response.ok) throw new Error(result.error || "报告暂未删除，请重试。"); if (scope === owner && ticket === generation.current) {forgetReport(scope,id);window.location.assign("/reports");} }
    catch (e) { if (ticket === generation.current) setError(message(e)); }
    finally { if (ticket === generation.current) setDeleting(false); }
  }
  return <ReportSessionContext.Provider value={owner&&id?{owner,id}:null}><div className={`${ui.page} ${styles.reportPage}`} data-report-session={current?(restored.current?'restored':'loaded'):'loading'}><WebNav/><main className={`${ui.wrap} ${styles.readingWrap}`}>
    <header className={`${styles.reportHeader} ${readerHasHeading ? styles.compactHeader : ""}`}><div><span className={styles.eyebrow}><BookmarkCheck size={16}/>{current ? "已保存" : "正在打开报告"}</span><h1>{current ? title : "分析报告"}</h1>{current&&<ReportTimestamp saved={current}/>} {current && !readerHasHeading && <p>{current.report.importAnalysis ? "导入材料的分析结果已保存，原始文件不保留。" : current.totalCount > 1 ? `本次分析 ${current.totalCount} 张截图` : ""}</p>}</div><nav aria-label="报告操作"><a href="/reports"><ArrowLeft size={16}/><span>分析记录</span></a>{current && <ReportReturnLink reportId={current.report.reportId||current.report.id} href={continueHref}><ScanLine size={16}/><span>补充材料</span></ReportReturnLink>}</nav></header>
    <AccountNotice state={account}/><ErrorNotice error={error}/>{error && <button className={ui.secondary} onClick={() => void load()}>重新读取报告</button>}{loading && owner && !error && <p role="status">正在读取报告…</p>}
    {current&&(refreshing||refreshError||updated)&&<div className={styles.refreshState} data-report-refresh role="status">{updated?<><span>这份报告有更新，当前保留上次阅读的版本。</span><button type="button" onClick={showUpdated}>查看更新后的报告</button></>:refreshError?<><span>{refreshError}</span><button type="button" onClick={()=>void load()}>重新核对</button></>:<span>已恢复上次阅读，正在后台核对更新…</span>}</div>}
    {current && <details className={styles.freshness}><summary>旧报告也使用新版展示 · 阅读不扣积分</summary><p>排版、图表和操作优化会直接应用到已保存报告。原有判断与生成时间保留。新功能需要旧报告没有的分析内容时，才需要基于已保存资料更新；更新前会说明费用，不会自动扣积分。</p></details>}
    {supplement && <aside className={styles.supplement} data-report-supplement><div><strong>补充解读 · 本次新增截图</strong><p>参考此前完整报告解读新截图。原报告保留，本次不重新统计全部历史。</p><ReportTimestamp saved={{ report: { generatedAt: supplement.generatedAt } }}/></div>{parentHref && <a href={parentHref}><ArrowLeft size={18}/>返回完整报告</a>}</aside>}
    {current?.freshness && current.freshness.status !== "current" && <aside className={styles.freshness} role="status"><div><strong>{current.freshness.status === "changed" ? current.freshness.analysisUpdated ? "可以基于原资料更新这份报告" : "这份报告之后，资料有更新" : current.freshness.status === "removed" ? "这份报告的部分来源已移除或重新关联" : "暂未核对资料是否有新变化"}</strong><p>{current.freshness.status === "changed" ? [current.freshness.analysisUpdated ? (fullMoments ? "可以补全动态与图片解读、前后变化和具体话题建议；历史报告不会自动重写。" : "可补全人物方向、风险核实和行动依据。已有聊天无需重新导入。") : "", current.freshness.added > 0 ? `原有来源新增 ${current.freshness.added} 条材料。` : "", current.freshness.newLibraries > 0 ? `新增关联 ${current.freshness.newLibraries} 份材料库。` : "", current.freshness.profileChanged ? "你或这个人的已确认档案有更新。" : ""].filter(Boolean).join(" ") || "原文、语音转写或图片等来源版本已变化，当前展示的是已保存的判断。" : "可以继续阅读历史报告；更新分析前请重新核对来源。"}</p></div><ReportReturnLink reportId={current.report.reportId||current.report.id} href={continueHref}>核对资料与更新<ScanLine size={16}/></ReportReturnLink></aside>}
    {current && <>{current.report.riskAnalysis ? <div className={styles.materialReport}><RiskResult result={current.report.riskAnalysis}/></div> : current.report.importAnalysis ? <section className={styles.materialReport}><AnalysisCard title="本次总结" result={current.report.importAnalysis.result} main/><ConversationPanel result={current.report.importAnalysis.batches?.at(-1)||current.report.importAnalysis.result} me={current.report.importAnalysis.me} other={current.report.importAnalysis.other} ready/><details><summary>查看每批分析</summary>{current.report.importAnalysis.batches?.map((item: any,index:number)=><AnalysisCard key={index} title={`第 ${index+1} 批`} result={item}/>)}</details></section> : kind === "chat" || fullMoments ? <ChatReport initialFocus={initialFocus} key={current.report.reportId} report={current.report} account={account.account} styleReportIds={current.entries?.map((entry: Json) => entry.id).filter(Boolean)}/> : <SocialReport key={current.report.reportId} report={current.report} account={account.account} subjectId={current.subjectId || current.report.subjectId || ""} targetSelf={!!current.targetSelf}/>}<div className={styles.footer}><a href="/reports"><ArrowLeft size={16}/>返回分析记录</a><button type="button" disabled={deleting} onClick={() => void remove()}><Trash2 size={16}/>{deleting ? "正在删除…" : "删除这份报告"}</button></div></>}
  </main></div></ReportSessionContext.Provider>;
}
