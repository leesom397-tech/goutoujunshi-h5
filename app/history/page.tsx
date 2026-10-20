"use client";
import { DataProcessingLink } from "@/components/DataProcessingLink";
import { CaptureEntry } from "@/components/CaptureEntry";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileUp, HardDrive, Search, Trash2 } from "lucide-react";
import { analysisWindow, evidenceWindow, parseHistoryFile, type HistoryParse } from "@/lib/history-import";
import { getHistories, removeHistory, saveHistory, type HistoryArchive } from "@/lib/history-vault";
import type { ProfileState } from "@/lib/profile";

type Analysis = {
  summary: string;
  observations: Array<{ claim: string; evidence: string; uncertainty: string }>;
  questions: string[];
  lineInsights: Array<{ quote: string; speaker: string; signal: string; alternative: string; certainty: string }>;
  replyOptions: Array<{ text: string; when: string }>;
};
type Consistency = { summary: string; checks: Array<{ topic: string; firstQuote: string; secondQuote: string; issue: string; alternative: string; nextQuestion: string }>; unknown: string[] };
export default function HistoryPage() {
  const [ownerId, setOwnerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [archives, setArchives] = useState<HistoryArchive[]>([]);
  const [activeId, setActiveId] = useState("");
  const [pending, setPending] = useState<{ filename: string; parsed: HistoryParse } | null>(null);
  const [self, setSelf] = useState("");
  const [other, setOther] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [rights, setRights] = useState(false);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState(60);
  const [analysisConsent, setAnalysisConsent] = useState(false);
  const [result, setResult] = useState<Analysis | null>(null);
  const [keyword, setKeyword] = useState("");
  const [checkConsent, setCheckConsent] = useState(false);
  const [checkResult, setCheckResult] = useState<Consistency | null>(null);
  const [checkCoverage, setCheckCoverage] = useState({ sent: 0, total: 0 });
  const [sentCount, setSentCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const session = await response.json() as { loggedIn?: boolean; user?: { id: string } };
        if (session.loggedIn && session.user?.id) {
          setOwnerId(session.user.id);
          const saved = await getHistories(session.user.id);
          setArchives(saved);
          setActiveId(saved[0]?.id || "");
          const profileResponse = await fetch("/api/profile", { cache: "no-store" });
          if (profileResponse.ok) setProfile(await profileResponse.json() as ProfileState);
        }
      } catch { setError("本机档案无法读取。请确认浏览器允许本站本地存储。"); }
      finally { setLoading(false); }
    })();
  }, []);
  const active = archives.find((item) => item.id === activeId);
  const visible = useMemo(() => {
    if (!active) return [];
    const needle = query.trim().toLocaleLowerCase();
    return needle ? active.messages.filter((item) => (item.sender + " " + item.text + " " + item.at).toLocaleLowerCase().includes(needle)) : active.messages;
  }, [active, query]);
  async function readFile(file?: File) {
    if (!file) return;
    setError(""); setNotice(""); setPending(null); setRights(false); setResult(null);
    if (file.size > 20_000_000) { setError("单个文件最多 20 MB。请按对象或时间拆分，不会静默截断。"); return; }
    try {
      const parsed = parseHistoryFile(file.name, await file.text());
      setPending({ filename: file.name, parsed });
      setSelf(parsed.participants.length === 2 && parsed.participants.includes("我") ? "我" : "");
      setOther(parsed.participants.length === 2 && parsed.participants.includes("对方") ? "对方" : "");
      setSubjectId("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "文件读取失败。"); }
  }
  async function save() {
    if (!pending || !ownerId || !rights) { setError("请先确认材料来源和本机保存说明。"); return; }
    if (!self || !other || self === other || !pending.parsed.participants.includes(self) || !pending.parsed.participants.includes(other)) {
      setError("请从文件里的说话人中分别选出你和对方。"); return;
    }
    const archive: HistoryArchive = {
      id: crypto.randomUUID(), ownerId, filename: pending.filename, createdAt: Date.now(),
      self, other, subjectId, skipped: pending.parsed.skipped, format: pending.parsed.format,
      messages: pending.parsed.messages,
    };
    setBusy(true); setError("");
    try {
      await saveHistory(archive);
      setArchives((items) => [archive, ...items]);
      setActiveId(archive.id); setPending(null); setQuery(""); setRights(false); setResult(null); setCheckResult(null);
      setNotice("已保存到当前浏览器。记录没有上传服务器，也不会自动同步到手机或别的电脑。");
    } catch { setError("保存失败，可能是浏览器本地空间不足。请勿关闭原文件。"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!active || !window.confirm("从此浏览器删除「" + active.filename + "」的全部导入记录？此操作无法恢复。")) return;
    try {
      await removeHistory(active.id);
      const rest = archives.filter((item) => item.id !== active.id);
      setArchives(rest); setActiveId(rest[0]?.id || ""); setResult(null); setCheckResult(null);
      setNotice("本机记录已删除。已发送过的分析请求不受此操作撤回。");
    } catch { setError("删除失败，请稍后重试。"); }
  }
  async function analyze() {
    if (!active || !analysisConsent || busy) return;
    if (active.messages.some((item) => item.sender !== active.self && item.sender !== active.other)) {
      setError("这份记录有第三位说话人。为避免混淆身份，请先按单聊导出，再分析。"); return;
    }
    const excerpt = analysisWindow(active.messages, active.self, active.other, range);
    if (!excerpt.text || excerpt.count < 2) { setError("选定范围内可读的双人消息太少。"); return; }
    setBusy(true); setError(""); setResult(null); setNotice("仅发送最近 " + excerpt.count + " 条可读文字，不发送整份档案。");
    try {
      const response = await fetch("/api/import/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: excerpt.text, images: [], me: "我", other: "对方", subjectId: active.subjectId || null, mappingConfirmed: true }),
      });
      const data = await response.json() as Analysis & { error?: string };
      if (!response.ok) throw new Error(data.error || "分析失败。");
      setResult(data); setSentCount(excerpt.count);
      setNotice("分析完成。只分析了选定范围，不等于整段关系的定论。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "分析失败。"); }
    finally { setBusy(false); }
  }
  async function checkStatements() {
    if (!active || !checkConsent || busy) return;
    if (active.messages.some((item) => item.sender !== active.self && item.sender !== active.other)) { setError("多方聊天暂不做前后说法核对。"); return; }
    const evidence = evidenceWindow(active.messages, active.self, active.other, keyword);
    if (evidence.count < 2) { setError("至少需要两条包含关键词的双人原话。可以试试“工作”“结婚”“见面”等主题。"); return; }
    setBusy(true); setError(""); setCheckResult(null); setNotice("本机找到 " + evidence.total + " 条匹配，本次只发送其中 " + evidence.count + " 条原话片段。");
    try {
      const response = await fetch("/api/history/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: evidence.text, topic: keyword, confirmed: true }) });
      const data = await response.json() as Consistency & { error?: string };
      if (!response.ok) throw new Error(data.error || "核对未完成。");
      setCheckResult(data); setCheckCoverage({ sent: evidence.count, total: evidence.total });
      setNotice("核对完成。未出现的上下文、线下事实仍是未知，不能据此指认对方撒谎。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "核对未完成。"); }
    finally { setBusy(false); }
  }
  return <main className="history-page"><div className="history-shell">
    <header className="profile-top"><a href="/" className="back-link"><ArrowLeft size={18}/> 返回工作台</a><span>成子 · 电脑端聊天档案</span></header>
    <section className="history-hero"><div><p className="eyebrow">LOCAL-FIRST / DESKTOP ARCHIVE</p><h1>把很长的聊天，<br/><em>变成能核对的关系线索。</em></h1><p>先在电脑导入已有的聊天文本，核对谁说的，再搜索原话、选一段分析。完整记录只留在当前浏览器；分析时才发送你选定的一小段。本机存储未加密，请在自己的电脑使用。</p></div><div className="history-hero-graphic" aria-hidden="true"><span>01 / 导入</span><span>02 / 核对</span><span>03 / 分析</span></div></section>
    {loading ? <div className="profile-card">正在读取当前浏览器的档案…</div> : !ownerId ? <div className="profile-card"><h2>先登录 成子</h2><p>电脑端聊天档案按当前账号隔离显示。</p><a href="/login" className="primary-action">去登录</a></div> : <>
      <CaptureEntry/><div className="history-grid"><section className="profile-card history-import"><div className="history-heading"><FileUp size={21}/><h2>导入聊天文本</h2></div><p>支持已经取得的 TXT／CSV／JSON 单聊文本，单文件最多 20 MB、20 万条。已有文件可继续在这里导入；自动读取请用上方「从电脑版微信导入聊天」。</p><label className="history-file"><FileUp size={22}/><strong>选择电脑上的聊天记录文件</strong><small>CSV 需含正文列；JSON 为消息数组；TXT 建议每行带“昵称：正文”</small><input type="file" accept=".txt,.csv,.json,text/plain" onChange={(event) => void readFile(event.target.files?.[0])}/></label>
        {pending && <div className="history-preview"><strong>导入前核对 · {pending.filename}</strong><p>识别到 {pending.parsed.messages.length.toLocaleString()} 条可读文字、{pending.parsed.participants.length} 个说话人；另有 {pending.parsed.skipped} 条未识别或非文字内容，不会假装转写语音。</p><div className="history-fields"><label>我在记录里的昵称<select value={self} onChange={(event) => setSelf(event.target.value)}><option value="">请选择</option>{pending.parsed.participants.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>对方在记录里的昵称<select value={other} onChange={(event) => setOther(event.target.value)}><option value="">请选择</option>{pending.parsed.participants.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div>{profile?.enabled && profile.subjects.length > 0 && <label className="history-subject">关联对象档案（可选）<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">暂不关联</option>{profile.subjects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}<div className="history-sample">{pending.parsed.messages.slice(0, 3).map((item, index) => <p key={index}><b>{item.sender}</b> {item.text.slice(0, 130)}</p>)}</div><label className="history-check"><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)}/> 我有权提供并在本机保存这份记录；了解它仅存当前浏览器，清理浏览器数据后会丢失。</label><button className="primary-action" type="button" disabled={busy || !rights} onClick={() => void save()}>核对无误，保存到本机</button></div>}
      </section><aside className="profile-card history-guide"><div className="history-heading"><HardDrive size={21}/><h2>怎么从手机到电脑？</h2></div><ol><li>先在微信自带功能里把手机聊天备份／迁移到电脑，以免手机换机时丢失。</li><li>注意：电脑备份通常不是可直接阅读的 TXT／CSV；本站不能自动打开微信加密数据库。</li><li>如果你已经通过有权使用的方式取得某位联系人的明文导出文件，再在左侧导入。语音占位符不会被当成真实语音正文。</li></ol><p>请不要把微信密码、数据库密钥或整机备份交给本站，也不要关闭设备安全防护来获取记录。</p></aside></div>
      {archives.length > 0 && <section className="history-workspace"><div className="history-workspace-head"><div><p className="eyebrow">你的本机档案</p><h2>找原话，再谈判断。</h2></div><span>{archives.length} 份文件 · 仅此浏览器</span></div><div className="history-workspace-grid"><nav className="history-list" aria-label="聊天档案">{archives.map((item) => <button type="button" key={item.id} className={item.id === activeId ? "selected" : ""} onClick={() => { setActiveId(item.id); setQuery(""); setResult(null); setAnalysisConsent(false); }}><strong>{item.filename}</strong><small>{item.messages.length.toLocaleString()} 条 · {item.self} / {item.other}</small></button>)}</nav><div className="history-detail">{active && <><div className="history-detail-head"><div><h3>{active.filename}</h3><p>{active.messages.length.toLocaleString()} 条可读记录 · {active.format} · {active.skipped} 条非文字／未识别</p></div><button type="button" className="history-delete" onClick={() => void remove()} aria-label="删除当前本机档案"><Trash2 size={17}/> 删除</button></div><label className="history-search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="只在这台电脑搜索原话、昵称、时间"/></label><p className="history-count">匹配 {visible.length.toLocaleString()} 条。分析仍按原记录最近消息取样，不会把搜索结果拼成假对话。</p><div className="history-messages">{visible.slice(-150).map((item, index) => <article key={index} className={item.sender === active.self ? "mine" : ""}><small>{item.sender}{item.at ? " · " + item.at : ""}</small><p>{item.text}</p></article>)}{visible.length > 150 && <p className="history-list-note">为保持浏览顺畅，此处只展示匹配结果的最近 150 条；全部 {visible.length.toLocaleString()} 条仍保存在本机。</p>}</div><div className="history-analyze"><h3>选一段做关系解读</h3><p>按原始顺序取最近的可读消息；不会把整份档案一次性发送给模型。多方聊天暂不分析，避免认错人。</p><label>分析最近 <select value={range} onChange={(event) => { setRange(Number(event.target.value)); setResult(null); }}><option value={30}>30 条</option><option value={60}>60 条</option><option value={120}>120 条</option></select> 可读消息</label><label className="history-check"><input type="checkbox" checked={analysisConsent} onChange={(event) => setAnalysisConsent(event.target.checked)}/> 同意分析所选消息文字；本机整份档案不会上传。<DataProcessingLink/></label><button type="button" className="primary-action" disabled={busy || !analysisConsent} onClick={() => void analyze()}>{busy ? "正在分析…" : "分析选定记录"}</button></div></>}</div></div></section>}
      {active && <section className="profile-card history-consistency"><div><p className="eyebrow">跨时间核对 / 自选主题</p><h2>TA 前后说法一致吗？</h2><p>输入你在意的关键词，系统先在本机找相关原话，再抽取一部分交给模型对照。没有命中的消息不在本次判断里；可疑不等于说谎。</p></div><div className="history-consistency-form"><input value={keyword} maxLength={80} onChange={(event) => { setKeyword(event.target.value); setCheckResult(null); }} placeholder="例如：结婚、工作、见面（可输入多个关键词）"/><label className="history-check"><input type="checkbox" checked={checkConsent} onChange={(event) => setCheckConsent(event.target.checked)}/> 我有权提供这些消息，同意分析关键词命中的原话；不会发送整份档案。<DataProcessingLink/></label><button type="button" className="primary-action" disabled={busy || !checkConsent || keyword.trim().length < 2} onClick={() => void checkStatements()}>{busy ? "正在核对…" : "核对前后说法"}</button></div></section>}
      {checkResult && <section className="profile-card history-result"><p className="eyebrow">本次发送 {checkCoverage.sent} / 命中 {checkCoverage.total} 条 · 非连续片段</p><h2>说法核对结果</h2><p>{checkResult.summary}</p>{checkResult.checks?.length ? checkResult.checks.map((item, index) => <article key={index}><strong>{item.topic}：{item.issue}</strong><span>原话 A：“{item.firstQuote}”</span><span>原话 B：“{item.secondQuote}”</span><span>另一种解释：{item.alternative}</span><span>可以这样问：{item.nextQuestion}</span></article>) : <p>这次选中的材料里，没有足够证据证明前后说法冲突。</p>}{checkResult.unknown?.length > 0 && <p>还不知道：{checkResult.unknown.join("；")}</p>}</section>}
      {result && <section className="profile-card history-result"><p className="eyebrow">已分析最近 {sentCount} 条 · 仅供参考</p><h2>关系线索</h2><p>{result.summary}</p>{result.observations?.map((item, index) => <article key={index}><strong>{item.claim}</strong><span>证据：{item.evidence || "未给出可核对原话"}</span><span>其他解释／未知：{item.uncertainty || "需要更多材料"}</span></article>)}{result.lineInsights?.length > 0 && <><h3>关键原话</h3>{result.lineInsights.map((line, index) => <article key={index}><strong>{line.speaker}：“{line.quote}”</strong><span>{line.signal} · {line.certainty}</span><span>也可能：{line.alternative}</span></article>)}</>}{result.replyOptions?.length > 0 && <><h3>如果现在要回</h3>{result.replyOptions.map((option, index) => <article key={index}><strong>{option.text}</strong><span>{option.when}</span></article>)}</>}{result.questions?.length > 0 && <p>待核对：{result.questions.join("；")}</p>}</section>}
      {notice && <p className="import-status" role="status">{notice}</p>}{error && <p className="import-error" role="alert">{error}</p>}
    </>}
  </div></main>;
}

