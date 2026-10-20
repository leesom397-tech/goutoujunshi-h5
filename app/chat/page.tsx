"use client";
import { DataProcessingLink } from "@/components/DataProcessingLink";
import { useEffect, useRef, useState } from "react";
import { Mic, Send, Phone, Square, MessageCircle, ScanLine, Compass, Plus, ArrowUpRight, ArrowLeft, Quote, SlidersHorizontal, ShieldCheck, Coins, UserRound, ChevronRight, AudioLines, X, Check } from "lucide-react";
import { AssistantEmblem } from "@/components/web-analysis/Visuals";
import styles from "./chat.module.css";
import { WebNav } from "@/components/WebNav";
import { personAnalysisHref } from "@/lib/person-analysis-navigation";
import { reportReturnHref } from "@/lib/report-return";
import { RELATIONSHIP_ANALYSIS_LABEL } from "@/lib/product-labels";
import { AddMaterials } from "@/components/AddMaterials";
import { AnalysisAuthGate } from "@/components/AnalysisAuthGate";
import { AccountNotice, ErrorNotice, PersonSelect, api, message, priceLabel, hasPrice, useAccount, readLocal, saveLocal, type Json, WebError } from "@/components/web-analysis/client";
import { QuestionReplies } from "@/components/chat/QuestionReplies";
import { AnswerScope } from "@/components/chat/AnswerScope";
import { needsQuestionBackground } from "@/lib/question-intake";
import { openMicrophone, wavBase64, type Microphone } from "@/components/web-analysis/audio";
import { restoreConversation, conversationHistory, fitConversationRequest } from "@/lib/web-conversation-state.mjs";
import { prepareQuestionImage, restoreQuestionImages, type QuestionImage, type ChatSide } from "@/components/chat/question-images";
import { QuestionImagePreview } from "@/components/chat/QuestionImagePreview";
import { readCaptureQuestion, removeCaptureQuestion, captureQuestionHistory, captureQuestionText, type CaptureQuestion } from "@/lib/capture-question-handoff";
import "@/components/web-analysis/web-analysis.css";

