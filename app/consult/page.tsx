"use client";
import { BrandMark } from "@/components/BrandMark";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Compass, Copy, ImagePlus, MessageCircle, Mic, PhoneOff, ScanEye, X } from "lucide-react";
import type { ProfileState } from "@/lib/profile";
import { CasePreview } from "@/components/CasePreview";
import { KnowledgeProof } from "@/components/KnowledgeProof";
import { KnowledgeBasis } from "@/components/KnowledgeBasis";
import { ReplyPaths } from "@/components/ReplyPaths";
import type { KnowledgeSource } from "@/lib/knowledge-public";
import type { ReplyPaths as Paths } from "@/lib/reply-paths";

type Mode = "reply" | "signal" | "decision";
type ReplyOption = { label: string; text: string; when: string; next?: Paths };
type VoiceRecap = { assessment: string; known: string; unknown: string; nextStep: string };
type Turn = { role: "user" | "assistant"; text: string; displayText?: string; replyOptions?: ReplyOption[]; knowledgeSources?: KnowledgeSource[]; image?: string; recap?: VoiceRecap; recapId?: string };
const modes: { id: Mode; title: string; hint: string; starter: string }[] = [
  { id: "reply", title: "不知道怎么回", hint: "给我自然、不越界的回复", starter: "对方说了……，我想表达……。这句怎么回更自然？" },
  { id: "signal", title: "看不懂 TA 的态度", hint: "分清事实和可能的解释", starter: "最近发生了……。这些行为说明什么？哪些地方还不能确定？" },
  { id: "decision", title: "纠结要不要继续", hint: "梳理选择和下一步", starter: "我们现在的情况是……。我纠结要不要继续投入，帮我梳理利弊和下一步。" },
];

