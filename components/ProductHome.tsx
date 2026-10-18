"use client";
import type { ReactNode } from "react";
import { ArrowUpRight, ArrowRight, MessageCircle, BookOpen, ScanLine, Images, ScanFace, AudioLines, Users, Heart, MessageCircleQuestion, Send } from "lucide-react";
import { analysisPurposes } from "@/lib/person-analysis-navigation";
import { knowledgeManifest, knowledgeVolume } from "@/lib/knowledge-public";
import { knowledgeOrigin } from "@/lib/knowledge-origins";
import { GlassStudy } from "./GlassStudy";
import styles from "./ProductHome.module.css";
const features = [
  { href: "/analyze?mode=chat", icon: ScanLine, title: "聊天分析", text: "逐句意图 · 怎么回" },
  { href: "/analyze?mode=moments", icon: Images, title: "朋友圈分析", text: "了解日常与兴趣" },
  { href: "/analyze?mode=social", icon: ScanFace, title: "社交主页", text: "看看共同话题" },
  { href: "/chat", icon: MessageCircle, title: "问成子", text: "聊聊眼前的疑问" },
  { href: "/voice", icon: AudioLines, title: "语音交流", text: "说说你的困惑" },
  { href: "/archive", icon: Users, title: "人物档案", text: "追踪关系变化" },
];

export function ProductHome({ onStart, loading = false, error = "", onRetry, afterHero }: { onStart: (href: string) => void; signedIn?: boolean; loading?: boolean; error?: string; onRetry?: () => void; afterHero?: ReactNode }) {
  return <div className={styles.page}>
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>成子 · 关系决策智能体</span>
        <h1>看懂关系。<br/><span>也照顾你的感受。</span></h1>
        <p className={styles.heroDescription}>从一句聊天，到一段关系。</p>
        <div className={styles.actions} data-feature-grid>
          <button type="button" data-feature-entry onClick={() => onStart("/relationship")}><span>分析一个人的全部资料</span><ArrowUpRight size={18}/></button>
        </div>
        <nav className={styles.nearbyLinks} aria-label="先解决眼前的问题">{analysisPurposes.map((purpose,index) => { const Icon=[Heart,MessageCircleQuestion,Send][index]; return <a href={"/analyze?mode=chat&focus="+purpose.key} key={purpose.key}><Icon size={17}/>{purpose.title}<ArrowRight size={14}/></a>; })}</nav>
      </div>
      <div className={styles.art}><GlassStudy/></div>
    </section>
    {loading && <span className={styles.sessionStatus} data-session-state role="status">正在确认账户…</span>}
    {error && <div className={styles.error} data-session-error role="alert">{error}<button onClick={onRetry}>重新连接</button></div>}
    <KnowledgeEvidence/>
    {afterHero}
    <section className={styles.tools} id="tools" aria-labelledby="home-tools-title"><header><h2 id="home-tools-title">更多方式</h2></header><div className={styles.grid} data-feature-grid>{features.map(({href,icon:Icon,title,text})=><a className={styles.tool} data-feature-entry href={href} key={href}><span className={styles.icon}><Icon size={23} strokeWidth={1.6}/></span><span className={styles.toolCopy}><strong>{title}</strong><span>{text}</span></span><ArrowUpRight className={styles.toolArrow} size={18}/></a>)}</div></section>
    <nav className={styles.utilities} aria-label="更多信息"><a href="/archive?tab=self">我的资料<ArrowUpRight size={14}/></a><a href="/library">资料与依据<ArrowUpRight size={14}/></a><a href="/login?return_to=%2Fworkspace">登录</a></nav>
  </div>;
}
export function KnowledgeEvidence() {
  return <section className={styles.evidence} data-knowledge-evidence aria-label="资料依据与分析方法">
    <div className={styles.evidenceHeading}>
      <span className={styles.evidenceKicker}><BookOpen size={17} strokeWidth={1.5}/>成子智能体的资料依据</span>
      <h2>每个判断，都能回到依据</h2>
      <p><strong>心理学、法学、社会学多学科资料</strong>，加上关系研究与书籍整理，约 {knowledgeVolume} 万字。成子智能体再结合你的聊天和相处经历，给出看得懂的判断。</p>
      <ul className={styles.theoryTags} aria-label="参考书目">{['《亲密关系》','《非暴力沟通》','《爱的艺术》','《成人依恋》','《Attachment and Loss》','《私人生活的变革》'].map(label=><li key={label}>{label}</li>)}</ul>
    </div>
    <div className={styles.stats} aria-label="方法资料规模">
      <div className={styles.volumeHero}><span>已整理可调用资料</span><b><small>约</small>{knowledgeVolume}<small>万字</small></b><span>不是空泛话术，每条结论都说明依据</span></div>
      <div><b>{knowledgeOrigin.referenceCount}<small> 条</small></b><span>参考来源</span></div><div><b>{knowledgeManifest.referenceDocuments}<small> 份</small></b><span>结构化专题</span></div>
    </div>
    <div className={styles.evidenceFooter}>
      <span className={styles.author}>成子 · 心理学硕士 · 全网百万粉丝</span>
      <a href="/library#references">查看全部 {knowledgeOrigin.referenceCount} 条参考来源 <ArrowRight size={16}/></a>
    </div>
  </section>;
}
