import { ArrowDownToLine, ArrowRight, Laptop, Monitor } from "lucide-react";
import { desktopDownloads, desktopReleaseVersion, verifiedDesktopDownload } from "@/lib/desktop-download";
import styles from "./DesktopDownloads.module.css";

export function DesktopDownloads({compact=false}:{compact?:boolean}) {
  return <section className={styles.section} data-desktop-downloads data-compact={compact||undefined} id={compact?undefined:"desktop-downloads"} aria-label="下载成子桌面版">
    <div className={styles.intro}><span>成子 · 桌面工作区</span><h2>在电脑上，完整地了解。</h2><p>导入资料、阅读报告、继续交流，都在一个应用里。</p></div>
    <div className={styles.platforms}>{(["windows","mac"] as const).map(platform=>{
      const item=desktopDownloads[platform],ready=verifiedDesktopDownload(platform),Icon=platform==="windows"?Monitor:Laptop;
      return <article className={styles.platform} key={platform} data-download-platform={platform}>
        <Icon size={25} strokeWidth={1.5}/><div><h3>成子 {item.label} 版</h3><p>{item.system}</p></div>
        {ready?<a className={styles.download} href={`/api/web/desktop-download?platform=${platform}`} download={ready.name}><ArrowDownToLine size={17}/>下载安装<ArrowRight size={16}/></a>:<span className={styles.pending}>新版准备中</span>}
        {!compact&&<small>{item.limitations||`桌面预览版 ${desktopReleaseVersion}`}</small>}
      </article>;
    })}</div>
    {compact&&<a className={styles.more} href="/support#desktop-downloads">安装说明与版本信息<ArrowRight size={15}/></a>}
  </section>;
}
