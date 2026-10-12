"use client";
import {ArrowUpRight, ArrowRight, ScanLine, Images, ScanFace, MessageCircle, AudioLines, Users, BookOpen} from "lucide-react";
import {knowledgeManifest as library} from "@/lib/knowledge-public";
import {knowledgeDomains, knowledgeOrigin} from "@/lib/knowledge-origins";
import { GlassStudy } from "./GlassStudy";
import styles from "./ProductHome.module.css";
const features = [
{href:"/analyze?mode=chat",icon:ScanLine,title:"聊天分析",text:"上传聊天截图，看语气、好感信号和回复建议。",action:"上传聊天"},
{href:"/analyze?mode=moments",icon:Images,title:"朋友圈分析",text:"从动态了解兴趣、生活方式和可聊的话题。",action:"上传朋友圈"},
{href:"/analyze?mode=social",icon:ScanFace,title:"社交主页",text:"整理个人资料，发现共同点与待了解的信息。",action:"分析主页"},
{href:"/chat",icon:MessageCircle,title:"文字军师",text:"带着具体问题，讨论眼前该怎么做。",action:"开始对话"},
{href:"/voice",icon:AudioLines,title:"语音交流",text:"直接说出困惑，用语音一起理清思路。",action:"开始语音"},
{href:"/archive",icon:Users,title:"人物档案",text:"保存关系线索，回看历史分析与后续变化。",action:"打开档案"}
];

export function ProductHome({onStart,signedIn=false,loading=false,error="",onRetry}:{onStart:(href:string)=>void;signedIn?:boolean;loading?:boolean;error?:string;onRetry?:()=>void}) {
const disabled=loading||!!error;
return <div className={styles.page}>
<section className={styles.hero}>

<div className={styles.heroCopy}><span className={styles.eyebrow}>成子 · 关系决策智能体</span><h1>看懂当下这一句。<br/><span>让下一步，更清晰。</span></h1><p>从聊天里的细节，到一段关系的走向。<br/>理解互动信号，记住每一次相处。</p><div className={styles.actions}><button onClick={()=>onStart('/analyze?mode=chat')}>开始分析 <ArrowRight size={17}/></button><a href="#tools">探索全部功能 <ArrowUpRight size={16}/></a></div><span className={styles.privacy}>你的内容，只用于你的关系分析。</span></div>
<div className={styles.art}><GlassStudy/></div>
</section>
{loading&&<p className={styles.status} data-session-state role="status">正在确认账户…</p>}{error&&<div className={styles.error} data-session-error role="alert">{error}<button onClick={onRetry}>重新连接</button></div>}
<KnowledgeEvidence/>
<section id="tools" className={styles.tools}><header><div><span className={styles.eyebrow}>从线索到行动</span><h2>你想从哪里开始？</h2></div><a href={signedIn?'/account':'/login'}>{signedIn?'我的账户':'登录账户'} <ArrowUpRight size={16}/></a></header><div className={styles.grid} data-feature-grid>{features.map(({href,icon:Icon,title,text,action},i)=><button className={styles.tool} data-feature-entry key={href} disabled={!href.startsWith('/analyze?') && disabled} onClick={()=>onStart(href)}><span className={styles.icon}><Icon size={23} strokeWidth={1.4}/></span><span className={styles.toolCopy}><strong>{title}</strong><span>{text}</span><small>{action} <ArrowRight size={15}/></small></span><span className={styles.index}>0{i+1}</span></button>)}</div></section>
<nav className={styles.utilities} aria-label="更多工具">{[['/reports','历史报告'],['/import','导入聊天记录'],['/archive?tab=self','我的资料']].map(([href,label])=><button key={href} disabled={disabled} onClick={()=>onStart(href)}>{label}<ArrowUpRight size={14}/></button>)}<span>分析前确认积分费用 · <a href="/privacy">数据与隐私</a></span></nav>
</div>;
}
export function KnowledgeEvidence() {
  return <section className={styles.evidence} data-knowledge-evidence aria-label="资料依据与分析方法">
    <div className={styles.evidenceHeading}>
      <span className={styles.evidenceKicker}><BookOpen size={17} strokeWidth={1.5}/>研究方法 × 你的真实互动</span>
      <h2>循证驱动的关系分析系统</h2>
      <p>参考体系涵盖 <strong>{knowledgeOrigin.referenceCount} 条参考来源</strong>，融合心理学、法学与社会学知识，整理为可供成子智能体按问题调用的结构化知识库。</p>
      <ul className={styles.theoryTags} aria-label="参考理论与研究领域">{['亲密关系','依恋理论','大五人格','戈特曼婚姻研究','婚姻与沟通','社会交换与承诺'].map(label=><li key={label}>{label}</li>)}</ul>
    </div>
    <div className={styles.stats} aria-label="方法资料规模">
      {[[knowledgeOrigin.referenceCount, "条", "参考来源"], [library.referenceDocuments, "份", "结构化专题"], [knowledgeDomains.length, "类", "关系主题"]].map(([value, unit, label]) => <div key={label}><b>{value}<small>{unit}</small></b><span>{label}</span></div>)}
    </div>
    <ol className={styles.methodFlow} aria-label="从资料依据到行动建议">
      <li><span className={styles.methodNumber}>01</span><div><strong>循证资料库</strong><small>按问题匹配研究与方法资料，区分研究证据、理论框架和经验策略。</small></div><ArrowRight size={17} aria-hidden="true"/></li>
      <li><span className={styles.methodNumber}>02</span><div><strong>个体化建模</strong><small>结合聊天记录与长期人物档案，对照主动性、回应和态度变化。</small></div><ArrowRight size={17} aria-hidden="true"/></li>
      <li><span className={styles.methodNumber}>03</span><div><strong>结论与行动方案</strong><small>呈现原话依据与相关方法，给出可执行的沟通建议和时机选择。</small></div></li>
    </ol>
    <div className={styles.evidenceFooter}>
      <span className={styles.author}>成子 · 心理学硕士 · 全网百万粉丝</span>
      <a href="/library#references">查看 {knowledgeOrigin.referenceCount} 条参考资料来源 <ArrowRight size={16}/></a>
    </div>
  </section>;
}
