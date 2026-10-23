"use client";
import { DataProcessingLink } from "@/components/DataProcessingLink";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, CheckCheck, FileArchive, FileAudio, FileText, ImagePlus, LoaderCircle, ShieldCheck, Sparkles, UploadCloud, UsersRound } from "lucide-react";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import { CaptureEntry } from "@/components/CaptureEntry";
import styles from "./import.module.css";
import type { ProfileState } from "@/lib/profile";
import { AnalysisCard, ConversationPanel, type Analysis } from "@/components/MaterialReport";
import type { WechatZipPreview } from "@/lib/wechat-zip-preview";

type Segment = { speaker: string; text: string; start: number; end: number };
const empty: Analysis = { summary: "", observations: [], questions: [], lineInsights: [], replyOptions: [] };
const readImage = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("图片读取失败。"));
  reader.readAsDataURL(file);
});
function chunks(value: string, size = 28000) {
  const result: string[] = [];
  for (let start = 0; start < value.length; start += size) result.push(value.slice(start, start + size));
  return result;
}

export default function ImportPage() {
  const [text, setText] = useState("");
  const [textFilename, setTextFilename] = useState("");
  const [zipPreview, setZipPreview] = useState<WechatZipPreview | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipSelf, setZipSelf] = useState("");
  const [zipFilename, setZipFilename] = useState("");
  const [zipError, setZipError] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const audioTask = useRef<{ key: string; requestId: string } | null>(null);
  const transcribing = useRef(false);
  const [audioPending, setAudioPending] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({});
  const [me, setMe] = useState("我");
  const [other, setOther] = useState("");
  const [analyzedAs, setAnalyzedAs] = useState({ me: "我", other: "" });
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [results, setResults] = useState<Analysis[]>([]);
  const [finalResult, setFinalResult] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = useRef<{key:string;reportId:string;ids:string[];completed:Analysis[]}|null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const savedId = new URLSearchParams(window.location.search).get("reportId");
    if(savedId && /^[a-f0-9-]{36}$/.test(savedId)) void fetch("/api/web/report?id="+savedId,{cache:"no-store"}).then(async response=>{
      if(!response.ok)throw new Error("report unavailable");const data=await response.json() as {report?:{importAnalysis?:{batches:Analysis[];result:Analysis;me:string;other:string}}};const saved=data.report?.importAnalysis;
      if(saved){setResults(saved.batches||[]);setFinalResult({...saved.result,reportId:savedId});setAnalyzedAs({me:saved.me,other:saved.other});setStatus("已恢复保存的分析报告。添加新材料可开始新的分析。");}
    }).catch(()=>setError("报告暂未读取，可在分析记录中重新打开。"));
    void fetch("/api/profile", { cache: "no-store" }).then(async (response) => {
      if (response.ok) {
        const next = await response.json() as ProfileState;
        setProfile(next);
        const requestedId = new URLSearchParams(window.location.search).get("subjectId");
        const selected = next.subjects.find((item) => item.id === requestedId);
        if (selected) { setSubjectId(selected.id); setOther((current) => current || selected.label); }
      }
    }).catch(() => {});
  }, []);
  async function onTextFile(file?: File) {
    if (!file) return;
    if (!/\.(txt|csv|json)$/i.test(file.name) || file.size > 2_000_000) { setError("请上传 2 MB 内的 TXT、CSV 或 JSON 文字文件。"); return; }
    const content = await file.text();
    if (content.length > 1_120_000) { setError("文件过长，请分成几份导入。"); return; }
    setText(content); setTextFilename(file.name); setError(""); setResults([]); setFinalResult(null); setMappingConfirmed(false);
  }
  async function previewWechatZip(file?: File) {
    setZipPreview(null); setZipFile(null); setZipSelf(""); setZipFilename(""); setZipError("");
    if (!file) return;
    if (!/\.zip$/iu.test(file.name) || file.size > 5_000_000) { setZipError("请选择 5 MB 内的微信聊天 ZIP。"); return; }
    try {
      const { inspectWechatZip } = await import("@/lib/wechat-zip-preview");
      setZipPreview(inspectWechatZip(new Uint8Array(await file.arrayBuffer())));
      setZipFile(file);
      setZipFilename(file.name);
    } catch (cause) { setZipError(cause instanceof Error ? cause.message : "压缩包暂时无法读取。"); }
  }
  async function transferWechatZipText() {
    if (!zipFile || !zipSelf) return;
    if ((text.trim() || images.length || audioFile) && !window.confirm("下方已有材料。使用这份 ZIP 的文字会替换当前文字、截图或录音，继续吗？")) return;
    try {
      const { extractWechatZipText } = await import("@/lib/wechat-zip-preview");
      const extracted = extractWechatZipText(new Uint8Array(await zipFile.arrayBuffer()), zipSelf);
      setText(extracted.text); setTextFilename(zipFile.name + " · 已提取文字");
      setMe(extracted.me); setOther(extracted.other); setImages([]); setAudioFile(null); setAudioPending(false); setSegments([]);
      setMappingConfirmed(false); setRightsConfirmed(false); setResults([]); setFinalResult(null); setError("");
      setStatus("已将可读文字放入下方表单。请核对双方称呼、逐句文字和授权，再决定是否分析；ZIP 不会上传。");
    } catch (cause) { setZipError(cause instanceof Error ? cause.message : "这份 ZIP 暂不能转入分析。"); }
  }
  function onImages(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files);
    if (selected.length > 20 || selected.some((file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5_000_000)) {
      setError("一次最多 20 张截图，每张不超过 5 MB，支持 PNG、JPG、WebP。"); return;
    }
    setImages(selected); setError(""); setResults([]); setFinalResult(null); setMappingConfirmed(false);
  }
  async function transcribe() {
    if (busy || transcribing.current) return;
    if (!audioFile || !rightsConfirmed) { setError("请先选择录音，并确认你有权提供它。"); return; }
    if (!audioFile.size || audioFile.size > 7_000_000 || !/\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)$/i.test(audioFile.name)) { setError("请选择 7 MB 内、时长不超过 5 分钟的有效录音文件。"); return; }
    transcribing.current = true;
    setBusy(true); setError(""); setStatus("正在转写录音，请稍候…");
    try {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await audioFile.arrayBuffer())), value => value.toString(16).padStart(2, "0")).join("");
      const key = JSON.stringify([audioFile.name, audioFile.type, audioFile.size, hash]);
      if (audioTask.current?.key !== key) audioTask.current = { key, requestId: crypto.randomUUID() };
      const requestId = audioTask.current.requestId;
      setAudioPending(true);
      const form = new FormData();
      form.set("audio", audioFile);
      form.set("rightsConfirmed", "true");
      const response = await fetch("/api/import/transcribe", { method: "POST", headers: { "X-Request-Id": requestId }, body: form });
      if (response.headers.get("X-Credit-Task-Status") === "released") { audioTask.current = null; setAudioPending(false); window.dispatchEvent(new Event("chengzi:credits-changed")); }
      const data = await response.json() as { error?: string; text?: string; segments?: Segment[]; creditTaskStatus?: string; code?: string };
      if (!response.ok) {
        const released = data.creditTaskStatus === "released" || data.code === "CREDIT_RELEASED" || response.headers.get("X-Credit-Task-Status") === "released";
        if (released) { audioTask.current = null; setAudioPending(false); window.dispatchEvent(new Event("chengzi:credits-changed")); }
        throw new Error((data.error || "录音转写失败。") + (released ? " 本次积分已退回，录音已保留，可重新转写。" : ""));
      }
      setSegments(data.segments || []);
      const speakers = [...new Set((data.segments || []).map((item) => item.speaker))];
      setSpeakerMap(Object.fromEntries(speakers.map((speaker) => [speaker, "unknown"])));
      setText(data.text || "");
      setMappingConfirmed(false);
      audioTask.current = null; setAudioPending(false); window.dispatchEvent(new Event("chengzi:credits-changed"));
      setStatus(speakers.length ? "转写完成。请核对各说话人是谁，再把标签写入文本。" : "转写完成。请核对文字和说话人。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "录音转写失败。"); setStatus(audioTask.current ? "原任务编号已保留，可继续核对转写结果。" : "录音已保留，可重新转写。"); }
    finally { transcribing.current = false; setBusy(false); }
  }
  function applySpeakers() {
    if (!segments.length) return;
    if (Object.values(speakerMap).filter((role) => role === "me").length !== 1 || Object.values(speakerMap).filter((role) => role === "other").length !== 1) {
      setError("请分别指定一位说话人是你、一位是对方；其余保持不确定。"); return;
    }
    if (!me.trim() || !other.trim() || me.trim() === other.trim()) { setError("请先填写两个不同的称呼，再写入说话人标签。"); return; }
    const mapped = segments.map((part) => {
      const speaker = speakerMap[part.speaker] === "me" ? me.trim() : speakerMap[part.speaker] === "other" ? other.trim() : "其他说话人";
      return "[" + Math.round(part.start) + "s] " + speaker + "：" + part.text;
    }).join("\n");
    setText(mapped); setError(""); setMappingConfirmed(false); setStatus("说话人已写入文本。请快速检查，确认无误后再分析。");
  }
  async function analyze() {
    if (!rightsConfirmed || !mappingConfirmed) { setError("请先确认材料来源与说话人映射。"); return; }
    if (!me.trim() || !other.trim() || me.trim() === other.trim()) { setError("请分别填写你和对方的称呼。"); return; }
    if (!text.trim() && !images.length) { setError("请先粘贴记录、上传文字文件或截图，或转写录音。"); return; }
    if (text.length > 1_120_000) { setError("文字过长，请分成几份导入。"); return; }
    const textBatches = text.trim() ? chunks(text.trim()) : [];
    const imageBatches = Math.ceil(images.length / 2);
    const total = textBatches.length + imageBatches;
    const key = JSON.stringify({text,images:images.map(f=>[f.name,f.size,f.lastModified]),me,other,subjectId});
    if(plan.current?.key!==key)plan.current={key,reportId:crypto.randomUUID(),ids:Array.from({length:total+1},()=>crypto.randomUUID()),completed:[]};
    const currentPlan=plan.current;
    setBusy(true); setError(""); setResults([...currentPlan.completed]); setFinalResult(null); setAnalyzedAs({ me: me.trim(), other: other.trim() });
    const collected = currentPlan.completed;

    try {
      for (let i = collected.length; i < total; i++) {

        setStatus("正在分析第 " + (i + 1) + "/" + total + " 批…");
        const batchImages = i >= textBatches.length ? await Promise.all(images.slice((i - textBatches.length) * 2, (i - textBatches.length + 1) * 2).map(readImage)) : [];
        const response = await fetch("/api/import/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: textBatches[i] || "", images: batchImages, me, other, subjectId: subjectId || null, mappingConfirmed: true, reportId:currentPlan.reportId,requestId:currentPlan.ids[i],batchIndex:i }),
        });
        const result = await response.json() as Analysis & { error?: string };
        if (!response.ok) { if((result as Analysis & {creditTaskStatus?:string}).creditTaskStatus==="released")currentPlan.ids[i]=crypto.randomUUID(); throw new Error(result.error || "材料分析失败。"); }
        window.history.replaceState(null,"","/import?reportId="+currentPlan.reportId);
        collected.push(result); setResults([...collected]);
      }
      if (collected.length > 1) {

        setStatus("正在汇总全部批次…");
        const summaries = collected.map((item, index) => "第" + (index + 1) + "批：" + item.summary + "\n观察：" + item.observations.map((o) => o.claim + "（依据：" + o.evidence + "）").join("；")).join("\n");
        const response = await fetch("/api/import/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: summaries.slice(0, 30000), me, other, subjectId: subjectId || null, mappingConfirmed: true, final: true,reportId:currentPlan.reportId,requestId:currentPlan.ids[total] }),
        });
        const result = await response.json() as Analysis & { error?: string };
        if (!response.ok) { if((result as Analysis & {creditTaskStatus?:string}).creditTaskStatus==="released")currentPlan.ids[total]=crypto.randomUUID(); throw new Error(result.error || "综合分析失败。"); }
        setFinalResult(result);
      } else setFinalResult(collected[0] || empty);
      setStatus("分析完成，报告已永久保存，可在「分析记录」随时继续查看。原始文件不保存。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "分析中断。"); setStatus("已完成 " + collected.length + "/" + total + " 批；已完成报告已保存。再次点击将继续未完成批次，不重复扣费。"); }
    finally { setBusy(false); }
  }
  async function saveCandidates() {
    if (!finalResult || !subjectId) return;
    const candidates = finalResult.observations.filter((item) => item.claim && item.evidence).slice(0, 3).map((item) => ({ value: item.claim, evidence: item.evidence }));
    if (!candidates.length) { setError("这次没有可核对的具体事件，先不要写入档案。"); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import-candidates", subjectId, candidates }),
      });
      const data = await response.json() as ProfileState & { error?: string };
      if (!response.ok) throw new Error(data.error || "加入待确认失败。");
      setProfile(data); setStatus("已加入对象档案的待确认区；请到档案页逐条核对。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。"); }
    finally { setBusy(false); }
  }
  const latestConversation = results.at(-1);
  const zipCanTransfer = !!zipPreview && zipPreview.textMessages > 0 && zipPreview.textMessages === zipPreview.totalMessages &&
    zipPreview.namedMessages === zipPreview.totalMessages && zipPreview.timedMessages === zipPreview.totalMessages &&
    zipPreview.speakerLabels.length === 2 && zipPreview.speakerLabels.every(label => label.length <= 60 && !/[：:\r\n]/u.test(label)) &&
    zipPreview.imageFiles + zipPreview.audioFiles + zipPreview.otherFiles === 0;
  const hasMaterials = !!(text.trim() || images.length || audioFile || zipPreview);
  const identityReady = !!me.trim() && !!other.trim() && me.trim() !== other.trim();
  const batchCount=(text.trim()?Math.ceil(text.trim().length/28000):0)+Math.ceil(images.length/2);
  const estimatedCredits=(batchCount+(batchCount>1?1:0))*20;
  const analysisReady = !!(text.trim() || images.length) && identityReady && rightsConfirmed && mappingConfirmed;
  const currentStep = finalResult ? 3 : analysisReady || busy ? 2 : hasMaterials ? 1 : 0;
  return <main className={styles.page}><div className={styles.wrap}>
    <AuroraPageHero eyebrow="材料导入 · 长对话分析" title={<>把长对话，放在一起看。</>} description="上传文字、截图或录音，先核对双方身份，再看有原话依据的分析。">
    </AuroraPageHero>
    <CaptureEntry/>
    <ol className={styles.steps} aria-label="导入步骤">
      {[{title:"添加材料",note:"上传文件或粘贴文字"},{title:"确认谁是你",note:"核对称呼与授权"},{title:"查看分析",note:"先看结果，再决定留档"}].map((step,index)=><li key={step.title} data-state={currentStep>index?"done":currentStep===index?"current":"waiting"} aria-current={currentStep===index?"step":undefined}><span className={styles.stepNumber}>{currentStep>index?<Check size={17} aria-hidden="true"/>:String(index+1).padStart(2,"0")}</span><div><strong>{step.title}</strong><small>{step.note}</small></div></li>)}
    </ol>
    <div className={styles.workspace}>
      <section className={styles.materials} aria-labelledby="import-material-title">
        <div className={styles.sectionHead}><span className={styles.sectionIcon}><UploadCloud size={22} aria-hidden="true"/></span><div><span className={styles.kicker}>01 · 添加材料</span><h2 id="import-material-title">选择文件，或直接粘贴</h2></div></div>
        <p className={styles.help}>按聊天顺序整理，保留称呼和前后文。</p>
        <div className={styles.uploadGrid}>
          <label className={styles.uploadTile} data-selected={!!textFilename} data-disabled={busy}><span className={styles.uploadIcon}><FileText size={24} aria-hidden="true"/></span><strong>文字文件</strong><small>TXT / CSV / JSON · 2 MB 内</small><span className={styles.fileState}>{textFilename?<><CheckCheck size={15} aria-hidden="true"/>{textFilename}</>:<>选择文字文件 <ArrowRight size={16} aria-hidden="true"/></>}</span><input aria-label="选择文字文件" disabled={busy} type="file" accept=".txt,.csv,.json,text/plain" onChange={(event)=>void onTextFile(event.target.files?.[0])}/></label>
          <label className={styles.uploadTile} data-selected={images.length>0} data-disabled={busy}><span className={styles.uploadIcon}><ImagePlus size={24} aria-hidden="true"/></span><strong>聊天截图</strong><small>最多 20 张 · 每张 5 MB 内</small><span className={styles.fileState}>{images.length?<><CheckCheck size={15} aria-hidden="true"/>已选 {images.length} 张截图</>:<>选择聊天截图 <ArrowRight size={16} aria-hidden="true"/></>}</span><input aria-label="选择聊天截图" disabled={busy} type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event)=>onImages(event.target.files)}/></label>
          <label className={styles.uploadTile} data-selected={!!audioFile} data-disabled={busy}><span className={styles.uploadIcon}><FileAudio size={24} aria-hidden="true"/></span><strong>对话录音</strong><small>7 MB 内 · 不超过 5 分钟</small><span className={styles.fileState}>{audioFile?<><CheckCheck size={15} aria-hidden="true"/>{audioFile.name}</>:<>选择对话录音 <ArrowRight size={16} aria-hidden="true"/></>}</span><input aria-label="选择对话录音" disabled={busy} type="file" accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,audio/*" onChange={(event)=>{setAudioFile(event.target.files?.[0]||null);setAudioPending(false);setSegments([]);setMappingConfirmed(false);}}/></label>
          <label className={styles.uploadTile} data-selected={!!zipFilename} data-disabled={busy}><span className={styles.uploadIcon}><FileArchive size={24} aria-hidden="true"/></span><strong>微信聊天 ZIP</strong><small>5 MB 内 · 仅在本机预览</small><span className={styles.fileState}>{zipFilename?<><CheckCheck size={15} aria-hidden="true"/>{zipFilename}</>:<>选择 ZIP 压缩包 <ArrowRight size={16} aria-hidden="true"/></>}</span><input aria-label="选择微信聊天 ZIP" disabled={busy} type="file" accept=".zip,application/zip" onChange={event=>void previewWechatZip(event.target.files?.[0])}/></label>
        </div>
        {zipError&&<p className={styles.error} role="alert">{zipError}</p>}
        {zipPreview&&<section className={styles.zipPreview} aria-label="微信聊天 ZIP 本机预览">
          <div className={styles.inlineHead}><FileArchive size={18} aria-hidden="true"/><h3>ZIP 材料预览</h3><span>文件未上传</span></div>
          <dl className={styles.zipStats}><div><dt>全部记录</dt><dd>{zipPreview.totalMessages}</dd></div><div><dt>可读文字</dt><dd>{zipPreview.textMessages}</dd></div><div><dt>发言人标识</dt><dd>{zipPreview.speakerLabels.length}</dd></div></dl>
          <p className={styles.help}>语音占位 {zipPreview.voicePlaceholders} 条 · 图片引用 {zipPreview.imageReferences} 条 · 其他引用 {zipPreview.otherReferences} 条。带称呼 {zipPreview.namedMessages} 条，带时间 {zipPreview.timedMessages} 条。</p>
          <p className={styles.help}>附件：图片 {zipPreview.imageFiles} 个、音频 {zipPreview.audioFiles} 个、其他 {zipPreview.otherFiles} 个；附件内容尚未识别。</p>
          <p className={styles.zipNotice}>{zipPreview.textMessages===0?"没有可读文字，暂不能分析。":zipPreview.namedMessages!==zipPreview.totalMessages||zipPreview.speakerLabels.length!==2?"双方身份信息不完整，请补齐称呼后再分析。":zipCanTransfer?"可导入这份纯文字记录。先选择谁是你，再核对下方文字。":"材料含有缺失媒体或附件，请补齐原记录后再分析。"}</p>
          {zipCanTransfer&&<div className={styles.zipTransfer}><label className={styles.field}><span>聊天里谁是我</span><select disabled={busy} value={zipSelf} onChange={event=>setZipSelf(event.target.value)}><option value="">请亲自选择</option>{zipPreview.speakerLabels.map(label=><option key={label} value={label}>{label}</option>)}</select></label><button type="button" className={styles.secondaryButton} disabled={busy||!zipSelf} onClick={()=>void transferWechatZipText()}>将纯文字带入下方表单 <ArrowRight size={16} aria-hidden="true"/></button></div>}
          <small className={styles.caption}>ZIP 只在当前浏览器检查，不会自动触发分析。</small>
        </section>}
        <label className={`${styles.field} ${styles.textField}`}><span>直接粘贴聊天文字 <small>{text.length?text.length.toLocaleString()+" 字":"也可修改文件内容和录音转写"}</small></span><textarea disabled={busy} rows={8} value={text} onChange={event=>{setText(event.target.value);setMappingConfirmed(false);}} placeholder={"我：周末有空吗？\n对方：有空，怎么啦？\n\n请保留时间与称呼，移除无关隐私。"}/></label>
        {images.length>0&&<p className={styles.selectedFiles}><ImagePlus size={16} aria-hidden="true"/><span>已选 {images.length} 张：{images.slice(0,3).map(file=>file.name).join("、")}{images.length>3?"…":""}</span></p>}
        {audioFile&&<div className={styles.audioTransfer}><FileAudio size={20} aria-hidden="true"/><div><strong>{audioFile.name}</strong><small>{rightsConfirmed?(audioPending?"继续原转写任务，不会因断网重试重复扣费。":"转写 5 积分。完成后请核对文字和说话人，后续分析单独计费。"):"请先在「确认谁是你」中勾选材料授权，再转写。"}</small></div><button type="button" className={styles.secondaryButton} disabled={busy||!rightsConfirmed} onClick={()=>void transcribe()}>{audioPending?"继续转写 · 原任务":"转写录音 · 5 积分"}</button></div>}
        {segments.length>0&&<section className={styles.speakerMap}><h3><UsersRound size={18} aria-hidden="true"/>核对录音中的说话人</h3><p className={styles.help}>编号不代表真实身份。不确定的保留为“其他”。</p>{Object.keys(speakerMap).map(speaker=><label className={styles.field} key={speaker}><span>{speaker}</span><select disabled={busy} value={speakerMap[speaker]} onChange={event=>{setSpeakerMap({...speakerMap,[speaker]:event.target.value});setMappingConfirmed(false);}}><option value="unknown">其他／不确定</option><option value="me">我</option><option value="other">对方</option></select></label>)}<button className={styles.secondaryButton} type="button" disabled={busy} onClick={applySpeakers}>把标签写入上方文字</button></section>}
        <p className={styles.privacyNote}><ShieldCheck size={17} aria-hidden="true"/><span>只读取你主动提供的文件。原始聊天、截图和录音不写入长期档案。</span></p>
      </section>
      <section className={styles.confirmation} id="import-confirmation" aria-labelledby="import-identity-title">
        <div className={styles.sectionHead}><span className={styles.sectionIcon}><UsersRound size={22} aria-hidden="true"/></span><div><span className={styles.kicker}>02 · 核对身份</span><h2 id="import-identity-title">确认谁是你</h2></div></div>
        <p className={styles.help}>称呼与材料中的标识保持一致。</p>
        <div className={styles.identityFields}><label className={styles.field}><span>聊天里我的称呼 / 标识</span><input disabled={busy} value={me} onChange={event=>{setMe(event.target.value);setMappingConfirmed(false);}} placeholder="例如：我／微信昵称"/></label><label className={styles.field}><span>对方的称呼 / 标识</span><input disabled={busy} value={other} onChange={event=>{setOther(event.target.value);setMappingConfirmed(false);}} placeholder="例如：小A／昵称"/></label></div>
        {profile?.enabled&&!profile.paused&&profile.subjects.length>0&&<label className={styles.field}><span>关联人物档案 <small>可选</small></span><select disabled={busy} value={subjectId} onChange={event=>setSubjectId(event.target.value)}><option value="">本次不关联对象</option>{profile.subjects.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
        <div className={styles.consentGroup}><label className={styles.check}><input type="checkbox" disabled={busy} checked={rightsConfirmed} onChange={event=>setRightsConfirmed(event.target.checked)}/><span>我有权提供这些材料，同意用于本次成子 AI 分析。<DataProcessingLink/></span></label><label className={styles.check}><input type="checkbox" disabled={busy} checked={mappingConfirmed} onChange={event=>setMappingConfirmed(event.target.checked)}/><span>我已核对双方身份；看不清或认不出的内容保持未知。</span></label></div>
        <div className={styles.submitArea}>{batchCount>0&&<p className={styles.help}>本次 {estimatedCredits} 积分 · {batchCount} 批材料{batchCount>1?"及综合报告":""} · 报告永久保存</p>}<span className={styles.kicker}>03 · 查看分析</span><button className={styles.primaryButton} type="button" disabled={busy||!analysisReady} onClick={()=>void analyze()}>{busy?<LoaderCircle className={styles.spin} size={19} aria-hidden="true"/>:<Sparkles size={19} aria-hidden="true"/>}{busy?"正在处理材料…":"开始分批分析"}{!busy&&<ArrowRight size={17} aria-hidden="true"/>}</button><p className={styles.caption}>{busy?"完成的批次会显示在下方。":!hasMaterials?"先添加材料，再确认双方身份。":!identityReady?"请填写你和对方的不同称呼。":!rightsConfirmed||!mappingConfirmed?"完成上方两项确认后即可开始。":!text.trim()&&!images.length?"请先将 ZIP 文字带入，或完成录音转写。":"分析后可挑选有依据的事件，再确认留档。"}</p></div>
        {status&&<p className={styles.status} role="status">{status}</p>}{error&&<p className={styles.error} role="alert">{error}</p>}
      </section>
    </div>
    {results.length>0&&<section className={styles.results} aria-label="材料分析结果"><div className={styles.resultsHead}><div><span className={styles.kicker}>分析结果</span><h2>这批记录说明了什么</h2></div><span>{results.length} 批已完成</span></div>{(finalResult?.reportId||results.at(-1)?.reportId)&&<a className={styles.secondaryButton} href={"/report?id="+(finalResult?.reportId||results.at(-1)?.reportId)}>打开已保存报告 <ArrowRight size={16}/></a>}{finalResult&&<AnalysisCard title={results.length>1?"跨批次综合":"本次总结"} result={finalResult} main/>}{latestConversation&&<ConversationPanel key={results.length+latestConversation.summary} result={latestConversation} me={analyzedAs.me} other={analyzedAs.other} ready={!!finalResult&&!busy}/>}
      <details className="batch-details"><summary>查看每批证据与分析</summary>{results.map((item,index)=><AnalysisCard key={index} title={"第 "+(index+1)+" 批"} result={item}/>)}</details>
      {profile?.enabled&&<div className="save-import"><label>加入哪位对象的待确认区<select value={subjectId} onChange={event=>setSubjectId(event.target.value)}><option value="">先选择对象</option>{profile.subjects.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" disabled={busy||!subjectId||!finalResult} onClick={()=>void saveCandidates()}>把有依据的事件放入待确认</button><a href="/archive">去档案核对 →</a></div>}
    </section>}
  </div></main>;
}
