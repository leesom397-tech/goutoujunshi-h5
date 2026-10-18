"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CheckCheck, Cloud, RefreshCw, Download, FileText, HardDrive, History, Images, Link2, LoaderCircle, MessageSquare, Monitor, Plug, Search, ShieldCheck, Smartphone, Square, Trash2, UploadCloud, FileVideo, X } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { FirstUseTour } from "@/components/FirstUseTour";
import {CaptureAnalysisStatus} from "@/components/CaptureAnalysisStatus";
import {CaptureCoverage} from "@/components/CaptureCoverage";
import {captureCoverage,captureMediaNotice} from "@/lib/capture-coverage";
import { ScreenCapture, type CapturedFrame } from "@/components/ScreenCapture";
import { VideoImport, type ImportedVideoFrame, type VideoImportContext } from "@/components/VideoImport";
import { api, message, useAccount, AccountNotice, PersonSelect, InlinePerson, hasPrice, priceLabel, WebError, type Json } from "@/components/web-analysis/client";
import { bridgeRequest, BridgeError, type BridgeHealth } from "@/lib/desktop-bridge-client";
import { readHistoryProgress, writeHistoryProgress, clearHistoryProgress, newHistoryProgress, runHistoryImport, type HistoryProgress } from "@/lib/capture-history-import";
import { saveCaptureBatch, getCaptureLibrary, pendingCaptureRecords, removeCaptureLibrary, type CaptureLibrary } from "@/lib/desktop-capture-vault";
import { captureLibraryId, splitCaptureBatch, type CaptureKind, type CaptureBatch, type StoredCaptureRecord } from "@/lib/desktop-capture";
import { captureIntakeSubject, rememberCaptureSubject, rememberIntakePreference } from "@/components/web-analysis/intake-preferences";
import { intakeHref, intakeReturnTo } from "@/components/web-analysis/intake-navigation";
import { matchImportedVideoFrames } from "@/lib/video-import";
import { CAPTURE_ANALYSIS_LIMIT, captureAnalysisInput, captureReadableText } from "@/lib/capture-analysis-input";
import { selectPendingCaptureRecords } from "@/lib/capture-selection";
import { createCaptureQuestion } from "@/lib/capture-question-handoff";
import { relatedMomentLibraries, captureReportQuestion } from "@/lib/person-analysis-navigation";
import { consumeCaptureHandoff, isCaptureHandoff, stageCaptureHandoff } from "@/lib/capture-pairing-handoff";
import { discoverCaptureConnection, rememberCaptureConnectionEntry, restoreCaptureConnectionEntry } from "@/lib/capture-connection-discovery";
import { readCaptureConnectionSession, saveCaptureConnectionSession, forgetCaptureConnectionSession, watchCaptureConnectionRevocation, captureConnectionRevision } from "@/lib/capture-connection-session";
import { captureContactKey, contactFromCaptureLibrary, type CaptureContact } from "@/lib/capture-subject-client";
import { selectCaptureMemory } from "@/lib/capture-memory-selection";
import { ChatActivity } from "@/components/ChatActivity";
import { prepareChatActivityUpload } from "@/lib/chat-activity";
import {momentsOutcome,momentsEntryKey,type MomentsAttempt} from '@/lib/capture-moments-outcome';
import { CaptureCloudError, listSyncedCaptureLibraries, openSyncedCaptureLibrary, syncCaptureLibrary, deleteCloudCaptureLibrary, linkSyncedReportSources, type SyncedLibrarySummary } from "@/lib/capture-cloud-client";
import ui from "@/components/AuroraUI.module.css";
import styles from "./capture.module.css";
import "@/components/web-analysis/web-analysis.css";

