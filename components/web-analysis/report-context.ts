import type { Json } from "./client";

const clean=(value:unknown)=>typeof value==="string"?value.trim():"";
/** Names come from the authenticated participant contract, never from inferred prose. */
export function reportIdentity(report:Json){
 const label=clean(report.participants?.other?.label);
 const known=!!label&&!/^(?:self|other|unknown|我|自己|对方|TA|身份待确认)$/i.test(label);
 return {other:known?label:"对方",known,self:"你",direction:known?`${label}与你`:"你与对方（姓名待确认）"};
}
export function reportEvidenceSpeaker(report:Json,role:unknown,basis?:unknown){
 const who=role==="self"?"你":role==="other"?reportIdentity(report).other:"身份待确认";
 return basis==="visual"?`${who}的材料 · 图片可见内容`:`${who}${role==="self"||role==="other"?"说":""}`;
}
export function reportGoal(report:Json):"risk"|"connection"|"panorama"{
 const question=clean(report.analysisQuestion||report.relationshipDiagnosis?.question||report.question);
 if(["risk","worth"].includes(question))return "risk";
 if(["attitude","reply","next","connection","affinity"].includes(question))return "connection";
 if(question==="panorama")return "panorama";
 return report.semanticHistory?.actionPlan?.goal==="risk"?"risk":"panorama";
}
