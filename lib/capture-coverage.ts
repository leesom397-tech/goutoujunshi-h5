import {captureReadableText} from "./capture-analysis-input";
import {captureMaterialCounts} from "./capture-material";

export type CaptureCoverageRow={kind:string;text:string;senderRole?:string;ocrTextVerified?:boolean;images?:unknown[];source?:Record<string,unknown>};
export type CaptureCoverageSummary={total:number;readableText:number;unknownSpeaker:number;voiceTotal:number;transcribed:number;unreadVoice:number;voiceAvailable:number;voiceMissingLocal:number;voiceFailed:number;unreadImage:number;unreadSticker:number;other:number;frames:number;postImages:number;momentCount:number;profileMaterialCount:number;pinnedCount:number;coverCount:number;signatureCount:number};
const compact=(text:string)=>text.replace(/\s+/g," ").trim();
const voicePlaceholder=/^(?:\[|【|\()?\.?(?:语音(?:消息)?|語音(?:訊息|消息)?|voice(?: message)?|audio(?: message)?)(?:\]|】|\))?(?:\s*(?:\d{1,3}\s*(?:秒|[“”"'′″]\s*秒?|s(?:ec(?:ond)?s?)?)|\d{1,2}[:：]\d{2}))?(?:\s*(?:未播放|已播放|未转文字|未轉文字))?$/iu;
const videoPlaceholder=/^(?:\[|【|\()?(?:视频|影片|視頻|video)(?:\]|】|\))?(?:\s*\d{1,2}[:：]\d{2})?$/iu;
const imagePlaceholder=/^(?:\[|【|\()?(?:图片|圖片|照片|photo|image)(?:\]|】|\))?$/iu;
const stickerPlaceholder=/^(?:\[|【|\()?(?:动画表情|動態貼圖|表情包?|貼圖|贴纸|sticker|animated stickers?|animated emoji|emoji)(?:\]|】|\))?$/iu;
export function captureVisualFrame(row:CaptureCoverageRow){return ["screen-capture","video-import"].includes(String(row.source?.method));}
function voice(row:CaptureCoverageRow){return row.source?.mediaKind==="voice" || /^(?:mmui::)?ChatVoiceItemView$/.test(String(row.source?.uiClass||"")) || row.kind==="other" && voicePlaceholder.test(compact(row.text));}
function status(row:CaptureCoverageRow){const value=row.source?.transcription;return String(row.source?.transcriptionStatus || (value&&typeof value==="object"?(value as Record<string,unknown>).status:"") || "");}
function readable(row:CaptureCoverageRow,kind:"chat"|"moments"){
 if(captureVisualFrame(row))return "";
 if(kind==="moments"&&row.kind==="post")return row.text.trim();
 return captureReadableText(row).trim();
}
export function captureCoverage(records:readonly CaptureCoverageRow[],kind:"chat"|"moments"="chat"):CaptureCoverageSummary{
 const total:CaptureCoverageSummary={total:records.length,readableText:0,unknownSpeaker:0,voiceTotal:0,transcribed:0,unreadVoice:0,voiceAvailable:0,voiceMissingLocal:0,voiceFailed:0,unreadImage:0,unreadSticker:0,other:0,frames:0,postImages:0,...captureMaterialCounts(kind==="moments"?records:[])};
 for(const row of records){
  if(captureVisualFrame(row)){total.frames++;continue;}
  const text=readable(row,kind);
  if(voice(row))total.voiceTotal++;
  if(text){total.readableText++;if(kind==="chat"&&!["self","other"].includes(row.senderRole||""))total.unknownSpeaker++;if(voice(row)&&status(row)==="visible-text")total.transcribed++;}
  if(kind==="moments"&&row.kind==="post"&&row.images?.length){total.postImages++;continue;}
  if(text)continue;
  if(voice(row)){total.unreadVoice++;const availability=String(row.source?.voiceAvailability||"");if(availability==="available")total.voiceAvailable++;else if(availability==="missing-local")total.voiceMissingLocal++;else if(["decode-failed","transcribe-failed"].includes(availability))total.voiceFailed++;continue;}
  if(row.kind==="image"||row.kind==="other"&&imagePlaceholder.test(compact(row.text))){total.unreadImage++;continue;}
  if(row.kind==="sticker"||row.kind==="other"&&stickerPlaceholder.test(compact(row.text))){total.unreadSticker++;continue;}
  total.other++;
 }
 return total;
}
export function captureMediaNotice(row:CaptureCoverageRow,kind:"chat"|"moments"="chat"):string{
 if(row.source?.cloudConflict===true)return "本机与云端的这条原文有差异，当前保留本机版本，未自动覆盖。";
 if(row.source?.cloudMediaUnavailable===true)return `文字已取回，${Number(row.source.imageCount)||"部分"} 张图片尚未同步完整。请在采集电脑继续同步；本次不会分析缺失画面。`;
 if(captureVisualFrame(row))return "";
 if(readable(row,kind))return voice(row)&&status(row)==="visible-text"?(row.source?.transcriptionSource==="local-audio-asr"?"本机语音已转成文字，建议核对人名等易错字；未分析语调。":row.source?.transcriptionNeedsReview===true?"微信转写已读，建议核对易错字。":"已读取微信可见的转写文字；语音语调与背景声音未分析。"):"";
 if(voice(row)){
  const availability=String(row.source?.voiceAvailability||"");
  if(availability==="missing-local")return "电脑里还没有这条语音文件。先从手机导出对应聊天到电脑，再重新检查。";
  if(availability==="available")return "本机已有语音文件，点击「后台补全语音」即可转文字。";
  if(availability==="decode-failed")return "这条本机语音暂时无法解码，原记录已保留；可重新同步后重试。";
  if(availability==="transcribe-failed")return "这条语音转写未完成，原记录已保留，可再次补全语音。";
  const state=status(row);
  return state==="pending"?"语音仍在转文字，暂未读到正文，本次不分析其中内容。":state==="failed"?"这条语音转文字未成功，已保留原占位，本次不分析其中内容。":"语音尚未转成文字，本次不分析其中内容。";
 }
 if(row.kind==="sticker"||row.kind==="other"&&stickerPlaceholder.test(compact(row.text)))return "表情包文字与画面尚未读取，不作为聊天原话。";
 if(row.kind==="image"||row.kind==="other"&&imagePlaceholder.test(compact(row.text)))return kind==="moments"&&row.images?.length?"配图已保留，确认分析后才会读取图片内容。":row.images?.length?"仅保留图片预览；聊天文字分析不读取画面，可用截图分析。":"只读到图片占位，尚未读取图片内容。";
 if(row.kind==="post"&&kind==="moments")return row.images?.length?"配图已保留，确认分析后才会读取图片内容。":"这条动态没有读到正文或配图。";
 if(row.kind==="other"&&videoPlaceholder.test(compact(row.text)))return "视频画面与声音尚未读取，本次不分析其中内容。";
 return "其他媒体或系统提示未读取为聊天正文，本次不作原话分析。";
}
