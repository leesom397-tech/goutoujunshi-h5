import { ScanLine, MessageCircle, Users, ArrowUpRight } from "lucide-react";
import styles from "./AuthShell.module.css";

export function AuthArtwork() {
  return <div className={`p-auth-stack ${styles.artwork}`}>
    <div className={`p-auth-tile sky ${styles.tile}`}><ScanLine size={22}/><span>看懂一句话</span><ArrowUpRight size={17}/></div>
    <div className={`p-auth-tile pink ${styles.tile}`}><MessageCircle size={22}/><span>找到下一步</span><ArrowUpRight size={17}/></div>
    <div className={`p-auth-tile mint ${styles.tile}`}><Users size={22}/><span>记住每一次</span><ArrowUpRight size={17}/></div>
  </div>;
}
