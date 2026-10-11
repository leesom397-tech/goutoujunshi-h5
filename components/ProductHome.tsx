"use client";
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
export function ProductHome({onStart,signedIn=false}:{onStart:(href:string)=>void;signedIn?:boolean}) {
return <div className="simple-home">
<header className="home-heading"><div><span className="home-eyebrow">成子 · 关系分析工具</span><h1>今天想了解什么？</h1><p>选择一种方式，开始分析或交流。</p></div><a href={signedIn ? "/account" : "/login"} className="home-login">{signedIn ? "我的账户" : "登录账户"} <ArrowUpRight size={16}/></a></header>
<KnowledgeEvidence/>
<section className="home-feature-grid" aria-label="全部功能">{features.map(({href,icon:Icon,title,text,action})=><button key={href} className="home-feature" onClick={()=>onStart(href)}><span className="home-feature-icon"><Icon size={23}/></span><h2>{title}</h2><p>{text}</p><span className="home-feature-action">{action}<ArrowUpRight size={17}/></span></button>)}</section>
<nav className="home-utilities" aria-label="更多工具"><button onClick={()=>onStart("/reports")}>历史报告 <ArrowUpRight size={14}/></button><button onClick={()=>onStart("/import")}>导入聊天记录 <ArrowUpRight size={14}/></button><button onClick={()=>onStart("/archive?tab=self")}>我的资料 <ArrowUpRight size={14}/></button></nav>
<p className="home-note">分析前确认积分费用 · 资料数量不代表判断准确率 · <a href="/privacy">数据与隐私</a></p>
</div>;
}

export function KnowledgeEvidence(){return <section className="home-evidence" aria-label="资料库依据"><div className="home-evidence-title"><BookOpen size={20}/><div><strong>分析有资料可参考</strong><span>成子 · 心理学硕士 · 全网百万粉丝</span></div></div><div className="home-evidence-stats"><span><b>{library.referenceDocuments}</b> 篇参考文档</span><span><b>{knowledgeVolume}</b> 万字资料</span><span><b>{knowledgeDomains.length}</b> 类关系主题</span></div><a href="/library">查看资料库 <ArrowUpRight size={16}/></a></section>;}
