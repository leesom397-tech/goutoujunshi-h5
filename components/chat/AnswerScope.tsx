import { BookOpen } from "lucide-react";
import { personAnalysisHref } from "@/lib/person-analysis-navigation";
type Coverage = { total?: number; readable?: number; semanticStatus?: string; analyzedText?: number };
export function AnswerScope({ coverage, status, subjectId }: { coverage?: Coverage; status?: string; subjectId?: string }) {
  if (!coverage?.total && (!status || status === "none")) return null;
  return <details className="chat-answer-scope"><summary><BookOpen size={15}/>{coverage?.total ? `参考资料库 ${coverage.total.toLocaleString("zh-CN")} 条聊天` : status === "paused" ? "本次未使用已暂停的档案" : "本次未读到已同步聊天"}</summary>
    {coverage?.total ? <p>{coverage.semanticStatus === "complete" ? "已结合完整聊天统计、已保存的全量解读，以及与本题相关的原话。" : "已结合完整聊天统计与相关原话；全量语义解读尚未完成。"}可读文字与语音转写 {coverage.readable || 0} 条。</p> : <p>本次回答基于当前问题及可用资料；可以先核对导入或档案状态。</p>}
    {subjectId && <a href={personAnalysisHref(subjectId)}>核对材料与完整报告 →</a>}
  </details>;
}
