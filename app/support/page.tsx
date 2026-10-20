import { ArrowRight, Download, Monitor, MessageCircle, Link2 } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { collectorInstallerHref, collectorVersion } from "@/lib/collector-download";
import { capturePersonSearchHref } from "@/lib/person-analysis-navigation";
import styles from "./support.module.css";

export default function SupportPage() {
  return <><WebNav/><main className={styles.page}>
    <header><span>帮助与下载</span><h1>微信助手，从这里下载</h1><p>首次安装、更新版本，都用同一个入口。</p></header>
    <section className={styles.download} aria-labelledby="helper-title">
      <Monitor size={36} strokeWidth={1.5}/>
      <div><h2 id="helper-title">成子电脑微信助手</h2><p>Windows 10 / 11 · 版本 {collectorVersion}</p></div>
      <a className={styles.primary} href={collectorInstallerHref} download><Download size={20}/>下载 Windows 助手<ArrowRight size={18}/></a>
      <p className={styles.downloadNote}>下载无需登录。请在 Windows 电脑打开安装程序。</p>
    </section>
    <ol className={styles.steps} aria-label="安装后如何使用">
      <li><b>1</b><div><strong>打开下载的安装程序</strong><p>按窗口提示完成安装，启动助手。</p></div></li>
      <li><b>2</b><div><strong>回到网页，选择微信好友</strong><p>保持电脑微信登录，在导入页连接助手。</p></div></li>
      <li><b>3</b><div><strong>导入全部资料，确认费用</strong><p>材料准备完成后，一次生成完整关系报告。</p></div></li>
    </ol>
    <nav className={styles.actions} aria-label="继续使用"><a className={styles.primary} href={capturePersonSearchHref()}><Link2 size={19}/>已安装，连接助手<ArrowRight size={18}/></a><a href="/analyze?mode=chat">手机上先分析截图<ArrowRight size={17}/></a></nav>
    <section className={styles.questions} aria-labelledby="support-questions"><h2 id="support-questions">遇到问题</h2>
      <details><summary>助手开着，网页没有连上</summary><p>打开导入页，点击“连接助手”。如仍未连接，展开手动连接并填写助手窗口里的连接码。</p><a href={capturePersonSearchHref()}>回到导入页<ArrowRight size={16}/></a></details>
      <details><summary>下载或安装没有完成</summary><p>从本页重新下载当前版本。如果窗口提示下载校验失败，先检查网络，再点“重试”。</p><a href={collectorInstallerHref} download><Download size={17}/>重新下载安装程序</a></details>
      <details><summary>在手机上怎么使用</summary><p>手机可直接上传截图、提问和查看已同步的报告。完整读取电脑微信记录需要在 Windows 电脑安装助手，并登录同一个网页账号。</p></details>
    </section>
    <a className={styles.contact} href="/account#contact"><MessageCircle size={20}/><span>还需要帮助？联系客服</span><ArrowRight size={18}/></a>
  </main></>;
}
