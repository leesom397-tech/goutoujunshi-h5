import { BookOpen } from "lucide-react";
import { personAnalysisHref } from "@/lib/person-analysis-navigation";
type Coverage = { total?: number; readable?: number; semanticStatus?: string; analyzedText?: number };
export type PeopleCoverage = {
  scope: 'all'; status: 'ready'|'empty'|'disabled'|'paused'|'too-large'|'changed'; total: number; included: number; omitted: number;
  subjects: {id:string;label:string;status:'details'|'summary'|'empty';reportCount:number;memoryCount:number;chatCount:number}[];
  sources: {id:string;subjectId:string;label:string;kind:string;sourceId:string;reportId?:string;libraryId?:string;at?:string}[];
  limitations: string[];
};
const amount=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.floor(value)):0;
const unavailable:Partial<Record<PeopleCoverage['status'],string>>={empty:'还没有可用于整体咨询的人物资料',disabled:'人物资料授权尚未开启',paused:'人物资料使用已暂停','too-large':'现有资料超过本次整体咨询范围',changed:'人物资料已变化，需要重新核对'};
const sourceKinds:Record<string,string>={profile:'人物档案',report:'已保存报告',memory:'聊天记忆',chat:'相关聊天',fact:'已确认资料','self-profile':'我的档案','subject-profile':'人物档案','report-summary':'报告摘要','chat-memory':'聊天记忆','chat-excerpt':'聊天摘录'};
export function AnswerScope({ coverage, status, subjectId, peopleCoverage }: { coverage?: Coverage; status?: string; subjectId?: string; peopleCoverage?: PeopleCoverage }) {
  if(peopleCoverage?.scope==='all'){
    const ready=peopleCoverage.status==='ready',subjects=Array.isArray(peopleCoverage.subjects)?peopleCoverage.subjects:[],sources=Array.isArray(peopleCoverage.sources)?peopleCoverage.sources:[],limitations=Array.isArray(peopleCoverage.limitations)?peopleCoverage.limitations:[];
    return <details className="chat-answer-scope chat-people-coverage" data-people-coverage={peopleCoverage.status} open={!ready}><summary><BookOpen size={15}/>{ready?`本次参考 ${amount(peopleCoverage.included)} / ${amount(peopleCoverage.total)} 位人物`:(unavailable[peopleCoverage.status]||'本次未确认人物资料范围')}</summary>
      <p>{ready?'使用已保存的档案、报告和聊天记忆中的相关内容。资料条数是当前可用范围，不代表全部原文都进入了本次回答。':'本次未完成整体分析，未扣咨询积分。可以整理或恢复资料后重试，也可以选择单人咨询或只聊当前问题。'}</p>
      {amount(peopleCoverage.omitted)>0&&<p>本次未包含 {amount(peopleCoverage.omitted)} 位人物。</p>}
      {subjects.length>0&&<ul className="chat-coverage-people">{subjects.map(person=><li key={person.id}><strong>{person.label}</strong><span>{person.status==='details'?'相关详情':person.status==='summary'?'摘要':'暂无可用资料'} · 已存报告 {amount(person.reportCount)} 份 · 记忆 {amount(person.memoryCount)} 条 · 聊天 {amount(person.chatCount)} 条</span></li>)}</ul>}
      {sources.length>0&&<details className="chat-coverage-sources"><summary>查看本次选取的 {sources.length} 项资料</summary><ul>{sources.map((source,index)=><li key={source.id||index}><strong>{source.label}</strong><span>{sourceKinds[source.kind]||'已授权资料'}{source.at?` · ${source.at}`:''}</span></li>)}</ul></details>}
      {limitations.length>0&&<ul className="chat-coverage-limitations">{limitations.map((limit,index)=><li key={index}>{limit}</li>)}</ul>}
    </details>;
  }
  if (!coverage?.total && (!status || status === "none")) return null;
  return <details className="chat-answer-scope"><summary><BookOpen size={15}/>{coverage?.total ? `参考资料库 ${coverage.total.toLocaleString("zh-CN")} 条聊天` : status === "paused" ? "本次未使用已暂停的档案" : "本次未读到已同步聊天"}</summary>
    {coverage?.total ? <p>{coverage.semanticStatus === "complete" ? "已结合完整聊天统计、已保存的全量解读，以及与本题相关的原话。" : "已结合完整聊天统计与相关原话；全量语义解读尚未完成。"}可读文字与语音转写 {coverage.readable || 0} 条。</p> : <p>本次回答基于当前问题及可用资料；可以先核对导入或档案状态。</p>}
    {subjectId && <a href={personAnalysisHref(subjectId)}>核对材料与完整报告 →</a>}
  </details>;
}
