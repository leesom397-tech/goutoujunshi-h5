"use client";

import { useEffect, useState } from "react";
import { Activity, ArrowUpRight, LoaderCircle } from "lucide-react";
import { ChatActivity } from "@/components/ChatActivity";
import type { ChatActivityRecord } from "@/lib/chat-activity";
import { loadArchiveImportedActivity } from "@/lib/archive-imported-activity";
import styles from "@/app/archive/archive.module.css";

type Props = { owner: string; subjectId: string; label: string };

/** Reads saved capture metadata only. It never starts an AI job or charges credits. */
export function ArchiveImportedActivity({ owner, subjectId, label }: Props) {
  const [records, setRecords] = useState<ChatActivityRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const [account, setAccount] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    setStatus("loading"); setRecords([]); setTotal(0); setAccount("");
    async function load() { try { const result = await loadArchiveImportedActivity(owner, subjectId); if (cancelled) return; if (!result) { setStatus("empty"); return; } setRecords(result.records); setTotal(result.total); setUpdatedAt(result.updatedAt); setAccount(result.account); setStatus(result.records.length ? "ready" : "empty"); } catch (error) { if (!cancelled) setStatus("error"); } }
    if (owner && subjectId) void load();
    return () => { cancelled = true; };
  }, [owner, subjectId]);
  if (status === "loading") return <section className={`${styles.card} ${styles.importedActivity}`}><p className={styles.muted}><LoaderCircle className={styles.spin} size={16}/>正在把已导入聊天整理成统计…</p></section>;
  if (status === "error") return <section className={`${styles.card} ${styles.importedActivity}`}><h2><Activity size={20}/>聊天统计</h2><p className={styles.muted}>账号或资料正在变化，统计暂时未取回；原文仍在材料库，刷新人物页后重试。</p></section>;
  if (status === "empty") return <section className={`${styles.card} ${styles.importedActivity}`}><h2><Activity size={20}/>聊天统计</h2><p className={styles.muted}>这个人物还没有关联的完整聊天。导入时选择人物，聊天频率、谁先开口和日期趋势就会自动出现。</p><a className={styles.link} href={`/capture?method=library&subjectId=${encodeURIComponent(subjectId)}`}>打开材料库 <ArrowUpRight size={15}/></a></section>;
  return <section className={`${styles.card} ${styles.importedActivity}`}>
    <div className={styles.sectionHead}><div><h2><Activity size={20}/>已导入聊天的实际统计</h2><p className={styles.muted}>已导入 {total || records.length} 条；这部分只整理原文，不会自动扣积分。</p></div><a className={styles.link} href={`/capture?method=library&subjectId=${encodeURIComponent(subjectId)}`}>查看原文 <ArrowUpRight size={15}/></a></div>
    <ChatActivity records={records} account={account || undefined} friend={label} compact />
    {updatedAt && <small className={styles.muted}>材料更新于 {new Date(updatedAt).toLocaleString("zh-CN")}</small>}
  </section>;
}
