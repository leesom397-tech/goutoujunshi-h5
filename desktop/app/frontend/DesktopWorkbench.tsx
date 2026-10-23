import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, AudioLines, Check, ChevronLeft, ChevronRight, FileText, FolderOpen, ImagePlus, Layers3, LoaderCircle, MessageCircle, Monitor, PanelLeftClose, PanelLeftOpen, RefreshCw, Search, ShieldCheck, UsersRound } from 'lucide-react';
import { api, useAccount } from '@/components/web-analysis/client';
import { QuickSearch } from '@/components/QuickSearch';
import { PersonAvatar } from '@/components/PersonAvatar';
import { BrandField } from '@/components/BrandField';
import { getDesktopHost } from '@/lib/desktop-host';
import { useDesktopLocation } from './navigation';
import './workbench.css';

type Report = {id:string;label:string;summary:string;createdAt:number;kind:string;format?:string;analysisScope?:string;captureKind?:string;subjectId?:string};
type ReportList = {reports:Report[];total:number;pageSize:number};
const reportCache = new Map<string, ReportList>();
let cacheOwner = '';
function useReports(query='', page=1) {
  const account = useAccount();
  const owner = String(account.account?.account?.userId || '');
  const key = JSON.stringify([owner,query.trim(),page]);
  const [state,setState] = useState<{key:string;data:ReportList|null;error:string;loading:boolean}>({key:'',data:null,error:'',loading:false});
  const [revision,setRevision] = useState(0);
  useEffect(()=>{
    if(owner!==cacheOwner){reportCache.clear();cacheOwner=owner;}
    if(!owner){setState({key,data:null,error:'',loading:false});return;}
    const controller=new AbortController();
    const prior=reportCache.get(key)||null;
    setState({key,data:prior,error:'',loading:true});
    const timer=setTimeout(()=>void api(`/api/web/report/list?q=${encodeURIComponent(query.trim())}&page=${page}`,undefined,controller.signal).then(raw=>{
      if(!Array.isArray(raw.reports)||!Number.isFinite(raw.total)||!(raw.pageSize>0))throw Error('报告列表暂未完整返回。');
      if(controller.signal.aborted||cacheOwner!==owner)return;
      const data=raw as ReportList;
      if(reportCache.size>20)reportCache.clear();
      reportCache.set(key,data);setState({key,data,error:'',loading:false});
    }).catch(error=>{if(!controller.signal.aborted)setState({key,data:prior,error:error.message,loading:false});}),query?180:0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[owner,key,revision]);
  const current=state.key===key?state:{data:reportCache.get(key)||null,error:'',loading:!!owner};
  return {...current,account,owner,retry:()=>setRevision(n=>n+1)};
}
const date=(value:number)=>new Date(value).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'});
const label=(report:Report)=>report.analysisScope==='fullHistory'?(report.captureKind==='moments'?'朋友圈报告':'完整关系报告'):report.analysisScope==='supplement'?'补充解读':report.format==='risk'?'风险研判':report.format==='import'?'导入分析':report.kind==='moments'?'朋友圈解读':report.kind==='social'?'主页解读':'聊天解读';
function Avatar({name='?',src}:{name?:string;src?:string}){return <span className="dw-avatar" aria-hidden="true"><PersonAvatar src={src} alt="" className="dw-avatar-image" fallback={Array.from(name)[0]}/></span>;}
function AccountState({state,intent}:{state:ReturnType<typeof useAccount>;intent?:'import'}){
  if(state.loading)return <div className="dw-state" role="status"><LoaderCircle className="dw-spin" size={20}/>正在连接账户</div>;
  if(state.unauthorized)return <div className="dw-state"><span className="dw-state-symbol"><ShieldCheck size={26}/></span><h2>{intent==='import'?'先登录，再导入微信资料':'连接你的成子账户'}</h2><p>{intent==='import'?'使用成子账户登录，聊天、朋友圈与报告会保存在一起。':'已有报告和人物档案会在这里接着使用。'}</p><a className="dw-primary" href={'/login?return_to='+encodeURIComponent(location.pathname+location.search)}>{intent==='import'?'登录并继续':'登录账户'}<ArrowRight size={16}/></a></div>;
  return <div className="dw-state" role="alert"><p>{state.error||'账户暂未连接。'}</p><button className="dw-button" onClick={()=>void state.refresh()}>重新连接</button></div>;
}
function Issue({error,retry}:{error:string;retry:()=>void}){return error?<div className="dw-issue" role="alert"><span>{error}</span><button onClick={retry}><RefreshCw size={14}/>重试</button></div>:null;}
function GlassObject(){return <div className="dw-brand-object"><BrandField variant="hero"/></div>;}
export function DesktopHome(){
  const {account,owner,data,error,loading,retry}=useReports();
  const [runtime,setRuntime]=useState('按需启动');
  useEffect(()=>{let live=true;getDesktopHost()?.getRuntimeState().then(value=>{if(live)setRuntime(value.collectorStatus==='ready'?'已就绪':value.collectorStatus==='error'?'需要检查':'按需启动');}).catch(()=>{if(live)setRuntime('待连接');});return()=>{live=false;};},[]);
  return <main className="dw-home dw-enter">
    <header className="dw-toolbar"><div><span className="dw-eyebrow">成子 · 个人工作区</span><h1>工作台</h1></div><div className="dw-toolbar-tools"><span className="dw-calendar">{new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</span><QuickSearch/></div></header>
    <div className="dw-home-grid">
      <section className="dw-main-column">
        <section className="dw-start">
          <BrandField variant="hero"/>
          <div className="dw-start-copy"><span className="dw-chip"><Layers3 size={14}/>开始新的了解</span><h2>从聊天里，<br/>看清你们的关系。</h2><p>读懂信号，找到下一步。</p><div className="dw-start-actions"><a className="dw-primary" href="/capture?method=desktop"><ArrowDownToLine size={17}/>导入微信资料<ArrowRight size={17}/></a></div></div>
          <div className="dw-start-baseline"><span><MessageCircle size={13}/>聊天</span><span><AudioLines size={14}/>语音</span><span><ImagePlus size={14}/>朋友圈</span></div>
        </section>
        <nav className="dw-shortcuts" aria-label="快捷工具"><a href="/analyze?mode=chat"><span className="dw-tool-symbol"><ImagePlus size={20}/></span><span><strong>截图解读</strong><small>一段对话，也能开始</small></span><ChevronRight size={16}/></a><a href="/chat"><span className="dw-tool-symbol"><MessageCircle size={20}/></span><span><strong>问成子</strong><small>聊判断，也聊怎么回</small></span><ChevronRight size={16}/></a></nav>
        <section className="dw-recent"><header className="dw-section-head"><div><h2>接着上次看</h2></div><a href="/reports">全部报告<ArrowRight size={15}/></a></header>
          {!owner?<AccountState state={account}/>:<><Issue error={error} retry={retry}/>{loading&&!data?<div className="dw-skeleton" role="status">正在读取已有报告…</div>:data?.reports.length?<div className="dw-recent-list">{data.reports.slice(0,4).map((report,i)=><a className="dw-recent-row" style={{animationDelay:`${i*35}ms`}} key={report.id} href={'/report?id='+encodeURIComponent(report.id)}><Avatar name={report.label||'未'} src={account.people.find(person=>person.id===report.subjectId)?.avatar}/><span className="dw-row-copy"><strong>{report.label||'未关联人物'}<small>{label(report)}</small></strong><span>{report.summary||'打开已保存的报告'}</span></span><time>{date(report.createdAt)}</time><ChevronRight size={17}/></a>)}</div>:!error&&<div className="dw-empty-inline"><FolderOpen size={26}/><p>第一份报告完成后，会留在这里。</p><a href="/analyze?mode=chat">从一张截图开始<ArrowRight size={15}/></a></div>}</>}
        </section>
      </section>
      <aside className="dw-side-column">
        <section className="dw-overview" aria-label="资料概览"><a href="/archive"><UsersRound size={17}/><strong>{owner?account.people.length:'—'}</strong><span>人物档案</span></a><a href="/reports"><FileText size={17}/><strong>{owner&&data?data.total:'—'}</strong><span>已存报告</span></a></section>
        <section className="dw-people"><header className="dw-section-head"><h2>关注的人</h2><a href="/archive" aria-label="打开人物档案"><ArrowRight size={17}/></a></header>{owner&&account.people.length?<div>{account.people.slice(0,5).map(person=><a className="dw-person" key={person.id} href={'/archive?subjectId='+encodeURIComponent(person.id)}><Avatar name={person.label} src={person.avatar}/><span><strong>{person.label||'人物档案'}</strong><small>资料与关系进展</small></span><ChevronRight size={15}/></a>)}</div>:<p className="dw-muted">{owner?'导入时关联人物，后续资料会接在一起。':'登录后显示你的人物档案。'}</p>}</section>
        <section className="dw-device"><header><Monitor size={18}/><strong>本机微信</strong><span className={runtime==='已就绪'?'is-ready':''}>{runtime}</span></header><a href="/capture?method=desktop">{runtime==='已就绪'?'选择好友，继续导入':'连接并导入资料'}<ArrowRight size={15}/></a></section>
        <div className="dw-smallprint"><ShieldCheck size={14}/><span>分析前确认费用 · 已有报告随时查看</span></div>
      </aside>
    </div>
  </main>;
}

const ReportPage=lazy(()=>import('@/app/report/page'));
export function DesktopReports(){
  const url=useDesktopLocation(),selected=new URL(url,location.origin).searchParams.get('id');
  const [query,setQuery]=useState(''),[page,setPage]=useState(1);
  const [readingFocus,setReadingFocus]=useState(()=>window.innerWidth<1000);
  useEffect(()=>{if(selected&&window.innerWidth<1000)setReadingFocus(true);},[selected]);
  const {account,owner,data,loading,error,retry}=useReports(query,page);
  const previousOwner=useRef(owner);
  useEffect(()=>{if(previousOwner.current!==owner){setQuery('');setPage(1);previousOwner.current=owner;}},[owner]);
  const report=data?.reports.find(item=>item.id===selected);
  return <div className={`dw-reports ${selected?'has-selection':''} ${selected&&readingFocus?'is-focused':''}`}>
    <aside className="dw-report-rail"><header><div><h1>报告库</h1><span>{data?data.total:'—'}</span><button className="dw-icon-button" aria-label="刷新报告列表" onClick={retry} disabled={loading}><RefreshCw size={16} className={loading?'dw-spin':''}/></button></div></header>
      <label className="dw-search"><Search size={16}/><input type="search" aria-label="搜索人物或报告" value={query} maxLength={80} placeholder="搜索人物或报告" onChange={event=>{setQuery(event.target.value);setPage(1);}}/></label>
      <div className="dw-rail-caption"><span>{query?'搜索结果':'全部报告'}</span><span>最近生成</span></div>
      <div className="dw-report-items" aria-busy={loading}>
        {!owner?<AccountState state={account}/>:<><Issue error={error} retry={retry}/>{loading&&!data?<div className="dw-skeleton" role="status">正在读取报告…</div>:data?.reports.map(item=><a key={item.id} className={`dw-report-item ${selected===item.id?'is-selected':''}`} aria-current={selected===item.id?'page':undefined} href={'/report?id='+encodeURIComponent(item.id)}><div><Avatar name={item.label||'未'} src={account.people.find(person=>person.id===item.subjectId)?.avatar}/><strong>{item.label||'未关联人物'}</strong><time>{date(item.createdAt)}</time></div><span className="dw-report-type"><FileText size={12}/>{label(item)}</span><p>{item.summary||'打开查看分析内容'}</p></a>)}{data&&!data.reports.length&&<p className="dw-muted">{query?'没有匹配的报告，换个关键词试试。':'还没有报告，添加资料后开始。'}</p>}</>}
      </div>
      {data&&data.total>data.pageSize&&<nav className="dw-page-controls" aria-label="报告分页"><button aria-label="上一页" disabled={page<=1||loading} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={17}/></button><span>{page} / {Math.ceil(data.total/data.pageSize)}</span><button aria-label="下一页" disabled={page*data.pageSize>=data.total||loading} onClick={()=>setPage(n=>n+1)}><ChevronRight size={17}/></button></nav>}
      <a className="dw-rail-new" href="/capture?method=desktop"><ArrowDownToLine size={16}/>添加资料<ArrowRight size={15}/></a>
    </aside>
    <section className="dw-report-document">
      <header className="dw-document-toolbar"><div className="dw-reading-title">{selected&&<button className="dw-reading-toggle" aria-expanded={!readingFocus} aria-label={readingFocus?'显示报告列表':'收起报告列表'} onClick={()=>setReadingFocus(value=>!value)}>{readingFocus?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}<span>{readingFocus?'报告列表':'专注阅读'}</span></button>}<span><FileText size={16}/>{report?.label||'报告阅读'}{report&&<small>{label(report)}</small>}</span></div><QuickSearch/></header>
      {selected?<div className="dw-report-body dw-enter" key={selected}><Suspense fallback={<div className="dw-state" role="status"><LoaderCircle className="dw-spin"/>正在打开报告</div>}><ReportPage/></Suspense></div>:<div className="dw-library-empty dw-enter"><div className="dw-empty-art"><FileText size={40} strokeWidth={1.25}/><i/><i/></div><span className="dw-eyebrow">你的关系观察记录</span><h2>上次没看完的，<br/>从这里接着看。</h2><p>原话、朋友圈线索和下一步建议，<br/>在同一份报告里。</p>{data?.reports[0]&&<a className="dw-primary" href={'/report?id='+encodeURIComponent(data.reports[0].id)}>继续最近一次<ArrowRight size={16}/></a>}<div className="dw-empty-footer"><span><Check size={14}/>保留阅读位置</span><span><ShieldCheck size={14}/>查看不扣积分</span></div></div>}
    </section>
  </div>;
}

const CapturePage=lazy(()=>import('@/app/capture/page'));
export function DesktopCapture(){
  const account=useAccount(),owner=String(account.account?.account?.userId||'');
  const url=useDesktopLocation(),method=new URL(url,location.origin).searchParams.get('method')||'desktop';
  const container=useRef<HTMLDivElement>(null);
  const [step,setStep]=useState(0),[phase,setPhase]=useState('idle');
  useEffect(()=>{
    const target=container.current;if(!target)return;
    const update=()=>{const state=target.querySelector<HTMLElement>('[data-desktop-capture-step]');if(!state)return;setStep(Number(state.dataset.desktopCaptureStep)||0);setPhase(state.dataset.desktopCapturePhase||'idle');};
    const observer=new MutationObserver(update);observer.observe(target,{childList:true,subtree:true,attributes:true,attributeFilter:['data-desktop-capture-step','data-desktop-capture-phase']});update();return()=>observer.disconnect();
  },[owner]);
  const steps=['连接微信','选择好友','导入资料','确认分析'];
  return <main className="dw-capture dw-enter">
    <header className="dw-capture-heading"><BrandField variant="ambient"/><div><span className="dw-eyebrow">本机微信 · 资料工作区</span><h1>导入资料</h1><p>选好一个人，聊天、语音与朋友圈一起带进来。</p></div><QuickSearch/></header>
    {owner&&method==='desktop'&&<ol className="dw-capture-steps" aria-label="导入步骤">{steps.map((title,i)=><li key={title} data-state={i<step?'done':i===step?'active':'next'} aria-current={i===step?'step':undefined}><span className="dw-step-icon">{i<step?<Check size={16}/>:i+1}</span><strong>{title}</strong></li>)}</ol>}
    {!owner?<section className="dw-capture-account"><AccountState state={account} intent="import"/><div className="dw-auth-art"><GlassObject/></div></section>:<section className="dw-capture-content" aria-label="当前导入步骤"><div ref={container} className="dw-capture-surface"><Suspense fallback={<div className="dw-state" role="status"><LoaderCircle className="dw-spin"/>正在准备导入工作区</div>}><CapturePage/></Suspense></div></section>}
    <footer className="dw-capture-foot"><span><ShieldCheck size={16}/>{phase==='idle'?'导入不扣积分，分析前确认费用。':'已导入的资料会保留。'}</span><a href="/support">导入帮助<ArrowRight size={14}/></a></footer>
  </main>;
}