export default function Home() {
  const [mode, setMode] = useState<Mode>("reply");
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [memoryNotice, setMemoryNotice] = useState("");
  const [voice, setVoice] = useState<"idle" | "connecting" | "live">("idle");
  const [auth, setAuth] = useState<"loading" | "signed-in" | "signed-out">("loading");
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceTranscriptRef = useRef<string[]>([]);
  const voiceConversationRef = useRef<Array<{ role: "user" | "assistant"; text: string }>>([]);

  useEffect(() => { if (turns.length) bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy, error]);
  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store" }).then(async (response) => {
      const session = await response.json() as { loggedIn?: boolean };
      setAuth(session.loggedIn ? "signed-in" : "signed-out");
    }).catch(() => setAuth("signed-out"));
    const params = new URLSearchParams(window.location.search);
    const selected = params.get("subjectId");
    const prompt = params.get("prompt");
    window.setTimeout(() => {
      if (selected) setSubjectId(selected);
      if (prompt) setDraft(prompt);
    }, 0);
    void fetch("/api/profile", { cache: "no-store" }).then(async (response) => {
      if (response.ok) setProfile(await response.json() as ProfileState);
    }).catch(() => { /* The chat still works without saved profiles. */ });
  }, []);
  useEffect(() => () => { peerRef.current?.close(); streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  function stopVoice() {
    const spoken = voiceTranscriptRef.current.splice(0).join("\n").slice(0, 4000);
    const conversation = voiceConversationRef.current.splice(0).slice(-24).map((turn) => ({ role: turn.role, text: turn.text.slice(0, 500) }));
    if (spoken.trim().length >= 8 && conversation.length) {
      const recapId = crypto.randomUUID();
      setTurns((current) => [...current, { role: "assistant", text: "正在整理这次通话的关系总结…", recapId }]);
      void fetch("/api/voice/summary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: conversation, subjectId: subjectId || null }),
      }).then(async (response) => {
        const result = await response.json() as { recap?: VoiceRecap; error?: string };
        if (!response.ok || !result.recap) throw new Error(result.error || "通话总结暂时没能生成。");
        const recap = result.recap;
        const text = ["通话总结：" + recap.assessment, "已知：" + recap.known, "待验证：" + recap.unknown, "下一步：" + recap.nextStep].join("\n");
        setTurns((current) => current.map((turn) => turn.recapId === recapId ? { ...turn, text, recap } : turn));
      }).catch((cause) => {
        setTurns((current) => current.map((turn) => turn.recapId === recapId ? { ...turn, text: cause instanceof Error ? cause.message : "通话总结暂时没能生成。" } : turn));
      });
    }
    if (spoken && profile?.enabled && !profile.paused) {
      setMemoryNotice("正在整理这次语音对话的待确认信息…");
      void fetch("/api/profile/suggest", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: spoken, subjectId: subjectId || null }),
      }).then(async (response) => {
        if (!response.ok) throw new Error("语音档案整理未完成。");
        const result = await response.json() as { pendingCount: number; createdSubjectId: string | null };
        const stateResponse = await fetch("/api/profile", { cache: "no-store" });
        if (stateResponse.ok) setProfile(await stateResponse.json() as ProfileState);
        if (result.createdSubjectId) setSubjectId(result.createdSubjectId);
        setMemoryNotice(result.createdSubjectId ? "语音里提到的新对象已建为待确认草稿。" : result.pendingCount ? "语音里整理出 " + result.pendingCount + " 条待确认信息。" : "这次语音没有需要更新的档案信息。");
      }).catch(() => setMemoryNotice("语音档案整理未完成，不影响对话。"));
    }
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioRef.current) audioRef.current.srcObject = null;
    peerRef.current = null;
    channelRef.current = null;
    streamRef.current = null;
    setVoice("idle");
  }

  async function startVoice() {
    if (voice !== "idle") { stopVoice(); return; }
    setError("");
    setVoice("connecting");
    voiceTranscriptRef.current = [];
    voiceConversationRef.current = [];
    try {
      const voiceUrl = "/api/voice?mode=" + mode + (subjectId ? "&subjectId=" + encodeURIComponent(subjectId) : "");
      const configResponse = await fetch(voiceUrl, { cache: "no-store" });
      const config = await configResponse.json() as { session?: Record<string, unknown>; error?: string };
      if (!configResponse.ok || !config.session) throw new Error(config.error || "双工语音尚未配置。");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const pc = new RTCPeerConnection();
      peerRef.current = pc;
      const remote = new Audio();
      remote.autoplay = true;
      audioRef.current = remote;
      pc.ontrack = (event) => { remote.srcObject = event.streams[0]; };
      pc.onconnectionstatechange = () => {
        if (["failed", "closed", "disconnected"].includes(pc.connectionState)) stopVoice();
        else tryInitialize();
      };
      const audioSender = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
      let sessionCreated = false;
      let updateSent = false;
      let modelReady = false;
      const pendingCalls = new Set<string>();
      function tryInitialize() {
        const channel = channelRef.current;
        if (!channel || channel.readyState !== "open" || !sessionCreated || updateSent || pc.connectionState !== "connected") return;
        channel.send(JSON.stringify({ type: "session.update", session: config.session }));
        updateSent = true;
      }
      function bindChannel(channel: RTCDataChannel) {
        channel.onopen = tryInitialize;
        channel.onmessage = async (message) => {
        try {
          const event = JSON.parse(message.data);
          if (event.type === "session.created") {
            sessionCreated = true;
            channelRef.current = channel;
            tryInitialize();
          }
          if (event.type === "session.updated" && updateSent && !modelReady) {
            modelReady = true;
            await audioSender.replaceTrack(stream.getAudioTracks()[0]);
            setVoice("live");
          }
          if (event.type === "response.function_call_arguments.done" && event.call_id && !pendingCalls.has(event.call_id)) {
            pendingCalls.add(event.call_id);
            void analyzeVoiceCall({ call_id: event.call_id, arguments: event.arguments }, channel);
          }
          if (event.type === "error") setError(event.error?.message || "语音服务出现错误，请重新连接。");
          if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
            voiceTranscriptRef.current.push(String(event.transcript));
            voiceConversationRef.current.push({ role: "user", text: String(event.transcript) });
            setTurns((current) => [...current, { role: "user", text: event.transcript }]);
          }
          if (event.type === "response.audio_transcript.done" && event.transcript) {
            voiceConversationRef.current.push({ role: "assistant", text: String(event.transcript) });
            setTurns((current) => [...current, { role: "assistant", text: event.transcript }]);
          }
        } catch { /* Some events are not JSON. */ }
        };
      }
      pc.ondatachannel = ({ channel }) => bindChannel(channel);
      bindChannel(pc.createDataChannel("oai-events"));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // The Model Studio endpoint requires the complete ICE candidates in the forwarded SDP.
      if (pc.iceGatheringState !== "complete") await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 5000);
        pc.addEventListener("icegatheringstatechange", () => {
          if (pc.iceGatheringState === "complete") { window.clearTimeout(timeout); resolve(); }
        }, { once: false });
      });
      const response = await fetch(voiceUrl, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: pc.localDescription?.sdp || offer.sdp });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || "语音连接失败，请稍后重试。");
      }
      await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
    } catch (cause) {
      stopVoice();
      setError(cause instanceof Error ? cause.message : "无法使用麦克风，请检查浏览器权限。");
    }
  }

  async function analyzeVoiceCall(call: { call_id: string; arguments?: string }, channel: RTCDataChannel) {
    let output = JSON.stringify({ error: "分析服务暂不可用，请提醒用户稍后再试，不要自行编造结论。" });
    try {
      const args = JSON.parse(call.arguments || "{}") as { query?: string };
      const response = await fetch("/api/voice/delegate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: args.query, mode, subjectId: subjectId || null }),
      });
      const result = await response.json() as { text?: string; error?: string };
      if (response.ok && result.text) output = JSON.stringify({ analysis: result.text });
      else if (result.error) output = JSON.stringify({ error: result.error });
    } catch { /* Continue the voice conversation with an explicit analysis failure. */ }
    if (channel.readyState !== "open") return;
    channel.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output } }));
    channel.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio", "text"] } }));
  }

  function onFile(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setError("请上传 PNG、JPG 或 WebP 图片。"); return; }
    if (file.size > 5 * 1024 * 1024) { setError("图片请控制在 5 MB 以内。"); return; }
    const reader = new FileReader();
    reader.onload = () => { setImage(String(reader.result)); composerRef.current?.focus(); };
    reader.readAsDataURL(file);
    setError("");
  }

  async function send() {
    const text = draft.trim();
    if ((!text && !image) || busy) return;
    const next: Turn = { role: "user", text: text || "请分析这张聊天截图。", image: image || undefined };
    const history = [...turns, next];
    setTurns(history);
    setDraft("");
    setImage(null);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, subjectId: subjectId || null, turns: history.slice(-10) }),
      });
      const data = await response.json() as { error?: string; text?: string; displayText?: string; replyOptions?: ReplyOption[]; knowledgeSources?: KnowledgeSource[] };
      if (!response.ok) throw new Error(data.error || "暂时无法分析，请重试。");
      setTurns((current) => [...current, { role: "assistant", text: data.text || "这次没有生成分析，请重试。", displayText: data.displayText, replyOptions: data.replyOptions, knowledgeSources: data.knowledgeSources }]);
      if (profile?.enabled && !profile.paused && (next.text.length > 5 || next.image)) {
        setMemoryNotice("正在从本轮对话整理待确认的信息…");
        void fetch("/api/profile/suggest", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: next.text, image: next.image, subjectId: subjectId || null }),
        }).then(async (response) => {
          if (!response.ok) throw new Error("这轮档案整理未完成，不影响对话。");
          const result = await response.json() as { pendingCount: number; createdSubjectId: string | null };
          const stateResponse = await fetch("/api/profile", { cache: "no-store" });
          if (stateResponse.ok) setProfile(await stateResponse.json() as ProfileState);
          if (result.createdSubjectId) setSubjectId(result.createdSubjectId);
          setMemoryNotice(result.createdSubjectId ? "发现一位新对象，已建立待确认草稿。" : result.pendingCount ? "整理出 " + result.pendingCount + " 条待确认信息。" : "这轮没有需要更新的档案信息。");
        }).catch(() => setMemoryNotice("这轮档案整理未完成，不影响对话。"));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "网络连接失败，请重试。"); }
    finally { setBusy(false); }
  }

  function startWith(nextMode: Mode) {
    setMode(nextMode);
    if (!draft.trim()) setDraft(modes.find((item) => item.id === nextMode)?.starter || "");
    composerRef.current?.focus();
  }

  function followUp(nextMode: Mode, prompt: string) {
    setMode(nextMode);
    setDraft(prompt);
    composerRef.current?.focus();
  }

  async function copyAnswer(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch { setError("复制失败，请长按回答选择文字。"); }
  }

  const hasReplyOptions = turns[turns.length - 1]?.replyOptions?.length === 3;
  if (auth !== "signed-in") return <main className="login-screen"><div className="login-showcase"><div className="showcase-intro"><span className="showcase-kicker">成子 · 关系决策助手</span><h1>不知道怎么回？<br />先把聊天发来。</h1><p>选截图，确认哪边是你，再看解读和回复建议。</p></div><KnowledgeProof /></div><div className="login-panel"><a className="login-brand" href="/"><span className="brand-mark"><BrandMark/></span><span>成子</span></a><h2>{auth === "loading" ? "正在确认登录状态…" : "先解决眼前这段聊天"}</h2><p>网页版登录后可以保存报告；微信小程序可直接用微信身份开始。</p>{auth === "signed-out" && <a className="login-primary-link" href="/login">登录网页版 →</a>}<a className="knowledge-login-link" href="/crush">先看截图解读示例 →</a><a className="knowledge-login-link" href="/library#research">查看研究依据 →</a></div></main>;

  return <main className="app-shell"><div className="phone-shell">
    <header className="topbar"><div className="brand-mark">成</div><div className="brand-copy"><strong>成子</strong><span>你的关系决策助手</span></div><div className="topbar-links"><a className="profile-link" href="/crush">逐句解读</a><a className="profile-link" href="/wechat">微信随手聊</a><a className="profile-link" href="/positioning">择偶定位</a><a className="profile-link" href="/history">电脑端聊天档案</a><a className="profile-link" href="/import">导入记录</a><a className="profile-link" href="/account">账户与积分</a><a className="profile-link" href="/profile">关系档案{profile?.facts.some((fact) => fact.status === "pending") ? " · 待确认" : ""}</a><a className="profile-link" href="/logout">退出</a></div><button className="new-chat" type="button" onClick={() => { stopVoice(); setTurns([]); setMode("reply"); setDraft(""); setImage(null); setError(""); setMemoryNotice(""); }}>新对话</button></header>
    <div className="chat-scroll">
      {profile?.enabled && profile.subjects.length > 0 && <label className="subject-selector">当前讨论对象<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">先不指定</option>{profile.subjects.map((item) => <option key={item.id} value={item.id}>{item.label}{item.status === "draft" ? "（待确认）" : ""}</option>)}</select></label>}
      {memoryNotice && <div className={"memory-notice " + (memoryNotice.includes("未完成") ? "warning" : "")}>{memoryNotice} <a href="/profile">查看档案</a></div>}
      {turns.length === 0 && <section className="welcome">
        <div className="welcome-hero"><div className="welcome-copy"><span className="hero-kicker">关系分析工作台</span><h1>一段聊天，<br />别急着下结论。</h1>
        <p>先看事实，再看可能性。给你能执行的下一步，也说明什么时候该改变判断。</p></div><div className="welcome-stamp" aria-hidden="true"><span>01 事实</span><span>02 推测</span><span>03 行动</span></div></div>
        <div className="entry-actions"><button type="button" onClick={() => fileRef.current?.click()}><ImagePlus size={17} /> 分析一张聊天截图</button><button type="button" onClick={() => composerRef.current?.focus()}><MessageCircle size={17} /> 直接说说发生了什么</button></div>
        <KnowledgeProof />
        <CasePreview compact />
        <div className="mode-heading"><span>按问题切入</span><small>也可以不选，直接在下方输入</small></div>
        <div className="mode-list" role="group" aria-label="选择分析方式">{modes.map((item) =>
          <button key={item.id} className={"mode-card " + (mode === item.id ? "selected" : "")} type="button" aria-pressed={mode === item.id} onClick={() => startWith(item.id)}>
            <span className="mode-icon" aria-hidden="true">{item.id === "reply" ? <MessageCircle size={21} /> : item.id === "signal" ? <ScanEye size={21} /> : <Compass size={21} />}</span><span className="mode-text"><strong>{item.title}</strong><small>{item.hint}</small></span><span className="mode-arrow" aria-hidden="true">→</span>
          </button>)}</div>
        <div className="welcome-actions"><a href="/crush">粘贴聊天 · 逐句解读</a><span>想聊长期选择？</span><a href="/positioning">做择偶定位</a><a href="/profile">建立关系档案</a><a href={"/import" + (subjectId ? "?subjectId=" + encodeURIComponent(subjectId) : "")}>导入长记录</a></div>
        <div className="message-review-entry"><button type="button" onClick={() => followUp("reply", "我准备发给对方：……。我们现在的关系是……，我想表达的是……。请先帮我看这段话可能带来什么影响，再给更自然的表达和不同回应下的下一步。")}>发送前，帮我看一下这句话</button><a href={"/risk" + (subjectId ? "?subjectId=" + encodeURIComponent(subjectId) : "")}>关系预警 · 看看哪些信号值得留意</a></div>
      </section>}
      {turns.length > 0 && <div className="active-mode">{modes.find((item) => item.id === mode)?.title}</div>}
      <div className="conversation" aria-live="polite">{turns.map((turn, index) =>
        <div className={"turn " + turn.role} key={index}>{turn.role === "assistant" && <span className="assistant-mark">狗</span>}
          <div className="bubble">
            {turn.image && <img src={turn.image} alt="已上传的聊天截图" className="sent-image" />}
            {turn.recap ? <section className="voice-recap" aria-label="语音通话总结">
              <div className="voice-recap-title"><Mic size={16} /><strong>这次通话，先记住这几件事</strong></div>
              <p className="voice-recap-assessment">{turn.recap.assessment}</p>
              <dl><div><dt>已知事实</dt><dd>{turn.recap.known}</dd></div><div><dt>仍待验证</dt><dd>{turn.recap.unknown}</dd></div><div><dt>下一步</dt><dd>{turn.recap.nextStep}</dd></div></dl>
              <small>根据语音转写整理，可能有漏字；关系档案仍需你确认。</small>
            </section> : <div className="bubble-text">{turn.displayText || turn.text}</div>}
            {turn.replyOptions?.length === 3 && <div className="reply-options" aria-label="三种可选回复">{turn.replyOptions.map((option, optionIndex) => { const key = index + "-" + optionIndex; return <article className="reply-option" key={key}><div className="reply-option-head"><strong>{option.label}</strong><button type="button" onClick={() => void copyAnswer(option.text, key)}>{copiedKey === key ? <Check size={14} /> : <Copy size={14} />}{copiedKey === key ? "已复制" : "复制这句"}</button></div><p>{option.text}</p>{option.when && <small>适合：{option.when}</small>}<ReplyPaths paths={option.next} /></article>; })}<p className="reply-choice-note">选最像你的一句，发出前也可以自己改。</p></div>}
            {turn.role === "assistant" && <KnowledgeBasis sources={turn.knowledgeSources} />}
            {turn.role === "assistant" && !turn.replyOptions?.length && <div className="answer-actions"><button type="button" onClick={() => void copyAnswer(turn.text, String(index))}>{copiedKey === String(index) ? <Check size={14} /> : <Copy size={14} />}{copiedKey === String(index) ? "已复制" : "复制回答"}</button></div>}
          </div>
        </div>)}
        {turns.length > 0 && turns[turns.length - 1]?.role === "assistant" && <div className="next-step"><span>接下来你可以</span><div><button type="button" onClick={() => followUp(hasReplyOptions ? "signal" : "reply", hasReplyOptions ? "我发出刚才选的回复后，对方后来回应了……。请结合前面的情况，更新判断，不要只看这一句。" : "结合刚才的分析，给我一句自然、可以直接发给对方的话。")}>{hasReplyOptions ? "对方后来怎么回" : "要一句可发的话"}</button><button type="button" onClick={() => followUp(hasReplyOptions ? "reply" : "signal", hasReplyOptions ? "把刚才的三种回复改得更像我的说话习惯：简短、自然，不要油腻。" : "哪些是已知事实，哪些只是推测？我还该观察什么？")}>{hasReplyOptions ? "换成我的口吻" : "核对事实与猜测"}</button><button type="button" onClick={() => followUp("decision", "如果我想继续推进，下一步最稳妥的行动是什么？如果该停，也请直说。")}>确定下一步</button></div></div>}
        {busy && <div className="thinking"><span className="assistant-mark">狗</span><span>在整理你提供的信息…</span></div>}
      </div><div ref={bottomRef} />
    </div>
    <footer className="composer-wrap">
      <nav className="quick-nav" aria-label="主要功能"><span className="current">对话</span><a href="/crush">逐句解读</a><a href="/wechat">微信聊</a><a href="/positioning">择偶定位</a><a href="/import">导入记录</a><a href="/profile">关系档案</a><a href="/logout">退出</a></nav>
      {error && <div className="error-message" role="alert">{error}</div>}
      {voice !== "idle" && <div className="voice-banner"><span className="voice-pulse" />{voice === "connecting" ? "正在连接语音…" : "语音对话中 · 结束后会整理要点"}<button type="button" onClick={stopVoice} aria-label="结束语音"><PhoneOff size={18} /></button></div>}
      {image && <div className="image-preview"><img src={image} alt="待发送截图" /><button type="button" onClick={() => setImage(null)} aria-label="移除截图"><X size={17} /></button></div>}
      <div className="composer">
        <button type="button" className="icon-button" onClick={() => fileRef.current?.click()} aria-label="上传聊天截图"><ImagePlus size={22} /></button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => onFile(event.target.files?.[0])} />
        <textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="说说发生了什么，或贴一张截图…" rows={1} aria-label="输入你的问题" />
        <button type="button" className={"icon-button mic-button " + (voice !== "idle" ? "on" : "")} onClick={startVoice} aria-label={voice === "idle" ? "开始实时语音" : "结束实时语音"}><Mic size={21} /></button>
        <button type="button" className="send-button" disabled={busy || (!draft.trim() && !image)} onClick={send} aria-label="发送消息"><ArrowUp size={22} /></button>
      </div><div className="footer-note">档案需你主动同意；截图原图不会存入档案。上传前请遮盖手机号等隐私信息。</div>
    </footer>
  </div></main>;
}


