import type {AutomaticRelationshipUpdate} from "./relationship-updates";
import type {RelationshipEvidenceCard} from "./relationship-evidence";
const normalize=(v:string)=>v.replace(/[\s\p{P}\p{S}]/gu,"");
/** Highlight only new material attributable to this report; old feedback isn't a new change. */
export function reportUpdateHighlights(update:AutomaticRelationshipUpdate|null|undefined,reportId:string){
 const ids=new Set([reportId,update?.current?.reportId].filter(Boolean));
 const cards:RelationshipEvidenceCard[]=[];
 for(const card of update?.evidenceReview?.cards||[]){
  const sources=card.sources.filter(source=>source.text?.trim()&&source.reportId),fresh=sources.filter(source=>ids.has(source.reportId)),past=sources.filter(source=>!ids.has(source.reportId));
  if(!fresh.length)continue;
  if(["action","consistency"].includes(card.kind)&&!past.length)continue;
  if(past.length&&card.kind!=="pattern"&&!fresh.some(source=>!past.some(old=>normalize(old.text)===normalize(source.text))))continue;
  const key=card.kind+sources.map(source=>normalize(source.text)).sort().join("|");
  if(cards.some(old=>old.kind+old.sources.map(source=>normalize(source.text)).sort().join("|")===key))continue;
  cards.push({...card,sources});
 }
 const changes=!cards.length&&update?.status==="compared"&&update.current&&update.previous?(update.changes||[]).filter(row=>Number.isFinite(row.before)&&Number.isFinite(row.after)&&row.before!==row.after).slice(0,3):[];
 const compact=update?.previous?(update.status==="overlap"?"这次与前次材料有重叠，重复内容不计为新变化。":"已结合前次材料；暂未找到足够依据确认新变化。"):"";
 return {cards:cards.slice(0,3),changes,compact,headline:cards.length?"这次新增与变化 · "+Math.min(cards.length,3)+" 条":changes.length?"这次可比较的互动变化":""};
}
