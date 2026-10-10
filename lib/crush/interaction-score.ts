import type {CrushResult} from "./types";

// A visible-exchange heuristic, used only when the six-dimension score has no value.
// It is deliberately bounded and must always be labelled as a rough estimate.
export function interactionScore(result:CrushResult){
  const preview=result.affinity||result.decision?.affinityPreview;
  if(typeof preview?.value==="number"&&Number.isFinite(preview.value))return {value:Math.round(preview.value),estimated:false};
  const annotations=new Map(result.annotations.map(item=>[item.lineId,item]));
  const counts={questions:0,replies:0,invites:0,boundaries:0};
  for(const line of result.lines){
    const annotation=annotations.get(line.id);
    const visibleQuestion=line.speaker==="other"&&/[？?]/.test(line.text);
    if(visibleQuestion)counts.questions++;
    if(!annotation||annotation.evidence==="insufficient")continue;
    const key=annotation.intent[0]?.key;
    if(line.speaker==="other"&&!visibleQuestion&&["ask","clarify"].includes(key))counts.questions++;
    if(line.speaker==="self"&&["answer","agree","acknowledge","continue"].includes(key))counts.replies++;
    if(line.speaker==="other"&&["invite","invite_hint"].includes(key))counts.invites++;
    if(line.speaker==="other"&&["refuse","boundary"].includes(key))counts.boundaries++;
  }
  const value=Math.max(20,Math.min(80,Math.round((50+Math.min(counts.questions,3)*5+Math.min(counts.replies,3)*5+Math.min(counts.invites,2)*8-Math.min(counts.boundaries,2)*15)/5)*5));
  return {value,estimated:true};
}
