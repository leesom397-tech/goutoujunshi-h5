"use client";
import {Fragment} from "react";
import {ArrowUpRight, ScanLine, Images, ScanFace, MessageCircle, AudioLines, Users, BookOpen} from "lucide-react";
import {knowledgeManifest as library, knowledgeVolume} from "@/lib/knowledge-public";
import {knowledgeDomains} from "@/lib/knowledge-origins";
const features = [
{href:"/analyze?mode=chat",icon:ScanLine,title:"聊天分析",text:"上传聊天截图，看语气、好感信号和回复建议。",action:"上传聊天"},
{href:"/analyze?mode=moments",icon:Images,title:"朋友圈分析",text:"从动态了解兴趣、生活方式和可聊的话题。",action:"上传朋友圈"},
{href:"/analyze?mode=social",icon:ScanFace,title:"社交主页",text:"整理个人资料，发现共同点与待了解的信息。",action:"分析主页"},
{href:"/chat",icon:MessageCircle,title:"文字军师",text:"带着具体问题，讨论眼前该怎么做。",action:"开始对话"},
{href:"/voice",icon:AudioLines,title:"语音交流",text:"直接说出困惑，用语音一起理清思路。",action:"开始语音"},
{href:"/archive",icon:Users,title:"人物档案",text:"保存关系线索，回看历史分析与后续变化。",action:"打开档案"}
];
export function ProductHome({onStart,signedIn=false,loading=false,error="",onRetry}:{onStart:(href:string)=>void;signedIn?:boolean;loading?:boolean;error?:string;onRetry?:()=>void}) {
return <div className="simple-home">
<header className="home-heading"><div><span className="home-eyebrow">成子 · 关系分析工具</span><h1>看懂关系，<span>心里有数。</span></h1><p>成子陪你，从当下这一句，到下一步。</p></div><a href={signedIn ? "/account" : "/login"} className="home-login">{signedIn ? "我的账户" : "登录账户"} <ArrowUpRight size={16}/></a></header>
{loading && <p className="home-session-state" role="status">正在确认账户…</p>}{error && <div className="home-session-error" role="alert"><span>{error}</span><button onClick={onRetry}>重新连接</button></div>}
<KnowledgeEvidence/>
<section className="home-tool-section" aria-labelledby="analysis-tools-heading"><div className="home-section-heading"><div><span>01 / 看懂当下</span><h2 id="analysis-tools-heading">你的关系工作台</h2></div><p>选择你手边的材料</p></div><div className="home-feature-grid" aria-label="全部功能">{features.map(({href,icon:Icon,title,text,action},index)=><Fragment key={href}>{index===3 && <div className="home-section-heading home-section-secondary"><div><span>02 / 持续了解</span><h2>接着聊，慢慢了解。</h2></div><p>交流、记录与回顾</p></div>}<button disabled={loading || !!error} key={href} className={`home-feature home-feature-${index}${index===0 ? " home-feature-primary" : ""}`} onClick={()=>onStart(href)}><span className="home-feature-top"><span className="home-feature-icon"><Icon size={23}/></span><span className="home-feature-number">0{index+1}</span></span><span className="feature-copy"><h2>{title}</h2><p>{text}</p></span><span className="feature-stage"><FeatureDrawing index={index}/><span className="feature-stage-label">{["语气 · 意图 · 下一步","兴趣 · 生活 · 话题","资料 · 共性 · 线索","有困惑，随时聊","开口，慢慢说","每一次，都记得"][index]}</span></span><span className="home-feature-action">{action}<ArrowUpRight size={17}/></span></button></Fragment>)}</div></section>
<nav className="home-utilities" aria-label="更多工具"><button disabled={loading || !!error} onClick={()=>onStart("/reports")}>历史报告 <ArrowUpRight size={14}/></button><button disabled={loading || !!error} onClick={()=>onStart("/import")}>导入聊天记录 <ArrowUpRight size={14}/></button><button disabled={loading || !!error} onClick={()=>onStart("/archive?tab=self")}>我的资料 <ArrowUpRight size={14}/></button></nav>
<p className="home-note">分析前确认积分费用 · 资料数量不代表判断准确率 · <a href="/privacy">数据与隐私</a></p>
</div>;
}

