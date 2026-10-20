"use client";
import { DataProcessingLink } from "@/components/DataProcessingLink";
import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, MicOff, Mic, Headphones, AudioLines, ShieldCheck, Volume2, Square, ArrowRight, Check, Copy, Settings2, MessageCircle, Activity, Clock3, RefreshCw } from "lucide-react";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import styles from "./voice.module.css";
import { WebNav } from "@/components/WebNav";
import { AccountNotice, ErrorNotice, PersonSelect, api, message, priceLabel, useAccount, type Json } from "@/components/web-analysis/client";
import { openMicrophone, pcmBase64, type Microphone } from "@/components/web-analysis/audio";
import { createEchoFilter } from "@/lib/web-voice-echo-filter.mjs";
import { voiceAccessError } from "@/lib/web-conversation-state.mjs";
import "@/components/web-analysis/web-analysis.css";
type Live = { generation: number; active: boolean; closing: Promise<void> | null; socket: WebSocket | null; microphone: Microphone | null; audio: AudioContext | null; sources: AudioBufferSourceNode[]; nextPlay: number; playbackTimer: ReturnType<typeof setInterval> | null; timeout: ReturnType<typeof setTimeout> | null; started: boolean; muted: boolean; userSpeaking: boolean; wake: { release: () => Promise<void> } | null; echo: ReturnType<typeof createEchoFilter>; lastEchoAt: number };
type Turn = { role: "user" | "assistant"; text: string };
function micError(cause: unknown) {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "麦克风权限未开启。请在浏览器的网站权限中允许麦克风，再点重试。";
  if (name === "NotFoundError") return "没有找到麦克风，请连接耳机或检查设备的麦克风设置。";
  if (name === "NotReadableError") return "麦克风可能被其他应用占用，请结束其他通话后重试。";
  return message(cause);
}
export default function VoicePage() {
  const account = useAccount(), [subject, setSubject] = useState(""), [consent, setConsent] = useState(false), [memoryConsent, setMemoryConsent] = useState(false), [audioMode, setAudioMode] = useState("speaker"), [phase, setPhase] = useState("idle"), [status, setStatus] = useState("准备好后，开始通话"), [error, setError] = useState(""), [you, setYou] = useState(""), [assistant, setAssistant] = useState(""), [muted, setMuted] = useState(false), [seconds, setSeconds] = useState(0);
  const live = useRef<Live>({ generation: 0, active: false, closing: null, socket: null, microphone: null, audio: null, sources: [], nextPlay: 0, playbackTimer: null, timeout: null, started: false, muted: false, userSpeaking: false, wake: null, echo: createEchoFilter(), lastEchoAt: 0 });
  const mounted = useRef(true), requestId = useRef<string | null>(null), priorOwner = useRef<string | null>(null), ownerRef = useRef<string | null>(null);
  const [testing, setTesting] = useState(false), [micStatus, setMicStatus] = useState(""), [level, setLevel] = useState(0), [turns, setTurns] = useState<Turn[]>([]), [notice, setNotice] = useState(""), [deadline, setDeadline] = useState(0), [responseMs, setResponseMs] = useState<number | null>(null);
  const testMic = useRef<Microphone | null>(null), testTimer = useRef<ReturnType<typeof setTimeout> | null>(null), testGeneration = useRef(0), testActive = useRef(false), testHeard = useRef(false);
  const transcript = useRef<Turn[]>([]), transcriptSubject = useRef(""), answerDraft = useRef(""), levelTick = useRef(0), waitingAt = useRef(0), speechTick = useRef(0), endSeen = useRef(false);
  ownerRef.current = account.account?.account?.userId || null;
  useEffect(() => {
    mounted.current = true; setSubject(new URLSearchParams(window.location.search).get("subjectId") || "");
    const hide = () => { if (document.hidden) { void stopMicTest(); if (live.current.active) void endCall("已离开通话页面，通话结束"); } };
    const leave = () => { void stopMicTest(); void endCall(); };
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", leave);
    return () => { mounted.current = false; document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave); void stopMicTest(); void endCall(); };
  }, []);
  useEffect(() => { if (phase !== "talking") return; const timer = setInterval(() => setSeconds(value => value + 1), 1000); return () => clearInterval(timer); }, [phase]);
  useEffect(() => {
    const owner = account.account?.account?.userId || null;
    if (priorOwner.current && priorOwner.current !== owner) { void stopMicTest(); void endCall("账号已变化，通话已结束"); transcript.current = []; transcriptSubject.current = ""; answerDraft.current = ""; setTurns([]); setNotice(""); setMicStatus(""); setYou(""); setAssistant(""); setSubject(""); setMemoryConsent(false); setConsent(false); setError(""); }
    priorOwner.current = owner;
  }, [account.account?.account?.userId]);
  function remember(role: Turn["role"], text: string) {
    const value = text.trim().slice(0, 3000); if (!value) return;
    const last = transcript.current.at(-1); if (last?.role === role && last.text === value) return;
    transcript.current = [...transcript.current, { role, text: value }].slice(-30);
    if (mounted.current) setTurns(transcript.current);
  }
  function finishAnswer() { if (answerDraft.current) remember("assistant", answerDraft.current); answerDraft.current = ""; }
  function inputLevel(samples: Int16Array) {
    let power = 0; for (let i = 0; i < samples.length; i++) power += (samples[i] / 32768) ** 2;
    const rms = Math.sqrt(power / Math.max(1, samples.length)); if (rms > .008) testHeard.current = true;
    if (Date.now() - levelTick.current > 100) { levelTick.current = Date.now(); if (mounted.current) setLevel(Math.min(1, rms * 8)); }
  }
  async function stopMicTest(label = "") {
    ++testGeneration.current; testActive.current = false;
    if (testTimer.current) clearTimeout(testTimer.current); testTimer.current = null;
    const microphone = testMic.current; testMic.current = null; await microphone?.close().catch(() => {});
    if (mounted.current) { setTesting(false); setLevel(0); if (label) setMicStatus(label); }
  }
  async function checkMicrophone() {
    if (testActive.current || live.current.active || live.current.closing) return;
    testActive.current = true; const generation = ++testGeneration.current; testHeard.current = false; setTesting(true); setError(""); setMicStatus("请说一句话，检查下方音量是否有变化。");
    try {
      const microphone = await openMicrophone(samples => { if (generation === testGeneration.current) inputLevel(samples); }, { echoCancellation: audioMode === "speaker" });
      if (generation !== testGeneration.current || !mounted.current) { await microphone.close(); return; }
      testMic.current = microphone;
      testTimer.current = setTimeout(() => void stopMicTest(testHeard.current ? "麦克风已能收到声音，可以开始通话。" : "麦克风已打开，但没有检测到明显声音。请靠近麦克风再试一次。"), 4000);
    } catch (cause) { if (generation === testGeneration.current) { await stopMicTest(); setMicStatus(micError(cause)); } }
  }
  function interruptNow() {
    const value = live.current; if (!value.started || value.socket?.readyState !== WebSocket.OPEN) return;
    finishAnswer(); value.userSpeaking = true; interrupt(); setAssistant(""); setStatus("已停止播报，现在听你说"); value.socket.send(JSON.stringify({ type: "gateway.interrupt" }));
  }
  function transcriptText() { return transcript.current.map(turn => `${turn.role === "user" ? "我" : "成子智能体"}：${turn.text}`).join("\n\n"); }
  async function copyTranscript() { try { await navigator.clipboard.writeText(transcriptText()); setNotice("本次对话文字已复制。"); } catch { setNotice("浏览器未允许复制，请直接选择下方文字。 "); } }
  async function continueInText() {
    const owner = ownerRef.current; if (!owner || !transcript.current.length) return;
    const sourceSubject = transcriptSubject.current;
    await endCall("已结束语音，准备继续文字咨询");
    if (owner !== ownerRef.current) return;
    const key = crypto.randomUUID();
    try { sessionStorage.setItem(`web-followup:${key}`, JSON.stringify({ accountId: owner, reportId: "", title: "本次语音对话", subjectId: sourceSubject, summary: ("以下是本次语音自动转写，可能有识别误差；军师建议属于待验证推测。\n" + transcriptText().slice(-950)).slice(0, 1100), expiresAt: Date.now() + 30 * 60_000 })); window.location.assign(`/chat?context=${key}`); }
    catch { setNotice("浏览器无法保留上下文，请先复制本次对话。 "); }
  }
  function interrupt() { const value = live.current; for (const source of value.sources) { try { source.stop(); } catch {} } value.sources = []; value.nextPlay = 0; value.echo.stopPlayback(value.audio?.currentTime || 0); }
  function endCall(label = "通话已结束"): Promise<void> {
    const value = live.current;
    if (value.closing) return value.closing;
    finishAnswer(); if (mounted.current) { setLevel(0); setDeadline(0); }
    const generation = ++value.generation; value.active = false; value.started = false; value.userSpeaking = false; value.muted = false;
    if (value.playbackTimer) clearInterval(value.playbackTimer); if (value.timeout) clearTimeout(value.timeout);
    value.playbackTimer = null; value.timeout = null; interrupt(); value.echo.reset(); value.lastEchoAt = 0;
    // Detach every owned resource before awaiting any close operation.
    const socket = value.socket, microphone = value.microphone, audio = value.audio, wake = value.wake;
    value.socket = null; value.microphone = null; value.audio = null; value.wake = null; requestId.current = null;
    if (socket) { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; try { if (socket.readyState < WebSocket.CLOSING) socket.close(1000, "Call ended"); } catch {} }
    if (mounted.current) { setPhase("ending"); setStatus("正在结束通话…"); setMuted(false); setConsent(false); }
    value.closing = Promise.allSettled([microphone?.close(), audio && audio.state !== "closed" ? audio.close() : undefined, wake?.release()]).then(() => {
      value.closing = null;
      if (mounted.current && generation === value.generation) { setPhase("idle"); setStatus(label); void account.refresh(); }
    });
    return value.closing;
  }
  function play(base64: string) {
    const value = live.current;
    if (!value.audio || !value.started || value.userSpeaking) return;
    try {
      const raw = atob(base64), bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const view = new DataView(bytes.buffer), samples = Math.floor(bytes.length / 2); if (!samples) return;
      const buffer = value.audio.createBuffer(1, samples, 24000), channel = buffer.getChannelData(0);
      for (let i = 0; i < samples; i++) channel[i] = Math.tanh(view.getInt16(i * 2, true) / 32768 * 1.8);
      const source = value.audio.createBufferSource(); source.buffer = buffer; source.connect(value.audio.destination);
      const when = Math.max(value.audio.currentTime + .035, value.nextPlay); source.start(when);
      if (audioMode === "speaker") value.echo.addPlayback(channel, when);
      value.nextPlay = when + samples / 24000; value.sources.push(source); source.onended = () => { value.sources = value.sources.filter(item => item !== source); };
    } catch { setError("声音暂时无法播放，你仍可阅读下方文字。"); }
  }
  function receive(raw: string, generation: number) {
    const value = live.current; if (generation !== value.generation || !value.active) return;
    let event: Json; try { event = JSON.parse(raw); } catch { return; }
    if (event.type === "gateway.session_meta") { const expiresAt = Number(event.expiresAt); if (Number.isFinite(expiresAt) && expiresAt > Date.now()) setDeadline(expiresAt); return; }
    if (event.type === "gateway.session_end") { endSeen.current = true; void endCall(event.reason === "time_limit" ? "本次通话时间已到，记录留在下方" : "通话已正常结束，记录留在下方"); return; }
    if (event.type === "gateway.interrupted") { value.userSpeaking = true; setStatus("已停止播报，现在听你说"); return; }
    if (event.type === "gateway.notice") { setStatus(typeof event.message === "string" ? event.message.slice(0, 160) : "这句话没能识别清楚，请再说一次。"); return; }
    if (["error", "gateway.error"].includes(event.type)) { setError((typeof event.error?.message === "string" ? event.error.message.slice(0, 160) : "语音服务暂时中断，请重新开始。") + " 未生成语音回应的本轮会退回预留积分。"); void endCall("通话已中断"); return; }
    if (event.type === "session.updated") {
      if (value.started) return;
      value.started = true; if (value.timeout) clearTimeout(value.timeout); setPhase("talking"); setStatus("正在听你说话");
      value.timeout = setTimeout(() => void endCall("本次 3 分钟通话已结束，可以开始新一轮"), 180_000);
      const wakeLock = (navigator as any).wakeLock;
      if (wakeLock) void wakeLock.request("screen").then((lock: any) => { if (generation === live.current.generation) live.current.wake = lock; else void lock.release(); }).catch(() => {});
      return;
    }
    if (!value.started) return;
    if (event.type === "gateway.user_turn") { finishAnswer(); value.userSpeaking = false; interrupt(); const text = String(event.transcript || "").slice(0, 1500); remember("user", text); setYou(text); setAssistant(""); waitingAt.current = Date.now(); setResponseMs(null); setStatus("军师正在思考…"); }
    if (event.type === "input_audio_buffer.speech_started") { if (audioMode === "speaker" && Date.now() - value.lastEchoAt < 180) return; value.userSpeaking = true; interrupt(); setStatus("正在听你说话"); setAssistant(""); }
    if (event.type === "input_audio_buffer.speech_stopped") { value.userSpeaking = false; waitingAt.current = Date.now(); setStatus("军师正在思考…"); }
    if (event.type === "conversation.item.input_audio_transcription.completed") { const text = String(event.transcript || event.text || "").slice(0, 1500); remember("user", text); setYou(text); setAssistant(""); }
    if (event.type === "response.audio_transcript.delta" && !value.userSpeaking) { answerDraft.current = (answerDraft.current + String(event.delta || "")).slice(-3000); setAssistant(answerDraft.current); setStatus("军师正在回答"); }
    if (event.type === "response.audio.delta" && typeof event.delta === "string") { if (waitingAt.current) { setResponseMs(Date.now() - waitingAt.current); waitingAt.current = 0; } play(event.delta); }
    if (event.type === "response.done" && !value.userSpeaking) { finishAnswer(); setStatus("可以继续说，也可点打断接着讲"); }
  }
  async function start() {
    const value = live.current, owner = ownerRef.current;
    if (value.active || value.closing || testActive.current || phase !== "idle" || !owner || !consent) return;
    if (subject && !memoryConsent) { setError("请同意本次参考所选人物档案，或选择不使用档案。"); return; }
    const generation = ++value.generation, active = () => mounted.current && generation === value.generation && ownerRef.current === owner;
    value.active = true; value.started = false; value.muted = false; value.userSpeaking = false; value.echo.reset(); value.lastEchoAt = 0;
    transcript.current = []; transcriptSubject.current = subject; answerDraft.current = ""; endSeen.current = false; waitingAt.current = 0; setTurns([]); setNotice(""); setDeadline(0); setResponseMs(null);
    setPhase("connecting"); setStatus("正在确认账号与语音服务…"); setError(""); setYou(""); setAssistant(""); setSeconds(0);
    value.timeout = setTimeout(() => { if (active()) { setError("语音连接超时，请检查网络与麦克风权限后重试。"); void endCall("连接超时"); } }, 30_000);
    try {
      value.audio = new AudioContext(); await value.audio.resume(); if (!active()) return;
      const fresh = await api("/api/account/credits"); if (!active()) return;
      if (fresh.account?.userId !== owner) { void account.refresh(); throw new Error("账号已变化，请确认当前账号后重新开始。"); }
      const accessError = voiceAccessError(fresh); if (accessError) throw new Error(accessError);
      const readiness = await api("/api/web/voice-live/status"); if (!active()) return;
      if (readiness.configured === false) throw new Error("语音服务暂未就绪，请稍后重试或使用文字咨询。");
      if (typeof readiness.remaining === "number" && readiness.remaining <= 0) throw new Error("今天的语音通话次数已用完，明天可继续使用。");
      setStatus("正在打开麦克风…");
      const microphone = await openMicrophone(samples => {
        if (active() && !value.muted) inputLevel(samples);
        if (!active() || !value.started || value.muted || value.socket?.readyState !== WebSocket.OPEN) return;
        if (value.socket.bufferedAmount > 512000) { setError("网络传输持续积压，已停止录音。请换到稳定网络后重试。"); void endCall("网络暂时不稳定"); return; }
        if (audioMode === "speaker" && value.echo.isEcho(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength), value.audio?.currentTime || 0)) { value.lastEchoAt = Date.now(); return; }
        value.socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcmBase64(samples) }));
      }, { echoCancellation: audioMode === "speaker", onEnded: () => { if (active()) { setError("麦克风已停止，本次通话已结束。你可以检查设备后重新开始。"); void endCall(); } } });
      if (!active()) { await microphone.close(); return; } value.microphone = microphone;
      requestId.current ||= crypto.randomUUID(); const query = new URLSearchParams({ requestId: requestId.current }); if (subject) { query.set("subjectId", subject); query.set("profileConsent", "1"); }
      const socket = new WebSocket(`${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/web/voice-live?${query}`); value.socket = socket;
      socket.onopen = () => { if (active()) setStatus("连接成功，正在启动语音模型…"); };
      socket.onmessage = event => { if (typeof event.data === "string" && active()) receive(event.data, generation); };
      const fail = () => { if (!active() || value.socket !== socket || endSeen.current) return; setError("语音连接中断，已停止麦克风。可重新开始，或使用文字咨询；未生成语音回应会退回预留积分。"); void endCall("通话已中断"); };
      socket.onerror = fail; socket.onclose = fail;
      value.playbackTimer = setInterval(() => { if (active() && value.audio && value.nextPlay > value.audio.currentTime && value.socket?.readyState === WebSocket.OPEN) value.socket.send(JSON.stringify({ type: "gateway.playback" })); }, 700);
    } catch (e) { if (active()) { setError(micError(e)); await endCall("通话未能开始"); } }
  }
  function toggleMute() { const next = !live.current.muted; live.current.muted = next; setMuted(next); if (next) setLevel(0); }
  const remaining = phase === "talking" ? Math.max(0, deadline ? Math.ceil((deadline - Date.now()) / 1000) : 180 - seconds) : 180;
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <><WebNav/><main className={styles.page}><AuroraPageHero eyebrow="把话说出来，一起理清楚" title="和成子语音聊" description="不用组织好再开口。从你最在意的那件事开始。"/><AccountNotice state={account}/><div className="voice-layout"><section className="wa-card wa-voice-card voice-console" data-phase={phase}><div className="voice-console-top"><span><span className={phase === "talking" ? "voice-live-dot active" : "voice-live-dot"}/>{phase === "talking" ? "通话进行中" : phase === "connecting" ? "正在连接" : "实时语音空间"}</span><span><ShieldCheck size={15}/>结束即停止录音</span></div><div className="voice-stage" data-active={phase === "talking" && !muted}><div className={styles.voiceLens} aria-hidden="true">{muted ? <MicOff size={43} strokeWidth={1.3}/> : <AudioLines size={43} strokeWidth={1.3}/>}</div><span className="voice-stage-caption">{subject ? "带着你们的故事，继续聊" : "这里，有人认真听你说"}</span></div><div className="voice-sound-level" aria-label={muted ? "麦克风已静音" : "麦克风输入音量"}>{[.3,.5,.7,.45,.9,1,.8,.55,.85,.65,.4,.25].map((height, index) => <i key={index} style={{ height: `${4 + (muted ? 0 : level) * height * 28}px` }}/>)}</div><p className="wa-voice-status" role="status">{muted && phase === "talking" ? "麦克风已静音，你仍能听到成子的声音" : status}</p>{phase === "talking" ? <div className="voice-session-meta"><span><Clock3 size={14}/>{duration}</span><span data-ending={remaining <= 30}>剩余 {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span>{responseMs !== null && <span><Activity size={14}/>首段声音 {(responseMs / 1000).toFixed(1)} 秒</span>}</div> : <p className="voice-invitation">{turns.length ? "聊过的内容留在下方，随时整理下一步。" : "可以聊一段关系、一句没想好怎么回的话，或者你的感受。"}</p>}
      {phase === "idle" && <label className="wa-check voice-consent"><input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); setError(""); }}/>同意处理本次语音，每次 {priceLabel(account.account, "voice")}，最长 3 分钟。<DataProcessingLink/></label>}
      <div className="wa-actions voice-controls">{phase === "idle" ? <button className="wa-primary voice-start" disabled={!consent || testing || !account.account?.prices || !account.account?.account?.userId} onClick={() => void start()}><Phone size={19}/>{turns.length ? "开始新通话" : "开始通话"} · {priceLabel(account.account, "voice")}</button> : <><button className="voice-end" disabled={phase === "ending"} onClick={() => void endCall()}><PhoneOff size={20}/>{phase === "ending" ? "正在结束…" : "结束通话"}</button>{phase === "talking" && <><button onClick={toggleMute} aria-pressed={muted}>{muted ? <Mic size={19}/> : <MicOff size={19}/>} {muted ? "开启麦克风" : "静音"}</button><button onClick={interruptNow}><Square size={16}/>打断，我来说</button></>}</>}</div><ErrorNotice error={error}/>{phase === "idle" && error && <p className="voice-retry-note">已停止本次录音。确认权限与网络后，勾选同意即可重新开始。</p>}<div className="voice-console-bottom"><span><CoinsMark/>{account.loading ? "正在确认账户" : account.unauthorized ? "登录后查看积分" : `可用 ${account.account?.account?.balance ?? "—"} 积分`}</span><a href={`/chat?subjectId=${encodeURIComponent(subject)}`}><MessageCircle size={15}/>改用文字 <ArrowRight size={14}/></a></div></section>
      <aside className="voice-side"><section className="voice-setup"><h2><Settings2 size={18}/>这次怎么聊</h2><PersonSelect people={account.people} value={subject} disabled={phase !== "idle" || testing} onChange={value => { setSubject(value); setMemoryConsent(false); }}/>{subject && <label className="wa-check"><input type="checkbox" checked={memoryConsent} disabled={phase !== "idle"} onChange={e => setMemoryConsent(e.target.checked)}/>同意本次参考所选人物的已确认资料。</label>}<fieldset className="wa-voice-modes" disabled={phase !== "idle" || testing}><legend>收听方式</legend><div className="wa-actions">{[["speaker", "手机免提"], ["headphones", "已戴耳机"]].map(([value, label]) => <button type="button" key={value} aria-pressed={audioMode === value} onClick={() => setAudioMode(value)}>{value === "speaker" ? <Volume2 size={17}/> : <Headphones size={17}/>} {label}</button>)}</div><p>{audioMode === "speaker" ? "免提会尝试过滤回声；环境嘈杂时建议戴耳机。" : "耳机能减少回声，边听边说更自然。"}</p></fieldset><div className="voice-mic-test"><div><Mic size={17}/><b>先试试麦克风</b><small>免费 · 仅在本机检测</small></div><p>测试不会上传声音，也不会开始计费通话。</p><button type="button" disabled={phase !== "idle"} onClick={() => testing ? void stopMicTest("检测已停止。") : void checkMicrophone()}>{testing ? <Square size={15}/> : <Mic size={16}/>} {testing ? "停止检测" : "检测麦克风"}</button>{micStatus && <p className="voice-mic-result" role="status">{micStatus}</p>}</div></section><section className="voice-help"><h2>聊得更顺的小提示</h2><div><Headphones size={19}/><p><b>建议先戴好耳机</b><span>音量保持舒适，减少扬声器回声。</span></p></div><div><Square size={17}/><p><b>随时可以接过话</b><span>点“打断，我来说”立即停止播报，再说你的想法。</span></p></div><div><Clock3 size={18}/><p><b>本次最多 3 分钟</b><span>最后 30 秒会提醒；锁屏或离开页面会结束通话。</span></p></div><details><summary>积分怎么计？</summary><p>打开页面和检测麦克风都不扣积分。开始连接时暂留 {priceLabel(account.account, "voice")}；收到军师语音回应后计费。连接失败或没有生成语音回应，预留积分会退回。</p><a href="/account#balance">查看积分与联系开通 <ArrowRight size={14}/></a></details></section></aside>
    </div>{(turns.length > 0 || you || assistant) && <section className="voice-transcript"><div className="voice-transcript-heading"><div><span className="wa-eyebrow">留住刚刚想清楚的事</span><h2>本次对话</h2><p>自动转写可能有误差，仅保留当前页面，刷新后清除。</p></div><div><button disabled={!turns.length} onClick={() => void copyTranscript()}><Copy size={15}/>复制文字</button><button disabled={!turns.length || phase === "connecting" || phase === "ending"} onClick={() => void continueInText()}><MessageCircle size={15}/>带着这些继续聊<ArrowRight size={15}/></button></div></div><div className="voice-transcript-list">{turns.map((turn,index) => <article className="wa-chat-message" data-role={turn.role} key={index}><small>{turn.role === "user" ? "我" : "成子智能体"}</small><p>{turn.text}</p></article>)}{assistant && answerDraft.current && <article className="wa-chat-message" aria-live="polite"><small>成子智能体 · 正在回答</small><p>{assistant}</p></article>}</div>{notice && <p className="voice-save-notice" role="status"><Check size={16}/>{notice}</p>}</section>}<div className="voice-bottom-note"><ShieldCheck size={16}/>你可以暂停、打断或结束。下一步怎么做，始终由你决定。</div></main></>;
}
function CoinsMark() { return <span className="voice-coins-symbol" aria-hidden="true">·</span>; }
