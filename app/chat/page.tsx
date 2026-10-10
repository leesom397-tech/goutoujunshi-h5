"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Send, Phone, Square, MessageCircle, ScanLine, Compass, Plus, ArrowUpRight, Quote, SlidersHorizontal, CalendarDays, ShieldCheck, Coins, UserRound, ChevronRight } from "lucide-react";
import { AssistantEmblem, HeadingStamp } from "@/components/web-analysis/Visuals";
import { WebNav } from "@/components/WebNav";
import { AccountNotice, ErrorNotice, PersonSelect, api, message, priceLabel, hasPrice, useAccount, readLocal, saveLocal, type Json, WebError } from "@/components/web-analysis/client";
import { Replies } from "@/components/web-analysis/ReportView";
import { openMicrophone, wavBase64, type Microphone } from "@/components/web-analysis/audio";
import { restoreConversation, conversationHistory, fitConversationRequest } from "@/lib/web-conversation-state.mjs";
import "@/components/web-analysis/web-analysis.css";
import "./chat-experience.css";

const conversationPresets = [
  { id: "signals", title: "看懂 TA 的态度", hint: "把行为和自己的猜测分开", mode: "conversation", draft: "最近让我在意的一次互动是：\n我观察到的具体行为：\n我最想弄清楚的是：", icon: MessageCircle },
  { id: "reply", title: "斟酌一句回复", hint: "自然表达，也照顾自己的边界", mode: "chat", draft: "我想表达的是：", icon: Quote },
  { id: "invite", title: "自然发起邀约", hint: "一起推敲时机、说法和后续", mode: "conversation", draft: "我想约 TA 见面。\n我们目前的关系和最近互动：\n我想邀请的活动：\n请帮我判断时机，并拟一句自然、允许对方拒绝的邀约。", icon: CalendarDays },
  { id: "boundaries", title: "把边界说清楚", hint: "既不委屈自己，也不伤害对方", mode: "conversation", draft: "让我不舒服的具体情况是：\n我能接受和不能接受的是：\n请帮我把感受和边界表达清楚。", icon: ShieldCheck },
  { id: "needs", title: "理清我的期待", hint: "看见自己真正需要的相处方式", mode: "positioning", draft: "这段关系里，我最在意的是：\n我希望得到的相处方式：\n现在让我犹豫的地方：", icon: Compass },
  { id: "practice", title: "练习一次沟通", hint: "带着真实场景，先把话练一遍", mode: "conversation", draft: "我想练习一次真实的沟通。\n对象和场景：\n我原本打算这样说：\n请先指出容易被误解的地方，给一版自然表达，再模拟对方的一种可能回应，让我继续练习。", icon: MessageCircle },
  { id: "followup", title: "聊聊后来的进展", hint: "带着真实回应，调整下一步", mode: "conversation", draft: "上次之后，我实际做了什么：\n对方的真实回应或具体行为：\n我自己的感受：\n现在最想弄清楚的问题：\n请结合这些新进展，区分事实和推测，帮我看看下一步是否需要调整。", icon: CalendarDays },
] as const;
export default function ChatPage() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setSettingsOpen(window.matchMedia("(min-width: 981px)").matches); }, []);
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
    setReady(false); setMessages([]); setDraft(""); setOther(""); setSubject(""); setMode("conversation"); setSaveHistory(false); setContext(null); setContextKey(""); setPendingAudio(null); setConsent(false); setBusy(false); setTranscribing(false); setError(""); setRestoredOwner(owner || null);
    if (!owner) return;
    const key = `chengzi-chat:${owner}`, stored = readLocal<Json>(key);
    let windowSaved: Json | null = null; try { windowSaved = JSON.parse(sessionStorage.getItem(key) || "null"); } catch {}
    const search = new URLSearchParams(window.location.search), handoff = search.get("context") || "";
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
    const previous = windowSaved || stored;
    const restored = restoreConversation(handoff && !report ? null : previous, owner, { ...(report ? { subject: report.subjectId || "", mode: "conversation" } : { ...(search.has("subjectId") ? { subject: search.get("subjectId") || "" } : {}), mode: search.get("mode") }), contextKey: handoff });
    const freshHandoff = report && report.expiresAt > Date.now() && (!previous || previous.owner !== owner || previous.contextKey !== handoff || previous.subject !== (report.subjectId || ""));
    const focusedQuestion = freshHandoff && typeof report?.question === "string" ? report.question.trim().slice(0, 1500) : "";
    if (report && report.expiresAt <= Date.now()) setError(restored.requestBody ? "报告摘要已过期；上次请求已保留，可直接重试取回回答。" : "报告摘要已过期，请回到报告重新打开，或开始新对话。");
    const preset = !report ? conversationPresets.find(item => item.id === search.get("preset")) : undefined;
    setMessages(preset ? [] : restored.messages); setDraft(preset?.draft || focusedQuestion || restored.draft); setOther(preset ? "" : restored.other); setSubject(restored.subject); setMode(preset?.mode || restored.mode); setContextKey(report ? handoff : ""); setSaveHistory(!!stored); requestId.current = preset ? null : restored.requestId; pendingBody.current = preset ? null : restored.requestBody; setReady(true);
    if (preset) { const cleanUrl = new URL(window.location.href); cleanUrl.searchParams.delete("preset"); window.history.replaceState(null, "", cleanUrl.pathname + cleanUrl.search); }
  }, [owner]);
  function snapshot(body = pendingBody.current) { return { owner, messages, draft, other, subject, mode, contextKey, requestId: body?.requestId || requestId.current, requestBody: body }; }
  function persist(data: Json) {
    if (!owner || owner !== ownerRef.current || owner !== restoredOwner || !ready) return;
    const key = `chengzi-chat:${owner}`;
    try { sessionStorage.setItem(key, JSON.stringify(data)); } catch {}
    if (saveHistory) { if (!saveLocal(key, data)) setError("浏览器空间不足，无法保存长期对话记录；当前页面仍可使用。"); }
    else try { localStorage.removeItem(key); } catch {}
  }
  useEffect(() => { persist(snapshot()); }, [owner, restoredOwner, ready, messages, draft, other, subject, mode, contextKey, saveHistory, busy]);
  useEffect(() => { if (!messages.length && !busy) return; end.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" }); }, [messages.length, busy]);
  function leaveReport(nextSubject = subject, nextMode = mode) { setContext(null); setContextKey(""); const url = new URL(window.location.href); url.searchParams.delete("context"); if (nextSubject) url.searchParams.set("subjectId", nextSubject); else url.searchParams.delete("subjectId"); if (nextMode !== "conversation") url.searchParams.set("mode", nextMode); else url.searchParams.delete("mode"); window.history.replaceState(null, "", url.pathname + url.search); }
  function changeSubject(next: string) { if (next === subject) return; if ((draft.trim() || other.trim()) && !window.confirm("切换人物会开始新对话，并清空未发送内容。是否继续？")) return; generation.current++; discardRecorder(); setSubject(next); setMessages([]); setDraft(""); setOther(""); setPendingAudio(null); leaveReport(next); setConsent(false); invalidateRequest(); }
  function newConversation() { generation.current++; discardRecorder(); setMessages([]); setDraft(""); setOther(""); setPendingAudio(null); leaveReport(); setConsent(false); setError(""); invalidateRequest(); }
  function changeMode(next: string) { if (next === mode) return; generation.current++; setMode(next); setMessages([]); setPendingAudio(null); leaveReport(subject, next); setConsent(false); invalidateRequest(); }
  function fillPrompt(text: string) {
    if (busy || recording || transcribing || !ready) return;
    if (draft.trim() && draft.trim() !== text.trim() && !window.confirm("用这个场景替换当前未发送的草稿？")) return;
    setDraft(text); invalidateRequest();
    requestAnimationFrame(() => { composer.current?.focus(); composer.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" }); });
  }
  function choosePreset(preset: typeof conversationPresets[number]) {
    if (busy || recording || transcribing || !ready) return;
    if ((draft.trim() || other.trim()) && !window.confirm("用这个场景替换当前未发送的内容？")) return;
    changeMode(preset.mode); setOther(""); setDraft(preset.draft); invalidateRequest();
    requestAnimationFrame(() => { composer.current?.focus(); composer.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" }); });
  }
  async function send() {
    if (busy || recording || transcribing || !owner || !ready || restoredOwner !== owner) return;
    if (!pendingBody.current && !hasPrice(account.account, "text")) { setError("文字咨询价格暂未取回，请刷新账户后重试。"); return; }
    if (!consent) { setError("请确认本次文字与语音的处理范围。"); return; }
    if (mode === "chat" ? other.trim().length < 2 : draft.trim().length < (mode === "positioning" ? 6 : 2)) { setError(mode === "chat" ? "请先填写对方原话。" : "说说你正在经历什么、想弄清楚什么。"); return; }
    const current = generation.current, active = () => mounted.current && current === generation.current && ownerRef.current === owner;
    setBusy(true); setError("");
    try {
      if (context && (context.accountId !== owner || context.subjectId !== subject)) { leaveReport(); invalidateRequest(); throw new Error("追问内容与当前账号或人物不一致，请重新打开报告。"); }
      const retryBody = pendingBody.current?.requestId === requestId.current ? pendingBody.current : null;
      if (retryBody && ((retryBody.subjectId || "") !== subject || retryBody.mode !== mode || retryBody.self !== draft.trim() || retryBody.other !== (mode === "chat" ? other.trim() : ""))) { invalidateRequest(); throw new Error("输入或人物已变化，请确认后重新发送。"); }
      // Expiry stops new use of a report. A pending request must retain its
      // original body/key so a lost response can be recovered without rebilling.
      if (!retryBody && context && context.expiresAt <= Date.now()) { leaveReport(); invalidateRequest(); throw new Error("报告上下文已过期，请返回报告重新打开。"); }
      requestId.current ||= crypto.randomUUID();
      const body = retryBody || fitConversationRequest({ mode, self: draft.trim(), other: mode === "chat" ? other.trim() : "", subjectId: subject || null, confirmed: true, requestId: requestId.current, history: conversationHistory(messages, mode === "conversation" ? context : null) });
      pendingBody.current = body; persist(snapshot(body));
      const result = await api("/api/web/text", body);
      if (!active()) return;
      if (!result.possibleIntent || !result.nextStep) throw new Error("回答未完整返回，请重试。");
      const content = body.mode === "chat" ? `对方：${body.other}\n我：${body.self}` : body.self;
      setMessages(previous => [...previous, { id: `${body.requestId}-u`, role: "user", content }, { id: `${body.requestId}-a`, role: "assistant", content: [result.possibleIntent, result.nextStep].filter(Boolean).join("\n\n"), evidence: result.evidence, replies: result.replies || [] }].slice(-30));
      setDraft(""); setOther(""); invalidateRequest(); void account.refresh();
    } catch (e) { if (!active()) return; setError(message(e)); if ((e as WebError).details?.code === "CREDIT_RELEASED") invalidateRequest(); if ((e as WebError).status === 401) { setConsent(false); void account.refresh(); } }
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
    } catch (e) { if (!active()) return; setError(message(e)); if ((e as WebError).details?.code === "CREDIT_RELEASED") setPendingAudio({ audio, requestId: crypto.randomUUID() }); if ((e as WebError).status === 401) void account.refresh(); }
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
    if (!consent || busy || transcribing || recording || !owner || restoredOwner !== owner) return;
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
  const controlsBusy = busy || recording || transcribing;
  const isEmpty = visibleMessages.length === 0 && !currentContext;
  const historyContent = (
        <div className="wa-chat-history" role="log" aria-label="军师对话">
          {visibleMessages.length === 0 && !currentContext && <section className="wa-chat-empty"><h2>也可以，从一个具体场景开始</h2><p>点选填入可编辑模板，确认后再发送。</p><div className="chat-scenario-grid">{conversationPresets.map(preset => { const Icon = preset.icon; return <button key={preset.id} type="button" data-preset={preset.id} disabled={controlsBusy || !owner || !ready} onClick={() => choosePreset(preset)}><Icon size={20} strokeWidth={1.7}/><span><strong>{preset.title}</strong><small>{preset.hint}</small></span><ArrowUpRight size={14}/></button>; })}</div></section>}
          {visibleMessages.map(item => <article className="wa-chat-message" data-role={item.role} key={item.id}><small>{item.role === "assistant" && <AssistantEmblem small/>}{item.role === "user" ? "你" : "成子军师"}</small><p>{item.content}</p>{item.evidence && <details><summary>判断依据</summary><p>{item.evidence}</p></details>}{item.replies?.length > 0 && <Replies options={item.replies} account={account.account}/>}</article>)}
          {busy && <div className="wa-chat-message wa-thinking" role="status"><span className="wa-thinking-dots" aria-hidden="true"><i/><i/><i/></span>正在结合你提供的情况整理建议…</div>}<div ref={end}/>
        </div>
  );
  const composerContent = (
        <div className="wa-composer chat-composer">
          {mode === "chat" && <label className="wa-field">对方的原话<textarea value={other} maxLength={3000} disabled={controlsBusy} placeholder="只粘贴对方说过的话" onChange={e => { setOther(e.target.value); invalidateRequest(); }}/></label>}
          <label className="wa-field">{mode === "chat" ? "你想表达什么，或需要补充什么" : "想和军师聊什么"}<textarea ref={composer} value={draft} maxLength={1500} disabled={controlsBusy} placeholder={mode === "positioning" ? "我想要怎样的关系，现在最犹豫的是…" : "不必先组织好语言，从最近的一件事开始…"} onChange={e => { setDraft(e.target.value); invalidateRequest(); }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/></label>
          <div className="chat-composer-caption"><small>{draft.length}/1500</small><small className="chat-keyboard-hint">Ctrl / ⌘ + Enter 发送</small></div>
          <label className="wa-check"><input type="checkbox" checked={consent} disabled={controlsBusy} onChange={e => setConsent(e.target.checked)}/>同意将本次内容与最近上下文发送至阿里云百炼分析{subject ? "，并参考所选人物档案" : ""}。语音先转为可编辑文字。</label>
          <ErrorNotice error={error}/>
          <div className="chat-compose-bottom"><div className="wa-actions"><button className="wa-primary" disabled={controlsBusy || !owner || !!accessIssue || (!pendingBody.current && !hasPrice(account.account, "text")) || !consent} onClick={() => void send()}><Send size={16}/>{busy ? "思考中…" : "发送 · " + priceLabel(account.account, "text")}</button><button aria-label={recording ? "停止并转文字" : "语音输入"} disabled={busy || transcribing || !owner || !!accessIssue || (!recording && !hasPrice(account.account, "transcription")) || !consent} onClick={() => void (recording ? stopRecording() : startRecording())}>{recording ? <Square size={16}/> : <Mic size={16}/>} {recording ? "停止录音" : transcribing ? "识别中…" : "语音输入"}</button>{recording && <button onClick={() => void stopRecording(true)}>取消录音</button>}</div><span className="chat-cost-note">可用 {accountData?.balance ?? "—"} 积分</span></div>
          {recording && <p role="status">正在录音，30 秒后自动停止并转文字。</p>}
          {pendingAudio && !transcribing && <div className="wa-actions"><button disabled={busy || !consent || !owner} onClick={() => void transcribe(pendingAudio.audio, pendingAudio.requestId)}>重试这段录音转写</button><button onClick={() => setPendingAudio(null)}>丢弃这段录音</button></div>}
          {(draft || other) && <button className="chat-clear-draft" disabled={controlsBusy} onClick={() => { setDraft(""); setOther(""); invalidateRequest(); }}>清空草稿</button>}
          <p className="wa-muted chat-price-line">文字 {priceLabel(account.account, "text")} / 次 · 语音转写 {priceLabel(account.account, "transcription")} / 次</p>
        </div>
  );
  return <><WebNav/><main className="wa-shell chat-experience">
    <div className="wa-heading chat-page-heading"><div className="wa-heading-main"><span className="wa-eyebrow">你的关系军师</span><h1>一起把下一步，想清楚。</h1><p>从一句原话开始，也可以带着人物档案接着聊。</p></div><HeadingStamp variant="chat"/></div>
    <AccountNotice state={account}/>
    {accessIssue && <div className="chat-access-notice" role="status"><span>{accessIssue}</span><a href="/account#contact">查看积分与开通 <ArrowUpRight size={15}/></a></div>}
    <div className={"chat-experience-grid" + (settingsOpen ? " has-context" : "")}>
      <section className={"chat-main" + (isEmpty ? " is-empty" : "")} aria-label="军师对话">
        <div className="chat-session-bar"><div><span className="chat-live-dot"/><strong>{selectedPerson ? "聊聊 " + selectedPerson.label : "你的私人对话"}</strong><small>{currentContext ? "已带入分析报告" : mode === "chat" ? "原话分析" : mode === "positioning" ? "关系需求梳理" : "直接聊，不必先选题型"}</small></div><button type="button" className="chat-context-toggle" aria-expanded={settingsOpen} aria-controls="chat-settings" onClick={() => setSettingsOpen(value => !value)}><SlidersHorizontal size={16}/><span>{settingsOpen ? "收起设置" : "人物与设置"}</span></button><button type="button" aria-label="开始新对话" disabled={controlsBusy} onClick={newConversation}><Plus size={17}/><span>新对话</span></button></div>
        {isEmpty && <p className="chat-start-hint">先说说最近发生了什么，以及你最想弄清楚的事。</p>}
        {currentContext && <section className="chat-report-context"><div><ScanLine size={18}/><strong>接着聊：{currentContext.title}</strong></div><p>{currentContext.expiresAt <= Date.now() ? "这份摘要已过期。已有请求可直接重试取回回答；新的问题请重新打开报告，或开始新对话。" : "军师已带入这份报告的摘要。你可以继续核实判断，或一起推敲下一步。"}</p><details><summary>查看带入的内容</summary><p>{currentContext.summary}</p></details><div className="chat-followup-prompts">{[
          ["现在怎么回", "结合这份报告，我现在该怎么自然地回复？请说明适用条件，并给一句可以调整后使用的话。"],
          ["下一步观察什么", "结合这份报告，接下来最值得观察的具体行为是什么？什么结果会改变当前判断？"],
          ["还有哪些可能", "这份报告里哪些是材料事实，哪些是推测？还有什么合理解释，以及我该如何核实？"],
        ].map(([label, text]) => <button type="button" disabled={controlsBusy || !ready} key={label} onClick={() => fillPrompt(text)}>{label}<ChevronRight size={14}/></button>)}</div></section>}
        {isEmpty ? <>{composerContent}{historyContent}</> : <>{historyContent}{composerContent}</>}
      </section>
      <aside className={"chat-side" + (settingsOpen ? " is-open" : "")} id="chat-settings" aria-label="人物与咨询设置">
        <section className="wa-card wa-chat-settings"><h2><UserRound size={19}/>这次在聊谁</h2><p className="wa-muted">选择人物后，建议会参考已确认的档案。</p><PersonSelect people={account.people} value={subject} onChange={changeSubject} disabled={controlsBusy}/>{subject && <a className="chat-side-link" href={"/archive?subjectId=" + encodeURIComponent(subject)}>查看人物与长期趋势<ArrowUpRight size={15}/></a>}<details className="chat-advanced-settings"><summary>咨询方式与记录</summary><div className="wa-tabs" role="tablist" aria-label="咨询方式">{[["conversation", "直接聊"], ["chat", "分析原话"], ["positioning", "我的需求"]].map(([value, label]) => <button role="tab" key={value} aria-selected={mode === value} disabled={controlsBusy} onClick={() => changeMode(value)}><span>{label}</span></button>)}</div><label className="wa-check"><input type="checkbox" checked={saveHistory} onChange={e => setSaveHistory(e.target.checked)}/>在此浏览器保留本账号最近 30 条对话。</label><p className="wa-muted">关闭后仅保留当前窗口。“新对话”会清空当前记录。</p></details></section>
        <section className="wa-card chat-side-tools"><h2>换一种方式聊</h2><a href={"/voice?subjectId=" + encodeURIComponent(subject)}><span><Phone size={19}/><b>实时语音军师</b></span><ArrowUpRight size={16}/></a><a href={"/analyze" + (subject ? "?subjectId=" + encodeURIComponent(subject) : "")}><span><ScanLine size={19}/><b>带入聊天截图</b></span><ArrowUpRight size={16}/></a></section>
        <section className="chat-credit-summary"><Coins size={18}/><div><strong>{accountData?.balance ?? "—"} 可用积分</strong><p>发送前显示费用，用多少扣多少。</p><a href="/account#contact">积分明细与开通<ArrowUpRight size={13}/></a></div></section>
      </aside>
    </div>
  </main></>;
}
