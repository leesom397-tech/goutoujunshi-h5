"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CheckCheck, Cloud, RefreshCw, Download, FileText, HardDrive, History, Images, Link2, LoaderCircle, MessageSquare, Monitor, Plug, Search, ShieldCheck, Smartphone, Square, Trash2, UploadCloud, FileVideo, X } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { FirstUseTour } from "@/components/FirstUseTour";
import {CaptureCoverage} from "@/components/CaptureCoverage";
import {captureCoverage,captureMediaNotice} from "@/lib/capture-coverage";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import { ScreenCapture, type CapturedFrame } from "@/components/ScreenCapture";
import { VideoImport, type ImportedVideoFrame, type VideoImportContext } from "@/components/VideoImport";
import { api, message, useAccount, AccountNotice, PersonSelect, InlinePerson, hasPrice, priceLabel, WebError, type Json } from "@/components/web-analysis/client";
import { bridgeRequest, BridgeError, type BridgeHealth } from "@/lib/desktop-bridge-client";
import { readHistoryProgress, writeHistoryProgress, clearHistoryProgress, newHistoryProgress, runHistoryImport, type HistoryProgress } from "@/lib/capture-history-import";
import { saveCaptureBatch, getCaptureLibrary, pendingCaptureRecords, removeCaptureLibrary, type CaptureLibrary } from "@/lib/desktop-capture-vault";
import { captureLibraryId, type CaptureKind, type CaptureBatch, type StoredCaptureRecord } from "@/lib/desktop-capture";
import { captureIntakeSubject, rememberCaptureSubject, rememberIntakePreference } from "@/components/web-analysis/intake-preferences";
import { intakeHref, intakeReturnTo } from "@/components/web-analysis/intake-navigation";
import { matchImportedVideoFrames } from "@/lib/video-import";
import { CAPTURE_ANALYSIS_LIMIT, captureAnalysisInput, captureReadableText } from "@/lib/capture-analysis-input";
import { selectPendingCaptureRecords } from "@/lib/capture-selection";
import { createCaptureQuestion } from "@/lib/capture-question-handoff";
import { consumeCaptureHandoff, isCaptureHandoff, stageCaptureHandoff } from "@/lib/capture-pairing-handoff";
import { selectCaptureMemory } from "@/lib/capture-memory-selection";
import { ChatActivity } from "@/components/ChatActivity";
import { prepareChatActivityUpload } from "@/lib/chat-activity";
import { CaptureCloudError, listSyncedCaptureLibraries, openSyncedCaptureLibrary, syncCaptureLibrary, deleteCloudCaptureLibrary, linkSyncedReportSources, type SyncedLibrarySummary } from "@/lib/capture-cloud-client";
import ui from "@/components/AuroraUI.module.css";
import styles from "./capture.module.css";
import "@/components/web-analysis/web-analysis.css";

