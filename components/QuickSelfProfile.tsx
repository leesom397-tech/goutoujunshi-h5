"use client";
import { DataProcessingLink } from "@/components/DataProcessingLink";
import { useEffect, useRef, useState } from "react";
import { Check, Camera, HeartHandshake, Mic, Square, Sparkles, ArrowUpRight, MessageCircle, BookmarkCheck } from "lucide-react";
import type { SelfData } from "@/lib/profile";
import { extractQuickSelfProfile } from "@/lib/personal-context";
import { quickSelfFields, toggleSelfTag } from "@/lib/quick-self-profile";
import { api, hasPrice, priceLabel, useAccount, type Json } from "./web-analysis/client";
import { openMicrophone, wavBase64, type Microphone } from "./web-analysis/audio";
import styles from "./QuickSelfProfile.module.css";

type Props = { data: SelfData; busy: boolean; paused: boolean; enabled: boolean; onSave: (patch: Partial<SelfData>) => Promise<boolean> };
const groups = [
  { field: "interests", title: "平时喜欢什么", tags: ["摄影", "旅行", "阅读", "看展", "徒步", "健身", "音乐", "电影", "咖啡", "做饭", "游戏", "宠物"] },
  { field: "values", title: "相处时更在意", tags: ["真诚", "尊重边界", "独立空间", "共同成长", "稳定陪伴", "坦诚沟通"] },
  { field: "preferredRelationship", title: "现在期待的关系", tags: ["认真了解，发展长期关系", "希望合适时结婚", "先自然相处，慢慢了解"] },
  { field: "communicationStyle", title: "聊天习惯", tags: ["直接表达", "慢热一些", "喜欢简短自然", "愿意分享日常", "不喜欢被催回复"] },
] as const;

