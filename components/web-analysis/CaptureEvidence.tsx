"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Clock3, FileSearch, MessageCircle, Search, UserRound, X } from "lucide-react";
import { readReportSources, type StoredCaptureRecord } from "@/lib/desktop-capture-vault";
import styles from "./CaptureEvidence.module.css";

type SourceLink = NonNullable<Awaited<ReturnType<typeof readReportSources>>>;
type Selection = { quote?: string; sourceIds?: string[]; label?: string };
type EvidenceContext = { ownerId?: string; reportId?: string; visible: boolean; open: (selection: Selection, trigger: HTMLElement) => void };
type ProviderProps = { ownerId?: string; reportId?: string; captureOrigin?: boolean; children: ReactNode };
const Context = createContext<EvidenceContext | null>(null);
const plain = (value: unknown) => typeof value === "string" ? value.trim() : "";
const normalized = (value: string) => value.replace(/[\s“”‘’「」『』，。！？：；、,.!?;:'"()（）]/gu, "");

function quotedParts(value: string) {
  return [...new Set([value, ...Array.from(value.matchAll(/[“「『"]([^”」』"]+)[”」』"]/gu), item => item[1])].map(normalized).filter(Boolean))];
}

function matchingRecords(link: SourceLink, selection: Selection) {
  if (selection.sourceIds?.length) {
    const ids = new Set(selection.sourceIds);
    return link.records.filter(record => ids.has(record.localId));
  }
  if (!selection.quote) return [];
  const parts = quotedParts(selection.quote);
  const matched = link.records.filter(record => {
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

/** A report stores only source IDs; raw capture records stay in this owner's browser vault. */
export function CaptureEvidenceProvider(props: ProviderProps) {
  const parent = useContext(Context);
  if (parent && parent.ownerId === props.ownerId && parent.reportId === props.reportId) return <>{props.children}</>;
  return <CaptureEvidenceScope {...props}/>;
}

function CaptureEvidenceScope({ ownerId, reportId, captureOrigin = false, children }: ProviderProps) {
  const [loaded, setLoaded] = useState<{ owner: string; report: string; link: SourceLink | null; error: string } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null), [search, setSearch] = useState(""), [limit, setLimit] = useState(24);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null);
  const restore = useRef<{ x: number; y: number; overflow: string } | null>(null), headingId = useId();
  const current = loaded && loaded.owner === ownerId && loaded.report === reportId ? loaded : null;
  const link = current?.link || null, visible = !!ownerId && !!reportId && (captureOrigin || !!link);

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
    }).catch(() => { if (active) setLoaded({ owner: ownerId, report: reportId, link: null, error: "浏览器暂时无法读取本地来源。请允许本站使用本地存储后重试。" }); });
    return () => { active = false; };
  }, [ownerId, reportId]);
  useEffect(() => () => { if (restore.current) document.documentElement.style.overflow = restore.current.overflow; }, []);

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
  const isMoments = link?.kind === "moments";
  const close = () => dialog.current?.close();

  return <Context.Provider value={{ ownerId, reportId, visible, open }}>
    {visible && <div className={styles.sourceBar} data-capture-sources><FileSearch size={20}/><span>{link ? `本次采集 · ${link.records.length} 条原记录` : "本报告来自微信采集"}</span><button type="button" onClick={event => open({ label: "本次分析的原始记录" }, event.currentTarget)}>查看原始记录<ArrowUpRight size={16}/></button></div>}
    {children}
    <dialog ref={dialog} className={styles.drawer} aria-labelledby={headingId} data-capture-evidence-dialog onClose={() => { restorePosition(); setSelection(null); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right) close(); } }}>
      <header className={styles.header}><div><span>回看分析依据</span><h2 id={headingId}>{isMoments ? "原始朋友圈动态" : "原始聊天记录"}</h2></div><button type="button" aria-label="关闭原始记录" onClick={close}><X size={22}/></button></header>
      {!current ? <p className={styles.empty}>正在读取这台设备保存的来源…</p> : !link || !link.records.length ? <div className={styles.empty}><FileSearch size={30}/><h3>这台设备未保存本报告的原始来源</h3><p>{current.error || "原记录只保存在采集时使用的浏览器中。请回到当时的设备和浏览器查看；清除本地数据后无法从报告还原原文。"}</p><button type="button" onClick={close}>返回报告</button></div> : <>
        <div className={styles.context}><strong>{selection?.label || "这条判断引用的材料"}</strong>{selection?.quote && <blockquote>{selection.quote}</blockquote>}<p>{matches.length ? `找到 ${matches.length} 条对应原记录${matches.length > 1 ? "，请结合时间与说话人核对" : ""}。` : selection?.quote || selection?.sourceIds?.length ? "未能精确定位这段引用，以下为本次分析关联的原记录。" : `共 ${link.records.length} 条，按本次分析的材料顺序呈现。`}</p></div>
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
    <header><strong>{frame ? `第 ${ordinal} 张采集画面` : isMoments ? `第 ${ordinal} 条动态` : `第 ${ordinal} 条消息`}</strong>{!frame && <span><UserRound size={15}/>{record.sender || (isMoments ? "作者未识别" : "说话人未识别")}</span>}</header>
    {record.source.method === "video-import" ? <p className={styles.time}><Clock3 size={15}/>录屏位置 {time} · 消息时间以画面原文为准</p> : !frame && <p className={styles.time}><Clock3 size={15}/>{record.at || "未识别时间"}</p>}
    {(record.text || !frame) && <p className={styles.original}>{record.text || "这条记录没有识别出的文字。"}</p>}
    {images.length > 0 && <div className={styles.images}>{images.map((src, index) => <img key={index} src={src} alt={`第 ${ordinal} 条记录的第 ${index + 1} 张附图`} loading="lazy"/>)}</div>}
    {record.source?.label && <p className={styles.sourceLabel}>{record.source.label}</p>}
  </article>;
}

/** Place immediately beside an evidence quote. Ordinary reports render no new action. */
export function CaptureEvidence({ quote, sourceIds, label = "回看原记录" }: { quote?: unknown; sourceIds?: string[]; label?: string }) {
  const context = useContext(Context);
  if (!context?.visible) return null;
  return <button className={styles.evidenceLink} type="button" data-capture-evidence onClick={event => context.open({ quote: plain(quote), sourceIds, label }, event.currentTarget)}><MessageCircle size={16}/>{label}<ArrowUpRight size={14}/></button>;
}
