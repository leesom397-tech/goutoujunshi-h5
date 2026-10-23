"use client";
import { type ReactNode } from "react";
import { ArrowUpRight, ArrowRight, MessageCircle, BookOpen, ScanLine, Images, Heart, ChevronDown } from "lucide-react";
import { knowledgeManifest, knowledgeVolume } from "@/lib/knowledge-public";
import { knowledgeOrigin } from "@/lib/knowledge-origins";
import { GlassStudy } from "./GlassStudy";
import { RELATIONSHIP_ANALYSIS_LABEL } from "@/lib/product-labels";
import styles from "./ProductHome.module.css";
const features = [
  { href: "/analyze?mode=chat&focus=affinity", icon: Heart, title: "好感探测器", text: "TA 的态度，原话有线索", choices: [{label:"开始探测",href:"/analyze?mode=chat&focus=affinity"}] },
  { href: "/analyze?mode=chat", icon: ScanLine, title: "聊天解读", text: "逐句看意图，帮你想回复", choices: [{label:"上传截图",href:"/analyze?mode=chat"},{label:"导入录屏",href:"/capture?kind=chat&method=video"}] },
  { href: "/analyze?mode=moments", icon: Images, title: "朋友圈与主页", text: "看生活线索，找共同话题", choices: [{label:"朋友圈",href:"/analyze?mode=moments"},{label:"社交主页",href:"/analyze?mode=social"}] },
  { href: "/chat", icon: MessageCircle, title: "问成子", text: "有困惑，直接聊", choices: [{label:"文字提问",href:"/chat"},{label:"语音交流",href:"/voice"}] },
];
export function ProductHome({ signedIn = false, afterHero }: { signedIn?: boolean; afterHero?: ReactNode }) {
  return <div className={styles.page}>
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>成子 · 关系决策智能体</span>
        <h1>看懂关系。<br/><span>也照顾你的感受。</span></h1>
        <p className={styles.heroDescription}>从一句聊天，到一段关系。</p>
        <div className={styles.actions}>
          <a href="/relationship" data-home-start className={styles.startButton}>{RELATIONSHIP_ANALYSIS_LABEL}<ArrowRight size={20}/></a>
          <a href="#home-more-ways" data-home-more className={styles.moreButton}>更多方式<ChevronDown size={18}/></a>
        </div>
      </div>
      <div className={styles.art}><GlassStudy/></div>
    </section>
    {afterHero}
    <section id="home-more-ways" className={styles.tools} aria-labelledby="home-more-title" tabIndex={-1}>
      <header><h2 id="home-more-title">这次想解决什么？</h2><p>选一个最贴近你的问题，直接开始。</p></header>
      <div className={styles.grid} aria-label="选择分析或交流方式">{features.map(({href,icon:Icon,title,text,choices})=><article className={styles.tool} key={href}><a className={styles.toolMain} data-feature-entry href={href}><span className={styles.icon}><Icon size={23} strokeWidth={1.6}/></span><span className={styles.toolCopy}><strong>{title}</strong><span>{text}</span></span><ArrowUpRight className={styles.toolArrow} size={18}/></a><nav className={styles.toolChoices} aria-label={`${title}的使用方式`}>{choices.map(choice=><a key={choice.href} href={choice.href}>{choice.label}<ArrowUpRight size={14}/></a>)}</nav></article>)}</div>
    </section>
    <section className={styles.proofSummary} data-home-proof aria-label="分析依据"><BookOpen size={22}/><div><strong>结论旁边，就能核对原话</strong><p>报告保留来源、另一种解释和下一步建议。</p></div><a href="/library#references">了解分析依据<ArrowRight size={16}/></a></section>
    <nav className={styles.utilities} aria-label="更多信息"><a href="/archive?tab=self">我的资料<ArrowUpRight size={14}/></a><a href="/library">资料与依据<ArrowUpRight size={14}/></a>{!signedIn && <a href="/login?return_to=%2Fworkspace">登录</a>}</nav>
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
