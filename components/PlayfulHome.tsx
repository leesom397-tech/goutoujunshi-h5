"use client";
import {useState} from "react";
import {ArrowUpRight, ArrowRight, ScanLine, MessageCircle, AudioLines, Users, Image, ShieldCheck, Plus} from "lucide-react";
import {knowledgeManifest as library, knowledgeVolume} from "@/lib/knowledge-public";
import {knowledgeDomains} from "@/lib/knowledge-origins";
const options=[{id:"chat",label:"聊天分析",title:"这句话，\n藏着什么信号？",note:"从原话到语气，再到下一步。",color:"olive",icon:MessageCircle},{id:"moments",label:"朋友圈",title:"日常碎片，\n拼出相处线索。",note:"看动态、找话题，也看另一种解释。",color:"pink",icon:Image},{id:"social",label:"社交主页",title:"先认识这个人，\n再决定怎么靠近。",note:"兴趣、生活方式、可以聊的共同点。",color:"mint",icon:Users}];
export function PlayfulHome({onExample,onStart}:{onExample:(href:string)=>void;onStart:(href:string)=>void}){
const [mode,setMode]=useState(0);const current=options[mode],Icon=current.icon;
const proof=[
{value:String(library.referenceDocuments),unit:"篇",label:"已整理参考文档",note:`${library.knowledgeDocuments} 篇知识 · ${library.practicalDocuments} 篇实践`,tone:"paper"},
{value:knowledgeVolume,unit:"万字",label:"资料内容规模",note:"按当前资料库中文字数统计",tone:"paper"},
{value:String(knowledgeDomains.length),unit:"类",label:"关系主题",note:"从沟通、依恋到长期相处",tone:"paper"}
];
return <div className="p-home">
<section className="p-stage"><div className="p-stage-inner"><div className="p-intro"><span className="p-label">你的私人关系空间</span><h1>看懂这一句。<br/>走好下一步。</h1><p>聊天里的在意，关系里的犹豫。<br/>一起找到有依据的答案。</p><div className="p-ctas"><button className="p-button dark" onClick={()=>onStart("/analyze?mode=chat")}><Plus size={19}/>开始我的分析</button><a className="p-button light" href="/login">登录 <ArrowUpRight size={18}/></a></div><span className="p-author">成子 <i/> 心理学硕士 · 全网百万粉丝</span></div></div></section>
<section className="p-demo-section" aria-label="功能示例"><div className="p-demo-wrap"><div className="p-demo-heading"><span className="p-label">先看看能得到什么</span><h2>选一个入口，打开完整案例。</h2><p>先看原话和判断，再决定是否使用。</p></div><div className="p-demo"><div className="p-tabrow" role="tablist" aria-label="选择体验功能">{options.map((o,i)=><button key={o.id} role="tab" aria-selected={mode===i} aria-controls="home-demo" onClick={()=>setMode(i)}>{o.label}</button>)}</div><article id="home-demo" role="tabpanel" className={"p-demo-card "+current.color}><header><Icon size={28}/><span>免费示例</span><span className="p-demo-index">0{mode+1}</span></header><h2>{current.title}</h2><p>{current.note}</p><div className="p-demo-material">{mode===0?<><span className="p-speaker">对方</span><blockquote>今天面试怎么样？<br/>记得你说三点开始。</blockquote><div className="p-mini-tags"><span>记住你的安排</span><span>主动关心</span></div></>:<><span className="p-speaker">虚构材料 · 林然</span><blockquote>{mode===1?"今天这场展值得慢慢看。":"周末常看展，最近在学摄影。"}</blockquote><div className="p-mini-tags"><span>兴趣线索</span><span>自然开场</span></div></>}</div><button className="p-row" onClick={()=>onExample("/analyze?mode="+current.id)}><span>打开完整分析</span><span className="p-circle"><ArrowUpRight size={22}/></span></button></article></div></div></section>
<section className="p-proof" aria-labelledby="proof-title"><div className="p-proof-inner">
<div className="p-proof-intro"><div><span className="p-label">分析从哪里来</span><h2 id="proof-title">有依据，才值得参考。</h2></div><a className="p-button dark" href="/library">查看资料库 <ArrowUpRight size={18}/></a></div>
<div className="p-proof-grid"><article className="p-proof-author"><Users size={25}/><span className="p-label">成子 · 主理人</span><h3>心理学硕士</h3><p>全网百万粉丝</p></article>{proof.map(item=><article className="p-proof-card" key={item.label}><span>{item.label}</span><strong>{item.value}<small>{item.unit}</small></strong><p>{item.note}</p></article>)}</div>
<div className="p-proof-note"><ShieldCheck size={16}/><span>参考资料可查阅，推测结合原话核对。资料规模不代表判断准确率。</span></div>
</div></section>
<section className="p-tools"><div className="p-section-title"><span className="p-label">不止一份报告</span><h2>每一步，都接着了解。</h2></div><div className="p-tool-grid">{[{href:"/chat",name:"随时问军师",note:"不知道怎么回？一起想清楚。",icon:MessageCircle,tone:"lav"},{href:"/voice",name:"直接说出来",note:"用声音，把在意的事慢慢说。",icon:AudioLines,tone:"peach"},{href:"/archive",name:"你们的关系档案",note:"记住过去每一次，看见关系变化。",icon:Users,tone:"mint"}].map(({href,name,note,icon:Tool,tone})=><a className={"p-tool "+tone} href={href} key={href}><Tool size={30}/><h3>{name}</h3><p>{note}</p><span className="p-row"><b>进入</b><span className="p-circle"><ArrowUpRight size={21}/></span></span></a>)}</div><div className="p-safety"><ShieldCheck size={16}/>资料由你掌控 · 分析前确认积分费用<a href="/privacy">了解隐私 <ArrowRight size={14}/></a></div></section></div>;
}

