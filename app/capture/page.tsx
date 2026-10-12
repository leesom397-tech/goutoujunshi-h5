"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CheckCheck, Download, FileText, HardDrive, History, Images, Link2, LoaderCircle, MessageSquare, Monitor, Plug, Search, ShieldCheck, Square, Trash2, UploadCloud, X } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import { ScreenCapture, type CapturedFrame } from "@/components/ScreenCapture";
import { api, message, useAccount, AccountNotice, PersonSelect, hasPrice, priceLabel, WebError, type Json } from "@/components/web-analysis/client";
import { bridgeRequest, type BridgeHealth } from "@/lib/desktop-bridge-client";
import { saveCaptureBatch, listCaptureLibraries, getCaptureLibrary, pendingCaptureRecords, linkReportSources, removeCaptureLibrary, type CaptureLibrary, type CaptureLibrarySummary } from "@/lib/desktop-capture-vault";
import { type CaptureKind, type CaptureBatch, type StoredCaptureRecord } from "@/lib/desktop-capture";
import { CAPTURE_ANALYSIS_LIMIT, captureAnalysisInput, captureReadableText } from "@/lib/capture-analysis-input";
import ui from "@/components/AuroraUI.module.css";
import styles from "./capture.module.css";
import "@/components/web-analysis/web-analysis.css";

type Job = { status: string; progress?: number; message?: string; result?: CaptureBatch; error?: string | {message?:string} };
type Receipt = { requestId: string; libraryId: string; sourceIds: string[]; subjectId: string; kind: CaptureKind };
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => { const stop = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }; const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop(); });
const stored = <T,>(key: string): T | null => { try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch { return null; } };
const remember = (key: string, value: unknown) => { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); };

