"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Search, X, ArrowUpRight, ScanLine, Images, ScanFace, MessageCircle, Users, GitCompareArrows, Plus, FileText, UserRound, AudioLines, BookOpen, CircleHelp, ShieldCheck, Heart, Download } from "lucide-react";
import { createPortal } from "react-dom";
import {usePathname} from "next/navigation";
import {TOUR_EVENT} from "./FirstUseTour";
import type { WorkspaceData } from "@/components/WorkspaceDashboard";
import { expireAccountSession, watchAccountSession, webAccountStore } from '@/lib/web-account-session';
import { fetchWebJson } from '@/lib/web-api-request.mjs';
import { RELATIONSHIP_ANALYSIS_LABEL } from "@/lib/product-labels";
import styles from './QuickSearch.module.css';

type SearchResult = { scope: string; data: WorkspaceData | null; error: string };
type SearchIdentity = { account: { account?: { userId?: string }; admin?: boolean } | null; unauthorized: boolean; loading: boolean; error: string };
const SEARCH_TIMEOUT_MS = 12_000;

const tools = [
  { title: "好感探测器", hint: "好感 / 喜欢 / 态度 / 心动 / 感情", href: "/analyze?mode=chat&focus=affinity", icon: Heart },
  { title: "帮助与下载", hint: "助手 / 采集器 / 下载 / 安装 / 更新 / 技术支持 / 连接", href: "/support", icon: Download },
  { title: RELATIONSHIP_ANALYSIS_LABEL, hint: "开始分析 / 完整分析 / 分析一个人的全部资料 / 全部聊天 / 朋友圈 / 关系报告 / 选人", href: "/relationship", icon: Users },
  { title: "添加材料", hint: "导入 / 电脑 / 录屏 / 截图 / 文件", href: "/analyze#materials", icon: Plus },
  { title: "人物对照", hint: "比较 / 对照 / 多人 / 选择 / 适合", href: "/archive?compare=1", icon: GitCompareArrows },
  { title: "分析聊天截图", hint: "截图 / 聊天 / 回复 / 好感", href: "/analyze?mode=chat", icon: ScanLine },
  { title: "分析朋友圈", hint: "朋友圈 / 动态 / 相处", href: "/analyze?mode=moments", icon: Images },
  { title: "分析社交主页", hint: "社交 / 资料 / 适配", href: "/analyze?mode=social", icon: ScanFace },
  { title: "问成子", hint: "截图提问 / 聊天 / 咨询 / 建议 / 军师", href: "/chat", icon: MessageCircle },
  { title: "实时语音", hint: "语音 / 说话 / 麦克风", href: "/voice", icon: AudioLines },
  { title: "人物档案与趋势", hint: "人物 / 档案 / 趋势 / 反馈 / 对比", href: "/archive", icon: Users },
  { title: "分析记录", hint: "报告 / 历史 / 记录 / 分析记录 / 聊天 / 朋友圈 / 社交主页 / 分析", href: "/reports", icon: FileText },
  { title: "我的资料与偏好", hint: "自己 / 自我 / 目标 / 边界", href: "/archive?tab=self", icon: UserRound },
  { title: "关系知识库", hint: "资料 / 资料库 / 知识 / 研究 / 依据 / 文献 / 参考来源 / 书籍 / 心理学 / 法学 / 社会学 / 8.4万字 / 135", href: "/library", icon: BookOpen },
  { title: "账户与积分", hint: "积分 / 余额 / 费用 / 权限 / 有效期", href: "/account", icon: UserRound },
  { title: "联系客服开通", hint: "客服 / 微信 / 开通 / 帮助", href: "/account#contact", icon: CircleHelp },
];
export function QuickSearch() {
  const pathname=usePathname();
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [result, setResult] = useState<SearchResult | null>(null), [attempt, setAttempt] = useState(0);
  // Navigation on a public page only observes the cache. Looking for personal
  // records is the action that starts account verification.
  const identity = useSyncExternalStore(webAccountStore.subscribe, webAccountStore.getSnapshot, webAccountStore.getServerSnapshot) as SearchIdentity;
  const owner = identity.account?.account?.userId || '', loggedIn = !!owner && !identity.unauthorized, admin = identity.account?.admin === true;
  const revision = webAccountStore.getRevision(), scope = JSON.stringify([owner, revision, query, attempt]);
  const currentResult = open && loggedIn && result?.scope === scope ? result : null;
  const data = currentResult?.data;
  const accountError = !loggedIn && !identity.unauthorized && !identity.loading ? identity.error : '';
  const error = accountError || currentResult?.error || '';
  const status = !loggedIn ? identity.loading ? '正在连接账户，功能入口可直接使用…' : '' : !currentResult ? '正在查找你的记录…' : '';
  const dialog = useRef<HTMLDialogElement>(null), field = useRef<HTMLInputElement>(null);
  useEffect(() => open ? watchAccountSession() : undefined, [open]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(value => !value); }
    };
    document.addEventListener("keydown", handler);
    return () => { document.removeEventListener("keydown", handler); };
  }, []);
  useEffect(() => {
    if (!open) { setQuery(""); setResult(null); return; }
    dialog.current?.showModal(); field.current?.focus();
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  useEffect(() => {
    if (!open || !loggedIn) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const raw = query.trim();
      const generic = /^(报告|分析报告|历史|记录|分析记录|分析)$/.test(raw);
      fetchWebJson("/api/web/workspace?q=" + encodeURIComponent(generic ? "" : raw), { method: 'GET', credentials: 'same-origin', cache: "no-store", signal: controller.signal }, fetch, SEARCH_TIMEOUT_MS).then(({response, data: value}) => {
        if (controller.signal.aborted || revision !== webAccountStore.getRevision()) return;
        if (response.status === 401) { expireAccountSession(revision); return; }
        if (!response.ok || !Array.isArray(value?.people) || !Array.isArray(value?.reports)) throw Error('暂时无法读取记录，请检查网络后重试。');
        setResult({ scope, data: value as WorkspaceData, error: '' });
      }).catch(cause => {
        if (controller.signal.aborted || revision !== webAccountStore.getRevision()) return;
        setResult({ scope, data: null, error: cause?.name === 'TimeoutError' ? '查找已超过 12 秒，请检查网络后重试。' : '暂时无法读取记录，请检查网络后重试。' });
      });
    }, query ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, loggedIn, revision, scope, query]);
  function retry() {
    if (accountError) void webAccountStore.refresh({ force: true });
    else setAttempt(value => value + 1);
  }
  const term = query.trim().toLocaleLowerCase(), matches = (value: string) => value.toLocaleLowerCase().includes(term);
  const features = [...(loggedIn && ["/capture","/analyze"].includes(pathname) ? [{title:"重看本页操作引导",hint:"帮助 / 使用 / 引导 / 怎么操作",href:"#operation-guide",icon:CircleHelp}] : []), ...tools, ...(admin ? [{ title: "会员管理后台", hint: "后台 / 管理员 / 会员 / 调整积分", href: "/admin/credits", icon: ShieldCheck }] : [])].filter(item => term ? matches(item.title + item.hint) : ["好感探测器", "分析聊天截图", RELATIONSHIP_ANALYSIS_LABEL, "问成子", "帮助与下载", "分析记录"].includes(item.title));
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
  return <><button className="web-search-trigger" type="button" onClick={() => setOpen(true)} aria-label="搜索功能、人物与报告" aria-haspopup="dialog"><Search size={17}/><span>搜索</span><kbd>Ctrl / ⌘ K</kbd></button>{open && createPortal(<dialog ref={dialog} className={`quick-search-dialog ${styles.dialog}`} aria-labelledby="quick-search-title" onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) close(); }} onKeyDown={moveFocus}><div className="quick-search-surface"><div className="quick-search-input"><Search size={22}/><label className="product-sr-only" id="quick-search-title" htmlFor="quick-search-field">搜索功能、人物与报告</label><input ref={field} id="quick-search-field" autoComplete="off" value={query} maxLength={80} onChange={event => setQuery(event.target.value)} placeholder="搜索功能、人物或报告…"/><button type="button" onClick={close} aria-label="关闭搜索"><X size={20}/></button></div><div className="quick-search-results">{features.length > 0 && <section><h2>{term ? "功能入口" : "常用功能"}</h2>{features.map(({ title, href, icon: Icon }) => <a href={href} key={href} onClick={event=>{if(href==="#operation-guide"){event.preventDefault();close();requestAnimationFrame(()=>window.dispatchEvent(new CustomEvent(TOUR_EVENT,{detail:{page:pathname.slice(1)}})));}else close();}}><span className="quick-result-icon"><Icon size={18}/></span><span>{title}</span><ArrowUpRight size={15}/></a>)}</section>}{people.length > 0 && <section><h2>人物档案</h2>{people.map(person => <a href={`/archive?subjectId=${person.id}`} key={person.id} onClick={close}><span className="quick-result-initial">{person.label.slice(0, 1)}</span><span>{person.label}<small>{person.stage || "打开人物档案"}</small></span><ArrowUpRight size={15}/></a>)}</section>}{reports.length > 0 && <section><h2>{term ? "分析报告" : "最近分析报告"}</h2>{reports.map(report => <a href={`/report?id=${report.id}`} key={report.id} onClick={close}><span className="quick-result-icon"><FileText size={18}/></span><span>{report.summary}<small>{report.label || "未关联人物"}</small></span><ArrowUpRight size={15}/></a>)}</section>}{!features.length && !people.length && !reports.length && !status && !error && <div className="quick-search-empty"><Search size={27}/><h2>没有找到相关内容</h2><p>试试人物称呼，或“截图”“积分”“语音”。</p></div>}{status && <p className="quick-search-status" role="status">{status}</p>}{error && <div className={styles.recovery} role="alert"><p>{error}</p><button type="button" onClick={retry}>{accountError ? "重新连接账户" : "重试查找"}</button></div>}{identity.unauthorized && <div className={styles.recovery}><p>登录后可查找你的人物和报告。</p><a href={`/login?return_to=${encodeURIComponent(pathname)}`} onClick={close}>登录账号<ArrowUpRight size={16}/></a></div>}</div><footer>{loggedIn ? "仅查找当前账号有权查看的资料" : "登录后，还能查找你的人物和最近报告"}<span>↑ ↓ 选择 · Esc 关闭</span></footer></div></dialog>, document.body)}</>;
}