const visualSource = (row: StoredCaptureRecord) => ["screen-capture", "video-import"].includes(String(row.source.method));
const videoTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2,"0")}:${Math.floor(seconds % 60).toString().padStart(2,"0")}`;
const contactDisplayName = (name: string) => name.replace(/ · #[a-fA-F0-9]{16}$/, "");

type Job = { status: string; progress?: number; message?: string; result?: CaptureBatch; partial?: CaptureBatch; partialRevision?: number; error?: string | {message?:string} };
type StoredCaptureJob = { jobId: string; history?: boolean; friend?: string; contactId?: string; accountKey?: string; includeVoice?: boolean; startedAt?: number };
type WechatContact = { contactId: string; label: string; nickname: string; remark: string; accountKey: string };
type JobPhase = "idle" | "checking" | "running" | "done" | "failed" | "missing";
type Receipt = { requestId: string; libraryId: string; sourceIds: string[]; historyIds?: string[]; subjectId: string; kind: CaptureKind; returnTo?: string; analysisScope?: "fullHistory"; cloudId?: string; expectedTotal?: number; expectedEpoch?: number; question?: typeof diagnosticQuestions[number] };
const diagnosticQuestions = ["panorama", "attitude", "trend", "worth", "next"] as const;
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => { const stop = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }; const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop(); });
const stored = <T,>(key: string): T | null => { try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch { return null; } };
const remember = (key: string, value: unknown) => { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); };

export default function CapturePage() {
  const account = useAccount(), owner: string = account.account?.account?.userId || "";
  const generation = useRef(0), abort = useRef<AbortController | null>(null), token = useRef(""), recordList = useRef<HTMLDivElement | null>(null), openingLibrary = useRef(0), syncGuide = useRef<HTMLDetailsElement | null>(null), currentLibrary = useRef<CaptureLibrary | null>(null);
  const requestedSubject = useRef(""), personChosen = useRef(false), autoSyncedKey = useRef("");
  const [cloudBusy,setCloudBusy] = useState(false), [cloudNote,setCloudNote] = useState(""), [cloudError,setCloudError] = useState(""), [librariesLoading,setLibrariesLoading]=useState(false);
  const [returnTo,setReturnTo] = useState("");
  const [method, setMethod] = useState<"desktop" | "window" | "video" | "library">("desktop"), [kind, setKind] = useState<CaptureKind>("chat"), [friend, setFriend] = useState(""), [wechatAccount, setWechatAccount] = useState(""), [code, setCode] = useState(""), [limit, setLimit] = useState(40), [health, setHealth] = useState<BridgeHealth | null>(null), [connected, setConnected] = useState(false);
  const [contacts,setContacts] = useState<WechatContact[]>([]), [selectedContact,setSelectedContact] = useState<WechatContact|null>(null), [contactSearch,setContactSearch] = useState<"idle"|"searching"|"ready"|"error">("idle"), [contactHint,setContactHint] = useState("");
  const [busy, setBusy] = useState(false), [analyzing, setAnalyzing] = useState(false), [error, setError] = useState(""), [note, setNote] = useState(""), [jobId, setJobId] = useState(""), [progress, setProgress] = useState(0), [jobPhase, setJobPhase] = useState<JobPhase>("idle"), [jobMessage, setJobMessage] = useState("");
  const [library, setLibrary] = useState<CaptureLibrary | null>(null), [libraries, setLibraries] = useState<SyncedLibrarySummary[]>([]), [stats, setStats] = useState<{added:number;repeated:number;updatedVoice:number;total:number}|null>(null), [query, setQuery] = useState(""), [selected, setSelected] = useState<string[]>([]), [subject, setSubject] = useState(""), [consent, setConsent] = useState(false), [receipt, setReceipt] = useState<Receipt | null>(null), [reportId, setReportId] = useState(""), [image, setImage] = useState<string | null>(null);
  const [diagnosticQuestion, setDiagnosticQuestion] = useState<"panorama" | "attitude" | "trend" | "worth" | "next">("panorama");
  const locked = busy || analyzing || cloudBusy;
  currentLibrary.current = library;
  const [recordPage, setRecordPage] = useState(0);
  const [historyState,setHistoryState]=useState<HistoryProgress|null>(null), [historyRunning,setHistoryRunning]=useState(false), [showMethods,setShowMethods]=useState(false), [autoVoicePending,setAutoVoicePending]=useState(false);
  const [showAnalysis,setShowAnalysis]=useState(false), [adjustPerson,setAdjustPerson]=useState(false), [materialView,setMaterialView]=useState<"records"|"status">("records");
  const [showImportControls,setShowImportControls]=useState(false);
  const handoff=useRef("");
  function chooseMethod(value: typeof method) {
    setShowMethods(false); setMethod(value);
    if(owner)try{localStorage.setItem(`chengzi-capture:${owner}:method`,value);}catch{}
  }
  function askSelected() {
    if(!owner||!library||locked||receipt||isWindow||library.kind!=="chat")return;
    if(!subject){setError("请先在“关联人物”里选择雅欣，再基于她的完整聊天提问。");setAdjustPerson(true);return;}
    try {
      const result=createCaptureQuestion({owner,subjectId:subject,friend:library.friend,records:[],fullHistory:true,historyCount:memoryRows.length});
      window.location.href=result.href;
    }catch(e){setError(message(e));}
  }
  const scopeKey = (name: string) => `chengzi-capture:${owner}:${name}`;
  function clearStoredJob(expected?: string) {
    const saved = stored<StoredCaptureJob>(scopeKey("job"));
    if (expected && saved?.jobId !== expected) return;
    if (saved?.history && saved.friend && (!expected || saved.jobId === expected)) {
      const checkpoint = readHistoryProgress(owner, saved.friend);
      if (checkpoint?.pendingJob === saved.jobId) {
        try { writeHistoryProgress({ ...checkpoint, pendingJob: null }); } catch { /* the browser may be out of storage; job cleanup still wins */ }
      }
    }
    remember(scopeKey("job"), null);
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const incoming = fragment.get("connect");
    if(incoming!==null){if(isCaptureHandoff(incoming)){handoff.current=incoming;try{stageCaptureHandoff(incoming,sessionStorage);}catch{}}window.history.replaceState(null,"",window.location.pathname+window.location.search);}
    if (params.get("kind") === "moments") { setKind("moments"); setLimit(10); }
    const requested = params.get("method");
    if (requested === "computer") setMethod(/Mac/i.test(navigator.platform) && navigator.maxTouchPoints < 2 ? "window" : "desktop");
    else if (requested === "video" || requested === "window" || requested === "desktop" || requested === "library") setMethod(requested);
    else if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1) setMethod("video");
    else if (/Mac/i.test(navigator.platform)) setMethod("window");
  }, []);
  useEffect(() => {
    const current = ++generation.current; abort.current?.abort(); token.current = "";
     setConnected(false); setHealth(null); setLibrary(null); setLibraries([]); setSelected([]); setStats(null); setReceipt(null); setConsent(false); setFriend(""); setWechatAccount(""); setSubject(""); setQuery(""); setRecordPage(0); setReportId(""); setImage(null); setDiagnosticQuestion("panorama"); setBusy(false); setAnalyzing(false); setJobId(""); setProgress(0); setJobPhase("idle"); setJobMessage(""); setNote(""); setError(""); setHistoryState(null); setHistoryRunning(false); setContacts([]); setSelectedContact(null); setContactSearch("idle"); setContactHint("");
    setShowAnalysis(false);setAdjustPerson(false);setMaterialView("records");setAutoVoicePending(false);setShowImportControls(false);
    setReturnTo(""); personChosen.current = false; autoSyncedKey.current="";setCloudBusy(false);setCloudNote("");setCloudError(""); if (!owner) return;
    setReturnTo(intakeReturnTo(new URLSearchParams(window.location.search).get("returnTo")));
    if(!new URLSearchParams(window.location.search).has("method")){
      const fallback=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||/Mac/i.test(navigator.platform)&&navigator.maxTouchPoints>1 ? "video" : /Mac/i.test(navigator.platform) ? "window" : "desktop";
      try{const saved=localStorage.getItem(`chengzi-capture:${owner}:method`);setMethod(saved==="desktop"||saved==="window"||saved==="video"||saved==="library" ? saved : fallback);}catch{setMethod(fallback);}
    }
    requestedSubject.current = new URLSearchParams(window.location.search).get("subjectId") || "";
    void refreshLibraries(owner,current);
    const connection = stored<{token:string;expiresAt:number}>(`chengzi-capture:${owner}:connection`);
    if (connection && connection.expiresAt > Date.now()) {
      token.current = connection.token;
      void bridgeRequest<{connected:boolean}>("/session",{token:connection.token}).then(value=>{
        if(current!==generation.current||token.current!==connection.token||!value.connected)return;
        setConnected(true);
        void bridgeRequest<BridgeHealth>("/health").then(status=>{
          if(current===generation.current&&token.current===connection.token)setHealth(status);
        }).catch(()=>{});
      }).catch(e=>{
        if(current!==generation.current||token.current!==connection.token)return;
        token.current="";
        remember(`chengzi-capture:${owner}:connection`,null);
        setConnected(false);
        const stale=stored<StoredCaptureJob>(`chengzi-capture:${owner}:job`);
        if(stale?.jobId){
          clearStoredJob(stale.jobId);setJobPhase("missing");
          setJobMessage("本机助手连接已失效，已保存的聊天不会删除。重新连接后可继续导入。");
          setJobId("");setProgress(0);
        }
        setError(e instanceof BridgeError&&e.status===404?"请下载安装新版助手，完成后网页会自动打开并连接。":message(e));
      });
    } else {
      const stale=stored<StoredCaptureJob>(`chengzi-capture:${owner}:job`);
      if(stale?.jobId){clearStoredJob(stale.jobId);setJobPhase("missing");setJobMessage("本机助手连接已过期，已保存的聊天不会删除。重新连接后可继续导入。");setJobId("");setProgress(0);setNote("本机连接已过期，旧任务已清理。已保存的聊天不会删除，重新连接助手即可继续导入。");}
    }
    try{setFriend(contactDisplayName(localStorage.getItem(`chengzi-capture:${owner}:last-friend`)||""));}catch{}
    const running = stored<StoredCaptureJob>(`chengzi-capture:${owner}:job`);
    if (running?.jobId) {
      // Do not discard a long-running history task only because the browser
      // tab has been open for a while.  The bridge is the source of truth;
      // the validation loop below clears the id only after a real 404 or a
      // terminal response.  This prevents a live import from looking failed
      // just because it crossed the old twenty-five-minute browser timeout.
      setJobId(running.jobId); setJobPhase("checking"); setJobMessage("正在核对上次导入任务…");
      if (running.history && running.friend) setHistoryState(readHistoryProgress(owner, running.friend));
    }
    const previous = stored<Receipt>(`chengzi-capture:${owner}:analysis`);
    if (previous) void getCaptureLibrary(owner, previous.libraryId).then(value => { if (current !== generation.current || !value) return; setLibrary(value); setSelected(previous.sourceIds); setRecordPage(Math.floor(Math.max(0, value.records.findIndex(row => previous.sourceIds.includes(row.localId))) / 50)); setReceipt(previous); setReturnTo(back=>back || intakeReturnTo(previous.returnTo)); setKind(previous.kind); setSubject(previous.subjectId); setFriend(contactDisplayName(value.friend)); setNote("上次的分析请求已保留，可继续取回结果。"); }).catch(e => { if (current === generation.current) setError(message(e)); });
    return () => { generation.current++; abort.current?.abort(); };
  }, [owner]);
  useEffect(()=>{if(!owner)return;let saved="";try{saved=consumeCaptureHandoff(sessionStorage);}catch{}const value=saved||handoff.current;handoff.current="";if(value)void connect(value);},[owner]);
  // A task id is kept in sessionStorage so a refresh can resume it.  The
  // helper can be restarted independently, though, which makes that id stale
  // while the page still renders a full progress bar and a "continue" button.
  // Validate it once after reconnecting and clean only terminal, missing or
  // expired jobs.  A genuinely running job remains available for explicit
  // resume, so a refresh cannot interrupt an active import.
  useEffect(() => {
    if (!owner || !connected || !jobId || busy) return;
    const expected = jobId;
    let cancelled = false;
    let timer = 0;
    const inspect = () => {
      if (cancelled) return;
      void bridgeRequest<Job>(`/jobs/${encodeURIComponent(expected)}`, { token: token.current, timeoutMs: 10_000 }).then(job => {
        if (cancelled || expected !== jobId) return;
        const terminal = ["done", "completed", "error", "failed", "cancelled"].includes(job.status);
        if (!terminal) {
          const saved = stored<StoredCaptureJob>(scopeKey("job"));
          setJobPhase("running");
          const value = Number(job.progress);
          setProgress(Number.isFinite(value) ? Math.min(99, Math.max(0, value)) : 0);
          const age = Number(saved?.startedAt) > 0 ? Date.now() - Number(saved?.startedAt) : 0;
          const text = age > 10 * 60 * 1000
            ? "已经超过 10 分钟没有收到新进度，任务可能卡住。已保存的聊天不会删除，可停止后重新导入。"
            : job.message || "本机任务仍在运行，已保存的内容可以继续查看。";
          setJobMessage(text);
          if (job.message || age > 10 * 60 * 1000) setNote(text);
          if (saved?.history && saved.friend) setHistoryState(readHistoryProgress(owner, saved.friend));
          timer = window.setTimeout(inspect, 1500);
          return;
        }
        if ((job.status === "done" || job.status === "completed") && job.result) {
          setJobPhase("done");
          setProgress(100);
          setJobMessage("导入已完成，最后一页原文还在助手中，点击“保存已完成内容”。");
          setNote("导入已完成，点击“保存已完成内容”即可结束，不用再等待。");
          return;
        }
        setJobPhase("failed");
        clearStoredJob(expected);
        setJobId("");
        setProgress(0);
        const detail = typeof job.error === "string" ? job.error : job.error?.message;
        const text = detail || (job.status === "cancelled" ? "上一项导入已停止，已保存的聊天不会删除。" : "上一项导入结束但没有可保存的原文，请重新导入。请检查助手是否仍在运行。");
        setJobMessage(text); setNote(text);
      }).catch(cause => {
        if (cancelled || expected !== jobId) return;
        if (cause instanceof BridgeError && cause.status === 404) {
          setJobPhase("missing");
          clearStoredJob(expected);
          setJobId("");
          setProgress(0);
          const text = "上一项导入在助手中已失效，已保存的聊天不会删除。点击“重新导入本页”继续。";
          setJobMessage(text); setNote(text);
        } else {
          setJobPhase("checking");
          setJobMessage("正在重新连接本机导入任务…");
          timer = window.setTimeout(inspect, 2500);
        }
      });
    };
    setJobPhase("checking"); setJobMessage("正在核对本机导入任务…");
    timer = window.setTimeout(inspect, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [owner, connected, jobId, busy]);
  useEffect(()=>{
    const saved = jobId ? stored<StoredCaptureJob>(scopeKey("job")) : null;
    const label = selectedContact?.label || (saved?.history ? saved.friend : "") || friend.trim();
    setHistoryState(owner && label ? readHistoryProgress(owner,label) : null);
  },[owner,selectedContact,friend,jobId]);
  useEffect(() => {
    if (!owner || !connected || method !== "desktop" || kind !== "chat" || !friend.trim()) {
      setContacts([]); setContactSearch("idle"); setContactHint(""); if (kind !== "chat") setSelectedContact(null); return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setContactSearch("searching"); setContactHint("正在查找本机微信联系人…");
    const timer = setTimeout(() => {
      void bridgeRequest<{ contacts?: Array<{ contactId?:unknown; label?:unknown; nickname?:unknown; remark?:unknown }>; accountKey?:unknown; hasMore?:unknown; message?:unknown }>("/contacts/search", {
        token: token.current, body: {query:friend.trim()}, signal:controller.signal, timeoutMs:45000,
      }).then(result => {
        if (cancelled) return;
        const accountKey = typeof result.accountKey === "string" ? result.accountKey : "";
        if (!accountKey) throw Error("助手未返回当前微信账号信息，请重启或更新助手后重试。");
        const candidates = Array.isArray(result.contacts) ? result.contacts.slice(0,20).filter(row =>
          typeof row.contactId === "string" && !!row.contactId && typeof row.label === "string" && !!row.label && row.label.length <= 100
        ).map(row => ({contactId:row.contactId as string,label:row.label as string,nickname:typeof row.nickname === "string" ? row.nickname : "",remark:typeof row.remark === "string" ? row.remark : "",accountKey})) : [];
        setContacts(candidates);
        const savedJob=stored<StoredCaptureJob>(scopeKey("job"));
        const matchingSavedJob=savedJob?.history && savedJob.jobId && savedJob.friend && savedJob.contactId && savedJob.accountKey
          ? candidates.find(row => row.label === savedJob.friend && row.contactId === savedJob.contactId && row.accountKey === savedJob.accountKey)
          : undefined;
        setSelectedContact(previous => previous && candidates.some(row => row.contactId === previous.contactId && row.label === previous.label && row.accountKey === previous.accountKey) ? previous : matchingSavedJob || null);
        setContactSearch("ready");
        setContactHint(matchingSavedJob ? `已找回上次选中的「${matchingSavedJob.label}」，可继续导入。` : candidates.length ? `找到 ${candidates.length} 位匹配联系人，请选中要导入的那一位。${result.hasMore === true ? "结果较多，可继续输入完整备注缩小范围。" : ""}` : typeof result.message === "string" && result.message ? result.message : "没找到匹配联系人。请检查微信备注、昵称和当前登录账号。");
      }).catch(cause => {
        if (cancelled || controller.signal.aborted) return;
        setContacts([]); setSelectedContact(null); setContactSearch("error");
        setContactHint(cause instanceof BridgeError && cause.status === 404 ? "当前助手不支持联系人选择，请下载并启动新版助手。" : message(cause));
      });
    }, 350);
    return () => { cancelled=true; clearTimeout(timer); controller.abort(); };
  }, [owner,connected,method,kind,friend]);
  // A full history pass must stay fast.  Once the text pages are committed,
  // run the bounded background voice enrichment against the saved library.
  // This effect deliberately starts only after the library state has updated;
  // it prevents the first text import from waiting on local ASR/model startup.
  useEffect(() => {
    if (!autoVoicePending || !owner || !connected || !library || library.kind !== "chat" || busy || analyzing || cloudBusy || receipt || health?.capabilities.backgroundVoice !== true) return;
    const timer = window.setTimeout(() => {
      setAutoVoicePending(false);
      void capture(false, true, true);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [autoVoicePending, owner, connected, library?.id, busy, analyzing, cloudBusy, receipt, health?.capabilities.backgroundVoice]);
  useEffect(() => {
    if (!connected || !owner) return;
    let cancelled = false;
    void bridgeRequest<BridgeHealth>("/health").then(status => { if (!cancelled) setHealth(status); }).catch(() => {});
    return () => { cancelled = true; };
  }, [connected, owner]);
  useEffect(() => { recordList.current?.scrollTo({ top: 0 }); }, [recordPage, query, library?.id]);
  useEffect(() => { setShowAnalysis(false); setAdjustPerson(false); setMaterialView("records"); }, [library?.id]);
  useEffect(() => {
    if (!owner || !library || account.loading || locked || receipt) return;
    const allowed = account.people.map(person => String(person.id));
    if (subject && allowed.includes(subject)) return;
    if (personChosen.current) { if (subject) setSubject(""); return; }
    const restored = captureIntakeSubject(owner, library.id, allowed) || (allowed.includes(library.cloud?.subjectId || "") ? library.cloud!.subjectId! : "") || (allowed.includes(requestedSubject.current) ? requestedSubject.current : "");
    requestedSubject.current = "";
    if (restored !== subject) setSubject(restored);
  }, [owner, library?.id, account.loading, account.people, locked, receipt, subject]);
  useEffect(()=>{
    if(!owner||!library?.cloud?.enabled||library.cloud.offline||library.records.some(row=>row.source.cloudMediaPending===true)||locked||account.loading||receipt)return;
    const key=JSON.stringify([owner,library.id,library.updatedAt,library.records.length,library.reportLinks.length,subject]);
    if(autoSyncedKey.current===key)return;
    const timer=setTimeout(()=>{autoSyncedKey.current=key;void syncCurrentLibrary(false);},1200);
    return()=>clearTimeout(timer);
  },[owner,library,locked,account.loading,receipt,subject]);
  const pending = library ? pendingCaptureRecords(library) : [];
  const selectedRows = library?.records.filter(r => selected.includes(r.localId)) || [];
  const chosen = selectedRows.length && selectedRows.every(visualSource)
    ? selected.map(id => selectedRows.find(row => row.localId === id)).filter((row): row is StoredCaptureRecord => !!row)
    : selectedRows;
  const isWindow = chosen.length > 0 && chosen.every(visualSource);
  const memoryRows = isWindow ? [] : selectCaptureMemory(library);
  const costKey = (library?.kind || kind) === "moments" ? "profile" : "analysisSmall";
  function choosePerson(value: string) {
    if (locked || receipt || account.loading) return;
    personChosen.current = true;
    setSubject(value); setConsent(false);
    if (library) rememberCaptureSubject(owner, library.id, value);
    rememberIntakePreference(owner, library?.kind || kind, {subjectId:value});
  }
  async function refreshLibraries(scope = owner, ticket = generation.current) {
    if(ticket===generation.current)setLibrariesLoading(true);
    try { const result=await listSyncedCaptureLibraries(scope);if(ticket===generation.current){setLibraries(result.libraries);if(result.warning)setCloudError(result.warning);} }
    catch(e){if(ticket===generation.current)setCloudError(message(e));}
    finally{if(ticket===generation.current)setLibrariesLoading(false);}
  }
  async function syncCurrentLibrary(explicit=true) {
    if(!owner||!library||locked)return; const ticket=generation.current, id=library.id;
    setCloudBusy(true);setCloudError("");setCloudNote("正在同步聊天与已转写语音…");
    try {
      const result=await syncCaptureLibrary(owner,library,{subjectId:subject,...(explicit&&library.cloud&&!library.cloud.enabled?{restore:true}:{}),onProgress:(done,total,phase)=>{if(ticket===generation.current)setCloudNote(phase==="images" ? `聊天已保存，图片已同步 ${done} / ${total} 张…` : phase==="reports" ? `材料已保存，正在同步报告依据 ${done} / ${total} 份…` : `正在同步聊天 ${done} / ${total} 条…`);}});
      if(ticket!==generation.current)return;
      if(currentLibrary.current?.id===id)setLibrary(result);
      autoSyncedKey.current=JSON.stringify([owner,result.id,result.updatedAt,result.records.length,result.reportLinks.length,subject]);
      setCloudNote(`已同步 ${result.records.length} 条。手机网页版登录同一账号、小程序关联此账号后即可继续查看。`);
      await refreshLibraries(owner,ticket);
    }catch(e){if(ticket===generation.current){setCloudError(message(e));setCloudNote("");if(e instanceof CaptureCloudError&&e.status===410){await refreshLibraries(owner,ticket);const value=await getCaptureLibrary(owner,id);if(value&&ticket===generation.current)setLibrary(value);}}}
    finally{if(ticket===generation.current)setCloudBusy(false);}
  }
  function selectionIssue(value: CaptureLibrary, rows: StoredCaptureRecord[]) {
    if(rows.some(row=>row.source.cloudMediaPending===true))return "所选材料的图片仍在取回，请等待完成或重新打开这份聊天重试。";
    if(value.kind==="moments"&&rows.some(row=>row.source.cloudMediaUnavailable===true))return "所选动态的配图尚未同步完整，请在原电脑继续同步后再分析。";
    const windowFrames = rows.length > 0 && rows.every(visualSource), max = windowFrames ? 9 : CAPTURE_ANALYSIS_LIMIT[value.kind];
    if (rows.length > max) return `每批最多选择 ${max} ${windowFrames ? "张采集画面" : value.kind === "chat" ? "条聊天" : "条动态"}，请先分析这一批，再处理其余原文。`;
    if (windowFrames) return rows.reduce((count, row) => count + (row.images?.length || 0), 0) > 9 ? "每批最多选择 9 张采集画面。" : "";
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
  function mediaNotice(record: StoredCaptureRecord) { if(record.source.cloudMediaPending===true)return "文字已取回，图片正在加载。可先阅读原文；图片完成后再分析这条材料。";return captureMediaNotice(record, library?.kind || kind); }

  function selectPending(value: CaptureLibrary) {
    const ids = selectPendingCaptureRecords(value, rows => selectionIssue(value, rows)).map(row => row.localId);
    setSelected(ids); setQuery(""); setConsent(false);
    setRecordPage(Math.floor(Math.max(0, value.records.findIndex(r => r.localId === ids[0])) / 50));
  }
  async function accept(batch: CaptureBatch, scope = owner, ticket = generation.current, interim = false, preserveReading = interim) {
    const result = await saveCaptureBatch(scope, batch);
    if (ticket !== generation.current) return;
    if (library?.id !== result.library.id) personChosen.current = false;
    const allowed = account.people.map(person=>String(person.id));
    const associated = library?.id === result.library.id ? subject : captureIntakeSubject(scope,result.library.id,allowed) || (allowed.includes(requestedSubject.current)?requestedSubject.current:"");
    if (!account.loading) requestedSubject.current = "";
    setSubject(associated);
    if (associated) rememberCaptureSubject(scope,result.library.id,associated);
    const sameLibrary = currentLibrary.current?.id === result.library.id;
    currentLibrary.current = result.library;
    setLibrary(result.library); setKind(batch.kind); setFriend(previous => method === "desktop" && selectedContact?.label === batch.friend ? previous : contactDisplayName(batch.friend)); setStats(result);
    if (!sameLibrary || !preserveReading) { selectPending(result.library); setQuery(""); }
    setConsent(false); setReceipt(null); setReportId("");
    if(!interim)await refreshLibraries(scope, ticket);
    if (ticket !== generation.current) return;
    if (!interim) setNote(result.updatedVoice ? "已补全 " + result.updatedVoice + " 条语音文字，原记录不重复保存。" + (result.added ? "另新增 " + result.added + " 条材料。" : "") + "现在可以生成完整关系报告。" : result.added ? "采集完成。先核对人物与原文，再生成完整关系报告。" : "没有新增材料。已保存的原文仍可继续生成报告。");
    return {...result,subjectId:associated};
  }
  function connectionFailed(e:unknown) {
    if(e instanceof BridgeError&&e.status===401&&["PAIR_REQUIRED","TOKEN_INVALID"].includes(e.code)){token.current="";setConnected(false);remember(scopeKey("connection"),null);const stale=stored<StoredCaptureJob>(scopeKey("job"));if(stale?.jobId){clearStoredJob(stale.jobId);setJobPhase("missing");setJobMessage("本机助手连接已失效，已保存的聊天不会删除。重新连接后可继续导入。");setJobId("");setProgress(0);}}
    setError(message(e));
  }
  async function connect(oneTimeHandoff?:string) {
    if (!owner) return;
    const ticket = generation.current; setBusy(true); setError("");
    try {
      const status = await bridgeRequest<BridgeHealth>("/health");
      if (ticket !== generation.current) return; setHealth(status);
      const pair = await bridgeRequest<{token:string;expiresIn:number}>(oneTimeHandoff?"/pair/handoff":"/pair", { body: oneTimeHandoff?{handoff:oneTimeHandoff}:{ code: code.trim() } });
      if (ticket !== generation.current) return;
      // Pairing creates a fresh helper session and discards its previous jobs.
      // Remove the browser's old job checkpoint at the same point.
      const stale = stored<StoredCaptureJob>(scopeKey("job"));
      if (stale?.jobId) { clearStoredJob(stale.jobId); setJobPhase("missing"); setJobMessage("已建立新的助手连接，旧任务已清理；已保存的聊天不会删除。"); setJobId(""); setProgress(0); }
      token.current = pair.token; remember(scopeKey("connection"), { token: pair.token, expiresAt: Date.now() + (pair.expiresIn || 28800) * 1000 }); setConnected(true); setCode(""); setNote("已连接本机采集助手。选择好友后开始。");
    } catch (e) { if (ticket === generation.current) { setError(message(e)); setConnected(false); } }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  async function poll(id: string, ticket: number, scope: string, preserveReading = false) {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    let partialRevision = 0, added = 0, updatedVoice = 0;
    for (let i = 0; i < 900; i++) {
      if (ticket !== generation.current) return;
      const job = await bridgeRequest<Job>(`/jobs/${encodeURIComponent(id)}`, { token: token.current, signal: controller.signal });
      if (ticket !== generation.current) return;
      if (job.partial && Number(job.partialRevision) > partialRevision) {
        const partial = await accept(job.partial, scope, ticket, true);
        if (partial) { added += partial.added; updatedVoice += partial.updatedVoice; }
        if (ticket !== generation.current || controller.signal.aborted) return;
        partialRevision = Number(job.partialRevision);
      }
      setJobPhase("running"); setProgress(Math.min(100, Math.max(0, Number(job.progress) || 0))); setJobMessage(job.message || "正在处理选定好友的材料，完成的内容会陆续保存。"); setNote(job.message || "正在处理选定好友的材料，完成的内容会陆续保存。");
      if (["done", "completed"].includes(job.status)) {
        // A helper can finish a job after the browser has lost the final
        // payload (for example when the helper restarts during a long
        // history read).  Do not leave that terminal id in sessionStorage:
        // otherwise the page shows 100% forever and offers a dead "continue"
        // button on the next visit.
        if (!job.result) {
          remember(`chengzi-capture:${scope}:job`, null);
          if (ticket === generation.current) {
            setJobPhase("failed"); setJobMessage("助手已结束这项任务，但没有返回可保存的原文。请重新导入；已保存的聊天不会删除。"); setJobId(""); setProgress(0);
          }
          throw Error("助手已结束这项任务，但没有返回可保存的原文。请重新导入；已保存的内容不会删除。");
        }
        const completed = await accept(job.result, scope, ticket, false, preserveReading);
        if (ticket === generation.current && completed) {
          added += completed.added; updatedVoice += completed.updatedVoice;
          setStats({added, updatedVoice, total:completed.total, repeated:Math.max(0,job.result.records.length-added)});
          if (added || updatedVoice) setNote(`导入完成${added ? `，新增 ${added} 条材料` : ""}${updatedVoice ? `，补全 ${updatedVoice} 条语音文字` : ""}。核对原文后即可分析。`);
        }
        remember(`chengzi-capture:${scope}:job`, null); if (ticket === generation.current) { setJobPhase("idle"); setJobMessage(""); setJobId(""); } return;
      }
      if (["error", "failed", "cancelled"].includes(job.status)) {
        remember(`chengzi-capture:${scope}:job`, null); setJobPhase("failed"); setJobMessage(typeof job.error === "string" ? job.error : job.error?.message || (job.status === "cancelled" ? "采集已停止，可重新选择范围。" : "这次采集未完成，请查看助手提示。")); setJobId("");
        throw Error(typeof job.error === "string" ? job.error : job.error?.message || (job.status === "cancelled" ? "采集已停止，可重新选择范围。" : "这次采集未完成，请查看助手提示。"));
      }
      await wait(1400, controller.signal);
    }
    setNote("任务仍在本机运行，可以稍后继续查看。");
  }
  async function capture(resume = false, includeVoice = false, enrichExisting = includeVoice, forceFull = false) {
    if (!owner || !connected || receipt) return;
    if (enrichExisting && (!library || library.kind !== "chat")) return;
    const targetKind = enrichExisting ? "chat" : kind;
    if (!friend.trim()) { setError(targetKind === "chat" ? "先输入好友备注或昵称，再从搜索结果中选一位。" : "先填写要采集的好友备注或昵称。"); return; }
    if (targetKind === "chat" && (!selectedContact || enrichExisting && selectedContact.label !== library?.friend)) { setError("先从下方搜索结果中选中要导入的微信联系人；同名好友要选对那一位。"); return; }
    const ticket = generation.current, scope = owner; setBusy(true); setError(""); setProgress(0); setJobPhase("checking"); setJobMessage("正在确认选中的微信联系人并准备导入…"); setNote(targetKind === "chat" ? "正在确认选中的微信联系人并准备导入…" : "正在连接本机助手并准备采集朋友圈…");
    try {
      const targetFriend = enrichExisting ? library!.friend : targetKind === "chat" ? selectedContact!.label : friend.trim();
      const pendingJob=stored<{history?:boolean}>(scopeKey("job"));
      const status = await bridgeRequest<BridgeHealth>("/health");
      if(ticket!==generation.current)return;
      setHealth(status);
      // The paged pass is text-first.  Voice enrichment uses the saved
      // library through the regular bounded capture path below, so it must not
      // restart the whole history pagination job.
      if(!enrichExisting && targetKind==="chat" && status.capabilities.backgroundHistory && status.capabilities.backgroundChat && (!resume || pendingJob?.history)){
        abort.current?.abort();const controller=new AbortController();abort.current=controller;
        let saved=readHistoryProgress(scope,targetFriend);
        if(saved?.account && saved.pages>0 && !await getCaptureLibrary(scope,captureLibraryId({ownerId:scope,kind:"chat",friend:targetFriend,account:saved.account}))){
          if(saved.pendingJob){try{await bridgeRequest(`/jobs/${saved.pendingJob}/cancel`,{token:token.current,body:{}});}catch(e){if(!(e instanceof BridgeError&&e.status===404))throw e;}}
          clearHistoryProgress(scope,targetFriend);saved=null;
        }
        const plan=newHistoryProgress(scope,targetFriend,saved,{forceFull:forceFull||enrichExisting});
        if(enrichExisting)plan.account=library!.account;
        const credential=token.current;
        setHistoryRunning(true);setHistoryState(plan);
        try{localStorage.setItem(`chengzi-capture:${scope}:last-friend`,friend.trim());}catch{}
        setNote(plan.since?"正在检查新增聊天，已导入的内容会保留。":"正在快速导入全部历史文字，语音稍后在后台自动补齐。可以继续使用电脑。");
        // Never make the complete-history pass wait for local audio loading or
        // ASR model startup.  The saved library is enriched automatically
        // after this pass through capture(..., true, true).
        const result=await runHistoryImport({progress:plan,contact:{contactId:selectedContact!.contactId,accountKey:selectedContact!.accountKey},includeVoice:false,signal:controller.signal,
          request:(path,options)=>bridgeRequest(path,{...options,token:credential}),
          accept:async(batch)=>{if(ticket!==generation.current)throw new DOMException("Aborted","AbortError");const value=await accept(batch,scope,ticket,true,true);if(!value||ticket!==generation.current)throw new DOMException("Aborted","AbortError");return{added:value.added,updatedVoice:value.updatedVoice,total:value.total,libraryId:value.library.id};},
          onJob:id=>{if(ticket!==generation.current)return;setJobId(id||"");setJobPhase(id?"running":"idle");setJobMessage(id?"正在读取历史聊天，已保存的内容可继续查看。":"");if(id){const previous=stored<StoredCaptureJob>(`chengzi-capture:${scope}:job`);remember(`chengzi-capture:${scope}:job`,{jobId:id,history:true,friend:targetFriend,contactId:selectedContact!.contactId,accountKey:selectedContact!.accountKey,includeVoice:true,startedAt:previous?.jobId===id&&previous.startedAt||Date.now()});}else remember(`chengzi-capture:${scope}:job`,null);},
          onProgress:update=>{if(ticket!==generation.current)return;setHistoryState(readHistoryProgress(scope,targetFriend));setNote(`${update.message}${update.updatedVoice?` 已补全 ${update.updatedVoice} 条语音。`:""}`);}
        });
        if(ticket!==generation.current)return;
        if(!enrichExisting && result.added>0 && currentLibrary.current?.id===result.libraryId)selectPending(currentLibrary.current);
        setHistoryState(result.progress);setStats({added:result.added,updatedVoice:result.updatedVoice,total:result.total,repeated:Math.max(0,result.progress.count-result.added)});
        setNote(`${plan.since?"新增聊天已检查完":"这位好友在本机可读取的全部聊天已导入"}，资料库共 ${result.total} 条。本次新增 ${result.added} 条。${status.capabilities.backgroundVoice === true ? "语音正在后台补全，完成后会自动更新。" : "语音可在助手支持后补全。"}`);
        await refreshLibraries(scope,ticket);
        if (status.capabilities.backgroundVoice === true && result.total > 0) setAutoVoicePending(true);
        return;
      }
      if(targetKind==="chat"&&!enrichExisting&&!resume)throw Error("请下载安装最新版 Windows 助手。安装完成后会自动打开网页并连接，再试一次即可完整导入这个人的聊天。");
      let background = false, readLimit = limit;
      if (!resume) {
        background = targetKind === "chat" && status.capabilities.backgroundChat === true;
        // A new background import includes audio automatically. Older helpers
        // keep the fast text-only UI path instead of starting foreground voice work.
        if (!enrichExisting) includeVoice = background && status.capabilities.backgroundVoice === true;
        const maxRows = targetKind === "moments" ? 50 : background && status.backgroundMaxRows === 1000 ? 1000 : 500;
        // Enrichment is an automatic pass over the saved contact, so it must
        // use the helper's full bounded background window rather than the
        // visible UI default (40).  The vault deduplicates the text rows and
        // upgrades only matching voice placeholders.
        readLimit = enrichExisting && targetKind === "chat" ? maxRows : limit;
        if (readLimit > maxRows) throw Error(`当前助手本次最多读取 ${maxRows} 条，请缩小范围或更新助手。`);
        const databaseVoice = enrichExisting && library!.records.some(row=>row.source.method === "wechat-local-db");
        if (databaseVoice && (!background || !status.capabilities.backgroundVoice)) throw Error(status.backgroundMessage || "当前助手暂不能后台补全这份语音。已保存的聊天和转写仍可查看。");
        if (background && includeVoice && !status.capabilities.backgroundVoice) throw Error(status.backgroundMessage || "当前助手暂不支持后台语音转写，已保存的材料仍可查看。");
        if (!background && !status.ready) throw Error(status.message || "当前微信界面暂不可读取。");
        if (!background && targetKind === "chat" && !status.capabilities.deferredVoice) throw Error("当前助手暂不支持分步导入聊天，可使用窗口采集。");
        setNote(background ? includeVoice ? enrichExisting ? "正在后台补全语音，可以继续使用电脑。" : "正在读取聊天，文字先显示，语音会在后台转成文字。" : "正在后台读取本机聊天，无需切换微信窗口。" : "正在读取选定好友，请暂时不要切换微信窗口。");
      }
      const id = resume ? jobId : (await bridgeRequest<{jobId:string}>("/capture", { token: token.current, body: { kind:targetKind, friend:targetFriend, ...(targetKind === "chat" ? {contactId:selectedContact!.contactId,accountKey:selectedContact!.accountKey,includeVoice} : {}), limit: readLimit, ...(background ? {mode:"background"} : {}) } })).jobId;
      if (ticket !== generation.current) return;
      const preserveReading = resume ? stored<StoredCaptureJob>(scopeKey("job"))?.includeVoice === true : includeVoice;
      setJobId(id); setJobPhase("running"); setJobMessage("正在处理导入，完成的内容会陆续保存。"); const previous=stored<StoredCaptureJob>(scopeKey("job")); remember(scopeKey("job"), { jobId: id, includeVoice: preserveReading, startedAt: previous?.jobId===id&&previous.startedAt||Date.now() }); await poll(id, ticket, scope, preserveReading);
    } catch (e) {
      if (ticket === generation.current) {
        setHistoryState(targetKind === "chat" && selectedContact ? readHistoryProgress(scope,selectedContact.label) : null);
        if (e instanceof Error && e.name === "AbortError") {
          setJobPhase("idle"); setJobMessage("");
          setNote("已暂停导入，已保存的聊天和读取位置会保留。下次点击继续即可。");
        } else {
          if (!jobId) setJobPhase("failed");
          setNote("");
          connectionFailed(e);
        }
      }
    }
    finally { if (ticket === generation.current) {setBusy(false);setHistoryRunning(false);} }
  }
  async function cancel() {
    if (!jobId) return;
    if(historyRunning){setNote("正在暂停，已保存的聊天会保留…");abort.current?.abort();return;}
    const ticket = generation.current, key = scopeKey("job"), controller = abort.current;
    try {
      const stopped = await bridgeRequest<Job>(`/jobs/${jobId}/cancel`, { token: token.current, body: {} });
      controller?.abort();
      if (stopped.partial) await accept(stopped.partial, owner, ticket, true);
      remember(key, null); if (ticket !== generation.current) return;
      setBusy(false); setJobPhase("failed"); setJobMessage(stopped.partial ? "已停止，已读到的聊天保存在本机。" : "采集已停止，已保存的聊天不会删除。"); setJobId(""); setNote(stopped.partial ? "已停止，已读到的聊天保存在本机。" : "采集已停止，已保存的聊天不会删除。");
    } catch (e) { if (ticket === generation.current) setError(message(e)); }
  }
  async function openLibrary(id: string) {
    if (locked || receipt) return; const ticket = generation.current, opening = ++openingLibrary.current;
    personChosen.current = false;setBusy(true);setError("");setCloudNote("");setShowImportControls(false);
    let shown=false;
    const show=(value:CaptureLibrary)=>{
      if(ticket!==generation.current||opening!==openingLibrary.current)return;
      setLibrary(value);
      if(shown)return;shown=true;
      setKind(value.kind);setFriend(contactDisplayName(value.friend));setWechatAccount(value.account.startsWith("window:")?value.account.slice(7):"");
      const allowed=account.people.map(person=>String(person.id));setSubject(captureIntakeSubject(owner,id,allowed)||(allowed.includes(value.cloud?.subjectId||"")?value.cloud!.subjectId!:""));
      if(!account.loading)requestedSubject.current="";
      selectPending(value);setReceipt(null);setConsent(false);setStats(null);setReportId("");setQuery("");
    };
    try {
      const item=visibleLibraries.find(row=>row.id===id);
      const value=item?await openSyncedCaptureLibrary(owner,item,(count,total,phase)=>{
        if(ticket===generation.current&&opening===openingLibrary.current)setNote(phase==="images"?`文字已可阅读，图片正在取回 ${count} / ${total} 张…`:`正在取回聊天 ${count} / ${total} 条…`);
      },show):await getCaptureLibrary(owner,id);
      if(ticket!==generation.current||opening!==openingLibrary.current||!value)return;
      if(value.kind !== kind) throw Error(kind === "moments" ? "这份材料属于聊天，请从聊天记录入口打开。" : "这份材料属于朋友圈，请从朋友圈入口打开。");
      show(value);
      const incomplete=value.records.some(row=>row.source.cloudMediaPending===true);
      setNote(incomplete?"文字和语音转写已保存。部分图片尚未取回，重新打开这份聊天即可重试。":value.cloud?.offline?"网络暂时不可用，当前查看本机副本；云端新内容尚未取回。":value.cloud?.enabled?`已取回 ${value.records.length} 条聊天，原话和语音文字可直接查看。`:"");
    }catch(e){if(ticket===generation.current&&opening===openingLibrary.current){setError(message(e));setNote(shown?"已取回的文字可继续阅读。重新打开这份聊天即可重试图片。":"");}}
    finally{if(ticket===generation.current)setBusy(false);}
  }
  async function removeLibrary() {
    if (!library || locked || receipt || !confirm(library.cloud?.enabled?"删除这份聊天的云端副本及本机副本？其他设备将无法再下载，已保存的分析报告保留。其他设备已下载的离线副本需在对应设备删除。":"删除这台浏览器保存的采集原文？已保存的分析报告仍会保留，但这里的原文回看将不可用。")) return;
    const ticket = generation.current;
    setCloudBusy(true);
    try { if(library.cloud?.enabled)await deleteCloudCaptureLibrary(owner,library);await removeCaptureLibrary(owner, library.id); if(readHistoryProgress(owner,library.friend)?.account===library.account){clearHistoryProgress(owner,library.friend);setHistoryState(null);} if (ticket !== generation.current) return; setLibrary(null); setSelected([]); setReceipt(null);setCloudNote("");setCloudError(""); remember(scopeKey("analysis"), null); await refreshLibraries(owner, ticket); } catch(e) { if (ticket === generation.current) setError(message(e)); }finally{if(ticket===generation.current)setCloudBusy(false);}
  }
  async function framesReady(frames: CapturedFrame[]) {
    if (!owner || !friend.trim() || !wechatAccount.trim()) throw Error("请先填写微信好友和当前微信号，用于区分不同账号的材料。");
    const scope = owner, ticket = generation.current; setBusy(true);
    try { await accept({ version: 1, kind, friend: friend.trim(), account: `window:${wechatAccount.trim()}`, capturedAt: new Date().toISOString(), warnings: ["这是你授权共享的窗口画面。时间与说话人需要在截图分析中识别、核对；图片重复判断不代表消息已全部去重。"], records: frames.map((frame, i) => ({ id: `screen:${frame.id}`, kind: "image", sender: "", senderRole: "unknown", at: "", text: "", source: { label: `窗口采集 · 第 ${i + 1} 张`, method: "screen-capture", capturedAt: frame.at }, images: [{ mime: "image/jpeg", data: frame.data, name: `微信窗口-${i + 1}.jpg` }] })) }, scope, ticket); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  async function videoReady(frames: ImportedVideoFrame[], context: VideoImportContext) {
    if (!owner) throw Error("请先登录，再保存录屏材料。");
    const scope = owner, ticket = generation.current; setBusy(true);
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    try {
      const previous = await getCaptureLibrary(scope, captureLibraryId({ ownerId: scope, kind, friend: context.fileName.slice(0, 100), account: `recording:${context.videoId}` }));
      if (ticket !== generation.current) return;
      frames = await matchImportedVideoFrames(frames, previous?.records || [], { videoId: context.videoId, signal: controller.signal });
      if (ticket !== generation.current) return;
      const result = await accept({ version: 1, kind, friend: context.fileName.slice(0, 100), account: `recording:${context.videoId}`, capturedAt: new Date().toISOString(),
        warnings: ["本次只保留你选中的录屏画面，原视频没有上传。分析顺序以你确认的顺序为准；视频时间不是消息发送时间。重复画面已核对，仍可能有重叠消息；语音和视频声音未转写。"],
        records: frames.map(frame => ({ id: `video:${context.videoId}:${frame.id}`, kind: "image", sender: "", senderRole: "unknown", at: "", text: "",
          source: { label: `录屏 ${videoTime(frame.videoTime)} · ${context.fileName.slice(0, 150)}`, method: "video-import", videoTime: frame.videoTime, fileName: context.fileName.slice(0, 150), duration: context.duration, segmentStart: context.start, segmentEnd: context.end },
          images: [{ mime: "image/jpeg", data: frame.data, name: `录屏-${videoTime(frame.videoTime).replace(":", "分")}-${frame.id.slice(0, 10)}.jpg` }] }))
      }, scope, ticket);
      if (ticket === generation.current && result) {
        const rows = pendingCaptureRecords(result.library);
        const sourceIds = frames.map(frame => rows.find(row => row.id === `video:${context.videoId}:${frame.id}`)?.localId).filter((id): id is string => !!id);
        setSelected(sourceIds);
        if (sourceIds.length) {
          remember(`chengzi-capture:${scope}:handoff`, { libraryId: result.library.id, sourceIds, subjectId:result.subjectId, returnTo });
          window.location.assign(intakeHref('/analyze',{mode:kind,subjectId:result.subjectId,returnTo,capture:true}));
        } else {
          setNote("本次选中的画面都已分析过，可在下方打开已有报告；补充新内容请改选其他时间段。");
          requestAnimationFrame(() => { if (ticket === generation.current) document.getElementById("capture-preview")?.scrollIntoView({ block: "start", behavior: "smooth" }); });
        }
      }
    } finally { if (ticket === generation.current) setBusy(false); }
  }
  async function analyze() {
    if (!owner || !library || locked || account.loading) return;
    const fullReport = receipt?.analysisScope === "fullHistory" || (library.kind === "chat" && !isWindow);
    if (!fullReport && !chosen.length) return;
    if (!fullReport) { const issue=selectionIssue(library,chosen);if(issue){setError(issue);return;} }
    if (isWindow) {
      if (chosen.length > 9) { setError("每次最多分析 9 张采集画面，请减少勾选。"); return; }
      remember(scopeKey("handoff"), { libraryId: library.id, sourceIds: chosen.map(r => r.localId), subjectId:subject, returnTo });
      window.location.assign(intakeHref('/analyze',{mode:library.kind,subjectId:subject,returnTo,capture:true})); return;
    }
    if (!consent && !receipt) { setError("请先确认本次材料与千问分析处理。"); return; }
    if (!hasPrice(account.account, costKey)) { setError("尚未读取分析价格，请刷新账户后重试。"); return; }
    const scope = owner, ticket = generation.current;
    let reportLibrary = library;
    if (fullReport && !receipt) {
      if (!library.records.some(row => row.kind === "text" && row.senderRole !== "unknown" && row.text.trim())) { setError("这份聊天还没有可读的文字或语音转写，请先完成导入。"); return; }
      setCloudBusy(true); setCloudError(""); setCloudNote("正在同步这份聊天，完成后再生成完整报告…");
      try {
        reportLibrary = await syncCaptureLibrary(scope, library, { subjectId: subject, onProgress: (done,total,phase) => {
          if (ticket === generation.current) setCloudNote(phase === "records" ? `正在同步聊天 ${done} / ${total} 条…` : phase === "images" ? `正在同步图片 ${done} / ${total} 张…` : "正在核对报告依据…");
        } });
        if (ticket !== generation.current) return;
        if (!reportLibrary.cloud?.enabled || reportLibrary.cloud.offline || reportLibrary.cloud.retired || reportLibrary.cloud.total !== reportLibrary.records.length) throw Error("全部聊天尚未同步完成，请稍后重试。已导入的原文仍保存在本机。");
        setLibrary(reportLibrary);
      } catch (cause) { if (ticket === generation.current) { setCloudError(message(cause)); setCloudNote(""); } return; }
      finally { if (ticket === generation.current) { setCloudBusy(false); setCloudNote(""); } }
    }
    const current: Receipt = receipt || { requestId: crypto.randomUUID(), libraryId: reportLibrary.id, sourceIds: fullReport ? [] : chosen.map(r => r.localId), ...(!fullReport ? { historyIds: memoryRows.map(r => r.localId) } : { analysisScope:"fullHistory" as const, cloudId:reportLibrary.cloud!.id, expectedTotal:reportLibrary.records.length, expectedEpoch:reportLibrary.cloud!.epoch }), subjectId: subject, kind: reportLibrary.kind, question: diagnosticQuestion, returnTo };
    const rows = current.sourceIds.map(id => library.records.find(r => r.localId === id)).filter((r): r is StoredCaptureRecord => !!r);
    // Older in-progress receipts did not have historyIds; resume them with
    // all currently readable history instead of silently sending none.
    const historyIds = new Set(current.historyIds?.length ? current.historyIds : memoryRows.map(row => row.localId));
    const payload = current.analysisScope === "fullHistory"
      ? { requestId:current.requestId, confirmed:true, analysisScope:"fullHistory" as const, kind:"chat" as const, friend:reportLibrary.friend, subjectId:current.subjectId || null, question:current.question || diagnosticQuestion, libraryId:current.cloudId, expectedTotal:current.expectedTotal, expectedEpoch:current.expectedEpoch, records:[] }
      : { requestId: current.requestId, confirmed: true, kind: current.kind, friend: library.friend, subjectId: current.subjectId || null, ...(current.kind === "chat" ? { question: current.question || diagnosticQuestion, historyRecords: memoryRows.filter(row => historyIds.has(row.localId)), activityRecords: prepareChatActivityUpload(library.records, {account: library.account}).activityRecords } : {}), records: rows.map(r => ({ localId: r.localId, kind: r.kind, sender: r.sender, senderRole: r.senderRole, at: r.at, text: r.text, ocrTextVerified: r.ocrTextVerified === true, images: library.kind === "moments" ? r.images || [] : [] })) };
    if (!receipt && !fullReport) { try { captureAnalysisInput(payload); } catch(e) { setError(message(e)); return; } }
    remember(scopeKey("analysis"), current); setReceipt(current); setAnalyzing(true); setError(""); setNote(current.analysisScope === "fullHistory" ? "已同步全部已导入聊天。正在按时间梳理关系变化、双方投入和下一步建议，完成后会自动保存报告。" : "正在分析选中的材料。原文已保留，离开后可继续取回报告。");
    rememberCaptureSubject(scope, library.id, current.subjectId);
    rememberIntakePreference(scope, library.kind, {subjectId:current.subjectId});
    try {
      const currentAccount = await api("/api/account/credits");
      if (currentAccount.account?.userId !== scope || ticket !== generation.current) throw Error("账户已变化，请返回原账号继续。");
       if (library.kind === "chat" && !receipt) await api("/api/web/settings", { consent: true, allowImageProcessing: true, selfSide: "right" });
      if (ticket !== generation.current) return;
      let restored: Json | null = null;
      if (receipt) { try { const saved = await api("/api/web/report?id=" + encodeURIComponent(current.requestId)); restored = { ...saved.report, reportId: saved.reportId }; } catch(e) { if (!(e instanceof WebError && e.status === 404)) throw e; } }
      const result = restored || await api("/api/web/capture/analyze", payload);
      if (ticket !== generation.current) return;
      // Keep both kinds of whole-history citations attached to the local
      // library: profile-memory items and the source-checked findings from
      // the semantic history pass. This lets a reopened report resolve
      // “回看这条历史原文”, rather than only during the current request.
      const semanticHistory = result.semanticHistory || result.relationshipDiagnosis?.semanticHistory || result.entries?.[0]?.semanticHistory || result.entries?.[0]?.relationshipDiagnosis?.semanticHistory;
      const semanticIds = Array.isArray(semanticHistory?.findings)
        ? semanticHistory.findings.flatMap((finding: Json) => Array.isArray(finding?.evidence) ? finding.evidence.map((item: Json) => item?.sourceId) : [])
        : [];
      const profileIds = (result.profileMemory?.items || result.entries?.[0]?.profileMemory?.items || []).map((item: Json) => item.sourceId);
      const memorySourceIds = [...new Set([...profileIds, ...semanticIds])]
        .filter((id: unknown): id is string => typeof id === "string" && library.records.some(row => row.localId === id))
        .slice(0, 128);
       const linkedIds = current.analysisScope === "fullHistory" ? (Array.isArray(result.sourceIds) ? result.sourceIds.filter((id: unknown): id is string => typeof id === "string") : []) : current.sourceIds;
       const linked = linkedIds.length || memorySourceIds.length ? await linkSyncedReportSources(scope, result.reportId, { libraryId: library.id, sourceIds: linkedIds, memorySourceIds }) : { cloudError:"" };
      if(ticket===generation.current&&linked.cloudError)setCloudError(linked.cloudError);
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
  const coverage = library ? captureCoverage(library.records,library.kind) : null;
  // Scope the cross-device library to the selected intake mode.  The
  //朋友圈入口 must never offer a chat library (or the reverse).
  const visibleLibraries = libraries.filter(item => item.kind === kind);
  const localDatabase = !!library?.records.some(row=>row.source.method === "wechat-local-db");
  const backgroundVoice = health?.capabilities.backgroundChat === true && health?.capabilities.backgroundVoice === true;
  const databaseVoiceUnavailable = localDatabase && !backgroundVoice;
  const fullHistory = health?.capabilities.backgroundHistory === true;
  const helperNeedsUpdate = !!health?.version && new Intl.Collator("en",{numeric:true}).compare(health.version,"1.2.4") < 0;
  const importLabel = historyState?.complete ? "补充新聊天" : historyState ? "继续导入全部聊天" : "导入这个人的全部聊天";
  const activityNotice=library?.kind==="chat"&&library.records.length>20000 ? prepareChatActivityUpload(library.records,{account:library.account}).notice : "";
  const readableRecordCount = library?.records.filter(row => row.kind === "text" && row.senderRole !== "unknown" && row.text.trim()).length || 0;
  const historyInProgress = !!library && historyState?.friend === library.friend && !historyState.complete;
  const fullReportPath = library?.kind === "chat" && !isWindow;
  const reportReady = !!fullReportPath && readableRecordCount > 0 && !jobId && !historyInProgress;
  const compactImport = method === "desktop" && !!library && library.kind === "chat" && !historyInProgress && !jobId && !showImportControls;
  const desktopStep = !connected && !library ? 0 : !selectedContact && !library ? 1 : !library || historyInProgress || !!jobId ? 2 : 3;
  const showJobStatus = !!jobId || jobPhase === "failed" || jobPhase === "missing";
  const jobProgressValue = jobPhase === "checking" || jobPhase === "running" && progress <= 0 ? undefined : Math.min(100, Math.max(0, progress));
  const jobStatusText = busy ? note : jobMessage || (jobPhase === "done" ? "导入已完成，点击保存最后一页。" : jobPhase === "running" ? "本机任务仍在运行，已保存的内容可以继续查看。" : "正在核对本机导入任务…");
  const openSyncGuide = () => { if (syncGuide.current) { syncGuide.current.open = true; syncGuide.current.scrollIntoView({block:"center",behavior:"smooth"}); } };
  const kindPicker = <div className={styles.kinds} aria-label="采集内容">{([{key:"chat",label:"聊天记录",Icon:MessageSquare},{key:"moments",label:"朋友圈",Icon:Images}] as const).map(({key,label,Icon}) => <button disabled={locked || !!receipt} aria-pressed={kind === key} key={key} onClick={() => { if(key === kind)return; setKind(key); setLimit(key === "chat" ? 40 : 10); setLibrary(null); setSelected([]); setStats(null); setReportId(""); setConsent(false); setSubject(""); setNote(""); setError(""); }}><Icon size={18}/>{label}</button>)}</div>;
  return <div className={ui.page}><WebNav guideReady={!!owner && !account.loading}/><FirstUseTour owner={owner} page="capture" method={method} ready={!account.loading} auto={method !== "desktop" && !locked && !jobId && !receipt && !library}/><main className={`${ui.wrap} ${styles.page}`}>
    <AuroraPageHero eyebrow={method === "library" ? "你的账号 · 跨设备继续" : method === "video" ? "手机录屏 · 材料导入" : "电脑微信 · 关系全景"} title={method === "library" ? "打开聊天，继续看关系。" : method === "video" ? "录一段，少截很多张。" : library ? "聊天已保存，接下来看看这段关系。" : "导入聊天，看清这段关系。"} description={method === "library" ? "打开已同步材料，就能生成报告或基于这份聊天提问。" : method === "video" ? "在微信里慢慢滑动并录屏，自动挑出清晰画面。先预览，再确认分析。" : library ? `已保存 ${library.records.length} 条材料。生成报告会梳理关系变化、双方投入、风险和下一步。` : "跟着下面的步骤连接助手、选择好友并导入。完成后可生成完整关系报告，也能继续提问。"}>{method === "video" && <a className={ui.primary} href="#recording-upload"><FileVideo size={18}/>选择手机录屏</a>}{method === "desktop" && !library && <a className={ui.secondary} href="#capture-steps">从第一步开始<ArrowRight size={17}/></a>}{returnTo && <a className={ui.secondary} href={returnTo}><History size={17}/>{returnTo.startsWith('/archive')?'返回人物档案与对照':'返回原报告'}</a>}</AuroraPageHero>
    <ol id="capture-steps" className={styles.steps} aria-label="使用步骤">{(method === "desktop" && kind === "chat" ? ["连接助手", "选择联系人", "导入全部聊天", "生成关系报告"] : method === "library" ? ["打开已导入聊天", "查看关系报告"] : method === "video" ? ["选择录屏", "核对画面", "确认后分析"] : ["连接助手", "选择联系人", "采集朋友圈", "生成分析报告"]).map((label, i) => { const active = method === "desktop" && kind === "chat" ? desktopStep : method === "library" ? library ? 1 : 0 : method === "video" ? library ? 1 : 0 : library ? 3 : connected ? 1 : 0; return <li key={label} data-active={active === i} data-done={active > i}><span>{active > i ? <Check size={18}/> : `0${i + 1}`}</span><strong>{label}</strong></li>; })}</ol>
    <AccountNotice state={account}/>
    {receipt && <p className={styles.warning}>有一份分析尚待取回。请继续本次分析，完成后再切换材料；原请求会保留，避免重复处理。</p>}
    <div className={`${styles.layout} ${method === "video" ? styles.videoLayout : ""}`}>
      <aside className={styles.controls}>
        <section className={styles.panel} data-compact={compactImport} data-desktop-step={method === "desktop" && kind === "chat" ? desktopStep : undefined}><h2><Monitor size={22}/>{method === "desktop" ? library ? "聊天已导入" : "导入微信聊天" : method === "library" ? "打开已导入聊天" : method === "window" ? "采集微信窗口" : "导入手机录屏"}</h2>{compactImport && <div className={styles.importSummary}><CheckCheck size={21}/><div><strong>已保存 {library?.records.length || 0} 条</strong><span>现在到右侧生成报告，或继续补充聊天。</span></div><button type="button" disabled={locked || !!receipt} onClick={()=>setShowImportControls(true)}>补充 / 换人</button></div>}<button className={styles.refreshLibraries} data-tour="capture-method" disabled={locked || !!receipt} aria-expanded={showMethods} onClick={()=>setShowMethods(!showMethods)}>{showMethods ? "收起其他方式" : "更换导入方式"}<ArrowRight size={15}/></button><div hidden={!showMethods} className={styles.methods}><button disabled={locked || !!receipt} aria-pressed={method === "library"} onClick={() => chooseMethod("library")}><Cloud size={20}/><span>已导入聊天<small>手机 / 电脑 · 同步继续</small></span></button><button disabled={locked || !!receipt} aria-pressed={method === "desktop"} onClick={() => chooseMethod("desktop")}><Plug size={20}/><span>自动读取<small>Windows · 需启动助手</small></span></button><button disabled={locked || !!receipt} aria-pressed={method === "window"} onClick={() => chooseMethod("window")}><Monitor size={20}/><span>窗口采集<small>Mac / Windows</small></span></button><button disabled={locked || !!receipt} aria-pressed={method === "video"} onClick={() => chooseMethod("video")}><FileVideo size={20}/><span>手机录屏<small>苹果 / 安卓 · 视频导入</small></span></button></div>
          {method === "desktop" && <div className={styles.connect} data-tour="capture-connect">
            {connected ? <div className={styles.connected} role="status"><CheckCheck size={21}/><span><strong>助手已连接</strong><small>{kind === "chat" ? "现在选择微信好友，开始导入聊天。" : "现在选择动态条数，开始采集朋友圈。"}</small></span><button disabled={locked} onClick={() => { token.current = ""; setConnected(false); setHealth(null); setNote(""); remember(scopeKey("connection"), null); }}>断开</button></div> : <>
              <p className={styles.connectLead}>首次使用，下载后双击安装程序。安装完成会自动启动助手、打开网页并连接，无需操作终端。</p>
              <a className={`${ui.primary} ${styles.downloadInstaller}`} href="/downloads/ChengziWeChatCollector-Setup-1.2.4.exe" download><Download size={18}/>下载 Windows 助手（EXE）</a>
              <small>Windows 10 / 11 · 图形安装进度 · 无需管理员权限</small>
              <p className={styles.downloadSecurityHint}>首次打开若出现“Windows 已保护你的电脑”：确认文件是从本页下载后，点“更多信息”→“仍要运行”。这是未使用公共代码签名证书时的 SmartScreen 提示；来源不确定请点“不运行”，企业电脑策略也可能禁止继续。</p>
              <div className={styles.connectionWaiting} role="status"><strong>尚未连接</strong><small>安装后会打开已连接的网页，再选择微信好友。</small></div>
              <details className={styles.pair}><summary>没有自动连接？手动输入连接码</summary><label htmlFor="capture-code">助手连接码</label><div><input id="capture-code" inputMode="text" autoCapitalize="characters" autoComplete="off" maxLength={8} value={code} onChange={e => setCode(e.target.value)} placeholder="输入连接码" disabled={locked}/><button className={ui.primary} disabled={!owner || locked || code.trim().length < 4} onClick={() => void connect()}>{busy ? <LoaderCircle size={17}/> : <Link2 size={17}/>}连接</button></div></details>
            </>}
            {connected && helperNeedsUpdate && <div className={styles.connectionWaiting}><strong>助手有新版本 1.2.4</strong><small>先在旧版助手窗口点「退出助手」，再双击新版安装程序。</small><a className={ui.secondary} href="/downloads/ChengziWeChatCollector-Setup-1.2.4.exe" download><Download size={17}/>下载新版助手</a></div>}
            {connected && health?.capabilities.backgroundChat && <p className={styles.backgroundReady}><CheckCheck size={16}/>后台导入：文字先显示，语音自动补齐。可以继续使用电脑。</p>}{connected && health?.backgroundMessage && !health.capabilities.backgroundChat && <p>{health.backgroundMessage}</p>}{connected && health?.ready && (kind === "moments" || !health.capabilities.backgroundChat) && <p>当前使用微信界面采集。采集期间需保持微信在前台，暂时不要操作微信。</p>}{connected && health?.message && !health.ready && !(kind === "chat" && health.capabilities.backgroundChat) && <p>{health.message}</p>}
          </div>}
          {(method === "desktop" || method === "window") && kindPicker}
          {(method === "desktop" || method === "window") && <div className={styles.contactPicker} data-tour="capture-friend"><label className={styles.field}>微信好友<input value={friend} disabled={locked || !!jobId} maxLength={100} onChange={e => {setFriend(e.target.value);setSelectedContact(null);setError("");}} placeholder={method === "desktop" ? "输入备注或昵称，例如雅欣" : "填写好友备注或昵称"}/></label>{method === "desktop" && <>{kind === "chat" && connected && friend.trim() && <div className={styles.contactResults} aria-live="polite"><p className={contactSearch === "error" ? styles.contactSearchError : styles.contactSearchHint}>{contactSearch === "searching" && <LoaderCircle className={styles.spin} size={16}/>}<Search size={16}/>{contactHint}</p>{contactSearch === "ready" && contacts.length > 0 && <div className={styles.contactChoices} role="group" aria-label="选择要导入的微信联系人">{contacts.map(row => <button type="button" key={row.contactId} aria-pressed={selectedContact?.contactId === row.contactId && selectedContact.accountKey === row.accountKey} disabled={locked} onClick={() => {setSelectedContact(row);setError("");}}><span><strong>{contactDisplayName(row.label)}</strong><small>{row.remark && row.nickname && row.remark !== row.nickname ? `昵称：${row.nickname} · ` : ""}微信识别码：{row.contactId.slice(-8)}</small></span>{selectedContact?.contactId === row.contactId && selectedContact.accountKey === row.accountKey && <Check size={18}/>}</button>)}</div>}{selectedContact && <p className={styles.contactSelected}><CheckCheck size={16}/>已选中「{contactDisplayName(selectedContact.label)}」，现在可以导入。</p>}</div>}{kind === "chat" && !connected && <small className={styles.contactSearchHint}>连接助手后，输入名字即可选择具体联系人。</small>}{error && <p className={styles.contactSearchError} role="alert">{error}</p>}{busy && note && <p className={styles.contactSearchHint} role="status"><LoaderCircle className={styles.spin} size={16}/>{note}</p>}{!busy && note && <p className={styles.contactSearchHint} role="status"><CheckCheck size={16}/>{note}</p>}</>}</div>}
          {method === "desktop" ? <>{kind === "chat" && <div className={styles.syncPrompt}><Smartphone size={20}/><div><strong>手机里的旧聊天，电脑上还没有？</strong><p>先在手机微信选择「导出到电脑」，再回来导入。仅做恢复用的「备份到电脑」不能直接读取。</p><button type="button" onClick={openSyncGuide}>查看 3 步操作<ArrowRight size={15}/></button></div></div>}{kind === "moments" ? <label className={styles.field}>采集动态<select value={limit} disabled={locked} onChange={e=>setLimit(Number(e.target.value))}>{[5,10,20,50].map(n=><option key={n} value={n}>{n} 条动态</option>)}</select></label> : <div className={styles.historyScope}><CheckCheck size={20}/><div><strong>这个人的全部聊天</strong><p>自动连续读取本机所有历史，语音自动转文字。中断可继续，重复不会再保存。</p>{historyState&&<small>{historyState.complete ? "上次完整导入已完成，本次只检查新增记录。" : `已核对 ${historyState.count} 条历史，继续时从保存的位置接着读。`}</small>}{connected&&!fullHistory&&<small>请更新至 1.2.4 助手以使用完整导入。</small>}</div></div>}<button className={`${ui.primary} ${styles.full}`} disabled={!owner || !connected || locked || !!receipt || !friend.trim() || !!jobId} onClick={() => void capture()}><Download size={18}/>{kind === "chat" ? importLabel : "开始采集朋友圈"}</button>{kind==="chat"&&historyState?.complete&&<button className={styles.refreshLibraries} disabled={locked||!!receipt||!connected||!!jobId} onClick={()=>void capture(false,false,false,true)}>重新核对全部历史<RefreshCw size={14}/></button>}{kind === "chat" && <details ref={syncGuide} className={styles.syncGuide}>
            <summary><Smartphone size={17}/>把手机聊天导入电脑{coverage?.voiceMissingLocal ? ` · ${coverage.voiceMissingLocal} 条语音待同步` : " · 记录不全时使用"}</summary>
            <p>手机和电脑登录同一微信，并连接同一网络。</p>
            <ol><li>手机微信打开「我 → 设置 → 聊天记录管理」。</li><li>选择「导入与导出 → 导出到电脑」。</li><li>只选「{friend.trim() || "需要分析的好友"}」的聊天，等待传输完成。</li></ol>
            <p>请选择「导出到电脑」。仅「备份到电脑」的恢复包不能直接读取；不同微信版本入口名称可能略有不同。</p>
            <button className={ui.secondary} disabled={!owner || !connected || locked || !!receipt || !friend.trim() || !!jobId} onClick={()=>void capture(false,false,false,true)}>已同步，重新检查全部</button>
            <small>重新检查会复用已转好的语音。只有读到实际文字，才计为已完成。</small>
          </details>}{showJobStatus && <div className={styles.job} data-job-phase={jobPhase}><p role="status">{jobStatusText}</p><progress max={100} value={jobProgressValue} aria-label={jobPhase === "done" ? "导入已完成，等待保存" : jobPhase === "running" ? "正在连续导入全部聊天" : "正在核对导入任务"}/>{jobPhase === "done" ? <button className={ui.secondary} onClick={() => void capture(true)} disabled={!connected || locked}>保存已完成内容</button> : jobPhase === "failed" || jobPhase === "missing" ? <button className={ui.secondary} onClick={() => void capture(false)} disabled={!connected || locked}>重新导入本页</button> : <button className={ui.secondary} onClick={() => void capture(true)} disabled={!connected || locked}>继续导入</button>}{jobId && <button className={ui.secondary} onClick={() => void cancel()} disabled={locked}><Square size={15}/>{historyRunning?"暂停导入":"停止采集"}</button>}</div>}</> : method === "window" ? <label className={styles.field}>当前微信号<input value={wechatAccount} disabled={locked} maxLength={100} onChange={e => setWechatAccount(e.target.value)} placeholder="用于区分你使用的不同微信账号"/><small>用于区分本机材料，不是登录密码。</small></label> : method === "library" ? <p className={styles.muted}>在下方打开已同步材料。首次完整导入需在电脑完成；手机录屏用于补充你选中的片段。</p> : <p className={styles.muted}>选择一位好友的聊天或朋友圈录屏。每次提取一段，核对清晰画面后再继续。</p>}
        </section>
        {visibleLibraries.length > 0 && <section className={styles.panel}><h2><Cloud size={21}/>{kind === "moments" ? "已导入的朋友圈" : "已导入的聊天"}</h2><p className={styles.muted}>{kind === "moments" ? "已同步的朋友圈可跨设备继续；仅本机材料需先启用同步。" : "已同步的聊天可跨设备继续；仅本机材料需先启用同步。"}</p><button className={styles.refreshLibraries} disabled={locked} onClick={()=>void refreshLibraries()}><RefreshCw size={15}/>刷新同步列表</button><div className={styles.libraries}>{visibleLibraries.map(item => <button key={item.id} disabled={locked || !!receipt} aria-pressed={library?.id === item.id} onClick={() => void openLibrary(item.id)}>{item.kind === "chat" ? <MessageSquare size={19}/> : <Images size={19}/>}<span><strong>{item.friend}</strong><small>{item.kind === "chat" ? "聊天" : "朋友圈"} · {item.total} 条 · {item.cloud?.retired ? "旧离线副本" : item.cloud?.enabled ? "已同步" : "仅本机"}</small></span><ArrowRight size={17}/></button>)}</div></section>}
      </aside>
      <div className={styles.workspace}>
        {error && <p className={styles.error} role="alert">{error}</p>}{cloudError && <p className={styles.error} role="alert">{cloudError}<button className={styles.refreshLibraries} disabled={locked} onClick={()=>{setCloudError("");void refreshLibraries();}}>重新检查同步</button></p>}
        {(librariesLoading && method === "library" || busy && !jobId) && <p className={styles.status} role="status"><LoaderCircle className={styles.spin} size={18}/>{busy ? note || "正在打开这份聊天…" : "正在读取已同步聊天…"}</p>}
        {note && !busy && <p className={styles.status} role="status"><CheckCheck size={18}/>{note}</p>}
        {method === "window" && <ScreenCapture sessionKey={JSON.stringify([owner, kind, friend.trim(), wechatAccount.trim()])} disabled={!owner || locked || !!receipt || !friend.trim() || !wechatAccount.trim()} onReady={framesReady}/>}
        {method === "video" && <div id="recording-upload" className={styles.recordingUpload}>{kindPicker}<VideoImport sessionKey={JSON.stringify([owner, kind])} disabled={!owner || locked || !!receipt} onReady={videoReady}/></div>}
        {method === "library" && !library && !visibleLibraries.length && !librariesLoading && !account.loading && <section className={styles.empty}><Cloud size={42}/><h2>{kind === "moments" ? "先在电脑导入朋友圈，之后手机直接看。" : "第一次在电脑导入，之后手机直接看。"}</h2><p>{kind === "moments" ? "电脑端采集朋友圈并启用跨端同步后，手机网页版登录同一账号即可继续查看。" : "电脑端导入聊天后，点击「启用跨端同步」。手机网页版登录同一账号，小程序关联该网页账号，即可打开这里的材料。"}</p><p>已有材料但没看到？请回到原电脑启用同步，再刷新这里。</p><button className={ui.secondary} disabled={locked} onClick={()=>void refreshLibraries()}><RefreshCw size={17}/>刷新已同步材料</button><a className={ui.secondary} href={`/capture?method=computer&kind=${kind}`}>查看电脑版导入步骤<ArrowRight size={17}/></a></section>}
        {library ? <section id="capture-preview" className={styles.preview}><div className={styles.previewHead}><div><span className={styles.eyebrow}>原文预览 · {library.cloud?.enabled ? "已启用跨端同步" : "仅在本机保存"}</span><h2>{library.friend}<small>{library.kind === "chat" ? "聊天记录" : "朋友圈"}</small></h2></div><button className={styles.delete} disabled={locked || !!receipt} onClick={() => void removeLibrary()} aria-label={library.cloud?.enabled ? "删除云端和本机聊天" : "删除本机原文"}><Trash2 size={18}/></button></div>
          <div className={styles.stats}><div><strong>{stats?.added ?? pending.length}</strong><span>{stats ? "本次新增" : "尚未分析"}</span></div><div><strong>{stats ? Math.max(0, stats.repeated - stats.updatedVoice) : library.records.length - pending.length}</strong><span>{stats ? "重复跳过" : "已分析"}</span></div><div><strong>{library.records.length}</strong><span>这份材料共保存</span></div></div>
          <div className={styles.nextAction} data-tour="capture-analysis">
            <div className={styles.nextHeading}><h3>{isWindow ? "先核对画面，再开始分析" : library.kind === "chat" ? "聊天已导入，先生成完整关系报告" : "材料已就位，接下来想看什么？"}</h3><span>{isWindow ? `本次选中 ${chosen.length} 张 · 已保存 ${library.records.length} 张` : library.kind === "chat" ? `完整 ${library.records.length} 条 · 可读文字 ${readableRecordCount} 条` : `本次分析 ${chosen.length} 条 · 已保存 ${library.records.length} 条`}</span></div>
            <p className={styles.selectionNote}>{isWindow ? "已保留采集画面的顺序，下一步核对截图身份。" : library.kind === "chat" ? `完整报告会读取已导入的全部 ${library.records.length} 条聊天，梳理互动频率、谁更主动、关系变化、共同点、风险和下一步。${historyInProgress ? "全部导入尚未结束，完成后这里会自动可用。" : "先生成报告，逐句原文留在下方按需查看。"}` : `每批最多分析 ${CAPTURE_ANALYSIS_LIMIT.moments} 条动态。其余已保存的原文可在下方查看、分批选择。`}</p>
            {library.kind === "chat" && !isWindow && <div className={styles.fullReportCard}>
              <div><strong>一份完整的关系全景报告</strong><p>从全部聊天计算谁先发起、回复与投入，再按时间核对升温或降温、说法与行动、风险和下一步；结论旁可回看原话依据。</p></div>
              <button className={ui.primary} disabled={account.loading || locked || (!!receipt ? false : !reportReady)} onClick={() => { setShowAnalysis(true); requestAnimationFrame(() => document.getElementById("capture-confirm")?.scrollIntoView({ block: "center", behavior: "smooth" })); }}><FileText size={20}/><span><strong>{receipt ? "继续生成完整报告" : "生成完整关系报告"}</strong><small>{reportReady || receipt ? `读取全部 ${library.records.length} 条 · ${priceLabel(account.account, costKey)}` : "请先完成全部聊天导入"}</small></span><ArrowRight size={18}/></button>
            </div>}
            {library.kind === "chat" && <div className={styles.previewActivity}><ChatActivity records={library.records} account={library.account} friend={library.friend} compact/></div>}
            <div className={styles.personSummary}><span>关联人物：<strong>{account.people.find(person=>person.id===subject)?.label || "暂未关联人物"}</strong></span><button disabled={locked || !!receipt} onClick={()=>setAdjustPerson(!adjustPerson)}>{adjustPerson ? "收起" : "调整"}</button></div>
            {(!subject||adjustPerson)&&<div className={styles.personAdjust}><PersonSelect people={account.people} value={subject} onChange={choosePerson} disabled={account.loading || locked || !!receipt} empty={account.loading ? "正在读取人物档案…" : "本次不使用人物档案"}/><InlinePerson key={owner + library.id} initialName={library.friend} disabled={locked || !!receipt} onCreated={async id => { await account.refresh(); choosePerson(id); }}/></div>}
            {library.kind === "chat" && <label className={styles.questionPicker}><span>你最想先知道什么？</span><select value={diagnosticQuestion} disabled={locked || !!receipt} onChange={event => setDiagnosticQuestion(event.target.value as typeof diagnosticQuestion)}><option value="panorama">先看这份材料的关系概况</option><option value="attitude">TA 对我的态度是什么</option><option value="trend">这段关系是在升温还是降温</option><option value="worth">这段关系值得继续投入吗</option><option value="next">我下一步应该怎么做</option></select><small>先选一个重点；逐条解读和整体关系分析的材料范围见上方。</small></label>}
            <div className={styles.nextChoices}>
              {!isWindow&&library.kind==="chat"&&<button className={ui.secondary} disabled={account.loading||locked||!!receipt||!readableRecordCount||!subject} onClick={askSelected}><MessageSquare size={20}/><span><strong>基于全部聊天提问</strong><small>带入完整资料库，只回答你这一个问题</small></span><ArrowRight size={18}/></button>}
              {isWindow || library.kind === "moments" ? <button className={ui.secondary} aria-expanded={showAnalysis||!!receipt} aria-controls="capture-confirm" disabled={account.loading||locked||!chosen.length} onClick={()=>setShowAnalysis(!showAnalysis)}><FileText size={20}/><span><strong>{receipt ? "继续本次分析" : library.kind === "chat" ? "进入截图分析" : "生成分析报告"}</strong><small>{isWindow ? "核对截图，查看画面解读" : `分析选中的 ${chosen.length} 条动态`}</small></span><ArrowRight size={18}/></button> : null}
            </div>
            {(showAnalysis||receipt)&&<div id="capture-confirm" className={styles.confirmAnalysis}>
              <h3>{!isWindow && library.kind === "chat" ? "确认生成完整关系报告" : "核对截图后再分析"}</h3>
              <p>{!isWindow&&library.kind==="chat" ? `本次会读取已同步的全部 ${library.records.length} 条聊天（其中 ${readableRecordCount} 条有可读文字或语音转写），并生成关系全景、互动统计、变化、风险与下一步。` : `本次使用选中的 ${chosen.length} 条材料。`}</p>
              {analyzing && <p className={styles.analysisProgress} role="status"><LoaderCircle size={17} className={styles.spin}/>已先完成全量材料统计与去重，正在生成这次问题的深度判断；完成的内容会直接保存。</p>}
              {!isWindow && <label className={styles.consent}><input type="checkbox" checked={consent} disabled={locked} onChange={e => setConsent(e.target.checked)}/><span>{library.kind === "chat" ? `我已核对人物与材料，有权提供这份聊天的全部 ${library.records.length} 条记录及聊天统计，并同意发送给阿里云百炼千问用于本次完整报告。` : `我已核对身份与材料，有权提供本次所选 ${chosen.length} 条材料，并同意发送给阿里云百炼千问用于本次分析。`}</span></label>}
          {reportId && <a className={styles.reportLink} href={`/report?id=${reportId}`}><CheckCheck size={20}/><span>完整报告已保存<strong>打开报告，回看原文依据</strong></span><ArrowRight size={20}/></a>}
          <button className={`${ui.primary} ${styles.full}`} disabled={account.loading || locked || (library.kind === "chat" && !isWindow ? (!reportReady && !receipt) : !chosen.length) || (!isWindow && (!consent || !hasPrice(account.account,costKey)))} onClick={() => void analyze()}>{analyzing ? <><LoaderCircle size={18} className={styles.spin}/>正在分析，请稍候…</> : isWindow ? <>进入截图分析<ArrowRight size={18}/></> : <>{receipt ? "继续本次分析" : library.kind === "chat" ? "生成完整关系报告" : "分析选中材料"}<span> · {priceLabel(account.account,costKey)}</span><ArrowRight size={18}/></>}</button>

            </div>}
                      {library.reportLinks.length > 0 && <div className={styles.reportHistory}><History size={16}/>这份原文的报告{library.reportLinks.slice(-4).reverse().map((link,i) => <a key={link.reportId} href={`/report?id=${link.reportId}`}>{i === 0 ? "最近一次" : `此前报告 ${i}`}<ArrowRight size={13}/></a>)}</div>}
          </div>
          <div className={styles.materialTabs} role="tablist" aria-label="材料查看"><button role="tab" aria-selected={materialView==="records"} aria-controls="capture-originals" onClick={()=>setMaterialView("records")}><MessageSquare size={17}/>查看原文 / 调整选择</button><button role="tab" aria-selected={materialView==="status"} aria-controls="capture-status" onClick={()=>setMaterialView("status")}><Cloud size={17}/>导入情况与同步{coverage?.unreadVoice ? ` · ${coverage.unreadVoice} 条语音待补齐` : ""}</button></div>
          <div id="capture-status" role="tabpanel" hidden={materialView!=="status"} className={styles.materialPanel}>
          <div className={styles.cloudSync} data-cloud-sync><Cloud size={24}/><div><strong>{cloudBusy ? "正在同步，请稍候…" : library.cloud?.retired ? "旧的离线副本 · 不会自动同步" : library.cloud?.offline ? "当前查看本机副本" : library.cloud?.enabled ? "已开启跨设备继续" : "在手机上接着看这份聊天"}</strong><p>{library.cloud?.retired ? "云端已重新建立，这份旧副本仅供本机查看，可以单独删除。" : library.cloud?.enabled ? "新聊天和语音文字会继续同步。手机网页用同一账号，小程序关联网页账号后查看。" : "将这份材料的文字、语音转写和已采集图片保存到你的账号，直到你主动删除。同步不分析、不扣积分。"}</p>{cloudNote&&<p role="status">{cloudNote}</p>}</div><button className={ui.secondary} disabled={locked || account.loading || library.cloud?.retired} onClick={()=>void syncCurrentLibrary()}>{cloudBusy?<LoaderCircle className={styles.spin} size={17}/>:<UploadCloud size={17}/>} {library.cloud?.enabled ? "同步最新内容" : "启用跨端同步"}</button></div>
          <CaptureCoverage records={library.records} kind={library.kind}/>
          {activityNotice&&<p className={styles.warning}>{activityNotice}</p>}
          {method === "desktop" && library.kind === "chat" && library.records.some(row=>["uia","wechat-local-db"].includes(String(row.source.method))) && (coverage?.unreadVoice || 0) > 0 && <div className={styles.voiceQueue}>
            <div><strong>{databaseVoiceUnavailable ? "语音已保留，后台补全暂不可用" : localDatabase && coverage?.voiceMissingLocal === coverage?.unreadVoice ? "聊天已导入，语音文件还需同步" : "聊天已导入，语音可继续补全"}</strong>
              <p>{databaseVoiceUnavailable ? (health?.backgroundMessage || "当前助手暂不能后台补全这份语音。已保存的聊天和转写仍可查看。") : backgroundVoice ? fullHistory ? `重新核对「${library.friend}」的全部历史，补全本机能读取的语音，已完成的转写直接复用。` : `后台转写「${library.friend}」最近 ${limit} 条消息中可读取的语音，完成一条保存一条，可以继续使用电脑。` : `补全「${library.friend}」最近 ${limit} 条消息中的语音。当前助手需要保持微信在前台；可随时停止。`}</p>
              {backgroundVoice && health?.backgroundModelReady === false && <p>首次补全需要下载语音识别模型，进度会显示在任务中；以后直接复用。</p>}
            </div>
            <div className={styles.voiceActions}>
              {(!localDatabase || (coverage?.voiceAvailable || 0) + (coverage?.voiceFailed || 0) > 0) && <button className={ui.secondary} disabled={!connected || locked || !!receipt || !!jobId || databaseVoiceUnavailable} onClick={()=>void capture(false,true)}>{databaseVoiceUnavailable ? "后台补全暂不可用" : backgroundVoice ? "后台补全语音" : "补全语音 · 需微信前台"}</button>}
              {(coverage?.voiceMissingLocal || 0) > 0 && <button className={ui.secondary} onClick={openSyncGuide}><Smartphone size={17}/>同步缺少的语音</button>}
            </div>
          </div>}
          {library.warnings.length > 0 && <p className={styles.warning}>{library.warnings.join(" ")}</p>}
          </div>
          <div id="capture-originals" role="tabpanel" hidden={materialView!=="records"} className={styles.materialPanel}>
          <div className={styles.previewTools} data-tour="capture-selection"><label><Search size={18}/><input placeholder="搜索原文、时间或说话人" value={query} onChange={e => { setQuery(e.target.value); setRecordPage(0); }}/></label><button disabled={locked || !!receipt} onClick={() => selectPending(library)}>{library.records.some(visualSource) ? "选择待分析画面" : "选择最近待分析"}</button><button disabled={locked || !!receipt || !selected.length} onClick={() => { setSelected([]); setConsent(false); setError(""); }}>清空选择</button></div>
          <div ref={recordList} className={styles.records} aria-label="采集原文列表">{display.map(record => { const done = !pending.some(r => r.localId === record.localId), notice = mediaNotice(record); return <article key={record.localId} data-source-id={record.localId} data-selected={selected.includes(record.localId)}><label className={styles.recordCheck}><input type="checkbox" checked={selected.includes(record.localId)} disabled={locked || done || !!receipt} onChange={e => toggleRecord(record,e.target.checked)}/><span><strong>{visualSource(record) ? `第 ${library.records.indexOf(record) + 1} 张采集画面` : library.kind === "chat" ? record.senderRole === "self" ? "我" : record.senderRole === "other" ? library.friend : record.sender || "身份待核对" : `第 ${library.records.indexOf(record) + 1} 条动态`}</strong><small>{record.source.method === "video-import" ? `录屏位置 ${videoTime(Number(record.source.videoTime) || 0)}` : record.at || "原文未显示时间"}{done ? " · 已分析" : ""}</small></span></label>{record.text && <p>{record.text}</p>}{record.images?.length ? <div className={styles.recordImages}>{record.images.map((img,n) => <button key={n} onClick={() => setImage(`data:${img.mime};base64,${img.data}`)} aria-label={`查看${record.source.label}的图片${n+1}`}><img src={`data:${img.mime};base64,${img.data}`} alt={img.name}/></button>)}</div> : null}{notice && <p className={styles.mediaNotice}><Images size={16}/>{notice}</p>}<small className={styles.source}>{record.source.label}{record.kind === "sticker" ? " · 表情包" : ""}</small></article>; })}{!display.length && <p className={styles.muted}>没有找到匹配的原文，请换个关键词。</p>}</div>
          <nav className={styles.pagination} aria-label="原文分页"><p className={styles.pageSummary}>{visible.length ? `${currentPage * 50 + 1}–${Math.min((currentPage + 1) * 50, visible.length)}` : "0"} / {visible.length} 条 · 已选 {selected.length} 条</p><div><button className={ui.secondary} disabled={currentPage === 0} onClick={() => setRecordPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pageCount}</span><button className={ui.secondary} disabled={currentPage >= pageCount - 1} onClick={() => setRecordPage(currentPage + 1)}>下一页</button></div></nav>

          </div>
        </section> : method === "desktop" && <section className={styles.empty}><div className={styles.emptyIllustration}><MessageSquare size={50}/><ArrowRight size={26}/><FileText size={50}/></div><span className={styles.eyebrow}>从采集到原文，一眼看清</span><h2>先选好友，再把原文带进来。</h2><p>完成后，这里会列出消息或动态，标明新增与重复条数。勾选需要分析的内容，就能得到可回看依据的报告。</p><div className={styles.emptyFeatures}><span><CheckCheck size={19}/>重复核对</span><span><Search size={19}/>原文可查</span><span><ShieldCheck size={19}/>确认后分析</span></div></section>}
      </div>
    </div>
    {image && <div className={styles.imageModal} role="dialog" aria-modal="true" aria-label="来源截图" onClick={() => setImage(null)}><button onClick={() => setImage(null)} aria-label="关闭来源截图"><X size={23}/></button><img src={image} alt="来源截图完整预览" onClick={e => e.stopPropagation()}/></div>}
  </main></div>;
}
