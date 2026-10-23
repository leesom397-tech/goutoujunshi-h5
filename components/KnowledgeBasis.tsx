import type { KnowledgeSource } from "@/lib/knowledge-public";

export function KnowledgeBasis({ sources }: { sources?: KnowledgeSource[] }) {
  if (!sources?.length) return null;
  return <details className="knowledge-basis"><summary>本次参考了 {sources.length} 份方法资料</summary><p>这些资料提供分析方法；对你们关系的判断，仍以你提供的经历和原话为依据。</p><div>{sources.map((source) => <a key={source.anchor} href={"/library#" + source.anchor} target="_blank" rel="noopener noreferrer">{source.label} ↗</a>)}</div></details>;
}
