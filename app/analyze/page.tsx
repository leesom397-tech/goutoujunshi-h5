"use client";
import { useEffect, useRef, useState } from "react";
import { ScanLine, Link2, MessageSquare, Images, UserRound, Sparkles, Coins, ArrowRight, ArrowUp, ArrowDown, Check, CheckCheck, Clipboard, CloudUpload, FileCheck2, FolderHeart, ImagePlus, LoaderCircle, Plus, RotateCcw, ShieldCheck, SlidersHorizontal, History, BookmarkCheck, X } from "lucide-react";
import { AnalysisIllustration } from "@/components/web-analysis/Visuals";
import { WebNav } from "@/components/WebNav";
import { AnalysisAuthGate } from "@/components/AnalysisAuthGate";
import { AnalysisExample } from "@/components/web-analysis/AnalysisExample";
import ui from "@/components/AuroraUI.module.css";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import { AccountNotice, ErrorNotice, PersonSelect, InlinePerson, api, message, priceLabel, hasPrice, useAccount, type Json, WebError } from "@/components/web-analysis/client";
import { runUpload, uploadStore, type UploadTask } from "@/components/web-analysis/uploads";
import { ArchiveAvatar } from "@/components/ArchiveAvatar";
import { ChatReport, SocialReport } from "@/components/web-analysis/ReportView";
import { prepareSocialImage } from "@/components/web-analysis/image-normalize";
import { mergeChatReports, socialPrevious } from "@/components/web-analysis/report-data";
import "@/components/web-analysis/web-analysis.css";
import "./analyze-experience.css";
import styles from "./analyze.module.css";

const analysisModes = [
  { key: "chat", label: "聊天截图", intent: "读懂这轮互动", description: "看情绪与回应，找到适合你的下一句。", upload: "上传双方聊天截图", tip: "截取完整对话，保留前后语境；按聊天的阅读顺序排列。", Icon: MessageSquare },
  { key: "moments", label: "朋友圈", intent: "发现相处线索", description: "从日常表达中，了解兴趣、节奏与边界。", upload: "上传朋友圈整页截图", tip: "九宫格保留整页即可，带上文字和日期更容易理解语境。", Icon: Images },
  { key: "social", label: "社交主页", intent: "更有依据地了解对方", description: "整理资料与照片，区分已知事实和待验证判断。", upload: "上传简介与社交主页截图", tip: "优先选择清晰的简介和近期动态；资料越完整，判断越有依据。", Icon: UserRound },
];

