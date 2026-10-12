"use client";
import { useEffect, useRef, useState } from "react";
import { Search, X, ArrowUpRight, ScanLine, Images, ScanFace, MessageCircle, Users, FileText, UserRound, AudioLines, BookOpen, CircleHelp, ShieldCheck } from "lucide-react";
import { createPortal } from "react-dom";
import type { WorkspaceData } from "@/components/WorkspaceDashboard";

const tools = [
  { title: "分析聊天截图", hint: "截图 / 聊天 / 回复 / 好感", href: "/analyze?mode=chat", icon: ScanLine },
  { title: "分析朋友圈", hint: "朋友圈 / 动态 / 相处", href: "/analyze?mode=moments", icon: Images },
  { title: "分析社交主页", hint: "社交 / 资料 / 适配", href: "/analyze?mode=social", icon: ScanFace },
  { title: "问问军师", hint: "聊天 / 咨询 / 建议 / 练习", href: "/chat", icon: MessageCircle },
  { title: "实时语音", hint: "语音 / 说话 / 麦克风", href: "/voice", icon: AudioLines },
  { title: "人物档案与趋势", hint: "人物 / 档案 / 趋势 / 反馈 / 对比", href: "/archive", icon: Users },
  { title: "历史报告", hint: "报告 / 历史 / 聊天 / 朋友圈 / 社交主页 / 分析", href: "/reports", icon: FileText },
  { title: "我的资料与偏好", hint: "自己 / 自我 / 目标 / 边界", href: "/archive?tab=self", icon: UserRound },
  { title: "关系知识库", hint: "知识 / 研究 / 依据", href: "/library", icon: BookOpen },
  { title: "账户与积分", hint: "积分 / 余额 / 费用 / 权限 / 有效期", href: "/account", icon: UserRound },
  { title: "联系客服开通", hint: "客服 / 微信 / 开通 / 帮助", href: "/account#contact", icon: CircleHelp },
];
export function QuickSearch() {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [data, setData] = useState<WorkspaceData | null>(null), [status, setStatus] = useState(""), [loggedIn, setLoggedIn] = useState(false), [admin, setAdmin] = useState(false), [identityRevision, setIdentityRevision] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null), field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(value => !value); }
    };
    const recheck = () => { setData(null); setAdmin(false); setLoggedIn(false); setIdentityRevision(value => value + 1); };
    document.addEventListener("keydown", handler); window.addEventListener("focus", recheck);
    return () => { document.removeEventListener("keydown", handler); window.removeEventListener("focus", recheck); };
  }, []);
  useEffect(() => {
    if (!open) { setQuery(""); setData(null); setStatus(""); setLoggedIn(false); setAdmin(false); return; }
    dialog.current?.showModal(); field.current?.focus();
    const controller = new AbortController();
    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal }).then(response => response.json() as Promise<{ loggedIn?: boolean }>).then(async session => {
      if (controller.signal.aborted) return;
      setLoggedIn(!!session.loggedIn);
      if (session.loggedIn) {
        const response = await fetch("/api/account/credits", { cache: "no-store", signal: controller.signal });
        const value = await response.json() as { admin?: boolean }; if (!controller.signal.aborted) setAdmin(response.ok && !!value.admin);
      }
    }).catch(() => {});
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { controller.abort(); document.body.style.overflow = previous; };
  }, [open, identityRevision]);
  useEffect(() => {
    if (!open || !loggedIn) return;
    const controller = new AbortController(); setData(null); setStatus("正在查找你的记录…");
    const timer = setTimeout(() => {
      fetch("/api/web/workspace?q=" + encodeURIComponent(query.trim()), { cache: "no-store", signal: controller.signal }).then(async response => {
        const value = await response.json() as WorkspaceData & { error?: string }; if (!response.ok) throw Object.assign(Error(value.error || "暂时无法读取记录。"), { status: response.status });
        if (!controller.signal.aborted) { setData(value); setStatus(""); }
      }).catch(cause => { if (!controller.signal.aborted) { setStatus(cause.message); if (cause.status === 401) { setData(null); setLoggedIn(false); setAdmin(false); } } });
    }, query ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, loggedIn, query]);
  const term = query.trim().toLocaleLowerCase(), matches = (value: string) => value.toLocaleLowerCase().includes(term);
  const features = [...tools, ...(admin ? [{ title: "会员管理后台", hint: "后台 / 管理员 / 会员 / 调整积分", href: "/admin/credits", icon: ShieldCheck }] : [])].filter(item => !term || matches(item.title + item.hint));
  const people = data?.people.filter(person => !term || matches(person.label + person.stage)).slice(0, 6) || [];
  const reports = data?.reports.slice(0, 5) || [];
  function close() { dialog.current?.close(); setOpen(false); }
  function moveFocus(event: React.KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('.quick-search-results a') || []);
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") items[(index + 1) % items.length]?.focus();
    else if (index <= 0) field.current?.focus(); else items[index - 1]?.focus();
  }
  return <><button className="web-search-trigger" type="button" onClick={() => setOpen(true)} aria-label="搜索功能、人物与报告" aria-haspopup="dialog"><Search size={17}/><span>搜索</span><kbd>⌘ K</kbd></button>{open && createPortal(<dialog ref={dialog} className="quick-search-dialog" aria-labelledby="quick-search-title" onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) close(); }} onKeyDown={moveFocus}><div className="quick-search-surface"><div className="quick-search-input"><Search size={22}/><label className="product-sr-only" id="quick-search-title" htmlFor="quick-search-field">搜索功能、人物与报告</label><input ref={field} id="quick-search-field" autoComplete="off" value={query} maxLength={80} onChange={event => setQuery(event.target.value)} placeholder="搜索功能、人物或报告…"/><button type="button" onClick={close} aria-label="关闭搜索"><X size={20}/></button></div><div className="quick-search-results">{features.length > 0 && <section><h2>{term ? "功能入口" : "常用功能"}</h2>{features.map(({ title, href, icon: Icon }) => <a href={href} key={href} onClick={close}><span className="quick-result-icon"><Icon size={18}/></span><span>{title}</span><ArrowUpRight size={15}/></a>)}</section>}{people.length > 0 && <section><h2>人物档案</h2>{people.map(person => <a href={`/archive?subjectId=${person.id}`} key={person.id} onClick={close}><span className="quick-result-initial">{person.label.slice(0, 1)}</span><span>{person.label}<small>{person.stage || "打开人物档案"}</small></span><ArrowUpRight size={15}/></a>)}</section>}{reports.length > 0 && <section><h2>{term ? "分析报告" : "最近分析报告"}</h2>{reports.map(report => <a href={`/report?id=${report.id}`} key={report.id} onClick={close}><span className="quick-result-icon"><FileText size={18}/></span><span>{report.summary}<small>{report.label || "未关联人物"}</small></span><ArrowUpRight size={15}/></a>)}</section>}{!features.length && !people.length && !reports.length && !status && <div className="quick-search-empty"><Search size={27}/><h2>没有找到相关内容</h2><p>试试人物称呼，或“截图”“积分”“语音”。</p></div>}{status && <p className="quick-search-status" role="status">{status}</p>}</div><footer>{loggedIn ? "仅查找当前账号有权查看的资料" : "登录后，还能查找你的人物和最近报告"}<span>↑ ↓ 选择 · Esc 关闭</span></footer></div></dialog>, document.body)}</>;
}
