import { ArrowRight, Download, Monitor, MessageCircle, Link2 } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { collectorInstallerHref, collectorInstallerSha256, collectorIsSigned, collectorVersion } from "@/lib/collector-download";
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
      {!collectorIsSigned && <p className={styles.downloadNote}>当前版本尚未完成数字签名。<a href="#download-blocked">浏览器拦截了下载？</a></p>}
    </section>
    <ol className={styles.steps} aria-label="安装后如何使用">
      <li><b>1</b><div><strong>打开下载的安装程序</strong><p>按窗口提示完成安装，启动助手。</p></div></li>
      <li><b>2</b><div><strong>回到网页，选择微信好友</strong><p>保持电脑微信登录，在导入页连接助手。</p></div></li>
      <li><b>3</b><div><strong>导入全部资料，确认费用</strong><p>材料准备完成后，一次生成完整关系报告。</p></div></li>
    </ol>
    <nav className={styles.actions} aria-label="继续使用"><a className={styles.primary} href={capturePersonSearchHref()}><Link2 size={19}/>已安装，连接助手<ArrowRight size={18}/></a><a href="/analyze?mode=chat">手机上先分析截图<ArrowRight size={17}/></a></nav>
    <section className={styles.questions} aria-labelledby="support-questions"><h2 id="support-questions">遇到问题</h2>
      <details><summary>助手开着，网页没有连上</summary><p>打开导入页，点击“连接助手”。如仍未连接，展开手动连接并填写助手窗口里的连接码。</p><a href={capturePersonSearchHref()}>回到导入页<ArrowRight size={16}/></a></details>
      <details id="download-blocked" open={!collectorIsSigned}><summary>Chrome 显示“已阻止可疑下载操作”</summary><p>这是浏览器的安全拦截。它可能与文件不常见或检测结果有关，单凭这条提示不能认定是哪一种。反复下载不能解决，请先查看下载详情。</p><p>如果下载详情提供“发送给 Google 检查”，可以先使用它进一步检查。若明确检测到恶意软件，请停止安装并联系客服。</p><p>{collectorIsSigned ? "当前版本已有数字签名；签名也不保证立即获得浏览器信任。" : "当前版本尚未数字签名，需要完成发布者验证和正式签名；如被判为恶意软件，还需要检测与复核。"}不能把文件校验通过当作安全认证。</p><p>在拦截原因确认前，可以继续用网页上传截图和提问。无需关闭浏览器保护。</p><a href="/analyze?mode=chat">先分析聊天截图<ArrowRight size={16}/></a><a href="https://support.google.com/chrome/answer/6261569?hl=zh-Hans" target="_blank" rel="noreferrer">查看 Chrome 官方说明<ArrowRight size={16}/></a></details>
      <details><summary>网络下载中断或安装校验失败</summary><p>网络中断后可从本页重试当前版本。如果安装窗口提示下载校验失败，先检查网络再点“重试”。浏览器显示“已阻止”时，请先查看上面的拦截说明。</p><a href={collectorInstallerHref} download><Download size={17}/>重新下载安装程序</a></details>
      <details><summary>核对版本与安装包</summary><p>版本 {collectorVersion} · {collectorIsSigned ? "已数字签名" : "尚未数字签名"}</p><p>安装程序 SHA-256，用于核对是否为同一份文件：</p><code className={styles.checksum}>{collectorInstallerSha256}</code></details>
      <details><summary>在手机上怎么使用</summary><p>手机可直接上传截图、提问和查看已同步的报告。完整读取电脑微信记录需要在 Windows 电脑安装助手，并登录同一个网页账号。</p></details>
    </section>
    <a className={styles.contact} href="/account#contact"><MessageCircle size={20}/><span>还需要帮助？联系客服</span><ArrowRight size={18}/></a>
  </main></>;
}
