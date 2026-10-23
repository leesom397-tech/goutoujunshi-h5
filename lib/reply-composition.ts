/** Shared parsing only: do not import generation prompts or bundled skills here. */
export function replyVoiceSamples(rows: readonly {senderRole?:string;basis?:string;sourceKind?:string;text?:string}[]) {
  return rows.filter(row=>row.senderRole==="self"&&!row.basis&&row.sourceKind!=="moments"&&typeof row.text==="string"&&row.text.trim())
    .slice(-4).map(row=>row.text!.trim().slice(0,60));
}

/** Accept useful one/two-option results as well as three; labels describe the
 * actual choice instead of forcing a boundary-setting message into every chat. */
export function normalizeReplyChoices(input:unknown) {
  const seen=new Set<string>();
  return (Array.isArray(input)?input:[]).flatMap((value:unknown)=>{
    if(!value||typeof value!=="object")return [];
    const row=value as Record<string,unknown>,clean=(value:unknown,max:number)=>typeof value==="string"?value.trim().slice(0,max):"";
    const text=clean(row.text,240),when=clean(row.when,150)||clean(row.reason,150),label=clean(row.label,12)||clean(row.style,12);
    const key=text.replace(/[\s\p{P}]/gu,"");
    if(!text||!when||!key||seen.has(key)||/\[(?:图片|链接|地点|时间|姓名|具体)[^\]]*\]|【(?:图片|链接|地点|时间|姓名)[^】]*】/.test(text))return [];
    seen.add(key);return [{label,text,when,next:row.next}];
  }).slice(0,3).map((row,index)=>({...row,label:row.label||`回法${index+1}`}));
}

/** Reject unfinished copy placeholders; never turn them into a sendable reply. */
export function usableGuidanceReply(value:string){
  return !!value.trim()&&!/\[[^\]]*\]|【(?:图片|链接|地点|时间|姓名)[^】]*】|(?:^|[^a-z])xx(?:[^a-z]|$)|你(?:之前|上次).{0,4}说的[.\u2026]{2,}|(?:替换|填入|填上).{0,6}(?:地点|时间|名字|内容)/i.test(value);
}
