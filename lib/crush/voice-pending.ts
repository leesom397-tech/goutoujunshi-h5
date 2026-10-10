import {CrushError} from "./types";
export type PendingVoice={id:string;number:number;text:string;expiresAt:number;role?:"self"|"other"};
export type VoiceBuffer={consentAt:number;scopeStamp:string;entries:PendingVoice[]};
export function pendingVoices(raw:string|undefined,consentAt:number,scopeStamp:string,now=Date.now()):VoiceBuffer{
  try{
    const parsed=JSON.parse(raw||"{}");
    if(parsed.consentAt!==consentAt||parsed.scopeStamp!==scopeStamp||!Array.isArray(parsed.entries))return {consentAt,scopeStamp,entries:[]};
    const entries=parsed.entries.filter((entry:PendingVoice)=>entry&&typeof entry.id==="string"&&Number.isInteger(entry.number)&&entry.number>0&&typeof entry.text==="string"&&entry.text.trim()&&entry.text.length<=1800&&entry.expiresAt>now&&(entry.role===undefined||entry.role==="self"||entry.role==="other"));
    return {consentAt,scopeStamp,entries};
  }catch{return {consentAt,scopeStamp,entries:[]};}
}
export function appendPendingVoice(buffer:VoiceBuffer,id:string,text:string,now=Date.now()){
  if(buffer.entries.some(entry=>entry.id===id))return buffer;
  if(!text.trim()||text.length>1800)throw new CrushError("这段语音较长，请用网页录音导入，核对分段文字和说话人后分析。",400);
  if(buffer.entries.length>=80||buffer.entries.reduce((sum,entry)=>sum+entry.text.length+5,0)+text.length+5>12000)throw new CrushError("待确认的语音较多，请先确认已有语音的说话人，再继续发送。",400);
  return {...buffer,entries:[...buffer.entries,{id,number:Math.max(0,...buffer.entries.map(entry=>entry.number))+1,text:text.trim(),expiresAt:now+3600000}]};
}
export function voiceRoleCommand(text:string):{role:"self"|"other";number?:number;all:boolean}|null{
  const match=text.trim().match(/^(?:(第\s*(\d{1,3})\s*条)|(全部|这些)|(这条|这句|上一条|这段|语音|这))?(?:是)?(我|对方|他|她)(?:说的|的话|的语音)[。！!]?$/u);
  if(!match)return null;
  return {role:match[5]==="我"?"self":"other",number:match[2]?Number(match[2]):undefined,all:!!match[3]};
}
export function selectPendingVoices(buffer:VoiceBuffer,command:NonNullable<ReturnType<typeof voiceRoleCommand>>){
  const entries=command.all?buffer.entries:command.number!==undefined?buffer.entries.filter(entry=>entry.number===command.number):buffer.entries.length===1?buffer.entries:[];
  if(!entries.length)throw new CrushError(buffer.entries.length>1?"有多条待确认语音。请回复「第2条是我说的」这样的编号；只有全部来自同一人时，才回复「全部是对方说的」。":"没有这条待确认语音，可能已处理、过期或切换了对象。请重新发送。",400);
  return entries;
}
export function confirmedVoicePrefix(buffer:VoiceBuffer){
  const ready:PendingVoice[]=[];
  for(const entry of buffer.entries){if(!entry.role)break;ready.push(entry);}
  return ready;
}
export function labeledVoiceText(entries:PendingVoice[],role?:"self"|"other"){
  // ASR text is material: embedded newlines/colons must not introduce another speaker.
  return entries.map(entry=>{
    const knownRole=role||entry.role;if(!knownRole)throw new CrushError("请先确认这条语音是谁说的。",400);
    return (knownRole==="self"?"我":"对方")+"："+entry.text.replace(/[\r\n]+/g," ");
  }).join("\n");
}
