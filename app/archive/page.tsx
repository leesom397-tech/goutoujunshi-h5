"use client";

import { RelationshipJourney } from "@/components/RelationshipJourney";
import { ReportDetails } from "@/components/web-analysis/ReportDetails";
import { SelfChatMemory } from "@/components/SelfChatMemory";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, ArrowLeft, ArrowUpRight, Pause, Play, ShieldCheck, Trash2, UsersRound, TrendingUp, NotebookPen, HeartHandshake, Fingerprint, Search, Columns3 } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import { QuickSelfProfile } from "@/components/QuickSelfProfile";
import { mergeQuickSelfProfile } from "@/lib/quick-self-profile";
import { ArchiveAvatar } from "@/components/ArchiveAvatar";
import {PersonAvatarChoice} from "@/components/PersonAvatarChoice";
import { AddMaterials } from "@/components/AddMaterials";
import { PersonOverview } from "@/components/PersonOverview";
import { ArchiveImportedActivity } from "@/components/ArchiveImportedActivity";
import { ArchiveComparison } from "@/components/ArchiveComparison";
import { ArchiveFeedback, EventDateEditor } from "@/components/ArchiveFeedback";
import { CommunicationReading, MomentsReportView } from "@/components/ArchiveInsights";
import { dimensions, type SelfData } from "@/lib/profile";
import { archiveRequest, personDisplayData, basicFields, preferenceFields, personFields, type ArchiveState, type Person, type ArchiveFact } from "./types";
import styles from "./archive.module.css";
import {api,useAccount} from "@/components/web-analysis/client";

const empty: ArchiveState = { enabled: false, paused: false, self: {}, subjects: [], facts: [], signals: [], trends: [] };
type Action = (body: Record<string, unknown>, message?: string) => Promise<boolean>;

export default function ArchivePage() {
  const identity=useAccount(),owner=identity.account?.account?.userId||"";
  const checking=identity.loading;
  const unavailable=checking||!owner||identity.unauthorized||!!identity.error;
  const [routeSearch,setRouteSearch]=useState("");
  useEffect(()=>{setRouteSearch(window.location.search);},[]);
  const query=new URLSearchParams(routeSearch);
  const view=query?.get("compare")==="1"?"compare":query?.get("tab")==="self"?"self":"people";
  return <><div hidden={unavailable}>{owner&&<OwnedArchive key={owner} ownerId={owner}/>}</div>{unavailable&&<main className={styles.page}><WebNav/><div className={styles.wrap}><AuroraPageHero eyebrow={view==="compare"?"结合你的期待":view==="self"?"关于我":"关系档案"} title={view==="compare"?"人物对照":view==="self"?"我的资料与相处偏好":"人物档案"} description={view==="compare"?"选 2–3 位人物，先看各自值得了解的地方，再看差异、顾虑和下一步。":view==="self"?"补充自己的期待，让建议更贴近你。":"看最近进展，也记住相处中的细节。"}/><div className={styles.tabs} aria-hidden="true"><button disabled><UsersRound size={16}/>人物档案</button><button disabled><Fingerprint size={16}/>我的资料</button><button disabled><Columns3 size={16}/>人物对照</button></div><section className={styles.card} style={{minHeight:360}} aria-busy={checking}>{checking?<p role="status">正在读取你的档案…</p>:identity.unauthorized||!owner?<><p>登录后查看你的档案。</p><a className={styles.primary} href={"/login?return_to="+encodeURIComponent("/archive"+routeSearch)}>登录并继续</a></>:<><p>{identity.error}</p><button className={styles.primary} onClick={()=>void identity.refresh()}>重新连接</button></>}</section></div></main>}</>;
}