export default function CapturePage() {
  const account = useAccount(), owner: string = account.account?.account?.userId || "";
  const generation = useRef(0), abort = useRef<AbortController | null>(null), token = useRef(""), recordList = useRef<HTMLDivElement | null>(null), openingLibrary = useRef(0);
  const [method, setMethod] = useState<"desktop" | "window">("desktop"), [kind, setKind] = useState<CaptureKind>("chat"), [friend, setFriend] = useState(""), [wechatAccount, setWechatAccount] = useState(""), [code, setCode] = useState(""), [limit, setLimit] = useState(40), [health, setHealth] = useState<BridgeHealth | null>(null), [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false), [analyzing, setAnalyzing] = useState(false), [error, setError] = useState(""), [note, setNote] = useState(""), [jobId, setJobId] = useState(""), [progress, setProgress] = useState(0);
  const [library, setLibrary] = useState<CaptureLibrary | null>(null), [libraries, setLibraries] = useState<CaptureLibrarySummary[]>([]), [stats, setStats] = useState<{added:number;repeated:number;total:number}|null>(null), [query, setQuery] = useState(""), [selected, setSelected] = useState<string[]>([]), [subject, setSubject] = useState(""), [consent, setConsent] = useState(false), [receipt, setReceipt] = useState<Receipt | null>(null), [reportId, setReportId] = useState(""), [image, setImage] = useState<string | null>(null);
  const locked = busy || analyzing;
  const [recordPage, setRecordPage] = useState(0);
  const scopeKey = (name: string) => `chengzi-capture:${owner}:${name}`;
  useEffect(() => { const params = new URLSearchParams(window.location.search); if (params.get("kind") === "moments") { setKind("moments"); setLimit(10); } if (/Mac/i.test(navigator.platform)) setMethod("window"); }, []);
  useEffect(() => {
    const current = ++generation.current; abort.current?.abort(); token.current = "";
    setConnected(false); setLibrary(null); setLibraries([]); setSelected([]); setStats(null); setReceipt(null); setConsent(false); setFriend(""); setWechatAccount(""); setSubject(""); setQuery(""); setRecordPage(0); setReportId(""); setImage(null); setBusy(false); setAnalyzing(false); setJobId(""); setNote(""); setError("");
    if (!owner) return;
    void listCaptureLibraries(owner).then(items => { if (current === generation.current) setLibraries(items); }).catch(e => { if (current === generation.current) setError(message(e)); });
    const connection = stored<{token:string;expiresAt:number}>(`chengzi-capture:${owner}:connection`);
    if (connection && connection.expiresAt > Date.now()) { token.current = connection.token; setConnected(true); }
    const running = stored<{jobId:string}>(`chengzi-capture:${owner}:job`); if (running) setJobId(running.jobId);
    const previous = stored<Receipt>(`chengzi-capture:${owner}:analysis`);
    if (previous) void getCaptureLibrary(owner, previous.libraryId).then(value => { if (current !== generation.current || !value) return; setLibrary(value); setSelected(previous.sourceIds); setRecordPage(Math.floor(Math.max(0, value.records.findIndex(row => previous.sourceIds.includes(row.localId))) / 50)); setReceipt(previous); setKind(previous.kind); setSubject(previous.subjectId); setFriend(value.friend); setNote("上次的分析请求已保留，可继续取回结果。"); }).catch(e => { if (current === generation.current) setError(message(e)); });
    return () => { generation.current++; abort.current?.abort(); };
  }, [owner]);
  useEffect(() => { recordList.current?.scrollTo({ top: 0 }); }, [recordPage, query, library?.id]);
  const pending = library ? pendingCaptureRecords(library) : [];
  const chosen = library?.records.filter(r => selected.includes(r.localId)) || [];
  const isWindow = chosen.length > 0 && chosen.every(r => r.source.method === "screen-capture");
  const costKey = (library?.kind || kind) === "moments" ? "profile" : "analysisSmall";
  async function refreshLibraries(scope = owner, ticket = generation.current) { const items = await listCaptureLibraries(scope); if (ticket === generation.current) setLibraries(items); }
  function selectionIssue(value: CaptureLibrary, rows: StoredCaptureRecord[]) {
    const windowFrames = rows.length > 0 && rows.every(row => row.source.method === "screen-capture"), max = windowFrames ? 9 : CAPTURE_ANALYSIS_LIMIT[value.kind];
    if (rows.length > max) return `每批最多选择 ${max} ${windowFrames ? "张窗口截图" : value.kind === "chat" ? "条聊天" : "条动态"}，请先分析这一批，再处理其余原文。`;
    if (windowFrames) return rows.reduce((count, row) => count + (row.images?.length || 0), 0) > 9 ? "每批最多选择 9 张窗口截图。" : "";
    const chars = rows.reduce((count, row) => count + row.text.length, 0);
    if (chars > (value.kind === "chat" ? 10000 : 22000)) return "所选文字较长，请先分析这一批，再继续选择其余内容。";
    if (rows.some(row => row.text.length > 6000 || value.kind === "chat" && captureReadableText(row).length > 1780)) return "这条原文太长，暂不能整条加入本批，请使用文字导入或截图分析。";
    const photos = value.kind === "moments" ? rows.flatMap(row => row.images || []) : [];
    if (photos.length > 9 || photos.reduce((size, photo) => size + photo.data.length, 0) > 8_000_000) return "所选图片较多，请减少勾选后分批分析。";
    if (photos.some(photo => photo.data.length > 3_000_000)) return "这条动态的图片较大，请使用截图分析，或先缩小图片后导入。";
    return "";
  }
  function toggleRecord(record: StoredCaptureRecord, checked: boolean) {
    if (!library || locked || receipt) return;
    const next = checked ? [...new Set([...selected, record.localId])] : selected.filter(id => id !== record.localId);
    const issue = checked ? selectionIssue(library, library.records.filter(row => next.includes(row.localId))) : "";
    if (issue) { setError(issue); return; }
    setSelected(next); setConsent(false); setError("");
  }
  function mediaNotice(record: StoredCaptureRecord) {
    if (record.source.method === "screen-capture") return "";
    if (record.kind === "sticker" && !record.ocrTextVerified) return "这是表情包占位，未读取图中文字，不作为对方原话分析。";
    if (record.kind === "image") return record.images?.length ? "图片已保留。本次聊天文字分析不读取图片内容，可使用截图分析。" : "仅识别到图片占位，尚未读取图片内容。";
    if (record.kind === "other") return "这是媒体或系统提示，尚未读取为可分析的聊天正文。";
    return "";
  }
  function selectPending(value: CaptureLibrary) {
    const pendingRows = pendingCaptureRecords(value), max = pendingRows.every(r => r.source.method === "screen-capture") ? 9 : CAPTURE_ANALYSIS_LIMIT[value.kind];
    const ids: string[] = [], rows: StoredCaptureRecord[] = [];
    for (const row of pendingRows) {
      if (ids.length >= max) break;
      if (value.kind === "chat" && row.source.method !== "screen-capture" && !captureReadableText(row).trim()) continue;
      if (selectionIssue(value, [...rows, row])) continue;
      ids.push(row.localId); rows.push(row);
    }
    setSelected(ids); setQuery(""); setConsent(false);
    setRecordPage(Math.floor(Math.max(0, value.records.findIndex(r => r.localId === ids[0])) / 50));
  }
  async function accept(batch: CaptureBatch, scope = owner, ticket = generation.current) {
    const result = await saveCaptureBatch(scope, batch);
    if (ticket !== generation.current) return;
    if (library?.id !== result.library.id) setSubject("");
    setLibrary(result.library); setKind(batch.kind); setFriend(batch.friend); setStats(result); selectPending(result.library); setConsent(false); setReceipt(null); setReportId(""); setQuery("");
    await refreshLibraries(scope, ticket);
    if (ticket !== generation.current) return;
    setNote(result.added ? "采集完成。先核对原文与身份，再分析选中的内容。" : "没有新增材料。未完成分析的原文仍可继续处理。");
  }
  async function connect() {
    if (!owner) return;
    const ticket = generation.current; setBusy(true); setError("");
    try {
      const status = await bridgeRequest<BridgeHealth>("/health");
      if (ticket !== generation.current) return; setHealth(status);
      const pair = await bridgeRequest<{token:string;expiresIn:number}>("/pair", { body: { code: code.trim() } });
      if (ticket !== generation.current) return;
      token.current = pair.token; remember(scopeKey("connection"), { token: pair.token, expiresAt: Date.now() + (pair.expiresIn || 28800) * 1000 }); setConnected(true); setCode(""); setNote("已连接本机采集助手。选择好友后开始。");
    } catch (e) { if (ticket === generation.current) { setError(message(e)); setConnected(false); } }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  async function poll(id: string, ticket: number, scope: string) {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    for (let i = 0; i < 900; i++) {
      if (ticket !== generation.current) return;
      const job = await bridgeRequest<Job>(`/jobs/${encodeURIComponent(id)}`, { token: token.current, signal: controller.signal });
      if (ticket !== generation.current) return;
      setProgress(Math.min(100, Math.max(0, Number(job.progress) || 0))); setNote(job.message || "正在读取选定好友，请暂时不要切换微信窗口。");
      if (["done", "completed"].includes(job.status)) {
        if (!job.result) throw Error("任务完成，但没有返回可预览的材料。");
        await accept(job.result, scope, ticket); remember(`chengzi-capture:${scope}:job`, null); if (ticket === generation.current) setJobId(""); return;
      }
      if (["error", "failed", "cancelled"].includes(job.status)) {
        remember(`chengzi-capture:${scope}:job`, null); setJobId("");
        throw Error(typeof job.error === "string" ? job.error : job.error?.message || (job.status === "cancelled" ? "采集已停止，可重新选择范围。" : "这次采集未完成，请查看助手提示。"));
      }
      await wait(1400, controller.signal);
    }
    setNote("任务仍在本机运行，可以稍后继续查看。");
  }
  async function capture(resume = false) {
    if (!owner || !connected || receipt) return;
    if (!resume && !friend.trim()) { setError("先填写要采集的好友备注或昵称。"); return; }
    const ticket = generation.current, scope = owner; setBusy(true); setError(""); setProgress(0);
    try {
      const id = resume ? jobId : (await bridgeRequest<{jobId:string}>("/capture", { token: token.current, body: { kind, friend: friend.trim(), limit } })).jobId;
      if (ticket !== generation.current) return;
      setJobId(id); remember(scopeKey("job"), { jobId: id }); await poll(id, ticket, scope);
    } catch (e) { if (ticket === generation.current && !(e instanceof Error && e.name === "AbortError")) setError(message(e)); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  async function cancel() {
    if (!jobId) return;
    const ticket = generation.current, key = scopeKey("job"), controller = abort.current;
    try { await bridgeRequest(`/jobs/${jobId}/cancel`, { token: token.current, body: {} }); controller?.abort(); remember(key, null); if (ticket !== generation.current) return; setBusy(false); setJobId(""); setNote("采集已停止。"); } catch (e) { if (ticket === generation.current) setError(message(e)); }
  }
  async function openLibrary(id: string) {
    if (locked || receipt) return; const ticket = generation.current, opening = ++openingLibrary.current;
    try { const value = await getCaptureLibrary(owner, id); if (ticket !== generation.current || opening !== openingLibrary.current || !value) return; setLibrary(value); setKind(value.kind); setFriend(value.friend); setWechatAccount(value.account.startsWith("window:") ? value.account.slice(7) : ""); setSubject(""); selectPending(value); setReceipt(null); setConsent(false); setStats(null); setReportId(""); setQuery(""); } catch (e) { if (ticket === generation.current && opening === openingLibrary.current) setError(message(e)); }
  }
  async function removeLibrary() {
    if (!library || locked || receipt || !confirm("删除这台浏览器保存的采集原文？已保存的分析报告仍会保留，但这里的原文回看将不可用。")) return;
    const ticket = generation.current;
    try { await removeCaptureLibrary(owner, library.id); if (ticket !== generation.current) return; setLibrary(null); setSelected([]); setReceipt(null); remember(scopeKey("analysis"), null); await refreshLibraries(owner, ticket); } catch(e) { if (ticket === generation.current) setError(message(e)); }
  }
  async function framesReady(frames: CapturedFrame[]) {
    if (!owner || !friend.trim() || !wechatAccount.trim()) throw Error("请先填写微信好友和当前微信号，用于区分不同账号的材料。");
    const scope = owner, ticket = generation.current; setBusy(true);
    try { await accept({ version: 1, kind, friend: friend.trim(), account: `window:${wechatAccount.trim()}`, capturedAt: new Date().toISOString(), warnings: ["这是你授权共享的窗口画面。时间与说话人需要在截图分析中识别、核对；图片重复判断不代表消息已全部去重。"], records: frames.map((frame, i) => ({ id: `screen:${frame.id}`, kind: "image", sender: "", senderRole: "unknown", at: "", text: "", source: { label: `窗口采集 · 第 ${i + 1} 张`, method: "screen-capture", capturedAt: frame.at }, images: [{ mime: "image/jpeg", data: frame.data, name: `微信窗口-${i + 1}.jpg` }] })) }, scope, ticket); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  async function analyze() {
    if (!owner || !library || !chosen.length || locked) return;
    if (isWindow) {
      if (chosen.length > 9) { setError("每次最多分析 9 张窗口截图，请减少勾选。"); return; }
      remember(scopeKey("handoff"), { libraryId: library.id, sourceIds: chosen.map(r => r.localId) });
      window.location.assign(`/analyze?mode=${library.kind}&capture=1`); return;
    }
    if (!consent) { setError("请先确认所选原文与千问分析处理。"); return; }
    if (!hasPrice(account.account, costKey)) { setError("尚未读取分析价格，请刷新账户后重试。"); return; }
    const scope = owner, ticket = generation.current;
    const current: Receipt = receipt || { requestId: crypto.randomUUID(), libraryId: library.id, sourceIds: chosen.map(r => r.localId), subjectId: subject, kind: library.kind };
    const rows = current.sourceIds.map(id => library.records.find(r => r.localId === id)).filter((r): r is StoredCaptureRecord => !!r);
    const payload = { requestId: current.requestId, confirmed: true, kind: current.kind, friend: library.friend, subjectId: current.subjectId || null, records: rows.map(r => ({ localId: r.localId, kind: r.kind, sender: r.sender, senderRole: r.senderRole, at: r.at, text: r.text, ocrTextVerified: r.ocrTextVerified === true, images: library.kind === "moments" ? r.images || [] : [] })) };
    if (!receipt) { try { captureAnalysisInput(payload); } catch(e) { setError(message(e)); return; } }
    remember(scopeKey("analysis"), current); setReceipt(current); setAnalyzing(true); setError(""); setNote("正在分析选中的新增材料。原文已保留，离开后可继续取回报告。");
    try {
      const currentAccount = await api("/api/account/credits");
      if (currentAccount.account?.userId !== scope || ticket !== generation.current) throw Error("账户已变化，请返回原账号继续。");
      if (library.kind === "chat" && !receipt) await api("/api/web/settings", { consent: true, allowImageProcessing: true, selfSide: "right" });
      if (ticket !== generation.current) return;
      let restored: Json | null = null;
      if (receipt) { try { const saved = await api("/api/web/report?id=" + encodeURIComponent(current.requestId)); restored = { ...saved.report, reportId: saved.reportId }; } catch(e) { if (!(e instanceof WebError && e.status === 404)) throw e; } }
      const result = restored || await api("/api/web/capture/analyze", payload);
      if (ticket !== generation.current) return;
      setReportId(result.reportId); await linkReportSources(scope, result.reportId, { libraryId: library.id, sourceIds: current.sourceIds });
      if (ticket !== generation.current) return;
      remember(scopeKey("analysis"), null); setReceipt(null); setReportId(result.reportId); setConsent(false);
      const updated = await getCaptureLibrary(scope, library.id); if (ticket !== generation.current) return;
      if (updated) { setLibrary(updated); selectPending(updated); } await refreshLibraries(scope, ticket); if (ticket !== generation.current) return; void account.refresh();
      setNote("完整报告已保存。打开报告后，可从结论旁回看原记录。");
    } catch (e) {
      if (ticket !== generation.current) return; setError(message(e));
      if (e instanceof WebError && (e.details?.code === "CREDIT_RELEASED" || !e.details?.processing && e.status >= 400 && e.status !== 409 && e.status !== 0)) { remember(scopeKey("analysis"), null); setReceipt(null); }
      setNote("原文仍保存在这台浏览器，可继续重试；处理中或连接中断会沿用原请求。");
    } finally { if (ticket === generation.current) setAnalyzing(false); }
  }
  const visible = (library?.records || []).filter(r => !query || [r.text, r.sender, r.at, r.source.label].join(" ").includes(query));
  const pageCount = Math.max(1, Math.ceil(visible.length / 50)), currentPage = Math.min(recordPage, pageCount - 1);
  const display = visible.slice(currentPage * 50, (currentPage + 1) * 50);
  return <div className={ui.page}><WebNav/><main className={`${ui.wrap} ${styles.page}`}>
    <AuroraPageHero eyebrow="电脑微信 · 材料采集" title="把聊天带进来，少截几张图。" description="选定好友，采集聊天或朋友圈。原文先在本机预览，重复内容自动核对。"><a className={ui.secondary} href="/reports"><History size={17}/>历史报告</a><a className={ui.secondary} href="/analyze"><UploadCloud size={17}/>手动上传截图</a></AuroraPageHero>
    <ol className={styles.steps} aria-label="采集步骤">{["连接电脑微信", "采集并核对原文", "分析选中的内容"].map((text, i) => <li key={text} data-active={(reportId || analyzing || receipt ? 2 : library ? 1 : 0) === i}><span>{reportId || (i === 0 && (connected || library)) ? <Check size={18}/> : `0${i + 1}`}</span><strong>{text}</strong></li>)}</ol>
    <AccountNotice state={account}/>
    {receipt && <p className={styles.warning}>有一份分析尚待取回。请继续本次分析，完成后再切换材料；原请求会保留，避免重复处理。</p>}
    <div className={styles.layout}>
      <aside className={styles.controls}>
        <section className={styles.panel}><h2><Monitor size={22}/>选择采集方式</h2><div className={styles.methods}><button disabled={locked || !!receipt} aria-pressed={method === "desktop"} onClick={() => setMethod("desktop")}><Plug size={20}/><span>自动读取<small>Windows · 需启动助手</small></span></button><button disabled={locked || !!receipt} aria-pressed={method === "window"} onClick={() => setMethod("window")}><Monitor size={20}/><span>窗口采集<small>Mac / Windows</small></span></button></div>
          {method === "desktop" && <div className={styles.connect}><p>首次使用：下载并解压助手，双击启动，填入助手显示的连接码。</p><a className={ui.secondary} href="/downloads/chengzi-wechat-collector-windows.zip" download><Download size={18}/>下载 Windows 采集助手</a><small>Windows 10 / 11 · 微信 4.1 系列 · 无需安装 Python</small>{connected ? <div className={styles.connected}><CheckCheck size={19}/><strong>已连接本机助手</strong><button disabled={locked} onClick={() => { token.current = ""; setConnected(false); remember(scopeKey("connection"), null); }}>断开</button></div> : <div className={styles.pair}><label htmlFor="capture-code">助手连接码</label><div><input id="capture-code" inputMode="text" autoCapitalize="characters" autoComplete="off" maxLength={8} value={code} onChange={e => setCode(e.target.value)} placeholder="输入连接码" disabled={locked}/><button className={ui.primary} disabled={!owner || locked || code.trim().length < 4} onClick={() => void connect()}>{busy ? <LoaderCircle size={17}/> : <Link2 size={17}/>}连接</button></div></div>}{health?.message && !health.ready && <p>{health.message}</p>}</div>}
          <div className={styles.kinds} aria-label="采集内容">{([{key:"chat",label:"聊天记录",Icon:MessageSquare},{key:"moments",label:"朋友圈",Icon:Images}] as const).map(({key,label,Icon}) => <button disabled={locked || !!receipt} aria-pressed={kind === key} key={key} onClick={() => { setKind(key); setLimit(key === "chat" ? 40 : 10); }}><Icon size={18}/>{label}</button>)}</div>
          <label className={styles.field}>微信好友<input value={friend} disabled={locked} maxLength={100} onChange={e => setFriend(e.target.value)} placeholder="填写准确的好友备注或昵称"/></label>
          {method === "desktop" ? <><label className={styles.field}>这次读取<select value={limit} disabled={locked} onChange={e => setLimit(Number(e.target.value))}>{(kind === "chat" ? [20,40,80,120] : [5,10,20]).map(n => <option key={n} value={n}>最近 {n} 条{kind === "chat" ? "消息" : "动态"}</option>)}</select></label><button className={`${ui.primary} ${styles.full}`} disabled={!owner || !connected || locked || !!receipt || !friend.trim() || !!jobId} onClick={() => void capture()}><Download size={18}/>开始采集{kind === "chat" ? "聊天" : "朋友圈"}</button>{jobId && <div className={styles.job}><p role="status">{busy ? note : "有一项采集任务可继续查看"}</p><progress max={100} value={progress} aria-label="采集进度"/>{!busy && <button className={ui.secondary} onClick={() => void capture(true)} disabled={!connected}>继续查看</button>}<button className={ui.secondary} onClick={() => void cancel()}><Square size={15}/>停止采集</button></div>}</> : <label className={styles.field}>当前微信号<input value={wechatAccount} disabled={locked} maxLength={100} onChange={e => setWechatAccount(e.target.value)} placeholder="用于区分你使用的不同微信账号"/><small>仅在这台浏览器中区分材料，不是登录密码。</small></label>}
        </section>
        {libraries.length > 0 && <section className={styles.panel}><h2><HardDrive size={21}/>本机原文</h2><p className={styles.muted}>同一浏览器继续使用，已分析条目自动跳过。</p><div className={styles.libraries}>{libraries.map(item => <button key={item.id} disabled={locked || !!receipt} aria-pressed={library?.id === item.id} onClick={() => void openLibrary(item.id)}>{item.kind === "chat" ? <MessageSquare size={19}/> : <Images size={19}/>}<span><strong>{item.friend}</strong><small>{item.kind === "chat" ? "聊天" : "朋友圈"} · {item.total} 条 · 待分析 {item.pending} 条</small></span><ArrowRight size={17}/></button>)}</div></section>}
      </aside>
      <div className={styles.workspace}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {note && !busy && <p className={styles.status} role="status"><CheckCheck size={18}/>{note}</p>}
        {method === "window" && <ScreenCapture sessionKey={JSON.stringify([owner, kind, friend.trim(), wechatAccount.trim()])} disabled={!owner || locked || !!receipt || !friend.trim() || !wechatAccount.trim()} onReady={framesReady}/>}
        {library ? <section className={styles.preview}><div className={styles.previewHead}><div><span className={styles.eyebrow}>原文预览 · 仅在本机保存</span><h2>{library.friend}<small>{library.kind === "chat" ? "聊天记录" : "朋友圈"}</small></h2></div><button className={styles.delete} disabled={locked || !!receipt} onClick={() => void removeLibrary()} aria-label="删除本机原文"><Trash2 size={18}/></button></div>
          <div className={styles.stats}><div><strong>{stats?.added ?? pending.length}</strong><span>{stats ? "本次新增" : "尚未分析"}</span></div><div><strong>{stats?.repeated ?? library.records.length - pending.length}</strong><span>{stats ? "重复跳过" : "已分析"}</span></div><div><strong>{library.records.length}</strong><span>本机共保存</span></div></div>
          {library.warnings.length > 0 && <p className={styles.warning}>{library.warnings.join(" ")}</p>}
          <div className={styles.previewTools}><label><Search size={18}/><input placeholder="搜索原文、时间或说话人" value={query} onChange={e => { setQuery(e.target.value); setRecordPage(0); }}/></label><button disabled={locked || !!receipt} onClick={() => selectPending(library)}>选择待分析</button></div>
          <div ref={recordList} className={styles.records} aria-label="采集原文列表">{display.map(record => { const done = !pending.some(r => r.localId === record.localId), notice = mediaNotice(record); return <article key={record.localId} data-selected={selected.includes(record.localId)}><label className={styles.recordCheck}><input type="checkbox" checked={selected.includes(record.localId)} disabled={locked || done || !!receipt} onChange={e => toggleRecord(record,e.target.checked)}/><span><strong>{library.kind === "chat" ? record.senderRole === "self" ? "我" : record.senderRole === "other" ? library.friend : record.sender || "身份待核对" : `第 ${library.records.indexOf(record) + 1} 条动态`}</strong><small>{record.at || "原文未显示时间"}{done ? " · 已分析" : ""}</small></span></label>{record.text && <p>{record.text}</p>}{record.images?.length ? <div className={styles.recordImages}>{record.images.map((img,n) => <button key={n} onClick={() => setImage(`data:${img.mime};base64,${img.data}`)} aria-label={`查看${record.source.label}的图片${n+1}`}><img src={`data:${img.mime};base64,${img.data}`} alt={img.name}/></button>)}</div> : null}{notice && <p className={styles.mediaNotice}><Images size={16}/>{notice}</p>}<small className={styles.source}>{record.source.label}{record.kind === "sticker" ? " · 表情包" : ""}</small></article>; })}{!display.length && <p className={styles.muted}>没有找到匹配的原文，请换个关键词。</p>}</div>
          <nav className={styles.pagination} aria-label="原文分页"><p className={styles.pageSummary}>{visible.length ? `${currentPage * 50 + 1}–${Math.min((currentPage + 1) * 50, visible.length)}` : "0"} / {visible.length} 条 · 已选 {selected.length} 条</p><div><button className={ui.secondary} disabled={currentPage === 0} onClick={() => setRecordPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pageCount}</span><button className={ui.secondary} disabled={currentPage >= pageCount - 1} onClick={() => setRecordPage(currentPage + 1)}>下一页</button></div></nav>
          <div className={styles.analysis}><div><h3><FileText size={21}/>分析选中的 {chosen.length} 条</h3><p>只处理你勾选的材料。{isWindow ? "下一步核对截图顺序和左右身份。" : `每批最多 ${CAPTURE_ANALYSIS_LIMIT[library.kind]} 条，较长内容可分批处理。`}</p></div>{!isWindow && <><PersonSelect people={account.people} value={subject} onChange={setSubject} disabled={locked || !!receipt}/><label className={styles.consent}><input type="checkbox" checked={consent} disabled={locked} onChange={e => setConsent(e.target.checked)}/><span>我已核对身份与材料，有权提供所选内容，并同意发送给阿里云百炼千问分析。</span></label></>}
          {reportId && <a className={styles.reportLink} href={`/report?id=${reportId}`}><CheckCheck size={20}/><span>完整报告已保存<strong>打开报告，回看原文依据</strong></span><ArrowRight size={20}/></a>}
          <button className={`${ui.primary} ${styles.full}`} disabled={locked || !chosen.length || (!isWindow && (!consent || !hasPrice(account.account,costKey)))} onClick={() => void analyze()}>{analyzing ? <><LoaderCircle size={18} className={styles.spin}/>正在分析，请稍候…</> : isWindow ? <>进入截图分析<ArrowRight size={18}/></> : <>{receipt ? "继续本次分析" : "分析选中材料"}<span> · {priceLabel(account.account,costKey)}</span><ArrowRight size={18}/></>}</button>
          {library.reportLinks.length > 0 && <div className={styles.reportHistory}><History size={16}/>这份原文的报告{library.reportLinks.slice(-4).reverse().map((link,i) => <a key={link.reportId} href={`/report?id=${link.reportId}`}>{i === 0 ? "最近一次" : `此前报告 ${i}`}<ArrowRight size={13}/></a>)}</div>}</div>
        </section> : method === "desktop" && <section className={styles.empty}><div className={styles.emptyIllustration}><MessageSquare size={50}/><ArrowRight size={26}/><FileText size={50}/></div><span className={styles.eyebrow}>从采集到原文，一眼看清</span><h2>先选好友，再把原文带进来。</h2><p>完成后，这里会列出消息或动态，标明新增与重复条数。勾选需要分析的内容，就能得到可回看依据的报告。</p><div className={styles.emptyFeatures}><span><CheckCheck size={19}/>重复核对</span><span><Search size={19}/>原文可查</span><span><ShieldCheck size={19}/>确认后分析</span></div></section>}
      </div>
    </div>
    {image && <div className={styles.imageModal} role="dialog" aria-modal="true" aria-label="来源截图" onClick={() => setImage(null)}><button onClick={() => setImage(null)} aria-label="关闭来源截图"><X size={23}/></button><img src={image} alt="来源截图完整预览" onClick={e => e.stopPropagation()}/></div>}
  </main></div>;
}
