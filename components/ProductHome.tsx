"use client";
import type { ReactNode } from "react";
import { ArrowUpRight, ArrowRight, MessageCircle, BookOpen, ScanLine, Images, ScanFace, AudioLines, Users, Heart, Download } from "lucide-react";
import { knowledgeManifest, knowledgeVolume } from "@/lib/knowledge-public";
import { knowledgeOrigin } from "@/lib/knowledge-origins";
import { GlassStudy } from "./GlassStudy";
import styles from "./ProductHome.module.css";
const features = [
  { href: "/chat", icon: MessageCircle, title: "问成子", text: "直接问眼前的困惑" },
  { href: "/analyze?mode=moments", icon: Images, title: "朋友圈分析", text: "了解日常与兴趣" },
  { href: "/analyze?mode=social", icon: ScanFace, title: "社交主页", text: "看看共同话题" },
  { href: "/voice", icon: AudioLines, title: "语音交流", text: "说说你的困惑" },
  { href: "/archive", icon: Users, title: "人物档案", text: "追踪关系变化" },
  { href: "/support", icon: Download, title: "帮助与下载", text: "下载或更新微信助手" },
];
const tasks = [
  { href: "/analyze?mode=chat&focus=affinity", icon: Heart, title: "好感探测器", text: "TA 对我有好感吗？", action: "测一测", key: "affinity" },
  { href: "/analyze?mode=chat", icon: ScanLine, title: "截图分析", text: "逐句看意图，帮你想回复", action: "传截图", key: "screenshot" },
  { href: "/relationship", icon: Users, title: "完整关系报告", text: "把聊天、语音、朋友圈一起看", action: "选一个人", key: "history" },
];

export function ProductHome({ onStart, signedIn = false, loading = false, error = "", onRetry, afterHero }: { onStart: (href: string) => void; signedIn?: boolean; loading?: boolean; error?: string; onRetry?: () => void; afterHero?: ReactNode }) {
  return <div className={styles.page}>
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>成子 · 关系决策智能体</span>
        <h1>看懂关系。<br/><span>也照顾你的感受。</span></h1>
        <p className={styles.heroDescription}>从一句聊天，到一段关系。</p>
        <div className={styles.taskChoices} data-feature-grid aria-label="选择你想解决的问题">
          {tasks.map(({href, icon: Icon, title, text, action, key}) => <button type="button" key={key} data-feature-entry data-home-task={key} onClick={() => onStart(href)} className={styles.taskChoice}>
            <span className={styles.taskIcon}><Icon size={23} strokeWidth={1.7}/></span>
            <span className={styles.taskCopy}><strong>{title}</strong><span>{text}</span></span>
            <span className={styles.taskAction}>{action}<ArrowRight size={18}/></span>
          </button>)}
        </div>
      </div>
      <div className={styles.art}><GlassStudy/></div>
    </section>
    {loading && <span className={styles.sessionStatus} data-session-state role="status">正在确认账户…</span>}
    {error && <div className={styles.error} data-session-error role="alert">{error}<button onClick={onRetry}>重新连接</button></div>}
    {afterHero}
    <KnowledgeEvidence/>
    <section className={styles.tools} id="tools" aria-labelledby="home-tools-title"><header><h2 id="home-tools-title">更多方式</h2></header><div className={styles.grid} data-feature-grid>{features.map(({href,icon:Icon,title,text})=><a className={styles.tool} data-feature-entry href={href} key={href}><span className={styles.icon}><Icon size={23} strokeWidth={1.6}/></span><span className={styles.toolCopy}><strong>{title}</strong><span>{text}</span></span><ArrowUpRight className={styles.toolArrow} size={18}/></a>)}</div></section>
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
