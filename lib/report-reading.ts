type Row=Record<string,any>;
const text=(v:unknown)=>typeof v==="string"?v.trim():"";
const rows=(v:unknown):Row[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==="object"):[];
const normalized=(v:string)=>v.replace(/[\s\p{P}\p{S}]/gu,"");
const quoted=(v:string)=>Array.from(v.matchAll(/[“「『"‘']([^”」』"’']{3,700})[”」』"’']/g)).map(x=>x[1]);
const fullDate=(v:unknown)=>text(v).match(/\b20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?(?:[T\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/)?.[0]||"";
export type MaterialEvidence={quote:string;label:string;date?:string};
function material(report:Row):MaterialEvidence[]{
 const lines=rows(report.lines);
 if(lines.length)return lines.flatMap((line,index)=>line.speaker==="other"&&(!line.kind||line.kind==="text")&&text(line.text)&&!/^(?:【|\[|（|\()?(?:表情包|贴纸|动图|图片|照片|语音)/.test(text(line.text))?[{quote:text(line.text),label:"对方第 "+(index+1)+" 句",date:fullDate(line.at||line.time||line.timestamp||line.date)}]:[]);
 return [...rows(report.profileBasics).map(row=>({quote:text(row.value),label:text(row.evidence),date:""})),...rows(report.profileContext).map(row=>({quote:text(row.value),label:text(row.evidence),date:""})),...rows(report.moments?.posts).map((row,index)=>({quote:text(row.content),label:text(row.evidence)||"动态 "+(index+1),date:fullDate(row.date)})),...rows(report.visibleFacts).flatMap(row=>quoted(text(row.evidence)).map(quote=>({quote,label:text(row.evidence),date:fullDate(row.date)})))].filter(row=>row.quote&&row.label);
}
/** Distinct retained excerpts, never a frequency estimate of real-life events. */
export function riskEvidenceOccurrences(report:Row,evidence:string):{count:number;items:MaterialEvidence[];dates:string[]}{
 if(report.targetSelf||report.target==="self"||report.moments?.targetSelf)return {count:0,items:[],dates:[]};
 const fragments=quoted(evidence).map(normalized).filter(q=>q.length>=4),whole=normalized(evidence);
 const found=material(report).filter(row=>{const value=normalized(row.quote);return value.length>=4&&(fragments.some(q=>value.includes(q)||q.includes(value))||whole.includes(value));});
 // Duplicate crops can have different image/line IDs. With no date/time,
 // identical text cannot establish a second occurrence.
 const unique:MaterialEvidence[]=[];
 for(const row of [...found].sort((a,b)=>Number(!!b.date)-Number(!!a.date))){const value=normalized(row.quote);if(!unique.some(other=>{const previous=normalized(other.quote),sameExcerpt=previous===value||(Math.min(previous.length,value.length)>=4&&(previous.includes(value)||value.includes(previous)));return sameExcerpt&&(!other.date||!row.date||other.date===row.date);}))unique.push(row);}
 return {count:unique.length,items:unique,dates:[...new Set(unique.map(row=>row.date||"").filter(Boolean))]};
}
export type KeyReportEvidence={text:string;label:string};
export function keyReportEvidence(report:Row,priorityEvidence?:string):KeyReportEvidence[]{
 const source=report.moments||report,items:KeyReportEvidence[]=[],lines=rows(report.lines);
 function add(value:unknown,label:string){
  const v=text(value);if(!v)return;
  const matched=quoted(v).flatMap(q=>{const line=lines.find(l=>normalized(text(l.text)).includes(normalized(q)));return line?[{text:q,label:(line.speaker==="self"?"我":line.speaker==="other"?"对方":"原话")+" · 第 "+(lines.indexOf(line)+1)+" 句"}]:[];});
  for(const item of matched.length?matched:[{text:v,label}])if(!items.some(old=>{const a=normalized(old.text),b=normalized(item.text);return a===b||(Math.min(a.length,b.length)>10&&(a.includes(b)||b.includes(a)));}))items.push(item);
 }
 if(priorityEvidence)add(priorityEvidence,"优先核对的原话");
 add(report.decision?.evidence,"本轮判断依据");
 for(const row of [...rows(report.decision?.evidencePoints),...rows(report.decision?.keyEvidence),...rows(source.hypotheses),...rows(report.visibleFacts),...rows(source.behaviorClues)])add(row.evidence||row.quote,row.title||row.dimension||"材料依据");
 return items.slice(0,3);
}
export type ReplyContrast={index:number;features:string[];difference:string};
/** Compare actual saved candidates, without manufacturing three variants. */
export function replyContrasts(options:Row[]):ReplyContrast[]{
 const valid=options.map((option,index)=>({index,value:text(option.text||option.message)})).filter(row=>row.value);
 if(valid.length<2)return [];
 const lengths=valid.map(row=>Array.from(row.value.replace(/\s/g,"")).length),min=Math.min(...lengths),max=Math.max(...lengths);
 return valid.map(({index,value},n)=>{
  const gentle=/方便|如果|可以吗|愿意|要不要|不着急|没关系|你觉得|你想|好吗|好不好|有空|有时间/.test(value);
  const direct=/不会|不接受|不想|需要|希望|先确认|说清|明确|[？?]/.test(value),short=lengths[n]===min&&max-min>=8;
  const features=[...(short?["更简短"]:[]),...(gentle?["语气温和"]:[]),...(!gentle&&direct?["更直接"]:[])];
  const difference=[short?"字数更少，适合轻接一句":lengths[n]>min+20?"信息较完整，需要对方多读一点":"长度适中",gentle?"留有商量空间":direct?"把问题或边界说在明处":"延续当前话题"].join("；")+"。";
  return {index,features:features.length?features:["自然承接"],difference};
 });
}
