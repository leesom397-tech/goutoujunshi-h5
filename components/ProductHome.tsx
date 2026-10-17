"use client";
import type { ReactNode } from "react";
import { ArrowUpRight, ArrowRight, MessageCircle, BookOpen, History, ChartNoAxesCombined, GitCompareArrows, FileText, Route, ScanLine, Images, ScanFace, AudioLines, Users } from "lucide-react";
import { knowledgeManifest, knowledgeVolume } from "@/lib/knowledge-public";
import { knowledgeOrigin } from "@/lib/knowledge-origins";
import { GlassStudy } from "./GlassStudy";
import { AddMaterials } from "./AddMaterials";
import styles from "./ProductHome.module.css";
const features = [
  { href: "/analyze?mode=chat", icon: ScanLine, title: "聊天分析", text: "看聊天里的信号、变化和下一步。" },
  { href: "/analyze?mode=moments", icon: Images, title: "朋友圈分析", text: "从动态和照片了解兴趣与生活。" },
  { href: "/analyze?mode=social", icon: ScanFace, title: "社交主页", text: "整理可见资料和你们的共同点。" },
  { href: "/chat", icon: MessageCircle, title: "问成子", text: "只问眼前的问题，不用做完整报告。" },
  { href: "/voice", icon: AudioLines, title: "语音交流", text: "直接说出困惑，一起理清思路。" },
  { href: "/archive", icon: Users, title: "人物档案", text: "接着看相处记录与关系变化。" },
];

export function ProductHome({ onStart, signedIn = false, loading = false, error = "", onRetry, afterHero }: { onStart: (href: string) => void; signedIn?: boolean; loading?: boolean; error?: string; onRetry?: () => void; afterHero?: ReactNode }) {
  return <div className={`${styles.page} ${signedIn ? styles.returning : ""}`}>
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>成子 · 关系决策智能体</span>
        <h1>看懂关系。<br/><span>也照顾你的感受。</span></h1>
        <p className={styles.heroDescription}>从一句聊天，到一段关系。<br className={styles.desktopBreak}/>那些没说清的在意，我们一起慢慢理清。</p>
        <div className={styles.actions} data-feature-grid>
          <button data-feature-entry onClick={() => onStart("/analyze?mode=chat")}><MessageCircle size={19}/><span>开启我的关系空间</span><ArrowUpRight size={17}/></button>
        </div>
        <div className={styles.nearbyLinks}><a href="/chat"><MessageCircle size={16}/>只问一个问题</a><a href="/reports"><History size={16}/>历史报告</a><a href="/archive?compare=1"><GitCompareArrows size={17}/>人物对照</a>{!signedIn && <a href="/examples">先看案例<ArrowUpRight size={15}/></a>}</div>
        <ul className={styles.heroBenefits} aria-label="成子的核心能力"><li><FileText size={17}/>从原话看依据</li><li><ChartNoAxesCombined size={17}/>看清关系变化</li><li><Route size={17}/>找到下一步</li></ul>
      </div>
      <div className={styles.art}><GlassStudy/></div>
    </section>
    {loading && <span className={styles.sessionStatus} data-session-state role="status">正在确认账户…</span>}
    {error && <div className={styles.error} data-session-error role="alert">{error}<button onClick={onRetry}>重新连接</button></div>}
    <KnowledgeEvidence/>
    {afterHero}
    <section className={styles.materials} id="materials" aria-label="添加分析材料"><div><strong>手里有材料，直接带进来</strong><p>截图、电脑微信、录屏和文件，都从这里开始。</p></div><AddMaterials/><a href="/capture?method=library">已导入材料<ArrowUpRight size={15}/></a></section>
    <section className={styles.tools} id="tools" aria-labelledby="home-tools-title"><header><div><span className={styles.eyebrow}>常用功能</span><h2 id="home-tools-title">想从哪里开始？</h2></div></header><div className={styles.grid} data-feature-grid>{features.map(({href,icon:Icon,title,text})=><a className={styles.tool} data-feature-entry href={href} key={href}><span className={styles.icon}><Icon size={23} strokeWidth={1.6}/></span><span className={styles.toolCopy}><strong>{title}</strong><span>{text}</span></span><ArrowUpRight className={styles.toolArrow} size={18}/></a>)}</div></section>
    <nav className={styles.utilities} aria-label="更多信息"><a href="/archive?tab=self">我的资料<ArrowUpRight size={14}/></a><a href="/library">资料与依据<ArrowUpRight size={14}/></a><a href="/examples">分析案例<ArrowUpRight size={14}/></a><span>分析前确认积分费用 · <a href="/privacy">数据与隐私</a></span></nav>
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
    <div className={`${styles.stats} ${styles.volumeStats}`} aria-label="方法资料规模">
      <div className={styles.volumeHero}><span>已整理可调用资料</span><b><small>约</small>{knowledgeVolume}<small>万字</small></b><span>不是空泛话术，每条结论都说明依据</span></div>
      <div><b>{knowledgeOrigin.referenceCount}<small> 条</small></b><span>参考来源</span></div><div><b>{knowledgeManifest.referenceDocuments}<small> 份</small></b><span>结构化专题</span></div>
    </div>
    <div className={styles.evidenceFooter}>
      <span className={styles.author}>成子 · 心理学硕士 · 全网百万粉丝</span>
      <a href="/library#references">查看全部 {knowledgeOrigin.referenceCount} 条参考来源 <ArrowRight size={16}/></a>
    </div>
  </section>;
}