export function QuickSelfProfile(props: Props) {
  const account = useAccount();
  const owner = account.account?.account?.userId || "";
  return <QuickProfile key={owner || "pending"} {...props} owner={owner} account={account.account} />;
}
function QuickProfile({ data, busy, paused, enabled, onSave, owner, account }: Props & { owner: string; account: Json | null }) {
  const [mode, setMode] = useState<"tags" | "intro">("tags");
  const [patch, setPatch] = useState<Partial<SelfData>>({});
  const [intro, setIntro] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [audioConsent, setAudioConsent] = useState(false);
  const [pendingAudio, setPendingAudio] = useState<{ audio: string; requestId: string } | null>(null);
  const [evidence, setEvidence] = useState<{ field: string; quote: string }[]>([]);
  const recorder = useRef<Microphone | null>(null), chunks = useRef<Int16Array[]>([]);
  const active = useRef(true), capture = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seconds = useRef(0), [elapsed, setElapsed] = useState(0);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcription = useRef<AbortController | null>(null);
  const blocked = busy || paused || saving || transcribing || recording;
  const current = { ...data, ...patch };
  const edited = quickSelfFields.filter(([key]) => Object.prototype.hasOwnProperty.call(patch, key));
  const known = quickSelfFields.filter(([key]) => !!data[key]?.trim());

  function closeMic() {
    capture.current++;
    if (timer.current) clearTimeout(timer.current);
    if (interval.current) clearInterval(interval.current);
    timer.current = null; interval.current = null;
    const mic = recorder.current; recorder.current = null; void mic?.close().catch(() => {});
    if (active.current) setRecording(false);
  }
  useEffect(() => {
    active.current = true;
    const hide = () => { if (document.hidden) { closeMic(); chunks.current = []; } };
    document.addEventListener("visibilitychange", hide);
    return () => { active.current = false; closeMic(); chunks.current = []; transcription.current?.abort(); document.removeEventListener("visibilitychange", hide); };
  }, []);

  async function sameAccount() {
    const latest = await api("/api/account/credits");
    if (!owner || latest?.account?.userId !== owner) throw new Error("账号已变化，请刷新后继续。");
  }
  function organise() {
    const result = extractQuickSelfProfile(intro);
    const additions: Partial<SelfData> = {};
    for (const [key] of quickSelfFields) {
      const found = result.draft[key];
      if (!found) continue;
      const prior = current[key] || "";
      // A new introduction adds to an existing preference instead of silently replacing it.
      additions[key] = ["ageRange", "city"].includes(key) ? found : prior.includes(found) ? prior : [prior, found].filter(Boolean).join("；").slice(0, 800);
    }
    setPatch(value => ({ ...value, ...additions })); setEvidence(result.evidence); setNotice(result.notes[0]); setError("");
  }
  async function transcribe(payload: { audio: string; requestId: string }) {
    if (!audioConsent || !owner || transcribing) return;
    setTranscribing(true); setError("");
    const control = new AbortController(); transcription.current=control;
    try {
      await sameAccount(); if (!active.current) return;
      const result = await api("/api/web/transcribe", { ...payload, confirmed: true },control.signal);
      if (!active.current) return;
      await sameAccount(); if (!active.current) return;
      setIntro(value => [value, String(result.text || "")].filter(Boolean).join("\n").slice(0, 3000));
      setPendingAudio(null); setNotice("已转成文字，检查后点“整理成资料”。");
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "转写未完成，可重试同一段录音。"); }
    finally { if (transcription.current===control)transcription.current=null; if (active.current) setTranscribing(false); }
  }
  function stopRecording(cancel = false) {
    const audioChunks = chunks.current; chunks.current = []; closeMic();
    if (cancel || !audioChunks.length) return;
    const payload = { audio: wavBase64(audioChunks), requestId: crypto.randomUUID() };
    setPendingAudio(payload); void transcribe(payload);
  }
  async function startRecording() {
    if (blocked || !owner || !audioConsent || !hasPrice(account, "transcription")) return;
    setError(""); setNotice(""); setRecording(true); seconds.current = 0; setElapsed(0);
    const generation = ++capture.current; chunks.current = [];
    try {
      await sameAccount(); if (!active.current || generation !== capture.current) return;
      const mic = await openMicrophone(samples => {
        if (active.current && generation === capture.current) chunks.current.push(samples);
      }, { onEnded: () => { closeMic(); chunks.current = []; if (active.current) setError("麦克风已断开，可以重新录制。"); } });
      if (!active.current || generation !== capture.current) { await mic.close(); return; }
      recorder.current = mic;
      timer.current = setTimeout(() => stopRecording(), 29_000);
      interval.current = setInterval(() => { seconds.current++; setElapsed(seconds.current); }, 1000);
    } catch (cause) { if (active.current) { closeMic(); setError(cause instanceof Error ? cause.message : "无法打开麦克风，请直接输入。"); } }
  }
  async function save() {
    if (blocked || !edited.length || !owner) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await sameAccount(); if (!active.current) return;
      const ok = await onSave(patch);
      if (active.current && ok) { setPatch({}); setEvidence([]); setNotice("已保存。之后可用这些资料寻找共同点和更适合你的话题。"); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "保存未完成，草稿仍在。"); }
    finally { if (active.current) setSaving(false); }
  }
  return <section id="quick-self" className={styles.panel} aria-labelledby="quick-self-title">
    <header className={styles.header}><div><span className={styles.eyebrow}><Sparkles size={17}/>让成子更了解你</span><h2 id="quick-self-title">点几下，找到与你有关的线索</h2><p>先补充你愿意分享的部分。保存一次，以后分析都能用。</p></div><span className={styles.known}><BookmarkCheck size={20}/>{known.length ? "已有 " + known.length + " 类资料" : "随时可以补充"}</span></header>
    <div className={styles.methods}>
      <button type="button" disabled={recording || transcribing} aria-pressed={mode === "tags"} onClick={() => setMode("tags")}><HeartHandshake size={22}/><span><strong>点选几个标签</strong><small>兴趣、期待、聊天习惯</small></span></button>
      <button type="button" disabled={recording || transcribing} aria-pressed={mode === "intro"} onClick={() => setMode("intro")}><MessageCircle size={22}/><span><strong>说说你自己</strong><small>几句话，整理成资料</small></span></button>
      <a href="/analyze?mode=social&target=self&returnTo=%2Farchive%3Ftab%3Dself"><Camera size={22}/><span><strong>导入我的资料截图</strong><small>已有简介、朋友圈也能用</small></span><ArrowUpRight size={17}/></a>
    </div>
    {mode === "tags" ? <div className={styles.groups}>{groups.map(group => <fieldset key={group.field} disabled={blocked}><legend>{group.title}</legend><div className={styles.tags}>{group.tags.map(tag => {
      const selected = (current[group.field] || "").split(/[；;、\n]/).includes(tag);
      return <button type="button" aria-pressed={selected} key={tag} onClick={() => { setPatch(value => ({ ...value, [group.field]: toggleSelfTag(current[group.field] || "", tag).slice(0, 800) })); setNotice(""); }}>{selected && <Check size={15}/>} {tag}</button>;
    })}</div></fieldset>)}</div> : <div className={styles.intro}>
      <label htmlFor="self-intro">最近喜欢做什么，期待怎样的相处？</label>
      <textarea id="self-intro" maxLength={3000} value={intro} disabled={blocked} onChange={event => setIntro(event.target.value)} placeholder="例如：我喜欢摄影和徒步。我重视独立空间。我希望认真了解一个人。我聊天比较直接。" />
      <div className={styles.actions}><button type="button" className={styles.primary} disabled={blocked || !intro.trim()} onClick={organise}><Sparkles size={17}/>整理成资料 · 免费</button><small>按本人原话整理，下面可以修改。</small></div>
      <div className={styles.voice}><label><input type="checkbox" checked={audioConsent} disabled={recording || transcribing} onChange={event => setAudioConsent(event.target.checked)}/>语音可选：同意将这段录音转为文字，{priceLabel(account, "transcription")} / 次。<DataProcessingLink/></label><div className={styles.actions}>
        <button type="button" disabled={recording ? false : blocked || !owner || !audioConsent || !hasPrice(account, "transcription")} onClick={() => recording ? stopRecording() : void startRecording()}>{recording ? <Square size={17}/> : <Mic size={17}/>} {recording ? "停止并转文字 · " + elapsed + "s" : transcribing ? "转写中…" : "说一段 · 最多 30 秒"}</button>
        {recording && <button type="button" onClick={() => stopRecording(true)}>取消</button>}
        {pendingAudio && !recording && !transcribing && <><button type="button" disabled={!audioConsent} onClick={() => void transcribe(pendingAudio)}>重试这段转写</button><button type="button" onClick={() => setPendingAudio(null)}>丢弃录音</button></>}
      </div></div>
    </div>}
    {!!edited.length && <div className={styles.preview}><h3><Check size={19}/>确认一下，这些是你吗？</h3><div className={styles.fields}>{edited.map(([key, label]) => <label key={key}><span>{label}</span><textarea disabled={blocked} rows={2} maxLength={["city", "ageRange", "lifestyle"].includes(key) ? 100 : 800} value={patch[key] || ""} onChange={event => setPatch(value => ({ ...value, [key]: event.target.value }))}/>{evidence.find(item => item.field === key) && <small>来自你的介绍：{evidence.find(item => item.field === key)?.quote}</small>}</label>)}</div></div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
    <footer className={styles.footer}><p><strong>你决定保存什么。</strong>只使用你确认的资料；随时可修改、暂停或删除。{paused && "当前已暂停，请先恢复档案。"}</p><button type="button" className={styles.primary} disabled={blocked || !owner || !edited.length} onClick={() => void save()}><Check size={18}/>{saving ? "保存中…" : enabled ? "确认保存，用于后续分析" : "确认保存并启用资料"}</button></footer>
  </section>;
}
