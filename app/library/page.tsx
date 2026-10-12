import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, MessageCircle, Waypoints } from "lucide-react";
import { knowledgeManifest as library, knowledgeVolume } from "@/lib/knowledge-public";
import { knowledgeOrigin, representativeBooks, indexedBooks, knowledgeDomains, researchStudies } from "@/lib/knowledge-origins";
import { WebNav } from "@/components/WebNav";
import { AuroraPageHero } from "@/components/AuroraPageHero";
import ui from "@/components/AuroraUI.module.css";
import styles from "./LibraryPage.module.css";

export const metadata: Metadata = { title: "知识库与方法｜成子", description: `${knowledgeOrigin.referenceCount} 条书籍、研究及官方资料等来源线索，${library.referenceDocuments} 份已接入专题，约 ${knowledgeVolume} 万汉字提炼。查看 成子 如何用于具体关系情境。` };

export default function LibraryPage() {
  return <main className={ui.page}><WebNav/><div className={`${ui.wrap} ${styles.content}`}>
    <AuroraPageHero eyebrow="关系知识，落到你的具体处境" title={<>先看事实，<br />再给你可执行的建议。</>} description="我们参考关系研究，但不拿单句聊天给对方“读心”或预测结局。想直接使用？先选截图，确认谁是你。"><Link className={ui.primary} href="/analyze?mode=chat">选聊天截图 →</Link></AuroraPageHero>
    <section className={styles.section} id="research"><div className={styles.sectionHead}><div><h2>可核对的研究依据</h2><p>看研究方法、主要发现，也看这些结论不能证明什么。</p></div></div><div className={styles.researchList}>{researchStudies.map(study => <article className={styles.researchItem} key={study.url}><small>{study.authors} · {study.method}</small><h3>{study.title}</h3><p>{study.finding}</p><p>边界：{study.limit}</p><a href={study.url} target="_blank" rel="noopener noreferrer">查看论文记录 ↗</a></article>)}</div><p className={styles.caution}>这些研究大多基于群体和特定文化样本。它们用于校准提问和建议，不是对你或对方的诊断，也不保证某条回复的效果。</p></section>
    <section className={styles.domains} aria-label="关系知识覆盖领域"><h2>用八个视角，看清关系的每一步。</h2><div>{knowledgeDomains.map((domain,index)=><span key={domain}><b>{String(index+1).padStart(2,"0")}</b>{domain}</span>)}</div></section>
    <section className={styles.uses} aria-label="资料如何帮助你"><article><BookOpen size={23} /><h2>看清发生了什么</h2><p>结合依恋、沟通与关系投入的视角，区分看得见的行为和仍需核对的解释。</p></article><article><MessageCircle size={23} /><h2>知道这句话怎么说</h2><p>根据你的目标和说话习惯给回复备选，说明适用条件，也准备好不同反馈下的下一步。</p></article><article><Waypoints size={23} /><h2>决定往哪走一步</h2><p>把推进、协商、观察或退出落到具体行动；新情况出现时，带回来继续判断。</p></article></section>
    <section className={styles.section}><div className={styles.sectionHead}><div><h2>参考体系中的代表书目</h2><p>原项目标注整理了 {knowledgeOrigin.referenceCount} 条参考来源，包含书籍、论文、法律、安全资料与公开课程；不是 {knowledgeOrigin.referenceCount} 本书。</p></div><a href={knowledgeOrigin.url} target="_blank" rel="noopener noreferrer">查看来源说明 ↗</a></div><div className={styles.books}>{representativeBooks.map((book) => <article key={book.title}><span>参考书目</span><h3>{book.title}</h3>{book.original && <small>{book.original}</small>}<p className={styles.author}>{book.author}</p><p>{book.use}</p></article>)}</div><div className={styles.indexed}><h3>书目索引还包括</h3><div>{indexedBooks.map(title=><span key={title}>{title}</span>)}</div></div><p className={styles.footnote}>这些名称来自库内书目索引。本站使用主题整理与方法参考；未收录这些书的完整原文，作者与机构未为产品背书。<a href={knowledgeOrigin.indexUrl} target="_blank" rel="noopener noreferrer">查看书目索引 ↗</a></p></section>
    <details className={styles.method}><summary>这些数字怎样统计？资料怎样参与回答？</summary><p>当前统计包含 1 份核心规则和 {library.referenceDocuments} 份参考文件，共 {library.hanCharacters.toLocaleString("zh-CN")} 个汉字。按文件内实际汉字统计，包含标题，不把字节、链接、英文字符或书目所指原著的篇幅算作汉字，也不包含用户聊天。</p><p>每次分析提供核心规则，再按问题选取通常 1–3 份相关参考。完整目录可参与选取；并非每次将全部资料塞入回答。回答下方可查看该次实际提供给模型的方法资料。</p><p>资料体量说明内容覆盖，不代表结论一定正确。库内同时包含研究导读、理论框架和经验表达指南，具体判断仍需结合真实行为。</p></details>
    {[{ key: "knowledge", title: "关系知识与研究导读", note: "亲密关系、情绪、冲突、婚姻、分手与边界" }, { key: "practical", title: "实用沟通与行动指南", note: "接话、邀约、修复、拒绝、投入判断与后续应对" }].map((group) => <section className={styles.section} key={group.key}><div className={styles.sectionHead}><div><h2>{group.title}</h2><p>{group.note}</p></div><span>{library.documents.filter((document) => document.category === group.key).length} 份</span></div><div className={styles.catalog}>{library.documents.filter((document) => document.category === group.key).map((document, index) => <article key={document.id} id={document.anchor}><span className={styles.index}>{String(index + 1).padStart(2, "0")}</span><div><h3>{document.label}</h3><p>{document.title}</p><small>{document.hanCharacters.toLocaleString("zh-CN")} 个汉字</small></div></article>)}</div></section>)}
    <section className={styles.origin}><h2>资料从哪里来</h2><p>本产品整理公开研究、书目与开源方法，形成自己的关系判断与行动流程。开源组件的许可和来源在项目随附文件中保留。</p><p>库内书目索引涉及米勒《亲密关系》、成人依恋研究、伴侣沟通、关系哲学等来源。这里收录的是主题整理与索引，不代表收录这些书的完整原文，也不代表作者或机构为本产品背书。</p><Link className={ui.primary} href="/">带着我的问题试一试 →</Link></section>
  </div></main>;
}

