"use client";
import { ArrowRight, HeartHandshake, ShieldAlert } from "lucide-react";
import { RelationshipSnapshot } from "./RelationshipJourney";
import type { ArchiveState, Person } from "@/app/archive/types";
import styles from "@/app/archive/archive.module.css";
type Section = "overview" | "profile" | "evidence" | "trend";
export function PersonOverview({ person, signal, onSection }: { person:Person; signal?:ArchiveState["signals"][number]; recent?:ArchiveState["trends"][number]["points"][number]; onSection:(section:Section)=>void }) {
 const saved=person.savedAnalysis,savedChat=person.savedChatAnalysis,diagnosis=savedChat?.diagnosis;
 const current= savedChat&&(!signal||savedChat.createdAt>signal.updatedAt)?undefined:signal;
 const reading=person.communicationReading||saved?.reading,moments=person.momentsReport||saved?.moments;
 const judgment=diagnosis?.relationship?.currentState||current?.summary||savedChat?.summary||saved?.summary||reading?.summary||moments?.summary;
 const next=diagnosis?.decision?.recommendation||current?.nextStep||moments?.approach?.attitude||reading?.approach?.attitude;
 const risk=moments?.riskReview?.signals?.[0];
 return <section className={`${styles.card} ${styles.overviewLead}`} aria-label="人物关系概览">
  <div className={styles.sectionHead}><h2><HeartHandshake size={21}/>现在的关系</h2>{(savedChat||saved||current)&&<button className={styles.link} onClick={()=>onSection("evidence")}>查看完整报告<ArrowRight size={15}/></button>}</div>
  <div className={styles.overviewVisual}><div><p className={styles.overviewJudgement}>{judgment||"还没有形成关系判断。导入材料后，可以生成一份完整报告。"}</p>{next&&<div className={styles.overviewNext}><ArrowRight size={18}/><div><strong>下一步</strong><p>{next}</p></div></div>}</div><RelationshipSnapshot activity={person.relationshipContext?.activity} friend={person.label}/></div>
  {risk&&<div className={styles.overviewRiskLine}><ShieldAlert size={18}/><span>{risk.title}</span><button className={styles.link} onClick={()=>onSection("evidence")}>核对依据</button></div>}
  <div className={styles.overviewFoot}><small>{person.relationshipContext?.coverage.activityStatus==="current"?"互动统计已按当前关联的全部聊天更新。":"判断来自已保存材料，补充记录后可继续更新。"}</small><button className={styles.link} onClick={()=>onSection("trend")}>沿着日期看发生了什么<ArrowRight size={15}/></button></div>
 </section>;
}
