import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCheck, Monitor, Settings2, MessageCircle } from "lucide-react";
import { QuickSearch } from "@/components/QuickSearch";
import { getDesktopHost, type DesktopRuntimeState } from "@/lib/desktop-host";

export default function DesktopSupport() {
  const [runtime, setRuntime] = useState<DesktopRuntimeState | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    getDesktopHost()?.getRuntimeState().then(value => { if (active) setRuntime(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  async function setup() {
    const host = getDesktopHost();
    if (!host || busy) return;
    setBusy(true); setNotice("");
    try { const result = await host.openCollectorSetup(); setNotice(result.opened ? "本机设置已打开，完成后回到成子继续。" : "暂未打开设置，请稍后重试。"); }
    catch { setNotice("本机设置暂未打开，请重新打开成子后重试。"); }
    finally { setBusy(false); }
  }
  return <>
    <header className="web-nav"><div className="web-nav-tools"><QuickSearch/></div></header>
    <nav className="page-trail desktop-support-trail" aria-label="页面返回导航" data-page-navigation><a href="/workspace"><ArrowLeft size={20}/>返回工作台</a><span>桌面帮助</span></nav>
    <main className="desktop-support">
      <header><span className="desktop-support-kicker"><Monitor size={18}/>成子桌面版</span><h1>采集、分析、看报告，在这里完成。</h1><p>打开电脑微信并登录，然后选择要导入的好友。</p></header>
      <section className="desktop-support-start"><CheckCheck size={26}/><div><h2>采集工具已内置</h2><p>聊天和语音在本机读取；朋友圈按当前设备支持的范围采集。</p><a className="desktop-support-primary" href="/capture?method=desktop&intent=person">导入微信资料<ArrowRight size={18}/></a></div></section>
      <section className="desktop-support-grid">
        <article><Settings2 size={23}/><h2>首次设置与连接</h2><p>连接失败或需要授权时，打开本机采集设置查看提示。</p><button onClick={() => void setup()} disabled={busy || !getDesktopHost()}>{busy ? "正在打开…" : "打开本机设置"}</button>{notice && <p role="status">{notice}</p>}</article>
        <article><MessageCircle size={23}/><h2>遇到问题</h2><p>联系时附上当前页面截图和版本号，便于定位。</p><a href="/account#contact">联系支持<ArrowRight size={17}/></a><small>{runtime ? `${runtime.platform === "darwin" ? "Mac" : "Windows"} · 成子 ${runtime.version}` : "版本信息可在应用菜单中查看"}</small></article>
      </section>
      <p className="desktop-support-note">界面和已下载资源保存在本机；登录、云端同步和生成新报告需要联网。</p>
    </main>
  </>;
}
