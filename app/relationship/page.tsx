"use client";
import { useEffect, useState } from "react";
import { ArrowRight, FileText, Images, MessageCircle, Monitor, RefreshCw, Search, UserRound } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { AccountNotice, useAccount } from "@/components/web-analysis/client";
import { listSyncedCaptureLibraries, type SyncedLibrarySummary } from "@/lib/capture-cloud-client";
import { capturePersonHref, capturePersonLabel, relatedMomentLibraries } from "@/lib/person-analysis-navigation";
import styles from "./relationship.module.css";

export default function RelationshipPage() {
  const account = useAccount(), owner = account.account?.account?.userId || "";
  const [libraries, setLibraries] = useState<SyncedLibrarySummary[]>([]), [loading, setLoading] = useState(true), [warning, setWarning] = useState("");
  const [query, setQuery] = useState(""), [subject, setSubject] = useState(""), [page, setPage] = useState(0), [revision, setRevision] = useState(0);
  const [canImport, setCanImport] = useState(false);
  useEffect(() => { setSubject(new URLSearchParams(location.search).get("subjectId") || ""); setCanImport(/Win/i.test(navigator.platform)); }, []);
  useEffect(() => {
    let active = true; setLibraries([]); setWarning(""); setLoading(!!owner);
    if (owner) void listSyncedCaptureLibraries(owner).then(result => { if (active) { setLibraries(result.libraries); setWarning(result.warning); } }).catch(() => { if (active) setWarning("材料暂时没有读到，请重新加载。"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner, revision]);
  const person = account.people.find(row => row.id === subject);
  const chats = libraries.filter(row => row.kind === "chat" && row.total > 0 && (!subject || row.cloud?.subjectId === subject));
  const rows = chats.filter(row => [capturePersonLabel(row.friend), account.people.find(person => person.id === row.cloud?.subjectId)?.label || ""].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const lastPage = Math.max(0, Math.ceil(rows.length / 6) - 1), currentPage = Math.min(page, lastPage);
  return <><WebNav/><main className={styles.page}>
    <header className={styles.heading}><span>完整关系分析</span><h1>{person ? `看清与 ${person.label} 的关系` : "分析一个人的全部资料"}</h1><p>聊天与可见朋友圈，一起看现状、变化和下一步。</p></header>
    <AccountNotice state={account}/>
    <section className={styles.start} aria-label="开始完整分析">
      <div><Monitor size={24}/><h2>{canImport ? "导入一个人的全部资料" : "在电脑导入，手机也能看"}</h2><p>{canImport ? "选一位微信好友，带入聊天、语音和可见朋友圈。" : "已有材料直接选下方；首次完整导入需要 Windows 电脑。"}</p></div>
      <a className={styles.primary} href={capturePersonHref(subject)}>{canImport ? "选择微信好友" : "查看电脑导入"}<ArrowRight size={18}/></a>
    </section>
    <section className={styles.saved} aria-labelledby="saved-person-title">
      <header><div><h2 id="saved-person-title">{person ? "这个人已导入的材料" : "接着分析已导入的人"}</h2><p>打开后核对资料与费用，再生成报告。</p></div><button type="button" disabled={loading || !owner} onClick={() => setRevision(value => value + 1)} aria-label="刷新已导入材料"><RefreshCw size={18}/></button></header>
      {!!chats.length && <label className={styles.search}><Search size={18}/><input aria-label="搜索已导入的人" value={query} placeholder="搜索称呼或备注" onChange={event => { setQuery(event.target.value); setPage(0); }}/></label>}
      {account.loading || loading ? <p className={styles.empty} role="status">正在读取已导入材料…</p> : account.unauthorized ? <p className={styles.empty}>登录后显示你已导入的人与材料。</p> : <>
        {warning && <p className={styles.warning} role="alert">{warning}<button type="button" onClick={() => setRevision(value => value + 1)}>重新加载</button></p>}
        <div className={styles.people}>{rows.slice(currentPage * 6, currentPage * 6 + 6).map(chat => {
          const related = relatedMomentLibraries(chat, libraries), personId = chat.cloud?.subjectId || "", profile = account.people.find(row => row.id === personId);
          const label = profile?.label || capturePersonLabel(chat.friend), last = [...(chat.reportLinks || [])].sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
          return <article key={chat.id} className={styles.person}>
            <a className={styles.personMain} href={capturePersonHref(personId, chat.id)}><span className={styles.avatar}>{profile?.avatar ? <img src={profile.avatar} alt={`${label}的头像`}/> : <UserRound size={24}/>}</span><div><h3>{label}</h3><p><MessageCircle size={15}/>{chat.total.toLocaleString("zh-CN")} 条聊天{related.length > 0 && <><Images size={15}/>{related.reduce((sum,row) => sum + row.total, 0)} 条朋友圈</>}</p><small>{chat.cloud?.enabled ? "已同步" : "仅保存在本机"} · {new Date(chat.updatedAt).toLocaleDateString("zh-CN")}</small></div><ArrowRight size={19}/></a>
            <nav aria-label={`${label}的后续操作`}>{last && <a href={"/report?id=" + encodeURIComponent(last.reportId)}><FileText size={15}/>查看已有报告</a>}{personId && <a href={"/chat?subjectId=" + encodeURIComponent(personId)}><MessageCircle size={15}/>基于资料提问</a>}</nav>
          </article>;
        })}</div>
        {!rows.length && <p className={styles.empty}>{query ? "没有找到，试试其他备注或称呼。" : subject ? "还没有关联到这个人的聊天。可以导入新材料，或从已有材料中选择。" : "还没有导入材料，从上面的“选择微信好友”开始。"}</p>}
        {lastPage > 0 && <nav className={styles.pagination} aria-label="人物分页"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {lastPage + 1}</span><button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>}
        {subject && <a className={styles.textLink} href="/relationship">查看全部已导入材料<ArrowRight size={16}/></a>}
      </>}
    </section>
    <nav className={styles.alternatives} aria-label="其他分析方式"><a href={"/analyze?mode=chat" + (subject ? "&subjectId=" + encodeURIComponent(subject) : "")}>只分析这次上传的聊天<ArrowRight size={16}/></a><a href={"/chat" + (subject ? "?subjectId=" + encodeURIComponent(subject) : "")}>先问成子<ArrowRight size={16}/></a></nav>
  </main></>;
}