export function KnowledgeEvidence(){return <section className="home-evidence" aria-label="资料库依据"><div className="home-evidence-title"><BookOpen size={20}/><div><strong>分析有资料可参考</strong><span>成子 · 心理学硕士 · 全网百万粉丝</span></div></div><div className="home-evidence-stats"><span><BookOpen size={16}/><b>{library.referenceDocuments}</b><small>篇参考文档</small></span><span><ScanLine size={16}/><b>{knowledgeVolume}</b><small>万字资料</small></span><span><Users size={16}/><b>{knowledgeDomains.length}</b><small>类关系主题</small></span></div><a href="/library">查看资料库 <ArrowUpRight size={16}/></a></section>;}

function FeatureDrawing({index}:{index:number}) {
return <span className={`feature-drawing feature-drawing-${index}`} aria-hidden="true"><svg viewBox="0 0 220 104" fill="none">
{index===0 && <><rect x="22" y="9" width="133" height="52" rx="18" fill="white" fillOpacity=".88"/><path d="M43 27h70M43 39h91" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".45"/><rect x="85" y="48" width="117" height="47" rx="17" fill="currentColor"/><path d="M104 65h73M104 77h47" stroke="white" strokeWidth="3" strokeLinecap="round" opacity=".8"/><circle cx="174" cy="23" r="17" fill="white" fillOpacity=".8"/><path d="m167 23 5 5 9-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></>}
{index===1 && <><rect x="37" y="15" width="95" height="71" rx="14" transform="rotate(-9 37 15)" fill="white" fillOpacity=".65"/><rect x="85" y="19" width="97" height="72" rx="14" fill="white"/><circle cx="153" cy="39" r="9" fill="currentColor" opacity=".5"/><path d="m96 75 25-29 17 18 12-9 22 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><path d="M34 84h25M46 72v24" stroke="currentColor" strokeWidth="2" opacity=".6"/></>}
{index===2 && <><path d="M61 52h98M110 20v64" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 5" opacity=".3"/><circle cx="110" cy="52" r="37" fill="white" fillOpacity=".8"/><circle cx="110" cy="44" r="11" stroke="currentColor" strokeWidth="2.5"/><path d="M91 71c2-20 36-20 38 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><circle cx="43" cy="30" r="14" fill="white"/><circle cx="175" cy="74" r="17" fill="white"/><path d="m168 74 5 5 9-10" stroke="currentColor" strokeWidth="2"/><circle cx="181" cy="24" r="5" fill="currentColor" opacity=".5"/></>}
{index===3 && <><rect x="29" y="20" width="160" height="65" rx="27" fill="white" fillOpacity=".8"/><path d="m51 79-9 16 35-11" fill="white" fillOpacity=".8"/>{[78,110,142].map(x=><circle key={x} cx={x} cy="52" r="6" fill="currentColor"/>)}<path d="m179 12 3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="currentColor" opacity=".6"/></>}
{index===4 && <><circle cx="110" cy="52" r="46" fill="white" fillOpacity=".25"/><circle cx="110" cy="52" r="34" fill="white" fillOpacity=".6"/>{[22,38,58,78,48,32,18].map((h,i)=><rect key={i} x={64+i*14} y={52-h/2} width="5" height={h} rx="2.5" fill="currentColor" opacity={i===3?1:.6}/>)}<circle cx="36" cy="52" r="3" fill="currentColor"/><circle cx="188" cy="52" r="3" fill="currentColor"/></>}
{index===5 && <><path d="M50 76 110 29l61 46" stroke="currentColor" strokeWidth="2" opacity=".3"/><circle cx="110" cy="29" r="22" fill="white"/><circle cx="50" cy="76" r="20" fill="white"/><circle cx="171" cy="75" r="20" fill="white"/>{[[110,29],[50,76],[171,75]].map(([x,y])=><g key={x}><circle cx={x} cy={y-4} r="6" stroke="currentColor" strokeWidth="2"/><path d={`M${x-10} ${y+10}c0-12 20-12 20 0`} stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></g>)}</>}
</svg></span>;
}
