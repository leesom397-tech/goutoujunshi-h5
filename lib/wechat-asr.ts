import {getWechatMedia} from "./wechat";
import {qwenKey,qwenWorkspaceId} from "./qwen";

export type VoiceTranscript={text:string;segments:{text:string;speakerId:number|null}[];speakerCount:number};
export function readVoiceTranscript(raw:unknown):VoiceTranscript {
  type Output={text?:unknown;sentence?:{text?:unknown};sentences?:{text?:unknown;speaker_id?:unknown}[];output?:Output};
  const output=(raw as {output?:Output})?.output,variants=[output,output?.output];
  const sentences=variants.map(value=>value?.sentences).find(value=>Array.isArray(value)&&value.some(s=>typeof s?.text==="string"&&s.text.trim()));
  const segments=(sentences||[]).filter(s=>typeof s?.text==="string"&&s.text.trim()).map(s=>({text:(s.text as string).trim(),speakerId:typeof s.speaker_id==="number"&&Number.isInteger(s.speaker_id)&&s.speaker_id>=0?s.speaker_id:null}));
  const fallback=[...variants.map(value=>value?.text),...variants.map(value=>value?.sentence?.text)].find(value=>typeof value==="string"&&value.trim()) as string|undefined;
  const text=(segments.length?segments.map(s=>s.text).join(" "):fallback||"").trim().slice(0,4000);
  if(!text)throw Error("WECHAT_ASR_EMPTY");
  return {text,segments,speakerCount:new Set(segments.filter(s=>s.speakerId!==null).map(s=>s.speakerId)).size};
}
export function voiceErrorCode(error:unknown){
  const message=error instanceof Error?error.message:"";
  if(/^WECHAT_(?:ASR_(?:EMPTY|NOT_CONFIGURED|HTTP_\d{3})|AUDIO_FORMAT|MEDIA(?:_ID|_SIZE|_EMPTY)?)$/.test(message))return message;
  if(error instanceof Error&&(error.name==="TimeoutError"||error.name==="AbortError"))return "WECHAT_ASR_TIMEOUT";
  return "WECHAT_VOICE_UNAVAILABLE";
}
export function voicePublicError(error:unknown){
  const code=voiceErrorCode(error);
  if(code==="WECHAT_ASR_TIMEOUT")return "这次语音识别超时了，不代表没听到声音。请稍后再试，或复制微信转写文字。";
  if(code==="WECHAT_ASR_EMPTY")return "识别服务没有返回可用文字；不能据此判断你说了什么。请检查录音是否有清晰人声。";
  if(code==="WECHAT_MEDIA")return "这条语音的音频未能从微信下载，可能已过期或临时不可用；没有拿到声音，不能分析。";
  if(code==="WECHAT_AUDIO_FORMAT")return "已下载文件，但音频格式目前无法识别；没有转写正文，不能分析。";
  if(code==="WECHAT_ASR_NOT_CONFIGURED"||/^WECHAT_ASR_HTTP_(401|403)$/.test(code))return "语音识别服务的配置或授权异常，需要管理员处理；不是聊天内容的问题。";
  return "语音识别服务本次没有完成，不能假装听懂；可以复制微信转写文字后继续。";
}
export async function transcribeWechatVoice(mediaId:string,signal?:AbortSignal):Promise<VoiceTranscript>{
  const download=signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);
  const media=await getWechatMedia(mediaId,2_000_000,download);
  const header=new TextDecoder().decode(media.bytes.slice(0,9));
  if(!header.startsWith("#!AMR"))throw Error("WECHAT_AUDIO_FORMAT");
  // Download and recognition get separate bounded clocks. An outer batch cancellation still wins.
  return transcribeWechatAudio(media.bytes,"amr",signal?AbortSignal.any([signal,AbortSignal.timeout(35000)]):AbortSignal.timeout(35000));
}
export async function transcribeWechatAudio(bytes:Uint8Array,format:"amr"|"wav",signal:AbortSignal=AbortSignal.timeout(35000),fictionalDiagnostic=false):Promise<VoiceTranscript>{
  if(bytes.length>2_000_000)throw Error("WECHAT_MEDIA_SIZE");
  const workspace=qwenWorkspaceId(),key=qwenKey();
  if(!workspace||!key)throw Error("WECHAT_ASR_NOT_CONFIGURED");
  const response=await fetch("https://"+workspace+".cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json","X-DashScope-SSE":"disable"},body:JSON.stringify({model:"qwen-audio-3.1-asr-flash",input:{messages:[{role:"user",content:[{type:"input_audio",input_audio:{data:"data:audio/"+format+";base64,"+Buffer.from(bytes).toString("base64")}}]}]},parameters:{format,speaker_diarization_enabled:true}}),signal});
  if(!response.ok){
    const data=await response.json().catch(()=>({})) as {code?:string;message?:string};
    if(data.message==="ASR_RESPONSE_HAVE_NO_WORDS")throw Error("WECHAT_ASR_EMPTY");
    const error=Error("WECHAT_ASR_HTTP_"+response.status) as Error&{diagnostic?:string};
    // Only the operator's generated silent fixture may expose a short provider error.
    // Real voice errors never retain or log the body.
    if(fictionalDiagnostic){const detail=String(data.code||"")+": "+String(data.message||"");error.diagnostic=/apikey_|Bearer|base64|access_token/i.test(detail)?"redacted":detail.slice(0,250);}
    throw error;
  }
  return readVoiceTranscript(await response.json());
}