const visualSource = (row: StoredCaptureRecord) => ["screen-capture", "video-import"].includes(String(row.source.method));
const videoTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2,"0")}:${Math.floor(seconds % 60).toString().padStart(2,"0")}`;
const contactAvatar = (row: WechatContact): string => {
  if (row.avatarData && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(row.avatarData) && row.avatarData.length < 100000) return row.avatarData;
  try { const url = new URL(row.avatarUrl || ""); if (url.protocol === "https:" && /(^|\.)(qlogo|qpic)\.cn$/.test(url.hostname)) return url.href; } catch {}
  return "";
};
const contactDisplayName = (name: string) => name.replace(/ · #[a-fA-F0-9]{16}$/, "");

type Job = { status: string; progress?: number; message?: string; result?: CaptureBatch; partial?: CaptureBatch; partialRevision?: number; error?: string | {message?:string} };
type StoredCaptureJob = { jobId: string; kind?:CaptureKind; history?: boolean; voiceHistory?: boolean; friend?: string; contactId?: string; accountKey?: string; includeVoice?: boolean; startedAt?: number };
type PersonImportPlan={chatId:string|null;subjectId:string;contactId:string;accountKey:string;friend:string;entryKey?:string};
type WechatContact = CaptureContact;
type JobPhase = "idle" | "checking" | "running" | "done" | "failed" | "missing";
class CapturePairSourceError extends Error {}
type RelatedSnapshot = {libraryId:string;kind:"moments";expectedEpoch:number;expectedTotal:number};
type Receipt = { requestId: string; libraryId: string; sourceIds: string[]; historyIds?: string[]; subjectId: string; kind: CaptureKind; returnTo?: string; analysisScope?: "fullHistory"; cloudId?: string; expectedTotal?: number; expectedEpoch?: number; relatedSnapshots?:RelatedSnapshot[]; question?: typeof diagnosticQuestions[number] };
const diagnosticQuestions = ["panorama", "attitude", "trend", "worth", "next", "risk"] as const;
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => { const stop = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }; const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop(); });
const stored = <T,>(key: string): T | null => { try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch { return null; } };
const remember = (key: string, value: unknown) => { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); };

export default function CapturePage() {
  const account = useAccount(), owner: string = account.account?.account?.userId || "";
  const generation = useRef(0), abort = useRef<AbortController | null>(null), token = useRef(""), recordList = useRef<HTMLDivElement | null>(null), openingLibrary = useRef(0), syncGuide = useRef<HTMLDetailsElement | null>(null), currentLibrary = useRef<CaptureLibrary | null>(null);
  const requestedSubject = useRef(""), personChosen = useRef(false), autoSyncedKey = useRef("");
  const importSubject=useRef<{key:string;owner:string;friend:string;subjectId:string;label:string;libraryIds:string[]}|null>(null);
  const preparingSubject=useRef<Promise<string>|null>(null);
  const [subjectBusy,setSubjectBusy]=useState(false);
  const openedDeepLink = useRef("");
  const connectionAttempt=useRef(0);
  const [relatedLoading, setRelatedLoading] = useState(false), [relatedError, setRelatedError] = useState("");
  const [relatedRetry, setRelatedRetry] = useState(0);
  const [needsWindows,setNeedsWindows]=useState(false),[handoffCopied,setHandoffCopied]=useState(false);
  useEffect(()=>setNeedsWindows(!/Win/i.test(navigator.platform)),[]);
  async function copyWindowsHandoff(){try{await navigator.clipboard.writeText(window.location.href.split("#")[0]);setHandoffCopied(true);}catch{setError("请复制浏览器地址，在 Windows 电脑打开。");}}
  const [cloudBusy,setCloudBusy] = useState(false), [cloudNote,setCloudNote] = useState(""), [cloudError,setCloudError] = useState(""), [librariesLoading,setLibrariesLoading]=useState(false);
  const [returnTo,setReturnTo] = useState("");
  const [pairExpanded,setPairExpanded]=useState(false),[connectionHint,setConnectionHint]=useState("");
  const [method, setMethod] = useState<"desktop" | "window" | "video" | "library">("desktop"), [kind, setKind] = useState<CaptureKind>("chat"), [friend, setFriend] = useState(""), [wechatAccount, setWechatAccount] = useState(""), [code, setCode] = useState(""), [limit, setLimit] = useState(40), [health, setHealth] = useState<BridgeHealth | null>(null), [connected, setConnected] = useState(false);
  const [contacts,setContacts] = useState<WechatContact[]>([]), [selectedContact,setSelectedContact] = useState<WechatContact|null>(null), [contactSearch,setContactSearch] = useState<"idle"|"searching"|"ready"|"error">("idle"), [contactHint,setContactHint] = useState("");
  const [busy, setBusy] = useState(false), [analyzing, setAnalyzing] = useState(false), [error, setError] = useState(""), [note, setNote] = useState(""), [jobId, setJobId] = useState(""), [progress, setProgress] = useState(0), [jobPhase, setJobPhase] = useState<JobPhase>("idle"), [jobMessage, setJobMessage] = useState("");
  const [library, setLibrary] = useState<CaptureLibrary | null>(null), [libraries, setLibraries] = useState<SyncedLibrarySummary[]>([]), [stats, setStats] = useState<{added:number;repeated:number;updatedVoice:number;total:number}|null>(null), [query, setQuery] = useState(""), [selected, setSelected] = useState<string[]>([]), [subject, setSubject] = useState(""), [consent, setConsent] = useState(false), [receipt, setReceipt] = useState<Receipt | null>(null), [reportId, setReportId] = useState(""), [image, setImage] = useState<string | null>(null);
  const [diagnosticQuestion, setDiagnosticQuestion] = useState<"panorama" | "attitude" | "trend" | "worth" | "next" | "risk">("panorama");
  const [personImport,setPersonImport]=useState<"idle"|"chat"|"moments">("idle");
  const [personIntent,setPersonIntent]=useState(false);
  const personImporting=useRef(false), personStopped=useRef(false);
  const [relatedMoments,setRelatedMoments]=useState<CaptureLibrary[]>([]);
  const locked = busy || analyzing || cloudBusy || subjectBusy || personImport!=="idle";
  currentLibrary.current = library;
  const [recordPage, setRecordPage] = useState(0);
  const [historyState,setHistoryState]=useState<HistoryProgress|null>(null), [historyRunning,setHistoryRunning]=useState(false), [showMethods,setShowMethods]=useState(false), [autoVoicePending,setAutoVoicePending]=useState(false);
  const [showAnalysis,setShowAnalysis]=useState(false), [adjustPerson,setAdjustPerson]=useState(false), [materialView,setMaterialView]=useState<"none"|"records"|"status">("none");
  const [showImportControls,setShowImportControls]=useState(false);
  const [supplementMoments,setSupplementMoments]=useState(false);
  const [momentsAttempt,setMomentsAttempt]=useState<MomentsAttempt|null>(null);
  function updateMomentsAttempt(value:MomentsAttempt|null,scope=owner){setMomentsAttempt(value);remember(`chengzi-capture:${scope}:moments-attempt`,value);}
  const revealReportAfterImport=useRef(false);
  const [voiceEnriching,setVoiceEnriching]=useState(false);
  const [contactRetry,setContactRetry]=useState(0);
  const [allVisibleMoments,setAllVisibleMoments]=useState(true);
  const [idleSeconds,setIdleSeconds]=useState(0), [analysisSeconds,setAnalysisSeconds]=useState(0);
  const lastProgressAt=useRef(Date.now());
  useEffect(()=>{lastProgressAt.current=Date.now();setIdleSeconds(0);},[jobId,note,jobMessage,progress,library?.records.length,library?.updatedAt]);
  useEffect(()=>{if(!jobId)return;const timer=setInterval(()=>setIdleSeconds(Math.floor((Date.now()-lastProgressAt.current)/1000)),2000);return()=>clearInterval(timer);},[jobId]);
  useEffect(()=>{setAnalysisSeconds(0);if(!analyzing)return;const started=Date.now(),timer=setInterval(()=>setAnalysisSeconds(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[analyzing]);
  useEffect(()=>{
    if(!revealReportAfterImport.current || busy || personImport!=="idle" || jobId || !library)return;
    revealReportAfterImport.current=false;
    setShowImportControls(false);setMaterialView("none");
    const frame=requestAnimationFrame(()=>document.getElementById("capture-preview")?.scrollIntoView({block:"start",behavior:"smooth"}));
    return()=>cancelAnimationFrame(frame);
  },[busy,personImport,jobId,library?.id]);
  const handoff=useRef("");
  const helperEntry=useRef(false), discoveryPaused=useRef(false), connectionState=useRef({connected:false,method:"desktop",busy:false});
  const connectionDiscovery=useRef<ReturnType<typeof discoverCaptureConnection>|null>(null);
  connectionState.current={connected,method,busy};
  const focusQuery=()=>{const focus=new URLSearchParams(window.location.search).get("focus");return focus && ["affinity","intent","reply"].includes(focus)?`&focus=${focus}`:"";};
  function chooseMethod(value: typeof method) {
    setShowMethods(false); setMethod(value);
    if(owner)try{localStorage.setItem(`chengzi-capture:${owner}:method`,value);}catch{}
  }
  async function syncRelatedMoments(scope:string, person:string, chat:CaptureLibrary):Promise<RelatedSnapshot[]> {
    if (relatedLoading || relatedError) throw Error(relatedError || "正在核对同一位好友的朋友圈，请稍候。");
    if(!relatedMoments.length)return [];
    const snapshots:RelatedSnapshot[]=[], syncedSources:CaptureLibrary[]=[];
    for(const moments of relatedMoments){
      if(!moments.records.length)continue;
      const knownSubject=moments.cloud?.subjectId||captureIntakeSubject(scope,moments.id,[person]);
      if(!person||moments.ownerId!==scope||moments.account!==chat.account||moments.friend!==chat.friend&&knownSubject!==person)throw Error("请核对这些材料是否属于同一位微信好友，再合并分析。");
      const synced=await syncCaptureLibrary(scope,moments,{subjectId:person});
      if(!synced.cloud?.enabled||synced.cloud.offline||synced.cloud.retired||synced.cloud.total!==synced.records.length)throw Error("朋友圈尚未同步完整，聊天已经保存。请重试同步后生成整体报告。");
      rememberCaptureSubject(scope,synced.id,person);syncedSources.push(synced);
      snapshots.push({libraryId:synced.cloud.id,kind:"moments",expectedEpoch:synced.cloud.epoch,expectedTotal:synced.records.length});
    }
    setRelatedMoments(syncedSources);
    return snapshots;
  }

  async function askSelected() {
    if(!owner||!library||analyzing||cloudBusy||busy&&!jobId||receipt||isWindow||library.kind!=="chat")return;
    const ticket=generation.current, scope=owner;
    try {
      if (busy && jobId) await cancel();
      setCloudBusy(true);setError("");setNote("正在将完整聊天关联到这个人的档案，完成后打开提问…");
      const person=subject||await ensureImportSubject(null,library);
      const synced=await syncCaptureLibrary(scope,library,{subjectId:person});
      await syncRelatedMoments(scope,person,synced);
      if(ticket!==generation.current)return;
      if(!synced.cloud?.enabled || synced.cloud.offline || synced.cloud.retired || synced.cloud.total!==synced.records.length)throw Error("完整聊天尚未同步到人物档案，请稍后重试。原文仍保存在本机。");
      setLibrary(synced);
      const result=createCaptureQuestion({owner:scope,subjectId:person,friend:synced.friend,records:[],fullHistory:true,historyCount:synced.records.length});
      window.location.href=result.href;
    }catch(e){if(ticket===generation.current){setError(message(e));setNote("");}}
    finally{if(ticket===generation.current)setCloudBusy(false);}
  }
  const scopeKey = (name: string) => `chengzi-capture:${owner}:${name}`;
  function clearStoredJob(expected?: string) {
    const saved = stored<StoredCaptureJob>(scopeKey("job"));
    if (expected && saved?.jobId !== expected) return;
    if (saved?.history && saved.friend && (!expected || saved.jobId === expected)) {
      const checkpoint = readHistoryProgress(saved.voiceHistory ? owner+':voice' : owner, saved.friend);
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
    if(incoming!==null){if(isCaptureHandoff(incoming)){helperEntry.current=true;handoff.current=incoming;try{stageCaptureHandoff(incoming,sessionStorage);}catch{}}window.history.replaceState(null,"",window.location.pathname+window.location.search);}
    if (params.get("kind") === "moments") { setKind("moments"); setLimit(10); }
    const requested = params.get("method");
    if (requested === "computer") setMethod(/Mac/i.test(navigator.platform) && navigator.maxTouchPoints < 2 ? "window" : "desktop");
    else if (requested === "video" || requested === "window" || requested === "desktop" || requested === "library") setMethod(requested);
    else if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1) setMethod("video");
    else if (/Mac/i.test(navigator.platform)) setMethod("window");
  }, []);
  useEffect(() => {
    const current = ++generation.current; abort.current?.abort(); token.current = "";
    connectionState.current.connected=false;revealReportAfterImport.current=false;
    importSubject.current=null;preparingSubject.current=null;setSubjectBusy(false);
     setConnected(false); setHealth(null); setLibrary(null); setLibraries([]); setSelected([]); setStats(null); setReceipt(null); setConsent(false); setFriend(""); setWechatAccount(""); setSubject(""); setQuery(""); setRecordPage(0); setReportId(""); setImage(null); setDiagnosticQuestion("panorama"); setBusy(false); setAnalyzing(false); setJobId(""); setProgress(0); setJobPhase("idle"); setJobMessage(""); setNote(""); setError(""); setHistoryState(null); setHistoryRunning(false); setContacts([]); setSelectedContact(null); setContactSearch("idle"); setContactHint("");
    setShowAnalysis(false);setAdjustPerson(false);setMaterialView("none");setAutoVoicePending(false);setShowImportControls(false);setVoiceEnriching(false);
    personStopped.current=true;personImporting.current=false;setPersonImport("idle");setRelatedMoments([]);
    setReturnTo(""); personChosen.current = false; autoSyncedKey.current="";openedDeepLink.current="";setCloudBusy(false);setCloudNote("");setCloudError(""); if (!owner) return;
    discoveryPaused.current=stored<boolean>(`chengzi-capture:${owner}:auto-connect-paused`)===true;
    if(!handoff.current)try{handoff.current=consumeCaptureHandoff(sessionStorage);if(handoff.current)helperEntry.current=true;}catch{}
    if(helperEntry.current){try{const entry=restoreCaptureConnectionEntry(owner,window.location.href,localStorage);if(entry)window.history.replaceState(null,"",entry);}catch{}helperEntry.current=false;}
    const entryParams=new URLSearchParams(window.location.search);
    const previousMoments=stored<MomentsAttempt>(`chengzi-capture:${owner}:moments-attempt`);
    const savedMoments=previousMoments?.entryKey===momentsEntryKey(entryParams)?previousMoments:null;
    setMomentsAttempt(savedMoments);
    if(savedMoments&&(entryParams.get('kind')==='moments'||entryParams.get('intent')==='supplement-moments')){setShowImportControls(true);setFriend(contactDisplayName(savedMoments.friend));setKind('moments');setAllVisibleMoments(savedMoments.allVisible);}
    setDiagnosticQuestion(captureReportQuestion(entryParams.get("question"))||"panorama");
    setPersonIntent(["person","supplement-moments"].includes(entryParams.get("intent")||""));
    setSupplementMoments(entryParams.get("intent")==="supplement-moments");
    if(entryParams.get("intent")==="supplement-moments"){setMethod("desktop");setKind("moments");setShowImportControls(true);}
    if(entryParams.get("kind")==="moments"){setKind("moments");setLimit(10);}
    setReturnTo(intakeReturnTo(entryParams.get("returnTo")));
    if(!new URLSearchParams(window.location.search).has("method")){
      const fallback=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||/Mac/i.test(navigator.platform)&&navigator.maxTouchPoints>1 ? "video" : /Mac/i.test(navigator.platform) ? "window" : "desktop";
      try{const saved=localStorage.getItem(`chengzi-capture:${owner}:method`);setMethod(saved==="desktop"||saved==="window"||saved==="video"||saved==="library" ? saved : fallback);}catch{setMethod(fallback);}
    }
    requestedSubject.current = new URLSearchParams(window.location.search).get("subjectId") || "";
    void refreshLibraries(owner,current);
    setPairExpanded(false);setConnectionHint("");
    if(!handoff.current&&!discoveryPaused.current)void resumeExistingConnection(current).catch(cause=>{if(current===generation.current)setError(message(cause));});
    const requestedContact = (new URLSearchParams(window.location.search).get("contactSearch") || "").trim().slice(0,100);
    if(requestedContact)setFriend(requestedContact);
    else if(savedMoments&&entryParams.get('kind')==='moments')setFriend(contactDisplayName(savedMoments.friend));
    else try{setFriend(contactDisplayName(localStorage.getItem(`chengzi-capture:${owner}:last-friend`)||""));}catch{}
    const running = stored<StoredCaptureJob>(`chengzi-capture:${owner}:job`);
    if(savedMoments&&entryParams.get('kind')==='moments'){
      setSelectedContact({contactId:savedMoments.contactId,accountKey:savedMoments.accountKey,label:savedMoments.friend,nickname:'',remark:''});
      if(savedMoments.libraryId&&!running?.jobId)void getCaptureLibrary(owner,savedMoments.libraryId).then(value=>{if(current!==generation.current||!value)return;setLibrary(value);currentLibrary.current=value;setShowImportControls(true);}).catch(()=>{});
    }
    if (running?.jobId && (running.kind!=='moments'||!!savedMoments)) {
      // Do not discard a long-running history task only because the browser
      // tab has been open for a while.  The bridge is the source of truth;
      // the validation loop below clears the id only after a real 404 or a
      // terminal response.  This prevents a live import from looking failed
      // just because it crossed the old twenty-five-minute browser timeout.
      setJobId(running.jobId); setJobPhase("checking"); setJobMessage("正在核对上次导入任务…");
      if(running.kind)setKind(running.kind);
      if (running.history && running.friend) setHistoryState(readHistoryProgress(owner, running.friend));
    }
    const previous = stored<Receipt>(`chengzi-capture:${owner}:analysis`);
    if (previous) void getCaptureLibrary(owner, previous.libraryId).then(value => { if (current !== generation.current || !value) return; setLibrary(value); setSelected(previous.sourceIds); setRecordPage(Math.floor(Math.max(0, value.records.findIndex(row => previous.sourceIds.includes(row.localId))) / 50)); setReceipt(previous); setReturnTo(back=>back || intakeReturnTo(previous.returnTo)); setKind(previous.kind); setSubject(previous.subjectId); setFriend(contactDisplayName(value.friend)); setNote("上次的分析请求已保留，可继续取回结果。"); }).catch(e => { if (current === generation.current) setError(message(e)); });
    return () => { generation.current++; abort.current?.abort(); };
  }, [owner]);
  useEffect(()=>watchCaptureConnectionRevocation(()=>{
    generation.current++;connectionAttempt.current++;abort.current?.abort();discoveryPaused.current=true;token.current="";connectionState.current.connected=false;
    if(owner)remember(`chengzi-capture:${owner}:connection`,null);
    setConnected(false);setHealth(null);setConnectionHint("已退出账号，请重新登录后连接助手。");
  }),[owner]);
  useEffect(()=>{if(!owner)return;let saved="";try{saved=consumeCaptureHandoff(sessionStorage);}catch{}const value=saved||handoff.current;handoff.current="";if(value)void connect(value);},[owner]);
  useEffect(()=>{
    if(!owner)return;const ticket=generation.current, key=`chengzi-capture:${owner}:connection`;
    const discovery=discoverCaptureConnection({owner,getConnection:()=>connectionState.current.connected&&token.current?stored<{token:string;expiresAt:number}>(key):null,canConnect:()=>!discoveryPaused.current&&!token.current&&!connectionState.current.busy&&connectionState.current.method==="desktop",accept:async(connection,signal)=>{
      const attempt=++connectionAttempt.current,current=()=>attempt===connectionAttempt.current&&ticket===generation.current&&!signal.aborted&&!discoveryPaused.current;
      const session=await bridgeRequest<{connected:boolean;expiresIn?:number}>("/session",{token:connection.token,signal,timeoutMs:4000});
      if(!current()||token.current||connectionState.current.method!=="desktop"||connectionState.current.busy||!session.connected)return;
      const verified={token:connection.token,expiresAt:Math.min(connection.expiresAt,Date.now()+(session.expiresIn||28800)*1000)};
      await saveCaptureConnectionSession(owner,verified,current);
      if(!current())return;
      token.current=connection.token;remember(key,{...verified,revision:captureConnectionRevision()});setConnected(true);setCode("");setError("");setNote("已连接本机助手。选择联系人后，由你确认开始导入。");
      void bridgeRequest<BridgeHealth>("/health",{signal}).then(status=>{if(!signal.aborted&&ticket===generation.current&&token.current===connection.token)setHealth(status);}).catch(()=>{});
    }});connectionDiscovery.current=discovery;
    return()=>{discovery.close();if(connectionDiscovery.current===discovery)connectionDiscovery.current=null;};
  },[owner]);
  function rememberConnectionEntry(){
    if(!owner||method!=="desktop")return;
    try{const url=new URL(window.location.href);if(friend.trim())url.searchParams.set("contactSearch",friend.trim());if(subject)url.searchParams.set("subjectId",subject);if(returnTo)url.searchParams.set("returnTo",returnTo);rememberCaptureConnectionEntry(owner,url.href,localStorage);}catch{}
  }
  useEffect(()=>{
    rememberConnectionEntry();
    connectionDiscovery.current?.announce();
  },[owner,method,friend,subject,returnTo,connected]);
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
    let lastMarker = "", lastActivityAt = Date.now(), observedRevision = 0;
    const inspect = () => {
      if (cancelled) return;
      let terminalResponse=false;
      void bridgeRequest<Job>(`/jobs/${encodeURIComponent(expected)}`, { token: token.current, timeoutMs: 10_000 }).then(async job => {
        if (cancelled || expected !== jobId) return;
        const saved = stored<StoredCaptureJob>(scopeKey("job"));
        const marker = JSON.stringify([job.message,job.progress,job.partialRevision]);
        if(marker!==lastMarker){lastMarker=marker;lastActivityAt=Date.now();}
        if(!saved?.history && job.partial && Number(job.partialRevision)>observedRevision){
          await accept(job.partial,owner,generation.current,true);
          observedRevision=Number(job.partialRevision);
          if(cancelled)return;
        }
        const terminal = ["done", "completed", "error", "failed", "cancelled"].includes(job.status);
        terminalResponse=terminal;
        if (!terminal) {
          setJobPhase("running");
          const value = Number(job.progress);
          setProgress(Number.isFinite(value) ? Math.min(99, Math.max(0, value)) : 0);
          const age = Date.now() - lastActivityAt;
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
          if(!saved?.history){
            const ticket=generation.current,completed=await accept(job.result,owner,ticket,false);
            if(cancelled)return;
            if(saved?.kind!=='moments')try{await restoreCompletedPersonPair(completed?.library,saved,owner,ticket);}catch(cause){if(!cancelled){setError(message(cause));setShowImportControls(true);}}
            if(cancelled)return;
            clearStoredJob(expected);setJobId("");setJobPhase("idle");setJobMessage("");
            return;
          }
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
        if(saved?.kind==='moments'){const attempt=stored<MomentsAttempt>(scopeKey('moments-attempt'));if(attempt)updateMomentsAttempt({...attempt,status:'failed',detail:text});setShowImportControls(true);revealReportAfterImport.current=false;}
        setJobMessage(text); setNote(text);
      }).catch(cause => {
        if (cancelled || expected !== jobId) return;
        if(cause instanceof CapturePairSourceError||terminalResponse){const attempt=stored<MomentsAttempt>(scopeKey('moments-attempt'));if(attempt?.jobId===expected)updateMomentsAttempt({...attempt,status:'failed',detail:message(cause)});revealReportAfterImport.current=false;openedDeepLink.current=`${owner}:${new URLSearchParams(window.location.search).get("libraryId")||""}`;clearStoredJob(expected);setJobId("");setJobPhase("failed");setProgress(0);setJobMessage(message(cause));setError(message(cause));setShowImportControls(true);}
        else if (cause instanceof BridgeError && cause.status === 404) {
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
    if (!owner || !connected || method !== "desktop" || (kind !== "chat" && kind !== "moments") || !friend.trim()) {
      setContacts([]); setContactSearch("idle"); setContactHint(""); if (kind !== "chat" && kind !== "moments") setSelectedContact(null); return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setContactSearch("searching"); setContactHint("正在查找本机微信联系人…");
    const timer = setTimeout(() => {
      void bridgeRequest<{ contacts?: Array<{ contactId?:unknown; label?:unknown; nickname?:unknown; remark?:unknown; wechatId?:unknown; avatarUrl?:unknown; avatarData?:unknown }>; accountKey?:unknown; hasMore?:unknown; message?:unknown }>("/contacts/search", {
        token: token.current, body: {query:friend.trim()}, signal:controller.signal, timeoutMs:45000,
      }).then(result => {
        if (cancelled) return;
        const accountKey = typeof result.accountKey === "string" ? result.accountKey : "";
        if (!accountKey) throw Error("助手未返回当前微信账号信息，请重启或更新助手后重试。");
        const candidates = Array.isArray(result.contacts) ? result.contacts.slice(0,20).filter(row =>
          typeof row.contactId === "string" && !!row.contactId && typeof row.label === "string" && !!row.label && row.label.length <= 100
        ).map(row => ({contactId:row.contactId as string,label:row.label as string,nickname:typeof row.nickname === "string" ? row.nickname : "",remark:typeof row.remark === "string" ? row.remark : "",wechatId:typeof row.wechatId === "string" ? row.wechatId : "",avatarUrl:typeof row.avatarUrl === "string" ? row.avatarUrl : "",avatarData:typeof row.avatarData === "string" ? row.avatarData : "",accountKey})) : [];
        setContacts(candidates);
        const savedJob=stored<StoredCaptureJob>(scopeKey("job"));
        const matchingSavedJob=savedJob?.jobId && savedJob.friend && savedJob.contactId && savedJob.accountKey
          ? candidates.find(row => row.label === savedJob.friend && row.contactId === savedJob.contactId && row.accountKey === savedJob.accountKey)
          : undefined;
        setSelectedContact(previous => supplementMoments && previous ? previous.accountKey===accountKey ? candidates.find(row=>row.contactId===previous.contactId&&row.accountKey===previous.accountKey)||previous : null : previous && candidates.some(row => row.contactId === previous.contactId && row.label === previous.label && row.accountKey === previous.accountKey) ? previous : matchingSavedJob || null);
        setContactSearch("ready");
        setContactHint(matchingSavedJob ? `已找回上次选中的「${matchingSavedJob.label}」，可继续导入。` : candidates.length ? `找到 ${candidates.length} 位匹配联系人，请选中要导入的那一位。${result.hasMore === true ? "结果较多，可继续输入完整备注缩小范围。" : ""}` : typeof result.message === "string" && result.message ? result.message : "没找到匹配联系人。请检查微信备注、昵称和当前登录账号。");
      }).catch(cause => {
        if (cancelled || controller.signal.aborted) return;
        setContacts([]); setSelectedContact(previous=>supplementMoments?previous:null); setContactSearch("error");
        setContactHint(cause instanceof BridgeError && cause.status === 404 ? "当前助手不支持联系人选择，请下载并启动新版助手。" : message(cause));
      });
    }, 350);
    return () => { cancelled=true; clearTimeout(timer); controller.abort(); };
  }, [owner,connected,method,kind,friend,contactRetry,supplementMoments]);
  // A full history pass must stay fast.  Once the text pages are committed,
  // run the bounded background voice enrichment against the saved library.
  // This effect deliberately starts only after the library state has updated;
  // it prevents the first text import from waiting on local ASR/model startup.
  useEffect(() => {
    if (personImporting.current || personImport!=="idle" || !autoVoicePending || !owner || !connected || !library || library.kind !== "chat" || busy || analyzing || cloudBusy || showAnalysis || receipt || health?.capabilities.backgroundVoice !== true) return;
    const timer = window.setTimeout(() => {
      setAutoVoicePending(false);
      void capture(false, true, true);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [autoVoicePending, owner, connected, library?.id, busy, analyzing, cloudBusy, showAnalysis, receipt, health?.capabilities.backgroundVoice,personImport]);
  useEffect(()=>{
    setRelatedMoments([]); setRelatedError(""); setRelatedLoading(false);
    if(!owner||library?.kind!=="chat"||personImporting.current)return;
    if(librariesLoading){setRelatedLoading(true);return;}
    let active=true;
    const key=`chengzi-capture:${owner}:person:${library.id}`;
    let pair=stored<{chatId:string;momentsId:string}>(key);
    try{pair=pair||JSON.parse(localStorage.getItem(key)||"null");}catch{}
    const matches = relatedMomentLibraries({...library,subjectId:subject}, libraries);
    const localId = pair?.chatId === library.id ? pair.momentsId : "";
    if (!matches.length && !localId) return;
    setRelatedLoading(true);
    void (async()=>{
      const values=await Promise.all(matches.map(item=>openSyncedCaptureLibrary(owner,item)));
      if(localId&&!matches.some(item=>item.id===localId)){const local=await getCaptureLibrary(owner,localId);if(local)values.push(local);}
      const unique=[...new Map(values.filter((value):value is CaptureLibrary=>!!value).map(value=>[value.cloud?.id||value.id,value])).values()];
      for(const value of unique){
        const currentSubject=subject||library.cloud?.subjectId, otherSubject=value.cloud?.subjectId||captureIntakeSubject(owner,value.id,currentSubject?[currentSubject]:[]);
        if(value.kind!=="moments"||value.ownerId!==owner||value.account!==library.account||value.friend!==library.friend&&(!currentSubject||currentSubject!==otherSubject))throw Error("朋友圈与当前微信好友的身份尚未核对，请重新关联后分析。");
        if(currentSubject&&otherSubject&&currentSubject!==otherSubject)throw Error("聊天与朋友圈关联的人物不同，请先核对档案。");
      }
      if(active)setRelatedMoments(unique);
    })().catch(cause => { if (active) setRelatedError(message(cause)); }).finally(() => { if (active) setRelatedLoading(false); });
    return()=>{active=false;};
  },[owner,library?.id,library?.cloud?.subjectId,subject,personImport,libraries,librariesLoading,relatedRetry]);
  useEffect(() => {
    const params=new URLSearchParams(window.location.search),id=params.get("libraryId"),supplement=params.get("intent")==="supplement-moments";
    if (!owner || account.loading || librariesLoading || !id || openedDeepLink.current === `${owner}:${id}` || locked || receipt || jobId) return;
    // Respect a restored paid request or a live import. A normal deep link only
    // opens an exact library; it never starts analysis or takes a payment.
    if (stored<Receipt>(scopeKey("analysis")) || stored<StoredCaptureJob>(scopeKey("job"))?.jobId) return;
    const item = libraries.find(row => (row.id === id || row.cloud?.id === id) && row.kind === (supplement?"chat":kind));
    if (!item) return;
    openedDeepLink.current = `${owner}:${id}`;
    if(!supplement){void openLibrary(item.id);return;}
    const ticket=generation.current,scope=owner;
    setBusy(true);setError("");setNote("正在准备这位好友的朋友圈导入…");
    void (async()=>{
      const chat=await openSyncedCaptureLibrary(scope,item);
      if(ticket!==generation.current)return;
      if(!chat||chat.kind!=="chat")throw Error("原聊天资料暂时无法打开，请刷新重试。");
      const requested=params.get("subjectId")||"";
      if(requested&&chat.cloud?.subjectId&&requested!==chat.cloud.subjectId)throw Error("原聊天已关联到另一位人物，请先核对资料。");
      await prepareMomentsImport(chat,requested||chat.cloud?.subjectId||"");
    })().catch(cause=>{if(ticket===generation.current)setError(message(cause));}).finally(()=>{if(ticket===generation.current)setBusy(false);});
  }, [owner, account.loading, librariesLoading, libraries, kind, locked, receipt, jobId]);
  useEffect(() => {
    if (!connected || !owner) return;
    let cancelled = false;
    void bridgeRequest<BridgeHealth>("/health").then(status => { if (!cancelled) setHealth(status); }).catch(() => {});
    return () => { cancelled = true; };
  }, [connected, owner]);
  useEffect(() => { recordList.current?.scrollTo({ top: 0 }); }, [recordPage, query, library?.id]);
  useEffect(() => { setShowAnalysis(false); setAdjustPerson(false); setMaterialView("none"); }, [library?.id]);
  useEffect(() => {
    if (!owner || !library || account.loading || locked || receipt) return;
    const allowed = account.people.map(person => String(person.id));
    if (subject && allowed.includes(subject)) return;
    if(subject&&importSubject.current?.subjectId===subject&&importSubject.current.libraryIds.includes(library.id))return;
    if (personChosen.current) { if (subject) setSubject(""); return; }
    const restored = (allowed.includes(requestedSubject.current) ? requestedSubject.current : "") || captureIntakeSubject(owner, library.id, allowed) || (allowed.includes(library.cloud?.subjectId || "") ? library.cloud!.subjectId! : "");
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
  const isWindow = !!(library?.records.length && library.records.every(visualSource)) || chosen.length > 0 && chosen.every(visualSource);
  const memoryRows = isWindow ? [] : selectCaptureMemory(library);
  const costKey = (library?.kind || kind) === "moments" ? "profile" : "analysisSmall";
  function choosePerson(value: string) {
    if (locked || receipt || account.loading) return;
    personChosen.current = true;
    setSubject(value); setConsent(false);
    if (library) rememberCaptureSubject(owner, library.id, value);
    rememberIntakePreference(owner, library?.kind || kind, {subjectId:value});
    if(importSubject.current&&library&&importSubject.current.libraryIds.includes(library.id))importSubject.current={...importSubject.current,subjectId:value};
  }
  async function ensureImportSubject(contact?:WechatContact|null,targetLibrary?:CaptureLibrary|null):Promise<string>{
    if(preparingSubject.current)return preparingSubject.current;
    const scope=owner,ticket=generation.current;
    if(!scope)throw Error("请登录后再导入。");
    setSubjectBusy(true);
    const pending=(async()=>{
      if(contact&&!targetLibrary){
        const candidates=[...(currentLibrary.current?.friend===contact.label?[currentLibrary.current.id]:[]),...libraries.filter(value=>value.kind==="chat"&&value.friend===contact.label).map(value=>value.id)];
        for(const id of new Set(candidates)){
          const previous=currentLibrary.current?.id===id?currentLibrary.current:await getCaptureLibrary(scope,id);
          if(!previous)continue;
          try{const restored=await contactFromCaptureLibrary(previous);if(restored&&captureContactKey(scope,restored)===captureContactKey(scope,contact)){targetLibrary=previous;break;}}catch{/* Unrelated legacy material cannot bind the newly selected contact. */}
        }
      }
      const identity=contact||targetLibrary&&await contactFromCaptureLibrary(targetLibrary)||null;
      if(!identity&&!targetLibrary)throw Error("请先选择要导入的微信联系人。");
      const key=identity?captureContactKey(scope,identity):JSON.stringify([scope,"library",targetLibrary!.id]);
      const allowed=account.people.map(person=>String(person.id));
      const existing=targetLibrary?(targetLibrary.id===library?.id?subject:"")||captureIntakeSubject(scope,targetLibrary.id,allowed)||targetLibrary.cloud?.subjectId||"":"";
      const explicit=requestedSubject.current||existing||(importSubject.current?.key===key?importSubject.current.subjectId:"");
      const result=await api("/api/web/capture/subject",{expectedOwnerId:scope,confirmed:true,consent:true,...(identity?{contact:identity}:{library:{id:targetLibrary!.id,account:targetLibrary!.account,friend:targetLibrary!.friend,kind:targetLibrary!.kind}}),...(explicit?{subjectId:explicit}:{})});
      if(ticket!==generation.current)throw new DOMException("Aborted","AbortError");
      if(typeof result.subjectId!=="string"||!/^[a-f0-9-]{36}$/i.test(result.subjectId))throw Error("人物关联结果尚未确认，请重试；不会重复建立档案。");
      const previous=importSubject.current;
      importSubject.current={key,owner:scope,friend:identity?.label||targetLibrary!.friend,subjectId:result.subjectId,label:typeof result.label==="string"?result.label:contactDisplayName(identity?.label||targetLibrary!.friend),libraryIds:[...new Set([...(previous?.key===key?previous.libraryIds:[]),...(targetLibrary?[targetLibrary.id]:[])])]};
      requestedSubject.current="";setSubject(result.subjectId);
      if(targetLibrary)rememberCaptureSubject(scope,targetLibrary.id,result.subjectId);
      rememberIntakePreference(scope,targetLibrary?.kind||kind,{subjectId:result.subjectId});
      await account.refresh();
      if(ticket!==generation.current)throw new DOMException("Aborted","AbortError");
      return result.subjectId as string;
    })();
    preparingSubject.current=pending;
    try{return await pending;}finally{if(preparingSubject.current===pending)preparingSubject.current=null;if(ticket===generation.current)setSubjectBusy(false);}
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
      const result=await syncCaptureLibrary(owner,library,{subjectId:subject,...(explicit&&library.cloud&&!library.cloud.enabled?{restore:true}:{}),onProgress:(done,total,phase)=>{if(ticket===generation.current)setCloudNote(phase==="images" ? `聊天已保存，图片已同步 ${done} / ${total} 张…` : phase==="reports" ? `材料已保存，正在同步报告依据 ${done} / ${total} 份…` : `正在同步${library.kind === "moments" ? "朋友圈" : "聊天"} ${done} / ${total} 条…`);}});
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
    const activeJob=stored<StoredCaptureJob>(`chengzi-capture:${scope}:job`);
    const attempt=stored<MomentsAttempt>(`chengzi-capture:${scope}:moments-attempt`);
    const currentAttempt=activeJob?.kind==='moments'&&attempt?.jobId===activeJob.jobId?attempt:null;
    if(activeJob&&(activeJob.kind==='moments'||batch.kind==='moments')&&!currentAttempt)throw new CapturePairSourceError('这项旧任务缺少本次采集的核对信息。请重新采集，已有材料仍然保留。');
    const outcome=currentAttempt?momentsOutcome(batch,currentAttempt,interim):null;
    if(outcome&&(outcome.status==='stale'||!outcome.received)){
      updateMomentsAttempt({...currentAttempt!,...outcome},scope);setShowImportControls(true);revealReportAfterImport.current=false;setNote(outcome.detail);
      return;
    }
    const chunks = splitCaptureBatch(batch);
    let result: Awaited<ReturnType<typeof saveCaptureBatch>> | undefined;
    for (const chunk of chunks) {
      if (ticket !== generation.current) return;
      const saved = await saveCaptureBatch(scope, chunk);
      result = result ? {...saved,added:result.added+saved.added,repeated:result.repeated+saved.repeated,updatedVoice:result.updatedVoice+saved.updatedVoice,newRecords:[...result.newRecords,...saved.newRecords]} : saved;
    }
    if (!result) return;
    if (ticket !== generation.current) return;
    // Check the returned source before associating it with a person or exposing
    // it to synchronization. A rejected batch may remain only as unbound local originals.
    const pairedSource=await verifiedPersonPairChat(result.library,stored<StoredCaptureJob>(`chengzi-capture:${scope}:job`)||selectedContact,scope,ticket);
    if(ticket!==generation.current)return;
    if(currentAttempt&&outcome){const added=currentAttempt.added+result.added;updateMomentsAttempt({...currentAttempt,...outcome,received:Math.max(currentAttempt.received,outcome.received),added,repeated:Math.max(0,outcome.received-added),total:result.total,libraryId:result.library.id},scope);setShowImportControls(true);revealReportAfterImport.current=false;}
    if (library?.id !== result.library.id) personChosen.current = false;
    const allowed = account.people.map(person=>String(person.id));
    const imported=importSubject.current;
    const importedSubject=imported?.owner===scope&&imported.friend===batch.friend&&selectedContact&&imported.key===captureContactKey(scope,selectedContact)?imported.subjectId:"";
    const associated = pairedSource?.plan.subjectId || importedSubject || (library?.id === result.library.id ? subject : captureIntakeSubject(scope,result.library.id,allowed) || (allowed.includes(requestedSubject.current)?requestedSubject.current:""));
    if(importedSubject&&!imported!.libraryIds.includes(result.library.id))imported!.libraryIds.push(result.library.id);
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
    if (!interim) setNote(outcome?outcome.detail:result.updatedVoice ? "已补全 " + result.updatedVoice + " 条语音文字，原记录不重复保存。" + (result.added ? "另新增 " + result.added + " 条材料。" : "") + "现在可以生成完整关系报告。" : result.added ? "采集完成。先核对人物与原文，再生成完整关系报告。" : "没有新增材料。已保存的原文仍可继续生成报告。");
    return {...result,subjectId:associated};
  }
  async function resumeExistingConnection(ticket=generation.current):Promise<boolean>{
    const attempt=++connectionAttempt.current,scope=owner,key=`chengzi-capture:${scope}:connection`,revision=captureConnectionRevision();
    const current=()=>attempt===connectionAttempt.current&&ticket===generation.current&&!discoveryPaused.current&&captureConnectionRevision()===revision;
    const tab=stored<{token:string;expiresAt:number;revision?:string}>(key);
    const saved=await readCaptureConnectionSession(scope,current),tabSession=tab&&(tab.revision||"")===revision&&tab.expiresAt>Date.now()?tab:null;
    const existing=saved&&(!tabSession||saved.expiresAt>tabSession.expiresAt)?saved:tabSession;
    if(!existing||!current()||!scope)return false;
    try{
      const session=await bridgeRequest<{connected:boolean;expiresIn?:number}>("/session",{token:existing.token,timeoutMs:6000});
      if(!session.connected)throw new BridgeError("助手连接已失效，请重新配对。",401,"TOKEN_INVALID");
      if(!current())return false;
      const verified={token:existing.token,expiresAt:Math.min(existing.expiresAt,Date.now()+(session.expiresIn||28800)*1000)};
      await saveCaptureConnectionSession(scope,verified,current);
      if(!current())return false;
      token.current=verified.token;remember(key,{...verified,revision});setConnected(true);setError("");setPairExpanded(false);setConnectionHint("");
      void bridgeRequest<BridgeHealth>("/health").then(status=>{if(ticket===generation.current&&token.current===verified.token)setHealth(status);}).catch(()=>{});
      return true;
    }catch(cause){
      if(!current())return false;
      token.current="";setConnected(false);
      if(cause instanceof BridgeError&&cause.status===401){remember(key,null);await forgetCaptureConnectionSession(scope,current);return false;}
      // A temporary network/permission error does not revoke a paired session.
      throw cause;
    }
  }
  async function connectOpenedAssistant(){
    if(!owner||locked)return;
    const ticket=generation.current,attempt=connectionAttempt.current+1,current=()=>ticket===generation.current&&attempt===connectionAttempt.current;discoveryPaused.current=false;remember(scopeKey("auto-connect-paused"),null);rememberConnectionEntry();
    connectionState.current.busy=true;setBusy(true);setError("");setConnectionHint("正在连接已打开的助手…");
    try{
      if(await resumeExistingConnection(ticket)){setNote("已连接原助手，继续当前步骤即可。");return;}
      if(!current())return;
      const status=await bridgeRequest<BridgeHealth>("/health",{timeoutMs:6000});
      if(!current())return;
      setHealth(status);setPairExpanded(true);setConnectionHint("助手已打开。输入助手窗口的 8 位连接码，即可在这里连接。");
      setTimeout(()=>document.getElementById("capture-code")?.focus(),0);
    }catch(cause){if(current()){setError(message(cause));setConnectionHint("");}}
    finally{if(current()){connectionState.current.busy=false;setBusy(false);connectionDiscovery.current?.refresh();}}
  }
  function connectionFailed(e:unknown) {
    if(e instanceof BridgeError&&e.status===401&&["PAIR_REQUIRED","TOKEN_INVALID"].includes(e.code)){token.current="";setConnected(false);remember(scopeKey("connection"),null);void forgetCaptureConnectionSession(owner);const stale=stored<StoredCaptureJob>(scopeKey("job"));if(stale?.jobId){clearStoredJob(stale.jobId);setJobPhase("missing");setJobMessage("本机助手连接已失效，已保存的聊天不会删除。重新连接后可继续导入。");setJobId("");setProgress(0);}}
    setError(message(e));
  }
  async function connect(oneTimeHandoff?:string) {
    if (!owner) return;
    discoveryPaused.current=false;remember(scopeKey("auto-connect-paused"),null);
    const ticket = generation.current,attempt=++connectionAttempt.current,current=()=>ticket===generation.current&&attempt===connectionAttempt.current&&!discoveryPaused.current;connectionState.current.busy=true; setBusy(true); setError("");
    try {
      const status = await bridgeRequest<BridgeHealth>("/health");
      if (!current()) return; setHealth(status);
      const pair = await bridgeRequest<{token:string;expiresIn:number}>(oneTimeHandoff?"/pair/handoff":"/pair", { body: oneTimeHandoff?{handoff:oneTimeHandoff}:{ code: code.trim() } });
      if (!current()) return;
      // Pairing creates a fresh helper session and discards its previous jobs.
      // Remove the browser's old job checkpoint at the same point.
      const stale = stored<StoredCaptureJob>(scopeKey("job"));
      if (stale?.jobId) { clearStoredJob(stale.jobId); setJobPhase("missing"); setJobMessage("已建立新的助手连接，旧任务已清理；已保存的聊天不会删除。"); setJobId(""); setProgress(0); }
      const verified={token:pair.token,expiresAt:Date.now()+Math.min(pair.expiresIn||28800,28800)*1000};
      await saveCaptureConnectionSession(owner,verified,current);
      if(!current())return;
      token.current = pair.token; remember(scopeKey("connection"), {...verified,revision:captureConnectionRevision()}); setConnected(true); setCode("");setPairExpanded(false);setConnectionHint(""); setNote("已连接本机采集助手。选择好友后开始。");
    } catch (e) { if (current()) { setError(message(e)); setConnected(false); } }
    finally { if (current()) {connectionState.current.busy=false;setBusy(false);} }
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
        let completed:Awaited<ReturnType<typeof accept>>;
        try{completed=await accept(job.result,scope,ticket,false,preserveReading);}catch(cause){remember(`chengzi-capture:${scope}:job`,null);if(ticket===generation.current){setJobId('');setJobPhase('failed');}throw cause;}
        if (ticket === generation.current && completed) {
          added += completed.added; updatedVoice += completed.updatedVoice;
          setStats({added, updatedVoice, total:completed.total, repeated:Math.max(0,job.result.records.length-added)});
          if (job.result.coverage?.scope === "all-visible" && !job.result.coverage.complete) setNote(`已保存 ${completed.total} 条朋友圈，本次未扫到可见末尾。可重新采集，已有内容会去重。`);
          else if (added || updatedVoice) setNote(`导入完成${added ? `，新增 ${added} 条材料` : ""}${updatedVoice ? `，补全 ${updatedVoice} 条语音文字` : ""}。核对原文后即可分析。`);
        }
        remember(`chengzi-capture:${scope}:job`, null); if (ticket === generation.current) { setJobPhase("idle"); setJobMessage(""); setJobId(""); } return completed?.library;
      }
      if (["error", "failed", "cancelled"].includes(job.status)) {
        remember(`chengzi-capture:${scope}:job`, null); setJobPhase("failed"); setJobMessage(typeof job.error === "string" ? job.error : job.error?.message || (job.status === "cancelled" ? "采集已停止，可重新选择范围。" : "这次采集未完成，请查看助手提示。")); setJobId("");
        throw Error(typeof job.error === "string" ? job.error : job.error?.message || (job.status === "cancelled" ? "采集已停止，可重新选择范围。" : "这次采集未完成，请查看助手提示。"));
      }
      await wait(1400, controller.signal);
    }
    throw Error("采集等待超时，已保存材料仍在。请检查助手后继续这项任务。");
  }
  async function capture(resume = false, includeVoice = false, enrichExisting = includeVoice, forceFull = false, requestedKind?:CaptureKind):Promise<CaptureLibrary|undefined> {
    if (!owner || !connected || receipt) return;
    const previousJob=stored<StoredCaptureJob>(scopeKey("job"));
    if(resume&&previousJob?.voiceHistory){includeVoice=true;enrichExisting=true;}
    if (enrichExisting && library && library.kind !== "chat") return;
    const targetKind = enrichExisting ? "chat" : requestedKind || (resume ? previousJob?.kind : undefined) || kind;
    const captureAllMoments=personImporting.current || allVisibleMoments;
    if (!friend.trim()) { setError(targetKind === "chat" || targetKind === "moments" ? "先输入好友备注或昵称，再从搜索结果中选一位。" : "先填写要采集的好友备注或昵称。"); return; }
    if ((targetKind === "chat" || targetKind === "moments") && (!selectedContact || enrichExisting && library && selectedContact.label !== library.friend)) { setError("先从下方搜索结果中选中要导入的微信联系人；同名好友要选对那一位。"); return; }
    const ticket = generation.current, scope = owner; if(!enrichExisting)revealReportAfterImport.current=targetKind!=='moments'; setBusy(true); setVoiceEnriching(enrichExisting); setError(""); setProgress(0); setJobPhase("checking"); setJobMessage("正在确认选中的微信联系人并准备导入…"); setNote(targetKind === "chat" ? "正在确认选中的微信联系人并准备导入…" : "正在连接本机助手并准备采集朋友圈…");
    if(targetKind==='moments'){setShowImportControls(true);setKind('moments');if(!resume)updateMomentsAttempt({jobId:'',startedAt:Date.now(),entryKey:momentsEntryKey(new URLSearchParams(window.location.search)),friend:selectedContact!.label,contactId:selectedContact!.contactId,accountKey:selectedContact!.accountKey,allVisible:captureAllMoments,status:'running',received:0,added:0,repeated:0,total:library?.kind==='moments'?library.records.length:0,detail:'正在准备本次朋友圈采集。'});}
    try {
      if(targetKind==="moments"&&personIntent&&previousJob?.kind!=="moments"){
        const storedPlan=stored<PersonImportPlan>(scopeKey("person-plan")),pending=storedPlan?.entryKey===momentsEntryKey(new URLSearchParams(window.location.search))?storedPlan:null;
        if(pending?.chatId&&pending.contactId&&(pending.contactId!==selectedContact!.contactId||pending.accountKey!==selectedContact!.accountKey))throw Error("这次补充需要原聊天中的同一位微信好友，请切回原微信账号后再试。");
        if(pending?.chatId&&!pending.contactId)remember(scopeKey("person-plan"),{...pending,contactId:selectedContact!.contactId,accountKey:selectedContact!.accountKey,friend:selectedContact!.label});
      }
      if(!personImporting.current&&!enrichExisting)await ensureImportSubject(selectedContact);
      if(ticket!==generation.current)return;
      const targetFriend = enrichExisting ? library?.friend || selectedContact!.label : targetKind === "chat" || targetKind === "moments" ? selectedContact!.label : friend.trim();
      const pendingJob=stored<{history?:boolean}>(scopeKey("job"));
      const status = await bridgeRequest<BridgeHealth>("/health");
      if(ticket!==generation.current)return;
      setHealth(status);
      // Text and voice have separate checkpoints. Voice revisits every page;
      // cached transcripts are reused, without replacing the fast text cursor.
      if(targetKind==="chat" && status.capabilities.backgroundHistory && status.capabilities.backgroundChat && (!resume || pendingJob?.history)){
        if(enrichExisting&&!status.capabilities.backgroundVoice)throw Error("助手暂不能后台转写语音，已保存的文字仍可分析。");
        const progressOwner=enrichExisting?`${scope}:voice`:scope;
        abort.current?.abort();const controller=new AbortController();abort.current=controller;
        let saved=readHistoryProgress(progressOwner,targetFriend);
        if(saved?.account && saved.pages>0 && !await getCaptureLibrary(scope,captureLibraryId({ownerId:scope,kind:"chat",friend:targetFriend,account:saved.account}))){
          if(saved.pendingJob){try{await bridgeRequest(`/jobs/${saved.pendingJob}/cancel`,{token:token.current,body:{}});}catch(e){if(!(e instanceof BridgeError&&e.status===404))throw e;}}
          clearHistoryProgress(progressOwner,targetFriend);saved=null;
        }
        const plan=newHistoryProgress(progressOwner,targetFriend,saved,{forceFull:forceFull || enrichExisting && saved?.complete===true});
        if(enrichExisting&&library)plan.account=library.account;
        const credential=token.current;
        setHistoryRunning(true);if(!enrichExisting)setHistoryState(plan);
        try{localStorage.setItem(`chengzi-capture:${scope}:last-friend`,friend.trim());}catch{}
        setNote(enrichExisting?"正在分批补齐全部历史中的语音，可以继续使用电脑。":plan.since?"正在检查新增聊天，已导入的内容会保留。":"正在快速导入全部历史文字，语音稍后在后台自动补齐。可以继续使用电脑。");
        // Never make the complete-history pass wait for local audio loading or
        // ASR model startup.  The saved library is enriched automatically
        // after this pass through capture(..., true, true).
        const result=await runHistoryImport({progress:plan,contact:{contactId:selectedContact!.contactId,accountKey:selectedContact!.accountKey},includeVoice:enrichExisting,signal:controller.signal,
          request:(path,options)=>bridgeRequest(path,{...options,token:credential}),
          accept:async(batch)=>{if(ticket!==generation.current)throw new DOMException("Aborted","AbortError");const value=await accept(batch,scope,ticket,true,true);if(!value||ticket!==generation.current)throw new DOMException("Aborted","AbortError");return{added:value.added,updatedVoice:value.updatedVoice,total:value.total,libraryId:value.library.id};},
          onJob:id=>{if(ticket!==generation.current)return;setJobId(id||"");setJobPhase(id?"running":"idle");setJobMessage(id?enrichExisting?"正在后台补全历史语音，已保存的内容可继续查看。":"正在读取历史聊天，已保存的内容可继续查看。":"");if(id){const previous=stored<StoredCaptureJob>(`chengzi-capture:${scope}:job`);remember(`chengzi-capture:${scope}:job`,{jobId:id,history:true,voiceHistory:enrichExisting,friend:targetFriend,contactId:selectedContact!.contactId,accountKey:selectedContact!.accountKey,includeVoice:enrichExisting,startedAt:previous?.jobId===id&&previous.startedAt||Date.now()});}else remember(`chengzi-capture:${scope}:job`,null);},
          onProgress:update=>{if(ticket!==generation.current)return;if(!enrichExisting)setHistoryState(readHistoryProgress(scope,targetFriend));setNote(`${enrichExisting?"正在补全历史语音 · ":""}${update.message}${update.updatedVoice?` 已补全 ${update.updatedVoice} 条语音。`:""}`);}
        });
        if(ticket!==generation.current)return;
        if(!enrichExisting && result.added>0 && currentLibrary.current?.id===result.libraryId)selectPending(currentLibrary.current);
        if(!enrichExisting)setHistoryState(result.progress);setStats({added:result.added,updatedVoice:result.updatedVoice,total:result.total,repeated:Math.max(0,result.progress.count-result.added)});
        setNote(enrichExisting?`历史语音已核对，本次补全 ${result.updatedVoice} 条。未下载或转写失败的语音可在导入情况里查看。`:`${plan.since?"新增聊天已检查完":"这位好友在本机可读取的全部聊天已导入"}，资料库共 ${result.total} 条。本次新增 ${result.added} 条。${status.capabilities.backgroundVoice === true ? "语音正在后台补全，完成后会自动更新。" : "语音可在助手支持后补全。"}`);
        await refreshLibraries(scope,ticket);
        if (!enrichExisting && status.capabilities.backgroundVoice === true && result.total > 0) setAutoVoicePending(true);
        return await getCaptureLibrary(scope,result.libraryId) || undefined;
      }
      if(targetKind==="chat"&&!enrichExisting&&!resume)throw Error("请下载安装最新版 Windows 助手。安装完成后会自动打开网页并连接，再试一次即可完整导入这个人的聊天。");
      let background = false, readLimit = limit;
      if (targetKind === "moments" && captureAllMoments && !status.capabilities.momentsAllVisible) throw Error("完整朋友圈采集需要新版助手，请先安装最新版。已保存的聊天会保留。");
      if (!resume) {
        background = targetKind === "chat" && status.capabilities.backgroundChat === true;
        // A new background import includes audio automatically. Older helpers
        // keep the fast text-only UI path instead of starting foreground voice work.
        if (!enrichExisting) includeVoice = background && status.capabilities.backgroundVoice === true;
        const maxRows = targetKind === "moments" ? (status.momentsMaxRows && status.momentsMaxRows > 50 ? status.momentsMaxRows : 50) : background && status.backgroundMaxRows === 1000 ? 1000 : 500;
        // Enrichment is an automatic pass over the saved contact, so it must
        // use the helper's full bounded background window rather than the
        // visible UI default (40).  The vault deduplicates the text rows and
        // upgrades only matching voice placeholders.
        readLimit = targetKind === "moments" && captureAllMoments ? maxRows : enrichExisting && targetKind === "chat" ? maxRows : limit;
        if (readLimit > maxRows) throw Error(`当前助手本次最多读取 ${maxRows} 条，请缩小范围或更新助手。`);
        const databaseVoice = enrichExisting && library!.records.some(row=>row.source.method === "wechat-local-db");
        if (databaseVoice && (!background || !status.capabilities.backgroundVoice)) throw Error(status.backgroundMessage || "当前助手暂不能后台补全这份语音。已保存的聊天和转写仍可查看。");
        if (background && includeVoice && !status.capabilities.backgroundVoice) throw Error(status.backgroundMessage || "当前助手暂不支持后台语音转写，已保存的材料仍可查看。");
        if (!background && !status.capabilities.uiCapturePreparation && (!status.ready || targetKind==='moments'&&status.capabilities.moments===false)) throw Error(targetKind==='moments'?(status.momentsMessage||status.uiMessage||(!status.ready&&status.backgroundStatus!=='components-ready'?status.message:'')||'当前助手无法读取微信朋友圈界面。请先更新助手并打开所选好友的朋友圈后重试，或改用朋友圈截图分析。'):(status.uiMessage||status.message||"当前微信界面暂不可读取。"));
        if (!background && targetKind === "chat" && !status.capabilities.deferredVoice) throw Error("当前助手暂不支持分步导入聊天，可使用窗口采集。");
        setNote(background ? includeVoice ? enrichExisting ? "正在后台补全语音，可以继续使用电脑。" : "正在读取聊天，文字先显示，语音会在后台转成文字。" : "正在后台读取本机聊天，无需切换微信窗口。" : "正在读取选定好友，请暂时不要切换微信窗口。");
      }
      const id = resume ? jobId : (await bridgeRequest<{jobId:string}>("/capture", { token: token.current, body: { kind:targetKind, friend:targetFriend, contactId:selectedContact!.contactId,accountKey:selectedContact!.accountKey,...(targetKind === "chat" ? {includeVoice} : {allVisible:captureAllMoments}), limit: readLimit, ...(background ? {mode:"background"} : {}) } })).jobId;
      if (ticket !== generation.current) return;
      const preserveReading = resume ? stored<StoredCaptureJob>(scopeKey("job"))?.includeVoice === true : includeVoice;
      if(targetKind==='moments'){const attempt=stored<MomentsAttempt>(scopeKey('moments-attempt'));if(attempt)updateMomentsAttempt({...attempt,jobId:id,status:'running'});}
      setJobId(id); setJobPhase("running"); setJobMessage("正在处理导入，完成的内容会陆续保存。"); const previous=stored<StoredCaptureJob>(scopeKey("job")); remember(scopeKey("job"), { jobId: id,kind:targetKind,friend:targetFriend,contactId:selectedContact!.contactId,accountKey:selectedContact!.accountKey, includeVoice: preserveReading, startedAt: previous?.jobId===id&&previous.startedAt||Date.now() });
      const completed=await poll(id, ticket, scope, preserveReading);
      if(targetKind!=='moments')await restoreCompletedPersonPair(completed,selectedContact,scope,ticket);
      return completed;
    } catch (e) {
      if (ticket === generation.current) {
        if(targetKind==='moments'){const attempt=stored<MomentsAttempt>(scopeKey('moments-attempt'));if(attempt)updateMomentsAttempt({...attempt,status:'failed',detail:message(e)});setShowImportControls(true);revealReportAfterImport.current=false;setKind('moments');}
        setHistoryState(targetKind === "chat" && selectedContact ? readHistoryProgress(scope,selectedContact.label) : null);
        if(e instanceof CapturePairSourceError){remember(`chengzi-capture:${scope}:job`,null);setJobId("");setJobPhase("failed");setProgress(0);setJobMessage(message(e));setError(message(e));setShowImportControls(true);setNote("");}
        else if (e instanceof Error && e.name === "AbortError") {
          setJobPhase("idle"); setJobMessage("");
          setNote("已暂停导入，已保存的聊天和读取位置会保留。下次点击继续即可。");
        } else {
          const pending=stored<StoredCaptureJob>(`chengzi-capture:${scope}:job`);
          setJobPhase(pending?.jobId ? "running" : "failed");
          setJobMessage(pending?.jobId ? "与助手的进度连接中断了。任务编号已保留，点击继续导入重新连接；已保存内容不会丢失。" : message(e));
          setNote("");
          connectionFailed(e);
        }
      }
    }
    finally { if (ticket === generation.current) {setBusy(false);setHistoryRunning(false);setVoiceEnriching(false);} }
  }
  async function cancel() {
    personStopped.current=true;
    if (!jobId) return;
    if(historyRunning){setNote("正在暂停，已保存的聊天会保留…");abort.current?.abort();return;}
    const ticket = generation.current, key = scopeKey("job"), controller = abort.current;
    try {
      const stopped = await bridgeRequest<Job>(`/jobs/${jobId}/cancel`, { token: token.current, body: {} });
      controller?.abort();
      if (stopped.partial) await accept(stopped.partial, owner, ticket, true);
      remember(key, null); if (ticket !== generation.current) return;
      const attempt=stored<MomentsAttempt>(scopeKey('moments-attempt'));if(attempt?.jobId===jobId){updateMomentsAttempt({...attempt,status:'failed',detail:'本次采集已停止。已读到的动态保留在资料库，可以重试。'});setShowImportControls(true);revealReportAfterImport.current=false;}
      setBusy(false); setJobPhase("failed"); setJobMessage(stopped.partial ? "已停止，已读到的聊天保存在本机。" : "采集已停止，已保存的聊天不会删除。"); setJobId(""); setNote(stopped.partial ? "已停止，已读到的聊天保存在本机。" : "采集已停止，已保存的聊天不会删除。");
    } catch (e) { if (ticket === generation.current) setError(message(e)); }
  }
  async function importPerson() {
    if(locked||personImporting.current||!owner||!selectedContact||!connected)return;
    if(!health?.capabilities.personBundle){setError("一键导入聊天和朋友圈需要 1.2.6 或更新的助手。请使用上方下载入口更新后重试。");return;}
    const ticket=generation.current;
    let chosenSubject="";
    personImporting.current=true;personStopped.current=false;setPersonIntent(true);setPersonImport("chat");setShowImportControls(true);setRelatedMoments([]);setAutoVoicePending(false);
    let chat:CaptureLibrary|undefined,awaitingMoments=false;
    try {
      chosenSubject=await ensureImportSubject(selectedContact);
      if(ticket!==generation.current||personStopped.current)return;
      remember(scopeKey("person-plan"),{chatId:null,subjectId:chosenSubject,contactId:selectedContact.contactId,accountKey:selectedContact.accountKey,friend:selectedContact.label});
      chat=await capture(false,false,false,false,"chat");
      if(!chat||personStopped.current||ticket!==generation.current)return;
      remember(scopeKey("person-plan"),{chatId:chat.id,subjectId:chosenSubject,contactId:selectedContact.contactId,accountKey:selectedContact.accountKey,friend:selectedContact.label,entryKey:enterMomentsStep(chat.id,chosenSubject)});
      awaitingMoments=true;setSupplementMoments(true);setKind('moments');setPersonImport("moments");setNote("聊天已保存，接下来采集这位好友的全部可见朋友圈。请保持微信在前台。");
      const moments=await capture(false,false,false,false,"moments");
      if(ticket!==generation.current)return;
      if(moments&&(moments.account!==chat.account||moments.friend!==chat.friend))setError("聊天和朋友圈的微信账号或联系人不一致，已分别保存，未合并分析。");
    } catch(e){if(ticket===generation.current)setError(message(e));} finally {
      if(ticket===generation.current){
        if(chat&&!awaitingMoments){setLibrary(chat);currentLibrary.current=chat;setKind("chat");setStats(null);setSubject(chosenSubject);selectPending(chat);setShowImportControls(false);}
        if(awaitingMoments){setKind('moments');setShowImportControls(true);revealReportAfterImport.current=false;}
        personImporting.current=false;setPersonImport("idle");
        if(chat&&!awaitingMoments&&!personStopped.current&&health?.capabilities.backgroundVoice)setAutoVoicePending(true);
      }
    }
  }
  function enterMomentsStep(chatId:string,person:string){
    const url=new URL(window.location.href),wasSupplement=url.searchParams.get('intent')==='supplement-moments';
    url.searchParams.set('kind','moments');url.searchParams.set('method','desktop');url.searchParams.set('intent','supplement-moments');url.searchParams.set('subjectId',person);
    if(!wasSupplement||!url.searchParams.get('libraryId'))url.searchParams.set('libraryId',chatId);
    url.searchParams.set('question',diagnosticQuestion);if(returnTo)url.searchParams.set('returnTo',returnTo);
    openedDeepLink.current=`${owner}:${url.searchParams.get('libraryId')||''}`;
    window.history.replaceState(null,'',url);return momentsEntryKey(url.searchParams);
  }
  async function prepareMomentsImport(targetChat?:CaptureLibrary,personHint=""){
    const chat=targetChat||library;
    if(!chat||chat.kind!=="chat"||!targetChat&&locked||receipt)return;
    const ticket=generation.current;
    try{
      const person=(account.people.some(value=>value.id===personHint)?personHint:"")||(!targetChat?subject:"")||await ensureImportSubject(null,chat), contact=await contactFromCaptureLibrary(chat);
      if(ticket!==generation.current)return;
      remember(scopeKey("person-plan"),{chatId:chat.id,subjectId:person,contactId:contact?.contactId||"",accountKey:contact?.accountKey||"",friend:contact?.label||chat.friend,entryKey:enterMomentsStep(chat.id,person)});
      requestedSubject.current=person;setLibrary(chat);currentLibrary.current=chat;setSubject(person);setPersonIntent(true);setSupplementMoments(true);setMethod("desktop");setKind("moments");setAllVisibleMoments(true);setFriend(contactDisplayName(chat.friend));setSelectedContact(contact);setShowImportControls(true);setShowAnalysis(false);setMaterialView("none");setAutoVoicePending(false);setError("");setJobPhase("idle");setJobMessage("");
      setNote("聊天已保留。接下来补充这位好友的全部可见朋友圈。");
      requestAnimationFrame(()=>document.querySelector('[aria-label="导入操作"]')?.scrollIntoView({block:"start",behavior:"smooth"}));
    }catch(cause){if(ticket===generation.current)setError(message(cause));}
  }
  async function verifiedPersonPairChat(completed:CaptureLibrary|undefined,identity:Partial<Pick<CaptureContact,"contactId"|"accountKey">>|null|undefined,scope:string,ticket:number){
    const storedPlan=stored<PersonImportPlan>(`chengzi-capture:${scope}:person-plan`),plan=storedPlan?.entryKey===momentsEntryKey(new URLSearchParams(window.location.search))?storedPlan:null;
    if(completed?.kind!=="moments"||!plan?.chatId)return;
    if(!identity?.contactId||!identity.accountKey||plan.contactId!==identity.contactId||plan.accountKey!==identity.accountKey)throw new CapturePairSourceError("朋友圈原文已保存在本机，但原联系人身份与这次任务不同。请核对同一微信账号和好友后重新关联，暂未绑定人物或合并报告。");
    const chat=await getCaptureLibrary(scope,plan.chatId);
    if(ticket!==generation.current)return;
    if(!chat||chat.kind!=="chat")throw new CapturePairSourceError("朋友圈原文已保存在本机，但原聊天资料暂时无法打开。请从原报告重新打开资料后再合并，暂未绑定人物。");
    let original:CaptureContact|null,completedContact:CaptureContact|null;
    try{original=await contactFromCaptureLibrary(chat);completedContact=await contactFromCaptureLibrary(completed);}catch(cause){throw new CapturePairSourceError(message(cause)+" 原文保存在本机，暂未绑定人物或合并报告。");}
    if(ticket!==generation.current)return;
    const namespace=(name:string)=>name.match(/ · #([a-fA-F0-9]{16})$/)?.[1].toLowerCase();
    const sameContact=completedContact?completedContact.contactId===identity.contactId&&completedContact.accountKey===identity.accountKey:!!namespace(chat.friend)&&namespace(chat.friend)===namespace(completed.friend)||chat.friend===completed.friend;
    if(!sameContact)throw new CapturePairSourceError("朋友圈原文已保存在本机，但返回的好友与原聊天不是同一位。请核对助手中的好友后重新导入，暂未绑定人物或合并报告。");
    if(chat.ownerId!==scope||completed.ownerId!==scope||chat.account!==completed.account||original&&(original.contactId!==identity.contactId||original.accountKey!==identity.accountKey)||chat.cloud?.subjectId&&chat.cloud.subjectId!==plan.subjectId||completed.cloud?.subjectId&&completed.cloud.subjectId!==plan.subjectId)throw new CapturePairSourceError("朋友圈原文已保存在本机，但聊天与朋友圈的账号或人物不一致。请核对来源后重新关联，暂未绑定人物或合并报告。");
    return {chat,plan};
  }
  async function restoreCompletedPersonPair(completed:CaptureLibrary|undefined,identity:Partial<Pick<CaptureContact,"contactId"|"accountKey">>|null|undefined,scope:string,ticket:number){
    if(personImporting.current)return;
    const attempt=stored<MomentsAttempt>(`chengzi-capture:${scope}:moments-attempt`);
    if(attempt?.status!=='complete'||attempt.received<=0||attempt.libraryId!==completed?.id)return;
    const verified=await verifiedPersonPairChat(completed,identity,scope,ticket);
    if(!verified||!completed||ticket!==generation.current)return;
    const {chat,plan}=verified;
    rememberCaptureSubject(scope,completed.id,plan.subjectId);
    savePersonPair(chat,completed,plan.subjectId);
    setLibrary(chat);currentLibrary.current=chat;setKind("chat");setRelatedMoments([completed]);setStats(null);setShowImportControls(false);setSubject(plan.subjectId);selectPending(chat);
    return true;
  }
  async function confirmMomentsResult(){
    const attempt=stored<MomentsAttempt>(scopeKey('moments-attempt')),ticket=generation.current;
    if(!attempt||attempt.status!=='complete'||!attempt.received||!attempt.libraryId||locked)return;
    setBusy(true);setError('');
    try{const completed=await getCaptureLibrary(owner,attempt.libraryId);if(!completed||completed.kind!=='moments')throw Error('本次保存的朋友圈暂时无法打开，请重试。');
      const restored=await restoreCompletedPersonPair(completed,attempt,owner,ticket);if(ticket!==generation.current)return;
      if(!restored){if(supplementMoments)throw Error('原聊天的关联信息暂不可用。朋友圈已经保存，请从原报告重新打开补充入口。');setLibrary(completed);currentLibrary.current=completed;setKind('moments');selectPending(completed);setShowImportControls(false);}
      updateMomentsAttempt(null);setNote('本次采集结果已确认。下一步确认材料与费用后生成报告。');
    }catch(cause){setError(message(cause));setShowImportControls(true);}finally{if(ticket===generation.current)setBusy(false);}
  }
  function savePersonPair(chat:CaptureLibrary,moments:CaptureLibrary,person=subject){
    const key=`chengzi-capture:${owner}:person:${chat.id}`,pair={chatId:chat.id,momentsId:moments.id};
    remember(key,pair);try{localStorage.setItem(key,JSON.stringify(pair));}catch{}
    remember(scopeKey("person-plan"),null);
    setSupplementMoments(false);
    if(new URLSearchParams(window.location.search).get("intent")==="supplement-moments")window.history.replaceState(null,"",intakeHref('/capture',{method:'library',kind:'chat',libraryId:chat.id,subjectId:person,returnTo})+'&question='+diagnosticQuestion);
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
      const allowed=account.people.map(person=>String(person.id));setSubject((allowed.includes(requestedSubject.current)?requestedSubject.current:"")||captureIntakeSubject(owner,id,allowed)||(allowed.includes(value.cloud?.subjectId||"")?value.cloud!.subjectId!:""));
      if(!account.loading)requestedSubject.current="";
      selectPending(value);if(value.kind === "chat" && !value.records.some(visualSource))setRecordPage(0);setReceipt(null);setConsent(false);setStats(null);setReportId("");setQuery("");
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
          window.location.assign(intakeHref('/analyze',{mode:kind,subjectId:result.subjectId,returnTo,capture:true})+focusQuery());
        } else {
          setNote("本次选中的画面都已分析过，可在下方打开已有报告；补充新内容请改选其他时间段。");
          requestAnimationFrame(() => { if (ticket === generation.current) document.getElementById("capture-preview")?.scrollIntoView({ block: "start", behavior: "smooth" }); });
        }
      }
    } finally { if (ticket === generation.current) setBusy(false); }
  }
  async function openAnalysis() {
    const ticket=generation.current;
    setError("");
    setAutoVoicePending(false);
    if (busy && jobId) await cancel();
    if(library&&!isWindow&&!subject&&!receipt){try{await ensureImportSubject(null,library);}catch(e){if(ticket===generation.current)setError(message(e));return;}}
    if(ticket!==generation.current)return;
    setMaterialView("none");
    setShowAnalysis(true);
    requestAnimationFrame(() => document.getElementById("capture-confirm")?.scrollIntoView({block:"nearest",behavior:"smooth"}));
  }
  async function analyze() {
    if (!owner || !library || locked || account.loading) return;
    const fullReport = receipt?.analysisScope === "fullHistory" || !isWindow;
    if (!fullReport && !chosen.length) return;
    if (!fullReport) { const issue=selectionIssue(library,chosen);if(issue){setError(issue);return;} }
    if (isWindow) {
      if (chosen.length > 9) { setError("每次最多分析 9 张采集画面，请减少勾选。"); return; }
      remember(scopeKey("handoff"), { libraryId: library.id, sourceIds: chosen.map(r => r.localId), subjectId:subject, returnTo });
      window.location.assign(intakeHref('/analyze',{mode:library.kind,subjectId:subject,returnTo,capture:true})+focusQuery()); return;
    }
    if (!consent && !receipt) { setError("请先确认本次材料与千问分析处理。"); return; }
    if (!hasPrice(account.account, costKey)) { setError("尚未读取分析价格，请刷新账户后重试。"); return; }
    let reportSubject=subject;
    if(!reportSubject&&!receipt){try{reportSubject=await ensureImportSubject(null,library);}catch(e){setError(message(e));return;}}
    const scope = owner, ticket = generation.current;
    let reportLibrary = library;
    let relatedSnapshots:RelatedSnapshot[]=[];
    if (fullReport && !receipt) {
      if (!reportReady) { setError(library.kind === "moments" ? "这份朋友圈还没有可读取的文字或图片，请先完成导入。" : "这份聊天还没有可读的文字或语音转写，请先完成导入。"); return; }
      setCloudBusy(true); setCloudError(""); setCloudNote("正在同步全部材料，完成后再生成完整报告…");
      try {
        reportLibrary = await syncCaptureLibrary(scope, library, { subjectId: reportSubject, onProgress: (done,total,phase) => {
          if (ticket === generation.current) setCloudNote(phase === "records" ? `正在同步${library.kind === "moments" ? "朋友圈" : "聊天"} ${done} / ${total} 条…` : phase === "images" ? `正在同步图片 ${done} / ${total} 张…` : "正在核对报告依据…");
        } });
        if (ticket !== generation.current) return;
        if (!reportLibrary.cloud?.enabled || reportLibrary.cloud.offline || reportLibrary.cloud.retired || reportLibrary.cloud.total !== reportLibrary.records.length) throw Error("全部材料尚未同步完成，请稍后重试。已导入的原文仍保存在本机。");
        relatedSnapshots=reportLibrary.kind==="chat" ? await syncRelatedMoments(scope,reportSubject,reportLibrary) : [];
        if(ticket!==generation.current)return;
        setLibrary(reportLibrary);
      } catch (cause) { if (ticket === generation.current) { setCloudError(message(cause)); setCloudNote(""); } return; }
      finally { if (ticket === generation.current) { setCloudBusy(false); setCloudNote(""); } }
    }
    const current: Receipt = receipt || { requestId: crypto.randomUUID(), libraryId: reportLibrary.id, sourceIds: fullReport ? [] : chosen.map(r => r.localId), ...(!fullReport ? { historyIds: memoryRows.map(r => r.localId) } : { analysisScope:"fullHistory" as const, cloudId:reportLibrary.cloud!.id, expectedTotal:reportLibrary.records.length, expectedEpoch:reportLibrary.cloud!.epoch,relatedSnapshots }), subjectId: reportSubject, kind: reportLibrary.kind, question: diagnosticQuestion, returnTo };
    const rows = current.sourceIds.map(id => library.records.find(r => r.localId === id)).filter((r): r is StoredCaptureRecord => !!r);
    // Older in-progress receipts did not have historyIds; resume them with
    // all currently readable history instead of silently sending none.
    const historyIds = new Set(current.historyIds?.length ? current.historyIds : memoryRows.map(row => row.localId));
    const payload = current.analysisScope === "fullHistory"
      ? { requestId:current.requestId, confirmed:true, analysisScope:"fullHistory" as const, kind:current.kind, friend:reportLibrary.friend, subjectId:current.subjectId || null, question:current.question || diagnosticQuestion, libraryId:current.cloudId, expectedTotal:current.expectedTotal, expectedEpoch:current.expectedEpoch, records:[],relatedSnapshots:current.relatedSnapshots || [] }
      : { requestId: current.requestId, confirmed: true, kind: current.kind, friend: library.friend, subjectId: current.subjectId || null, ...(current.kind === "chat" ? { question: current.question || diagnosticQuestion, historyRecords: memoryRows.filter(row => historyIds.has(row.localId)), activityRecords: prepareChatActivityUpload(library.records, {account: library.account}).activityRecords } : {}), records: rows.map(r => ({ localId: r.localId, kind: r.kind, sender: r.sender, senderRole: r.senderRole, at: r.at, text: r.text, ocrTextVerified: r.ocrTextVerified === true, images: library.kind === "moments" ? r.images || [] : [] })) };
    if (!receipt && !fullReport) { try { captureAnalysisInput(payload); } catch(e) { setError(message(e)); return; } }
    remember(scopeKey("analysis"), current); setReceipt(current); setAnalyzing(true); setError(""); setNote(current.analysisScope === "fullHistory" ? "已同步全部已导入材料。正在建立后台任务，完成后会自动保存报告。" : "正在分析选中的材料，请保持本页打开。原文已保留，连接中断后可继续原请求。");
    rememberCaptureSubject(scope, library.id, current.subjectId);
    rememberIntakePreference(scope, library.kind, {subjectId:current.subjectId});
    try {
      const currentAccount = await api("/api/account/credits");
      if (currentAccount.account?.userId !== scope || ticket !== generation.current) throw Error("账户已变化，请返回原账号继续。");
       if (!receipt) await api("/api/web/settings", { consent: true, allowImageProcessing: true, selfSide: "right" });
      if (ticket !== generation.current) return;
      let restored: Json | null = null;
      if (receipt) { try { const saved = await api("/api/web/report?id=" + encodeURIComponent(current.requestId)); restored = { ...saved.report, reportId: saved.reportId }; } catch(e) { if (!(e instanceof WebError && e.status === 404)) throw e; } }
      const response = restored || await api("/api/web/capture/analyze", payload);
      if (current.analysisScope === "fullHistory" && response.taskId && response.status !== "done") {
        if (ticket !== generation.current) return;
        window.dispatchEvent(new Event("chengzi:capture-analysis"));
        remember(scopeKey("analysis"), null); setReceipt(null); setConsent(false); setShowAnalysis(false);
        setNote(response.active && response.sameMaterials===false ? "已有一份报告正在生成，请先查看后台进度。" : "已开始后台分析，可以离开此页。报告完成后会出现在这里和人物页。");
        void account.refresh(); return;
      }
      const result = response.result || response;
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
      setNote("报告已保存，正在打开…");
      window.dispatchEvent(new Event("chengzi:capture-analysis"));
      if (result.reportId) window.location.assign(`/report?id=${encodeURIComponent(result.reportId)}${focusQuery()}`);
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
  const helperNeedsUpdate = !!health?.version && new Intl.Collator("en",{numeric:true}).compare(health.version,"1.2.7") < 0;
  const importLabel = historyState?.complete ? "补充新聊天" : historyState ? "继续导入全部聊天" : "导入这个人的全部聊天";
  const activityNotice=library?.kind==="chat"&&library.records.length>20000 ? prepareChatActivityUpload(library.records,{account:library.account}).notice : "";
  const readableRecordCount = library?.records.filter(row => row.kind === "text" && row.senderRole !== "unknown" && row.text.trim()).length || 0;
  const historyInProgress = !!library && historyState?.friend === library.friend && !historyState.complete;
  const fullReportPath = !!library && !isWindow;
  const relatedMomentCount=relatedMoments.reduce((total,value)=>total+value.records.length,0);
  const fullReportTitle=library?.kind==="moments" ? "生成完整朋友圈报告" : "生成完整关系报告";
  const subjectLabel=account.people.find(person=>person.id===subject)?.label||(importSubject.current?.subjectId===subject?importSubject.current.label:"")||contactDisplayName(library?.friend||selectedContact?.label||"");
  const reportReady = !!fullReportPath && (library?.kind==="moments" ? library.records.some(row=>row.text.trim()||row.images?.length||row.source.cloudMediaPending||row.source.cloudMediaUnavailable) : readableRecordCount > 0);
  const reportWaitReason = account.loading ? "正在读取账户与分析价格…" : cloudBusy ? cloudNote || "正在同步已导入资料…" : relatedLoading ? "正在读取这位好友的朋友圈…" : relatedError ? relatedError : !reportReady && fullReportPath ? library?.kind==="moments" ? "还没有可读的动态文字或图片，请先完成导入。" : "还没有可读文字，请先补全聊天文字或语音转写。" : busy && !jobId ? "正在保存刚读到的材料…" : "";
  const compactImport = (method === "desktop" || method === "library") && !!library && (!jobId || voiceEnriching) && personImport === "idle" && !showImportControls;
  const currentMomentsAttempt=kind==='moments'&&momentsAttempt&&selectedContact?.contactId===momentsAttempt.contactId&&selectedContact.accountKey===momentsAttempt.accountKey?momentsAttempt:null;
  const momentsResultOnly=!!currentMomentsAttempt&&currentMomentsAttempt.status!=='running'&&!jobId;
  const reviewing = showAnalysis || !!receipt;
  const browsingMaterials = materialView !== "none" && !reviewing;
  const showIntake = !compactImport && !reviewing && !browsingMaterials;
  const desktopStep = supplementMoments||currentMomentsAttempt ? !connected?0:!selectedContact?1:2 : !connected && !library ? 0 : !selectedContact && !library ? 1 : !library || historyInProgress || !!jobId ? 2 : 3;
  const showJobStatus = !momentsResultOnly&&(!!jobId || jobPhase === "checking" || jobPhase === "failed" || jobPhase === "missing");
  const jobProgressValue = kind === "moments" && jobPhase === "running" || jobPhase === "checking" || jobPhase === "running" && progress <= 0 ? undefined : Math.min(100, Math.max(0, progress));
  const jobStatusText = subjectBusy ? "正在关联微信好友，接下来读取朋友圈或聊天…" : busy ? note || jobMessage : jobMessage || (jobPhase === "done" ? "导入已完成，点击保存最后一页。" : jobPhase === "running" ? "本机任务仍在运行，已保存的内容可以继续查看。" : "正在核对本机导入任务…");
  const openSyncGuide = () => { if (syncGuide.current) { syncGuide.current.open = true; syncGuide.current.scrollIntoView({block:"center",behavior:"smooth"}); } };
  const kindPicker = <div className={styles.kinds} aria-label="采集内容">{([{key:"chat",label:"聊天记录",Icon:MessageSquare},{key:"moments",label:"朋友圈",Icon:Images}] as const).map(({key,label,Icon}) => <button disabled={locked || !!receipt} aria-pressed={kind === key} key={key} onClick={() => { if(key === kind)return; setKind(key); setLimit(key === "chat" ? 40 : 10); setLibrary(null); setSelected([]); setStats(null); setReportId(""); setConsent(false); setSubject(""); setNote(""); setError(""); }}><Icon size={18}/>{label}</button>)}</div>;
  return <div className={ui.page}><WebNav guideReady={!!owner && !account.loading}/><FirstUseTour owner={owner} page="capture" method={method} ready={!account.loading} auto={method !== "desktop" && !locked && !jobId && !receipt && !library}/><main className={`${ui.wrap} ${styles.page}`}>
    <header className={styles.pageHeader} hidden={compactImport && !reviewing && !browsingMaterials}><div><p>{kind === "moments" ? "朋友圈 · 补充人物线索" : personIntent ? "聊天 · 朋友圈 · 完整关系报告" : "完整聊天 · 关系报告"}</p><h1>{reviewing ? "确认后，开始整理这段关系" : browsingMaterials ? "查看已保存的材料" : compactImport ? "材料已就位，生成你的关系报告" : kind === "moments" ? "导入 TA 的朋友圈" : personIntent ? "导入 TA 的全部资料" : "导入聊天，看清这段关系"}</h1>{!library && <span>看清现状，看见变化，知道下一步。</span>}</div>{returnTo && <a className={ui.secondary} href={returnTo}><History size={17}/>{returnTo.startsWith('/archive')?'返回人物档案':'返回原报告'}</a>}</header>

    <ol id="capture-steps" hidden={compactImport || reviewing || browsingMaterials || needsWindows && method==="desktop" && !connected && (!library || supplementMoments)} className={styles.steps} aria-label="使用步骤">{(method === "desktop" && kind === "chat" ? ["连接助手", "选择联系人", "导入资料", "生成关系报告"] : method === "library" ? ["打开已导入聊天", "查看关系报告"] : method === "video" ? ["选择录屏", "核对画面", "确认后分析"] : ["连接助手", "选择联系人", "采集朋友圈", "生成分析报告"]).map((label, i) => { const active = method === "desktop" ? desktopStep : method === "library" ? library ? 1 : 0 : method === "video" ? library ? 1 : 0 : desktopStep; return <li key={label} data-active={active === i} data-done={active > i}><span>{active > i ? <Check size={18}/> : `0${i + 1}`}</span><strong>{label}</strong></li>; })}</ol>
    <AccountNotice state={account}/><CaptureAnalysisStatus owner={owner} onSettled={()=>void account.refresh()}/>
    {!library && !jobId && !receipt && <a className={styles.returnToReady} href="/relationship">选择已导入的人与材料<ArrowRight size={16}/></a>}
    {receipt && <p className={styles.warning}>有一份分析尚待取回。请继续本次分析，完成后再切换材料；原请求会保留，避免重复处理。</p>}
    {needsWindows && method==="desktop" && !connected && (!library || supplementMoments) && <section className={`${styles.panel} ${styles.windowsHandoff}`}><Monitor size={28}/><h2>完整导入，请在 Windows 电脑继续</h2><p>在电脑打开此页并连接微信助手。手机可以先传截图，或查看已同步的材料。</p><button className={ui.primary} onClick={()=>void copyWindowsHandoff()}>{handoffCopied?"链接已复制":"复制到电脑继续的链接"}</button><a className={ui.secondary} href={intakeHref('/analyze',{mode:kind,subjectId:subject})}>先用截图分析<ArrowRight size={17}/></a><a href="/relationship">查看已保存的人与材料</a></section>}
    <div data-mobile-handoff={needsWindows && method==="desktop" && !connected && (!library || supplementMoments)} className={`${styles.layout} ${method === "video" ? styles.videoLayout : ""}`}>
      <aside className={styles.controls} aria-label="导入操作" hidden={!showIntake}>
        <section className={styles.panel} data-compact={compactImport}>{library && !jobId && personImport === "idle" && <button className={styles.returnToReady} onClick={()=>{setSupplementMoments(false);setShowImportControls(false);}}>返回报告准备<ArrowRight size={16}/></button>}
          <div className={styles.operationHeading}><h2><Monitor size={22}/>{compactImport ? "材料已保存" : method === "desktop" ? !connected ? "第一步 · 连接电脑助手" : supplementMoments ? "补充这位好友的朋友圈" : "选择好友，开始导入" : method === "library" ? "选择已导入的材料" : method === "window" ? "采集微信窗口" : "导入手机录屏"}</h2><button className={styles.refreshLibraries} data-tour="capture-method" disabled={locked || !!receipt} aria-expanded={showMethods} onClick={()=>setShowMethods(!showMethods)}>{showMethods ? "收起" : "更换来源"}<ArrowRight size={15}/></button></div>
          {showMethods && <div className={styles.methods}>{([{key:"library",label:"已导入材料",hint:"手机、电脑继续查看",Icon:Cloud},{key:"desktop",label:"电脑微信",hint:"连接助手自动导入",Icon:Plug},{key:"window",label:"微信窗口",hint:"采集当前可见画面",Icon:Monitor},{key:"video",label:"手机录屏",hint:"提取录屏里的内容",Icon:FileVideo}] as const).map(({key,label,hint,Icon})=><button key={key} disabled={locked || !!receipt} aria-pressed={method===key} onClick={()=>chooseMethod(key)}><Icon size={20}/><span>{label}<small>{hint}</small></span></button>)}</div>}
          {compactImport ? <div className={styles.importSummary}><CheckCheck size={21}/><div><strong>{contactDisplayName(library?.friend || "")} · {library?.records.length || 0} 条</strong><span>下方继续查看报告与材料。</span></div><button type="button" disabled={locked || !!receipt} onClick={()=>setShowImportControls(true)}>补充 / 换人</button></div> : <>
          {method === "desktop" && <div className={styles.connect} data-tour="capture-connect">
            {connected ? <div className={styles.connected} role="status"><CheckCheck size={21}/><span><strong>助手已连接</strong></span><button disabled={locked} onClick={() => { connectionAttempt.current++;discoveryPaused.current=true;remember(scopeKey("auto-connect-paused"),true);token.current = ""; setConnected(false); setHealth(null); setNote(""); remember(scopeKey("connection"), null);void forgetCaptureConnectionSession(owner); }}>断开</button></div> : <>
              <p className={styles.connectLead}>{supplementMoments && selectedContact ? `为「${contactDisplayName(selectedContact.label)}」补充朋友圈。连接后继续这一步，已有聊天会保留。` : "助手已在运行，直接连接。首次使用再下载。"}</p>
              <button className={`${ui.primary} ${styles.downloadInstaller}`} disabled={!owner||locked} onClick={()=>void connectOpenedAssistant()}>{busy?<LoaderCircle size={18}/>:<Link2 size={18}/>}连接已打开的助手</button>
              {connectionHint&&<p role="status">{connectionHint}</p>}
              <a className={`${ui.secondary} ${styles.downloadInstaller}`} href="/downloads/ChengziWeChatCollector-Setup-1.2.7.exe" download onClick={()=>{discoveryPaused.current=false;remember(scopeKey("auto-connect-paused"),null);rememberConnectionEntry();connectionDiscovery.current?.refresh();}}><Download size={18}/>下载 Windows 助手</a>
              <small>Windows 10 / 11 · 无需解压、输入命令</small>
              <details className={styles.installHelp}><summary>安装遇到 Windows 提示？</summary><p>安装包尚未完成代码签名，Windows 可能显示“无法识别的应用”。请核对下载地址为 coach.lovetalk.love；无法确认来源时取消安装。</p></details>
              <details className={styles.pair} open={pairExpanded} onToggle={event=>setPairExpanded(event.currentTarget.open)}><summary>使用助手连接码</summary><label htmlFor="capture-code">输入助手窗口的 8 位连接码</label><div><input id="capture-code" inputMode="text" autoCapitalize="characters" autoComplete="off" maxLength={8} value={code} onChange={e => setCode(e.target.value)} placeholder="8 位连接码" disabled={locked}/><button className={ui.secondary} disabled={!owner || locked || !/^[a-f0-9]{8}$/i.test(code.trim())} onClick={() => void connect()}>{busy ? <LoaderCircle size={17}/> : <Link2 size={17}/>}连接</button></div></details>
            </>}
            {connected && helperNeedsUpdate && <div className={styles.connectionWaiting}><strong>更新助手，修复朋友圈采集状态</strong><a className={ui.secondary} href="/downloads/ChengziWeChatCollector-Setup-1.2.7.exe" download><Download size={17}/>下载 1.2.7</a></div>}
          </div>}
          {(method === "window" || method === "desktop" && connected && !selectedContact && !jobId) && <>
            {method === "window" && kindPicker}
            <div className={styles.contactPicker} data-selected={!!selectedContact} data-tour="capture-friend"><label className={styles.field} hidden={method === "desktop" && !!selectedContact}>搜索微信好友<input value={friend} disabled={locked || !!jobId} maxLength={100} onChange={e => {setFriend(e.target.value);setSelectedContact(null);setError("");}} placeholder="输入好友的备注或昵称"/></label>
            {method === "desktop" && friend.trim() && <div className={styles.contactResults} aria-live="polite">{selectedContact && <div className={styles.chosenContactHeading}><strong>已选择的好友</strong><button type="button" disabled={locked} onClick={()=>setSelectedContact(null)}>换一位</button></div>}<p className={contactSearch === "error" ? styles.contactSearchError : styles.contactSearchHint}>{contactSearch === "searching" ? <LoaderCircle className={styles.spin} size={16}/> : <Search size={16}/>} {contactHint}</p>{contactSearch === "ready" && contacts.length > 0 && <div className={styles.contactChoices} role="group" aria-label="选择要导入的微信联系人">{contacts.map(row => <button type="button" key={row.accountKey+row.contactId} aria-pressed={selectedContact?.contactId === row.contactId && selectedContact.accountKey === row.accountKey} disabled={locked} onClick={() => {setSelectedContact(row);setError("");}}><span className={styles.contactAvatar} aria-hidden="true">{contactAvatar(row) ? <img src={contactAvatar(row)} alt="" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.hidden=true;}}/> : <Images size={20}/>}</span><span><strong>{row.remark || row.nickname || contactDisplayName(row.label)}</strong>{row.nickname && row.nickname !== row.remark && <small>昵称：{row.nickname}</small>}<small>{row.wechatId ? `微信号：${row.wechatId}` : "未读取到微信号，请核对备注与头像"}</small></span>{selectedContact?.contactId === row.contactId && selectedContact.accountKey === row.accountKey && <Check size={18}/>}</button>)}</div>}{contacts.length > 1 && <p className={styles.contactSearchHint}>仍分不清？在微信里给好友设置不同的备注，再刷新搜索。</p>}<button type="button" hidden={!!selectedContact} className={styles.refreshLibraries} disabled={locked || contactSearch==="searching"} onClick={()=>setContactRetry(value=>value+1)}><RefreshCw size={14}/>刷新搜索</button></div>}
            </div>
          </>}
          {method === "desktop" && connected && <>
            {selectedContact && <div className={styles.importAction}>
              <strong><CheckCheck size={18}/> {contactDisplayName(selectedContact.label)} · {kind === "chat" ? "全部聊天记录" : allVisibleMoments ? "全部可见朋友圈" : `最近 ${limit} 条朋友圈`}</strong>
              <p>{kind === "chat" ? "文字先导入，语音自动补齐。" : "采集到可见末尾，期间请保持微信在前台。"}</p>{!jobId && !supplementMoments && <button className={styles.refreshLibraries} disabled={locked} onClick={()=>setSelectedContact(null)}>重新选择好友</button>}
              {kind === "moments" && !jobId && <details className={styles.rangeOptions}><summary>调整采集范围</summary><label className={styles.field}>采集范围<select value={allVisibleMoments ? "all" : String(limit)} disabled={locked} onChange={e=>{setAllVisibleMoments(e.target.value === "all");if(e.target.value!=="all")setLimit(Number(e.target.value));}}><option value="all">全部可见朋友圈</option>{[5,10,20,50].map(n=><option key={n} value={n}>最近 {n} 条</option>)}</select></label></details>}
              {error && error!==currentMomentsAttempt?.detail && <p className={styles.importError} role="alert">{error}</p>}
              {currentMomentsAttempt&&<section className={styles.momentsResult} data-moments-result={currentMomentsAttempt.status} aria-live="polite"><h3>{currentMomentsAttempt.status==='running'?'本次正在采集':currentMomentsAttempt.status==='complete'?'本次朋友圈已保存，请确认':currentMomentsAttempt.status==='empty'?'本次没有读到动态':currentMomentsAttempt.status==='partial'?'本次只完成了部分采集':currentMomentsAttempt.status==='stale'?'未收到本次任务的有效结果':'本次采集未完成'}</h3><p role={['failed','stale'].includes(currentMomentsAttempt.status)?'alert':'status'}>{currentMomentsAttempt.detail}</p><dl><div><dt>本次读到</dt><dd>{currentMomentsAttempt.received} 条</dd></div><div><dt>新增保存</dt><dd>{currentMomentsAttempt.added} 条</dd></div><div><dt>已有重复</dt><dd>{currentMomentsAttempt.repeated} 条</dd></div></dl>{currentMomentsAttempt.total>0&&<small>资料库累计 {currentMomentsAttempt.total} 条，不代表本次采集条数。</small>}{currentMomentsAttempt.status==='complete'?<button type="button" className={ui.primary} disabled={locked} onClick={()=>void confirmMomentsResult()}>确认本次结果，继续报告<ArrowRight size={17}/></button>:currentMomentsAttempt.status!=='running'&&<button type="button" className={ui.primary} disabled={locked||!!jobId} onClick={()=>void capture()}><RefreshCw size={17}/>重试本次朋友圈采集</button>}{currentMomentsAttempt.status!=='running'&&currentMomentsAttempt.status!=='complete'&&<><a className={ui.secondary} data-moments-fallback="screenshots" href={intakeHref('/analyze',{mode:'moments',subjectId:subject,returnTo})}>改用朋友圈截图分析<Images size={17}/></a><small>单独分析上传的动态，保留当前人物。不会自动合并进原报告。</small></>}</section>}
              {historyState && kind === "chat" && <small>{historyState.complete ? "上次完整导入已完成，本次检查新增记录。" : `已保存 ${library?.records.length || historyState.count} 条，可中断后继续。`}</small>}
              <p className={styles.readyCaption}>导入即同意保存你有权提供的资料并启用人物档案；按所选微信好友自动关联，默认使用微信头像。</p>
              {kind === "chat" && !jobId && <><button className={`${ui.primary} ${styles.full}`} disabled={locked || !!receipt} onClick={()=>void importPerson()}><Download size={18}/>导入这个人的全部资料</button><small>聊天、语音与全部可见朋友圈 · 朋友圈采集时需保持微信在前台</small></>}<button hidden={!!jobId || !!currentMomentsAttempt && currentMomentsAttempt.status!=="running"} className={`${kind === "chat" ? styles.refreshLibraries : ui.primary} ${styles.full}`} disabled={!owner || locked || !!receipt || !!jobId } onClick={() => void capture()}>{busy || subjectBusy ? <LoaderCircle className={styles.spin} size={18}/> : <Download size={18}/>} {busy || subjectBusy ? jobId ? "正在导入…" : "正在准备导入…" : kind === "chat" ? `只${importLabel}` : allVisibleMoments ? "导入全部可见朋友圈" : "开始采集朋友圈"}</button>
            </div>}
            {kind === "chat" && !jobId && <details ref={syncGuide} className={styles.syncGuide}><summary><Smartphone size={17}/>电脑上的聊天不全？先同步手机记录</summary><p>手机和电脑登录同一微信，连接同一网络。</p><ol><li>手机微信打开「我 → 设置 → 聊天记录管理」。</li><li>选择「导入与导出 → 导出到电脑」。</li><li>选择这位好友，等待传输完成，再回来导入。</li></ol><p>不同微信版本名称可能不同。仅用于恢复的「备份到电脑」不能直接读取。</p><button className={ui.secondary} disabled={!selectedContact || locked || !!receipt || !!jobId} onClick={()=>void capture(false,false,false,true)}>已同步，重新核对全部</button></details>}
            {showJobStatus && <div className={styles.job} data-job-phase={jobPhase}><p role="status">{personImport!=="idle" ? `${personImport==="chat"?"1 / 2 · 聊天":"2 / 2 · 朋友圈"} · ` : ""}{jobStatusText}</p><progress max={100} value={jobProgressValue} aria-label="当前采集进度"/><p className={styles.progressDetail}>{currentMomentsAttempt ? `本次已读到 ${currentMomentsAttempt.received} 条 · 新增 ${currentMomentsAttempt.added} 条` : `已保存 ${library?.records.length || 0} 条`}{idleSeconds >= 90 ? ` · ${Math.floor(idleSeconds / 60)} 分钟没有新进度` : ""}</p>{idleSeconds >= 90 && <p className={styles.warning}>助手暂未返回新进度。可以暂停后继续，或先查看已保存材料。</p>}{!busy && (jobPhase === "done" ? <button className={ui.secondary} onClick={() => void capture(true)} disabled={!connected}>保存已完成内容</button> : jobPhase === "failed" || jobPhase === "missing" ? <button className={ui.secondary} onClick={() => void capture(false)} disabled={!connected}>重试导入</button> : <button className={ui.secondary} onClick={() => void capture(true)} disabled={!connected}>继续导入</button>)}{jobId && <button className={ui.secondary} onClick={() => void cancel()} disabled={analyzing}><Square size={15}/>{historyRunning?"暂停导入":"停止采集"}</button>}{library && <button className={ui.secondary} disabled={analyzing} onClick={async()=>{await cancel();setShowImportControls(false);}}>先查看已保存的 {library.records.length} 条<ArrowRight size={16}/></button>}</div>}
          </>}
          {method === "window" && <label className={styles.field}>当前微信号<input value={wechatAccount} disabled={locked} maxLength={100} onChange={e => setWechatAccount(e.target.value)} placeholder="用于区分本机材料"/></label>}
          {method === "library" && <p className={styles.muted}>打开一份材料，接着生成报告或提问。</p>}
          </>}
        </section>
        {visibleLibraries.length > 0 && !jobId && (method === "library" || !selectedContact) && <details className={`${styles.panel} ${styles.savedLibraries}`} open={method === "library" && !library || undefined}><summary><Cloud size={20}/>已导入的{kind === "moments" ? "朋友圈" : "聊天"}<span>{visibleLibraries.length} 份</span></summary><button className={styles.refreshLibraries} disabled={locked} onClick={()=>void refreshLibraries()}><RefreshCw size={15}/>刷新同步列表</button><div className={styles.libraries}>{visibleLibraries.map(item=><button key={item.id} disabled={locked || !!receipt} aria-pressed={library?.id===item.id} onClick={()=>void openLibrary(item.id)}>{item.kind==="chat"?<MessageSquare size={20}/>:<Images size={20}/>}<span><strong>{contactDisplayName(item.friend)}</strong><small>{item.total} 条 · {item.cloud?.enabled ? "已同步" : "本机保存"}</small></span><ArrowRight size={18}/></button>)}</div></details>}
      </aside>
      <div className={styles.workspace}>
        {error && !(showIntake&&method==="desktop"&&selectedContact) && <p className={styles.error} role="alert">{error}{supplementMoments && <button className={styles.refreshLibraries} disabled={locked} onClick={()=>{openedDeepLink.current="";setError("");void refreshLibraries();}}>重新准备朋友圈</button>}</p>}{cloudError && <p className={styles.error} role="alert">{cloudError}<button className={styles.refreshLibraries} disabled={locked} onClick={()=>{setCloudError("");void refreshLibraries();}}>重新检查同步</button></p>}
        {(librariesLoading && method === "library" || busy && !jobId || subjectBusy) && <p className={styles.status} role="status"><LoaderCircle className={styles.spin} size={18}/>{subjectBusy ? "正在关联所选微信好友的档案…" : busy ? note || "正在打开这份聊天…" : "正在读取已同步聊天…"}</p>}
        {note && !busy && !compactImport && !momentsResultOnly && <p className={styles.status} role="status"><CheckCheck size={18}/>{note}</p>}
        {method === "window" && <ScreenCapture sessionKey={JSON.stringify([owner, kind, friend.trim(), wechatAccount.trim()])} disabled={!owner || locked || !!receipt || !friend.trim() || !wechatAccount.trim()} onReady={framesReady}/>}
        {method === "video" && <div id="recording-upload" className={styles.recordingUpload}>{kindPicker}<VideoImport sessionKey={JSON.stringify([owner, kind])} disabled={!owner || locked || !!receipt} onReady={videoReady}/></div>}
        {method === "library" && !library && !visibleLibraries.length && !librariesLoading && !account.loading && <section className={styles.empty}><Cloud size={42}/><h2>{kind === "moments" ? "先在电脑导入朋友圈，之后手机直接看。" : "第一次在电脑导入，之后手机直接看。"}</h2><p>{kind === "moments" ? "电脑端采集朋友圈并启用跨端同步后，手机网页版登录同一账号即可继续查看。" : "电脑端导入聊天后，点击「启用跨端同步」。手机网页版登录同一账号，小程序关联该网页账号，即可打开这里的材料。"}</p><p>已有材料但没看到？请回到原电脑启用同步，再刷新这里。</p><button className={ui.secondary} disabled={locked} onClick={()=>void refreshLibraries()}><RefreshCw size={17}/>刷新已同步材料</button><a className={ui.secondary} href={`/capture?method=computer&kind=${kind}`}>查看电脑版导入步骤<ArrowRight size={17}/></a></section>}
        {library ? <section id="capture-preview" className={styles.preview} data-stage={reviewing?"confirm":browsingMaterials?"materials":"ready"} hidden={showIntake && (method === "desktop" || method === "library")}><div className={styles.previewHead}><div><span className={styles.eyebrow}>{reviewing ? "确认分析" : browsingMaterials ? "已保存材料" : "关系报告"}</span><h2>{contactDisplayName(library.friend)}<small>{library.kind === "chat" ? "聊天记录" : "朋友圈"}</small></h2></div><div className={styles.previewActions}>{!reviewing && !browsingMaterials && <button className={styles.refreshLibraries} disabled={locked || !!receipt} onClick={()=>{setShowImportControls(true);setSelectedContact(null);}}>补充 / 换人<ArrowRight size={15}/></button>}<button className={styles.delete} disabled={locked || !!receipt} onClick={() => void removeLibrary()} aria-label={library.cloud?.enabled ? "删除云端和本机聊天" : "删除本机原文"}><Trash2 size={18}/></button></div></div>
          <div className={styles.stats} hidden={reviewing || browsingMaterials || fullReportPath}><div><strong>{stats?.added ?? pending.length}</strong><span>{stats ? "本次新增" : "尚未分析"}</span></div><div><strong>{stats ? Math.max(0, stats.repeated - stats.updatedVoice) : library.records.length - pending.length}</strong><span>{stats ? "重复跳过" : "已分析"}</span></div><div><strong>{library.records.length}</strong><span>这份材料共保存</span></div></div>
          {voiceEnriching && !reviewing && <div className={styles.job} data-voice-progress><p role="status"><LoaderCircle size={17} className={styles.spin}/>语音正在后台补齐，已保存的文字和图片可以先看。</p><p>{note}</p><button className={ui.secondary} disabled={!jobId || analyzing} onClick={()=>void cancel()}>暂停补全</button></div>}
          <div className={styles.nextAction} data-tour="capture-analysis" hidden={browsingMaterials}>{fullReportPath && !reviewing && <><div className={styles.importReceipt}><CheckCheck size={18}/><span>已保存 <strong>{library.records.length}</strong> 条{library.kind === "moments" ? "朋友圈" : "聊天"}{relatedMomentCount ? ` + ${relatedMomentCount} 条朋友圈` : ""}{coverage?.unreadVoice ? ` · ${coverage.unreadVoice} 条语音待补齐` : ""}</span><small>{historyInProgress ? "已保存部分资料" : "材料已就位"}</small></div><h3 className={styles.readyTitle}>下一步，{fullReportTitle}</h3><p className={styles.readyCaption}>{library.kind === "moments" ? "看动态主题、表达线索和变化。全部已导入内容都会纳入分析。" : "看清现状、关系变化和下一步。确认费用后开始。"}</p>{historyInProgress && <p className={styles.readyCaption}>聊天尚未全部导完；继续导入可补齐，也可以先分析已保存的内容。</p>}</>}
            {fullReportPath && library.kind === "chat" && !reviewing && !relatedLoading && !relatedError && (!relatedMomentCount || relatedMoments.some(value=>value.coverage?.scope==="all-visible"&&!value.coverage.complete)) && <div className={styles.missingMoments} data-moments-coverage={relatedMomentCount?"partial":"missing"}><div><strong>{relatedMomentCount ? "朋友圈还没采集到可见末尾" : "朋友圈尚未导入"}</strong><p>{relatedMomentCount ? `已保存 ${relatedMomentCount} 条动态。补采后可以一起分析，已有内容会去重。` : "当前报告会使用已保存的聊天；补充朋友圈后，才能一起核对公开表达和私下互动。"}</p></div><button className={ui.secondary} disabled={locked||!!receipt} onClick={()=>void prepareMomentsImport()}><Images size={18}/>{relatedMomentCount ? "继续补充朋友圈" : "补充这个人的朋友圈"}<ArrowRight size={17}/></button></div>}
            {fullReportPath && library.kind === "moments" && !reviewing && library.coverage?.scope==="all-visible" && !library.coverage.complete && <p className={styles.warning}>本次尚未采集到可见末尾；报告会分析已保存的全部 {library.records.length} 条动态。可先继续导入再生成。</p>}
            {fullReportPath && (relatedLoading || relatedError) && <p className={styles.status} role={relatedError ? "alert" : "status"}>{relatedError || "正在核对这位好友的朋友圈…"}{relatedError && <button className={styles.refreshLibraries} onClick={() => setRelatedRetry(value => value + 1)}>重新读取朋友圈</button>}</p>}
            <div className={styles.nextHeading} hidden={reviewing || fullReportPath}><h3>{isWindow ? "先核对画面，再开始分析" : library.kind === "chat" ? "聊天已导入，先生成完整关系报告" : "材料已就位，接下来想看什么？"}</h3><span>{isWindow ? `本次选中 ${chosen.length} 张 · 已保存 ${library.records.length} 张` : library.kind === "chat" ? `完整 ${library.records.length} 条 · 可读文字 ${readableRecordCount} 条` : `本次分析 ${chosen.length} 条 · 已保存 ${library.records.length} 条`}</span></div>
            <p className={styles.selectionNote} hidden={reviewing || fullReportPath}>{isWindow ? "已保留采集画面的顺序，下一步核对截图身份。" : library.kind === "chat" ? `基于全部已导入聊天，梳理现状、变化和下一步。${historyInProgress ? "导入仍在进行；可先暂停，再分析已保存的内容。" : ""}` : `每批最多分析 ${CAPTURE_ANALYSIS_LIMIT.moments} 条动态。其余已保存的原文可在下方查看、分批选择。`}</p>
            {!fullReportPath && <><div id="capture-person" className={styles.personSummary} hidden={reviewing}><span>关联人物：<strong>{subjectLabel || "核对截图中的人物"}</strong></span><button disabled={locked || !!receipt} onClick={()=>setAdjustPerson(!adjustPerson)}>{adjustPerson ? "收起" : "调整"}</button></div>{!reviewing&&(adjustPerson||isWindow&&!subject)&&<div className={styles.personAdjust}><PersonSelect people={account.people} value={subject} onChange={choosePerson} disabled={account.loading || locked || !!receipt} empty={account.loading ? "正在读取人物档案…" : isWindow ? "选择这位好友的档案" : "按导入来源自动关联"}/>{isWindow&&<InlinePerson key={owner + library.id} initialName={contactDisplayName(library.friend)} disabled={locked || !!receipt} onCreated={async id => { await account.refresh(); choosePerson(id); }}/>}</div>}</>}
            {!isWindow&&!subject&&!reviewing&&<p className={styles.readyCaption}>继续即同意保存有权提供的资料并启用档案，将按这份导入材料自动关联人物。</p>}
            {fullReportPath && !showAnalysis && !receipt && <div className={styles.fullReportCard}>

              <button className={ui.primary} disabled={account.loading || subjectBusy || analyzing || cloudBusy || busy && !jobId || (!receipt && (!reportReady || relatedLoading || !!relatedError))} onClick={()=>void openAnalysis()}><FileText size={20}/><span><strong>{receipt ? "继续生成完整报告" : busy && jobId ? voiceEnriching ? "先用已导入资料生成报告" : "暂停导入，先分析已保存聊天" : fullReportTitle}</strong><small>{reportReady || receipt ? priceLabel(account.account, costKey) : library.kind === "moments" ? "还没有可读的动态材料" : "还没有可读的聊天文字"}</small></span><ArrowRight size={18}/></button>
            </div>}
            {fullReportPath && !reviewing && reportWaitReason && <p className={styles.readyState} role="status">{(cloudBusy || relatedLoading || account.loading || busy&&!jobId) && <LoaderCircle size={17} className={styles.spin}/>} {reportWaitReason}</p>}

            <div className={styles.nextChoices} hidden={reviewing}>
              {!isWindow&&library.kind==="chat"&&<button className={ui.secondary} disabled={account.loading||analyzing||cloudBusy||relatedLoading||!!relatedError||busy&&!jobId||!!receipt||!readableRecordCount} onClick={()=>void askSelected()}><MessageSquare size={20}/><span><strong>基于全部聊天提问</strong></span><ArrowRight size={18}/></button>}
              {isWindow ? <button className={ui.primary} data-main="true" aria-expanded={showAnalysis||!!receipt} aria-controls="capture-confirm" disabled={account.loading||locked||!chosen.length} onClick={()=>showAnalysis?setShowAnalysis(false):void openAnalysis()}><FileText size={20}/><span><strong>{receipt ? "继续本次分析" : library.kind === "chat" ? "进入截图分析" : "生成分析报告"}</strong><small>{isWindow ? "核对截图，查看画面解读" : `分析选中的 ${chosen.length} 条动态`}</small></span><ArrowRight size={18}/></button> : null}
            </div>
            {fullReportPath && adjustPerson && !reviewing && <div id="capture-person" className={styles.confirmPerson}><PersonSelect people={account.people} value={subject} onChange={choosePerson} disabled={account.loading || locked} empty="按导入来源自动关联"/></div>}
            {(showAnalysis||receipt)&&<div id="capture-confirm" className={styles.confirmAnalysis}>
              <div className={styles.confirmHeading}><h3>确认材料与费用</h3>{!analyzing && !receipt && <button type="button" onClick={()=>setShowAnalysis(false)} aria-label="返回报告准备">返回上一步</button>}</div>
              {fullReportPath && <div id="capture-person" className={styles.confirmPerson}><p className={styles.readyCaption}>报告归入「{subjectLabel}」的档案。</p>{account.people.length>1&&<details><summary>关联其他已有档案</summary><PersonSelect people={account.people} value={subject} onChange={choosePerson} disabled={account.loading || locked || !!receipt} empty="按导入来源自动关联"/></details>}</div>}
              {fullReportPath && library.kind === "chat" && <><div className={styles.reportGoals} role="group" aria-label="选择报告重点">{([{key:"panorama",label:"完整看这个人",hint:"现状、变化与下一步"},{key:"next",label:"怎么聊、怎么推进",hint:"接近意愿、回复与邀约"},{key:"risk",label:"先看风险与边界",hint:"矛盾、兑现与需要核实的事"}] as const).map(goal=><button type="button" key={goal.key} aria-pressed={diagnosticQuestion===goal.key} disabled={locked||!!receipt} onClick={()=>setDiagnosticQuestion(goal.key)}><strong>{goal.label}</strong><small>{goal.hint}</small></button>)}</div><details className={styles.rangeOptions}><summary>其他关注点</summary><label className={styles.questionPicker}><span>报告重点</span><select value={diagnosticQuestion} disabled={locked || !!receipt} onChange={event=>setDiagnosticQuestion(event.target.value as typeof diagnosticQuestion)}><option value="panorama">完整关系报告</option><option value="attitude">TA 对我的态度</option><option value="trend">升温、降温与转折</option><option value="worth">是否值得继续投入</option><option value="next">怎么聊、怎么邀约</option><option value="risk">风险与需要核实的行为</option></select></label></details></>}
              <p>{!isWindow&&library.kind==="chat" ? `全部 ${library.records.length} 条聊天${relatedMomentCount ? ` + ${relatedMomentCount} 条朋友圈` : ""} · 可读文字与转写 ${readableRecordCount} 条。` : !isWindow ? `全部 ${library.records.length} 条朋友圈及已保存图片。` : `本次使用选中的 ${chosen.length} 条材料。`}</p>
              {cloudBusy && <div className={styles.analysisProgress} role="status"><LoaderCircle size={17} className={styles.spin}/><div><strong>正在保存分析所需资料</strong><p>{cloudNote || "正在同步聊天与图片…"}</p></div></div>}
              {analyzing && <div className={styles.analysisProgress} role="status"><LoaderCircle size={17} className={styles.spin}/><div><strong>正在生成关系报告 · {Math.floor(analysisSeconds/60)}:{String(analysisSeconds%60).padStart(2,"0")}</strong><p>完成后自动打开。{analysisSeconds>=90 ? "正在连接后台任务；连接中断后可继续原请求。" : "正在核对原话、图片和前后变化。"}</p></div></div>}
              {!isWindow && <label className={styles.consent}><input type="checkbox" checked={consent} disabled={locked} onChange={e => setConsent(e.target.checked)}/><span>{library.kind === "chat" ? `我有权提供以上聊天${relatedMomentCount ? "、朋友圈及已保存的图片" : "及已保存的图片"}，同意发送至阿里云百炼千问分析。` : `我有权提供全部 ${library.records.length} 条朋友圈及已保存图片，同意发送至阿里云百炼千问分析。`}</span></label>}
          {!isWindow && <p className={styles.selectionNote}>相同材料与问题直接打开已有报告，不重复扣费。</p>}
          {reportId && <a className={styles.reportLink} href={`/report?id=${reportId}`}><CheckCheck size={20}/><span>完整报告已保存<strong>打开报告，回看原文依据</strong></span><ArrowRight size={20}/></a>}
          <button className={`${ui.primary} ${styles.full}`} disabled={account.loading || locked || (!isWindow ? ((!reportReady || relatedLoading || !!relatedError) && !receipt) : !chosen.length) || (!isWindow && (!consent || !hasPrice(account.account,costKey)))} onClick={() => void analyze()}>{subjectBusy ? <><LoaderCircle size={18} className={styles.spin}/>正在关联微信好友…</> : cloudBusy ? <><LoaderCircle size={18} className={styles.spin}/>正在同步资料…</> : analyzing ? <><LoaderCircle size={18} className={styles.spin}/>正在建立报告任务…</> : isWindow ? <>进入截图分析<ArrowRight size={18}/></> : <>{receipt ? "继续本次分析" : "确认并生成报告"}<span> · {priceLabel(account.account,costKey)}</span><ArrowRight size={18}/></>}</button>
          {!isWindow && !analyzing && !cloudBusy && !consent && <p className={styles.readyCaption}>勾选上方材料授权后，即可开始。</p>}

            </div>}
                      {!reviewing && library.reportLinks.length > 0 && <div className={styles.reportHistory}><History size={16}/>这份原文的报告{library.reportLinks.slice(-4).reverse().map((link,i) => <a key={link.reportId} href={`/report?id=${link.reportId}`}>{i === 0 ? "最近一次" : `此前报告 ${i}`}<ArrowRight size={13}/></a>)}</div>}
          </div>
          <div className={styles.materialTabs} hidden={reviewing} role="tablist" aria-label="材料查看"><button role="tab" aria-selected={materialView==="records"} aria-controls="capture-originals" onClick={()=>setMaterialView(materialView==="records"?"none":"records")}><MessageSquare size={17}/>{fullReportPath ? "查看全部原文" : "查看原文 / 调整选择"}</button><button role="tab" aria-selected={materialView==="status"} aria-controls="capture-status" onClick={()=>setMaterialView(materialView==="status"?"none":"status")}><Cloud size={17}/>导入情况与同步{coverage?.unreadVoice ? ` · ${coverage.unreadVoice} 条语音待补齐` : ""}</button></div>
          {browsingMaterials && <button className={styles.returnToReady} onClick={()=>setMaterialView("none")}>返回报告准备<ArrowRight size={16}/></button>}
          <div id="capture-status" role="tabpanel" hidden={materialView!=="status" || reviewing} className={styles.materialPanel}>
          <div className={styles.cloudSync} data-cloud-sync><Cloud size={24}/><div><strong>{cloudBusy ? "正在同步，请稍候…" : library.cloud?.retired ? "旧的离线副本 · 不会自动同步" : library.cloud?.offline ? "当前查看本机副本" : library.cloud?.enabled ? "已开启跨设备继续" : "在手机上接着看这份聊天"}</strong><p>{library.cloud?.retired ? "云端已重新建立，这份旧副本仅供本机查看，可以单独删除。" : library.cloud?.enabled ? "新聊天和语音文字会继续同步。手机网页用同一账号，小程序关联网页账号后查看。" : "将这份材料的文字、语音转写和已采集图片保存到你的账号，直到你主动删除。同步不分析、不扣积分。"}</p>{cloudNote&&<p role="status">{cloudNote}</p>}</div><button className={ui.secondary} disabled={locked || account.loading || library.cloud?.retired} onClick={()=>void syncCurrentLibrary()}>{cloudBusy?<LoaderCircle className={styles.spin} size={17}/>:<UploadCloud size={17}/>} {library.cloud?.enabled ? "同步最新内容" : "启用跨端同步"}</button></div>
          {library.coverage?.scope === "all-visible" && <p className={styles.coverageSummary}>{library.coverage.complete ? `已采集到可见末尾 · 本次 ${library.coverage.recordCount} 条动态` : "本次未采集到可见末尾，已保存的动态可继续查看。"} · 微信不可见或已删除的动态无法读取。</p>}<CaptureCoverage records={library.records} kind={library.kind}/>{library.kind === "chat" && <ChatActivity records={library.records} account={library.account} friend={library.friend} compact/>}
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
          <div id="capture-originals" role="tabpanel" hidden={materialView!=="records" || reviewing} className={styles.materialPanel}>
          <div className={styles.previewTools} data-tour="capture-selection"><label><Search size={18}/><input placeholder="搜索原文、时间或说话人" value={query} onChange={e => { setQuery(e.target.value); setRecordPage(0); }}/></label>{!fullReportPath && <><button disabled={locked || !!receipt} onClick={() => selectPending(library)}>{library.records.some(visualSource) ? "选择待分析画面" : "选择最近待分析"}</button><button disabled={locked || !!receipt || !selected.length} onClick={() => { setSelected([]); setConsent(false); setError(""); }}>清空选择</button></>}</div>
          <div ref={recordList} className={styles.records} aria-label="采集原文列表">{display.map(record => { const done = !pending.some(r => r.localId === record.localId), notice = mediaNotice(record); return <article key={record.localId} data-source-id={record.localId} data-selected={!fullReportPath && selected.includes(record.localId)}><label className={styles.recordCheck}>{!fullReportPath && <input type="checkbox" checked={selected.includes(record.localId)} disabled={locked || done || !!receipt} onChange={e => toggleRecord(record,e.target.checked)}/>}<span><strong>{visualSource(record) ? `第 ${library.records.indexOf(record) + 1} 张采集画面` : library.kind === "chat" ? record.senderRole === "self" ? "我" : record.senderRole === "other" ? contactDisplayName(library.friend) : record.sender || "身份待核对" : `第 ${library.records.indexOf(record) + 1} 条动态`}</strong><small>{record.source.method === "video-import" ? `录屏位置 ${videoTime(Number(record.source.videoTime) || 0)}` : record.at || "原文未显示时间"}{done ? " · 已分析" : ""}</small></span></label>{record.text && <p>{record.text}</p>}{record.images?.length ? <div className={styles.recordImages}>{record.images.map((img,n) => <button key={n} onClick={() => setImage(`data:${img.mime};base64,${img.data}`)} aria-label={`查看${record.source.label}的图片${n+1}`}><img src={`data:${img.mime};base64,${img.data}`} alt={img.name}/></button>)}</div> : null}{notice && <p className={styles.mediaNotice}><Images size={16}/>{notice}</p>}<small className={styles.source}>{record.source.label}{record.kind === "sticker" ? " · 表情包" : ""}</small></article>; })}{!display.length && <p className={styles.muted}>没有找到匹配的原文，请换个关键词。</p>}</div>
          <nav className={styles.pagination} aria-label="原文分页"><p className={styles.pageSummary}>{visible.length ? `${currentPage * 50 + 1}–${Math.min((currentPage + 1) * 50, visible.length)}` : "0"} / {visible.length} 条{fullReportPath ? " · 仅分页显示，分析使用全部记录" : ` · 已选 ${selected.length} 条`}</p><div><button className={ui.secondary} disabled={currentPage === 0} onClick={() => setRecordPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pageCount}</span><button className={ui.secondary} disabled={currentPage >= pageCount - 1} onClick={() => setRecordPage(currentPage + 1)}>下一页</button></div></nav>

          </div>
        </section> : null}
      </div>
    </div>
    {image && <div className={styles.imageModal} role="dialog" aria-modal="true" aria-label="来源截图" onClick={() => setImage(null)}><button onClick={() => setImage(null)} aria-label="关闭来源截图"><X size={23}/></button><img src={image} alt="来源截图完整预览" onClick={e => e.stopPropagation()}/></div>}
  </main></div>;
}