export default function AnalyzePage() {
  const account = useAccount(), [mode, setMode] = useState("chat"), [files, setFiles] = useState<File[]>([]), [previews, setPreviews] = useState<string[]>([]), [side, setSide] = useState(""), [subject, setSubject] = useState(""), [targetSelf, setTargetSelf] = useState(false), [compare, setCompare] = useState(true), [consent, setConsent] = useState(false), [linkConsent, setLinkConsent] = useState(false), [busy, setBusy] = useState(false), [preparing, setPreparing] = useState(false), [task, setTask] = useState<UploadTask | null>(null), [status, setStatus] = useState<Json | null>(null), [result, setResult] = useState<Json | null>(null), [error, setError] = useState(""), [url, setUrl] = useState(""), [linkResult, setLinkResult] = useState<Json | null>(null), [previous, setPrevious] = useState<Json | null>(null), [previousCount, setPreviousCount] = useState(0), [resultSources, setResultSources] = useState<File[]>([]), [restoredOwner, setRestoredOwner] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null), generation = useRef(0), preparingRef = useRef(false), owner = account.account?.account?.userId, linkId = useRef<string | null>(null), resultRef = useRef<HTMLDivElement>(null), fileInputRef = useRef<HTMLInputElement>(null), dragDepth = useRef(0);
  const avatarDialog = useRef<HTMLDialogElement>(null);
  const [lastReport, setLastReport] = useState<Json | null>(null);
  const [restoringReport, setRestoringReport] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { if(!busy)return; const timer=setInterval(()=>setClock(Date.now()),1000); return ()=>clearInterval(timer); }, [busy]);
  const [showAuth, setShowAuth] = useState(false), [pendingAuth, setPendingAuth] = useState(false), [authComplete, setAuthComplete] = useState(false);
  useEffect(() => { const search = new URLSearchParams(window.location.search); const selected = search.get("mode") || search.get("kind"); if (["chat", "social", "moments", "profile"].includes(selected || "")) setMode(selected === "profile" ? "social" : selected!); setSubject(search.get("subjectId") || ""); setTargetSelf(search.get("target") === "self"); return () => { generation.current++; controller.current?.abort(); }; }, []);
  useEffect(() => { const next = files.map(file => URL.createObjectURL(file)); setPreviews(next); return () => next.forEach(URL.revokeObjectURL); }, [files]);
  useEffect(() => {
    generation.current++; controller.current?.abort(); setBusy(false); preparingRef.current=false; setPreparing(false); setPrevious(null); setPreviousCount(0); setConsent(false); setLinkConsent(false); setUrl(''); setLinkResult(null); setTask(null); setResult(null); setResultSources([]); setFiles([]); setStatus(null); setLastReport(null); setRestoringReport(false); setRestoredOwner(owner||null);
    if(!owner)return; let current=true;
    const query=new URLSearchParams(window.location.search),savedId=query.get('reportId');
    void api('/api/web/report/list?page=1&pageSize=1').then(value=>{if(current)setLastReport(value.reports?.[0]||null);}).catch(()=>{});
    if(savedId){
      setRestoringReport(true);
      void api('/api/web/report?id='+encodeURIComponent(savedId)).then(value=>{
        if(!current)return; const restored={...value.report,...(value.kind==='chat'||value.report?.lines ? {entries:Array.isArray(value.entries)?value.entries:[value.report]} : {}),reportId:value.reportId||savedId,subjectId:value.subjectId||value.report?.subjectId||null,targetSelf:value.targetSelf??value.report?.targetSelf,totalCount:value.totalCount||value.report?.totalCount,selfSide:value.selfSide||value.report?.selfSide};
        setResult(restored);setMode(value.kind==='moments'?'moments':value.kind==='social'?'social':'chat');setSubject(restored.subjectId||'');setTargetSelf(!!restored.targetSelf);setSide(restored.selfSide||'');
      }).catch(e=>{if(current)setError(message(e));}).finally(()=>{if(current)setRestoringReport(false);});
    } else void uploadStore(owner).then(saved=>{
      if(!current)return;
      if(!saved){try{if(['mode','kind','subjectId','target','new'].some(key=>query.has(key)))return;const stored=JSON.parse(sessionStorage.getItem(`chengzi-analysis:${owner}`)||'null');if(stored?.result){setResult(stored.result);setMode(stored.mode);setSubject(stored.result.subjectId||'');setTargetSelf(!!stored.result.targetSelf);}}catch{}return;}
      setTask(saved);setMode(saved.mode);setFiles(saved.files);setSubject(saved.parameters.subjectId||'');setSide(saved.parameters.selfSide||'');setTargetSelf(saved.parameters.target==='self');setCompare(saved.parameters.compareWithSelf===true);setPrevious(saved.parameters.previous||null);setPreviousCount(saved.parameters.previousCount||0);setStatus({status:'saved'});
    }).catch(e=>{if(current)setError(message(e));});
    return()=>{current=false;};
  },[owner]);
  const costKey = mode === "chat" ? files.length <= 3 ? "analysisSmall" : files.length <= 6 ? "analysisMedium" : "analysisLarge" : "profile";
  const disabled = busy || preparing || !!task;
  async function changeMode(next: string) {
    if (disabled || preparingRef.current || next === mode) return;
    const current = generation.current;
    if (next !== "chat" && mode === "chat" && files.length) {
      preparingRef.current = true; setPreparing(true); setError("");
      try {
        const prepared: File[] = [];
        for (const file of files) { prepared.push(await prepareSocialImage(file)); if (current !== generation.current) return; }
        setFiles(prepared);
      } catch (e) { if (current === generation.current) setError(message(e)); return; }
      finally { if (current === generation.current) { preparingRef.current = false; setPreparing(false); } }
    }
    if (current !== generation.current) return;
    const modeUrl = new URL(window.location.href); modeUrl.searchParams.set("mode", next); window.history.replaceState(null, "", modeUrl.pathname + modeUrl.search + modeUrl.hash);
    setMode(next); setResult(null); setResultSources([]); setPrevious(null); setPreviousCount(0); setConsent(false); setError(""); setStatus(null); setLinkResult(null); setLinkConsent(false);
  }
  function resetMaterials() { setFiles([]); setResult(null); setResultSources([]); setPrevious(null); setPreviousCount(0); setConsent(false); setStatus(null); setError(""); }
  function resetInterpretation() { setResult(null); setResultSources([]); setPrevious(null); setPreviousCount(0); setConsent(false); setStatus(null); setError(""); }
  function moveImage(index: number, direction: number) { if (disabled || index + direction < 0 || index + direction >= files.length) return; setFiles(current => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; }); setConsent(false); }
  function requestUpload() {
    if (disabled) return;
    if (!owner && account.loading) { setPendingAuth(true); return; }
    if (!owner) { setShowAuth(true); return; }
    fileInputRef.current?.click();
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
    const additions = [...list], current = generation.current;
    if (!additions.length) return;
    if (!owner) { requestUpload(); return; }
    if (files.length + additions.length + previousCount > 9) { setError(`每组最多 9 张，还能添加 ${Math.max(0, 9 - files.length - previousCount)} 张。`); return; }
    const maximum = mode === "chat" ? 5_000_000 : 12_000_000;
    if (additions.some(file => !["image/jpeg", "image/png"].includes(file.type) || !file.size || file.size > maximum)) { setError(`请选择每张 ${mode === "chat" ? 5 : 12} MB 内的有效 JPG 或 PNG 图片。`); return; }
    preparingRef.current = true; setPreparing(true); setError("");
    try {
      const prepared: File[] = [];
      for (const file of additions) { prepared.push(mode === "chat" ? file : await prepareSocialImage(file)); if (current !== generation.current) return; }
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
  function newAnalysis() { if (disabled) return; const nextUrl=new URL(window.location.href);nextUrl.searchParams.delete('reportId');nextUrl.searchParams.set('new','1');nextUrl.hash='';window.history.replaceState(null,'',nextUrl.pathname+nextUrl.search); resetMaterials(); setSubject(""); setSide(""); setLinkResult(null); try { sessionStorage.removeItem(`chengzi-analysis:${owner}`); } catch {} scrollToStart(); }
  function onStatus(value: Json) { setStatus(value); }
  async function execute(currentTask: UploadTask) { setBusy(true); setError(""); controller.current?.abort(); const abort = new AbortController(); controller.current = abort; try { const completed = await runUpload(currentTask, onStatus, abort.signal); if (abort.signal.aborted) return; const savedResult = { ...completed.result, subjectId: currentTask.parameters.subjectId || null, targetSelf: currentTask.parameters.target === "self", totalCount: completed.totalCount || completed.result?.totalCount || (currentTask.parameters.previousCount || 0) + currentTask.files.length }; setResult(savedResult); setResultSources(currentTask.files); const savedId=savedResult.reportId || savedResult.entries?.[0]?.id; if(savedId){const nextUrl=new URL(window.location.href);nextUrl.searchParams.set('reportId',savedId);nextUrl.searchParams.set('mode',currentTask.mode);nextUrl.searchParams.delete('new');nextUrl.hash='analysis-result';window.history.replaceState(null,'',nextUrl.pathname+nextUrl.search+nextUrl.hash);setLastReport({id:savedId,kind:currentTask.mode});} try { sessionStorage.setItem(`chengzi-analysis:${currentTask.owner}`, JSON.stringify({ mode: currentTask.mode, result: savedResult })); } catch {} setTask(null); setFiles([]); setPrevious(null); setPreviousCount(0); setConsent(false); void account.refresh(); setTimeout(() => { resultRef.current?.focus({ preventScroll: true }); resultRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }); }, 100); } catch (e) { if (abort.signal.aborted) return; setError(message(e)); if ((e as WebError).details?.terminal) { setTask(null); const partial = (e as WebError).details?.partialResult; if (partial?.entries?.length) { setResult({ ...partial, subjectId: currentTask.parameters.subjectId || null, targetSelf: currentTask.parameters.target === "self", incomplete: true, totalCount: currentTask.files.length }); setResultSources(currentTask.files); } void account.refresh(); } } finally { if (!abort.signal.aborted) setBusy(false); } }
  async function submit() { if (busy || !owner) return; if (task) { await execute(task); return; } if (!hasPrice(account.account, costKey)) { setError("本次价格暂未取回，请重新读取价格后再开始。"); return; } if (!files.length) { setError("先选择至少一张截图。"); return; } if (mode === "chat" && !["left", "right"].includes(side)) { setError("请确认截图里哪侧气泡是你。"); return; } if (!consent) { setError("请确认材料提供权与本次处理范围。"); return; } setBusy(true); setError(""); const activeGeneration = generation.current; try { if (mode === "chat") await api("/api/web/settings", { consent: true, allowImageProcessing: true, selfSide: side }); if (activeGeneration !== generation.current) return; const next: UploadTask = { owner, taskId: crypto.randomUUID(), path: mode === "chat" ? "/api/web/screenshot/batch" : "/api/web/social-profile", mode, files, expiresAt: Date.now() + 86_400_000, parameters: { confirmed: true, ...(mode === "chat" ? { selfSide: side, sessionId: crypto.randomUUID(), subjectId: subject || null } : { materialType: mode === "moments" ? "moments" : "profile", target: targetSelf ? "self" : "other", compareWithSelf: !targetSelf && compare, subjectId: targetSelf ? null : subject || null, previous: previous ? { ...previous, fit: !targetSelf && compare ? previous.fit : [] } : null, previousCount }) } }; await uploadStore(owner, next); if (activeGeneration !== generation.current) return; setTask(next); await execute(next); } catch (e) { setError(message(e)); setBusy(false); } }
  async function cancel() { if (!task || busy) return; setBusy(true); setError(""); try { try { await api(task.path, { taskId: task.taskId, uploadAction: "cancel" }); } catch (e) { if (![404, 410].includes((e as WebError).status)) throw e; } await uploadStore(task.owner, null); setTask(null); setStatus(null); setConsent(false); void account.refresh(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  async function analyzeLink() { if (busy || !owner) return; if (!hasPrice(account.account, "profile")) { setError("主页读取价格暂未取回，请重新读取价格后再开始。"); return; } if (!linkConsent) { setError("请确认读取公开主页并建立人物档案。"); return; } const activeGeneration = generation.current; setBusy(true); setError(""); try { linkId.current ||= crypto.randomUUID(); const data = await api("/api/web/social-link", { url: url.trim(), confirmed: true, requestId: linkId.current }); if (activeGeneration !== generation.current) return; setLinkResult(data); setSubject(data.subjectId || ""); linkId.current = null; void account.refresh(); } catch (e) { setError(message(e)); if ((e as WebError).details?.code === "CREDIT_RELEASED") linkId.current = null; } finally { setBusy(false); } }
  function continueBatch() { if (!result || disabled) return; setPrevious(socialPrevious(result)); setPreviousCount(result.totalCount || 0); setResult(null); setResultSources([]); setConsent(false); window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }
  const total = status?.imageCount || task?.files.length || files.length, completed = status?.status === "uploading" ? status.uploadedCount ?? (Array.isArray(status.received) ? status.received.length : 0) : status?.recognizedCount || status?.completedCount || 0;
  const visibleResult = owner && owner === restoredOwner ? result : null; const reports: Json[] = visibleResult?.entries || [], combined = mergeChatReports(reports);

  const selectedMode = analysisModes.find(item => item.key === mode) || analysisModes[0];
  const hasMaterials = files.length > 0 || !!task || !!visibleResult;
  const currentStep = visibleResult || task || busy ? 3 : files.length ? 2 : 1;
  const balance = account.account?.account?.balance;
  const priceReady = hasPrice(account.account, costKey);
  const needsCredits = priceReady && typeof balance === "number" && balance < account.account!.prices[costKey];
  const selectedPerson = account.people.find(person => person.id === subject);
  const resultSubject = visibleResult?.subjectId || combined?.subjectId;
  const resultCount = visibleResult?.totalCount || reports.length;
  const steps = [
    { label: "添加材料", detail: hasMaterials ? visibleResult ? "材料已处理" : files.length + " 张已选择" : "选择清晰截图", Icon: CloudUpload },
    { label: "确认分析", detail: currentStep > 2 ? "范围已确认" : "身份、费用与授权", Icon: FileCheck2 },
    { label: visibleResult ? visibleResult.incomplete ? "部分结果" : "查看结果" : "获得建议", detail: visibleResult ? "从结论到下一步" : task ? busy ? "正在处理材料" : "可继续上次任务" : "有依据，也有行动", Icon: Sparkles },
  ];

  return <>
    <WebNav/>
    <main className={`wa-shell ax-shell ${styles.page}`}>
      <AuroraPageHero eyebrow="从材料到判断" title={mode === "chat" ? "聊天分析" : mode === "moments" ? "朋友圈分析" : "社交主页分析"} description={selectedMode.description}/>
      {restoringReport && <p className={styles.resumeBar} role="status"><LoaderCircle size={19} className="ax-spin"/>正在取回已保存的完整报告…</p>}
      {owner && !visibleResult && lastReport && !restoringReport && <a className={styles.resumeBar} href={`/report?id=${lastReport.id}#report-detail-action`}><History size={21}/><span><strong>继续看上次的报告</strong><small>之前的分析都在历史报告中</small></span><ArrowRight size={19}/></a>}
      {owner && !visibleResult && error && new URLSearchParams(typeof window==='undefined'?'':window.location.search).has('reportId') && <ErrorNotice error={error}/>}
      {owner && account.error && <AccountNotice state={account}/>}
      {pendingAuth && <p role="status" className="wa-muted">正在确认账户，请稍等…</p>}
      {authComplete && owner && !hasMaterials && <p role="status" className="wa-muted">已登录，点击下方选图即可继续。</p>}

      {hasMaterials && <ol className="ax-steps" aria-label="分析进度">
        {steps.map((step, index) => {
          const number = index + 1, isDone = number < currentStep || !!visibleResult;
          return <li key={index} data-state={isDone ? "done" : number === currentStep ? "current" : "next"} aria-current={number === currentStep ? "step" : undefined}>
            <span className="ax-step-icon" aria-hidden="true">{isDone ? <Check size={19}/> : <step.Icon size={19}/>}</span>
            <span><strong><span className="ax-step-number">0{number} · </span>{step.label}</strong><small>{step.detail}</small></span>
          </li>;
        })}
      </ol>}

      {!visibleResult && !restoringReport && <>
        <div className="ax-mode-heading"><h2>选择分析类型</h2><a href="#analysis-example">先看分析案例 ↓</a></div>
        <div className={`ax-modes ${styles.entryModes}`} role="tablist" aria-label="分析材料" onKeyDown={event => {
          if (disabled || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); const keys = ["chat", "moments", "social"]; const index = keys.indexOf(mode);
          const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : -1) + 3) % 3;
          document.getElementById("analysis-mode-" + keys[next])?.focus(); void changeMode(keys[next]);
        }}>
          {analysisModes.map(({ key, label, intent, description, Icon }) => <button
            role="tab" tabIndex={mode === key ? 0 : -1} aria-selected={mode === key} aria-controls="analysis-workspace" id={"analysis-mode-" + key}
            key={key} disabled={disabled} onClick={() => void changeMode(key)} className="ax-mode">
            <span className="ax-mode-top"><span className="ax-mode-symbol"><Icon size={22}/></span><span className="ax-mode-choice" aria-hidden="true">{mode === key && <Check size={13}/>}</span></span>
            <strong>{label}<span>{intent}</span></strong>
            <small>{description}</small>
          </button>)}
        </div>


        {owner && !priceReady && !task && <section className="wa-card ax-price-warning" role="status">
          <p>本次价格暂未取回。你可以继续整理材料，取回价格后再开始。</p>
          <div className="wa-actions"><button onClick={() => void account.refresh()}><RotateCcw size={16}/>重新读取价格</button><a href="/account">到账户核对</a></div>
        </section>}

        <div className="ax-workspace" data-ready={hasMaterials} id="analysis-workspace" role="tabpanel" aria-labelledby={"analysis-mode-" + mode}>
          <div className="ax-main-column">
            <section className="wa-card ax-materials" aria-labelledby="analysis-material-title">
              <div className="ax-section-heading">
                <div><span className="ax-section-number">01 · 添加材料</span><h2 id="analysis-material-title">{selectedMode.upload}</h2></div>
                <span className="ax-count" aria-live="polite">{files.length + previousCount} / 9 张</span>
              </div>
              {previousCount > 0 && <p className="wa-status">继续整理上一批 {previousCount} 张资料，还可补充 {9 - previousCount} 张。</p>}

              <div className="ax-dropzone" id="analysis-upload" data-dragging={dragging} data-disabled={disabled}
                role="button" tabIndex={disabled ? -1 : 0}
                aria-label={owner ? "添加分析截图，支持选择文件、拖放或粘贴图片" : "登录后添加分析截图"}
                aria-describedby="analysis-upload-limits" aria-disabled={disabled}
                onClick={requestUpload}
                onKeyDown={event => { if (["Enter", " "].includes(event.key) && !disabled) { event.preventDefault(); requestUpload(); } }}
                onDragEnter={event => { event.preventDefault(); if (disabled) return; dragDepth.current++; setDragging(true); }}
                onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
                onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
                onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (!disabled) void selectFiles(event.dataTransfer.files); }}>
                <div className="ax-upload-illustration" aria-hidden="true"><CloudUpload/></div>
                <strong>{dragging ? "松开鼠标，添加截图" : preparing ? "正在整理图片…" : files.length ? "继续添加截图" : "点击上传截图，或拖到这里"}</strong>
                <span className="ax-upload-action">{preparing ? <LoaderCircle size={18} className="ax-spin"/> : <ImagePlus size={18}/>}<span>{!owner ? "登录后上传" : "从相册选择 / 拍照"}</span><ArrowRight size={16}/></span>
                <small className="ax-paste-hint"><Clipboard size={14}/>电脑上可直接粘贴截图 · Ctrl / ⌘ + V</small>
              </div>
              <input ref={fileInputRef} className="ax-file-input" aria-label="选择分析截图" type="file" accept="image/jpeg,image/png" multiple tabIndex={-1} disabled={disabled || !owner} onChange={event => { void selectFiles(event.target.files); event.target.value = ""; }}/>
              <p className="ax-upload-limits" id="analysis-upload-limits">JPG / PNG · 每组最多 9 张 · {mode === "chat" ? "每张不超过 5 MB" : "原图每张不超过 12 MB，大图在本机自动优化"}</p>
              {preparing && <p className="ax-preparing" role="status"><LoaderCircle size={17} className="ax-spin"/>正在本机整理图片，请稍等…</p>}

              <p className="wa-muted ax-upload-tip">{selectedMode.tip}</p>
              {files.length > 0 && <>
                <div className="ax-material-toolbar"><strong>已选择 {files.length} 张</strong><span>按阅读顺序排列 · 点图片查看原图</span></div>
                <div className="wa-images ax-images">
                  {files.map((file, index) => <div className="wa-image" key={file.name + "-" + index}>
                    <a href={previews[index]} target="_blank" rel="noreferrer" aria-label={"查看第 " + (index + 1) + " 张截图原图"}><img src={previews[index]} alt={"第 " + (index + 1) + " 张待分析截图"}/><span className="ax-image-number">{index + 1}</span></a>
                    <small title={file.name}>{file.name}</small>
                    <div className="wa-image-order">
                      <button type="button" aria-label={"第 " + (index + 1) + " 张前移"} disabled={disabled || index === 0} onClick={() => moveImage(index, -1)}><ArrowUp size={14}/>前移</button>
                      <button type="button" aria-label={"第 " + (index + 1) + " 张后移"} disabled={disabled || index === files.length - 1} onClick={() => moveImage(index, 1)}><ArrowDown size={14}/>后移</button>
                    </div>
                    <button type="button" className="wa-image-remove" aria-label={"移除第 " + (index + 1) + " 张"} disabled={disabled} onClick={() => { setFiles(items => items.filter((_, i) => index !== i)); setConsent(false); }}><X size={16}/></button>
                  </div>)}
                </div>
                <a className="ax-next-link" href="#analysis-confirm">下一步，确认分析<ArrowRight size={16}/></a>
              </>}
            </section>

            {hasMaterials && <section className="wa-card ax-confirm" id="analysis-confirm" aria-labelledby="analysis-confirm-title">
              <div className="ax-section-heading"><div><span className="ax-section-number">02 · 确认分析</span><h2 id="analysis-confirm-title">把分析对象和范围说清楚</h2></div><FileCheck2 size={23}/></div>
              {mode === "chat" ? <fieldset className={styles.sidePicker} disabled={disabled}>
                <legend>截图中哪侧气泡是你？</legend><div role="group" aria-label="选择我的气泡位置">{([['left','左侧是我'],['right','右侧是我']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={side===value} onClick={()=>{setSide(value);setConsent(false);setResult(null);}}><span className={styles.sidePreview} data-side={value}><MessageSquare size={24}/><MessageSquare size={24}/></span><strong>{label}</strong>{side===value?<Check size={20}/>:<span className={styles.radio}/>}</button>)}</div><p>{side ? `已确认：${side==='left'?'左侧':'右侧'}是我，${side==='left'?'右侧':'左侧'}是对方。` : '点一下确认，避免把你和对方认反。'}</p>
              </fieldset> : <label className="wa-field">这些资料属于谁？
                <select value={targetSelf ? "self" : "other"} disabled={disabled || previousCount > 0} onChange={e => { resetInterpretation(); setTargetSelf(e.target.value === "self"); setCompare(e.target.value !== "self"); setLinkConsent(false); }}>
                  <option value="other">我正在了解的人</option><option value="self">我自己的资料</option>
                </select>
              </label>}

              {(!targetSelf || mode === "chat") && <section className={styles.personPicker} aria-labelledby="analysis-person-title">
                <header><UserRound size={21}/><div><h3 id="analysis-person-title">这次在分析谁？</h3><p>{selectedPerson ? "已关联「" + selectedPerson.label + "」" : "选好人物，这次报告就能连到之前的互动。"}</p></div><span>可选</span></header>
                <div className="ax-options-body">
                  <PersonSelect people={account.people} value={subject} disabled={disabled || previousCount > 0} onChange={value => { if (mode !== "chat") resetInterpretation(); setSubject(value); setConsent(false); setResult(null); }} empty="暂不关联人物（报告仍会保存）"/>
                  <p className="wa-muted">不关联人物也会保存完整报告；关联后可查看同一人的长期趋势。</p>
                  <InlinePerson disabled={disabled || !owner} onCreated={async id => { setSubject(id); setConsent(false); await account.refresh(); }}/>
                  {mode !== "chat" && <label className="wa-check"><input type="checkbox" checked={compare} disabled={disabled} onChange={e => { setCompare(e.target.checked); setConsent(false); setResult(null); }}/><span>同时与你的已确认档案做适配对照 <a href="/archive?tab=self">完善我的资料</a></span></label>}
                </div>
              </section>}

              <div className="ax-order-summary" aria-live="polite">
                <div><span>{selectedMode.label}</span><strong>{files.length ? files.length + " 张待分析" : task ? "继续已保存的任务" : "等待添加截图"}</strong></div>
                <div><span>{previousCount > 0 ? "本次补图费用" : "本次费用"}</span><strong>{priceLabel(account.account, costKey)}</strong></div>
              </div>
              <label className="wa-check ax-consent"><input type="checkbox" checked={consent} disabled={disabled} onChange={e => { setConsent(e.target.checked); if (error === "请确认材料提供权与本次处理范围。") setError(""); }}/><span>我有权提供这些材料，同意将本次图片发送至阿里云百炼进行分析。上传中的图片会临时保存在当前浏览器以便断线续传，任务完成或取消后删除本机临时图片。</span></label>
              {mode === "chat" && <p className="wa-muted ax-retention"><ShieldCheck size={15}/>报告和识别出的文字长期保存到历史报告，由你决定何时删除。原截图不归档。</p>}
              <ErrorNotice error={error}/>

              {task && <section className="wa-status ax-task" aria-live="polite">
                <div className="ax-task-title">{busy ? <LoaderCircle size={19} className="ax-spin"/> : <RotateCcw size={19}/>}<strong>{status?.status === "uploading" ? "上传中 · " + completed + "/" + total + " 张" : status?.status === "saved" ? "发现上次未完成的任务" : busy ? (status?.retryAt ? "连接恢复中" : status?.phase === "ocr" ? "正在识别聊天原文" : status?.phase === "text_analysis" ? "正在分析语气与互动信号" : status?.phase === "save" ? "正在保存完整报告" : status?.phase === "summarize" ? "正在整理人物评价" : "正在处理截图") + " · 第 " + Math.min(completed + 1, total) + "/" + total + " 张" : "任务已保留，点击继续"}</strong></div>
                <p>{status?.startedAt ? "已用时 " + Math.max(0, Math.floor((clock-status.startedAt)/1000)) + " 秒。" : ""}{status?.retryAt ? "连接暂时不稳定，正在重试，不会重复扣费。" : status?.phase === "text_analysis" ? "原文已识别，正在生成逐句解读与回复建议。" : status?.phase === "save" ? "分析已完成，正在保存。" : status?.phase === "summarize" ? "识别完成，正在整理人物评价。" : "进度已保存，可以离开页面，稍后回来查看。"}</p>
                <progress max={Math.max(1, total)} value={busy && status?.status !== "uploading" ? undefined : Math.min(completed, Math.max(1, total))} aria-label="材料处理进度"/>
                <details><summary>任务详情</summary><small>任务编号：{task.taskId}</small></details>
              </section>}

              <div className="wa-actions ax-submit-row">
                <button className="wa-primary ax-submit" disabled={busy || preparing || !owner || (!task && (!files.length || !priceReady))} onClick={() => void submit()}>
                  {busy ? <LoaderCircle size={18} className="ax-spin"/> : <ScanLine size={18}/>}
                  {busy ? "正在处理…" : task ? "继续查看上次任务" : "开始分析 · " + priceLabel(account.account, costKey)}
                  {!busy && <ArrowRight size={17}/>}
                </button>
                {task && !busy && <button onClick={() => void cancel()}>取消未完成上传</button>}
              </div>
              <p className="ax-submit-note">{task ? "继续使用原任务，不会因重试重复扣费。" : "提交后预留积分，成功后结算；失败释放积分。"}</p>

              {mode !== "chat" && !targetSelf && <details className="ax-link-option">
                <summary><Link2 size={16}/><span>也可以读取小红书 / 抖音公开链接</span></summary>
                <p className="wa-muted">读取公开标题与简介，建立人物档案及待确认线索。需先在人物页启用档案。</p>
                <label className="wa-field">公开主页 HTTPS 链接<input type="url" value={url} disabled={disabled} placeholder="https://…" onChange={e => { setUrl(e.target.value); linkId.current = null; }}/></label>
                <label className="wa-check"><input type="checkbox" checked={linkConsent} disabled={disabled} onChange={e => setLinkConsent(e.target.checked)}/><span>我确认这是公开主页链接，同意读取公开可见文字并建立人物档案。</span></label>
                <button disabled={disabled || !owner || !url.trim() || !linkConsent || !hasPrice(account.account, "profile")} onClick={() => void analyzeLink()}>读取并建立档案 · {priceLabel(account.account, "profile")}</button>
                {linkResult && <p role="status">{linkResult.message} <a href={"/archive?subjectId=" + linkResult.subjectId}>查看 {linkResult.label} 的线索<ArrowRight size={15}/></a></p>}
              </details>}
            </section>}
          </div>

          {hasMaterials && <aside className="ax-aside">
            <section className="wa-card ax-outcome">
              <figure className="wa-feature-visual ax-feature-visual" aria-hidden="true"><img src="/visuals/conversation-daylight.webp" alt=""/><span><Sparkles size={14}/>把线索连成理解</span></figure>
              <span className="ax-section-number">分析之后，你会得到</span>
              <h2>看得懂，也用得上。</h2>
              <div className="ax-outcome-item"><span><MessageSquare size={18}/></span><div><strong>{mode === "chat" ? "读懂当下，知道怎么回" : "了解这个人，从可见事实开始"}</strong><p>{mode === "chat" ? "区分双方的话与情绪，给出带理由的回复方案。" : "整理资料事实、兴趣与边界，给出自然开场和相处建议。"}</p></div></div>
              <div className="ax-outcome-item"><span><ScanLine size={18}/></span><div><strong>每个判断，都能回看依据</strong><p>原话、合理的另一种解释，以及下一步可以观察什么。</p></div></div>
              <div className="ax-outcome-item"><span><FolderHeart size={18}/></span><div><strong>把一次分析，连到长期关系</strong><p>关联人物后持续积累互动，分别理解好感信号与资料适配。</p></div></div>
            </section>

            <section className="wa-card ax-credit-card" aria-label="本次积分">
              <div className="ax-credit-heading"><Coins size={19}/><h2>费用先说清楚</h2></div>
              <strong className="ax-credit-price">{priceLabel(account.account, costKey)}</strong>
              <p>{mode === "chat" ? "1–3 / 4–6 / 7–9 张按组计费" : "每组资料分析，补图新批次另计费"}</p>
              {account.account && <div className="ax-balance"><span>当前可用<strong>{balance} 积分</strong></span><a href="/account#contact">购买 / 开通<ArrowRight size={14}/></a></div>}
              {needsCredits && !task && <p className="ax-credit-warning">当前余额不足，开通积分后再开始分析。</p>}
              <span className="ax-credit-reassurance"><ShieldCheck size={15}/>失败释放本次预留积分</span>
            </section>
          </aside>}
        </div>
        {!hasMaterials && <div id="analysis-example"><AnalysisExample mode={mode as "chat" | "moments" | "social"} onUpload={requestUpload}/></div>}
      </>}

      {status?.preview && !result && <section className="wa-card ax-live-preview"><h2>已识别内容 · 非最终结论</h2><p>{status.preview.summary}</p>{(status.preview.posts || []).map((post: Json, index: number) => <p key={index}>{post.date} · {post.content}</p>)}<p className="wa-muted">这里只展示部分截图内容，完整人物评价在全部材料整理后生成。</p></section>}
      {status?.partialResult?.entries?.length > 0 && !result && <section className="wa-card ax-live-preview"><h2>已完成的部分</h2><p className="wa-muted">以下仅为已识别图片，整组报告仍在生成。</p>{status?.partialResult.entries.map((entry: Json, index: number) => <div className="wa-insight" key={entry.id || index}><strong>第 {index + 1} 张</strong><p>{entry.decision?.judgment || entry.decision?.possibleIntent}</p>{entry.decision?.observation && <p>{entry.decision.observation}</p>}{(entry.lines || []).slice(0, 8).map((line: Json, position: number) => <blockquote className="wa-quote" key={position}>{line.speaker === "self" ? "我" : line.speaker === "other" ? "对方" : "待确认"}：{line.text}</blockquote>)}{entry.id && <a href={"/report?id=" + entry.id}>查看逐句报告</a>}</div>)}</section>}

      <div ref={resultRef} id="analysis-result" className="ax-result" tabIndex={-1}>
        {visibleResult && <>
          <section className="ax-result-heading">
            <span className="ax-result-emblem"><CheckCheck size={25}/></span>
            <div><span className="ax-section-number">{visibleResult.incomplete ? "已生成部分结果" : "本次分析已完成"}</span><h2>{visibleResult.incomplete ? "先查看已完成的内容" : "线索已理清，看看下一步。"}</h2><p>{resultCount ? resultCount + " 张材料 · " : ""}{selectedMode.label}{resultSubject ? " · 已关联人物" : " · 结合实际情况选择行动"}</p></div>
            <button disabled={disabled} onClick={newAnalysis}><Plus size={17}/>开始新分析</button>
          </section>
          <div className={styles.savedReportBar}><BookmarkCheck size={21}/><div><strong>{visibleResult.incomplete ? '已完成的内容可在历史报告回看' : visibleResult.reportId || reports[0]?.id ? '完整报告已保存' : '本次分析结果'}</strong><p>{reports.length>1 ? `已将 ${reports.length} 张截图整理为一份报告。` : visibleResult.reportId || reports[0]?.id ? '离开或刷新后，可以从历史报告继续查看。' : '这是更新前的临时结果，可下载摘要留存。'}</p></div><a href="/reports"><History size={17}/>历史报告<ArrowRight size={15}/></a>{(visibleResult.reportId || reports[0]?.id) && <a href={`/report?id=${visibleResult.reportId || reports[0]?.id}#report-detail-action`}>打开已保存报告<ArrowRight size={15}/></a>}</div>
          <ErrorNotice error={error}/>
          {(resultSubject || visibleResult.targetSelf) && <section className={styles.resultPerson}><div><UserRound size={21}/><span><strong>{visibleResult.targetSelf ? '我的档案' : account.people.find(person=>person.id===resultSubject)?.label || '已关联人物'}</strong><small>这份分析已关联此人物</small></span></div><div><button type="button" onClick={()=>avatarDialog.current?.showModal()}><ImagePlus size={17}/>设置人物头像</button><a href={visibleResult.targetSelf ? '/archive?tab=self' : '/archive?subjectId='+resultSubject}>查看人物档案<ArrowRight size={15}/></a></div></section>}
          <dialog ref={avatarDialog} className={styles.avatarDialog}><header><div><h2>设置人物头像</h2><p>头像用于区分人物，不影响分析结果。</p></div><button type="button" aria-label="关闭头像设置" onClick={()=>avatarDialog.current?.close()}><X size={20}/></button></header><ArchiveAvatar expanded key={visibleResult.targetSelf ? 'self' : resultSubject} name={visibleResult.targetSelf ? '我的档案' : account.people.find(person=>person.id===resultSubject)?.label || '所选人物'} subjectId={visibleResult.targetSelf ? undefined : resultSubject} disabled={busy} onSaved={async()=>{await account.refresh();avatarDialog.current?.close();}} sources={resultSources} candidates={combined ? reports.flatMap((entry,imageIndex)=>(entry.decision?.avatarCandidates||[]).filter((candidate:Json)=>candidate.side!==side && ['left','right'].includes(candidate.side)).map((candidate:Json)=>({...candidate,imageIndex}))) : visibleResult.avatarCandidates||[]}/></dialog>
          <div id="analysis-report">
            {combined && <>
              {visibleResult.incomplete && <p className="wa-status">本组只完成 {reports.length}/{visibleResult.totalCount} 张，以下不是整组结论。本组预留积分将退回；未完成图片可单独重试。</p>}
              <ChatReport key={owner + ":" + combined.id} report={{...combined,reportId:visibleResult.reportId || combined.id}} account={account.account} styleReportIds={reports.map(entry => entry.id).slice(-9)}/>
            </>}
            {!combined && <SocialReport key={visibleResult.summary} report={visibleResult} account={account.account} subjectId={visibleResult.subjectId || ""} targetSelf={!!visibleResult.targetSelf} onSubjectChange={id => { setResult(value => value ? { ...value, subjectId: id } : value); void account.refresh(); }}/>}
          </div>
          <section className="wa-card ax-result-next">
            <div><span className="ax-section-number">接下来</span><h2>{mode === "chat" ? "有新的互动，再来一起理清。" : "更多材料，可以补充理解。"}</h2><p className="wa-muted">把建议放回真实互动里，观察回应，再决定下一步。</p></div>
            <div className="wa-actions">{!combined && visibleResult.totalCount < 9 && mode !== "chat" && <button onClick={continueBatch}><ImagePlus size={17}/>继续补图（新批次另计 {priceLabel(account.account, "profile")}）</button>}<button disabled={disabled} onClick={newAnalysis}><Plus size={17}/>{mode === "chat" ? "分析另一组截图" : "分析另一份资料"}</button></div>
          </section>
        </>}
      </div>
    </main>
    <AnalysisAuthGate open={showAuth} onClose={() => setShowAuth(false)} returnTo={`/analyze?mode=${mode}`} contextLabel={selectedMode.label} onSuccess={authenticated}/>
  </>;
}
