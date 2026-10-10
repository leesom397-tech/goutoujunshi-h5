"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, RefreshCw, ArrowRight, Fingerprint, Wallet, Settings2, History, Headphones, UserRound, UsersRound, Smartphone, ShieldCheck, LogOut } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { PageIllustration } from "@/components/PageIllustration";
import { CreditAccount, dateLabel, featureLabels, priceLabels, entryLabels } from "@/lib/web-account";
import "./account.css";

type State = { account: CreditAccount; prices: Record<string, number>; user: { name: string }; admin: boolean };
export default function AccountPage() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [notice, setNotice] = useState("");
  const loadGeneration = useRef(0);
  async function load() {
    const generation = ++loadGeneration.current;
    setLoading(true); setError(""); setState(null); setNotice(""); setSignedOut(false);
    try {
      const response = await fetch("/api/account/credits", { cache: "no-store" });
      const data = await response.json() as State & { error?: string };
      if (generation !== loadGeneration.current) return;
      if (response.status === 401) { setSignedOut(true); setState(null); return; }
      if (!response.ok) throw Error(data.error || "暂时无法读取账户。");
      setState(data); setSignedOut(false);
    } catch (cause) { if (generation === loadGeneration.current) setError(cause instanceof Error ? cause.message : "网络异常，请重试。"); }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }
  useEffect(() => { void load(); const refresh = () => { if (!document.hidden) void load(); }; window.addEventListener("focus", refresh); return () => { loadGeneration.current++; window.removeEventListener("focus", refresh); }; }, []);
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice("已复制，可以粘贴给客服。"); }
    catch { setNotice("请长按或选中文字复制。"); }
  }
  const account = state?.account;
  return <main className="account-page"><WebNav /><section className="account-wrap"><div className="account-heading"><div className="account-heading-copy"><span className="account-kicker">我的账户</span><h1>账户与积分</h1><p className="account-lede">{state ? `当前登录：${state.user.name}` : "你的分析权限、余额和使用记录"}</p></div><PageIllustration variant="account" compact className="account-heading-art"/><div className="account-heading-actions">{state?.admin && <a className="web-button account-admin-link" href="/admin/credits">管理后台 <ArrowRight size={16}/></a>}<button className="web-button secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} />刷新</button></div></div>
    {loading && !state && <p role="status">正在读取账户…</p>}
    {signedOut && <div className="web-panel"><p>登录后查看自己的用户编号、积分与开通状态。</p><a className="web-button" href="/login?return_to=%2Faccount">登录账户 <ArrowRight size={16} /></a></div>}
    {error && <p className="web-error" role="alert">{error}</p>}
    {notice && <p className="web-notice" role="status">{notice}</p>}
    {account && <><section className="account-card account-balance"><div><small>可用积分</small><strong>{account.balance}</strong><span>处理中暂留 {account.reserved} · 累计使用 {account.spent}</span></div><div className="account-status"><b>{account.active && account.features.length ? "已开通" : account.enabledUntil ? "已到期 / 未启用功能" : "等待开通"}</b><span>有效期：{dateLabel(account.enabledUntil)}</span><span>{account.features.map(key => featureLabels[key] || key).join("、") || "暂未开通功能"}</span><a className="web-button secondary" href="#contact">联系开通 / 补充积分</a></div></section>
    <section className="web-panel account-id"><h2><Fingerprint size={18}/>你的用户编号</h2><p>将这个编号发给客服，核对后开通此账户。</p><div><code>{account.userId}</code><button className="web-button secondary" onClick={() => void copy(account.userId)}><Copy size={15} />复制编号</button></div></section>
    <div className="account-grid"><section className="web-panel"><h2><Wallet size={18}/>积分使用标准</h2><dl className="web-price-list">{Object.entries(priceLabels).map(([key, label]) => typeof state?.prices[key] === "number" && <div key={key}><dt>{label}</dt><dd>{state.prices[key]} 积分</dd></div>)}</dl><p className="account-hint">发起前显示本次费用。处理中暂留积分；任务失败自动退回。新账户不自动赠送积分。</p></section><section className="web-panel"><h2><Settings2 size={18}/>账户管理</h2><div className="account-links"><a href="/archive?tab=self"><UserRound size={17}/>我的资料与相处偏好 <ArrowRight size={14}/></a><a href="/archive"><UsersRound size={17}/>人物、隐私授权与数据管理 <ArrowRight size={14}/></a><a href="/miniapp/manage"><Smartphone size={17}/>已关联的小程序身份 <ArrowRight size={14}/></a><a href="/privacy"><ShieldCheck size={17}/>数据如何处理 <ArrowRight size={14}/></a>{state?.admin && <a href="/admin/credits"><Settings2 size={17}/>管理员：积分与权限开通 <ArrowRight size={14}/></a>}<a href="/logout"><LogOut size={17}/>退出当前账户 <ArrowRight size={14}/></a></div></section></div>
    <section className="web-panel account-ledger"><h2><History size={18}/>最近使用记录</h2>{account.entries.length ? <div className="ledger-scroll"><table><thead><tr><th>时间</th><th>状态 / 用途</th><th>积分</th></tr></thead><tbody>{account.entries.map((entry, i) => <tr key={i}><td>{dateLabel(entry.time)}</td><td>{entryLabels[entry.kind] || entry.kind}<small>{featureLabels[entry.label] || entry.label}</small></td><td>{entry.kind === "adjustment" ? (entry.amount > 0 ? "+" : "") + entry.amount : entry.kind === "released" ? "+" + entry.amount : entry.kind === "reserved" ? "暂留 " + entry.amount : "−" + entry.amount}</td></tr>)}</tbody></table></div> : <p className="web-muted">暂无积分变动。</p>}</section></>}
    <section className="web-panel account-contact" id="contact"><div><h2><Headphones size={18}/>联系开通</h2><p>微信搜索 <b>lxlikex</b>，或扫描 / 长按识别二维码。</p><p>发送你的用户编号，确认服务内容与价格后，由客服为你开通。开通完成后点“刷新”核对积分、功能和有效期。</p><button className="web-button" onClick={() => void copy("lxlikex")}><Copy size={15} />复制微信号</button></div><a href="/contact-wechat.jpg" target="_blank" rel="noreferrer"><img src="/contact-wechat.jpg" width="190" height="152" alt="成子 客服微信二维码" /></a></section>
  </section></main>;
}

