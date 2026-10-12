import { ArrowRight, Monitor } from "lucide-react";
import styles from "./CaptureEntry.module.css";
export function CaptureEntry({ kind = "chat" }: { kind?: string }) {
  if (kind === "social") return null;
  return <a className={styles.entry} href={`/capture?kind=${kind === "moments" ? "moments" : "chat"}`}><span className={styles.icon}><Monitor size={25}/></span><span><strong>从电脑版微信导入{kind === "moments" ? "朋友圈" : "聊天"}</strong><small>Windows 自动读取 · Mac / Windows 窗口采集</small></span><ArrowRight size={21}/></a>;
}
