"use client";
import { useEffect, useRef, useState } from "react";
import { WebNav } from "@/components/WebNav";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import ui from "@/components/AuroraUI.module.css";
import { AccountNotice, ErrorNotice, api, message, useAccount, type Json } from "@/components/web-analysis/client";
import { ChatReport } from "@/components/web-analysis/ReportView";
import "@/components/web-analysis/web-analysis.css";
export default function ReportPage() {
  const account = useAccount(), [report, setReport] = useState<Json | null>(null), [reportOwner, setReportOwner] = useState<string | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), generation = useRef(0);
  const owner = account.account?.account?.userId;
  async function load() { const current = ++generation.current, scope = owner; if (!scope) return; setLoading(true); setError(""); try { const id = new URLSearchParams(window.location.search).get("id"); if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("报告编号无效，请从人物档案或分析结果打开报告。"); const value = await api(`/api/web/report?id=${id}`); if (current !== generation.current) return; if (value.report?.id !== id) throw new Error("报告未完整返回，请重试。"); setReport(value.report); setReportOwner(scope); } catch (e) { if (current === generation.current) setError(message(e)); } finally { if (current === generation.current) setLoading(false); } }
  useEffect(() => { generation.current++; setReport(null); if (owner) void load(); return () => { generation.current++; }; }, [owner]);
  return <div className={ui.page}><WebNav/><main className={ui.wrap}><AuroraPageHero eyebrow="从原话到行动" title="聊天分析报告" description="核对材料，理解可能性，再选择适合自己的回应。"/><AccountNotice state={account}/><ErrorNotice error={error}/>{error && <button className={ui.secondary} onClick={() => void load()}>重新读取报告</button>}{loading && owner && !error && <p role="status">正在读取报告…</p>}{report && owner && reportOwner === owner && <ChatReport report={report} account={account.account}/>}</main></div>;
}
