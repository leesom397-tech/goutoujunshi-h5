"use client";
import { useEffect, useRef, useState } from "react";
import { ScanLine, Link2, MessageSquare, Images, UserRound, Sparkles, Coins, ArrowRight, ArrowUp, ArrowDown, Check, CheckCheck, Clipboard, CloudUpload, FileCheck2, FolderHeart, ImagePlus, LoaderCircle, Plus, RotateCcw, ShieldCheck, SlidersHorizontal, History, BookmarkCheck, X, Monitor, Video, FileUp, Library } from "lucide-react";
import { AnalysisIllustration } from "@/components/web-analysis/Visuals";
import { WebNav } from "@/components/WebNav";
import { FirstUseTour } from "@/components/FirstUseTour";
import { AnalysisAuthGate } from "@/components/AnalysisAuthGate";
import { AnalysisExample } from "@/components/web-analysis/AnalysisExample";
import { getCaptureLibrary } from "@/lib/desktop-capture-vault";
import { linkSyncedReportSources as linkReportSources } from "@/lib/capture-cloud-client";
import ui from "@/components/AuroraUI.module.css";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import { AccountNotice, ErrorNotice, PersonSelect, InlinePerson, api, message, priceLabel, hasPrice, useAccount, type Json, WebError } from "@/components/web-analysis/client";
import { runUpload, uploadStore, type UploadTask } from "@/components/web-analysis/uploads";
import { ArchiveAvatar } from "@/components/ArchiveAvatar";
import {PersonAvatarChoice} from "@/components/PersonAvatarChoice";
import { ChatReport, SocialReport } from "@/components/web-analysis/ReportView";
import { prepareSocialImage } from "@/components/web-analysis/image-normalize";
import { mergeChatReports, socialPrevious } from "@/components/web-analysis/report-data";
import "@/components/web-analysis/web-analysis.css";
import "./analyze-experience.css";
import styles from "./analyze.module.css";
import intake from "@/components/web-analysis/Intake.module.css";
import { resolveIntakeIdentity, readIntakePreference, rememberIntakePreference, rememberCaptureSubject, uniqueIntakeImages } from "@/components/web-analysis/intake-preferences";
import { intakeHref, intakeReturnTo } from "@/components/web-analysis/intake-navigation";
import { useIntakeDraft } from "@/components/web-analysis/useIntakeDraft";
import { useAnalyzedIntake } from "@/components/web-analysis/useAnalyzedIntake";
import { recordSuccessfulImages } from "@/components/web-analysis/intake-history";
import { LiveAnalysis, type Recognition } from "@/components/web-analysis/LiveAnalysis";
import { analysisFocus, analysisPurposes, withAnalysisFocus, type AnalysisFocus } from "@/lib/person-analysis-navigation";

const analysisModes = [
  { key: "chat", label: "聊天截图", intent: "读懂这轮互动", description: "看情绪与回应，找到适合你的下一句。", upload: "上传双方聊天截图", tip: "截取完整对话，保留前后语境；按聊天的阅读顺序排列。", Icon: MessageSquare },
  { key: "moments", label: "朋友圈", intent: "发现相处线索", description: "从日常表达中，了解兴趣、节奏与边界。", upload: "上传朋友圈整页截图", tip: "九宫格保留整页即可，带上文字和日期更容易理解语境。", Icon: Images },
  { key: "social", label: "社交主页", intent: "更有依据地了解对方", description: "整理资料与照片，区分已知事实和待验证判断。", upload: "上传简介与社交主页截图", tip: "优先选择清晰的简介和近期动态；资料越完整，判断越有依据。", Icon: UserRound },
];