function OwnedArchive({ownerId}:{ownerId:string}) {
  const [state, setState] = useState<ArchiveState>(empty);
  const [tab, setTab] = useState<"people" | "self" | "compare">("people");
  const [selectedId, setSelectedId] = useState("");
  const [avatarPrompt,setAvatarPrompt]=useState('');
  useEffect(()=>{const query=new URLSearchParams(window.location.search);if(query.get('avatar')==='choose')setAvatarPrompt(query.get('subjectId')||'');},[]);
  const [section, setSection] = useState<"overview" | "profile" | "evidence" | "trend">("overview");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 4500); return () => clearTimeout(timer); }, [notice]);
  const [editing, setEditing] = useState(false);
  const [returnTo, setReturnTo] = useState("");
  useEffect(() => { const target = new URLSearchParams(window.location.search).get("returnTo") || ""; if (target.startsWith("/report?") || (/^\/archive\?compare=1(?:&[^#]*)?$/).test(target)) setReturnTo(target); }, []);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [sortBy, setSortBy] = useState("recent");
  const [reviewPending, setReviewPending] = useState(false);
  const mutation = useRef(false);
  const mounted=useRef(true),loadGeneration=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;loadGeneration.current++;};},[]);
  const verifyOwner=useCallback(async()=>{
    const identity=await api("/api/account/credits");
    if(identity.account?.userId!==ownerId){
      if(mounted.current){setState(empty);setEditing(false);setNotice("");window.dispatchEvent(new Event("chengzi:credits-changed"));}
      throw new Error("账号已变化，正在重新读取当前账号的档案。");
    }
  },[ownerId]);
  const load = useCallback(async () => {
    const version=++loadGeneration.current;
    setError("");
    try { const next = await archiveRequest<ArchiveState>("profile"); await verifyOwner(); if(!mounted.current||version!==loadGeneration.current)return; setState(next); setLoadFailed(false); setSignedOut(false); }
    catch (cause) { if(!mounted.current||version!==loadGeneration.current)return; if ((cause as { status?: number }).status === 401) {setState(empty);setSignedOut(true);} else { setLoadFailed(true); setError(cause instanceof Error ? cause.message : "档案暂时无法读取。"); } }
    finally { if(mounted.current&&version===loadGeneration.current)setLoading(false); }
  }, [verifyOwner]);
  useEffect(() => { const query = new URLSearchParams(window.location.search); setTab(query.get("compare") === "1" ? "compare" : query.get("tab") === "self" ? "self" : "people"); setSelectedId(query.get("subjectId") || ""); setReviewPending(query.get("review") === "pending"); const view = query.get("section"); if (query.has("followup")) setSection("trend"); else if (view === "profile" || view === "evidence" || view === "trend") setSection(view); void load(); }, [load]);
  function switchView(next: "people" | "self" | "compare", id = "") {
    setTab(next); setSelectedId(id); setSection("overview"); setEditing(false); setNotice(""); setError("");
    window.history.replaceState(null, "", next === "compare" ? "/archive?compare=1" : next === "self" ? "/archive?tab=self" : id ? `/archive?subjectId=${encodeURIComponent(id)}` : "/archive");
  }
  function switchSection(next: "overview" | "profile" | "evidence" | "trend") {
    setSection(next); setEditing(false);
    window.history.replaceState(null, "", `/archive?subjectId=${encodeURIComponent(selectedId)}${next === "overview" ? "" : `&section=${next}`}`);
  }
  const act: Action = async (body, message = "已保存。") => {
    if (mutation.current||!mounted.current) return false;
    mutation.current = true; setBusy(true); setError(""); setNotice("");
    try { await verifyOwner(); if(!mounted.current)return false; const next = await archiveRequest<ArchiveState>("profile", { ...body, expectedOwnerId: ownerId }); await verifyOwner(); if(!mounted.current)return false; setState(next); if (body.action === "delete" || body.action === "wipe") switchView(tab); setNotice(message); setRevision(value => value + 1); return true; }
    catch (cause) { if(!mounted.current)return false;if ((cause as { status?: number }).status === 401) {setState(empty);setSignedOut(true);} setError(cause instanceof Error ? cause.message : "操作未完成，请重试。"); return false; }
    finally { mutation.current = false; if(mounted.current)setBusy(false); }
  };
  useEffect(() => {
    if (!selectedId || loading || !state.enabled || state.paused) return;
    let active=true;
    void archiveRequest<ArchiveState>("profile?subjectId="+encodeURIComponent(selectedId)).then(async next=>{
      await verifyOwner(); if(!active||!mounted.current)return;
      const person=next.subjects.find(item=>item.id===selectedId);
      if(person)setState(current=>({...current,subjects:current.subjects.map(item=>item.id===selectedId?person:item)}));
    }).catch(()=>{ /* Keep saved evidence visible if a live statistics refresh fails. */ });
    return()=>{active=false;};
  },[selectedId,loading,state.enabled,state.paused,revision,verifyOwner]);
  const selected = state.subjects.find(item => item.id === selectedId);
  const oldSignal = state.signals.find(item => item.subjectId === selectedId);
  const signal = selected?.savedChatAnalysis && (!oldSignal || selected.savedChatAnalysis.createdAt > oldSignal.updatedAt) ? undefined : oldSignal;
  const savedReport = selected?.savedAnalysis;
  const chatReportId = signal?.reportId || selected?.savedChatAnalysis?.reportId;
  const evidenceReading = selected?.communicationReading || savedReport?.reading || null;
  const evidenceMoments = selected?.momentsReport || savedReport?.moments || null;
  const trend = state.trends.find(item => item.subjectId === selectedId)?.points || [];
  const dated = trend.filter(item => item.eventStart).sort((a, b) => String(a.eventEnd || a.eventStart).localeCompare(String(b.eventEnd || b.eventStart)));
  const recent = dated[dated.length - 1] || trend[trend.length - 1];
  const scopedFacts = state.facts.filter(item => reviewPending && tab === "people" && !selected ? true : tab === "self" ? !item.subjectId : selected ? item.subjectId === selected.id : !!item.subjectId);
  const pending = scopedFacts.filter(item => item.status === "pending");
  useEffect(() => { if (reviewPending && !loading && state.enabled && pending.length) requestAnimationFrame(() => document.getElementById("archive-pending-review")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" })); }, [reviewPending, loading, state.enabled, pending.length]);
  const accepted = scopedFacts.filter(item => item.status === "accepted");
  const disabled = busy || state.paused || !state.enabled;
  const ranked = state.subjects.map(person => { const previous = state.signals.find(item => item.subjectId === person.id); return { ...person, signal: person.savedChatAnalysis && (!previous || person.savedChatAnalysis.createdAt > previous.updatedAt) ? undefined : previous }; }).sort((a, b) => sortBy === "signal" ? Number(!!b.signal?.comparable) - Number(!!a.signal?.comparable) || (a.signal?.comparable && b.signal?.comparable ? (b.signal.score || 0) - (a.signal.score || 0) : 0) || b.updatedAt - a.updatedAt : b.updatedAt - a.updatedAt);
  const stages = [...new Set(state.subjects.map(person => person.stage?.trim()).filter((value): value is string => !!value))];
  const query = search.trim().toLocaleLowerCase();
  const visiblePeople = ranked.filter(person => (stageFilter === "all" || (stageFilter === "unknown" ? !person.stage?.trim() : person.stage?.trim() === stageFilter)) && (!query || [person.label, person.stage, person.city, person.notes].filter(Boolean).join(" ").toLocaleLowerCase().includes(query)));
  const factView = (items: ArchiveFact[], isPending = false) => <div className={styles.facts}>{items.map(fact => <article className={styles.fact} key={fact.id}><small>{fact.subjectId ? state.subjects.find(item => item.id === fact.subjectId)?.label || "人物资料" : "我的资料"} · {fact.source}</small><p>{fact.kind.includes("Basic:") ? `${Object.fromEntries(basicFields)[fact.kind.split(":")[1]] || "资料"} · ` : ""}{fact.value}</p>{fact.eventTitle && <small>{fact.eventTitle} · {fact.eventDate || "聊天日期待确认"}</small>}{fact.evidence && <small>出处：{fact.evidence}</small>}<EventDateEditor fact={fact} disabled={disabled} onSave={act} /><div className={styles.actions}>{isPending ? <><button type="button" className={styles.button} disabled={disabled} onClick={() => void act({ action: "fact-decide", id: fact.id, decision: "accept" }, "这条资料已确认。")}>确认这条</button><button type="button" className={styles.link} disabled={disabled} onClick={() => void act({ action: "fact-decide", id: fact.id, decision: "reject" }, "已忽略这条线索。")}>忽略</button></> : <button type="button" className={styles.link} disabled={busy} onClick={() => { if (window.confirm("删除这条资料及其已填写的对应值？其他资料会保留。")) void act({ action: "fact-delete", id: fact.id }, "这条资料已删除。"); }}>删除这条</button>}</div></article>)}</div>;
  return <main className={styles.page}><WebNav /><div className={styles.wrap}>
    {selected && tab === "people" ? <header className={styles.personHeading}>
      <button type="button" className={styles.link} onClick={() => switchView("people")}><ArrowLeft size={16}/> 返回人物列表</button>
      <div className={styles.personHeadingRow}><div className={styles.heroIdentity}><Avatar person={selected}/><div><h1>{selected.label}</h1>{selected.stage && <p>{selected.stage}</p>}</div></div>
        <div className={styles.actions}><AddMaterials subjectId={selected.id} label="补充材料"/><a href={`/chat?subjectId=${encodeURIComponent(selected.id)}`} className={styles.primary}>问成子 <ArrowUpRight size={17}/></a></div>
      </div>
      <a href={"/archive?compare=1&ids=" + encodeURIComponent(selected.id)} className={styles.link}><Columns3 size={17}/> 与其他人物对照</a>
      {avatarPrompt===selected.id&&<PersonAvatarChoice subjectId={selected.id} name={selected.label} autoOpen onSaved={load}/>}
    </header> : <>
    <AuroraPageHero
      eyebrow={selected && tab === "people" ? "人物详情" : tab === "compare" ? "结合你的期待" : tab === "self" ? "关于我" : "关系档案"}
      title={selected && tab === "people" ? <span className={styles.heroIdentity}><Avatar person={selected} /><span>{selected.label}</span></span> : tab === "compare" ? "人物对照" : tab === "self" ? "我的资料与相处偏好" : "人物档案"}
      description={selected && tab === "people" ? "把每一次真实互动，接成更清晰的理解。" : tab === "compare" ? "选 2–3 位人物，先看各自值得了解的地方，再看差异、顾虑和下一步。" : tab === "self" ? "补充自己的期待，让建议更贴近你。" : "看最近进展，也记住相处中的细节。"}
    >
      {selected && tab === "people" && <><button type="button" className={styles.button} onClick={() => switchView("people")}><ArrowLeft size={16} /> 返回人物列表</button>{avatarPrompt===selected.id&&<PersonAvatarChoice subjectId={selected.id} name={selected.label} autoOpen onSaved={load}/>}</>}
      {!selected && tab === "people" && !signedOut && <a href="/person-new" className={styles.primary}><Plus size={17} /> 新建人物</a>}
      {selected && <a href={`/chat?subjectId=${encodeURIComponent(selected.id)}`} className={styles.primary}>带着档案问军师 <ArrowUpRight size={17} /></a>}
      {selected && tab === "people" && <a href={"/archive?compare=1&ids=" + encodeURIComponent(selected.id)} className={styles.button}><Columns3 size={17}/> 与其他人物对照</a>}
    </AuroraPageHero>
    <div className={styles.tabs} role="tablist" aria-label="档案类别"><button role="tab" aria-selected={tab === "people"} onClick={() => switchView("people")}><UsersRound size={16} />人物档案</button><button role="tab" aria-selected={tab === "self"} onClick={() => switchView("self")}><Fingerprint size={16} />我的资料</button><button role="tab" aria-selected={tab === "compare"} onClick={() => switchView("compare")}><Columns3 size={16} />人物对照</button></div>
    </>}
    {loading ? <section className={styles.card} aria-busy="true"><p role="status">正在读取你的档案…</p></section> : signedOut ? <section className={styles.card}><h2>登录后查看你的档案</h2><p>人物、分析记录和积分保存在你的账号中。</p><a className={styles.primary} href={`/login?return_to=${encodeURIComponent(tab === "compare" ? "/archive?compare=1" : tab === "self" ? "/archive?tab=self" : selectedId ? `/archive?subjectId=${encodeURIComponent(selectedId)}` : "/archive")}`}>登录并继续</a></section> : loadFailed ? <section className={styles.card}><h2>档案暂时打不开</h2><p>{error}</p><button type="button" className={styles.primary} onClick={() => { setLoading(true); void load(); }}>重新加载</button></section> : <>
      {!state.enabled && <section className={styles.card}><h2>{state.subjects.length ? "重新启用关系档案" : "保存你主动填写和确认的资料"}</h2><p>启用后，已确认的信息会用于后续关系建议。你可以随时修改、暂停、撤回同意或删除。</p><button className={styles.primary} type="button" disabled={busy} onClick={() => void act({ action: "consent", enabled: true }, "档案已启用。")}>同意并启用档案</button></section>}
      {state.paused && state.enabled && <section className={styles.warning}><strong>档案已暂停</strong><p>恢复后可继续补充资料，并用于关系建议。</p><button type="button" className={styles.primary} disabled={busy} onClick={() => void act({ action: "pause", paused: false }, "档案已恢复。")}>恢复使用</button></section>}
      {!!pending.length && state.enabled && <section id="archive-pending-review" className={`${styles.card} ${styles.footerGap}`}><details open={reviewPending || undefined}><summary>{pending.length} 条资料待核对</summary><p className={styles.muted}>逐条核对后保存到对应档案。</p><div className={styles.actions}><button type="button" className={styles.button} disabled={disabled} onClick={() => { if (window.confirm(`已核对这 ${Math.min(pending.length, 80)} 条资料，全部确认保存？`)) void act({ action: "fact-decide-many", ids: pending.slice(0, 80).map(item => item.id), decision: "accept" }, "已确认所选资料。"); }}>确认当前全部资料</button></div><div className={styles.footerGap}>{factView(pending, true)}</div></details></section>}
      {tab === "compare" && <ArchiveComparison state={state} openByDefault />}
      {tab === "people" && !selected && <><div className={styles.stats}><div className={styles.stat}><span className={styles.statIcon}><UsersRound size={21} strokeWidth={1.6} /></span><strong>{state.subjects.length}</strong><span>人物档案</span></div><div className={styles.stat}><span className={styles.statIcon}><TrendingUp size={21} strokeWidth={1.6} /></span><strong>{state.subjects.filter(person => !!(person.savedChatAnalysis || person.savedAnalysis || state.signals.some(item => item.subjectId === person.id && item.score != null))).length}</strong><span>已有分析</span></div><div className={styles.stat}><span className={styles.statIcon}><NotebookPen size={21} strokeWidth={1.6} /></span><strong>{pending.length}</strong><span>待核对线索</span></div></div>{selectedId && <p className={styles.warning}>这位人物不存在或已被删除，请从列表重新选择。</p>}<section className={styles.card}><div className={styles.sectionHead}><h2><UsersRound size={20} />眼下在了解谁？</h2><span className={styles.badge}>{state.subjects.length} 位人物</span></div><p className={styles.muted}>接着最近的进展聊，也可以按关系阶段找到 TA。</p>
      <div className={styles.peopleToolbar}><label className={styles.peopleSearch}><Search size={17}/><span className={styles.visuallyHidden}>搜索人物</span><input type="search" aria-label="搜索人物" placeholder="搜索称呼、城市或备注" value={search} onChange={event => setSearch(event.target.value)}/></label><label className={styles.peopleFilter}><span>关系阶段</span><select aria-label="筛选关系阶段" value={stageFilter} onChange={event => setStageFilter(event.target.value)}><option value="all">全部阶段</option>{stages.map(stage => <option key={stage} value={stage}>{stage}</option>)}<option value="unknown">阶段待了解</option></select></label><label className={styles.peopleFilter}><span>排序方式</span><select aria-label="人物排序方式" value={sortBy} onChange={event => setSortBy(event.target.value)}><option value="recent">最近更新</option><option value="signal">完整互动参考</option></select></label></div>
      {(query || stageFilter !== "all") && <div className={styles.filterStatus}><span>找到 {visiblePeople.length} / {ranked.length} 位人物</span><button type="button" className={styles.link} onClick={() => { setSearch(""); setStageFilter("all"); }}>清除筛选</button></div>}
      <div className={styles.people}>{visiblePeople.map((person) => <a key={person.id} className={styles.person} href={`/archive?subjectId=${encodeURIComponent(person.id)}`} onClick={event => { event.preventDefault(); switchView("people", person.id); }}><Avatar person={person} /><div><strong>{person.label}</strong><small>{person.stage || "关系阶段待了解"}</small><small>{person.signal?.comparable ? "完整互动参考" : person.signal?.score != null ? "片段估算 · 暂不参与排行" : person.savedChatAnalysis ? "已保存聊天分析" : "尚无可用聊天分析"}</small><small className={styles.personUpdated}>{person.updatedAt ? new Date(person.updatedAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) + " 更新" : "等待补充资料"}</small></div><span className={styles.personScore}>{person.signal?.score != null ? <>{person.signal.score}<small>互动参考 · 非喜欢程度</small></> : person.savedChatAnalysis || person.savedAnalysis ? <>报告<small>分析已保存</small></> : <>待补<small>互动参考</small></>}</span><ArrowUpRight className={styles.personArrow} size={18} /></a>)}</div>{ranked.length > 0 && !visiblePeople.length && <div className={styles.empty}><Search size={30}/><strong>没有找到符合条件的人物</strong><p>换个称呼或城市，或清除阶段筛选。</p><button type="button" className={styles.button} onClick={() => { setSearch(""); setStageFilter("all"); }}>查看全部人物</button></div>}{!ranked.length && <div className={styles.empty}><span className={styles.emptyMark} aria-hidden="true"><UsersRound size={30} /></span><strong>还没有人物档案。</strong>先给 TA 一个称呼，再慢慢补充。<p><a href="/person-new" className={styles.primary}>建立第一位人物</a></p></div>}</section>{state.enabled && !state.paused && <QuickCreate onCreated={async id => { await load(); switchView("people", id); setAvatarPrompt(id); }} />}</>}
      {tab === "self" && state.enabled && <SelfChatMemory enabled={state.enabled} paused={state.paused}/>}
      {tab === "self" && <ReportDetails title="补充或修改我的偏好" description="告诉成子你看重什么，建议会优先参考已确认资料"><QuickSelfProfile data={state.self} busy={busy} paused={state.paused} enabled={state.enabled} onSave={async patch => { if (!state.enabled && !await act({ action: "consent", enabled: true }, "档案已启用。")) return false; const latest = await archiveRequest<ArchiveState>("profile"); if (latest.paused || !latest.enabled) throw new Error("档案使用状态已变化，请刷新后继续。"); return act({ action: "self", data: mergeQuickSelfProfile(latest.self, patch) }, "资料已保存，之后会用于寻找共同点和适合你的话题。"); }} /></ReportDetails>}
      {tab === "self" && returnTo && <div className={styles.actions}><a className={styles.button} href={returnTo}><ArrowLeft size={17}/> {returnTo.startsWith("/report?") ? "回到刚才的报告 · 查看更新后的共同点" : "返回人物对照"}</a></div>}
      {tab === "self" && state.enabled && <div className={`${styles.layout} ${styles.footerGap}`}><div className={styles.column}><section className={styles.card}><div className={styles.sectionHead}><div className={styles.headerPerson}><Avatar person={{ label: "我", avatar: state.self.avatar }} /><h2>已保存的个人资料</h2></div><button className={styles.button} disabled={disabled} onClick={() => setEditing(!editing)}>{editing ? "收起编辑" : "编辑资料"}</button></div><ArchiveAvatar key="self" name="我的档案" disabled={disabled} onSaved={load} /><DataGrid fields={[["interests", "兴趣爱好"] as const, ["communicationStyle", "聊天习惯"] as const, ...basicFields, ...preferenceFields].filter(([key]) => !!state.self[key as keyof SelfData])} data={state.self} /><a className={styles.link} href="/analyze?kind=profile&target=self">导入我的资料截图 →</a></section>{editing && <SelfEditor data={state.self} busy={disabled} onSave={async data => { if (await act({ action: "self", data }, "我的资料与偏好已更新。")) setEditing(false); }} />}{state.self.momentsReport && !state.paused && <section className={styles.card}><MomentsReportView report={state.self.momentsReport} /><button className={styles.danger} disabled={busy} onClick={() => { if (window.confirm("删除这份朋友圈报告及相处评价？已核对的基础资料保留。")) void act({ action: "delete-moments", target: "self" }, "报告已删除。"); }}>删除这份朋友圈报告</button></section>}</div><aside className={styles.column}><section className={styles.card}><h2>我的已确认资料 · {accepted.length}</h2>{accepted.length ? factView(accepted) : <p className={styles.empty}>从简介、聊天中整理的资料，确认后保存在这里。</p>}</section><section className={styles.card}><h2>关系定位与沟通训练</h2><p>还没想清楚期待怎样的关系，可以从目标和边界开始。</p><a href="/positioning" className={styles.button}>择偶定位 →</a><a href="/chat?preset=practice" className={styles.link}>沟通练习 →</a></section></aside></div>}
      {selected && tab === "people" && <><div className={`${styles.tabs} ${styles.detailTabs}`} role="tablist" aria-label="人物详情">{([["overview", "现状"], ["trend", "历程"], ["profile", "双方资料"]] as const).map(([value,label])=><button role="tab" key={value} aria-selected={section===value||value==="overview"&&section==="evidence"} onClick={()=>switchSection(value)}>{label}</button>)}</div>
        {section==="overview"&&<PersonOverview person={selected} signal={signal} recent={recent} onSection={switchSection}/>}
        {section==="trend"&&<>
          {selected.relationshipContext ? <RelationshipJourney key={selected.id} context={selected.relationshipContext} friend={selected.label}/> : <ArchiveImportedActivity owner={ownerId} subjectId={selected.id} label={selected.label}/>}
          <ReportDetails title="补充线下经历与行动反馈" description="把通话、见面和建议的实际结果接入这段历程"><ArchiveFeedback key={`actions-${selected.id}`} subjectId={selected.id} disabled={state.paused||!state.enabled} revision={revision} facts={scopedFacts} onFactAction={act}/><ArchiveFeedback key={`events-${selected.id}`} subjectId={selected.id} disabled={state.paused||!state.enabled} revision={revision} facts={scopedFacts} onFactAction={act} view="events"/></ReportDetails>
        </>}
        {section==="profile"&&<>
          <section className={styles.card}><div className={styles.sectionHead}><h2><HeartHandshake size={20}/>我们之间</h2><a className={styles.link} href="/archive?tab=self">更新我的资料<ArrowUpRight size={15}/></a></div><p className={styles.muted}>只并列你们已经提供的资料，缺少的部分留待了解。</p><div className={styles.pairedProfiles}><div className={styles.pairedHeader}><span>相处维度</span><strong>我</strong><strong>{selected.label}</strong></div>{[["生活所在",state.self.city,selected.city],["关系期待",state.self.preferredRelationship,selected.relationshipStatus],["生活方式",state.self.lifestyle,selected.lifestyle],["看重的事",state.self.values,selected.values],["边界与底线",state.self.boundaries,selected.boundaries]].map(([label,own,other])=><div key={label}><span>{label}</span><p>{own||"待补充"}</p><p>{other||"待了解"}</p></div>)}</div>
          {selected.compatibility?.fitSummary&&<p className={styles.pairedReading}>{selected.compatibility.fitSummary}</p>}
          </section>
          <ReportDetails title={`${selected.label}的完整资料`} description="查看基础资料、头像，或纠正已知信息"><section className={styles.card}><div className={styles.sectionHead}><h2>人物资料</h2><button className={styles.button} disabled={disabled} onClick={()=>setEditing(!editing)}>{editing?"收起编辑":"编辑资料"}</button></div><ArchiveAvatar key={selected.id} subjectId={selected.id} name={selected.label} disabled={disabled} onSaved={load}/><DataGrid fields={personFields} data={personDisplayData(selected,scopedFacts)}/>{editing&&<PersonEditor person={selected} disabled={disabled} onSave={async data=>{if(await act({action:"save",id:selected.id,...data},"人物资料已更新。"))setEditing(false);}}/>}<div className={styles.actions}><a href={`/analyze?kind=profile&subjectId=${encodeURIComponent(selected.id)}`} className={styles.button}>补充资料图</a><button className={styles.danger} disabled={busy} onClick={()=>{if(window.confirm(`永久删除「${selected.label}」的档案、线索、记忆与关联分析报告？无法恢复。`))void act({action:"delete",id:selected.id},"人物档案已删除。");}}><Trash2 size={15}/>删除人物</button></div></section></ReportDetails>
          {accepted.length>0&&<ReportDetails title={`已确认资料与出处 · ${accepted.length} 条`} description="回看资料从哪里来，也可以删除不准确的信息">{factView(accepted)}</ReportDetails>}
          {selected.compatibility&&selected.compatibility.coverage>0&&<ReportDetails title="双方适配的详细依据" description="逐项核对相处需要与实际资料">{selected.compatibility.fit.filter(row=>row.status!=="待了解").map(row=><article className={styles.pairedFinding} key={row.dimension}><h3>{row.dimension} · {row.status}</h3><p>{row.conclusion}</p><small>我的资料：{row.selfNeed}<br/>对方资料：{row.reading}<br/>{row.evidence}</small></article>)}</ReportDetails>}
        </>}
        {section==="evidence"&&<section className={styles.card}><div className={styles.sectionHead}><h2>完整报告与依据</h2><button className={styles.link} onClick={()=>switchSection("overview")}><ArrowLeft size={15}/>返回现状</button></div>
          <div className={styles.reportEntries}>{chatReportId&&<a href={`/report?id=${encodeURIComponent(chatReportId)}`}><span><strong>完整聊天报告</strong><small>现状、变化、行动建议与原话</small></span><ArrowUpRight size={19}/></a>}{savedReport?.reportId&&<a href={`/report?id=${encodeURIComponent(savedReport.reportId)}`}><span><strong>朋友圈与人物线索</strong><small>动态、表达方式与相处启发</small></span><ArrowUpRight size={19}/></a>}</div>
          {!state.paused&&state.enabled&&evidenceReading&&!chatReportId&&<ReportDetails title="已有的相处解读" description="查看此前保存的详细内容"><CommunicationReading report={evidenceReading} hideApproach={!!evidenceMoments}/></ReportDetails>}
          {!state.paused&&state.enabled&&evidenceMoments&&!savedReport?.reportId&&<ReportDetails title="已有的朋友圈解读" description="查看此前保存的动态依据"><MomentsReportView report={evidenceMoments} hideFindings={!!evidenceReading}/></ReportDetails>}
          {!chatReportId&&!savedReport?.reportId&&!evidenceReading&&!evidenceMoments&&<><p>还没有分析报告，先补充材料。</p><AddMaterials subjectId={selected.id} label="补充材料"/></>}
        </section>}
      </>}
      <section className={`${styles.card} ${styles.privacy}`}><details><summary><ShieldCheck size={15} style={{ display: "inline", verticalAlign: "middle" }} /> 档案管理与隐私</summary><p className={styles.muted}>暂停后，后续对话停止读取和整理档案。撤回同意保留已有资料；清空会永久删除本账号全部档案、记忆及关联分析报告。</p><div className={styles.actions}>{state.enabled && <><button className={styles.button} disabled={busy} onClick={() => void act({ action: "pause", paused: !state.paused }, state.paused ? "档案已恢复。" : "档案已暂停。")}>{state.paused ? <Play size={16} /> : <Pause size={16} />}{state.paused ? "恢复档案" : "暂停档案"}</button><button className={styles.button} disabled={busy} onClick={() => void act({ action: "consent", enabled: false }, "已撤回同意，旧资料暂时保留。")}>撤回同意</button></>}<button className={styles.danger} disabled={busy} onClick={() => { if (window.confirm("永久删除本账号全部人物、记忆和分析报告？此操作无法恢复。")) void act({ action: "wipe", confirm: "DELETE_MY_ARCHIVE" }, "全部档案与关联报告已删除。"); }}><Trash2 size={15} /> 删除全部档案与报告</button></div></details></section>
    </>}
    {!loadFailed && error && <div className={`${styles.error} ${styles.toast}`} role="alert">{error}<button className={styles.link} onClick={() => void load()}>刷新档案</button></div>}{notice && <div className={`${styles.notice} ${styles.toast}`} role="status">{notice}</div>}
  </div></main>;
}

function Avatar({ person }: { person: { label: string; avatar?: string } }) { return person.avatar ? <img className={styles.avatar} src={person.avatar} alt={`${person.label}的头像`} /> : <span className={styles.avatar} data-tone={(person.label.charCodeAt(0) || 0) % 4} aria-hidden="true">{person.label.slice(0, 1)}</span>; }
function DataGrid({ fields, data }: { fields: readonly (readonly [string, string])[]; data: object }) { return <dl className={styles.dataGrid}>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{String((data as Record<string, unknown>)[key] || "待了解")}</dd></div>)}</dl>; }
function Field({ label, value, onChange, long = false, max = 100, required = false }: { label: string; value?: string; onChange: (value: string) => void; long?: boolean; max?: number; required?: boolean }) { return <label className={styles.field}><span>{label}</span>{long ? <textarea value={value || ""} maxLength={max} onChange={event => onChange(event.target.value)} /> : <input value={value || ""} maxLength={max} required={required} onChange={event => onChange(event.target.value)} />}</label>; }
function SelfEditor({ data, busy, onSave }: { data: SelfData; busy: boolean; onSave: (data: SelfData) => Promise<void> }) {
  const [draft, setDraft] = useState<SelfData>(data);
  return <section className={styles.card}><h2>编辑我的资料</h2><form onSubmit={event => { event.preventDefault(); void onSave(draft); }}><fieldset disabled={busy} className={styles.formfieldset}><div className={styles.fields}>{[...basicFields, ...preferenceFields].map(([key, label]) => <Field key={key} label={label} value={draft[key]} max={["preferredRelationship", "values", "boundaries", "goals"].includes(key) ? 800 : 100} long={["preferredRelationship", "values", "boundaries", "goals"].includes(key)} onChange={value => setDraft({ ...draft, [key]: value })} />)}</div><details><summary>更多资料与适配偏好权重</summary><div className={styles.fields}>{([["mbti", "MBTI（可留空）"], ["strengths", "我的优势"], ["growthAreas", "想成长的部分"]] as const).map(([key, label]) => <Field key={key} label={label} max={800} value={draft[key]} onChange={value => setDraft({ ...draft, [key]: value })} />)}{dimensions.map(({ key, label }) => <label className={styles.field} key={key}><span>{label}的重要程度</span><select value={draft.weights?.[key] ?? 3} onChange={event => setDraft({ ...draft, weights: { ...draft.weights, [key]: Number(event.target.value) } })}>{[1, 2, 3, 4, 5].map(value => <option value={value} key={value}>{value}</option>)}</select></label>)}</div></details><button className={`${styles.primary} ${styles.footerGap}`} type="submit">保存我的资料与偏好</button></fieldset></form></section>;
}
function PersonEditor({ person, disabled, onSave }: { person: Person; disabled: boolean; onSave: (data: Record<string, string>) => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, string>>(Object.fromEntries([["label", person.label], ...personFields.map(([key]) => [key, person[key] || ""])]));
  return <form className={`${styles.form} ${styles.footerGap}`} onSubmit={event => { event.preventDefault(); void onSave(draft); }}><fieldset className={styles.formfieldset} disabled={disabled}><div className={styles.fields}><Field label="称呼或代号" max={60} value={draft.label} required onChange={value => setDraft({ ...draft, label: value })} />{personFields.map(([key, label]) => <Field key={key} label={label} value={draft[key]} max={["notes", "values", "boundaries", "stage", "howMet"].includes(key) ? 800 : 100} long={["notes", "values", "boundaries"].includes(key)} onChange={value => setDraft({ ...draft, [key]: value })} />)}</div><button className={`${styles.primary} ${styles.footerGap}`} type="submit">保存人物资料</button></fieldset></form>;
}
function QuickCreate({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef("");
  return <section className={`${styles.card} ${styles.footerGap}`}><details><summary>只记下一个称呼 · 快速添加</summary><form className={styles.inlineForm} onSubmit={event => { event.preventDefault(); if (busy) return; setBusy(true); setError(""); requestId.current ||= crypto.randomUUID(); void archiveRequest<{ createdSubjectId: string }>("profile", { action: "create-manual", id: requestId.current, label: label.trim(), data: {}, confirmed: true }).then(async result => { await onCreated(result.createdSubjectId); setLabel(""); requestId.current = ""; }).catch(cause => setError(cause.message)).finally(() => setBusy(false)); }}><input className={styles.input} aria-label="新人物称呼" placeholder="人物称呼或代号" maxLength={60} required disabled={busy} value={label} onChange={event => setLabel(event.target.value)} /><button type="submit" className={styles.primary} disabled={busy || !label.trim()}>{busy ? "建立中…" : "建立档案"}</button></form>{error && <p className={styles.error} role="alert">{error}</p>}</details></section>;
}
