"use client";
import { BrandMark } from "@/components/BrandMark";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronRight, ImagePlus, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import type { CrushResult } from "@/lib/crush/types";
import { probabilityText } from "@/lib/crush/types";
import { DecisionPanel } from "@/components/DecisionPanel";

type Status = {
  enabled: boolean;
  provider: "qwen" | "jev";
  imageEnabled: boolean;
  imageSelfSide: string;
};
type Person = { id: string; label: string };
const ready = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export default function QuickPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const sessionId = useRef<string | null>(null);
  const requestId = useRef<string | null>(null);
  const resultTop = useRef<HTMLDivElement>(null);
  const [auth, setAuth] = useState<"loading" | "in" | "out">("loading");
  const [status, setStatus] = useState<Status | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [selfSide, setSelfSide] = useState<"right" | "left" | "">("");
  const [rights, setRights] = useState(false);
  const [chatConsent, setChatConsent] = useState(false);
  const [imageConsent, setImageConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CrushResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/crush", { cache: "no-store" }),
      fetch("/api/profile", { cache: "no-store" }).catch(() => null)
    ]).then(async ([analysis, profile]) => {
      if (cancelled) return;
      if (analysis.status === 401) { setAuth("out"); return; }
      const data = await analysis.json() as Status & { error?: string };
      if (!analysis.ok) throw new Error(data.error || "暂时无法读取设置。");
      setStatus(data);
      if (profile?.ok) {
        const records = await profile.json() as { subjects?: Person[] };
        if (!cancelled) setPeople(records.subjects || []);
      }
      if (!cancelled) setAuth("in");
    }).catch(cause => { if (!cancelled) { setError(cause instanceof Error ? cause.message : "暂时无法连接服务。"); setAuth("out"); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function postSettings(body: Record<string, unknown>) {
    const response = await fetch("/api/crush", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json() as { error?: string };
    if (!response.ok) throw new Error(value.error || "设置暂时未保存。");
  }

  function choose(chosen?: File) {
    if (!chosen) return;
    if (!["image/png", "image/jpeg"].includes(chosen.type) || chosen.size > 5_000_000) {
      setError("请选择 5 MB 内的 PNG 或 JPG 聊天截图。");
      return;
    }
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
    setResult(null);
    setSelfSide("");
    setRights(false);
    setImageConsent(false);
    setError("");
    requestId.current = null;
    sessionId.current = null;
  }

  async function submit() {
    if (busy) return;
    if (auth !== "in") { router.push("/login?return_to=%2Fquick"); return; }
    if (!file) { setError("先从相册选择一张双方聊天截图。"); return; }
    if (!selfSide) { setError("请先选择截图里哪侧气泡是你。"); return; }
    if (!rights) { setError("请确认你有权提供这张本人单聊截图。"); return; }
    setBusy(true);
    setError("");
    try {
      if (!status?.enabled || status.provider !== "qwen") {
        if (!chatConsent) throw new Error("请先同意聊天文字分析与短期保存。");
        await postSettings({ action: "settings", enabled: true, provider: "qwen" });
        setStatus(previous => previous ? { ...previous, enabled: true, provider: "qwen" } : previous);
      }
      if (!status?.imageEnabled || status.imageSelfSide !== selfSide) {
        if (!imageConsent) throw new Error("请先同意截图发送至阿里云百炼，并确认本人气泡位置。");
        await postSettings({ action: "imageMapping", enabled: true, selfSide, allowImageProcessing: true });
        setStatus(previous => previous ? { ...previous, imageEnabled: true, imageSelfSide: selfSide } : previous);
      }
      requestId.current ||= crypto.randomUUID();
      sessionId.current ||= crypto.randomUUID();
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("图片读取失败。"));
        reader.readAsDataURL(file);
      });
      let data: unknown;
      try {
        const response = await fetch("/api/crush/screenshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image, confirmed: true, selfSide, requestId: requestId.current, sessionId: sessionId.current, subjectId: subjectId || null }),
        });
        const value: unknown = await response.json();
        if (response.ok) data = value;
        else if (ready(value) && value.processing === true) data = await recoverScreenshot(requestId.current);
        else throw new Error(ready(value) && typeof value.error === "string" ? value.error : "截图解读这次没有完成，请重试。");
      } catch (cause) {
        if (!(cause instanceof TypeError)) throw cause;
        data = await recoverScreenshot(requestId.current);
      }
      if (!ready(data) || typeof data.id !== "string" || !Array.isArray(data.lines) || !Array.isArray(data.annotations)) throw new Error("截图解读这次没有完整返回，请重试。");
      setResult(data as CrushResult);
      setFile(null);
      setPreview("");
      setRights(false);
      requestId.current = null;
      window.setTimeout(() => resultTop.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "截图解读没有完成。"); }
    finally { setBusy(false); }
  }

  async function recoverScreenshot(id: string | null) {
    if (!id) throw new Error("没有找到这次截图的请求编号，请重新提交。");
    setError("连接中断，正在确认截图是否已完成…");
    for (let attempt = 0; attempt < 20; attempt++) {
      if (attempt) await new Promise(resolve => window.setTimeout(resolve, 3000));
      let response: Response;
      try { response = await fetch("/api/crush/screenshot/status?requestId=" + encodeURIComponent(id), { cache: "no-store" }); }
      catch {
        if (attempt === 19) break;
        continue;
      }
      const value: unknown = await response.json().catch(() => null);
      if (response.status === 401) throw new Error("登录状态已过期，请重新登录后查看。");
      if (!response.ok) throw new Error(ready(value) && typeof value.error === "string" ? value.error : "暂时无法查询截图进度，请保留页面后重试。");
      if (ready(value) && value.status === "done") { setError(""); return value.result; }
      if (ready(value) && value.status === "retry") throw new Error("这次截图没有完成，已保留图片；请重新提交。");
    }
    throw new Error("截图仍在处理中或暂时查不到结果；请稍后重试，重复提交会沿用同一请求编号。");
  }

  const requiresChatConsent = !status?.enabled || status.provider !== "qwen";
  const requiresImageConsent = !status?.imageEnabled || status.imageSelfSide !== selfSide;

  return <main className="quick-page">
    <header className="quick-head"><a href="/" aria-label="成子 首页"><BrandMark/> 成子</a><a href="/analyze?mode=chat">截图分析 <ChevronRight size={15}/></a></header>
    <section className="quick-hero">
      <span className="quick-kicker">聊天截图 · 逐句解读</span>
      <h1>发张图，<br/><em>看清下一步。</em></h1>
      <p>每句话在表达什么、你的回复接得怎样、现在怎么聊，放在一张清楚的判断里。</p>
      <div className="quick-trust"><span><Check size={15}/> 逐句而非只挑三句</span><span><Check size={15}/> 同账号接续档案</span></div>
    </section>

    {auth === "out" ? <section className="quick-card quick-login"><div className="quick-number">01</div><h2>用已有 成子 账号继续</h2><p>登录后，微信小程序和网页看到的是同一份关系资料。</p><a className="quick-primary" href="/login?return_to=%2Fquick">登录后发图 <ArrowRight size={18}/></a></section> :
    <section className="quick-card">
      <div className="quick-title"><span className="quick-number">01</span><div><h2>选择聊天截图</h2><p>只选本人参与的双人单聊；语音请先转成文字再截图。</p></div></div>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden onChange={event => choose(event.target.files?.[0])}/>
      <button type="button" className={"quick-picker" + (file ? " selected" : "")} disabled={busy || auth !== "in"} onClick={() => fileInput.current?.click()}>
        {preview ? <Image src={preview} alt="待分析的聊天截图预览" width={65} height={75} unoptimized/> : <span className="quick-picker-icon"><ImagePlus size={25}/></span>}
        <span><strong>{file ? "已选中 " + file.name : "从相册选一张截图"}</strong><small>{file ? "点击可更换 · 请确认两侧气泡能看清" : "支持 JPG / PNG，5 MB 内"}</small></span><ChevronRight size={18}/>
      </button>
      <div className="quick-field-row">
        <label>这是谁的聊天？<select disabled={busy || auth !== "in"} value={subjectId} onChange={event => { setSubjectId(event.target.value); setResult(null); sessionId.current = null; requestId.current = null; }}><option value="">这次先不归档</option>{people.map(person => <option key={person.id} value={person.id}>{person.label}</option>)}</select></label>
        <label>我在截图哪侧？<select disabled={busy || auth !== "in"} value={selfSide} onChange={event => { setSelfSide(event.target.value as "right" | "left" | ""); setImageConsent(false); setResult(null); requestId.current = null; sessionId.current = null; }}><option value="">请选择哪侧是我</option><option value="right">右侧绿色气泡</option><option value="left">左侧气泡</option></select></label>
      </div>
      <p className="quick-person-note">{subjectId ? "本次分析会接入选中对象的近期聊天；长期事实仍由你确认后保存。" : "先作为临时聊天处理，不会自动归入某个人的长期档案。"} <a href="/profile">管理对象</a></p>
      <div className="quick-consents">
        <label><input type="checkbox" checked={rights} disabled={busy || auth !== "in"} onChange={event => setRights(event.target.checked)}/> 我确认有权提供这张本人双人单聊截图</label>
        {requiresChatConsent && <label><input type="checkbox" checked={chatConsent} disabled={busy || auth !== "in"} onChange={event => setChatConsent(event.target.checked)}/> 同意聊天文字交由阿里云千问分析，并在本站保留文字与报告 7 天</label>}
        {requiresImageConsent && <label><input type="checkbox" checked={imageConsent} disabled={busy || auth !== "in"} onChange={event => setImageConsent(event.target.checked)}/> 同意原图发送至阿里云百炼识别；原图不进入长期档案</label>}
      </div>
      <button type="button" className="quick-primary" disabled={busy || auth === "loading"} onClick={() => void submit()}>{busy ? "正在逐句读取，结果会显示在下方…" : "看这张图怎么聊"}{busy ? <span className="quick-loading"/> : <Sparkles size={18}/>}</button>
      {error && <p className="quick-error" role="alert">{error}</p>}
      <p className="quick-privacy"><ShieldCheck size={15}/> 未上传时图片只在本机预览；分析仅依据可读内容，不替对方读心。</p>
    </section>}

    <section className="quick-result" ref={resultTop}>
      <div className="quick-title"><span className="quick-number">02</span><div><h2>{result ? "这张图的判断" : "你会得到什么"}</h2><p>{result ? "结论、逐句意图与下一步放在一起" : "不是一大段含糊的话，而是能马上用的判断"}</p></div></div>
      {result ? <>
        {result.decision && <DecisionPanel key={result.id} result={result}/>}
        {result.decision?.replyReview && <div className="quick-review"><span>你已发的回复{result.decision.replyGrade ? " · " + result.decision.replyGrade + " 级" : ""}</span><p>{result.decision.replyReview}</p></div>}
        <div className="quick-lines"><div className="quick-lines-head"><h3>逐句看 · {result.lines.length} 句</h3><span>按截图原顺序</span></div>{result.lines.map((line, index) => {
          const annotation = result.annotations.find(item => item.lineId === line.id);
          return <article className={"quick-line " + (line.speaker === "self" ? "mine" : "theirs")} key={line.id || index}><div className="quick-line-top"><span>{line.speaker === "self" ? "我" : line.speaker === "other" ? "对方" : "说话人待确认"}</span><small>#{index + 1}</small></div><p className="quick-quote">{line.text}</p>{annotation && <><div className="quick-tags">{annotation.emotion.slice(0, 3).map(tag => <span className="emotion" key={tag.key}>{tag.label} {probabilityText(tag.probability)}</span>)}{annotation.intent.slice(0, 3).map(tag => <span className="intent" key={tag.key}>{tag.label} {probabilityText(tag.probability)}</span>)}</div>{annotation.note && <p className="quick-note">{annotation.note}</p>}</>}</article>;
        })}</div>
        <div className="quick-actions"><a className="quick-primary" href={"/crush?id=" + encodeURIComponent(result.id)}>看完整报告与六维互动图 <ArrowRight size={17}/></a><button onClick={() => { setResult(null); setFile(null); setPreview(""); setSelfSide(""); setImageConsent(false); requestId.current = null; sessionId.current = null; }}><RotateCcw size={16}/> 看另一张图</button></div>
      </> : <div className="quick-example"><div><span>对方</span><p>周六要加班，周日倒是有空。</p><small>平静 · 给出替代安排</small></div><div><span>我</span><p>那周日下午？</p><small>直接推进 · 时间确认</small></div><div className="quick-example-foot">判断：对方没有只拒绝周六，而是提供了周日这个可行时间。<br/>下一步：确认周日具体时段，不必再试探好感。</div><small>演示案例，不是你的分析结果</small></div>}
    </section>
  </main>;
}


