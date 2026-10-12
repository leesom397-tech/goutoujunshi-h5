"use client";
import {ArrowUpRight, ArrowRight, ScanLine, Images, ScanFace, MessageCircle, AudioLines, Users, BookOpen} from "lucide-react";
import {knowledgeVolume} from "@/lib/knowledge-public";
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
      <span className={styles.evidenceKicker}><BookOpen size={17} strokeWidth={1.5}/>成子智能体的资料依据</span>
      <h2>用有依据的分析，帮你看清关系</h2>
      <p><strong>融合心理学、法学、社会学等多学科知识</strong>，参考书籍与关系研究，整理约 {knowledgeVolume} 万字资料。成子智能体结合你的聊天与相处经历，帮你想清楚下一步。</p>
      <ul className={styles.theoryTags} aria-label="参考书目">{['《亲密关系》','《非暴力沟通》','《爱的艺术》','《成人依恋》','《Attachment and Loss》','《私人生活的变革》'].map(label=><li key={label}>{label}</li>)}</ul>
    </div>
    <div className={`${styles.stats} ${styles.volumeStats}`} aria-label="方法资料规模">
      <div className={styles.volumeHero}><span>为关系分析整理的资料</span><b><small>约</small>{knowledgeVolume}<small>万字</small></b><span>从资料依据，到你的具体处境</span></div>
      {[[knowledgeOrigin.referenceCount, "条", "参考来源"], [knowledgeDomains.length, "类", "关系主题"]].map(([value, unit, label]) => <div key={label}><b>{value}<small>{unit}</small></b><span>{label}</span></div>)}
    </div>
    <div className={styles.evidenceFooter}>
      <span className={styles.author}>成子 · 心理学硕士 · 全网百万粉丝</span>
      <a href="/library#references">查看全部 {knowledgeOrigin.referenceCount} 条参考来源 <ArrowRight size={16}/></a>
    </div>
  </section>;
}
