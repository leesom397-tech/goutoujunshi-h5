import { ArrowRight, Download, MessageCircle } from "lucide-react";
import { WebNav } from "@/components/WebNav";
import { DesktopDownloads } from "@/components/DesktopDownloads";
import { collectorInstallerHref, collectorVersion } from "@/lib/collector-download";
import styles from "./support.module.css";

export default function SupportPage() {
  return <><WebNav/><main className={styles.page}>
    <header><span>下载与帮助</span><h1>把成子，放到你的电脑上。</h1><p>Windows 与 Mac，在同一个工作区接着看。</p></header>
    <DesktopDownloads/>
    <ol className={styles.steps} aria-label="安装后如何使用">
      <li><b>1</b><div><strong>安装成子</strong><p>选择与你电脑匹配的版本，打开应用。</p></div></li>
      <li><b>2</b><div><strong>登录你的账号</strong><p>已有的人物与报告，会在这里接着使用。</p></div></li>
      <li><b>3</b><div><strong>导入，再看报告</strong><p>选择一个人，导入资料后确认分析费用。</p></div></li>
    </ol>
    <section className={styles.questions} aria-labelledby="support-questions"><h2 id="support-questions">安装与使用</h2>
      <details><summary>电脑和手机上的报告相通吗？</summary><p>登录同一个成子账号，即可查看已经同步的资料和报告。打开已有报告不扣积分。</p></details>
      <details><summary>资料导入到一半，能继续吗？</summary><p>已保存的内容会保留。回到同一位好友的导入页继续，语音和图片只补尚未完成的部分。</p></details>
      <details id="download-blocked"><summary>浏览器或系统提示无法安装</summary><p>桌面版仍处于预览阶段。当前安装包尚未完成 Windows 发布者签名和 Apple 公证，可能出现安装拦截。请保留系统保护；可以先用网页上传截图和查看报告。</p><a href="/analyze?mode=chat">先使用网页版<ArrowRight size={16}/></a></details>
      <details><summary>下载中断了</summary><p>重新点击同一个版本的下载按钮，可由浏览器继续下载；无需删除已有报告或重新登录。</p></details>
      <details><summary>还想继续用网页采集？</summary><div className={styles.legacy}><h3 id="helper-title">网页采集助手</h3><p>仅在继续使用网页导入时需要；成子桌面版已经内置本机采集服务。</p><a href={collectorInstallerHref} download><Download size={17}/>Windows 网页助手 {collectorVersion}</a><a href="/capture?method=desktop">回到网页导入<ArrowRight size={16}/></a></div></details>
    </section>
    <a className={styles.contact} href="/account#contact"><MessageCircle size={20}/><span>联系客服</span><ArrowRight size={18}/></a>
  </main></>;
}