const conversationPresets = [
  { id: "signals", title: "看懂 TA 的态度", hint: "把行为和自己的猜测分开", mode: "conversation", draft: "帮我看看下面这段互动里，对方是什么态度？\n", icon: MessageCircle },
  { id: "reply", title: "斟酌一句回复", hint: "自然表达，也照顾自己的边界", mode: "chat", draft: "我想表达的是：", icon: Quote },
  { id: "boundaries", title: "把边界说清楚", hint: "既不委屈自己，也不伤害对方", mode: "conversation", draft: "下面这种情况让我不舒服，怎么表达边界更合适？\n", icon: ShieldCheck },
  { id: "needs", title: "看看适不适合我", hint: "结合你的偏好与现有资料", mode: "positioning", draft: "结合我已有的资料，帮我看看这种相处适不适合我：\n", icon: Compass },
] as const;
export default function ChatPage() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [background,setBackground]=useState(""), [intakeOpen,setIntakeOpen]=useState(false), [skipIntake,setSkipIntake]=useState(false);
  const [opening, setOpening] = useState(""), [intakeQuestions, setIntakeQuestions] = useState<string[]>([]);
  const [captureQuestion, setCaptureQuestion] = useState<CaptureQuestion | null>(null);
  const chatStorage = useRef("");
  const [separateDraft, setSeparateDraft] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const guestDraft = useRef("");
  const requestLogin = () => { guestDraft.current = draft; setShowAuth(true); };
  const [previewImage, setPreviewImage] = useState<QuestionImage | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null), imageRead = useRef(false);
  const [images, setImages] = useState<QuestionImage[]>([]), [selfSide, setSelfSide] = useState<ChatSide>(""), [readingImages, setReadingImages] = useState(false), [dragging, setDragging] = useState(false);
  const account = useAccount(), [messages, setMessages] = useState<Json[]>([]), [draft, setDraft] = useState(""), [other, setOther] = useState(""), [mode, setMode] = useState("conversation"), [subject, setSubject] = useState(""), [consent, setConsent] = useState(false), [saveHistory, setSaveHistory] = useState(false), [context, setContext] = useState<Json | null>(null), [contextKey, setContextKey] = useState(""), [busy, setBusy] = useState(false), [recording, setRecording] = useState(false), [transcribing, setTranscribing] = useState(false), [error, setError] = useState(""), [ready, setReady] = useState(false), [pendingAudio, setPendingAudio] = useState<{audio: string; requestId: string} | null>(null), [restoredOwner, setRestoredOwner] = useState<string | null>(null);
  const owner = account.account?.account?.userId, ownerRef = useRef<string | null>(null), requestId = useRef<string | null>(null), pendingBody = useRef<Json | null>(null), recorder = useRef<Microphone | null>(null), recordingActive = useRef(false), recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null), chunks = useRef<Int16Array[]>([]), end = useRef<HTMLDivElement>(null), mounted = useRef(true), generation = useRef(0), captureGeneration = useRef(0);
  ownerRef.current = owner || null;
  function invalidateRequest() { requestId.current = null; pendingBody.current = null; }
  function discardRecorder() {
    captureGeneration.current++; recordingActive.current = false;
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    recordingTimer.current = null;
    const microphone = recorder.current; recorder.current = null; chunks.current = [];
    void microphone?.close().catch(() => {});
    if (mounted.current) setRecording(false);
  }
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden) discardRecorder(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", discardRecorder);
    return () => { mounted.current = false; generation.current++; discardRecorder(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", discardRecorder); };
  }, []);
  useEffect(() => {
    generation.current++; discardRecorder(); invalidateRequest();
    imageRead.current=false; setImages([]); setSelfSide(""); setReadingImages(false); setDragging(false); setPreviewImage(null);
    setOpening(""); setIntakeQuestions([]);
    setBackground("");setIntakeOpen(false);setSkipIntake(false);setReady(false); setCaptureQuestion(null); setSeparateDraft(false); chatStorage.current=""; setMessages([]); setDraft(""); setOther(""); setSubject(""); setMode("conversation"); setSaveHistory(false); setContext(null); setContextKey(""); setPendingAudio(null); setConsent(false); setBusy(false); setTranscribing(false); setError(""); setRestoredOwner(owner || null);
    if (!owner) return;
    const search = new URLSearchParams(window.location.search), captureKey = search.get("capture") || "";
    const captured = captureKey ? readCaptureQuestion(owner, captureKey) : null;
    const key = captureKey ? `chengzi-chat:${owner}:capture:${captureKey.slice(0,36)}` : `chengzi-chat:${owner}`;
    chatStorage.current=key;
    setSeparateDraft(!!captureKey); setCaptureQuestion(captured);
    const stored = captureKey ? null : readLocal<Json>(key);
    let windowSaved: Json | null = null; try { windowSaved = JSON.parse(sessionStorage.getItem(key) || "null"); } catch {}
    const previous = windowSaved || stored;
    if(captureKey&&!captured&&!previous?.captureRemoved)setError("这段聊天未能带入，请回到导入页重新选择。原来的对话已保留。");
    // A normal return to this conversation keeps its report. Explicit new entries
    // (another person, mode or preset) must not inherit the previous report.
    const resumeReport = !["context", "subjectId", "mode", "preset", "capture"].some(key => search.has(key)) && previous?.owner === owner && typeof previous?.contextKey === "string";
    const handoff = captureKey ? "" : search.get("context") || (resumeReport ? previous?.contextKey : "");
    let report: Json | null = null;
    if (handoff) {
      try {
        report = JSON.parse(sessionStorage.getItem(`web-followup:${handoff}`) || "null");
        if (!report || report.accountId !== owner || typeof report.subjectId !== "string" || typeof report.expiresAt !== "number" || !Number.isFinite(report.expiresAt)) throw new Error();
        // Keep expired metadata so an already submitted request can still be
        // restored under its original person and idempotency key.
        setContext(report);
      }
      catch { report = null; setError("报告追问上下文已过期，请回到报告重新打开。"); }
    }
    const restored = restoreConversation(handoff && !report ? null : previous, owner, { ...(captured ? {subject:captured.subjectId,mode:"conversation"} : report ? { subject: report.subjectId || "", mode: "conversation" } : { ...(search.has("subjectId") ? { subject: search.get("subjectId") || "" } : {}), mode: search.get("mode") }), contextKey: handoff });
    const freshHandoff = report && report.expiresAt > Date.now() && (!previous || previous.owner !== owner || previous.contextKey !== handoff || previous.subject !== (report.subjectId || ""));
    const focusedQuestion = freshHandoff && typeof report?.question === "string" ? report.question.trim().slice(0, 1500) : "";
    if (report && report.expiresAt <= Date.now()) setError(restored.requestBody ? "报告摘要已过期；上次请求已保留，可直接重试取回回答。" : "报告摘要已过期，请回到报告重新打开，或开始新对话。");
    const preset = !captureKey && (!report || freshHandoff) && !restored.requestBody ? conversationPresets.find(item => item.id === search.get("preset")) : undefined;
    setMessages(preset ? [] : restored.messages); setDraft(guestDraft.current || preset?.draft || focusedQuestion || restored.draft); guestDraft.current = ""; setOther(preset ? "" : restored.other); setSubject(restored.subject); setMode(preset?.mode || restored.mode); setContextKey(report ? handoff : ""); setSaveHistory(!!stored); requestId.current = preset ? null : restored.requestId; pendingBody.current = preset ? null : restored.requestBody; setReady(true);
    const imageDraft=!preset&&(restored.requestBody || (previous?.owner===owner&&previous?.subject===restored.subject&&previous?.mode===restored.mode&&previous?.contextKey===restored.contextKey?previous:null));
    if (imageDraft) { setOpening(typeof imageDraft.opening === "string" ? imageDraft.opening.slice(0,1500) : restored.opening); setBackground(typeof imageDraft.background === "string" ? imageDraft.background.slice(0,600) : "");setIntakeOpen(imageDraft.intakeOpen === true);setSkipIntake(imageDraft.skipIntake === true); setIntakeQuestions(Array.isArray(previous?.intakeQuestions) ? previous.intakeQuestions : []); }
    if (imageDraft?.images?.length) { const restoredImages=restoreQuestionImages(imageDraft); if(restoredImages.length===imageDraft.images.length){setImages(restoredImages);setSelfSide(["left","right"].includes(imageDraft.selfSide)?imageDraft.selfSide:"");}else{invalidateRequest();setError("上次截图未完整保留，请重新添加后发送。");} }
    if (preset) { const cleanUrl = new URL(window.location.href); cleanUrl.searchParams.delete("preset"); window.history.replaceState(null, "", cleanUrl.pathname + cleanUrl.search); }
  }, [owner]);
  function snapshot(body = pendingBody.current) { return { owner, messages, draft, other, subject, mode, contextKey, opening, background, intakeOpen, intakeQuestions, skipIntake, captureRemoved:separateDraft&&!captureQuestion, images:body?.images?.length?[]:images.map(image=>image.data),selfSide,requestId: body?.requestId || requestId.current, requestBody: body }; }
  function persist(data: Json) {
    if (!owner || owner !== ownerRef.current || owner !== restoredOwner || !ready) return;
    const key = chatStorage.current || `chengzi-chat:${owner}`;
    try { sessionStorage.setItem(key, JSON.stringify(data)); } catch { try{sessionStorage.removeItem(key);}catch{} if(data.requestBody?.images?.length||data.images?.length)setError("浏览器未能保存本次截图进度，请保留当前页面；失败后可在这里重试。"); }
    // Screenshot payloads stay in this window's pending request, never long-term local history.
    if (saveHistory && !separateDraft) { const historyData={...data,images:[],selfSide:"",...(data.requestBody?.images?.length?{requestBody:null,requestId:null}:{})};if (!saveLocal(key, historyData)) setError("浏览器空间不足，无法保存长期对话记录；当前页面仍可使用。"); }
    else try { localStorage.removeItem(key); } catch {}
  }
  useEffect(() => { persist(snapshot()); }, [owner, restoredOwner, ready, messages, draft, other, subject, mode, contextKey, images, selfSide, saveHistory, busy, separateDraft, captureQuestion, opening, background, intakeOpen, intakeQuestions, skipIntake]);
  useEffect(() => { if (!messages.length && !busy) return; end.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" }); }, [messages.length, busy]);
  function leaveReport(nextSubject = subject, nextMode = mode) { setContext(null); setContextKey(""); const url = new URL(window.location.href); url.searchParams.delete("context"); if (nextSubject) url.searchParams.set("subjectId", nextSubject); else url.searchParams.delete("subjectId"); if (nextMode !== "conversation") url.searchParams.set("mode", nextMode); else url.searchParams.delete("mode"); window.history.replaceState(null, "", url.pathname + url.search); }
  function clearImages(){setImages([]);setSelfSide("");setDragging(false);setPreviewImage(null);}
  function clearCapture(){if(captureQuestion&&owner)removeCaptureQuestion(owner,captureQuestion.key);setCaptureQuestion(null);setConsent(false);invalidateRequest();}
  function changeSubject(next: string) { if (next === subject) return; if ((draft.trim() || other.trim() || images.length || captureQuestion) && !window.confirm("切换人物会开始新对话，并清空未发送内容。是否继续？")) return; generation.current++; discardRecorder(); clearImages(); clearCapture();setOpening("");setBackground("");setIntakeOpen(false);setSkipIntake(false); setSubject(next); setMessages([]); setDraft(""); setOther(""); setPendingAudio(null); leaveReport(next); setConsent(false); invalidateRequest(); }
  function newConversation() { setOpening("");setBackground("");setIntakeOpen(false);setSkipIntake(false); if(separateDraft){window.location.assign("/chat");return;} generation.current++; discardRecorder(); clearImages(); setMessages([]); setDraft(""); setOther(""); setPendingAudio(null); leaveReport(); setConsent(false); setError(""); invalidateRequest(); }
  function changeMode(next: string) {
    if (next === mode) return true;
    if ((images.length || pendingBody.current) && !window.confirm(images.length ? "切换咨询方式会移除已选截图，并开始新对话。是否继续？" : "切换咨询方式会放弃本次重试，并开始新对话。是否继续？")) return false;
    if(captureQuestion&&next!=="conversation"){setError("已带入聊天，直接在下面写你的问题即可；移除材料后可切换咨询方式。");return false;}
    generation.current++; clearImages(); setOpening(""); setBackground(""); setIntakeOpen(false); setSkipIntake(false); setMode(next); setMessages([]); setPendingAudio(null); leaveReport(subject, next); setConsent(false); invalidateRequest(); return true;
  }
  async function addImages(files: File[]) {
    if (files.length && !owner && !account.loading) { requestLogin(); return; }
    if (busy || recording || transcribing || imageRead.current || !owner || !ready) return;
    if (!files.length) return;
    if (files.length + images.length > 3) { setError("一次最多 3 张截图。只选与你的问题有关的部分就好。"); return; }
    const current=generation.current;
    imageRead.current=true;setReadingImages(true);setError("");
    try{const prepared:QuestionImage[]=[];for(const file of files)prepared.push(await prepareQuestionImage(file));if(!mounted.current||current!==generation.current||ownerRef.current!==owner)return;
      setImages(previous=>[...previous,...prepared]);setConsent(false);invalidateRequest();if(mode!=="conversation"){setMode("conversation");leaveReport(subject,"conversation");setDraft(value=>[other.trim(),value].filter(Boolean).join("\n").slice(0,1500));setOther("");}
    }catch(e){if(current===generation.current)setError(message(e));}finally{if(current===generation.current){imageRead.current=false;setReadingImages(false);}}
  }
  function fillPrompt(text: string) {
    if (busy || recording || transcribing || !ready) return;
    if (draft.trim() && draft.trim() !== text.trim() && !window.confirm("用这个场景替换当前未发送的草稿？")) return;
    setDraft(text); invalidateRequest();
    requestAnimationFrame(() => { composer.current?.focus(); composer.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" }); });
  }
  function choosePreset(preset: typeof conversationPresets[number]) {
    if (busy || recording || transcribing || !ready) return;
    if ((draft.trim() || other.trim()) && !window.confirm("用这个场景替换当前未发送的内容？")) return;
    if (!changeMode(images.length?"conversation":preset.mode)) return;
    setOther(""); setDraft(preset.draft); invalidateRequest();
    requestAnimationFrame(() => { composer.current?.focus(); composer.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" }); });
  }
  function prepareRewrite(text: string, tone: string) {
    if (busy || recording || transcribing || !ready || pendingBody.current) return;
    if (draft.trim() && !window.confirm("用改写要求替换当前未发送的草稿？")) return;
    const prompt = `请把下面这句拟回复改得${tone}，保留原意和边界，不增加承诺或新事实。它还没有发送；请只给一句可选回复。\n拟回复：${text}`;
    if (mode !== "conversation") { setMode("conversation"); leaveReport(subject, "conversation"); }
    setDraft(prompt); setOther(""); setError(""); invalidateRequest();
    requestAnimationFrame(() => { composer.current?.focus(); composer.current?.scrollIntoView({ behavior: "smooth", block: "center" }); });
  }
  async function send() {
    if (busy || recording || transcribing || imageRead.current || !owner || !ready || restoredOwner !== owner) return;
    if (!pendingBody.current && !hasPrice(account.account, "text")) { setError("文字咨询价格暂未取回，请刷新账户后重试。"); return; }
    if (!consent) { setError("请确认本次问题和材料的处理范围。"); return; }
    if (intakeOpen && !background.trim() && !skipIntake) { setError("补充一句具体情况，或选择“先按现有信息回答”。"); return; }
    if(images.length&&!selfSide){setError("点选截图中哪侧气泡是你，避免把双方说反。");return;}
    if (mode === "chat" ? other.trim().length < 2 : draft.trim().length < (mode === "positioning" ? 6 : 2)) { setError(mode === "chat" ? "请先填写对方原话。" : "说说你正在经历什么、想弄清楚什么。"); return; }
    const current = generation.current, active = () => mounted.current && current === generation.current && ownerRef.current === owner;
    setBusy(true); setError("");
    try {
      if (context && (context.accountId !== owner || context.subjectId !== subject)) { leaveReport(); invalidateRequest(); throw new Error("追问内容与当前账号或人物不一致，请重新打开报告。"); }
      const retryBody = pendingBody.current?.requestId === requestId.current ? pendingBody.current : null;
      if(captureQuestion && (captureQuestion.owner!==owner || captureQuestion.subjectId!==subject))throw new Error("带入的聊天与当前人物不一致，请重新选择材料。");
      if(!retryBody&&captureQuestion&&captureQuestion.expiresAt<=Date.now())throw new Error("带入的聊天已超过本次使用时间，请返回导入页重新选择。已有问题已保留。");
      if (retryBody && ((retryBody.subjectId || "") !== subject || retryBody.mode !== mode || (retryBody.opening || "") !== opening.trim() || (retryBody.background || "") !== background.trim() || (retryBody.skipIntake === true) !== skipIntake || retryBody.self !== draft.trim() || retryBody.other !== (mode === "chat" ? other.trim() : "") || (retryBody.captureScope || "") !== (captureQuestion?.scope === "full-history" ? "full-history" : "") || JSON.stringify(retryBody.images||[])!==JSON.stringify(images.map(image=>image.data)) || (retryBody.selfSide||"")!==(images.length?selfSide:""))) { invalidateRequest(); throw new Error("输入或人物已变化，请确认后重新发送。"); }
      // Expiry stops new use of a report. A pending request must retain its
      // original body/key so a lost response can be recovered without rebilling.
      if (!retryBody && context && context.expiresAt <= Date.now()) { leaveReport(); invalidateRequest(); throw new Error("报告上下文已过期，请返回报告重新打开。"); }
      requestId.current ||= crypto.randomUUID();
      const historyMessages=messages.map(item=>item.role==="assistant"&&item.evidence?{...item,content:`材料依据：${String(item.evidence).slice(0,250)}\n上次回答：${item.content}`} : item);
      const baseBody={mode,supportsClarification:true,opening:opening.trim(),background:background.trim(),skipIntake,self:draft.trim(),other:mode==="chat"?other.trim():"",subjectId:subject||null,confirmed:true,requestId:requestId.current,...(captureQuestion?.scope === "full-history" ? {captureScope:"full-history"} : {})};
      const recent=conversationHistory(historyMessages,mode==="conversation"?context:null);
      const body = retryBody || { ...fitConversationRequest({ ...baseBody, history: captureQuestion ? captureQuestionHistory(captureQuestion,recent,baseBody) : recent }),...(images.length?{images:images.map(image=>image.data),selfSide}:{}) };
      pendingBody.current = body; persist(snapshot(body));
      const result = await api("/api/web/text", body);
      if (!active()) return;
      if (result.clarification?.kind === "background") { setIntakeQuestions(Array.isArray(result.clarification.questions) ? result.clarification.questions : []);setIntakeOpen(true);setError("");invalidateRequest();requestAnimationFrame(()=>document.getElementById("chat-background")?.focus());return; }
      if (!result.possibleIntent || !result.nextStep) throw new Error("回答未完整返回，请重试。");
      if (body.captureScope === "full-history" && !(Number(result.historyCoverage?.total) > 0)) throw new Error("本次未确认完整聊天资料的覆盖范围，请重试。");
      const content = body.mode === "chat" ? `对方：${body.other}\n我：${body.self}` : `${captureQuestion ? (captureQuestion.scope === "full-history" ? `【已核对与 ${captureQuestion.friend} 的聊天资料库，共 ${result.historyCoverage?.total || 0} 条；本次使用相关摘录】\n` : `【已带入与 ${captureQuestion.friend} 的 ${captureQuestion.records.length} 条聊天】\n`) : ""}${body.images?.length ? `【${body.images.length} 张聊天截图 · ${body.selfSide==="left"?"左":"右"}侧是我】\n` : ""}${body.self}${body.background ? `\n\n补充背景：${body.background}` : ""}`;
      setMessages(previous => [...previous, { id: `${body.requestId}-u`, role: "user", content, rawContent: body.mode === "chat" ? `对方：${body.other}\n我：${body.self}` : body.self }, { id: `${body.requestId}-a`, role: "assistant", content: [result.possibleIntent, result.nextStep].filter(Boolean).join("\n\n"), evidence: result.evidence, replies: result.replies || [], historyCoverage: result.historyCoverage, historyStatus: result.historyStatus, subjectId: body.subjectId }].slice(-30));
      if (!messages.length && body.mode === "conversation") setOpening(body.self);
      setDraft(""); setOther("");setIntakeOpen(false);setSkipIntake(false); invalidateRequest(); void account.refresh();
    } catch (e) { if (!active()) return; const released = (e as WebError).details?.code === "CREDIT_RELEASED" || (e as WebError).details?.creditTaskStatus === "released"; setError(message(e) + (released ? " 本次积分已退回，内容已保留，可重新发送。" : "")); if (released) { invalidateRequest(); void account.refresh(); } if ((e as WebError).status === 401) { setConsent(false); void account.refresh(); } }
    finally { if (active()) setBusy(false); }
  }
  async function transcribe(audio: string, id: string) {
    if (!owner || ownerRef.current !== owner || !consent) return;
    if (pendingAudio?.requestId !== id && !hasPrice(account.account, "transcription")) { setPendingAudio({ audio, requestId: id }); setError("语音转写价格暂未取回，请刷新账户后重试。"); return; }
    const current = generation.current, active = () => mounted.current && current === generation.current && ownerRef.current === owner;
    setTranscribing(true); setError(""); setPendingAudio({ audio, requestId: id });
    try {
      const result = await api("/api/web/transcribe", { audio, confirmed: true, requestId: id }); if (!active()) return;
      if (!result.text?.trim()) throw new Error("没有识别到清晰文字，可以重新录制。");
      setDraft(value => [value, result.text.trim()].filter(Boolean).join("\n").slice(0, 1500)); setPendingAudio(null); invalidateRequest(); void account.refresh();
    } catch (e) { if (!active()) return; setError(message(e)); if ((e as WebError).details?.code === "CREDIT_RELEASED" || (e as WebError).details?.creditTaskStatus === "released") { setPendingAudio({ audio, requestId: crypto.randomUUID() }); void account.refresh(); } if ((e as WebError).status === 401) void account.refresh(); }
    finally { if (active()) setTranscribing(false); }
  }
  async function stopRecording(discard = false) {
    if (!recordingActive.current) return;
    const current = generation.current, recordingOwner = ownerRef.current, recorded = chunks.current.slice();
    discardRecorder(); if (discard) return;
    if (!mounted.current || current !== generation.current || recordingOwner !== ownerRef.current) return;
    const count = recorded.reduce((sum, item) => sum + item.length, 0);
    if (count < 8000) { setError("录音太短，请说完整一句话后再停止。"); return; }
    await transcribe(wavBase64(recorded), crypto.randomUUID());
  }
  async function startRecording() {
    if (!consent || busy || transcribing || recording || imageRead.current || !owner || restoredOwner !== owner) return;
    if (!hasPrice(account.account, "transcription")) { setError("语音转写价格暂未取回，请刷新账户后重试。"); return; }
    setError(""); const capture = ++captureGeneration.current, current = generation.current;
    recordingActive.current = true; setRecording(true); chunks.current = [];
    try {
      const microphone = await openMicrophone(samples => { if (recordingActive.current && capture === captureGeneration.current) chunks.current.push(samples); }, { onEnded: () => { if (capture === captureGeneration.current) { discardRecorder(); setError("麦克风已停止，请检查设备后重新录制。"); } } });
      if (capture !== captureGeneration.current || current !== generation.current || ownerRef.current !== owner || !recordingActive.current || !mounted.current) { await microphone.close(); return; }
      recorder.current = microphone; recordingTimer.current = setTimeout(() => void stopRecording(), 30_000);
    } catch (e) { if (capture !== captureGeneration.current || !mounted.current) return; discardRecorder(); setError(message(e)); }
  }
  const selectedPerson = account.people.find(person => person.id === subject);
  const visibleMessages = owner && owner === restoredOwner ? messages : [];
  const currentContext = owner && owner === restoredOwner ? context : null;
  const accountData = account.account?.account;
  const accessIssue = owner && accountData && (!accountData.active ? "文字军师尚未开通或已到期。" : !accountData.features?.includes("chat") ? "当前账户尚未开通文字军师。" : "");
  const controlsBusy = busy || recording || transcribing || readingImages;
  const freeIntake = !pendingBody.current && needsQuestionBackground({ mode, self: draft, opening, background, skipIntake, history: conversationHistory(messages, context) }, { history: !!captureQuestion || !!context, profile: !!subject, images: images.length > 0 });
  const isEmpty = visibleMessages.length === 0 && !currentContext;
  const historyContent = (
        <div className="wa-chat-history" role="log" aria-label="军师对话">
          {visibleMessages.length === 0 && !currentContext && !captureQuestion && <section className="wa-chat-empty"><h2>也可以，从一个具体场景开始</h2><p>点选带入问题，也可以直接说。</p><div className="chat-scenario-grid">{conversationPresets.map(preset => { const Icon = preset.icon; return <button key={preset.id} type="button" data-preset={preset.id} disabled={controlsBusy || !owner || !ready} onClick={() => choosePreset(preset)}><Icon size={20} strokeWidth={1.7}/><span><strong>{preset.title}</strong><small>{preset.hint}</small></span><ArrowUpRight size={14}/></button>; })}</div></section>}
          {visibleMessages.map(item => <article className="wa-chat-message" data-role={item.role} key={item.id}><small>{item.role === "assistant" && <AssistantEmblem small/>}{item.role === "user" ? "你" : "成子智能体"}</small><p>{item.content}</p>{item.role === "assistant" && <AnswerScope coverage={item.historyCoverage} status={item.historyStatus} subjectId={item.subjectId}/>} {item.evidence && <details><summary>看所用原话与依据</summary><p>{item.evidence}</p></details>}{item.replies?.length > 0 && <QuestionReplies options={item.replies} onRewrite={prepareRewrite} rewriteCost={priceLabel(account.account, "text")} disabled={controlsBusy || !!pendingBody.current}/>}</article>)}
          {busy && <div className="wa-chat-message wa-thinking" role="status"><span className="wa-thinking-dots" aria-hidden="true"><i/><i/><i/></span>正在结合你提供的情况整理建议…</div>}<div ref={end}/>
        </div>
  );
  const composerContent = (
        <div className="wa-composer chat-composer" data-dragging={dragging} onDragOver={event=>{event.preventDefault();if(controlsBusy)return;setDragging(true);}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false);}} onDrop={event=>{event.preventDefault();setDragging(false);void addImages(Array.from(event.dataTransfer.files));}} onPaste={event=>{const files=Array.from(event.clipboardData.items).filter(item=>item.type.startsWith("image/")).map(item=>item.getAsFile()).filter((file):file is File=>!!file);if(files.length){event.preventDefault();void addImages(files);}}}>
          <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value="";void addImages(files);}}/>
           {captureQuestion&&<section className={styles.importedExcerpt} aria-label="带入的聊天资料"><div><MessageCircle size={19}/><strong>{captureQuestion.scope === "full-history" ? `已选择完整聊天提问 · ${captureQuestion.friend}` : `已带入 ${captureQuestion.records.length} 条聊天 · ${captureQuestion.friend}`}</strong><button type="button" disabled={controlsBusy} onClick={clearCapture}><X size={15}/>移除</button></div><p>{captureQuestion.scope === "full-history" ? "发送时会核对当前账号的已同步聊天资料，并从中选取相关原话作答；资料不可用时会明确提示。" : `直接问你的疑问，发送前不会分析。${captureQuestion.omitted>0?`本次取所选材料中最近 ${captureQuestion.records.length} 条，另有 ${captureQuestion.omitted} 条未带入。`:""}`}</p>{captureQuestion.records.length > 0 && <details><summary>查看本次原文</summary><pre>{captureQuestionText(captureQuestion)}</pre></details>}</section>}
          {separateDraft&&<p className={styles.savedDraft}>原来的对话和未发送草稿已保留。<a href="/chat">返回原对话</a></p>}
          <div className={styles.composerTools}><AddMaterials subjectId={subject} disabled={controlsBusy} screenshotDisabled={images.length >= 3 || (!!owner && !ready)} onScreenshot={() => { if (!owner) requestLogin(); else picker.current?.click(); }} label={readingImages ? "正在准备截图…" : images.length ? `添加材料 · ${images.length}/3` : "添加材料"}/><a className={styles.voiceAction} href={"/voice" + (subject ? "?subjectId=" + encodeURIComponent(subject) : "")}><AudioLines size={18}/>语音交流<ArrowUpRight size={14}/></a><span>也可粘贴截图或原话</span></div>
          {images.length>0&&<><div className="chat-question-images" aria-label="本次选中的截图">{images.map((image,index)=><figure key={image.id}><button className="chat-image-open" type="button" aria-label={`放大截图 ${index+1}`} onClick={()=>setPreviewImage(image)}><img src={image.data} alt={`第 ${index+1} 张聊天截图`}/></button><figcaption>截图 {index+1} · 点图放大</figcaption><button className="chat-image-remove" type="button" aria-label={`移除截图 ${index+1}`} disabled={controlsBusy} onClick={()=>{setImages(previous=>previous.filter(item=>item.id!==image.id));if(images.length===1)setSelfSide("");invalidateRequest();setConsent(false);}}><X size={15}/></button></figure>)}</div>{visibleMessages.length>0&&<p className="chat-images-retained">截图已保留，追问会继续参考。换话题可点「新对话」。</p>}<div className="chat-image-side"><strong>哪侧气泡是你？</strong><div role="group" aria-label="截图中我的位置">{[["left","左侧是我"],["right","右侧是我"]].map(([side,label])=><button type="button" key={side} aria-pressed={selfSide===side} disabled={controlsBusy} onClick={()=>{setError("");if(selfSide!==side){setSelfSide(side as ChatSide);invalidateRequest();setConsent(false);}}}>{selfSide===side&&<Check size={16}/>} {label}</button>)}</div></div></>}
          {mode === "chat" && <label className="wa-field">对方的原话<textarea value={other} maxLength={3000} disabled={controlsBusy} placeholder="只粘贴对方说过的话" onChange={e => { setOther(e.target.value); invalidateRequest(); }}/></label>}
          <label className="wa-field">{mode === "chat" ? "你想表达什么，或需要补充什么" : "你想弄明白什么？"}<textarea ref={composer} value={draft} maxLength={1500} disabled={controlsBusy} placeholder={mode === "positioning" ? "我想要怎样的关系，现在最犹豫的是…" : "比如：结合之前的相处，TA 是真的想推进，还是只在聊天时热情？"} onChange={e => { setDraft(e.target.value); invalidateRequest(); }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/></label>
          <section className={styles.backgroundPrompt} hidden={!intakeOpen}><strong>补充一点情况，会更好判断。</strong>{(intakeQuestions.length ? intakeQuestions : ["你们现在是什么关系，认识多久了？", "最近哪次具体互动，让你想问这个问题？"]).map(question => <p key={question}>{question}</p>)}<textarea id="chat-background" aria-label="补充双方情况" maxLength={600} value={background} disabled={controlsBusy} placeholder="比如：朋友介绍认识一个月，见过两次。最近总是我先找他，但他会主动约周末见面……" onChange={event=>{setBackground(event.target.value);invalidateRequest();}}/><div><small>这次补充不扣积分。正式分析 {priceLabel(account.account, "text")}，点击发送后开始。</small><button type="button" disabled={controlsBusy} onClick={()=>{setSkipIntake(true);setIntakeOpen(false);invalidateRequest();}}>先按现有信息回答</button></div></section>
          {!intakeOpen && mode === "conversation" && (opening || background || visibleMessages.length > 0) && <details className={styles.sessionContext}><summary>本次对话背景 · 可修改</summary><p>后续追问会继续参考。修改只用于这次对话。</p><label>起始描述<textarea aria-label="本次话题的起始描述" maxLength={1500} value={opening} disabled={controlsBusy} onChange={event => { setOpening(event.target.value); invalidateRequest(); }}/></label><label>当前补充情况<textarea aria-label="本次对话补充背景" maxLength={600} value={background} disabled={controlsBusy} onChange={event => { setBackground(event.target.value); invalidateRequest(); }}/></label><button type="button" disabled={controlsBusy} onClick={() => { setOpening(""); setBackground(""); setSkipIntake(false); invalidateRequest(); }}>清除保留的背景</button></details>}
          <div className="chat-composer-caption"><small>{draft.length}/1500</small><small className="chat-keyboard-hint">Ctrl / ⌘ + Enter 发送</small></div>
           <label className="wa-check"><input type="checkbox" checked={consent} disabled={controlsBusy} onChange={e => setConsent(e.target.checked)}/>{captureQuestion?.scope === "full-history" ? "同意使用本次问题、聊天统计及相关原话摘录回答这次提问。" : <>确认发送{captureQuestion ? `${captureQuestion.records.length} 条聊天、` : "本次"}{images.length?`${images.length} 张聊天截图、问题` : "内容"}用于成子 AI 分析{subject ? "，并参考所选人物档案及已授权的完整聊天记忆摘要" : ""}。{images.length||captureQuestion?"只回答这次问题，不生成完整报告。":""}</>} <DataProcessingLink/></label>
          <ErrorNotice error={error}/>
          <div className="chat-compose-bottom"><div className="wa-actions">{account.loading ? <button className="wa-primary" type="button" disabled>发送</button> : !owner ? <button className="wa-primary" type="button" onClick={requestLogin}>登录后发送<ArrowUpRight size={16}/></button> : <button className="wa-primary" disabled={controlsBusy || !owner || !!accessIssue || (!pendingBody.current && !hasPrice(account.account, "text")) || !consent} onClick={() => void send()}><Send size={16}/>{busy ? "正在处理…" : pendingBody.current ? "重试本次提问" : freeIntake ? "先补充情况 · 免费" : "发送 · " + priceLabel(account.account, "text")}</button>}<button aria-label={recording ? "停止并转文字" : "语音输入"} disabled={busy || transcribing || readingImages || !owner || !!accessIssue || (!recording && !hasPrice(account.account, "transcription")) || !consent} onClick={() => void (recording ? stopRecording() : startRecording())}>{recording ? <Square size={16}/> : <Mic size={16}/>} {recording ? "停止录音" : transcribing ? "识别中…" : "语音输入"}</button>{recording && <button onClick={() => void stopRecording(true)}>取消录音</button>}</div><span className="chat-cost-note">{account.loading ? "正在确认账户" : account.unauthorized ? "登录后查看积分" : `可用 ${accountData?.balance ?? "—"} 积分`}</span></div>
          {pendingBody.current && !busy && <p className="chat-retry-note" role="status">继续原请求，不会重复扣费。</p>}
          {recording && <p role="status">正在录音，30 秒后自动停止并转文字。</p>}
          {pendingAudio && !transcribing && <div className="wa-actions"><button disabled={busy || !consent || !owner} onClick={() => void transcribe(pendingAudio.audio, pendingAudio.requestId)}>重试这段录音转写</button><button onClick={() => setPendingAudio(null)}>丢弃这段录音</button></div>}
          {(draft || other || images.length>0) && <button className="chat-clear-draft" disabled={controlsBusy} onClick={() => { setDraft(""); setOther(""); clearImages(); invalidateRequest(); }}>清空草稿</button>}
          <p className="wa-muted chat-price-line">需要澄清时先免费补充。正式提问 {priceLabel(account.account, "text")}（含本次截图） · 语音转写另计 {priceLabel(account.account, "transcription")} / 次</p>
        </div>
  );
  return <><WebNav backHref={currentContext?reportReturnHref(currentContext):undefined} backLabel={currentContext?(currentContext.reportId?"返回报告":"返回分析记录"):undefined} reportReturn={!!currentContext}/><main className={styles.page}>
    <QuestionImagePreview image={previewImage} onClose={()=>setPreviewImage(null)}/>
    <header className="chat-question-heading"><div><span>成子智能体 · 有疑问，直接问</span><h1>问成子</h1><p>说说让你困惑的事，一起看清原因和下一步。</p></div><a className={styles.fullAnalysis} href={personAnalysisHref(subject)}><ScanLine size={18}/>{RELATIONSHIP_ANALYSIS_LABEL}<ArrowUpRight size={16}/></a></header>
    {account.unauthorized ? <div className={styles.guestNotice}><span>可以先了解怎么问，添加私人截图或发送问题时再登录。</span><a href="/login?return_to=%2Fchat">登录后继续<ArrowUpRight size={14}/></a></div> : <AccountNotice state={account}/>}
    {accessIssue && <div className="chat-access-notice" role="status"><span>{accessIssue}</span><a href="/account#contact">查看积分与开通 <ArrowUpRight size={15}/></a></div>}
    <div className={styles.personContext}><label htmlFor="chat-active-person">这次在聊谁</label><select id="chat-active-person" value={subject} disabled={controlsBusy || account.loading} onChange={event => changeSubject(event.target.value)}><option value="">先聊我的问题</option>{account.people.map(person => <option key={person.id} value={person.id}>{person.label}</option>)}</select>{subject && <a href={personAnalysisHref(subject)}>查看全部资料<ArrowUpRight size={15}/></a>}</div>
    <div className={"chat-experience-grid" + (settingsOpen ? " has-context" : "")}>
      <section className={"chat-main" + (isEmpty ? " is-empty" : "")} aria-label="军师对话">
        <div className="chat-session-bar"><div><span className="chat-live-dot"/><strong>{selectedPerson ? "聊聊 " + selectedPerson.label : "你的私人对话"}</strong><small>{currentContext ? "已带入分析报告" : mode === "chat" ? "原话分析" : mode === "positioning" ? "关系需求梳理" : "直接聊，不必先选题型"}</small></div><button type="button" className="chat-context-toggle" aria-expanded={settingsOpen} aria-controls="chat-settings" onClick={() => setSettingsOpen(value => !value)}><SlidersHorizontal size={16}/><span>{settingsOpen ? "收起设置" : "咨询设置"}</span></button><button type="button" aria-label={separateDraft?"返回原对话":"开始新对话"} disabled={controlsBusy} onClick={newConversation}><Plus size={17}/><span>{separateDraft?"返回原对话":"新对话"}</span></button></div>
        {currentContext && <section className="chat-report-context"><div><ScanLine size={18}/><strong>接着聊：{currentContext.title}</strong></div><p>{currentContext.expiresAt <= Date.now() ? "这份摘要已过期。已有请求可直接重试取回回答；新的问题请重新打开报告，或开始新对话。" : "军师已带入这份报告的摘要。你可以继续核实判断，或一起推敲下一步。"}</p><details><summary>查看带入的内容</summary><p>{currentContext.summary}</p></details><div className="chat-followup-prompts">{[
          ["现在怎么回", "结合这份报告，我现在该怎么自然地回复？请说明适用条件，并给一句可以调整后使用的话。"],
          ["下一步观察什么", "结合这份报告，接下来最值得观察的具体行为是什么？什么结果会改变当前判断？"],
          ["还有哪些可能", "这份报告里哪些是材料事实，哪些是推测？还有什么合理解释，以及我该如何核实？"],
          ["有哪些风险", "结合这个人的完整资料，哪些具体行为需要留意？请分清关系期待不合、需要核实的疑点和明确越界，给原文依据与下一步核实方式；没有证据不要给人定性。"],
        ].map(([label, text]) => <button type="button" disabled={controlsBusy || !ready} key={label} onClick={() => fillPrompt(text)}>{label}<ChevronRight size={14}/></button>)}</div></section>}
        {isEmpty ? <>{composerContent}{historyContent}</> : <>{historyContent}{composerContent}</>}
      </section>
      <aside className={"chat-side" + (settingsOpen ? " is-open" : "")} id="chat-settings" aria-label="咨询设置">
        <section className="wa-card wa-chat-settings"><h2><SlidersHorizontal size={19}/>咨询设置</h2>{subject && <a className="chat-side-link" href={"/archive?subjectId=" + encodeURIComponent(subject)}>查看人物与长期趋势<ArrowUpRight size={15}/></a>}<details className="chat-advanced-settings"><summary>咨询方式与记录</summary><div className="wa-tabs" role="tablist" aria-label="咨询方式">{[["conversation", "直接聊"], ["chat", "分析原话"], ["positioning", "我的需求"]].map(([value, label]) => <button role="tab" key={value} aria-selected={mode === value} disabled={controlsBusy} onClick={() => changeMode(value)}><span>{label}</span></button>)}</div><label className="wa-check"><input type="checkbox" checked={saveHistory} disabled={separateDraft} onChange={e => setSaveHistory(e.target.checked)}/>{separateDraft ? "本次带入的聊天仅保留在当前窗口。" : "在此浏览器保留本账号最近 30 条对话。"}</label><p className="wa-muted">关闭后仅保留当前窗口。“新对话”会清空当前记录。</p></details></section>
        <section className="wa-card chat-side-tools"><h2>其他方式</h2><a href={"/voice?subjectId=" + encodeURIComponent(subject)}><span><Phone size={19}/><b>实时语音交流</b></span><ArrowUpRight size={16}/></a><a href={personAnalysisHref(subject)}><span><ScanLine size={19}/><b>{RELATIONSHIP_ANALYSIS_LABEL}</b></span><ArrowUpRight size={16}/></a></section>
        <section className="chat-credit-summary"><Coins size={18}/><div><strong>{account.loading ? "正在确认账户" : account.unauthorized ? "登录后查看积分" : `${accountData?.balance ?? "—"} 可用积分`}</strong><p>发送前显示费用，用多少扣多少。案例免费，自己的材料需要账号和积分。</p><a href="/account#balance">积分明细与开通<ArrowUpRight size={13}/></a></div></section>
      </aside>
    </div>
  </main><AnalysisAuthGate open={showAuth} onClose={() => setShowAuth(false)} returnTo="/chat" contextLabel="问成子" onSuccess={async () => { await account.refresh(); setShowAuth(false); }}/></>;
}
