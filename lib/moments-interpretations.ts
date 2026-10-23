import type { SemanticHistoryFinding } from "./capture-semantic-history";

export const MOMENTS_INTERPRETATION_DIMENSIONS=["生活与工作","自我呈现","反复主题","图文对照","聊天对照"] as const;
export type MomentsInterpretation={dimension:typeof MOMENTS_INTERPRETATION_DIMENSIONS[number];reading:string;evidenceIds:string[];alternative:string;nextStep:string;basis?:"generated"|"saved-finding"};
const object=(value:unknown):Record<string,any>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,any>:{};
const text=(value:unknown,max=500)=>typeof value==="string"?value.trim().slice(0,max):"";
const list=(value:unknown):any[]=>Array.isArray(value)?value:[];

/** Optional extra readings cannot introduce a new evidence source or turn a
 * single photo into a repeated pattern, a job claim, or a chat comparison. */
export function validatedMomentsInterpretations(input:unknown,findings:readonly SemanticHistoryFinding[]):MomentsInterpretation[]{
  const byId=new Map(findings.map(item=>[item.id,item]));
  return list(input).flatMap(value=>{
    const row=object(value),dimension=row.dimension,reading=text(row.reading),alternative=text(row.alternative,300);
    const evidenceIds=list(row.evidenceIds);
    if(!MOMENTS_INTERPRETATION_DIMENSIONS.includes(dimension)||!reading||!evidenceIds.length||evidenceIds.some(id=>typeof id!=="string"||!byId.has(id)))return [];
    const evidence=evidenceIds.flatMap(id=>byId.get(id)!.evidence),moments=evidence.filter(source=>source.sourceKind==="moments");
    if(!moments.length)return [];
    if(dimension==="生活与工作"&&!evidence.some(source=>source.basis!=="visual"))return [];
    if(dimension==="反复主题"&&new Set(moments.map(source=>JSON.stringify([source.libraryId,source.sourceId]))).size<2)return [];
    if(dimension==="图文对照"&&!(moments.some(source=>source.basis==="caption")&&moments.some(source=>source.basis==="visual")))return [];
    if(dimension==="聊天对照"&&!evidence.some(source=>!source.basis&&(source.sourceKind==="chat"||!source.sourceKind)))return [];
    return [{dimension,reading,evidenceIds:[...new Set(evidenceIds as string[])].slice(0,8),alternative,nextStep:text(row.nextStep,300),basis:"generated" as const}];
  }).filter((item,index,all)=>all.findIndex(other=>other.reading===item.reading)===index).slice(0,6);
}

/** Existing reports gain a clearer view of their already saved findings. This
 * does not invent a new model interpretation or charge/regenerate the report. */
export function projectMomentsInterpretations(input:unknown):MomentsInterpretation[]{
  const semantic=object(input),findings=list(semantic.findings).filter(item=>text(item?.id)&&text(item?.claim)&&Array.isArray(item?.evidence)&&item.evidence.length) as SemanticHistoryFinding[];
  const saved=validatedMomentsInterpretations(object(object(semantic.sourceInsights).moments).interpretations,findings);
  if(saved.length)return saved.slice(0,5);
  const steps=list(object(semantic.actionPlan).steps);
  const candidates:MomentsInterpretation[]=findings.filter(finding=>finding.evidence.some(source=>source.sourceKind==="moments")).map(finding=>{
    const moments=finding.evidence.filter(source=>source.sourceKind==="moments"),hasChat=finding.evidence.some(source=>!source.basis&&(source.sourceKind==="chat"||!source.sourceKind));
    const dimension:MomentsInterpretation["dimension"]=hasChat?"聊天对照":/反复|多次|持续|经常|重复/.test(finding.claim)&&new Set(moments.map(source=>JSON.stringify([source.libraryId,source.sourceId]))).size>1?"反复主题":/工作|职业|项目|学习|作息|生活重心/.test(finding.claim)&&moments.some(source=>source.basis!=="visual")?"生活与工作":moments.some(source=>source.basis==="caption")&&moments.some(source=>source.basis==="visual")?"图文对照":"自我呈现";
    const action=steps.find(step=>list(step?.evidenceIds).includes(finding.id));
    return {dimension,reading:text(finding.claim),evidenceIds:[finding.id],alternative:text(finding.alternative,300),nextStep:text(action?.action,300),basis:"saved-finding"};
  });
  // Keep distinct existing topics visible; related travel/selfie descriptions
  // remain available as source findings instead of occupying every top card.
  const topic=(item:MomentsInterpretation)=>{
    const patterns:[string,RegExp][]=[["work",/工作|职业|项目|学习|作息|生活重心/],["travel",/旅行|旅游|出游|度假|酒店|目的地/],["portrait",/自拍|人像|妆容|穿搭|外貌/],["social",/朋友|聚会|社交|聚餐|同行/],["art",/审美|艺术|设计|展览|摄影|构图/],["food",/餐厅|咖啡|美食|做饭/],["space",/独处|空间|自由|自主/]];
    return patterns.find(([,pattern])=>pattern.test(item.reading))?.[0]||item.dimension;
  };
  const chosen:MomentsInterpretation[]=[];
  for(const candidate of candidates)if(!chosen.some(item=>topic(item)===topic(candidate)))chosen.push(candidate);
  return chosen.slice(0,5);
}
