"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, FileAudio, FileText, ImagePlus, UploadCloud } from "lucide-react";
import Link from "next/link";
import type { ProfileState } from "@/lib/profile";
import { ReplyPaths } from "@/components/ReplyPaths";
import { KnowledgeBasis } from "@/components/KnowledgeBasis";
import type { ReplyPaths as Paths } from "@/lib/reply-paths";
import type { KnowledgeSource } from "@/lib/knowledge-public";
import type { WechatZipPreview } from "@/lib/wechat-zip-preview";

type Segment = { speaker: string; text: string; start: number; end: number };
type LineInsight = { quote: string; speaker: string; signal: string; alternative: string; certainty: string };
type ReplyOption = { text: string; when: string; next?: Paths };
type Analysis = { summary: string; observations: Array<{ claim: string; evidence: string; uncertainty: string }>; questions: string[]; lineInsights: LineInsight[]; replyOptions: ReplyOption[]; knowledgeSources?: KnowledgeSource[] };
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
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
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
      setMe(extracted.me); setOther(extracted.other); setImages([]); setAudioFile(null); setSegments([]);
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
    if (!audioFile || !rightsConfirmed) { setError("请先选择录音，并确认你有权提供它。"); return; }
    setBusy(true); setError(""); setStatus("正在转写录音，请稍候…");
    try {
      const form = new FormData();
      form.set("audio", audioFile);
      form.set("rightsConfirmed", "true");
      const response = await fetch("/api/import/transcribe", { method: "POST", body: form });
      const data = await response.json() as { error?: string; text?: string; segments?: Segment[] };
      if (!response.ok) throw new Error(data.error || "录音转写失败。");
      setSegments(data.segments || []);
      const speakers = [...new Set((data.segments || []).map((item) => item.speaker))];
      setSpeakerMap(Object.fromEntries(speakers.map((speaker) => [speaker, "unknown"])));
      setText(data.text || "");
      setMappingConfirmed(false);
      setStatus(speakers.length ? "转写完成。请核对各说话人是谁，再把标签写入文本。" : "转写完成。请核对文字和说话人。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "录音转写失败。"); }
    finally { setBusy(false); }
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
    if (total > 5 && !window.confirm("这次需要调用智能分析约 " + (total + 1) + " 次，会产生 API 费用。继续吗？")) return;
    setBusy(true); setError(""); setResults([]); setFinalResult(null); setAnalyzedAs({ me: me.trim(), other: other.trim() });
    const collected: Analysis[] = [];
    try {
      for (let i = 0; i < total; i++) {
        setStatus("正在分析第 " + (i + 1) + "/" + total + " 批…");
        const batchImages = i >= textBatches.length ? await Promise.all(images.slice((i - textBatches.length) * 2, (i - textBatches.length + 1) * 2).map(readImage)) : [];
        const response = await fetch("/api/import/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: textBatches[i] || "", images: batchImages, me, other, subjectId: subjectId || null, mappingConfirmed: true }),
        });
        const result = await response.json() as Analysis & { error?: string };
        if (!response.ok) throw new Error(result.error || "材料分析失败。");
        collected.push(result); setResults([...collected]);
      }
      if (collected.length > 1) {
        setStatus("正在汇总全部批次…");
        const summaries = collected.map((item, index) => "第" + (index + 1) + "批：" + item.summary + "\n观察：" + item.observations.map((o) => o.claim + "（依据：" + o.evidence + "）").join("；")).join("\n");
        const response = await fetch("/api/import/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: summaries.slice(0, 30000), me, other, subjectId: subjectId || null, mappingConfirmed: true, final: true }),
        });
        const result = await response.json() as Analysis & { error?: string };
        if (!response.ok) throw new Error(result.error || "综合分析失败。");
        setFinalResult(result);
      } else setFinalResult(collected[0] || empty);
      setStatus("分析完成。请核对引用与结论；原始材料没有保存到本站档案。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "分析中断。"); setStatus("已完成 " + collected.length + "/" + total + " 批；可保留当前结果，稍后重试。"); }
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
  return <main className="import-page"><div className="import-wrap">
    <header className="profile-top"><Link href="/" className="back-link"><ArrowLeft size={18} /> 返回工作台</Link><span>成子 · 材料导入</span></header>
    <section className="profile-intro"><p className="eyebrow">只分析你主动提供的材料</p><h1>把聊天和录音，变成看得见的线索。</h1><p>不读取微信账号或设备数据。先确认说话人，再看具体行为；单次消息不能证明一个人的爱意或长期性格。已有较长的电脑聊天导出文件？<Link href="/history">去电脑端聊天档案导入、搜索和核对 →</Link></p></section>
    <section className="profile-card" aria-label="微信聊天 ZIP 本机预览">
      <h2>微信聊天 ZIP · 先看材料是否完整</h2>
      <p>只在当前浏览器读取文件结构和文字分类，不上传 ZIP、不保存原文，也不会直接触发分析。合并转发可能缺发言人，语音时长不等于语音正文。</p>
      <label className="import-option"><FileText size={22}/><strong>选择微信转发的 ZIP</strong><small>仅预览，5 MB 内</small><span className="import-file-state">{zipFilename || "点击选择压缩包"}</span><input type="file" accept=".zip,application/zip" onChange={event=>void previewWechatZip(event.target.files?.[0])}/></label>
      {zipError && <p className="import-error" role="alert">{zipError}</p>}
      {zipPreview && <div className="import-status" role="status"><p>识别到 {zipPreview.totalMessages} 条记录：可读文字 {zipPreview.textMessages} 条、语音时长占位 {zipPreview.voicePlaceholders} 条、图片引用 {zipPreview.imageReferences} 条、其他媒体引用 {zipPreview.otherReferences} 条。</p><p>带发言人标识 {zipPreview.namedMessages} 条（{zipPreview.speakerLabels.length} 种标识），带时间 {zipPreview.timedMessages} 条；ZIP 附件中有图片文件 {zipPreview.imageFiles} 个、音频文件 {zipPreview.audioFiles} 个、其他文件 {zipPreview.otherFiles} 个。附件尚未做内容识别，也不能确认音频与哪条语音对应。</p><p>{zipPreview.textMessages === 0 ? "没有可读文字，不能据此判断话里意图。" : zipPreview.namedMessages !== zipPreview.totalMessages || zipPreview.speakerLabels.length !== 2 ? "身份信息不完整，不能自动当作双人对话分析。" : zipCanTransfer ? "这是带双方标识和时间的纯文字记录；先选择谁是你，才能将文字带入表单。" : "有缺失媒体或附件，本版不会跳过它们后假装对话完整；请补齐并核对原记录。"}ZIP 不会自动触发分析。</p>{zipCanTransfer && <div className="speaker-map"><label>聊天里谁是我<select value={zipSelf} onChange={event => setZipSelf(event.target.value)}><option value="">请亲自选择</option>{zipPreview.speakerLabels.map(label => <option key={label} value={label}>{label}</option>)}</select></label><button type="button" disabled={!zipSelf} onClick={() => void transferWechatZipText()}>将纯文字带入下方表单</button></div>}</div>}
    </section>
    <div className="import-layout"><div className="profile-card import-form">
      <h2>1. 提供材料</h2><div className="import-options">
        <label className="import-option"><FileText size={22} /><strong>文字文件</strong><small>TXT / CSV / JSON，2 MB 内</small><span className="import-file-state">{textFilename ? "已选 " + textFilename : "点击选择文件"}</span><input type="file" accept=".txt,.csv,.json,text/plain" onChange={(event) => void onTextFile(event.target.files?.[0])} /></label>
        <label className="import-option"><ImagePlus size={22} /><strong>聊天截图</strong><small>一次最多 20 张，可重复导入</small><span className="import-file-state">{images.length ? "已选 " + images.length + " 张" : "点击选择截图"}</span><input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => onImages(event.target.files)} /></label>
        <label className="import-option"><FileAudio size={22} /><strong>对话录音</strong><small>MP3 / M4A / WAV 等，7 MB 内且不超过 5 分钟</small><span className="import-file-state">{audioFile ? "已选 " + audioFile.name : "点击选择录音"}</span><input type="file" accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,audio/*" onChange={(event) => { setAudioFile(event.target.files?.[0] || null); setSegments([]); setMappingConfirmed(false); }} /></label>
      </div>
      <label className="field wide import-text"><span>或者直接粘贴聊天文字；录音转写结果也会放在这里供你修改</span><textarea rows={10} value={text} onChange={(event) => { setText(event.target.value); setMappingConfirmed(false); }} placeholder="可以带时间、昵称和每条消息。请先移除无关的手机号、地址等隐私信息。" /></label>
      {images.length > 0 && <p className="import-count">已选 {images.length} 张截图：{images.slice(0, 3).map((file) => file.name).join("、")}{images.length > 3 ? "…" : ""}</p>}
      {audioFile && <div className="transcribe-row"><span>已选录音：{audioFile.name}</span><button type="button" disabled={busy || !rightsConfirmed} onClick={() => void transcribe()}>转写录音</button></div>}
      {segments.length > 0 && <div className="speaker-map"><strong>核对录音中的说话人</strong><p>模型给的只是说话人编号，不知道真实身份。请你指定；不确定的设为“其他”。</p>{Object.keys(speakerMap).map((speaker) => <label key={speaker}>{speaker}<select value={speakerMap[speaker]} onChange={(event) => { setSpeakerMap({ ...speakerMap, [speaker]: event.target.value }); setMappingConfirmed(false); }}><option value="unknown">其他／不确定</option><option value="me">我</option><option value="other">对方</option></select></label>)}<button type="button" onClick={applySpeakers}>把标签写入上方文字</button></div>}
      <h2>2. 锁定身份</h2><div className="field-grid"><label className="field"><span>聊天里我的称呼 / 标识</span><input value={me} onChange={(event) => { setMe(event.target.value); setMappingConfirmed(false); }} placeholder="例如：我／微信昵称" /></label><label className="field"><span>对方的称呼 / 标识</span><input value={other} onChange={(event) => { setOther(event.target.value); setMappingConfirmed(false); }} placeholder="例如：小A／昵称" /></label></div>
      {profile?.enabled && !profile.paused && profile.subjects.length > 0 && <label className="field wide"><span>结合哪位对象的档案（可选）</span><select disabled={busy} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">本次不关联对象</option>{profile.subjects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      <label className="check-row"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /><span>我有权提供这些材料，并已考虑对方及其他人的隐私；我了解材料会发送给阿里云百炼的千问模型处理。</span></label>
      <label className="check-row"><input type="checkbox" checked={mappingConfirmed} onChange={(event) => setMappingConfirmed(event.target.checked)} /><span>我已核对说话人映射；截图看不清、录音认不出的部分应保持未知。</span></label>
      <h2>3. 看分析，再决定是否留档</h2><div className="button-row"><button className="primary-action" type="button" disabled={busy || !rightsConfirmed || !mappingConfirmed} onClick={() => void analyze()}><UploadCloud size={17} /> 分批分析材料</button><span className="subtle">原始聊天、截图和录音不写入长期档案</span></div>
      {status && <p className="import-status" role="status">{status}</p>}{error && <p className="import-error" role="alert">{error}</p>}
    </div>
    <aside className="import-aside"><section className="profile-card"><p className="eyebrow">结果如何读</p><h2>看证据，不猜人心</h2><p>每条观察附上原话或时间锚点，并写明其他可能解释。线下互动、被截断的记录、没有说出口的意图仍是未知。</p><p>不同平台的聊天导出格式不统一。这里接收你已经取得的文件，不会要求微信登录、破解数据库或偷偷截图。</p></section><section className="profile-card"><h2>保护隐私</h2><p>本站不保存原始上传文件。若你同意保存档案，只有你挑选并再次确认的简短线索才进入对象档案。服务商处理数据的规则仍需单独查看。</p></section></aside></div>
    {results.length > 0 && <section className="import-results"><div className="card-head"><div><p className="eyebrow">分析结果</p><h2>这批记录说明了什么</h2></div><span className="subtle">{results.length} 批已完成</span></div>{finalResult && <AnalysisCard title={results.length > 1 ? "跨批次综合" : "本次总结"} result={finalResult} main />}{latestConversation && <ConversationPanel key={results.length + latestConversation.summary} result={latestConversation} me={analyzedAs.me} other={analyzedAs.other} ready={!!finalResult && !busy} />}
      <details className="batch-details"><summary>查看每批证据与分析</summary>{results.map((item, index) => <AnalysisCard key={index} title={"第 " + (index + 1) + " 批"} result={item} />)}</details>
      {profile?.enabled && <div className="save-import"><label>加入哪位对象的待确认区<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">先选择对象</option>{profile.subjects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" disabled={busy || !subjectId || !finalResult} onClick={() => void saveCandidates()}>把有依据的事件放入待确认</button><a href="/profile">去档案核对 →</a></div>}
    </section>}
  </div></main>;
}

function AnalysisCard({ title, result, main = false }: { title: string; result: Analysis; main?: boolean }) {
  return <article className={"analysis-card " + (main ? "main" : "")}><h3>{title}</h3><p>{result.summary}</p>{result.observations.length > 0 && <div className="observation-list">{result.observations.map((item, index) => <div key={index}><strong>{item.claim}</strong><small>依据：{item.evidence || "材料未提供可核对原话"}</small><small>仍未知：{item.uncertainty || "需结合线下实际行为"}</small></div>)}</div>}{result.questions.length > 0 && <p className="next-questions">继续判断前可核对：{result.questions.join("；")}</p>}<KnowledgeBasis sources={result.knowledgeSources} /></article>;
}

function ConversationPanel({ result, me, other, ready }: { result: Analysis; me: string; other: string; ready: boolean }) {
  const [copied, setCopied] = useState<number | null>(null);
  const [copyError, setCopyError] = useState("");
  const labels = ["稳妥回应", "主动推进", "说明边界"];
  async function copy(text: string, index: number) {
    try { await navigator.clipboard.writeText(text); setCopyError(""); setCopied(index); window.setTimeout(() => setCopied(null), 2200); }
    catch { setCopied(null); setCopyError("暂时无法自动复制，请长按或选中文字复制。"); }
  }
  return <section className="conversation-panel" aria-label="逐句线索与回复方向">
    <div className="conversation-head"><div><span className="eyebrow">逐句看信号</span><h3>看得见的原话，和还不能确定的事</h3></div><span>仅展示最近一批可辨认的关键句</span></div>
    {result.lineInsights?.length > 0 ? <div className="conversation-lines">{result.lineInsights.map((line, index) => <article key={index} className={"conversation-line " + (line.speaker === me ? "mine" : "") }><div className="conversation-bubble"><div className="conversation-speaker"><strong>{line.speaker === me ? "我" : line.speaker === other ? other : line.speaker}</strong><span>{line.certainty}</span></div><p>“{line.quote}”</p></div><div className="conversation-reading"><strong>{line.signal}</strong><span>另一种解释：{line.alternative}</span></div></article>)}</div> : <p className="conversation-empty">这批材料暂时无法可靠地分出原话和说话人。可以补充带称呼、时间的文字记录，或更清楚的截图。</p>}
    <div className="conversation-replies"><div className="conversation-replies-head"><h4>如果现在要回复</h4><span>根据最后一批材料，选择符合你真实意愿的一条</span></div>{!ready ? <p className="conversation-empty">全部材料分析完成后，再看回复方向。</p> : result.replyOptions?.length === 3 ? <div className="conversation-reply-grid">{result.replyOptions.map((option, index) => <article key={index} className="conversation-reply"><div><strong>{labels[index]}</strong><button type="button" onClick={() => void copy(option.text, index)} aria-label={"复制" + labels[index]}>{copied === index ? "已复制" : "复制"}</button></div><p>{option.text}</p><small>{option.when}</small><ReplyPaths paths={option.next} /></article>)}</div> : <p className="conversation-empty">这批材料暂时不足以给出可靠的回复备选，或当前情境不适合直接发话术。先看上方总结与待核对的问题。</p>}{copyError && <p className="conversation-empty" role="status">{copyError}</p>}<span className="sr-only" role="status">{copied !== null ? "回复已复制" : ""}</span></div>
  </section>;
}

