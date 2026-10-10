"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, CreditCard, Search, ShieldCheck, Users, Wallet } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { CreditAccount, dateLabel, featureLabels } from "@/lib/web-account";
import "@/app/admin/credits/admin-credits.css";

type Member = { ownerId: string; userId: string | null; name: string; source: "web" | "existing" | "miniapp"; balance: number; features: string[]; enabledUntil: number; status: "active" | "pending" | "expired"; createdAt: number; lastLoginAt: number };
type Activity = { kind: "adjustment" | "permissions" | "task"; amount: number; detail: string; actor: string; state: string; feature: string; features: string; enabled_until: number; time: number };
type Operation = { action: "adjust" | "permissions"; userId: string; reason: string; delta?: number; features?: string[]; enabledUntil?: number; id: string };
type Filter = "all" | "active" | "pending" | "expired";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sourceLabels = { web: "网页会员", existing: "已有账号", miniapp: "小程序会员" };
const statusLabels = { active: "已开通", pending: "待开通", expired: "已到期" };
const dateInput = (time: number) => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
const fmt = (time: number) => time ? dateLabel(time) : "—";

export function AdminMembersDashboard() {
  const [access, setAccess] = useState<"loading" | "admin" | "denied" | "signed-out">("loading");
  const [operator, setOperator] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, pending: 0 });
  const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState(""); const [appliedSearch, setAppliedSearch] = useState("");
  const [listBusy, setListBusy] = useState(false); const [selected, setSelected] = useState<Member | null>(null);
  const [target, setTarget] = useState<CreditAccount | null>(null); const [activity, setActivity] = useState<Activity[]>([]);
  const [detailBusy, setDetailBusy] = useState(false); const [detailError, setDetailError] = useState("");
  const [delta, setDelta] = useState(""); const [reason, setReason] = useState(""); const [features, setFeatures] = useState<string[]>([]);
  const [expires, setExpires] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Operation | null>(null); const [activityFilter, setActivityFilter] = useState<"all" | Activity["kind"]>("all");
  const flight = useRef(false), listGeneration = useRef(0), detailGeneration = useRef(0);
  const storageKey = `coach_web_admin_pending:${operator}`;

  useEffect(() => {
    void fetch("/api/account/credits", { cache: "no-store" }).then(async response => {
      if (response.status === 401) { setAccess("signed-out"); return; }
      const data = await response.json() as { account: CreditAccount; admin?: boolean; error?: string };
      if (!response.ok) throw Error(data.error || "无法确认管理员权限。");
      setAccess(data.admin ? "admin" : "denied");
      const ownId = data.account?.userId || ""; setOperator(ownId);
      if (data.admin && ownId) try {
        const value = JSON.parse(localStorage.getItem(`coach_web_admin_pending:${ownId}`) || "null");
        if (value && uuid.test(value.id) && uuid.test(value.userId)) setPending(value);
      } catch { /* Browser storage may be unavailable. */ }
    }).catch(cause => { setError(cause.message); setAccess("denied"); });
  }, []);

  async function loadMembers() {
    const generation = ++listGeneration.current; setListBusy(true);
    try {
      const url = new URL("/api/account/admin/members", window.location.origin);
      url.searchParams.set("search", appliedSearch); url.searchParams.set("status", filter); url.searchParams.set("page", String(page));
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json() as { members: Member[]; summary: typeof summary; total: number; error?: string };
      if (!response.ok) throw Error(data.error || "会员列表读取失败。");
      if (generation !== listGeneration.current) return;
      setMembers(data.members); setSummary(data.summary); setTotal(data.total); setError("");
    } catch (cause) { if (generation === listGeneration.current) setError(cause instanceof Error ? cause.message : "会员列表读取失败。"); }
    finally { if (generation === listGeneration.current) setListBusy(false); }
  }
  useEffect(() => { if (access === "admin") void loadMembers(); }, [access, appliedSearch, filter, page]);

  function present(account: CreditAccount, records: Activity[]) {
    setTarget(account); setActivity(records); setFeatures(account.features);
    setExpires(dateInput(account.enabledUntil > Date.now() ? account.enabledUntil : Date.now() + 365 * 86400000));
  }
  async function loadDetail(member: Member) {
    const generation = ++detailGeneration.current; setSelected(member); setTarget(null); setActivity([]); setDetailError(""); setNotice(""); setDetailBusy(true); setActivityFilter("all");
    try {
      const response = await fetch(`/api/account/admin/credits?ownerId=${encodeURIComponent(member.ownerId)}`, { cache: "no-store" });
      const data = await response.json() as { account: CreditAccount; activity: Activity[]; error?: string };
      if (!response.ok) throw Error(data.error || "会员资料读取失败。");
      if (generation !== detailGeneration.current) return;
      present(data.account, data.activity);
      setSelected({ ...member, userId: data.account.userId, balance: data.account.balance, features: data.account.features, enabledUntil: data.account.enabledUntil,
        status: data.account.enabledUntil > Date.now() && data.account.features.length ? "active" : data.account.enabledUntil ? "expired" : "pending" });
      if (window.innerWidth <= 760) window.setTimeout(() => document.querySelector(".admin-detail-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
    } catch (cause) { if (generation === detailGeneration.current) setDetailError(cause instanceof Error ? cause.message : "会员资料读取失败。"); }
    finally { if (generation === detailGeneration.current) setDetailBusy(false); }
  }
  function searchMembers(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()); }

  async function execute(operation: Operation) {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(""); setNotice(""); setPending(operation);
    try {
      localStorage.setItem(storageKey, JSON.stringify(operation));
      const response = await fetch("/api/account/admin/credits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation) });
      const data = await response.json() as { account: CreditAccount; replayed?: boolean; error?: string };
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408) { setPending(null); localStorage.removeItem(storageKey); }
        throw Error(data.error || "保存失败。");
      }
      setPending(null); localStorage.removeItem(storageKey);
      const confirmation = data.replayed ? "这笔操作此前已成功，没有重复执行。" : operation.action === "adjust" ? "积分调整已保存。" : "功能权限已保存。";
      if (operation.action === "adjust") setDelta("");
      if (selected) await loadDetail(selected);
      await loadMembers();
      setNotice(confirmation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "网络异常，请重试原操作核对结果。"); }
    finally { flight.current = false; setBusy(false); }
  }
  function prepare(action: Operation["action"]) {
    if (!target || busy || pending) return;
    const why = reason.trim();
    if (why.length < 2 || why.length > 200) { setError("请填写 2–200 字操作原因或订单备注。"); return; }
    const operation: Operation = { id: crypto.randomUUID(), action, userId: target.userId, reason: why };
    if (action === "adjust") {
      operation.delta = Number(delta);
      if (!Number.isSafeInteger(operation.delta) || !operation.delta || Math.abs(operation.delta) > 1000000) { setError("积分需为非零整数，单次不超过 100 万；扣减填负数。"); return; }
    } else {
      operation.features = features;
      operation.enabledUntil = features.length ? Date.parse(expires + "T23:59:59+08:00") : 0;
      if (!Number.isSafeInteger(operation.enabledUntil) || features.length && operation.enabledUntil <= Date.now()) { setError("请选择有效的未来到期日。"); return; }
    }
    const detail = action === "adjust" ? `积分 ${operation.delta! > 0 ? "+" : ""}${operation.delta}` : `${features.map(key => featureLabels[key]).join("、") || "关闭全部功能"}，到期 ${features.length ? expires : "立即关闭"}`;
    if (window.confirm(`确认操作 ${selected?.name || target.userId}？\n${detail}\n原因：${why}`)) void execute(operation);
  }

  const visibleActivity = activityFilter === "all" ? activity : activity.filter(item => item.kind === activityFilter);
  return <main className="admin-page"><WebNav/><div className="admin-dashboard">
    <header className="admin-dash-head"><div><span className="admin-kicker">MEMBER OPERATIONS</span><h1>会员管理</h1><p>找会员、开权限、调积分，记录留在同一处。</p></div><a className="admin-back-link" href="/account"><ArrowLeft size={16}/>返回账户</a></header>
    {access === "loading" && <div className="admin-empty" role="status">正在确认管理员权限…</div>}
    {access === "signed-out" && <div className="admin-empty"><p>请先登录管理员账号。</p><a className="web-button" href="/login?return_to=%2Fadmin%2Fcredits">前往登录</a></div>}
    {access === "denied" && <div className="admin-empty"><p>当前账号没有管理权限。</p><a href="/account">返回账户</a></div>}
    {access === "admin" && <>
      <div className="admin-overview"><div><Users size={19}/><span>全部会员</span><strong>{summary.total}</strong></div><div><ShieldCheck size={19}/><span>已开通</span><strong>{summary.active}</strong></div><div><Clock3 size={19}/><span>待开通</span><strong>{summary.pending}</strong></div></div>
      {pending && <div className="admin-pending-bar"><div><b>有一笔操作等待核对</b><span>{pending.action === "adjust" ? `积分 ${pending.delta}` : "功能权限"} · {pending.userId}</span></div><button type="button" disabled={busy} onClick={() => void execute(pending)}>核对 / 重试原操作</button></div>}
      {error && <p className="admin-feedback error" role="alert">{error}</p>}{notice && <p className="admin-feedback success" role="status">{notice}</p>}
      <div className="admin-main-grid"><aside className="admin-member-panel"><div className="admin-panel-heading"><h2>会员列表</h2><span>{total} 位</span></div>
        <form className="admin-search" onSubmit={searchMembers}><Search size={18}/><input aria-label="搜索会员" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索用户名、用户编号"/><button type="submit">搜索</button></form>
        <div className="admin-filters" role="group" aria-label="会员状态筛选">{([['all','全部'],['active','已开通'],['pending','待开通'],['expired','已到期']] as const).map(([key,label])=><button type="button" key={key} className={filter===key?"selected":""} onClick={()=>{setFilter(key);setPage(1);}}>{label}</button>)}</div>
        <div className="admin-member-list">{listBusy && !members.length ? <p className="admin-list-message">正在读取会员…</p> : members.length ? members.map(member=><button type="button" key={member.ownerId} className={"admin-member-item"+(selected?.ownerId===member.ownerId?" current":"")} onClick={()=>void loadDetail(member)}><span className="admin-member-avatar">{member.name.slice(0,1).toUpperCase()}</span><span className="admin-member-info"><b>{member.name}</b><small>{sourceLabels[member.source]} · {member.userId ? member.userId.slice(0,8) : "新会员"}</small></span><span className="admin-member-side"><em className={"admin-status "+member.status}>{statusLabels[member.status]}</em><small>{member.balance} 积分</small></span></button>) : <p className="admin-list-message">没有符合条件的会员。</p>}</div>
        <div className="admin-pagination"><button type="button" disabled={page<=1||listBusy} onClick={()=>setPage(p=>p-1)} aria-label="上一页"><ChevronLeft size={16}/></button><span>第 {page} / {Math.max(1,Math.ceil(total/30))} 页</span><button type="button" disabled={page*30>=total||listBusy} onClick={()=>setPage(p=>p+1)} aria-label="下一页"><ChevronRight size={16}/></button></div>
      </aside><section className="admin-detail-panel">{!selected ? <div className="admin-detail-placeholder"><Users size={32}/><h2>选择一位会员</h2><p>从左侧列表打开账户，查看余额、权限与全部操作记录。</p></div> : <>
        <div className="admin-detail-head"><div><span className="admin-kicker">MEMBER DETAIL</span><h2>{selected.name}</h2><p>{sourceLabels[selected.source]} · {selected.userId || target?.userId || "正在建立用户编号"}</p></div><span className={"admin-status "+selected.status}>{statusLabels[selected.status]}</span></div>
        {detailBusy && <p className="admin-list-message" role="status">正在读取会员资料…</p>}{detailError && <p className="admin-feedback error" role="alert">{detailError}</p>}
        {target && <><div className="admin-account-stats"><div><Wallet size={17}/><small>可用积分</small><strong>{target.balance}</strong></div><div><CreditCard size={17}/><small>已使用</small><strong>{target.spent}</strong></div><div><CalendarDays size={17}/><small>权限到期</small><strong className="date">{target.enabledUntil ? dateLabel(target.enabledUntil).slice(0,10) : "未开通"}</strong></div></div>
          <div className="admin-current-permissions"><b>当前权限</b><span>{target.features.length ? target.features.map(key=>featureLabels[key]||key).join(" · ") : "尚未开通任何功能"}</span>{target.reserved>0 && <small>处理中暂留 {target.reserved} 积分</small>}</div>
          <div className="admin-actions"><h3>开通与调整</h3><label className="admin-reason">操作原因 / 订单备注<input value={reason} maxLength={200} disabled={busy||!!pending} onChange={event=>setReason(event.target.value)} placeholder="例如：订单 20261009 已核对"/></label>
            <div className="admin-action-cards"><section><h4>调整积分</h4><p>增加填正数，扣减填负数。</p><div className="admin-quick-amounts">{[50,100,200,500].map(value=><button type="button" key={value} onClick={()=>setDelta(String(value))}>+{value}</button>)}</div><label>本次调整<input type="number" step="1" min="-1000000" max="1000000" value={delta} disabled={busy||!!pending} onChange={event=>setDelta(event.target.value)} placeholder="输入积分数"/></label><button className="admin-action-primary" type="button" disabled={busy||!!pending} onClick={()=>prepare("adjust")}>确认积分调整 <ArrowRight size={15}/></button></section>
            <section><h4>功能与有效期</h4><p>勾选需要开通的功能，再设置到期日。</p><div className="admin-feature-checks">{Object.entries(featureLabels).map(([key,label])=><label key={key}><input type="checkbox" checked={features.includes(key)} disabled={busy||!!pending} onChange={event=>setFeatures(current=>event.target.checked?[...current,key]:current.filter(item=>item!==key))}/><span>{label}</span></label>)}</div><div className="admin-quick-dates">{[30,90,365].map(days=><button type="button" key={days} onClick={()=>setExpires(dateInput(Date.now()+days*86400000))}>{days} 天</button>)}</div><label>有效期至<input type="date" value={expires} disabled={busy||!!pending} onChange={event=>setExpires(event.target.value)}/></label><button className="admin-action-primary" type="button" disabled={busy||!!pending} onClick={()=>prepare("permissions")}>保存功能权限 <Check size={15}/></button></section></div>
          </div>
          <div className="admin-activity"><div className="admin-panel-heading"><div><h3>账户明细</h3><p>人工操作、功能变化和实际使用分开标记</p></div><span>最近 {activity.length} 条</span></div><div className="admin-activity-filters">{([['all','全部'],['adjustment','积分调整'],['permissions','权限变更'],['task','分析消费']] as const).map(([key,label])=><button type="button" key={key} className={activityFilter===key?"selected":""} onClick={()=>setActivityFilter(key)}>{label}</button>)}</div><div className="admin-activity-list">{visibleActivity.length ? visibleActivity.map((item,index)=>{const permissionFeatures = item.kind==='permissions' ? JSON.parse(item.features||'[]') as string[] : [];const label=item.kind==='adjustment'?'人工调整':item.kind==='permissions'?'权限变更':item.state==='settled'?'分析消费':item.state==='released'?'失败退回':'处理中暂留';const detail=item.kind==='permissions' ? `${permissionFeatures.map(key=>featureLabels[key]||key).join('、')||'关闭全部功能'} · ${item.enabled_until?dateLabel(item.enabled_until).slice(0,10)+' 到期':'立即关闭'}` : item.kind==='task' ? featureLabels[item.feature]||item.feature : item.detail;return <div className="admin-activity-row" key={item.kind+item.time+index}><span className={"admin-activity-mark "+item.kind}>{item.kind==='permissions'?<ShieldCheck size={17}/>:item.kind==='adjustment'?<Wallet size={17}/>:<CreditCard size={17}/>}</span><span className="admin-activity-info"><b>{label}</b><small>{detail}</small>{item.kind!=='task'&&item.detail&&item.kind==='permissions'&&<small>备注：{item.detail}</small>}</span><span className="admin-activity-end"><b className={item.amount>0?'positive':item.amount<0?'negative':''}>{item.kind==='permissions'?'—':item.state==='released'?'已全额退回':(item.amount>0?'+':'')+item.amount}</b><small>{fmt(item.time)}</small></span></div>}) : <p className="admin-list-message">暂无这类记录。</p>}</div></div>
        </>}
      </>}</section></div>
    </>}
  </div></main>;
}
