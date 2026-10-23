import { BookOpen, ArrowUpRight } from "lucide-react";
import { knowledgeManifest, knowledgeVolume } from "@/lib/knowledge-public";
import { knowledgeOrigin, knowledgeDomains, researchStudies } from "@/lib/knowledge-origins";

export function KnowledgeProof() {
  return <a className="knowledge-proof" href="/library#research" aria-label="查看 成子 的研究来源、资料规模与适用边界">
    <div className="knowledge-proof-heading"><span><BookOpen size={17} /> 成子 · 关系知识体系</span><ArrowUpRight size={17} /></div>
    <strong className="knowledge-proof-title">有研究依据，也讲清每项结论的边界。</strong>
    <div className="knowledge-proof-stats"><div><strong>{knowledgeOrigin.referenceCount}<span> 条</span></strong><span>书籍、研究及官方资料来源线索</span></div><div><strong>{knowledgeManifest.referenceDocuments}<span> 份</span></strong><span>实际接入的专题整理</span></div><div><strong>约 {knowledgeVolume}<span> 万</span></strong><span>实际提炼汉字，非原文全文</span></div></div>
    <div className="knowledge-proof-domains">{knowledgeDomains.slice(0,6).map(domain=><span key={domain}>{domain}</span>)}</div>
    <small className="knowledge-bookline">已列出 {researchStudies.length} 篇可核对的代表研究，逐项注明研究方法与适用边界；包括 {researchStudies[0].authors} 汇总的 43 项伴侣纵向研究。</small>
    <span className="knowledge-proof-link">按问题选用相关资料，结合你的原话给建议 <span>查看论文与完整体系 →</span></span>
  </a>;
}
