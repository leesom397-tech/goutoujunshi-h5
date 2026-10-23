import type {ChatLine,CrushResult,LineAnnotation} from "./types";

export const EVIDENCE_VERSION="readable-media-v3";
export function unavailableMedia(text:string):"voice"|"attachment"|null {
  const normalized=text.replace(/[″〃]/gu,'"').normalize("NFKC").trim();
  if(/^(?:\[|【)(?:语音(?:消息)?|voice(?: message)?)(?:\]|】)(?:\s*\d+(?:\.\d+)?\s*(?:["'″”’]|秒|s|sec(?:onds)?))?\s*$/iu.test(normalized))return "voice";
  if(/^(?:\[|【)(?:图片|视频|文件|表情|位置|image|video|file)(?:\]|】)(?:\s+\S[^\r\n]*)?\s*$/iu.test(normalized))return "attachment";
  return null;
}
export const readableChat=(lines:ChatLine[])=>lines.filter(line=>!unavailableMedia(line.text));
export function unreadAnnotation(line:ChatLine):LineAnnotation {
  return {lineId:line.id,emotion:[],intent:[],evidence:"insufficient",note:unavailableMedia(line.text)==="voice"?"未获取语音正文；这是时长占位符，不是转写内容，不参与语气、意图或好感判断。":"未读取附件正文，不参与关系判断。"};
}
export function unreadVoiceGuidance(count:number){
  return "收到 "+count+" 条语音占位记录，但没有语音正文或可下载音频；「[语音] 4秒」不是转写内容。\n本次不做逐句判断，也不出好感分。\n请在原微信聊天里把语音转成文字，再连同昵称粘贴过来；或上传你有权提供的录音文件：https://coach.lovetalk.love/import\n直接在本客服按住说话，是另一种音频输入，可以尝试转写，但不会自动获得原聊天双方身份。";
}
export function unreadMediaGuidance(lines:ChatLine[]){
  const voice=lines.filter(line=>unavailableMedia(line.text)==="voice").length;
  const attachments=lines.filter(line=>unavailableMedia(line.text)==="attachment").length;
  if(voice&&!attachments)return unreadVoiceGuidance(voice);
  const count=voice+attachments;
  return "收到 "+count+" 条未读媒体占位：语音 "+voice+" 条、图片或其他附件 "+attachments+" 条。这里只看到了引用，没有语音正文或附件内容；不能据此判断对方意图，也不会把未读媒体当作负面信号。\n请提供你有权使用的转写文字或可读聊天截图，并核对谁是你、谁是对方。";
}
// Compatibility view only: preserve stored source records, hide unsupported legacy scores.
export function readableReport(result:CrushResult):CrushResult {
  const missing=result.lines.filter(line=>unavailableMedia(line.text)),readableLineCount=result.lines.length-missing.length;
  const legacy=missing.length>0&&result.evidenceVersion!==EVIDENCE_VERSION;
  const blocked=missing.length>0&&(!readableLineCount||legacy);
  const annotations=result.annotations.filter(a=>!missing.some(line=>line.id===a.lineId));
  return {...result,readableLineCount,unreadMediaCount:missing.length,annotations:[...annotations,...missing.map(unreadAnnotation)],...(blocked?{affinity:null,affinityStatus:"unread_media" as const,affinityError:undefined}:{})};
}
