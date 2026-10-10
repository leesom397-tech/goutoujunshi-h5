import type { Incoming } from "@/lib/wechat";
import { CrushError } from "./types";
import type {SourceCoverage} from "./types";
import type {VoiceTranscript} from "@/lib/wechat-asr";
import {unavailableMedia,unreadVoiceGuidance} from "./evidence";

function itemContent(item:NonNullable<NonNullable<Incoming["merged_msg"]>["item"]>[number]){
  try{return (typeof item.msg_content==="string"?JSON.parse(item.msg_content):item.msg_content) as {voice?:{media_id?:unknown};text?:{content?:unknown}};}catch{return undefined;}
}
export function mergedVoiceCount(message:Incoming,withAudioOnly=false){
  return (message.merged_msg?.item||[]).filter(item=>{
    const content=itemContent(item),text=content?.text?.content;
    const voice=item.msgtype==="voice"||typeof text==="string"&&unavailableMedia(text)==="voice";
    return voice&&(!withAudioOnly||typeof content?.voice?.media_id==="string"&&Boolean(content.voice.media_id));
  }).length;
}

export function coverageText(c:SourceCoverage){
  const parts=["收到 "+c.total+" 条：文字 "+c.text+" 条，语音 "+c.voice+" 条（已转写 "+c.transcribed+" 条）"];
  if(c.noMedia)parts.push(c.noMedia+" 条语音未提供可下载音频");
  if(c.failedVoice)parts.push(c.failedVoice+" 条语音转写失败或超时");
  if(c.multiSpeaker)parts.push(c.multiSpeaker+" 条录音有多个声音，身份未确认，未归给发送者");
  if(c.overLimit)parts.push(c.overLimit+" 条语音超出本次转写范围，请分段发送");
  if(c.otherSkipped)parts.push(c.otherSkipped+" 条其他附件未读取");
  if(c.noMedia+c.failedVoice+c.multiSpeaker+c.overLimit+c.otherSkipped)parts.push("只分析已读文字，未读附件不算负面信号。语音请复制转写文字、标明我或对方后发送；再转发原语音不会补全正文");
  return parts.join("；")+"。";
}

// Preserve source sender and order. Never assign a multi-speaker recording to one person.
export async function prepareMergedWechat(message:Incoming,transcribe:(id:string,signal:AbortSignal)=>Promise<VoiceTranscript>){
  const items=message.merged_msg?.item||[];
  const coverage:SourceCoverage={total:items.length,text:0,voice:0,transcribed:0,noMedia:0,failedVoice:0,multiSpeaker:0,overLimit:0,otherSkipped:0};
  const prepared:NonNullable<Incoming["merged_msg"]>["item"]=[];
  const jobs:{index:number;id:string;item:typeof items[number]}[]=[];
  for(const [index,item] of items.entries()){
    const content=itemContent(item),text=content?.text?.content;
    const placeholder=typeof text==="string"?unavailableMedia(text):null;
    if(item.msgtype!=="voice"&&placeholder!=="voice"){
      if(placeholder){coverage.otherSkipped++;continue;}
      prepared[index]=item;if(item.msgtype==="text")coverage.text++;else coverage.otherSkipped++;continue;
    }
    coverage.voice++;
    const id=content?.voice?.media_id;
    if(typeof id!=="string"||!id){coverage.noMedia++;continue;}
    if(index>=80||jobs.length>=8){coverage.overLimit++;continue;}
    jobs.push({index,id,item});
  }
  const signal=AbortSignal.timeout(20000);
  let next=0;
  await Promise.all(Array.from({length:Math.min(3,jobs.length)},async()=>{
    while(next<jobs.length){const job=jobs[next++];try{
      signal.throwIfAborted();const result=await transcribe(job.id,signal);
      if(result.speakerCount>1){coverage.multiSpeaker++;continue;}
      prepared[job.index]={...job.item,msgtype:"text",msg_content:{text:{content:result.text}}};coverage.transcribed++;
    }catch{coverage.failedVoice++;}}
  }));
  if(!prepared.some(item=>item?.msgtype==="text"))throw new CrushError(coverage.voice>0&&coverage.noMedia===coverage.voice?unreadVoiceGuidance(coverage.voice):coverageText(coverage)+"当前没有已读文字可分析，请复制语音转写文字或发显示正文的截图。",400);
  const merged=parseMergedWechat({...message,merged_msg:{...message.merged_msg,item:prepared.filter(Boolean)}});
  const names=[...new Set(items.slice(0,80).map(item=>item.sender_name?.trim().replace(/[\r\n:：]/g," ").slice(0,60)).filter((name):name is string=>Boolean(name)))];
  if(names.length>2)throw new CrushError("记录有超过两位发送者，请按对象拆开分析。",400);
  return {...merged,names,coverage};
}

// WeChat display names can differ only in ASCII case or incidental spacing
// between the saved name and a forwarded record. Never guess if two senders
// collapse to the same normalized value.
export function matchMergedSelfName(names: string[], savedName: string): string | null {
  if (!savedName) return null;
  if (names.includes(savedName)) return savedName;
  const normalize = (name: string) => name.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
  const matches = names.filter((name) => normalize(name) === normalize(savedName));
  return matches.length === 1 ? matches[0] : null;
}

export function namesInMergedDraft(draft: string): string[] {
  return [...new Set(draft.split("\n").map((row) => row.match(/^([^：:]{1,60})[：:]/)?.[1]).filter((name): name is string => Boolean(name)))];
}

export function parseMergedWechat(message: Incoming) {
  const items = message.merged_msg?.item;
  if (!Array.isArray(items) || !items.length) throw new CrushError("这份合并转发没有可读取的消息，请改发文字或截图。", 400);
  const rows: string[] = [];
  const names = new Set<string>();
  let skipped = 0;
  for (const item of items.slice(0, 80)) {
    if (item?.msgtype !== "text" || typeof item.sender_name !== "string") { skipped++; continue; }
    let content: unknown;
    try { content = typeof item.msg_content === "string" ? JSON.parse(item.msg_content) : item.msg_content; }
    catch { skipped++; continue; }
    const text = (content as { text?: { content?: unknown } })?.text?.content;
    const name = item.sender_name.trim().replace(/[\r\n:：]/g, " ").slice(0, 60);
    if (!name || typeof text !== "string" || !text.trim()||unavailableMedia(text)) { skipped++; continue; }
    names.add(name);
    rows.push(name + "：" + text.trim().replace(/[\r\n]+/g, " ").slice(0, 1800));
  }
  if (items.length > 80) skipped += items.length - 80;
  if (!rows.length) throw new CrushError("这份合并转发没有可分析的文字；其中的语音、图片不会被自动还原。请发截图或文字。", 400);
  if (names.size > 2) throw new CrushError("这份记录有超过两位发送者，请拆成你与同一个人的聊天再分析。", 400);
  const text = rows.join("\n");
  if (text.length > 12000) throw new CrushError("合并转发文字超过 12000 字，请分段发送。", 400);
  return { text, names: [...names], count: rows.length, skipped };
}
