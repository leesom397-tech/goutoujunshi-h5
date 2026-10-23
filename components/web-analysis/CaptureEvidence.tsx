"use client";

import {captureMaterialLabel,captureProfileMaterial} from "@/lib/capture-material";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Clock3, FileSearch, MessageCircle, Search, UserRound, X } from "lucide-react";
import { type StoredCaptureRecord } from "@/lib/desktop-capture-vault";
import { readSyncedReportSources as readReportSources } from "@/lib/capture-cloud-client";
import { reportPersonLabel, reportSenderLabel } from "@/components/report-person-label";
import styles from "./CaptureEvidence.module.css";
import { readReportLibrarySources } from "./ReportSourceLibrary";

type SourceLink = NonNullable<Awaited<ReturnType<typeof readReportSources>>>;
type Selection = { quote?: string; sourceIds?: string[]; label?: string; libraryId?: string; sourceKind?: string };
type EvidenceContext = { ownerId?: string; reportId?: string; visible: boolean; open: (selection: Selection, trigger: HTMLElement) => void };
type ProviderProps = { ownerId?: string; reportId?: string; captureOrigin?: boolean; fullHistory?: boolean; historyKind?: 'chat' | 'moments'; historyCount?: number; showSourceBar?: boolean; children: ReactNode };
const Context = createContext<EvidenceContext | null>(null);
export function useCaptureEvidenceContext() { return useContext(Context); }
const plain = (value: unknown) => typeof value === "string" ? value.trim() : "";
const normalized = (value: string) => value.replace(/[\s“”‘’「」『』，。！？：；、,.!?;:'"()（）]/gu, "");

function quotedParts(value: string) {
  return [...new Set([value, ...Array.from(value.matchAll(/[“「『"]([^”」』"]+)[”」』"]/gu), item => item[1])].map(normalized).filter(Boolean))];
}

function matchingRecords(link: SourceLink, selection: Selection) {
  const allRecords = [...link.records, ...(link.memoryRecords || [])];
  if (selection.sourceIds?.length) {
    const ids = new Set(selection.sourceIds);
    return allRecords.filter(record => ids.has(record.localId));
  }
  if (!selection.quote) return [];
  const parts = quotedParts(selection.quote);
  const matched = allRecords.filter(record => {
    const value = normalized(plain(record.text));
    return value && parts.some(part => part === value || part.length >= 4 && value.includes(part) || value.length >= 4 && part.includes(value));
  });
  if (matched.length || link.kind !== "moments") return matched;
  const ids = new Set(Array.from(selection.quote.matchAll(/第\s*(\d+)\s*条动态/gu), match => link.sourceIds[Number(match[1]) - 1]).filter(Boolean));
  return link.records.filter(record => ids.has(record.localId));
}

function imageSource(image: { mime?: string; data?: string }) {
  if (typeof image.data !== "string") return "";
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(image.data)) return image.data;
  if (/^image\/(?:png|jpeg|webp)$/.test(image.mime || "") && /^[A-Za-z0-9+/=\s]+$/.test(image.data)) return `data:${image.mime};base64,${image.data}`;
  return "";
}

/** Resolve original sources locally, or from this authenticated owner's synced library. */
export function CaptureEvidenceProvider(props: ProviderProps) {
  const parent = useContext(Context);
  if (parent && parent.ownerId === props.ownerId && parent.reportId === props.reportId) return <>{props.children}</>;
  return <CaptureEvidenceScope {...props}/>;
}

function CaptureEvidenceScope({ ownerId, reportId, captureOrigin = false, fullHistory = false, historyKind = 'chat', historyCount, showSourceBar = true, children }: ProviderProps) {
  const [loaded, setLoaded] = useState<{ owner: string; report: string; link: SourceLink | null; error: string } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null), [search, setSearch] = useState(""), [limit, setLimit] = useState(24);
  const [librarySources,setLibrarySources]=useState<{key:string;link:SourceLink|null;error:string}|null>(null);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null);
  const restore = useRef<{ x: number; y: number; overflow: string } | null>(null), headingId = useId();
  const current = loaded && loaded.owner === ownerId && loaded.report === reportId ? loaded : null;
  const baseLink=current?.link||null,libraryKey=selection?.libraryId?JSON.stringify([ownerId,reportId,selection.libraryId,selection.sourceIds||[]]):"";
  const libraryCurrent=librarySources?.key===libraryKey?librarySources:null;
  const link = libraryKey ? libraryCurrent?.link||null : baseLink, visible = !!ownerId && !!reportId && (captureOrigin || !!baseLink);
  const sourceReady=libraryKey?!!libraryCurrent:!!current;
  const sourceError=libraryKey?libraryCurrent?.error:current?.error;

  function restorePosition() {
    if (restore.current) {
      document.documentElement.style.overflow = restore.current.overflow;
      window.scrollTo({ left: restore.current.x, top: restore.current.y, behavior: "instant" });
      restore.current = null;
    }
    trigger.current?.focus({ preventScroll: true }); trigger.current = null;
  }

  useEffect(() => {
    let active = true;
    setLoaded(null); setSelection(null); dialog.current?.close(); restorePosition();
    if (ownerId && reportId) void readReportSources(ownerId, reportId).then(value => {
      if (active) setLoaded({ owner: ownerId, report: reportId, link: value, error: "" });
    }).catch(() => { if (active) setLoaded({ owner: ownerId, report: reportId, link: null, error: "原文暂时无法读取，请检查网络后重试。已同步材料需登录同一账号查看。" }); });
    return () => { active = false; };
  }, [ownerId, reportId]);
  useEffect(() => () => { if (restore.current) document.documentElement.style.overflow = restore.current.overflow; }, []);
  useEffect(()=>{
    if(!libraryKey||!ownerId||!selection?.libraryId){setLibrarySources(null);return;}
    let active=true;const controller=new AbortController();
    void readReportLibrarySources(ownerId,selection.libraryId,selection.sourceIds||[],controller.signal).then(value=>{if(active)setLibrarySources({key:libraryKey,link:value,error:""});}).catch(cause=>{if(active)setLibrarySources({key:libraryKey,link:null,error:cause instanceof Error?cause.message:"原始材料暂时无法读取。"});});
    return()=>{active=false;controller.abort();};
  },[libraryKey]);

  function open(next: Selection, target: HTMLElement) {
    if (!visible) return;
    trigger.current = target; setSelection(next); setSearch(""); setLimit(24);
    restore.current = { x: window.scrollX, y: window.scrollY, overflow: document.documentElement.style.overflow };
    requestAnimationFrame(() => { if (dialog.current && !dialog.current.open) { dialog.current.showModal(); document.documentElement.style.overflow = "hidden"; } });
  }

  const matches = link && selection ? matchingRecords(link, selection) : [];
  const scoped = matches.length ? matches : link?.records || [];
  const query = normalized(search);
  const shown = query ? scoped.filter(record => normalized(`${record.sender} ${record.at} ${record.text}`).includes(query)) : scoped;
  const isMoments = link?.kind === "moments" || selection?.sourceKind === "moments";
  const totalLabel = typeof historyCount === "number" && Number.isFinite(historyCount) && historyCount > 0 ? `全部已导入 ${historyCount} 条${historyKind==='moments'?'动态':'记录'}` : historyKind==='moments'?"完整朋友圈报告":"完整聊天报告";
  const close = () => dialog.current?.close();

  return <Context.Provider value={{ ownerId, reportId, visible, open }}>
    {visible && showSourceBar && <div className={styles.sourceBar} data-capture-sources><FileSearch size={20}/><span>{fullHistory ? `${totalLabel}${baseLink ? ` · 报告附 ${baseLink.records.length} 条原话依据` : ""}` : baseLink ? `本次采集 · ${baseLink.records.length} 条原记录` : "本报告来自微信采集"}</span><button type="button" onClick={event => open({ label: fullHistory ? "这份报告附带的原话依据" : "本次分析的原始记录" }, event.currentTarget)}>{fullHistory ? "查看原话依据" : "查看原始记录"}<ArrowUpRight size={16}/></button></div>}
    {children}
    <dialog ref={dialog} className={styles.drawer} aria-labelledby={headingId} data-capture-evidence-dialog onClose={() => { restorePosition(); setSelection(null); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right) close(); } }}>
      <header className={styles.header}><div><span>回看分析依据</span><h2 id={headingId}>{isMoments ? "原始朋友圈动态" : "原始聊天记录"}</h2></div><button type="button" aria-label="关闭原始记录" onClick={close}><X size={22}/></button></header>
      {!sourceReady ? <p className={styles.empty}>正在读取原始记录…</p> : !link || !link.records.length ? <div className={styles.empty}><FileSearch size={30}/><h3>{libraryKey?"这条依据暂时无法打开":"这份报告的原始来源尚未同步"}</h3><p>{sourceError || (libraryKey?"这条原记录已删除或尚未同步。请回到采集电脑核对材料。":"请在采集电脑打开「已导入聊天」，对这份材料启用跨端同步。已删除且未同步的原文无法从报告还原。")}</p><button type="button" onClick={close}>返回报告</button></div> : <>
        <div className={styles.context}><strong>{selection?.label || "这条判断引用的材料"}</strong>{selection?.quote && <blockquote>{selection.quote}</blockquote>}<p>{matches.length ? `找到 ${matches.length} 条对应原记录${matches.length > 1 ? "，请结合时间与说话人核对" : ""}。` : selection?.quote || selection?.sourceIds?.length ? "未能精确定位这段引用，以下为本次分析关联的原记录。" : fullHistory ? `这里展示报告附带的 ${link.records.length} 条原话依据；完整${isMoments?'朋友圈':'聊天'}的分析范围见报告。` : `共 ${link.records.length} 条，按本次分析的材料顺序呈现。`}</p></div>
        <label className={styles.search}><Search size={18}/><input aria-label="在本次原记录中查找" placeholder="查找文字、说话人或时间" value={search} onChange={event => { setSearch(event.target.value); setLimit(24); }}/></label>
        {link.records.length < link.sourceIds.length && <p className={styles.localNote}>这台设备缺少部分关联原文，以下仅显示仍保存的 {link.records.length} 条。</p>}
        <div className={styles.records}>{shown.slice(0, limit).map(record => <CaptureRecord key={record.localId} record={record} ordinal={link.sourceIds.indexOf(record.localId) + 1} isMoments={isMoments}/>)}</div>
        {!shown.length && <p className={styles.empty}>这组原记录里没有匹配的文字，试试更短的关键词。</p>}
        {shown.length > limit && <button className={styles.more} type="button" onClick={() => setLimit(value => value + 24)}>再看 24 条 · 还有 {shown.length - limit} 条</button>}
        <p className={styles.localNote}>原文来自你确认采集的材料；图片和无法识别的部分分别保留，不补写为原话。</p>
      </>}
    </dialog>
  </Context.Provider>;
}

function CaptureRecord({ record, ordinal, isMoments }: { record: StoredCaptureRecord; ordinal: number; isMoments: boolean }) {
  const images = (record.images || []).map(imageSource).filter(Boolean);
  const frame = ["screen-capture", "video-import"].includes(String(record.source.method));
  const videoSeconds = Number(record.source.videoTime) || 0;
  const time = `${Math.floor(videoSeconds / 60).toString().padStart(2,"0")}:${Math.floor(videoSeconds % 60).toString().padStart(2,"0")}`;
  return <article className={styles.record} data-capture-record={record.localId}>
    <header><strong>{ordinal === 0 ? "已导入历史 · 资料依据" : frame ? `第 ${ordinal} 张采集画面` : isMoments ? `第 ${ordinal} 条动态` : `第 ${ordinal} 条消息`}</strong>{!frame && <span><UserRound size={15}/>{reportSenderLabel(record.senderRole, record.sender)}</span>}</header>
    {record.source.method === "video-import" ? <p className={styles.time}><Clock3 size={15}/>录屏位置 {time} · 消息时间以画面原文为准</p> : !frame && <p className={styles.time}><Clock3 size={15}/>{captureProfileMaterial(record.source)?"采集时的个人展示资料":record.at || "未识别时间"}</p>}
    {(record.text || !frame) && <p className={styles.original}>{record.text || "这条记录没有识别出的文字。"}</p>}
    {images.length > 0 && <div className={styles.images}>{images.map((src, index) => <img key={index} src={src} alt={`第 ${ordinal} 条记录的第 ${index + 1} 张附图`} loading="lazy"/>)}</div>}
    {record.source.cloudMediaUnavailable===true&&<p className={styles.localNote}>这条记录的图片尚未同步完整，请在采集电脑继续同步。</p>}
    {(captureProfileMaterial(record.source)||record.source.pinned===true)&&<p className={styles.sourceLabel}>{captureMaterialLabel(record.source)}</p>}
    {record.source?.label && <p className={styles.sourceLabel}>{reportPersonLabel(record.source.label)}</p>}
  </article>;
}

/** Place immediately beside an evidence quote. Ordinary reports render no new action. */
export function CaptureEvidence({ quote, sourceIds, libraryId, sourceKind, label = "回看原记录" }: { quote?: unknown; sourceIds?: string[]; libraryId?: string; sourceKind?: string; label?: string }) {
  const context = useContext(Context);
  if (!context?.visible) return null;
  return <button className={styles.evidenceLink} type="button" data-capture-evidence onClick={event => context.open({ quote: plain(quote), sourceIds, label, libraryId, sourceKind }, event.currentTarget)}><MessageCircle size={16}/>{label}<ArrowUpRight size={14}/></button>;
}
