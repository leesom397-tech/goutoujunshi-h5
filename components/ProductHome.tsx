"use client";
import { useRef, type ReactNode, type MouseEvent } from "react";
import { ArrowUpRight, ArrowRight, MessageCircle, BookOpen, ScanLine, Images, ScanFace, AudioLines, Users, Heart, Download, ChevronDown } from "lucide-react";
import { knowledgeManifest, knowledgeVolume } from "@/lib/knowledge-public";
import { knowledgeOrigin } from "@/lib/knowledge-origins";
import { GlassStudy } from "./GlassStudy";
import { RELATIONSHIP_ANALYSIS_LABEL } from "@/lib/product-labels";
import styles from "./ProductHome.module.css";
const features = [
  { href: "/analyze?mode=chat&focus=affinity", icon: Heart, title: "好感探测器", text: "看好感信号与判断依据" },
  { href: "/analyze?mode=chat", icon: ScanLine, title: "截图分析", text: "逐句看意图，帮你想回复" },
  { href: "/chat", icon: MessageCircle, title: "问成子", text: "直接问眼前的困惑" },
  { href: "/analyze?mode=moments", icon: Images, title: "朋友圈分析", text: "了解日常与兴趣" },
  { href: "/analyze?mode=social", icon: ScanFace, title: "社交主页", text: "看看共同话题" },
  { href: "/voice", icon: AudioLines, title: "语音交流", text: "说说你的困惑" },
  { href: "/archive", icon: Users, title: "人物档案", text: "追踪关系变化" },
  { href: "/support", icon: Download, title: "帮助与下载", text: "下载或更新微信助手" },
];
export function ProductHome({ onStart, signedIn = false, afterHero }: { onStart: (href: string) => void; signedIn?: boolean; afterHero?: ReactNode }) {
  const tools = useRef<HTMLElement>(null);
  function showTools(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0 || !tools.current) return;
    event.preventDefault();
    event.stopPropagation();
    // Keep this an in-page action. Updating router-managed history here can
    // restore the old scroll position after a keyboard or repeat activation.
    tools.current.focus({ preventScroll: true });
    // Keep focus and position together. Competing keyboard focus scrolls can
    // cancel a smooth animation and leave this apparently unresponsive.
    tools.current.scrollIntoView({ block: "start", behavior: "instant" });
  }
  return <div className={styles.page}>
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>成子 · 关系决策智能体</span>
        <h1>看懂关系。<br/><span>也照顾你的感受。</span></h1>
        <p className={styles.heroDescription}>从一句聊天，到一段关系。</p>
        <div className={styles.actions}>
          <button type="button" data-home-start className={styles.startButton} onClick={() => onStart("/relationship")}>{RELATIONSHIP_ANALYSIS_LABEL}<ArrowRight size={20}/></button>
          <a className={styles.moreButton} href="#home-more-ways" onClick={showTools}>更多方式<ChevronDown size={18}/></a>
        </div>
      </div>
      <div className={styles.art}><GlassStudy/></div>
    </section>
    {afterHero}
    <KnowledgeEvidence/>
    <section ref={tools} id="home-more-ways" className={styles.tools} aria-labelledby="home-more-title" tabIndex={-1}>
      <header><h2 id="home-more-title">更多方式</h2></header>
      <nav className={styles.grid} aria-label="选择分析或交流方式">{features.map(({href,icon:Icon,title,text})=><a className={styles.tool} data-feature-entry href={href} key={href}><span className={styles.icon}><Icon size={23} strokeWidth={1.6}/></span><span className={styles.toolCopy}><strong>{title}</strong><span>{text}</span></span><ArrowUpRight className={styles.toolArrow} size={18}/></a>)}</nav>
    </section>
    <nav className={styles.utilities} aria-label="更多信息"><a href="/archive?tab=self">我的资料<ArrowUpRight size={14}/></a><a href="/library">资料与依据<ArrowUpRight size={14}/></a><a href="/support">帮助与下载<ArrowUpRight size={14}/></a>{!signedIn && <a href="/login?return_to=%2Fworkspace">登录</a>}</nav>
  </div>;
}
export function KnowledgeEvidence() {
  return <section className={styles.evidence} data-knowledge-evidence aria-label="资料依据与分析方法">
    <div className={styles.evidenceHeading}>
      <span className={styles.evidenceKicker}><BookOpen size={17} strokeWidth={1.5}/>成子智能体的资料依据</span>
      <h2>每个判断，都能回到依据</h2>
      <p>结合你的原话与相处经历，参考<strong>心理学、法学、社会学</strong>资料，让判断有迹可循。</p>
      <ul className={styles.theoryTags} aria-label="参考书目">{['《亲密关系》','《非暴力沟通》','《爱的艺术》','《成人依恋》','《Attachment and Loss》','《私人生活的变革》'].map(label=><li key={label}>{label}</li>)}</ul>
    </div>
    <div className={styles.stats} aria-label="方法资料规模">
      <div className={styles.volumeHero}><span>已整理可调用资料</span><b><small>约</small>{knowledgeVolume}<small>万字</small></b></div>
      <div><b>{knowledgeOrigin.referenceCount}<small> 条</small></b><span>参考来源</span></div><div><b>{knowledgeManifest.referenceDocuments}<small> 份</small></b><span>结构化专题</span></div>
    </div>
    <div className={styles.evidenceFooter}>
      <span className={styles.author}>成子 · 心理学硕士 · 全网百万粉丝</span>
      <a href="/library#references">查看全部 {knowledgeOrigin.referenceCount} 条参考来源 <ArrowRight size={16}/></a>
    </div>
  </section>;
}
