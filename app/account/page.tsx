"use client";
import { useState } from "react";
import { useAccount } from '@/components/web-analysis/client';
import { Copy, RefreshCw, ArrowRight, Fingerprint, Wallet, Settings2, History, Headphones, UserRound, UsersRound, Smartphone, ShieldCheck, LogOut } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import ui from "@/components/AuroraUI.module.css";
import { CreditAccount, dateLabel, featureLabels, priceLabels, entryLabels } from "@/lib/web-account";
import styles from "./AccountPage.module.css";

type State = { account: CreditAccount; prices: Record<string, number>; user: { name: string }; admin: boolean };
export default function AccountPage() {
  const identity = useAccount(), state = identity.account as State | null, error = identity.error, loading = identity.loading, signedOut = identity.unauthorized;
  const [notice, setNotice] = useState("");
  async function load() { setNotice(''); await identity.refresh(); }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice("已复制，可以粘贴给客服。"); }
    catch { setNotice("请长按或选中文字复制。"); }
  }
  const account = state?.account;
  return <main className={ui.page}><WebNav /><section className={`${ui.wrap} ${styles.content}`}><AuroraPageHero eyebrow="我的账户" title="账户与积分" description={state ? `当前登录：${state.user.name}` : "你的分析权限、余额和使用记录"}><div className={styles.headingActions}>{state?.admin && <a className={ui.primary} href="/admin/credits">管理后台 <ArrowRight size={16}/></a>}<button className={ui.secondary} disabled={loading} onClick={() => void load()}><RefreshCw size={16} />刷新</button></div></AuroraPageHero>
    {loading && !state && <p role="status">正在读取账户…</p>}
    {signedOut && <div className={styles.panel}><p>登录后查看自己的用户编号、积分与开通状态。如果刚才提示账号校验连不上，直接重新登录即可，已保存的资料还在。</p><a className={ui.primary} href="/login?return_to=%2Faccount%23balance">登录账户 <ArrowRight size={16} /></a><div className={styles.guestContact}><p>开通前也可以加微信 <b>lxlikex</b>，扫码和销售页是同一个。</p><a href="/contact-wechat.jpg" target="_blank" rel="noreferrer"><img src="/contact-wechat.jpg" width="160" height="128" alt="成子 客服微信二维码" /></a></div></div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {account && <><section className={styles.balance} id="balance"><div><small>可用积分</small><strong>{account.balance}</strong><span>处理中暂留 {account.reserved} · 累计使用 {account.spent}</span></div><div className={styles.status}><b>{account.active && account.features.length ? "已开通" : account.enabledUntil ? "已到期 / 未启用功能" : "等待开通"}</b><span>有效期：{dateLabel(account.enabledUntil)}</span><span>{account.features.map(key => featureLabels[key] || key).join("、") || "暂未开通功能"}</span><a className={ui.secondary} href="#contact">联系开通 / 补充积分</a></div></section>
    <section className={`${styles.panel} ${styles.identity}`}><h2><Fingerprint size={18}/>你的用户编号</h2><p>将这个编号发给客服，核对后开通此账户。</p><div><code>{account.userId}</code><button className={ui.secondary} onClick={() => void copy(account.userId)}><Copy size={15} />复制编号</button></div></section>
    <div className={styles.grid}><section className={styles.panel}><h2><Wallet size={18}/>积分使用标准</h2><dl className={styles.prices}>{Object.entries(priceLabels).map(([key, label]) => typeof state?.prices[key] === "number" && <div key={key}><dt>{label}</dt><dd>{state.prices[key]} 积分</dd></div>)}</dl><p className={styles.hint}>发起前显示本次费用。处理中暂留积分；任务失败自动退回。新账户不自动赠送积分。</p></section><section className={styles.panel}><h2><Settings2 size={18}/>账户管理</h2><div className={styles.links}><a href="/archive?tab=self"><UserRound size={17}/>我的资料与相处偏好 <ArrowRight size={14}/></a><a href="/archive"><UsersRound size={17}/>人物、隐私授权与数据管理 <ArrowRight size={14}/></a><a href="/miniapp/manage"><Smartphone size={17}/>已关联的小程序身份 <ArrowRight size={14}/></a><a href="/support"><Headphones size={17}/>帮助与助手下载 <ArrowRight size={14}/></a><a href="/privacy"><ShieldCheck size={17}/>数据如何处理 <ArrowRight size={14}/></a>{state?.admin && <a href="/admin/credits"><Settings2 size={17}/>管理员：积分与权限开通 <ArrowRight size={14}/></a>}<a href="/logout"><LogOut size={17}/>退出当前账户 <ArrowRight size={14}/></a></div></section></div>
    <section className={`${styles.panel} ${styles.ledger}`}><h2><History size={18}/>最近使用记录</h2>{account.entries.length ? <div className={styles.ledgerScroll}><table><thead><tr><th>时间</th><th>状态 / 用途</th><th>积分</th></tr></thead><tbody>{account.entries.map((entry, i) => <tr key={i}><td>{dateLabel(entry.time)}</td><td>{entryLabels[entry.kind] || entry.kind}<small>{featureLabels[entry.label] || entry.label}</small></td><td>{entry.kind === "adjustment" ? (entry.amount > 0 ? "+" : "") + entry.amount : entry.kind === "released" ? "+" + entry.amount : entry.kind === "reserved" ? "暂留 " + entry.amount : "−" + entry.amount}</td></tr>)}</tbody></table></div> : <p className={styles.muted}>暂无积分变动。</p>}</section></>}
    <section className={`${styles.panel} ${styles.contact}`} id="contact"><div><h2><Headphones size={18}/>联系开通</h2><p>微信搜索 <b>lxlikex</b>，或扫描 / 长按识别二维码。</p><p>发送你的用户编号，确认服务内容与价格后，由客服为你开通。开通完成后点“刷新”核对积分、功能和有效期。</p><button className={ui.primary} onClick={() => void copy("lxlikex")}><Copy size={15} />复制微信号</button></div><a href="/contact-wechat.jpg" target="_blank" rel="noreferrer"><img src="/contact-wechat.jpg" width="190" height="152" alt="成子 客服微信二维码" /></a></section>
  </section></main>;
}

