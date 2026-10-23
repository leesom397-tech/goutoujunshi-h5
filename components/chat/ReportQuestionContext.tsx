import { ChevronRight, FileText } from 'lucide-react';
type Row = Record<string, any>;
function date(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : value.slice(0,50);
}
export function ReportQuestionContext({context, disabled, onPrompt}:{context:Row;disabled:boolean;onPrompt:(value:string)=>void}) {
  const quotes = Array.isArray(context.originalQuotes) ? context.originalQuotes : [];
  return <details className="chat-report-context"><summary><FileText size={17}/><span>查看带入的报告与原话</span><ChevronRight size={16}/></summary><div className="chat-context-details"><strong>{context.title || '报告追问'}</strong>
    <p className="chat-context-dates">{context.generatedAt && <>报告生成：{date(context.generatedAt)}（北京时间）<br/></>}{context.guidanceUpdatedAt && <>建议更新：{date(context.guidanceUpdatedAt)}（北京时间）</>}</p>
    <details><summary>当前建议与推测</summary><p>{context.summary}</p></details>
    <details><summary>所用原话 · {quotes.length} 条</summary>{quotes.length ? quotes.map((row:Row,index:number)=><blockquote key={index}><small>{row.speaker==='self'?'我':'对方'} · {row.sourceKind==='moments'?'朋友圈':'聊天'}{row.at?' · '+date(row.at):' · 时间未记录'}</small><p>{row.text}</p></blockquote>):<p>这份摘要没有附可核对原话；不能把摘要当作原文。</p>}</details>
    <div className="chat-followup-prompts">{[
      ['现在怎么回','结合这份报告的当前建议，我现在该怎么自然地回复？请给 2–3 个可以调整后使用的回法，说明各自适用条件；需要暂停时不要强行推进。'],
      ['下一步观察什么','结合这份报告的当前建议，接下来最值得观察的具体行为是什么？什么结果会改变当前判断？'],
      ['还有哪些可能','这份报告里哪些是材料事实，哪些是推测？还有什么合理解释，以及我该如何核实？'],
      ['有哪些风险','结合这个人的已保存资料，哪些具体行为需要留意？请区分原话、疑点与明确越界，并给下一步核实方式；没有证据不要给人定性。'],
    ].map(([label,value])=><button type="button" key={label} disabled={disabled} onClick={()=>onPrompt(value)}>{label}<ChevronRight size={14}/></button>)}</div>
  </div></details>;
}
