"use client";
import {ArrowUpRight, ArrowRight, MessageCircle, AudioLines, Users, ShieldCheck, Plus} from "lucide-react";
import {knowledgeManifest as library, knowledgeVolume} from "@/lib/knowledge-public";
import {knowledgeDomains} from "@/lib/knowledge-origins";
export function PlayfulHome({onStart}:{onExample?:(href:string)=>void;onStart:(href:string)=>void}){
const proof=[
{value:String(library.referenceDocuments),unit:"篇",label:"已整理参考文档",note:`${library.knowledgeDocuments} 篇知识 · ${library.practicalDocuments} 篇实践`,tone:"paper"},
{value:knowledgeVolume,unit:"万字",label:"资料内容规模",note:"按当前资料库中文字数统计",tone:"paper"},
{value:String(knowledgeDomains.length),unit:"类",label:"关系主题",note:"从沟通、依恋到长期相处",tone:"paper"}
];
return <div className="p-home">
<section className="p-proof" aria-labelledby="proof-title"><div className="p-proof-inner">
<div className="p-proof-intro"><div><span className="p-label">分析从哪里来</span><h2 id="proof-title">有依据，才值得参考。</h2></div><a className="p-button dark" href="/library">查看资料库 <ArrowUpRight size={18}/></a></div>
<div className="p-proof-grid"><article className="p-proof-author"><Users size={25}/><span className="p-label">成子 · 主理人</span><h3>心理学硕士</h3><p>全网百万粉丝</p></article>{proof.map(item=><article className="p-proof-card" key={item.label}><span>{item.label}</span><strong>{item.value}<small>{item.unit}</small></strong><p>{item.note}</p></article>)}</div>
<div className="p-proof-note"><ShieldCheck size={16}/><span>参考资料可查阅，推测结合原话核对。资料规模不代表判断准确率。</span></div>
</div></section>
<section className="p-stage"><div className="p-stage-inner"><div className="p-intro"><span className="p-label">你的私人关系空间</span><h1>看懂这一句。<br/>走好下一步。</h1><p>聊天里的在意，关系里的犹豫。<br/>一起找到有依据的答案。</p><div className="p-ctas"><button className="p-button dark" onClick={()=>onStart("/analyze?mode=chat")}><Plus size={19}/>开始我的分析</button><a className="p-button light" href="/login">登录 <ArrowUpRight size={18}/></a></div><span className="p-author">成子 <i/> 心理学硕士 · 全网百万粉丝</span></div></div></section>
<section className="p-tools"><div className="p-section-title"><span className="p-label">不止一份报告</span><h2>每一步，都接着了解。</h2></div><div className="p-tool-grid">{[{href:"/chat",name:"随时问军师",note:"不知道怎么回？一起想清楚。",icon:MessageCircle,tone:"lav"},{href:"/voice",name:"直接说出来",note:"用声音，把在意的事慢慢说。",icon:AudioLines,tone:"peach"},{href:"/archive",name:"你们的关系档案",note:"记住过去每一次，看见关系变化。",icon:Users,tone:"mint"}].map(({href,name,note,icon:Tool,tone})=><a className={"p-tool "+tone} href={href} key={href}><Tool size={30}/><h3>{name}</h3><p>{note}</p><span className="p-row"><b>进入</b><span className="p-circle"><ArrowUpRight size={21}/></span></span></a>)}</div><div className="p-safety"><ShieldCheck size={16}/>资料由你掌控 · 分析前确认积分费用<a href="/privacy">了解隐私 <ArrowRight size={14}/></a></div></section></div>;
}

