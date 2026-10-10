"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ImagePlus, ShieldCheck, X } from "lucide-react";
import type { ProfileState } from "@/lib/profile";
import type { RiskReport } from "@/lib/risk";
import type { KnowledgeSource } from "@/lib/knowledge-public";
import { KnowledgeBasis } from "@/components/KnowledgeBasis";

type Result = RiskReport & { knowledgeSources?: KnowledgeSource[] };
const labels = { clarify: "值得澄清", boundary: "注意边界", safety: "优先保护自己" };

export default function RiskPage() {
  const [text, setText] = useState("");
  const [goal, setGoal] = useState("");
  const [image, setImage] = useState("");
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needLogin, setNeedLogin] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void fetch("/api/profile", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as ProfileState;
      setProfile(data);
      const requested = new URLSearchParams(window.location.search).get("subjectId");
      if (data.subjects.some((subject) => subject.id === requested)) setSubjectId(requested || "");
    }).catch(() => {});
  }, []);
  async function readImage(file?: File) {
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5_000_000) { setError("请选 5 MB 内的 PNG、JPG 或 WebP 截图。"); return; }
    const reader = new FileReader();
    reader.onload = () => { setImage(String(reader.result)); setError(""); setResult(null); };
    reader.onerror = () => setError("截图读取失败，请重新选择。");
    reader.readAsDataURL(file);
  }
  async function analyze() {
    if (busy || (!text.trim() && !image)) return;
    setBusy(true); setError(""); setResult(null); setNeedLogin(false);
    try {
      const response = await fetch("/api/risk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, image: image || undefined, goal, subjectId: subjectId || null }) });
      const data = await response.json() as Result & { error?: string };
      if (!response.ok) { if (response.status === 401) setNeedLogin(true); throw new Error(data.error || "暂时无法分析。"); }
      setResult(data);
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "连接失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <main className="risk-page"><div className="risk-wrap"><header className="profile-top"><a className="back-link" href="/"><ArrowLeft size={18} /> 返回军师</a><a href="/library">查看知识与方法</a></header><section className="risk-intro"><span className="risk-kicker"><ShieldCheck size={18} /> 关系预警</span><h1>有些不舒服，<br />值得认真看一看。</h1><p>关系目标是否一致、投入是否互相、边界有没有被尊重。把具体经历发来，看看哪些信号需要核对，下一步如何保护自己。</p></section><section className="risk-form"><fieldset disabled={busy}><label className="field"><span>最近发生了什么？</span><textarea rows={6} maxLength={6000} value={text} onChange={(event) => { setText(event.target.value); setResult(null); }} placeholder="例如：我希望认真交往，但对方一直回避讨论关系……请写明谁说了什么、发生过几次，以及你表达意愿后对方怎么回应。" /></label><label className="field"><span>你希望怎样的关系？（可选）</span><input value={goal} maxLength={300} onChange={(event) => { setGoal(event.target.value); setResult(null); }} placeholder="例如：认真交往，或者还在了解、不急着确认" /></label>{profile?.enabled && !profile.paused && profile.subjects.length > 0 && <label className="field"><span>结合已有对象档案</span><select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setResult(null); }}><option value="">只看本次材料</option>{profile.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.label}</option>)}</select></label>}<input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void readImage(event.target.files?.[0])} /><div className="risk-upload"><button type="button" onClick={() => inputRef.current?.click()}><ImagePlus size={18} /> {image ? "换一张截图" : "也可以提供聊天截图"}</button><span>请说明双方是谁</span></div>{image && <div className="risk-image"><img src={image} alt="准备分析的聊天截图" /><button type="button" onClick={() => { setImage(""); setResult(null); }} aria-label="移除截图"><X size={17} /></button></div>}<button className="risk-submit" type="button" disabled={busy || (!text.trim() && !image)} onClick={() => void analyze()}>{busy ? "正在核对具体信号…" : "看看哪些信号值得留意"}</button></fieldset><p className="risk-privacy">只分析你主动提供的材料，不监控聊天。材料由千问处理，原图和原文不写入长期档案。</p>{error && <p className="import-error" role="alert">{error} {needLogin && <a href="/login?return_to=%2Frisk">去登录 →</a>}</p>}</section><div ref={resultRef} aria-live="polite">{busy && <p className="risk-loading" role="status">结合你的目标与材料，区分具体行为、可能解释和需要确认的事。</p>}{result && <section className="risk-results"><h2>这段材料里的关系提醒</h2><p className="risk-summary">{result.summary}</p>{result.alerts.length ? result.alerts.map((alert, index) => <article className={"risk-alert " + alert.level} key={index}><span className="risk-level">{labels[alert.level]}</span><h3>{alert.title}</h3><blockquote>{alert.evidence}</blockquote><small>依据：你提供的文字或截图，请核对原话与说话人</small><div><strong>仍需核对</strong><p>{alert.uncertainty}</p></div><div className="risk-action"><strong>你可以怎么做</strong><p>{alert.nextStep}</p></div></article>) : <p className="risk-empty">目前没有足够材料形成具体提醒。这不代表整段关系已通过安全验证，可以补充后续互动再看。</p>}{result.questions.length > 0 && <div className="risk-questions"><h3>这些信息会帮助进一步判断</h3><ul>{result.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></div>}<KnowledgeBasis sources={result.knowledgeSources} /><p className="risk-privacy">提醒针对可观察行为与关系目标，不给对方定性，也不提供恶意、忠诚或短期意图的概率。</p></section>}</div></div></main>;
}
