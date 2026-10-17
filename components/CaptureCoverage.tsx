import {FileText,Image,Mic,Smile,ScanLine,CircleHelp} from "lucide-react";
import {captureCoverage,type CaptureCoverageRow} from "@/lib/capture-coverage";
import styles from "./CaptureCoverage.module.css";
export function CaptureCoverage({records,kind}:{records:readonly CaptureCoverageRow[];kind:"chat"|"moments"}){
 const info=captureCoverage(records,kind);
 if(!info.total)return null;
 const missing=info.unreadVoice+info.unreadImage+info.unreadSticker+info.other;
 return <p className={styles.coverage} aria-label="采集内容覆盖" data-capture-coverage>
  <span><FileText size={17}/>{kind==="moments"?"已读文案":"已读文字"} <strong>{info.readableText}</strong> 条{info.unknownSpeaker>0&&<small>（{info.unknownSpeaker} 条身份待核对）</small>}</span>
  {info.voiceTotal>0&&<span><Mic size={17}/>语音已转文字 <strong>{info.transcribed} / {info.voiceTotal}</strong> 条</span>}
  {info.voiceAvailable>0&&<span><Mic size={17}/>本机可转写 <strong>{info.voiceAvailable}</strong> 条</span>}
  {info.voiceMissingLocal>0&&<span className={styles.unread}><CircleHelp size={17}/>待手机同步 <strong>{info.voiceMissingLocal}</strong> 条</span>}
  {info.voiceFailed>0&&<span className={styles.unread}><CircleHelp size={17}/>转写待重试 <strong>{info.voiceFailed}</strong> 条</span>}
  {info.frames>0&&<span><ScanLine size={17}/>截图待识别 <strong>{info.frames}</strong> 张</span>}
  {info.postImages>0&&<span><Image size={17}/>带配图待分析 <strong>{info.postImages}</strong> 条</span>}
  {info.unreadVoice-info.voiceAvailable-info.voiceMissingLocal-info.voiceFailed>0&&<span className={styles.unread}><Mic size={17}/>未读语音 <strong>{info.unreadVoice-info.voiceAvailable-info.voiceMissingLocal-info.voiceFailed}</strong> 条</span>}
  {info.unreadImage>0&&<span className={styles.unread}><Image size={17}/>未读图片 <strong>{info.unreadImage}</strong> 条</span>}
  {info.unreadSticker>0&&<span className={styles.unread}><Smile size={17}/>未读表情包 <strong>{info.unreadSticker}</strong> 条</span>}
  {info.other>0&&<span className={styles.unread}><CircleHelp size={17}/>其他未读 <strong>{info.other}</strong> 条</span>}
  {missing>0&&<small className={styles.note}>未读内容不计入文字分析。</small>}
 </p>;
}
