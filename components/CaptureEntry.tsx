import { ArrowRight, Monitor, FileVideo } from "lucide-react";
import styles from "./CaptureEntry.module.css";
import { intakeHref } from "./web-analysis/intake-navigation";
export function CaptureEntry({ kind = "chat", subjectId = "", returnTo = "" }: { kind?: string; subjectId?: string; returnTo?: string }) {
  if (kind === "social") return null;
  const type = kind === "moments" ? "moments" : "chat";
  return <div className={styles.entries}>
    <a className={styles.entry} href={intakeHref('/capture',{kind:type,method:'video',subjectId,returnTo})}><span className={styles.icon}><FileVideo size={25}/></span><span><strong>导入手机录屏</strong><small>苹果 / 安卓 · 自动截帧、去重，再确认分析</small></span><ArrowRight size={21}/></a>
    <a className={styles.entry} href={intakeHref('/capture',{kind:type,method:'computer',subjectId,returnTo})}><span className={styles.icon}><Monitor size={25}/></span><span><strong>从电脑版微信导入{kind === "moments" ? "朋友圈" : "聊天"}</strong><small>Windows 自动读取 · Mac / Windows 窗口采集</small></span><ArrowRight size={21}/></a>
  </div>;
}
