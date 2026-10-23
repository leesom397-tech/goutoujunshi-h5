"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Copy, Download, FileText, Images, MessageCircle, Monitor, Plus, RefreshCw, Search, UserRound, Video } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { CaptureAnalysisStatus } from "@/components/CaptureAnalysisStatus";
import { PersonAvatar } from "@/components/PersonAvatar";
import { AccountNotice, useAccount } from "@/components/web-analysis/client";
import { listSyncedCaptureLibraries, type SyncedLibrarySummary } from "@/lib/capture-cloud-client";
import { capturePersonSearchHref, groupAnalysisPeople } from "@/lib/person-analysis-navigation";
import { collectorInstallerHref, collectorVersion } from "@/lib/collector-download";
import styles from "./relationship.module.css";
import { RELATIONSHIP_ANALYSIS_LABEL } from "@/lib/product-labels";
import { intakeHref } from "@/components/web-analysis/intake-navigation";

export default function RelationshipPage() {
  const account = useAccount(), owner = account.account?.account?.userId || "";
  const [materials, setMaterials] = useState<{owner:string;libraries:SyncedLibrarySummary[];loading:boolean;warning:string}>({owner:"",libraries:[],loading:true,warning:""});
  const libraries=materials.owner===owner?materials.libraries:[], loading=materials.owner!==owner||materials.loading, warning=materials.owner===owner?materials.warning:"";
  const [query, setQuery] = useState(""), [subject, setSubject] = useState(""), [page, setPage] = useState(0), [revision, setRevision] = useState(0);
  const [canImport, setCanImport] = useState(false), [platformReady,setPlatformReady]=useState(false), [handoff,setHandoff]=useState("");
  const [copied,setCopied]=useState(false);
  const [pageSize,setPageSize]=useState(6);
  useEffect(() => { setSubject(new URLSearchParams(location.search).get("subjectId") || ""); setCanImport(/Win/i.test(navigator.platform)); setPlatformReady(true); }, []);
  useEffect(()=>{const compact=window.matchMedia("(max-width: 700px)");const update=()=>{setPageSize(compact.matches?3:6);setPage(0);};update();compact.addEventListener("change",update);return()=>compact.removeEventListener("change",update);},[]);
  useEffect(() => {
    let active = true;
    setMaterials(previous=>({owner,libraries:previous.owner===owner?previous.libraries:[],loading:!!owner,warning:""}));
    if (owner) void listSyncedCaptureLibraries(owner, local=>{
      if(active)setMaterials(previous=>({...previous,owner,libraries:previous.owner===owner&&previous.libraries.length?previous.libraries:local}));
    }).then(result => { if (active) setMaterials({owner,...result,loading:false}); }).catch(() => { if (active) setMaterials({owner,libraries:[],loading:false,warning:"材料暂时没有读到，请重新加载。"}); });
    return () => { active = false; };
  }, [owner, revision]);
  useEffect(()=>{setPage(0);setQuery("");},[owner]);
  const people = account.people.map(row=>({...row,id:String(row.id),label:String(row.label || "未命名人物")}));
  const person = people.find(row => row.id === subject);
  const allEntries = groupAnalysisPeople(owner, people, libraries);
  const entries = query.trim() ? allEntries : allEntries.filter(row=>!subject || row.subjectId===subject);
  const rows = entries.filter(row => [row.label,row.identity,...row.materialKinds].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1), currentPage = Math.min(page, lastPage);
  const returnTo="/relationship"+(subject?"?subjectId="+encodeURIComponent(subject):"");
  const importHref=capturePersonSearchHref("",{subjectId:subject,returnTo});
  async function copyHandoff() {
    const href=new URL(importHref,location.origin).href;setHandoff(href);
    try{await navigator.clipboard.writeText(href);setCopied(true);}catch{setCopied(false);}
  }
  const uploadHref=intakeHref("/analyze",{mode:"chat",subjectId:subject,returnTo});
  const videoHref=intakeHref("/capture",{kind:"chat",method:"video",subjectId:subject,returnTo});
  const screenshotFirst=platformReady&&!canImport;
  function refreshPeople(){setRevision(value=>value+1);void account.refresh();}
  return <><WebNav/><main className={styles.page}>
    <header className={styles.heading}><span>聊天 · 语音 · 朋友圈</span><h1>{person ? `${RELATIONSHIP_ANALYSIS_LABEL} · ${person.label}` : RELATIONSHIP_ANALYSIS_LABEL}</h1><p>聊天、语音、朋友圈，一起看清这段关系。</p></header>
    <ol className={styles.steps} aria-label="分析流程"><li><b>1</b>添加资料</li><li><b>2</b>确认费用</li><li><b>3</b>查看报告</li></ol>
    {!account.unauthorized && <AccountNotice state={account}/>}
    <CaptureAnalysisStatus owner={owner} onSettled={()=>setRevision(value=>value+1)}/>
    <nav className={styles.startChoices} aria-label="开始分析">
      {screenshotFirst ? <a className={styles.newPersonChoice} href={uploadHref}><Images size={23}/><span><strong>上传聊天截图，开始分析</strong><small>按材料的完整范围生成报告，也可补充到已有的人物</small></span><ArrowRight size={21}/></a> : <a className={styles.newPersonChoice} href={importHref}><Monitor size={23}/><span><strong>选择微信好友，开始导入</strong><small>一次导入聊天、语音和朋友圈</small></span><ArrowRight size={21}/></a>}
      <a className={styles.materialChoice} href={screenshotFirst?videoHref:uploadHref} data-material-alternative>{screenshotFirst?<Video size={23}/>:<Images size={23}/>}<span><strong>{screenshotFirst?"用聊天录屏分析":"先分析聊天截图"}</strong><small>{screenshotFirst?"对话较长时，上传一段连续录屏":"不用安装助手，先看懂这段对话和怎么回"}</small></span><ArrowRight size={21}/></a>
    </nav>
    <p className={styles.costHint}>先选资料，费用会在分析前列出；确认后才扣积分。</p>
    <section className={styles.downloadBar} aria-label="微信助手下载"><div><Monitor size={22}/><span><strong>{screenshotFirst?"也可在电脑导入全部资料":"电脑微信助手"}</strong><small>{screenshotFirst?"电脑导入后，登录同一账号即可在这里查看报告":`Windows 10 / 11 · 当前版本 ${collectorVersion}`}</small></span></div>{screenshotFirst?<button type="button" onClick={()=>void copyHandoff()} aria-label="复制链接，到电脑导入">{copied?<Check size={18}/>:<Copy size={18}/>} {copied?"链接已复制":"复制电脑继续链接"}</button>:<a href={collectorInstallerHref} download><Download size={18}/>下载／更新助手</a>}<a href="/support">帮助与下载<ArrowRight size={16}/></a></section>
    {handoff && <div className={styles.handoff} role="status"><p>{copied?"已复制。在 Windows 电脑浏览器打开，并登录同一账号。":"复制这个链接，在 Windows 电脑打开并登录同一账号。"}</p><input aria-label="电脑继续导入链接" value={handoff} readOnly onFocus={event=>event.currentTarget.select()}/></div>}
    <section id="saved-people" className={styles.saved} aria-labelledby="saved-person-title">
      <header><div><h2 id="saved-person-title">继续已有的人物</h2></div><button type="button" disabled={loading || account.refreshing || !owner} onClick={refreshPeople} aria-label="刷新已保存的人物"><RefreshCw size={18}/></button></header>
      {!!allEntries.length && <label className={styles.search}><Search size={18}/><input type="search" aria-label="搜索已保存的人物" value={query} placeholder="搜索已保存的人物" onChange={event => { setQuery(event.target.value); setPage(0); }}/></label>}
      {account.error&&!owner ? <p className={styles.empty}>账户连接后，这里会显示已保存的人物。</p> : (account.loading || loading)&&!allEntries.length ? <p className={styles.empty} role="status">正在读取已有资料…</p> : account.unauthorized ? <div className={styles.empty}><p>登录后继续查看自己的人物与资料。</p><a className={styles.textLink} href={"/login?return_to="+encodeURIComponent(returnTo)}>登录并继续<ArrowRight size={16}/></a></div> : <>
        {loading&&<p className={styles.refreshStatus} role="status">正在同步最新资料，已显示的人物可以继续打开。</p>}
        {warning && <p className={styles.warning} role="alert">{warning}<button type="button" onClick={refreshPeople}>重新加载</button></p>}
        <div className={styles.people}>{rows.slice(currentPage * pageSize, currentPage * pageSize + pageSize).map(row => {
          const duplicate=allEntries.filter(other=>other.label===row.label).length>1;
          const updated=row.updatedAt?new Date(row.updatedAt).toLocaleDateString("zh-CN"):"";
          return <article key={row.id} className={styles.person} data-person-entry>
            <div className={styles.personMain}><span className={styles.avatar}><PersonAvatar src={row.avatar} alt={`${row.label}的头像`} fallback={<UserRound size={24}/>}/></span><div><h3>{row.label}{duplicate&&<span className={styles.sameName}>同名人物</span>}</h3><p>{row.identity}</p><small>{updated ? `${updated} 更新` : "已建立档案"}</small></div></div>
            <div className={styles.materials} aria-label={`${row.label}已有资料`}>{row.chatCount>0&&<span><MessageCircle size={15}/>{row.chatCount.toLocaleString("zh-CN")} 条聊天</span>}{row.momentsCount>0&&<span><Images size={15}/>{row.momentsCount.toLocaleString("zh-CN")} 条朋友圈</span>}{row.materialKinds.map(label=><span key={label}><FileText size={15}/>{label}</span>)}</div>
            <a className={styles.openPerson} href={row.latestReportId ? "/report?id="+encodeURIComponent(row.latestReportId)+"&returnTo="+encodeURIComponent(returnTo) : row.openHref}>{row.latestReportId ? "查看报告" : row.libraries.length ? "继续生成报告" : row.openLabel}<ArrowRight size={17}/></a>
            <nav aria-label={`${row.label}的后续操作`}>{row.latestReportId&&row.libraries.length>0&&<a href={row.openHref}><Plus size={16}/>补充／更新全部资料</a>}{row.subjectId&&<><a href={"/chat?subjectId="+encodeURIComponent(row.subjectId)}><MessageCircle size={16}/>基于资料提问</a><a href={"/analyze?mode=chat&subjectId="+encodeURIComponent(row.subjectId)}><Images size={16}/>补充截图</a></>}</nav>
          </article>;
        })}</div>
        {!rows.length && <div className={styles.empty}><p>{query.trim() ? `已保存的人物中没有“${query.trim()}”。` : subject ? "还没有保存这个人的资料。" : "还没有保存人物，可以从微信导入或先传截图。"}</p>{query.trim()&&!screenshotFirst?<a className={styles.searchImport} href={capturePersonSearchHref(query)}>到微信里查找并导入<ArrowRight size={16}/></a>:<a className={styles.textLink} href={uploadHref}>上传聊天截图<ArrowRight size={16}/></a>}</div>}
        {lastPage > 0 && <nav className={styles.pagination} aria-label="人物分页"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {lastPage + 1}</span><button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>}
        {subject && <a className={styles.textLink} href="/relationship">查看全部人物<ArrowRight size={16}/></a>}
      </>}
    </section>
    <nav className={styles.alternatives} aria-label="其他分析方式">{!screenshotFirst&&<a href={videoHref}><Video size={18}/>用聊天录屏分析<ArrowRight size={16}/></a>}<a href={"/chat" + (subject ? "?subjectId=" + encodeURIComponent(subject) : "")}>先问成子<ArrowRight size={16}/></a></nav>
  </main></>;
}