export default function AnalyzePage() {
  const [sameCity,setSameCity]=useState(false);
  const [purpose,setPurpose]=useState<AnalysisFocus | undefined>();
  const [purposeOptionsOpen,setPurposeOptionsOpen]=useState(false), [exampleOpen,setExampleOpen]=useState(false);
  const exampleDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>setPurpose(analysisFocus(new URLSearchParams(window.location.search).get("focus"))),[]);
  useEffect(()=>{if(!exampleOpen)return;exampleDialog.current?.showModal();const before=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=before;};},[exampleOpen]);
  const [confirmStage,setConfirmStage]=useState(false);
  const account = useAccount(), [mode, setMode] = useState("chat"), [files, setFiles] = useState<File[]>([]), [previews, setPreviews] = useState<string[]>([]), [side, setSide] = useState(""), [subject, setSubject] = useState(""), [targetSelf, setTargetSelf] = useState(false), [compare, setCompare] = useState(true), [consent, setConsent] = useState(false), [linkConsent, setLinkConsent] = useState(false), [busy, setBusy] = useState(false), [preparing, setPreparing] = useState(false), [task, setTask] = useState<UploadTask | null>(null), [status, setStatus] = useState<Json | null>(null), [result, setResult] = useState<Json | null>(null), [error, setError] = useState(""), [url, setUrl] = useState(""), [linkResult, setLinkResult] = useState<Json | null>(null), [previous, setPrevious] = useState<Json | null>(null), [previousCount, setPreviousCount] = useState(0), [resultSources, setResultSources] = useState<File[]>([]), [restoredOwner, setRestoredOwner] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null), generation = useRef(0), preparingRef = useRef(false), owner = account.account?.account?.userId, linkId = useRef<string | null>(null), resultRef = useRef<HTMLDivElement>(null), fileInputRef = useRef<HTMLInputElement>(null), dragDepth = useRef(0);
  const avatarDialog = useRef<HTMLDialogElement>(null);
  const [lastReport, setLastReport] = useState<Json | null>(null);
  const [restoringReport, setRestoringReport] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [forceReanalyze, setForceReanalyze] = useState(false);
  const [reviewBusy,setReviewBusy] = useState(false);
  const reviewController = useRef<AbortController | null>(null);
  const [captureSource, setCaptureSource] = useState<{libraryId:string;sourceIds:string[]}|null>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const captureFiles = useRef(new WeakMap<File, string>());
  const preferenceHydrated = useRef("");
  const originalFiles = useRef(new WeakMap<File, File>());
  const [rememberedChoice, setRememberedChoice] = useState(false), [editPerson, setEditPerson] = useState(false), [materialNote, setMaterialNote] = useState(""), [returnTo, setReturnTo] = useState("");
  const [recoveryReady, setRecoveryReady] = useState(false);
  const history = useAnalyzedIntake({scope:{owner:owner || "",subjectId:subject,mode,targetSelf,selfSide:side},files,enabled:recoveryReady && owner === restoredOwner && !account.loading && !task && !result});
  const effectiveFiles = forceReanalyze ? files : history.fresh;
  useEffect(() => { setForceReanalyze(false); setConsent(false); }, [files,subject,mode,targetSelf,side,owner]);
  useEffect(() => { setConfirmStage(false); }, [owner,mode]);
  useEffect(() => { if(!files.length)setConfirmStage(false); }, [files.length]);
  useEffect(() => { if(history.repeated.length)setConsent(false); }, [history.repeated.length]);
  const draft = useIntakeDraft({owner:owner || "",mode,subjectId:subject,targetSelf,files,selfSide:side,sameCity,compare,returnTo,previous,previousCount,captureSource,fileSourceIds:files.map(file => captureFiles.current.get(file) || "")}, recoveryReady && owner === restoredOwner && !account.loading && preferenceHydrated.current === owner, busy || preparing || !!task, !!result || restoringReport);
  function restoreDraft() {
    const saved = draft.available; if (!saved || saved.owner !== owner || files.length || task || busy || preparing) return;
    setFiles(saved.files); setSide(["left","right"].includes(saved.selfSide) ? saved.selfSide : ""); setSameCity(saved.sameCity === true); setCompare(saved.compare !== false); setPrevious(saved.previous || null); setPreviousCount(saved.previousCount || 0);
    setCaptureSource(saved.captureSource || null); saved.files.forEach((file,index) => { const source = saved.fileSourceIds?.[index]; if (source) captureFiles.current.set(file,source); });
    setReturnTo(value => value || intakeReturnTo(saved.returnTo)); setConsent(false); setError(""); setMaterialNote("已恢复材料与顺序。请核对后确认分析，恢复草稿不会扣积分。"); draft.dismiss();
  }
  const [showAuth, setShowAuth] = useState(false), [pendingAuth, setPendingAuth] = useState(false), [authComplete, setAuthComplete] = useState(false);
  useEffect(() => { const search = new URLSearchParams(window.location.search); const selected = search.get("mode") || search.get("kind"); if (["chat", "social", "moments", "profile"].includes(selected || "")) setMode(selected === "profile" ? "social" : selected!); setSubject(search.get("subjectId") || ""); setTargetSelf(search.get("target") === "self"); return () => { generation.current++; controller.current?.abort(); reviewController.current?.abort(); }; }, []);
  useEffect(() => { const next = files.map(file => URL.createObjectURL(file)); setPreviews(next); return () => next.forEach(URL.revokeObjectURL); }, [files]);
  useEffect(() => {
    generation.current++; controller.current?.abort(); reviewController.current?.abort(); setReviewBusy(false); setRecoveryReady(false); setBusy(false); preparingRef.current=false; setPreparing(false); setPrevious(null); setPreviousCount(0); setConsent(false); setLinkConsent(false); setUrl(''); setLinkResult(null); setTask(null); setResult(null); setResultSources([]); setFiles([]); setStatus(null); setLastReport(null); setRestoringReport(false); setRestoredOwner(owner||null);setSameCity(false);
    setCaptureSource(null); captureFiles.current = new WeakMap(); originalFiles.current = new WeakMap(); preferenceHydrated.current = ""; setRememberedChoice(false); setEditPerson(false); setMaterialNote(""); setSubject(""); setSide(""); setTargetSelf(false); setCompare(true); setReturnTo(""); if(!owner)return; let current=true;
    const query=new URLSearchParams(window.location.search),savedId=query.get('reportId');
    setSubject(query.get('subjectId') || '');
    setTargetSelf(query.get('target') === 'self');
    setReturnTo(intakeReturnTo(query.get('returnTo')));
    const restoreTask = (saved: UploadTask) => { if(saved.owner!==owner){setError('保存的任务与当前账号不一致，请回到原账号查看。');return;} setTask(saved);setReturnTo(value=>value || intakeReturnTo(saved.returnTo));setMode(saved.mode);setFiles(saved.files);setSubject(saved.parameters.subjectId||'');setSide(saved.parameters.selfSide||'');setTargetSelf(saved.parameters.target==='self');setSameCity(saved.parameters.knownContext?.sameCity===true);setCompare(saved.parameters.compareWithSelf===true);setPrevious(saved.parameters.previous||null);setPreviousCount(saved.parameters.previousCount||0);setStatus({status:'saved'}); if(saved.parameters.captureSource)setCaptureSource(saved.parameters.captureSource); if(saved.parameters.confirmed===true)void execute(saved); };
    if(query.get('capture')==='1' && !savedId) {
      void (async()=>{
        try {
          const saved = await uploadStore(owner);
          if (!current) return;
          if (saved) { restoreTask(saved); return; }
          const handoff=JSON.parse(sessionStorage.getItem(`chengzi-capture:${owner}:handoff`)||'null');
          if(!handoff?.libraryId||!Array.isArray(handoff.sourceIds))throw Error('采集材料未找到，请返回采集页重新选择。');
          const library=await getCaptureLibrary(owner,handoff.libraryId);
          if(!current)return;
          if(!library)throw Error('本机采集原文已移除，请返回采集页重新采集。');
          const rows=handoff.sourceIds.map((id:string)=>library.records.find(row=>row.localId===id)).filter(Boolean);
          const images:File[]=[];
          for(const row of rows)for(const img of row.images||[]){const raw=atob(img.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),file=new File([bytes],img.name,{type:img.mime});images.push(file);captureFiles.current.set(file,row.localId);}
          if(!images.length||images.length>9)throw Error('每次最多分析9张采集截图，请返回采集页调整。');
          setMode(library.kind);setFiles(images);setSubject(handoff.subjectId || '');setReturnTo(value=>value || intakeReturnTo(handoff.returnTo));setCaptureSource({libraryId:library.id,sourceIds:rows.map((row:any)=>row.localId)});setStatus(null);
        }catch(e){if(current)setError(message(e));}finally{if(current)setRecoveryReady(true);}
      })();
      return()=>{current=false;};
    }
    void api('/api/web/report/list?page=1&pageSize=1').then(value=>{if(current)setLastReport(value.reports?.[0]||null);}).catch(()=>{});
    if(savedId){
      setRestoringReport(true);
      const sourceRepair = (async () => { const key = `chengzi-capture:${owner}:link:${savedId}`; try { const source = JSON.parse(sessionStorage.getItem(key) || 'null'); if (source?.libraryId && Array.isArray(source.sourceIds)) { await linkReportSources(owner, savedId, source); sessionStorage.removeItem(key); sessionStorage.removeItem(`chengzi-capture:${owner}:handoff`); } } catch { if (current) setError('报告已保存，本机原文关联暂未恢复。请检查浏览器存储后刷新，无需再次分析。'); } })();
      void sourceRepair.then(() => api('/api/web/report?id='+encodeURIComponent(savedId))).then(value=>{
        if(!current)return; const restored={...value.report,...(value.kind==='chat'||value.report?.lines ? {entries:Array.isArray(value.entries)?value.entries:[value.report]} : {}),reportId:value.reportId||savedId,subjectId:value.subjectId||value.report?.subjectId||null,targetSelf:value.targetSelf??value.report?.targetSelf,totalCount:value.totalCount||value.report?.totalCount,selfSide:value.selfSide||value.report?.selfSide};
        setResult(restored);setMode(value.kind==='moments'?'moments':value.kind==='social'?'social':'chat');setSubject(restored.subjectId||'');setTargetSelf(!!restored.targetSelf);setSide(restored.selfSide||'');
      }).catch(e=>{if(current)setError(message(e));}).finally(()=>{if(current){setRestoringReport(false);setRecoveryReady(true);}});
    } else void uploadStore(owner).then(saved=>{
      if(!current)return;
      if(!saved){try{if(['mode','kind','subjectId','target','new'].some(key=>query.has(key)))return;const stored=JSON.parse(sessionStorage.getItem(`chengzi-analysis:${owner}`)||'null');if(stored?.result){setResult(stored.result);setMode(stored.mode);setSubject(stored.result.subjectId||'');setTargetSelf(!!stored.result.targetSelf);setSide(['left','right'].includes(stored.result.selfSide)?stored.result.selfSide:'');}}catch{}return;}
      restoreTask(saved);
    }).catch(e=>{if(current)setError(message(e));}).finally(()=>{if(current)setRecoveryReady(true);});
    return()=>{current=false;};
  },[owner]);
  useEffect(() => {
    if (!owner || owner !== restoredOwner || account.loading || preferenceHydrated.current === owner) return;
    const query = new URLSearchParams(window.location.search);
    if (query.get('capture') === '1' && !captureSource && !task) return;
    preferenceHydrated.current = owner;
    if (task || query.has('reportId') || targetSelf) return;
    const allowed = account.people.map(person => String(person.id));
    const saved = resolveIntakeIdentity({owner,mode,allowedIds:allowed,requestedSubjectId:subject || (query.has('subjectId') ? query.get('subjectId') : undefined),captureLibraryId:captureSource?.libraryId,targetSelf});
    setSubject(saved.subjectId); setSide(saved.selfSide || ''); setSameCity(saved.sameCity === true); setRememberedChoice(!!saved.subjectId); setEditPerson(saved.needsChoice);
  }, [owner, restoredOwner, account.loading, account.people, captureSource, task, targetSelf, subject, mode]);
  function choosePerson(value: string) {
    if (disabled) return;
    resetInterpretation();
    const saved = readIntakePreference(owner || '', value);
    const nextSide = saved.selfSide || (!subject && files.length > 0 && ['left','right'].includes(side) ? side : '');
    setSubject(value); setSide(nextSide); setSameCity(saved.sameCity === true); setRememberedChoice(!!saved.selfSide); setEditPerson(false);
    rememberIntakePreference(owner || '', mode, {subjectId:value,...(['left','right'].includes(nextSide)?{selfSide:nextSide as 'left'|'right'}:{})});
    if (captureSource) rememberCaptureSubject(owner, captureSource.libraryId, value);
  }
  function chooseSide(value: string) {
    if (disabled || !['left','right'].includes(value)) return;
    setSide(value); setConsent(false); setResult(null); setRememberedChoice(false);
    rememberIntakePreference(owner || '', mode, {subjectId:subject, selfSide:value as 'left'|'right'});
  }
  const costKey = mode === "chat" ? (task?.files.length || effectiveFiles.length) <= 3 ? "analysisSmall" : (task?.files.length || effectiveFiles.length) <= 6 ? "analysisMedium" : "analysisLarge" : "profile";
  const disabled = busy || preparing || !!task;
  function choosePurpose(next: AnalysisFocus) {
    if (disabled) return;
    setPurpose(next); setPurposeOptionsOpen(false);
    const nextUrl = new URL(window.location.href); nextUrl.searchParams.set("focus", next);
    window.history.replaceState(null, "", nextUrl.pathname + nextUrl.search + nextUrl.hash);
    if (mode !== "chat") void changeMode("chat");
  }
  async function changeMode(next: string) {
    if (disabled || preparingRef.current || next === mode) return;
    const current = generation.current;
    if (next !== "chat" && mode === "chat" && files.length) {
      preparingRef.current = true; setPreparing(true); setError("");
      try {
        const prepared: File[] = [];
        for (const file of files) { const converted = await prepareSocialImage(file); if (current !== generation.current) return; originalFiles.current.set(converted,originalFiles.current.get(file)||file); const sourceId=captureFiles.current.get(file); if(sourceId)captureFiles.current.set(converted,sourceId); prepared.push(converted); }
        setFiles(prepared);
      } catch (e) { if (current === generation.current) setError(message(e)); return; }
      finally { if (current === generation.current) { preparingRef.current = false; setPreparing(false); } }
    }
    if (current !== generation.current) return;
    const modeUrl = new URL(window.location.href); modeUrl.searchParams.set("mode", next); window.history.replaceState(null, "", modeUrl.pathname + modeUrl.search + modeUrl.hash);
    setMode(next); setResult(null); setResultSources([]); setPrevious(null); setPreviousCount(0); setConsent(false); setError(""); setStatus(null); setLinkResult(null); setLinkConsent(false);
  }
  function resetMaterials() { setCaptureSource(null); setFiles([]); setResult(null); setResultSources([]); setPrevious(null); setPreviousCount(0); setConsent(false); setStatus(null); setError(""); setMaterialNote(""); }
  function resetInterpretation() { setResult(null); setResultSources([]); setPrevious(null); setPreviousCount(0); setConsent(false); setStatus(null); setError(""); }
  function moveImage(index: number, direction: number) { if (disabled || index + direction < 0 || index + direction >= files.length) return; setFiles(current => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; }); setConsent(false); }
  function requestUpload(otherSources = false) {
    if (disabled) return;
    if (!owner && account.loading) { setPendingAuth(true); return; }
    if (!owner) { setShowAuth(true); return; }
    if (otherSources) setSourcePickerOpen(true);
    else fileInputRef.current?.click();
  }
  useEffect(() => {
    if (!sourcePickerOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setSourcePickerOpen(false); };
    document.addEventListener("keydown", escape);
    const focus = window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("[data-source-picker] button")?.focus());
    return () => { document.removeEventListener("keydown", escape); window.cancelAnimationFrame(focus); };
  }, [sourcePickerOpen]);
  function chooseUploadSource(source: "screenshots" | "computer" | "video" | "file" | "library") {
    setSourcePickerOpen(false);
    if (source === "screenshots") { window.requestAnimationFrame(() => fileInputRef.current?.click()); return; }
    const href = source === "computer" ? "/capture?method=computer" : source === "video" ? "/capture?method=video" : source === "library" ? "/capture?method=library" : "/import";
    const next = new URL(href, window.location.origin);
    if (next.pathname === "/capture") {
      window.location.assign(withAnalysisFocus(intakeHref("/capture", { kind: mode === "moments" ? "moments" : "chat", method: next.searchParams.get("method") || undefined, subjectId: targetSelf ? "" : subject, returnTo }),purpose));
    } else {
      if (!targetSelf && subject) next.searchParams.set("subjectId", subject);
      window.location.assign(next.pathname + next.search);
    }
  }
  useEffect(() => {
    if (!pendingAuth || account.loading) return;
    setPendingAuth(false);
    if (!owner) setShowAuth(true);
    else document.getElementById("analysis-upload")?.focus();
  }, [pendingAuth, account.loading, owner]);
  async function authenticated() {
    await account.refresh();
    setShowAuth(false); setAuthComplete(true);
    requestAnimationFrame(() => {
      const target = document.getElementById("analysis-upload");
      target?.scrollIntoView({ block: "center", behavior: "smooth" }); target?.focus({ preventScroll: true });
    });
  }
  async function selectFiles(list: FileList | File[] | null) {
    if (!list || disabled || preparingRef.current) return;
    if (captureSource) { setError("本次已带入采集截图。补充材料请返回采集页，或点击重新分析后手动上传。"); return; }
    const additions = [...list], current = generation.current;
    if (!additions.length) return;
    if (!owner) { requestUpload(); return; }
    const maximum = mode === "chat" ? 5_000_000 : 12_000_000;
    if (additions.some(file => !["image/jpeg", "image/png"].includes(file.type) || !file.size || file.size > maximum)) { setError(`请选择每张 ${mode === "chat" ? 5 : 12} MB 内的有效 JPG 或 PNG 图片。`); return; }
    preparingRef.current = true; setPreparing(true); setError("");
    try {
      const unique = await uniqueIntakeImages(files.map(file => originalFiles.current.get(file) || file), additions);
      if (current !== generation.current) return;
      if (files.length + unique.files.length + previousCount > 9) { setError(`每组最多 9 张，还能添加 ${Math.max(0, 9 - files.length - previousCount)} 张。`); return; }
      const prepared: File[] = [];
      for (const file of unique.files) { const normalized = mode === "chat" ? file : await prepareSocialImage(file); originalFiles.current.set(normalized, file); prepared.push(normalized); if (current !== generation.current) return; }
      setMaterialNote(unique.repeated ? `已跳过 ${unique.repeated} 张完全相同的截图；相似图片和同名不同内容都会保留。` : '');
      if (!prepared.length) return;
      setFiles(old => [...old, ...prepared]); setResult(null); setResultSources([]); setConsent(false);
    } catch (e) { if (current === generation.current) setError(message(e)); }
    finally { if (current === generation.current) { preparingRef.current = false; setPreparing(false); } }
  }
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (disabled) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const images = Array.from(event.clipboardData?.items || []).filter(item => item.kind === "file" && item.type.startsWith("image/")).map(item => item.getAsFile()).filter((file): file is File => !!file);
      if (!images.length) return;
      event.preventDefault();
      void selectFiles(images);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [disabled, owner, files, mode, previousCount]);
  function scrollToStart() { window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }
  function newAnalysis(keepPerson = false) { if (disabled) return; const nextUrl=new URL(window.location.href);nextUrl.searchParams.delete('reportId');nextUrl.searchParams.delete('capture');nextUrl.searchParams.set('new','1');nextUrl.hash=''; if(keepPerson && subject)nextUrl.searchParams.set('subjectId',subject);else nextUrl.searchParams.delete('subjectId');window.history.replaceState(null,'',nextUrl.pathname+nextUrl.search); resetMaterials(); if(!keepPerson){setSubject("");setSameCity(false);setSide("");setRememberedChoice(false);setEditPerson(true);rememberIntakePreference(owner || '',mode,{subjectId:''});}else{setRememberedChoice(!!subject);setEditPerson(false);} setLinkResult(null); try { sessionStorage.removeItem(`chengzi-analysis:${owner}`); } catch {} scrollToStart(); }
  function onStatus(value: Json) { setStatus(value); }
  async function execute(currentTask: UploadTask) {
    setBusy(true); setError(""); controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    try {
      const completed = await runUpload(currentTask, value=>{if(!abort.signal.aborted)onStatus(value);}, abort.signal);
      if (abort.signal.aborted) return;
      if (completed.status === "awaiting_review") { setStatus(completed); return; }
      const savedResult = { ...completed.result, ...(currentTask.parameters.captureOrigin ? {captureOrigin:true} : {}), ...(currentTask.mode === "chat" ? {selfSide:currentTask.parameters.selfSide} : {}), subjectId: currentTask.parameters.subjectId || null, targetSelf: currentTask.parameters.target === "self", totalCount: completed.totalCount || completed.result?.totalCount || (currentTask.parameters.previousCount || 0) + currentTask.files.length };
      if (currentTask.parameters.subjectId && currentTask.parameters.target !== "self") rememberIntakePreference(currentTask.owner, currentTask.mode, {subjectId:currentTask.parameters.subjectId, ...(currentTask.mode === "chat" ? {selfSide:currentTask.parameters.selfSide} : {sameCity:currentTask.parameters.knownContext?.sameCity===true})});
      const savedId = savedResult.reportId || savedResult.entries?.[0]?.id;
      if (savedId) void recordSuccessfulImages({owner:currentTask.owner,subjectId:currentTask.parameters.subjectId || "",mode:currentTask.mode,targetSelf:currentTask.parameters.target === "self",selfSide:savedResult.selfSide},currentTask.files,{status:completed.status,reportId:savedId,partial:completed.partial === true || savedResult.partial === true || savedResult.decision?.partial === true || (Array.isArray(savedResult.entries) && savedResult.entries.some((entry:Json)=>entry.partial===true || entry.decision?.partial===true || entry.incomplete===true)),incomplete:savedResult.incomplete === true});
      if (savedId) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('reportId', savedId); nextUrl.searchParams.set('mode', currentTask.mode);
        nextUrl.searchParams.delete('new'); nextUrl.searchParams.delete('capture'); nextUrl.hash = 'analysis-result';
        window.history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
        setLastReport({ id: savedId, kind: currentTask.mode });
      }
      try { sessionStorage.setItem(`chengzi-analysis:${currentTask.owner}`, JSON.stringify({ mode: currentTask.mode, result: savedResult })); } catch {}
      setTask(null); setFiles([]); setPrevious(null); setPreviousCount(0); setConsent(false);
      const capture = currentTask.parameters.captureSource;
      if (savedId && capture?.libraryId && Array.isArray(capture.sourceIds)) {
        const linkKey = `chengzi-capture:${currentTask.owner}:link:${savedId}`;
        try { sessionStorage.setItem(linkKey, JSON.stringify(capture)); } catch {}
        try {
          const synced=await linkReportSources(currentTask.owner, savedId, capture);
          if(synced.cloudError&&!abort.signal.aborted)setError(synced.cloudError);
          try { sessionStorage.removeItem(linkKey); sessionStorage.removeItem(`chengzi-capture:${currentTask.owner}:handoff`); } catch {}
        } catch {
          if (!abort.signal.aborted) setError("报告已保存并可正常阅读。本机原文暂未关联成功，刷新本页可重试关联，无需再次分析。");
        }
      }
      if (abort.signal.aborted) return;
      setResult(savedResult); setResultSources(currentTask.files);
      void account.refresh();
      setTimeout(() => { if (abort.signal.aborted) return; resultRef.current?.focus({ preventScroll: true }); resultRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }); }, 100);
    } catch (e) {
      if (abort.signal.aborted) return;
      setError(message(e));
      if ((e as WebError).details?.terminal) {
        setTask(null);
        const partial = (e as WebError).details?.partialResult;
        if (partial?.entries?.length) { setResult({ ...partial, subjectId: currentTask.parameters.subjectId || null, targetSelf: currentTask.parameters.target === "self", incomplete: true, totalCount: currentTask.files.length }); setResultSources(currentTask.files); }
        void account.refresh();
      }
    } finally { if (!abort.signal.aborted) setBusy(false); }
  }
  async function submit() { if (busy || !owner) return; if (task) { await execute(task); return; } if (!hasPrice(account.account, costKey)) { setError("本次价格暂未取回，请重新读取价格后再开始。"); return; } if (!history.ready || history.checking) { setError("正在核对重复材料，请稍等。"); return; } if (!effectiveFiles.length) { setError(files.length ? "这些截图已有报告，可以直接回看，或选择重新分析。" : "先选择至少一张截图。"); return; } if (mode === "chat" && !["left", "right"].includes(side)) { setError("请确认截图里哪侧气泡是你。"); return; } if (!consent) { setError("请确认材料提供权与本次处理范围。"); return; } setBusy(true); setError(""); const activeGeneration = generation.current; try { if (mode === "chat") await api("/api/web/settings", { consent: true, allowImageProcessing: true, selfSide: side }); if (activeGeneration !== generation.current) return; const next: UploadTask = { owner, returnTo, taskId: crypto.randomUUID(), path: mode === "chat" ? "/api/web/screenshot/batch" : "/api/web/social-profile", mode, files:effectiveFiles, expiresAt: Date.now() + 86_400_000, parameters: { confirmed: true, ...(captureSource?{captureOrigin:true,captureSource:{libraryId:captureSource.libraryId,sourceIds:effectiveFiles.map(file=>captureFiles.current.get(file)).filter(Boolean)}}:{}), ...(mode === "chat" ? { reviewOnDoubt:true, selfSide: side, sessionId: crypto.randomUUID(), subjectId: subject || null } : { materialType: mode === "moments" ? "moments" : "profile", knownContext: {sameCity: !targetSelf && sameCity}, target: targetSelf ? "self" : "other", compareWithSelf: !targetSelf && compare, subjectId: targetSelf ? null : subject || null, previous: previous ? { ...previous, fit: !targetSelf && compare ? previous.fit : [] } : null, previousCount }) } }; await uploadStore(owner, next); if (activeGeneration !== generation.current) return; void draft.discard(); setFiles(next.files); setTask(next); await execute(next); } catch (e) { if(activeGeneration===generation.current){setError(message(e)); setBusy(false);} } }
  async function reviewIdentity(currentTask: UploadTask,signal:AbortSignal) {
    const identity=await api("/api/account/credits",undefined,signal);
    if(identity.account?.userId!==currentTask.owner)throw new WebError("登录账号已变化，请回到原账号继续。",401);
  }
  async function confirmReview(recognition:Recognition) {
    if(!task || busy || reviewBusy || status?.status!=="awaiting_review")return;
    const currentTask=task,activeGeneration=generation.current,abort=new AbortController();
    reviewController.current?.abort();reviewController.current=abort;setReviewBusy(true);setError("");
    try {
      await reviewIdentity(currentTask,abort.signal);
      if(activeGeneration!==generation.current || abort.signal.aborted)return;
      await api(currentTask.path,{taskId:currentTask.taskId,reviewAction:"confirm",confirmed:true,index:recognition.index,requestId:recognition.requestId,revision:recognition.revision,selfSide:recognition.selfSide,lines:recognition.lines},abort.signal);
      if(activeGeneration!==generation.current || abort.signal.aborted)return;
      setReviewBusy(false);await execute(currentTask);
    } catch(cause) {
      if(activeGeneration!==generation.current||abort.signal.aborted)return;
      setError(message(cause));
      // The server may have accepted confirmation before the response was lost.
      // Read the same task before offering any retry; never create another job.
      try {
        const fresh=await api(currentTask.path+"?taskId="+encodeURIComponent(currentTask.taskId),undefined,abort.signal);
        if(activeGeneration!==generation.current||abort.signal.aborted)return;
        setStatus(fresh);
        if(fresh.status!=="awaiting_review"){setReviewBusy(false);await execute(currentTask);}
      }catch{/* Keep the review and a visible same-task recovery action. */}
    }
    finally {if(activeGeneration===generation.current&&!abort.signal.aborted)setReviewBusy(false);}
  }
  async function cancel() {
    if(!task || busy || reviewBusy)return;
    const currentTask=task,activeGeneration=generation.current,abort=new AbortController(),review=status?.status==="awaiting_review";
    reviewController.current?.abort();reviewController.current=abort;setReviewBusy(true);setError("");
    try {
      await reviewIdentity(currentTask,abort.signal);
      if(activeGeneration!==generation.current || abort.signal.aborted)return;
      try {await api(currentTask.path,{taskId:currentTask.taskId,...(review?{reviewAction:"cancel"}:{uploadAction:"cancel"})},abort.signal);} catch(cause) {if(![404,410].includes((cause as WebError).status))throw cause;}
      const partial=review?await api(currentTask.path+"?taskId="+encodeURIComponent(currentTask.taskId),undefined,abort.signal).then(value=>value.partialResult).catch(()=>status?.partialResult):null;
      await uploadStore(currentTask.owner,null);
      if(activeGeneration!==generation.current || abort.signal.aborted)return;
      setTask(null);setStatus(null);setConsent(false);
      if(partial?.entries?.length){setResult({...partial,subjectId:currentTask.parameters.subjectId||null,selfSide:currentTask.parameters.selfSide,incomplete:true,totalCount:currentTask.files.length});setResultSources(currentTask.files);setFiles([]);}
      void account.refresh();
    }catch(cause){if(activeGeneration===generation.current&&!abort.signal.aborted)setError(message(cause));}
    finally{if(activeGeneration===generation.current&&!abort.signal.aborted)setReviewBusy(false);}
  }
  async function analyzeLink() { if (busy || !owner) return; if (!linkConsent) { setError("请确认读取公开主页并建立人物档案。"); return; } const activeGeneration = generation.current; setBusy(true); setError(""); try { linkId.current ||= crypto.randomUUID(); const data = await api("/api/web/social-link", { url: url.trim(), confirmed: true, requestId: linkId.current }); if (activeGeneration !== generation.current) return; setLinkResult(data); setSubject(data.subjectId || ""); linkId.current = null; void account.refresh(); } catch (e) { if(activeGeneration===generation.current){setError(message(e)); if ((e as WebError).details?.code === "CREDIT_RELEASED") linkId.current = null;} } finally { if(activeGeneration===generation.current)setBusy(false); } }
  function continueBatch() { if (!result || disabled) return; setPrevious(socialPrevious(result)); setPreviousCount(result.totalCount || 0); setResult(null); setResultSources([]); setConsent(false); window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }
  const visibleResult = owner && owner === restoredOwner ? result : null; const reports: Json[] = visibleResult?.entries || [], combined = mergeChatReports(reports);

  const selectedMode = analysisModes.find(item => item.key === mode) || analysisModes[0];
  const selectedPurpose = mode === "chat" ? analysisPurposes.find(item => item.key === purpose) : undefined;
  const hasMaterials = files.length > 0 || !!task || !!visibleResult;
  const currentStep = visibleResult || task || busy ? 3 : confirmStage ? 2 : 1;
  const balance = account.account?.account?.balance;
  const priceReady = hasPrice(account.account, costKey);
  const needsCredits = priceReady && typeof balance === "number" && balance < account.account!.prices[costKey];
  const selectedPerson = account.people.find(person => person.id === subject);
  const resultSubject = visibleResult?.subjectId || combined?.subjectId;
  const resultCount = visibleResult?.totalCount || reports.length;
  const startLabel = purpose === "affinity" && mode === "chat" ? "开始好感探测" : purpose === "reply" && mode === "chat" ? "生成回复建议" : purpose === "intent" && mode === "chat" ? "解读每句意图" : mode === "chat" ? "生成截图报告" : mode === "moments" ? "生成朋友圈报告" : "生成主页报告";
  const confirmHint = !effectiveFiles.length && files.length ? "这些截图已有报告，可返回材料页直接查看。" : mode === "chat" && !side ? "先选一下：截图里哪侧是你？" : !priceReady ? "费用暂未加载，请重试。" : history.checking || !history.ready ? "正在核对已分析过的截图…" : !consent ? "勾选材料授权后，即可开始。" : needsCredits ? "积分不足，充值后即可继续。" : "";
  const steps = [
    { label: "选择截图", detail: files.length ? files.length + " 张已选择" : "", Icon: CloudUpload },
    { label: "确认费用", detail: "", Icon: FileCheck2 },
    { label: visibleResult?.incomplete ? "部分结果" : "查看结果", detail: "", Icon: Sparkles },
  ];

  return <>
    <WebNav guideReady={!!owner && !account.loading}/>
    <FirstUseTour owner={owner} page="analyze" ready={!account.loading && owner === restoredOwner}/>
    <main className={`wa-shell ax-shell ${styles.page}`} data-stage={visibleResult ? "result" : task ? "running" : confirmStage ? "confirm" : "upload"}>
      <AuroraPageHero eyebrow="从材料到判断" title={mode === "chat" ? selectedPurpose?.title || "截图分析" : mode === "moments" ? "朋友圈分析" : "社交主页分析"} description={confirmStage || visibleResult ? undefined : mode === "chat" ? selectedPurpose?.description || "看懂每句意图，知道下一句怎么回。" : selectedMode.description}/>
      {!task && !restoringReport && !confirmStage && (!visibleResult || mode==="chat") && <div className={styles.purposeBar}>
        <button type="button" disabled={disabled} aria-expanded={purposeOptionsOpen} aria-controls="analysis-purpose-options" onClick={()=>setPurposeOptionsOpen(value=>!value)}><SlidersHorizontal size={16}/>更换分析目标</button>
        {!hasMaterials && <button type="button" onClick={()=>setExampleOpen(true)}><FileCheck2 size={16}/>先看一份示例<ArrowRight size={15}/></button>}
      </div>}
      {purposeOptionsOpen && !task && (!visibleResult || mode==="chat") && <section id="analysis-purpose-options" className={styles.purposeOptions} aria-label="更换分析目标">
        <nav aria-label="聊天解读重点">{analysisPurposes.map(item=><button type="button" key={item.key} disabled={disabled || !!visibleResult && mode!=="chat"} aria-pressed={mode==="chat" && purpose===item.key} onClick={()=>choosePurpose(item.key)}>{item.title}{mode==="chat" && purpose===item.key && <Check size={16}/>}</button>)}</nav>
        {!visibleResult && <details><summary>其他材料类型</summary><div aria-label="分析材料">{analysisModes.map(({key,label,Icon})=><button type="button" key={key} disabled={disabled} aria-pressed={mode===key} onClick={()=>{void changeMode(key);setPurposeOptionsOpen(false);}}><Icon size={16}/>{label}</button>)}</div></details>}
        {files.length>0 && <p>已选择的 {files.length} 张截图会保留。</p>}
        {visibleResult && mode==="chat" && <p>切换查看同一份报告的不同部分。</p>}
      </section>}
      {returnTo && <a className={intake.returnLink} href={returnTo}><History size={16}/>{returnTo.startsWith('/archive') ? '返回人物档案与对照' : '返回刚才的报告'}</a>}
      {restoringReport && <p className={styles.resumeBar} role="status"><LoaderCircle size={19} className="ax-spin"/>正在取回已保存的完整报告…</p>}
      {owner && !visibleResult && error && new URLSearchParams(typeof window==='undefined'?'':window.location.search).has('reportId') && <ErrorNotice error={error}/>}
      {account.error && <AccountNotice state={account}/>}
      {pendingAuth && <p role="status" className="wa-muted">正在确认账户，请稍等…</p>}
      {authComplete && owner && !hasMaterials && <p role="status" className="wa-muted">已登录，点击下方选图即可继续。</p>}

      {!restoringReport && <ol className="ax-steps" aria-label="分析进度">
        {steps.map((step, index) => {
          const number = index + 1, isDone = number < currentStep || !!visibleResult;
          return <li key={index} data-state={isDone ? "done" : number === currentStep ? "current" : "next"} aria-current={number === currentStep ? "step" : undefined}>
            <span className="ax-step-icon" aria-hidden="true">{isDone ? <Check size={19}/> : <step.Icon size={19}/>}</span>
            <span><strong><span className="ax-step-number">0{number} · </span>{step.label}</strong>{step.detail && <small>{step.detail}</small>}</span>
          </li>;
        })}
      </ol>}

      {task && !visibleResult && !restoringReport && <LiveAnalysis taskId={task.taskId} status={status} imageCount={task.files.length} previews={previews} busy={busy} reviewBusy={reviewBusy} error={error} onResume={()=>void execute(task)} onCancel={()=>void cancel()} onConfirmReview={recognition=>void confirmReview(recognition)}/>}
      {!visibleResult && !restoringReport && !task && <>
        {owner && !hasMaterials && !targetSelf && selectedPerson && <section className={intake.remembered} aria-label="当前分析人物"><UserRound size={22}/><div><strong>继续了解 {selectedPerson.label}</strong><small>{mode === 'chat' && side ? `${side==='left'?'左侧':'右侧'}是我 · ` : ''}结合这个人物的已有资料</small></div>{editPerson?<PersonSelect people={account.people} value={subject} disabled={disabled} onChange={choosePerson} empty="本次不关联人物"/>:<button type="button" disabled={disabled} onClick={()=>setEditPerson(true)}>换个人</button>}</section>}
        {captureSource && !confirmStage && <p className="wa-status"><CheckCheck size={18}/>已带入采集截图。请核对顺序与身份，分析完成后可回看这些原图。</p>}


        <div className="ax-workspace" data-ready={hasMaterials} id="analysis-workspace" aria-label={selectedMode.label}>
          <div className="ax-main-column">
            <section className="wa-card ax-materials" hidden={confirmStage} id="materials" aria-labelledby="analysis-material-title">
              <div className="ax-section-heading">
                <div><span className="ax-section-number">01 · 添加材料</span><h2 id="analysis-material-title">{selectedMode.upload}</h2></div>
                <span className="ax-count" aria-live="polite">{files.length + previousCount} / 9 张</span>
              </div>
              {previousCount > 0 && <p className="wa-status">继续整理上一批 {previousCount} 张资料，还可补充 {9 - previousCount} 张。</p>}
              {draft.available && !files.length && !task && <section className={intake.partial} aria-label="本机上传草稿"><h3><FolderHeart size={20}/>有一份尚未分析的材料</h3><p>{draft.available.files.length} 张截图和原来顺序已暂存在这台浏览器，24 小时内可恢复。恢复后再由你确认分析。</p><div className="wa-actions"><button type="button" onClick={restoreDraft}>恢复材料</button><button type="button" onClick={()=>void draft.discard()}>丢弃草稿</button></div></section>}
              {!!files.length && !task && draft.state && <p className={intake.hint} role="status">{draft.state}</p>}

              <button type="button" className="ax-dropzone" id="analysis-upload" data-dragging={dragging} data-disabled={disabled} data-has-files={files.length > 0}
                tabIndex={disabled ? -1 : 0}
                aria-label={owner ? "添加分析截图，支持选择文件、拖放或粘贴图片" : "登录后添加分析截图"}
                aria-describedby="analysis-upload-limits" aria-disabled={disabled}
                onClick={() => requestUpload()}
                onDragEnter={event => { event.preventDefault(); if (disabled) return; dragDepth.current++; setDragging(true); }}
                onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
                onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
                onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (!disabled) void selectFiles(event.dataTransfer.files); }}>
                <div className="ax-upload-illustration" aria-hidden="true"><CloudUpload/></div>
                <strong>{dragging ? "松开鼠标，添加截图" : preparing ? "正在整理图片…" : files.length ? "还可以补充截图" : mode === "chat" ? "放入你想看懂的对话" : selectedMode.upload}</strong>
                <span className="ax-upload-action">{preparing ? <LoaderCircle size={18} className="ax-spin"/> : <ImagePlus size={18}/>}<span>{!owner ? "登录并选择截图" : files.length ? "添加截图" : "选择截图"}</span><ArrowRight size={16}/></span>
                <small className="ax-paste-hint"><Clipboard size={14}/>也可以拖入或粘贴 · Ctrl / ⌘ + V</small>
              </button>
              <input ref={fileInputRef} className="ax-file-input" aria-label="选择分析截图" type="file" accept="image/jpeg,image/png" multiple tabIndex={-1} disabled={disabled || !owner} onChange={event => { void selectFiles(event.target.files); event.target.value = ""; }}/>
              <div className={styles.uploadMeta}><p className="ax-upload-limits" id="analysis-upload-limits">JPG / PNG · 最多 9 张 · 每张 {mode === "chat" ? "5" : "12"} MB</p><button type="button" className={styles.otherSources} disabled={disabled} onClick={() => requestUpload(true)}>其他导入方式<ArrowRight size={15}/></button></div>
              {preparing && <p className="ax-preparing" role="status"><LoaderCircle size={17} className="ax-spin"/>正在本机整理图片，请稍等…</p>}
              {materialNote && <p className={intake.notice} role="status"><CheckCheck size={17}/>{materialNote}</p>}

              <details className={styles.photoTips}><summary>选图建议</summary><p>{selectedMode.tip}</p></details>
              {!confirmStage && <ErrorNotice error={error}/>}
              {files.length > 0 && <>
                <div className="ax-material-toolbar"><strong>已选择 {files.length} 张</strong><span>按阅读顺序排列 · 点图片查看原图</span></div>
                {files.length>1&&<div className={intake.quickActions}><button type="button" disabled={disabled} onClick={()=>{setFiles(items=>[...items].reverse());setConsent(false);}}>整组倒序</button><button type="button" disabled={disabled} onClick={()=>{setFiles(items=>[...items].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})));setConsent(false);}}>按文件名排列</button></div>}
                <div className="wa-images ax-images">
                  {files.map((file, index) => <div className="wa-image" key={file.name + "-" + index}>
                    <a href={previews[index]} target="_blank" rel="noreferrer" aria-label={"查看第 " + (index + 1) + " 张截图原图"}><img src={previews[index]} alt={"第 " + (index + 1) + " 张待分析截图"}/><span className="ax-image-number">{index + 1}</span></a>
                    <small title={file.name}>{file.name}</small>
                    {history.repeated.some(row=>row.index===index) && <span className={intake.hint}><CheckCheck size={14}/>已分析{forceReanalyze ? " · 将重新分析" : " · 本次跳过"}</span>}
                    <div className="wa-image-order">
                      <button type="button" aria-label={"第 " + (index + 1) + " 张前移"} disabled={disabled || index === 0} onClick={() => moveImage(index, -1)}><ArrowUp size={14}/>前移</button>
                      <button type="button" aria-label={"第 " + (index + 1) + " 张后移"} disabled={disabled || index === files.length - 1} onClick={() => moveImage(index, 1)}><ArrowDown size={14}/>后移</button>
                    </div>
                    <button type="button" className="wa-image-remove" aria-label={"移除第 " + (index + 1) + " 张"} disabled={disabled} onClick={() => { setFiles(items => items.filter((_, i) => index !== i)); setConsent(false); }}><X size={16}/></button>
                  </div>)}
                </div>

                {history.checking && <p className={intake.hint} role="status">正在核对是否有已分析过的截图…</p>}
                {history.unavailable && <p className={intake.hint}>暂时无法核对历史记录，本次保留全部截图，请核对费用。</p>}
                {history.repeated.length>0 && <section className={intake.partial} aria-label="重复材料"><h3><CheckCheck size={19}/>{files.length-history.repeated.length} 张新材料，{history.repeated.length} 张已分析</h3><p>{forceReanalyze ? "本次会重新分析全部截图，并按全部张数计费。" : "已分析过的截图默认跳过，费用按本次实际提交数量计算。"}</p><div className={intake.quickActions}>{[...new Set(history.repeated.map(row=>row.reportId))].map(id=><a key={id} href={withAnalysisFocus("/report?id="+encodeURIComponent(id),purpose)} target="_blank" rel="noopener noreferrer">回看已有报告<ArrowRight size={14}/></a>)}</div><label className="wa-check"><input type="checkbox" checked={forceReanalyze} onChange={e=>{setForceReanalyze(e.target.checked);setConsent(false);}}/><span>仍要重新分析这些图（按全部张数重新计费）</span></label></section>}
                <button type="button" className="wa-primary ax-next-link" disabled={disabled} onClick={()=>{setConfirmStage(true);requestAnimationFrame(()=>document.getElementById("analysis-confirm")?.scrollIntoView({block:"start",behavior:"smooth"}));}}>下一步 · 确认费用<ArrowRight size={16}/></button>
              </>}
            </section>

            {mode === "social" && !targetSelf && !confirmStage && <section className={styles.linkPanel} aria-labelledby="social-link-title">
              <header><Link2 size={24}/><div><h2 id="social-link-title">也可以粘贴公开主页链接</h2><p>小红书 / 抖音 · 免费读取公开简介</p></div></header>
              <p>链接可提取公开标题与简介，照片和完整动态请上传截图。遇到登录或访问限制，会明确提示。</p>
              <label className="wa-field">公开主页链接<input type="url" value={url} disabled={disabled} placeholder="粘贴 https:// 开头的主页链接" onChange={e=>{setUrl(e.target.value);linkId.current=null;setLinkResult(null);}}/></label>
              <label className="wa-check"><input type="checkbox" checked={linkConsent} disabled={disabled} onChange={e=>setLinkConsent(e.target.checked)}/><span>同意读取公开简介并保存到人物档案。</span></label>
              <button type="button" disabled={disabled || (!!owner && (!url.trim() || !linkConsent))} onClick={()=>{if(!owner)setShowAuth(true);else void analyzeLink();}}><Link2 size={18}/>{owner?'读取公开简介（免费）':'登录后读取公开简介'}<ArrowRight size={17}/></button>
              {linkResult && <div className={styles.linkResult} role="status"><strong>已读取公开简介</strong><p>{linkResult.message}</p>{linkResult.label&&<p>主页：{linkResult.label}</p>}<a href={"/archive?subjectId="+linkResult.subjectId}>查看已提取的资料<ArrowRight size={16}/></a>{linkResult.subjectId&&<PersonAvatarChoice key={linkResult.subjectId} subjectId={linkResult.subjectId} name={linkResult.label||"新人物"} sources={files} autoOpen onSaved={account.refresh}/>}</div>}
            </section>}

            {hasMaterials && confirmStage && <section className="wa-card ax-confirm" id="analysis-confirm" aria-labelledby="analysis-confirm-title">
              <div className={styles.confirmMaterialStrip}><div>{previews.slice(0,4).map((src,index)=><img key={src} src={src} alt={`待分析截图 ${index+1}`}/>)}</div><span>{files.length} 张材料</span><button type="button" disabled={disabled} onClick={()=>setConfirmStage(false)}>返回修改材料</button></div>
              <div className="ax-section-heading"><div><h2 id="analysis-confirm-title">确认后，开始{purpose === "affinity" && mode === "chat" ? "好感探测" : "分析"}</h2></div><FileCheck2 size={23}/></div>
              {mode === "chat" ? <fieldset className={styles.sidePicker} disabled={disabled}>
                <legend>{rememberedChoice && side ? '已记住你在这段聊天中的位置' : '截图中哪侧气泡是你？'}</legend><div role="group" aria-label="选择我的气泡位置">{([['left','左侧是我'],['right','右侧是我']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={side===value} onClick={()=>chooseSide(value)}><span className={styles.sidePreview} data-side={value}><MessageSquare size={24}/><MessageSquare size={24}/></span><strong>{label}</strong>{side===value?<Check size={20}/>:<span className={styles.radio}/>}</button>)}</div>
              </fieldset> : <label className="wa-field">这些资料属于谁？
                <select value={targetSelf ? "self" : "other"} disabled={disabled || previousCount > 0} onChange={e => { resetInterpretation(); setTargetSelf(e.target.value === "self"); setCompare(e.target.value !== "self"); setLinkConsent(false); }}>
                  <option value="other">我正在了解的人</option><option value="self">我自己的资料</option>
                </select>
              </label>}

              {(!targetSelf || mode === "chat") && <details className={styles.personPicker} data-tour="analysis-person">
                <summary><UserRound size={21}/><span>{selectedPerson ? `已关联 ${selectedPerson.label}` : "关联人物档案"}<small>{selectedPerson ? "更换人物或补充背景" : "可选，不影响本次分析"}</small></span><Plus size={18}/></summary>
                <div className="ax-options-body">
                  {selectedPerson && !editPerson ? <div className={intake.quickActions}><strong>{selectedPerson.label}</strong><button type="button" disabled={disabled||previousCount>0} onClick={()=>setEditPerson(true)}>更换人物</button><a href={'/archive?subjectId='+subject}>查看已存资料</a></div> : <><PersonSelect people={account.people} value={subject} disabled={disabled || previousCount > 0} onChange={choosePerson} empty="暂不关联人物（报告仍会保存）"/><InlinePerson avatarSources={files} disabled={disabled || !owner} onCreated={async id => { choosePerson(id); await account.refresh(); }}/></>}

                  {mode !== "chat" && <label className="wa-check"><input type="checkbox" checked={sameCity} disabled={disabled} onChange={e=>{setSameCity(e.target.checked);setConsent(false);rememberIntakePreference(owner || '',mode,{subjectId:subject,sameCity:e.target.checked});}}/><span>已确认我们在同城</span></label>}
                  {mode !== "chat" && <label className="wa-check"><input type="checkbox" checked={compare} disabled={disabled} onChange={e => { setCompare(e.target.checked); setConsent(false); setResult(null); }}/><span>结合我已确认的资料做适配对照</span></label>}

                </div>
              </details>}

              <div className="ax-order-summary" aria-live="polite">
                <div><span>{selectedPurpose?.title || selectedMode.label}</span><strong>{effectiveFiles.length ? effectiveFiles.length + " 张待分析" : files.length ? "截图已有分析" : "等待添加截图"}</strong></div>
                <div><span>{previousCount > 0 ? "本次补图费用" : "本次费用"}</span><strong>{files.length && !effectiveFiles.length ? "0 积分 · 可回看已有报告" : priceLabel(account.account, costKey)}</strong></div>
              </div>
              {owner && !priceReady && <div className={styles.priceRetry} role="status"><span>费用暂未加载</span><button type="button" onClick={() => void account.refresh()}><RotateCcw size={16}/>重试</button></div>}
              {account.account && <p className={styles.balanceLine}>当前可用 {balance} 积分{needsCredits && !task ? " · 余额不足" : ""}<a href="/account#contact">购买 / 开通 <ArrowRight size={14}/></a></p>}
              <label className="wa-check ax-consent"><input type="checkbox" checked={consent} disabled={disabled} onChange={e => { setConsent(e.target.checked); if (error === "请确认材料提供权与本次处理范围。") setError(""); }}/><span>我有权提供以上材料，同意发送至阿里云百炼千问分析。</span></label>
              <details className={styles.photoTips}><summary>材料如何保存与删除？</summary><p>上传图片临时保存在当前浏览器，用于断线续传；任务完成或取消后删除本机临时图片。报告和识别文字保存到分析记录，可由你删除。原截图不归档。</p></details>
              <ErrorNotice error={error}/>


              <div className="wa-actions ax-submit-row">
                <button className="wa-primary ax-submit" disabled={busy || preparing || !owner || !consent || (mode === "chat" && side !== "left" && side !== "right") || (!task && (!effectiveFiles.length || !priceReady || history.checking || !history.ready))} onClick={() => void submit()}>
                  {busy ? <LoaderCircle size={18} className="ax-spin"/> : <ScanLine size={18}/>}
                  {busy ? "正在处理…" : task ? "继续查看上次任务" : !effectiveFiles.length && files.length ? "截图均已分析，可回看报告" : startLabel + " · " + priceLabel(account.account, costKey)}
                  {!busy && <ArrowRight size={17}/>}
                </button>
                {task && !busy && <button onClick={() => void cancel()}>取消未完成上传</button>}
              </div>
              {confirmHint && <p className={styles.confirmHint} role="status">{confirmHint}</p>}
              <p className="ax-submit-note">{task ? "继续使用原任务，不会因重试重复扣费。" : "提交后预留积分，成功后结算；失败释放积分。"}</p>


            </section>}
          </div>


        </div>
        {owner && !hasMaterials && lastReport && <a className={styles.resumeBar} href={`/report?id=${lastReport.id}#report-detail-action`}><History size={21}/><span><strong>继续看上次的报告</strong></span><ArrowRight size={19}/></a>}
      </>}

      <div ref={resultRef} id="analysis-result" className="ax-result" tabIndex={-1}>
        {visibleResult && <>
          <section className="ax-result-heading">
            <span className="ax-result-emblem"><CheckCheck size={25}/></span>
            <div><span className="ax-section-number">{visibleResult.incomplete ? "已生成部分结果" : "本次分析已完成"}</span><h2>{visibleResult.incomplete ? "先查看已完成的内容" : "线索已理清，看看下一步。"}</h2><p>{resultCount ? resultCount + " 张材料 · " : ""}{selectedMode.label}{resultSubject ? " · 已关联人物" : " · 结合实际情况选择行动"}</p></div>
            <button disabled={disabled} onClick={()=>newAnalysis(!!subject)}><Plus size={17}/>{subject?'补充新材料':'开始新分析'}</button>
          </section>
          <div className={styles.savedReportBar}><BookmarkCheck size={21}/><div><strong>{visibleResult.incomplete ? '已完成的内容可在分析记录回看' : visibleResult.reportId || reports[0]?.id ? '完整报告已保存' : '本次分析结果'}</strong><p>{reports.length>1 ? `已将 ${reports.length} 张截图整理为一份报告。` : visibleResult.reportId || reports[0]?.id ? '离开或刷新后，可以从分析记录继续查看。' : '这是更新前的临时结果，可下载摘要留存。'}</p></div><a href="/reports"><History size={17}/>分析记录<ArrowRight size={15}/></a>{(visibleResult.reportId || reports[0]?.id) && <a href={withAnalysisFocus(`/report?id=${visibleResult.reportId || reports[0]?.id}`,purpose)}>打开已保存报告<ArrowRight size={15}/></a>}</div>
          <ErrorNotice error={error}/>
          {(resultSubject || visibleResult.targetSelf) && <section className={styles.resultPerson}><div><UserRound size={21}/><span><strong>{visibleResult.targetSelf ? '我的档案' : account.people.find(person=>person.id===resultSubject)?.label || '已关联人物'}</strong><small>这份分析已关联此人物</small></span></div><div><button type="button" onClick={()=>avatarDialog.current?.showModal()}><ImagePlus size={17}/>设置人物头像</button><a href={visibleResult.targetSelf ? '/archive?tab=self' : '/archive?subjectId='+resultSubject}>查看人物档案<ArrowRight size={15}/></a></div></section>}
          <dialog ref={avatarDialog} className={styles.avatarDialog}><header><div><h2>设置人物头像</h2><p>头像用于区分人物，不影响分析结果。</p></div><button type="button" aria-label="关闭头像设置" onClick={()=>avatarDialog.current?.close()}><X size={20}/></button></header><ArchiveAvatar expanded key={visibleResult.targetSelf ? 'self' : resultSubject} name={visibleResult.targetSelf ? '我的档案' : account.people.find(person=>person.id===resultSubject)?.label || '所选人物'} subjectId={visibleResult.targetSelf ? undefined : resultSubject} disabled={busy} onSaved={async()=>{await account.refresh();avatarDialog.current?.close();}} sources={resultSources} candidates={combined ? reports.flatMap((entry,imageIndex)=>(entry.decision?.avatarCandidates||[]).filter((candidate:Json)=>candidate.side!==side && ['left','right'].includes(candidate.side)).map((candidate:Json)=>({...candidate,imageIndex}))) : visibleResult.avatarCandidates||[]}/></dialog>
          <div id="analysis-report">
            {combined && <>
              {visibleResult.incomplete && <p className="wa-status">本组只完成 {reports.length}/{visibleResult.totalCount} 张，以下不是整组结论。本组预留积分将退回；未完成图片可单独重试。</p>}
              <ChatReport key={owner + ":" + combined.id} initialFocus={purpose} report={{...combined,reportId:visibleResult.reportId || combined.id}} account={account.account} styleReportIds={reports.map(entry => entry.id).slice(-9)}/>
            </>}
            {!combined && <SocialReport key={visibleResult.summary} report={visibleResult} avatarSources={resultSources} account={account.account} subjectId={visibleResult.subjectId || ""} targetSelf={!!visibleResult.targetSelf} onSubjectChange={id => { setResult(value => value ? { ...value, subjectId: id } : value); void account.refresh(); }}/>}
          </div>
          <section className="wa-card ax-result-next">
            <div><span className="ax-section-number">接下来</span><h2>{mode === "chat" ? "有新的互动，再来一起理清。" : "更多材料，可以补充理解。"}</h2><p className="wa-muted">把建议放回真实互动里，观察回应，再决定下一步。</p></div>
            <div className="wa-actions">{!combined && visibleResult.totalCount < 9 && mode !== "chat" && <button onClick={continueBatch}><ImagePlus size={17}/>补充这份资料（新批次另计 {priceLabel(account.account, "profile")}）</button>}{subject && !visibleResult.targetSelf && <button className="wa-primary" disabled={disabled} onClick={()=>newAnalysis(true)}><Plus size={17}/>继续给这个人补充{mode==='chat'?'新聊天':'新材料'}</button>}<button disabled={disabled} onClick={()=>newAnalysis(false)}>{subject?'换个人分析':mode === "chat" ? "分析另一组截图" : "分析另一份资料"}</button></div>
          </section>
        </>}
      </div>
      {sourcePickerOpen && <div className={styles.sourcePickerBackdrop} role="presentation" onMouseDown={() => setSourcePickerOpen(false)}>
        <section className={styles.sourcePicker} role="dialog" aria-modal="true" aria-labelledby="source-picker-title" data-source-picker onMouseDown={event => event.stopPropagation()}>
          <header><div><span className={styles.sourcePickerEyebrow}>添加材料</span><h2 id="source-picker-title">选择材料来源</h2><p>{mode === "chat" ? "可导入完整聊天，也可以先选几张截图。" : mode === "moments" ? "选择朋友圈截图或从电脑采集的动态。" : "选择主页截图，整理后再开始分析。"}</p></div><button type="button" className={styles.sourcePickerClose} aria-label="关闭来源选择" onClick={() => setSourcePickerOpen(false)}><X size={19}/></button></header>
          <div className={styles.sourcePickerOptions}>
            <button type="button" onClick={() => chooseUploadSource("screenshots")}><span className={styles.sourcePickerIcon}><ImagePlus size={21}/></span><span><strong>{mode === "moments" ? "朋友圈截图" : mode === "social" ? "主页截图" : "聊天截图"}</strong><small>从电脑或手机相册选择，也可以直接粘贴</small></span><ArrowRight size={17}/></button>
            {mode !== "social" && <>
              <button type="button" onClick={() => chooseUploadSource("computer")}><span className={styles.sourcePickerIcon}><Monitor size={21}/></span><span><strong>{mode === "moments" ? "电脑采集朋友圈" : "电脑微信"}</strong><small>{mode === "moments" ? "读取电脑微信里的朋友圈动态" : "读取电脑微信里的完整聊天记录"}</small></span><ArrowRight size={17}/></button>
              <button type="button" onClick={() => chooseUploadSource("video")}><span className={styles.sourcePickerIcon}><Video size={21}/></span><span><strong>{mode === "moments" ? "朋友圈录屏" : "聊天录屏"}</strong><small>{mode === "moments" ? "上传手机录屏，自动整理动态内容" : "上传手机录屏，自动整理聊天内容"}</small></span><ArrowRight size={17}/></button>
              {mode === "chat" && <button type="button" onClick={() => chooseUploadSource("file")}><span className={styles.sourcePickerIcon}><FileUp size={21}/></span><span><strong>聊天文件</strong><small>导入已导出的聊天记录文件</small></span><ArrowRight size={17}/></button>}
              <button type="button" onClick={() => chooseUploadSource("library")}><span className={styles.sourcePickerIcon}><Library size={21}/></span><span><strong>{mode === "moments" ? "已导入朋友圈" : "已导入材料"}</strong><small>{mode === "moments" ? "继续使用之前采集的朋友圈内容" : "继续使用之前采集的聊天内容"}</small></span><ArrowRight size={17}/></button>
            </>}
          </div>
          <p className={styles.sourcePickerNote}><ShieldCheck size={15}/>你可以先选择来源，再核对材料、人物和费用，确认后才会开始分析。</p>
        </section>
      </div>}
    </main>
    {exampleOpen && <dialog ref={exampleDialog} className={styles.exampleDialog} aria-labelledby="analysis-example-title" onClose={()=>setExampleOpen(false)} onClick={event=>{if(event.target===event.currentTarget)exampleDialog.current?.close();}}><header><h2 id="analysis-example-title">{selectedMode.label} · 示例报告</h2><button type="button" aria-label="关闭示例" onClick={()=>exampleDialog.current?.close()}><X size={20}/></button></header><AnalysisExample mode={mode as "chat" | "moments" | "social"} onUpload={()=>{exampleDialog.current?.close();requestUpload();}}/></dialog>}
    <AnalysisAuthGate open={showAuth} onClose={() => setShowAuth(false)} returnTo={withAnalysisFocus(intakeHref('/analyze',{mode,subjectId:subject,returnTo,targetSelf}), purpose)} contextLabel={selectedPurpose?.title || selectedMode.label} onSuccess={authenticated}/>
  </>;
}
