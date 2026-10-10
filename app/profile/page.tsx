"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Pause, Play, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { dimensions, suitability, type Dimension, type Fact, type ProfileState, type SelfData, type Subject, type SubjectData } from "@/lib/profile";

const empty: ProfileState = { enabled: false, paused: false, self: {}, subjects: [], facts: [] };
const fieldNames: Record<string, string> = {
  mbti: "MBTI", subjectiveScore: "主观综合评分", strengths: "优势", growthAreas: "希望成长的部分",
  goals: "关系目标", values: "价值观", boundaries: "边界", preferredRelationship: "理想关系",
  stage: "当前阶段", howMet: "认识方式", concerns: "顾虑", notes: "其他信息", recentEvent: "关键事件",
};

export default function ProfilePage() {
  const [state, setState] = useState<ProfileState>(empty);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [self, setSelf] = useState<SelfData>({});
  const [subject, setSubject] = useState<SubjectData>({});
  const [label, setLabel] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    void fetch("/api/profile", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) { setSignedOut(true); return; }
      if (!response.ok) throw new Error("档案暂时无法读取。");
      const next = await response.json() as ProfileState;
      setState(next); setSelf(next.self);
    }).catch((cause) => { setLoadFailed(true); setError(cause instanceof Error ? cause.message : "档案暂时无法读取。"); })
      .finally(() => setLoading(false));
  }, []);
  function selectSubject(id: string | null, source = state.subjects) {
    setSelectedId(id);
    const item = source.find((subject) => subject.id === id);
    setSubject(item?.data || {});
    setLabel(item?.label || "");
  }
  async function act(action: string, extra: Record<string, unknown> = {}, message = "已保存。") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/profile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await response.json() as ProfileState & { error?: string };
      if (!response.ok) throw new Error(data.error || "保存失败。");
      setState(data);
      if (["self", "fact-decide", "wipe", "consent"].includes(action)) setSelf(data.self);
      setNotice(message);
      if (selectedId && ["subject-update", "fact-decide", "subject-delete", "wipe", "consent"].includes(action)) {
        const updated = data.subjects.find((item) => item.id === selectedId);
        if (updated) { setSubject(updated.data); setLabel(updated.label); }
      }
      return data;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。"); return null; }
    finally { setBusy(false); }
  }
  const current = state.subjects.find((item) => item.id === selectedId);
  const score = current ? suitability(state.self, current.data) : null;
  const pending = state.facts.filter((item) => item.status === "pending");
  const memories=state.facts.filter(item=>item.status==="accepted"&&item.field==="chatMemory"&&item.subjectId===selectedId);
  const memoryGroups=Object.values(memories.reduce<Record<string,Fact[]>>((groups,item)=>{
    const key=item.subjectId+":"+item.evidence.split("#")[0];
    (groups[key] ||= []).push(item);return groups;
  },{})).map(group=>group.sort((a,b)=>Number(a.evidence.split("#")[1]||1)-Number(b.evidence.split("#")[1]||1)));
  const observed = current ? dimensions.filter(({ key }) => current.data.ratings?.[key]) : [];
  const high = current ? dimensions.filter(({ key }) => (current.data.ratings?.[key] || 0) >= 4).map((item) => item.label) : [];
  const low = current ? dimensions.filter(({ key }) => (current.data.ratings?.[key] || 9) <= 2).map((item) => item.label) : [];

  return <main className="profile-page">
    <div className="profile-wrap">
      <header className="profile-top"><Link href="/" className="back-link"><ArrowLeft size={18} /> 返回工作台</Link><span>成子 · 关系档案</span></header>
      <section className="profile-intro"><p className="eyebrow">越了解，越不靠猜</p><h1>把重要的人和事，放在一起看。</h1><p>截图原图不会存入档案；你在微信回复「是」后，本次已识别聊天文字才会作为该对象的长期记忆保存，可在这里查看和删除。其他新线索仍须你确认。还没想清楚要找什么样的人？<Link href="/positioning">先做择偶定位</Link>。<Link href="/miniapp/manage">管理小程序关联</Link>。</p></section>
      {loading ? <section className="profile-card profile-loading" aria-busy="true" role="status"><div className="profile-skeleton wide" /><div className="profile-skeleton" /><span>正在读取你的关系档案…</span></section> :
      loadFailed ? <section className="profile-card consent-card"><h2>档案暂时打不开</h2><p>你的资料没有被改动。检查网络后再试一次。</p><button type="button" className="primary-action" onClick={() => window.location.reload()}>重新加载</button></section> :
      signedOut ? <section className="profile-card"><h2>先登录再建档</h2><p>关系资料只对登录的本人开放。</p><a className="primary-action" href="/login?return_to=%2Fprofile" target="_top">登录并继续</a></section> :
      !state.enabled ? <section className="profile-card consent-card"><h2>启用你的关系档案</h2><p>同意后，成子 会保存你填写的本人和对象资料，并从后续对话中整理待确认的线索。你可以随时查看、修改、暂停、撤回同意或彻底删除。</p><button type="button" className="primary-action" disabled={busy} onClick={() => void act("consent", { enabled: true }, "档案已启用。先填写你的基本资料吧。")}>同意并启用</button>{state.subjects.length > 0 && <button type="button" className="text-action" onClick={() => { if (window.confirm("永久删除你所有的关系档案？此操作无法撤销。")) void act("wipe", {}, "全部档案已删除。"); }}>删除已保留的档案</button>}</section> :
      <div className="profile-layout">
        <div className="profile-quickstart"><div><strong>{pending.length ? "先核对新线索" : state.subjects.length ? "资料会随着对话慢慢补全" : "先记两件最重要的事"}</strong><p>{pending.length ? "有 " + pending.length + " 条从对话中整理的信息，确认后才会成为正式档案。" : state.subjects.length ? "不必一次填满。下次聊这个人时选中对象，军师就能结合你确认的资料回答。" : "写下你想要怎样的关系，再给正在接触的人起个称呼；其他都可以留空。"}</p></div><a href={pending.length ? "#review-facts" : state.subjects.length ? "/" : "#my-profile"}>{pending.length ? "去核对" : state.subjects.length ? "带着档案去聊" : "从这里开始"} →</a></div>
        <div className="profile-main">
          <section className="profile-card" id="my-profile">
            <div className="card-head"><div><p className="eyebrow">01 / 你自己</p><h2>我的资料</h2></div><span className="subtle">不知道可留空，随时修改</span></div>
            <div className="field-grid">
              <TextField label="MBTI（可留空）" value={self.mbti} onChange={(value) => setSelf({ ...self, mbti: value })} />
              <label className="field"><span>主观综合评分 · 0–100</span><input type="number" min="0" max="100" value={self.subjectiveScore ?? ""} onChange={(event) => setSelf({ ...self, subjectiveScore: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="仅代表你自己的感受" /></label>
              <TextField label="我的优势" value={self.strengths} onChange={(value) => setSelf({ ...self, strengths: value })} />
              <TextField label="想成长的部分" value={self.growthAreas} onChange={(value) => setSelf({ ...self, growthAreas: value })} />
              <TextField label="关系目标" value={self.goals} onChange={(value) => setSelf({ ...self, goals: value })} />
              <TextField label="理想关系" value={self.preferredRelationship} onChange={(value) => setSelf({ ...self, preferredRelationship: value })} />
              <TextField label="看重的价值观" value={self.values} onChange={(value) => setSelf({ ...self, values: value })} wide />
              <TextField label="我的边界与底线" value={self.boundaries} onChange={(value) => setSelf({ ...self, boundaries: value })} wide />
            </div>
            <h3 className="section-label">我更看重什么</h3><p className="section-help">每项选 1–5，默认权重为 3；它只影响适配度计算，不代表普遍标准。</p>
            <div className="dimension-grid">{dimensions.map(({ key, label: name }) => <label className="rating-field" key={key}><span>{name}</span><select value={self.weights?.[key] ?? 3} onChange={(event) => setSelf({ ...self, weights: { ...self.weights, [key]: Number(event.target.value) } })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}</div>
            <button className="primary-action" type="button" disabled={busy} onClick={() => void act("self", { data: self }, "我的资料已更新。")}>保存我的资料</button>
          </section>
          <section className="profile-card" id="subjects">
            <div className="card-head"><div><p className="eyebrow">02 / 接触对象</p><h2>分别认识每个人</h2></div><span className="subtle">{state.subjects.length} 位对象</span></div>
            <div className="subject-tabs">{state.subjects.map((item) => <button key={item.id} type="button" className={"subject-tab " + (selectedId === item.id ? "active" : "")} onClick={() => selectSubject(item.id)}>{item.label}{item.status === "draft" && <small>待确认</small>}</button>)}</div>
            <form className="add-subject" onSubmit={(event) => { event.preventDefault(); void act("subject-create", { label: newLabel }, "新对象已建立。").then((next) => { if (next) { selectSubject(next.subjects.find((item) => item.label === newLabel.trim())?.id || null, next.subjects); setNewLabel(""); } }); }}><input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} maxLength={60} placeholder="输入新对象的称呼或代号" aria-label="新对象称呼" /><button type="submit" disabled={busy || !newLabel.trim()}><Plus size={17} /> 新建</button></form>
            {current ? <>
              {current.status === "draft" && <div className="draft-note">这是从你的对话里发现的新对象草稿。请确认称呼与信息是否准确。</div>}
              <div className="field-grid">
                <TextField label="称呼或代号" value={label} onChange={setLabel} />
                <TextField label="目前的关系阶段" value={subject.stage} onChange={(value) => setSubject({ ...subject, stage: value })} />
                <TextField label="认识方式" value={subject.howMet} onChange={(value) => setSubject({ ...subject, howMet: value })} />
                <TextField label="MBTI（只填确定的）" value={subject.mbti} onChange={(value) => setSubject({ ...subject, mbti: value })} />
                <label className="field"><span>你的主观综合评分 · 0–100</span><input type="number" min="0" max="100" value={subject.subjectiveScore ?? ""} onChange={(event) => setSubject({ ...subject, subjectiveScore: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="不等于人的客观价值" /></label>
                <TextField label="你欣赏的地方" value={subject.strengths} onChange={(value) => setSubject({ ...subject, strengths: value })} />
                <TextField label="顾虑或待验证之处" value={subject.concerns} onChange={(value) => setSubject({ ...subject, concerns: value })} />
                <TextField label="价值观和生活方向" value={subject.values} onChange={(value) => setSubject({ ...subject, values: value })} wide />
                <TextField label="边界与相处方式" value={subject.boundaries} onChange={(value) => setSubject({ ...subject, boundaries: value })} wide />
                <TextField label="关键事件／其他备注" value={subject.notes} onChange={(value) => setSubject({ ...subject, notes: value })} wide />
              </div>
              <div className="button-row"><button className="primary-action" type="button" disabled={busy} onClick={() => void act("subject-update", { id: current.id, label, data: subject }, "对象资料已更新。")}>保存对象资料</button><button className="danger-action" type="button" disabled={busy} onClick={() => { if (window.confirm("永久删除“" + current.label + "”及其线索？")) void act("subject-delete", { id: current.id }, "对象档案已删除。").then(() => selectSubject(null)); }}><Trash2 size={16} /> 删除对象</button></div>
            </> : <p className="empty-note">选一个对象查看，或先新建一位。以后在聊天中提到明确的新对象，也会出现待确认草稿。</p>}
          </section>
        </div>
        <aside className="profile-side">
          <section className="profile-card insight-card">
            <p className="eyebrow">03 / 适配观察</p><h2>{current ? current.label : "选择对象"}的六维图</h2>
            <Radar ratings={current?.data.ratings || {}} />
            {current && <><div className="dimension-grid">{dimensions.map(({ key, label: name }) => <label className="rating-field" key={key}><span>{name}</span><select value={subject.ratings?.[key] ?? ""} onChange={(event) => setSubject({ ...subject, ratings: { ...subject.ratings, [key]: event.target.value ? Number(event.target.value) : undefined } })}><option value="">未知</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}</div><p className="section-help">评分来自你自己的观察，1 为明显不适配，5 为很适配。修改后请保存对象资料。</p></>}
            <div className="insight-summary">{current ? <><strong>{score ? "主观适配度 " + score.score + "/100" : "信息还不够计算适配度"}</strong><p>已评 {observed.length}/6 维。{score ? "这是按你的权重计算的参考，不是对人的价值判定。" : "至少评估 3 维后显示参考分。"}</p>{high.length > 0 && <p>目前较匹配：{high.join("、")}。</p>}{low.length > 0 && <p>值得留意：{low.join("、")}，建议结合具体行为再判断。</p>}{observed.length < 6 && <p>仍未知：{dimensions.filter(({ key }) => !current.data.ratings?.[key]).map((item) => item.label).join("、")}。</p>}</> : <p>选中对象后，在这里查看六维适配观察。</p>}</div>
            {current && <a className="outline-action" href={"/?subjectId=" + encodeURIComponent(current.id) + "&prompt=" + encodeURIComponent("结合我的档案，分析我和" + current.label + "是否适合继续发展。请分清已知和未知，并指出还要观察什么。")}>让军师综合分析 →</a>}
          </section>
          <section className="profile-card" id="review-facts">
            <div className="card-head"><div><p className="eyebrow">04 / 新发现</p><h2>待你确认</h2></div><span className="subtle">{pending.length} 条</span></div>
            {pending.length ? pending.slice(0, 20).map((item) => <FactCard key={item.id} fact={item} subject={state.subjects.find((subject) => subject.id === item.subjectId)} busy={busy} onDecision={(decision) => void act("fact-decide", { id: item.id, decision }, decision === "accept" ? "这条信息已加入档案。" : "已忽略这条信息。")} />) : <p className="empty-note">对话里有值得记下的信息时，会先放在这里，不会悄悄写进正式档案。</p>}
          </section>
            {current&&<section className="profile-card"><h2>「{current.label}」的微信聊天记忆</h2><p>只显示你在微信明确回复「是」保存的已识别文字；原截图不保存。删除整次记忆后，后续分析不再从长期档案读取。</p>{memoryGroups.length?memoryGroups.map(group=><div className="fact-card" key={group[0].evidence.split("#")[0]}><div className="fact-meta">{new Date(group[0].createdAt).toLocaleDateString("zh-CN")} · 微信截图已确认{group.length>1?" · 共"+group.length+"段":""}</div><details><summary>查看本次聊天文字</summary><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{group.map(item=>item.value).join("\n")}</p></details><button className="danger-action" type="button" disabled={busy} onClick={()=>{if(window.confirm("删除这次微信聊天记忆的全部文字？"))void act("memory-delete",{id:group[0].id},"这次记忆已全部删除。");}}>删除这次记忆</button></div>):<p className="empty-note">还没有确认保存的微信聊天记忆。</p>}</section>}
          <section className="profile-card controls-card"><h2>档案控制</h2><p>暂停后，对话不读取档案，也不会整理新信息。撤回同意会保留旧资料供你查看；删除会永久清空。</p><div className="control-actions"><button type="button" disabled={busy} onClick={() => void act("pause", { paused: !state.paused }, state.paused ? "档案已恢复。" : "档案已暂停。")}>{state.paused ? <Play size={16} /> : <Pause size={16} />}{state.paused ? "恢复使用" : "暂停使用"}</button><button type="button" disabled={busy} onClick={() => void act("consent", { enabled: false }, "已撤回同意，旧资料仍可查看或删除。")}>撤回同意</button><button type="button" className="delete-control" disabled={busy} onClick={() => { if (window.confirm("永久删除你的本人资料、全部对象和线索？无法撤销。")) void act("wipe", {}, "全部档案已删除。"); }}><Trash2 size={16} /> 清空所有档案</button></div></section>
        </aside>
      </div>}
      {error && <div className="profile-toast error" role="alert">{error}</div>}{notice && <div className="profile-toast" role="status">{notice}</div>}
    </div>
  </main>;
}

function TextField({ label, value, onChange, wide = false }: { label: string; value?: string; onChange: (value: string) => void; wide?: boolean }) {
  return <label className={"field " + (wide ? "wide" : "")}><span>{label}</span><textarea rows={wide ? 2 : 1} value={value || ""} maxLength={800} onChange={(event) => onChange(event.target.value)} placeholder="不知道可以留空" /></label>;
}
function FactCard({ fact, subject, busy, onDecision }: { fact: Fact; subject?: Subject; busy: boolean; onDecision: (decision: "accept" | "reject") => void }) {
  return <div className="fact-card"><div className="fact-meta">{subject?.label || "本人"} · {fieldNames[fact.field] || fact.field} · {fact.source}</div><strong>{fact.value}</strong><p>依据：{fact.evidence}</p><div className="fact-actions"><button type="button" disabled={busy} onClick={() => onDecision("accept")}><Check size={15} /> 确认加入</button><button type="button" disabled={busy} onClick={() => onDecision("reject")}><X size={15} /> 不准确</button></div></div>;
}
function Radar({ ratings }: { ratings: Partial<Record<Dimension, number>> }) {
  const center = { x: 160, y: 145 }, radius = 90;
  const at = (index: number, value: number) => {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    return [center.x + Math.cos(angle) * radius * value / 5, center.y + Math.sin(angle) * radius * value / 5];
  };
  const points = (value: number) => dimensions.map((_, index) => at(index, value).join(",")).join(" ");
  const complete = dimensions.every(({ key }) => ratings[key]);
  return <svg className="radar" viewBox="0 0 320 300" role="img" aria-label="六维主观适配观察图">
    {[1, 2, 3, 4, 5].map((level) => <polygon key={level} points={points(level)} fill="none" stroke="#dce8e8" strokeWidth="1" />)}
    {dimensions.map(({ key, label }, index) => {
      const outer = at(index, 5); const dot = ratings[key] ? at(index, ratings[key]!) : null;
      const text = at(index, 6.45);
      return <g key={key}><line x1={center.x} y1={center.y} x2={outer[0]} y2={outer[1]} stroke="#dce8e8" />{dot && <circle cx={dot[0]} cy={dot[1]} r="5" fill="#248d87" />}<text x={text[0]} y={text[1]} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#5b7479">{label}</text></g>;
    })}
    {complete && <polygon points={dimensions.map(({ key }, index) => at(index, ratings[key]!).join(",")).join(" ")} fill="#72c5b255" stroke="#268d86" strokeWidth="2" />}
  </svg>;
}

