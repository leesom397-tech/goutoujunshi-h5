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
<header className="home-heading"><div><span className="home-eyebrow">成子 · 关系分析工具</span><h1>看懂关系，<br className="home-title-break"/><span>从这里开始。</span></h1><p>聊天、动态、每一次相处。把线索变成下一步。</p></div><a href={signedIn ? "/account" : "/login"} className="home-login">{signedIn ? "我的账户" : "登录账户"} <ArrowUpRight size={16}/></a></header>
{loading && <p className="home-session-state" role="status">正在确认账户…</p>}{error && <div className="home-session-error" role="alert"><span>{error}</span><button onClick={onRetry}>重新连接</button></div>}
<KnowledgeEvidence/>
<section className="home-tool-section" aria-labelledby="analysis-tools-heading"><div className="home-section-heading"><div><span>01 / 看懂当下</span><h2 id="analysis-tools-heading">从一份资料，开始了解。</h2></div><p>选择你手边的材料</p></div><div className="home-feature-grid" aria-label="全部功能">{features.map(({href,icon:Icon,title,text,action},index)=><Fragment key={href}>{index===3 && <div className="home-section-heading home-section-secondary"><div><span>02 / 持续了解</span><h2>把每一次相处，接着聊。</h2></div><p>交流、记录与回顾</p></div>}<button disabled={loading || !!error} key={href} className={`home-feature home-feature-${index}${index===0 ? " home-feature-primary" : ""}`} onClick={()=>onStart(href)}><span className="home-feature-top"><span className="home-feature-icon"><Icon size={23}/></span><span className="home-feature-number">0{index+1}</span></span><h2>{title}</h2><p>{text}</p>{index===0 && <span className="home-conversation-art" aria-hidden="true"><svg viewBox="0 0 280 165" fill="none"><path d="M68 127C121 167 235 137 236 78" stroke="#cf9c69" strokeWidth="1.3" strokeDasharray="4 6"/><rect x="19" y="23" width="174" height="67" rx="20" fill="white" stroke="#ecd7c0"/><path d="M44 45h95M44 58h121M44 71h66" stroke="#d8c4ad" strokeWidth="4" strokeLinecap="round"/><rect x="99" y="76" width="160" height="63" rx="20" fill="#ad6435"/><path d="M120 96h76M120 109h115M120 122h61" stroke="#f6dfc8" strokeWidth="4" strokeLinecap="round"/><circle cx="207" cy="41" r="21" fill="#f6e4c9" stroke="white" strokeWidth="3"/><path d="m198 41 6 6 11-12" stroke="#965c32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>}<span className="home-feature-action">{action}<ArrowUpRight size={17}/></span></button></Fragment>)}</div></section>
<nav className="home-utilities" aria-label="更多工具"><button disabled={loading || !!error} onClick={()=>onStart("/reports")}>历史报告 <ArrowUpRight size={14}/></button><button disabled={loading || !!error} onClick={()=>onStart("/import")}>导入聊天记录 <ArrowUpRight size={14}/></button><button disabled={loading || !!error} onClick={()=>onStart("/archive?tab=self")}>我的资料 <ArrowUpRight size={14}/></button></nav>
<p className="home-note">分析前确认积分费用 · 资料数量不代表判断准确率 · <a href="/privacy">数据与隐私</a></p>
</div>;
}

export function KnowledgeEvidence(){return <section className="home-evidence" aria-label="资料库依据"><div className="home-evidence-title"><BookOpen size={20}/><div><strong>分析有资料可参考</strong><span>成子 · 心理学硕士 · 全网百万粉丝</span></div></div><div className="home-evidence-stats"><span><b>{library.referenceDocuments}</b> 篇参考文档</span><span><b>{knowledgeVolume}</b> 万字资料</span><span><b>{knowledgeDomains.length}</b> 类关系主题</span></div><a href="/library">查看资料库 <ArrowUpRight size={16}/></a></section>;}
