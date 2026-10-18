"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowRight,History} from "lucide-react";
import type {ReportVersionChanges} from "@/lib/report-version-changes";
import {api,message,WebError,type Json} from "./client";
import {CaptureEvidence} from "./CaptureEvidence";
import styles from "./ReportChanges.module.css";
function useProgress(report:Json,owner:string){
 const subjectId=String(report.subjectId||""),reportId=String(report.reportId||report.id||"");
 const [state,setState]=useState<Json|null>(null),[error,setError]=useState(""),generation=useRef(0);
 useEffect(()=>{const ticket=++generation.current,controller=new AbortController();setState(null);setError("");
 if(!owner||!subjectId||report.targetSelf)return()=>controller.abort();
 void(async()=>{try{const identity=await api("/api/account/credits",undefined,controller.signal);if(identity.account?.userId!==owner)return;
 const data=await api("/api/web/relationship-feedback?subjectId="+encodeURIComponent(subjectId)+"&reportId="+encodeURIComponent(reportId),undefined,controller.signal);
 if(ticket!==generation.current||controller.signal.aborted)return;if(data.subjectId!==subjectId)throw Error("人物信息已变化，请重新打开报告。");setState(data);
 }catch(e){if(!controller.signal.aborted&&ticket===generation.current&&!(e instanceof WebError&&[401,403,404].includes(e.status)))setError(message(e));}})();
 return()=>{controller.abort();generation.current++;};},[owner,subjectId,reportId,report.targetSelf]);
 return {state,setState,error,subjectId,reportId};
}
export function ReportFollowUp({report,owner}:{report:Json;owner?:string}){
 const {state,error}=useProgress(report,owner||""),change=state?.versionChanges as ReportVersionChanges|undefined;
 if(!change?.previousId)return error?<p className="wa-muted">前次依据暂未取回，不影响阅读当前报告。</p>:null;
 return <section className={styles.changes} data-report-update={change.items.length?"changed":"limited"} aria-label="本次新增与变化"><header><h2><History size={18}/>和前次相比</h2><a href={"/report?id="+encodeURIComponent(change.previousId)}>前次报告<ArrowRight size={14}/></a></header>
 {change.items.length>0?<><ul>{change.items.map((item,index)=><li key={index}><span>{item.title}</span>{item.detail}</li>)}</ul><details><summary>{change.actionChange ? "下一步建议有调整 · 查看前后依据" : "查看依据与前后判断"}</summary>{change.items.flatMap(item=>item.sources).map((source,n)=><blockquote key={n}>{source.quote}{source.reportId !== (report.reportId || report.id) ? <a href={"/report?id="+encodeURIComponent(source.reportId)}>查看前次原话<ArrowRight size={14}/></a> : <CaptureEvidence sourceIds={source.sourceId?[source.sourceId]:undefined} libraryId={source.libraryId} quote={source.quote} label={source.basis==="visual"?"查看图片依据":"回看原话"}/>}</blockquote>)}<p>{change.note}</p>{change.actionChange && <div className={styles.summaries}><div><strong>本次建议</strong><p>{change.actionChange.after}</p></div><div><strong>前次建议</strong><p>{change.actionChange.before}</p></div>{change.actionChange.sources.filter(source=>!change.items.flatMap(item=>item.sources).some(shown=>shown.quote===source.quote)).map((source,n)=><blockquote key={"action-"+n}>{source.quote}<CaptureEvidence sourceIds={source.sourceId?[source.sourceId]:undefined} libraryId={source.libraryId} quote={source.quote} label="回看建议依据"/></blockquote>)}</div>}{change.currentSummary&&change.previousSummary&&change.items.some(item=>item.kind==="revised")&&<div className={styles.summaries}><div><strong>本次判断</strong><p>{change.currentSummary}</p></div><div><strong>前次判断</strong><p>{change.previousSummary}</p></div></div>}<p><a href={"/archive?subjectId="+encodeURIComponent(report.subjectId)+"&section=trend"}>查看完整关系历程<ArrowRight size={14}/></a></p></details></>:<p>{change.note}</p>}</section>;
}
export function ReportActionFeedback({report,owner}:{report:Json;owner?:string}){
 const {state,setState,error,subjectId,reportId}=useProgress(report,owner||"");
 const [outcome,setOutcome]=useState(""),[note,setNote]=useState(""),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[failure,setFailure]=useState("");
 const pending=useRef<{key:string;id:string}|null>(null),scope=useRef(owner+":"+subjectId+":"+reportId);scope.current=owner+":"+subjectId+":"+reportId;
 const card=state?.currentFeedback,latest=card?.latest;
 useEffect(()=>{setOutcome(latest?.outcome||"");setNote(latest?.note||"");setEditing(false);setFailure("");pending.current=null;},[latest?.id,owner,subjectId,reportId]);
 if(!owner||report.targetSelf||!subjectId||!state||!card)return null;
 async function save(){
 if(!outcome||busy)return;const current=scope.current;setBusy(true);setFailure("");setNotice("");
 const body={subjectId,reportId,outcome,note:note.trim(),eventDate:"",confirmed:true},key=JSON.stringify(body);if(pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()};
 try{const identity=await api("/api/account/credits");if(scope.current!==current||identity.account?.userId!==owner)throw Error("登录账号已变化，请重新打开报告。");
 const result=await api("/api/web/relationship-feedback",{...body,id:pending.current!.id});if(scope.current!==current)return;
 setState({...state,currentFeedback:{...card,latest:result.feedback}});setNotice("已保存；下次分析会参考你这次补充。");setEditing(false);pending.current=null;
 }catch(e){if(scope.current===current)setFailure(message(e));}finally{if(scope.current===current)setBusy(false);}
 }
 const choices=[["waiting","试过了"],["not_done","还没做"],["changed","情况变了"]];
 return <section className={styles.feedback} aria-label="行动反馈"><h2>后来怎么样了？</h2>{latest&&!editing?<><p>{choices.find(([value])=>value===latest.outcome)?.[1]||card.outcomeLabel||"已有反馈"}{latest.note?" · "+latest.note:""}</p><button type="button" onClick={()=>setEditing(true)}>补充或纠正</button></>:<><div className={styles.choices}>{choices.map(([value,label])=><button type="button" key={value} aria-pressed={outcome===value} disabled={busy} onClick={()=>{setOutcome(value);pending.current=null;}}>{label}</button>)}</div>{outcome&&<><label>补一句实际发生的事（可选）<textarea aria-label="行动反馈补充" maxLength={500} value={note} disabled={busy} onChange={event=>{setNote(event.target.value);pending.current=null;}} placeholder="例如：约了周末见面，具体时间还没定"/></label><button type="button" disabled={busy} onClick={()=>void save()}>{busy?"保存中…":latest?"保存纠正":"保存反馈"}</button><p><small>保存到当前人物；作为你的经历补充，下次判断优先参考最新纠正。</small></p></>}</>}{notice&&<p role="status">{notice}</p>}{(failure||error)&&<p role="alert">{failure||error}</p>}</section>;
}
