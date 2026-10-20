import { Heart, MessageCircle, Send, ShieldCheck } from "lucide-react";
import { reportAffinity, validScore } from "./report-data";
import { riskAwarePresentation } from "@/lib/risk-aware-presentation";
import type { Json } from "./client";
import { reportIdentity } from "./report-context";
import styles from "./AffinityOverview.module.css";
export function AffinityOverview({ report }: { report: Json }) {
 const signal=reportAffinity(report),value=signal?.value,all:Json[]=Array.isArray(signal?.dimensions)?signal.dimensions:[];
 const dimensions=all.filter(row=>row.status!=="insufficient"&&validScore(row.value)),missing=all.filter(row=>row.status==="insufficient"||!validScore(row.value));
 const count=signal&&Number.isInteger(signal.contextCount)&&signal.contextCount>=0?signal.contextCount:null;
 const input=signal&&Number.isInteger(signal.inputCount)?signal.inputCount:(Array.isArray(report.lines)?report.lines.filter((row:Json)=>["self","other"].includes(row.speaker)&&typeof row.text==="string"&&row.text.trim()&&!/^\s*[\[【](?:图片|语音|视频|表情)/.test(row.text)).length:null);
 const partial=count!==null&&input!==null&&count<input,risk=riskAwarePresentation(report),boundary=signal?.boundaryApplied||risk.mode!=="normal";
 const reason=risk.priority?.evidence||report.decision?.evidence||report.decision?.observation,known=validScore(value),identity=reportIdentity(report);
 function selectTab(button:HTMLButtonElement,tab:string){button.closest("[data-report-reader]")?.querySelector<HTMLButtonElement>('[role="tab"][aria-controls$="-panel-'+tab+'"]')?.click();}
 return <section className={styles.panel} aria-label="好感探测器" data-affinity-overview>
 <div className={styles.reading}><span className={styles.eyebrow}><Heart size={19}/>好感探测器</span><h2>{boundary?risk.title||"先尊重已表达的边界":`${identity.other}对你的互动信号`}</h2>{reason&&<p>{reason}</p>}{boundary&&<p className={styles.boundary}><ShieldCheck size={18}/>{risk.mode!=="normal"?risk.nextStep:"参考值不能抵消明确拒绝；先尊重对方当前表达的边界。"}</p>}<p className={styles.scope} data-affinity-scope>{count===null?"这份旧报告未记录信号评估条数，范围暂不能核对。":count===0?"本次未计算信号参考值。":"信号评估实际读取 "+count+" 条"+(partial?"，本次可读原文共 "+input+" 条；这份旧结果仅覆盖局部。":"本次上传的可读原文。")}</p>{signal?.unavailableReason&&<p>{signal.unavailableReason}</p>}</div>
 <div className={styles.details}><div className={styles.score} data-affinity-score><span>互动信号参考</span><strong>{known?Math.round(value):"待判断"}{known&&<small>/ 100</small>}</strong><p>不代表喜欢你的概率</p></div>{all.length>0&&<div className={styles.dimensionGroup}><h3>互动维度 <small>可判断 {dimensions.length} / {all.length} 项</small></h3><div className={styles.dimensions} aria-label={`${identity.other}对你的互动维度`}>{all.map(row=>{const available=row.status!=="insufficient"&&validScore(row.value);return <div key={row.key||row.label} data-affinity-dimension={row.key||row.label} data-known={available}><span>{row.label}</span><i aria-hidden="true">{available&&<b style={{width:row.value+"%"}}/>}</i><strong>{available?Math.round(row.value):"待判断"}</strong></div>})}</div></div>}{missing.length>0&&<p className={styles.unknowns}>待判断的维度没有足够依据，不计为 0 分。</p>}{signal?.valueScope==="partial"&&<p className={styles.unknowns}>只汇总有依据的维度，不能与完整维度的旧分数直接比较。</p>}</div>
 <nav aria-label="继续解读本次聊天"><button type="button" onClick={event=>selectTab(event.currentTarget,"change")}><MessageCircle size={18}/>逐句意图</button><button type="button" onClick={event=>selectTab(event.currentTarget,"next")}><Send size={18}/>怎么回</button></nav></section>;
}
