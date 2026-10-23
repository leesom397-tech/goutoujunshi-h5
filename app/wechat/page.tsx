"use client";

import { useEffect, useState } from "react";
import type { ProfileState } from "@/lib/profile";

type Link = { id: string; subjectId: string | null; createdAt: number };
type Status = { configured: boolean; kfUrl: string | null; links: Link[] };

export default function WechatPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [crushEnabled, setCrushEnabled] = useState(false);
  const [quickJevEnabled, setQuickJevEnabled] = useState(false);
  const [fullJevEnabled,setFullJevEnabled]=useState(false);
  const [affinityEnabled, setAffinityEnabled] = useState(false);
  const [jevReady, setJevReady] = useState(false);
  const [allowCrush, setAllowCrush] = useState(false);
  const [allowJev, setAllowJev] = useState(false);
  const [allowFullJev,setAllowFullJev]=useState(false);
  const [allowAffinity, setAllowAffinity] = useState(false);
  const [imageEnabled,setImageEnabled]=useState(false);
  const [allowImage,setAllowImage]=useState(false);
  const [allowAll,setAllowAll]=useState(false);
  const [allowProfile,setAllowProfile]=useState(false);
  const [selfSide,setSelfSide]=useState("right");
  async function enableAll(){
    if(!allowAll||!allowProfile){setNotice("请分别确认聊天分析与长期档案授权。");return;}
    setBusy(true);setNotice("");
    try{const response=await fetch("/api/crush",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"enableAll",allowAll:true,allowProfile:true,selfSide})});const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error||"开启失败");setCrushEnabled(true);setQuickJevEnabled(true);setFullJevEnabled(true);setAffinityEnabled(true);setImageEnabled(true);setProfile(current=>current?{...current,enabled:true,paused:false}:{enabled:true,paused:false,self:{},subjects:[],facts:[]});setAllowAll(false);setAllowProfile(false);setNotice("已开启截图、快判断、完整分类及关系档案。现在可直接生成微信绑定码；新报告不再逐份授权。");}
    catch(error){setNotice(error instanceof Error?error.message:"开启失败");}finally{setBusy(false);}
  }
  async function refresh() {
    const [a, b, c] = await Promise.all([fetch("/api/wechat/bind", { cache: "no-store" }), fetch("/api/profile", { cache: "no-store" }), fetch("/api/crush", { cache: "no-store" })]);
    if (a.status === 401) { setSignedOut(true); return; }
    if (a.ok) setStatus(await a.json());
    if (b.ok) setProfile(await b.json());
    if (c.ok) { const setting=await c.json() as {enabled?:boolean;quickJevEnabled?:boolean;fullJevEnabled?:boolean;affinityEnabled?:boolean;jev?:boolean;imageEnabled?:boolean;imageSelfSide?:string};setCrushEnabled(!!setting.enabled);setQuickJevEnabled(!!setting.quickJevEnabled);setFullJevEnabled(!!setting.fullJevEnabled);setAffinityEnabled(!!setting.affinityEnabled);setJevReady(!!setting.jev);setImageEnabled(!!setting.imageEnabled);if(["right","left"].includes(setting.imageSelfSide||""))setSelfSide(setting.imageSelfSide!); }
  }
  useEffect(() => { const timer=setTimeout(()=>void refresh(),0); return ()=>clearTimeout(timer); }, []);
  async function createCode() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/wechat/bind", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) });
      const data = await response.json() as { error?: string; code?: string };
      if (!response.ok) throw new Error(data.error || "生成失败");
      setCode(data.code || "");
    } catch (error) { setNotice(error instanceof Error ? error.message : "生成失败"); }
    finally { setBusy(false); }
  }
  async function setSubject(id: string, subjectId: string) {
    const response = await fetch("/api/wechat/bind", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subject", id, subjectId: subjectId || null }) });
    if (!response.ok) { setNotice("切换对象失败，请稍后重试。"); return; }
    await refresh();
  }
  async function unbind() {
    if (!window.confirm("解除绑定后，微信消息将不能再读取你的关系档案。确定解除吗？")) return;
    const response = await fetch("/api/wechat/bind", { method: "DELETE" });
    if (!response.ok) { setNotice("解除失败，请稍后重试。"); return; }
    setCode(""); await refresh();
  }
  async function enableCrush() {
    if (!allowCrush) { setNotice("请先确认聊天资料处理与 7 天短期保存。"); return; }
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/crush", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", enabled: true, provider: "qwen", quickJevConsent:allowJev, allowJev }) });
      const data = await response.json() as {error?:string};
      if (!response.ok) throw new Error(data.error || "开启失败");
      setCrushEnabled(true); setQuickJevEnabled(allowJev); setAffinityEnabled(false); setNotice("聊天解读已开启。再开启下方截图识别、选好当前对象，就可以截图发给微信军师。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "开启失败"); }
    finally { setBusy(false); }
  }
  async function setQuickJev(enabled:boolean){
    if(enabled&&!allowJev){setNotice("请先确认第三方快判断的单独数据处理说明。");return;}
    setBusy(true);setNotice("");
    try{const response=await fetch("/api/crush",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"quickJev",enabled,allowJev:enabled&&allowJev})});const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error||"设置未完成");setQuickJevEnabled(enabled);if(!enabled)setAffinityEnabled(false);setAllowJev(false);setNotice(enabled?"文字快判断已开启。截图继续由成子完成解读，原图不发送给文字分类服务。":"已关闭文字快判断，微信聊天继续由成子解读。");}
    catch(error){setNotice(error instanceof Error?error.message:"设置未完成");}finally{setBusy(false);}
  }
  async function setFullJev(enabled:boolean){
    if(enabled&&!allowFullJev){setNotice("请先确认完整分类的跨境文字处理范围。");return;}
    setBusy(true);setNotice("");
    try{const response=await fetch("/api/crush",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"fullJev",enabled,allowJevFull:enabled&&allowFullJev})});const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error||"设置未完成");setFullJevEnabled(enabled);setAllowFullJev(false);setNotice(enabled?"完整分类已一次性开启：微信快判断照常返回，打开网页报告后自动补全全部维度；旧报告不会在后台自动发送。":"已关闭后续完整分类；既有报告仍按原期限保存，可在逐句页面删除。");}
    catch(error){setNotice(error instanceof Error?error.message:"设置未完成");}finally{setBusy(false);}
  }
  async function setAffinity(enabled:boolean){
    if(enabled&&!allowAffinity){setNotice("请先单独确认六维互动信号的数据处理范围。");return;}
    setBusy(true);setNotice("");
    try{const response=await fetch("/api/crush",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"affinity",enabled,allowAffinity:enabled&&allowAffinity})});const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error||"设置未完成");setAffinityEnabled(enabled);setAllowAffinity(false);setNotice(enabled?"已开启六维互动信号。截图先给短判断，打开网页报告后点「计算六维互动图」；评分不会拖慢微信回复。":"已关闭六维互动信号，快判断和逐句报告仍可用。");}
    catch(error){setNotice(error instanceof Error?error.message:"设置未完成");}finally{setBusy(false);}
  }
  async function setImageMapping(enabled:boolean){
    if(enabled&&!allowImage){setNotice("请单独确认截图识别说明和本人气泡位置。");return;}
    setBusy(true);setNotice("");
    try{const response=await fetch("/api/crush",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"imageMapping",enabled,selfSide,allowImageProcessing:enabled&&allowImage})});const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error||"设置未完成");setImageEnabled(enabled);setAllowImage(false);setNotice(enabled?"截图识别已开启。发本人单聊截图即可，不会反复问哪侧是你；换人先选对象。":"已关闭后续截图识别，待关联截图已清除。");}
    catch(error){setNotice(error instanceof Error?error.message:"设置未完成");}finally{setBusy(false);}
  }
  return <main className="wechat-shell">
    <a className="wechat-back" href="/">← 返回对话</a>
    <div className="wechat-eyebrow">微信聊天副驾 · 截图快判断</div>
    <h1>发一张截图，知道下一句怎么接</h1>
    <p className="wechat-lead">微信负责眼前的判断和回复；网页负责完整关系档案、六维图、择偶定位与长录音分析。两端接着同一个对象。</p>
    <section className="wechat-card"><h2>截图 → 先判断 → 接着问；建档不挡路</h2><p>首次只需开启图片识别。没有选对象也能先看临时判断，每张图独立分析，不混入别人的背景、不写进长期档案。需要接着一个人的历史时，发「对象 小芳」选择已有档案，或「新对象 小芳」建立对象；之后默认接着这个人，换人先切换。</p><p>把本人微信单聊截图发给客服。语音先在原微信转成文字，再连同两侧气泡截图；长对话分成清晰小图。连续发图不会再被“上一张等选择”拒收。授权前最多暂收8张、保留1小时，开启后按顺序处理。</p><div className="wechat-code"><strong>1｜对方</strong><span>「下次我们去看电影吧」<br/>语气｜友好<br/>可能意图｜发出邀约<br/><br/>示意排版，非真实分析；标签是推测。</span></div><p>发「怎么回」拿可复制回复；直接问「她是不是在主动约我？」继续剖析；「第2页」看下一页。不能直接改原聊天气泡，也不是实时监听微信。</p><a className="wechat-open" href="/crush">完整逐句报告与六维图 →</a><a className="wechat-open" href="/profile">长期关系档案与待确认事件 →</a><a className="wechat-open" href="/positioning">择偶定位 →</a></section>
    {signedOut && <section className="wechat-card"><h2>先登录，保护你的关系资料</h2><p>绑定微信前，需要确认这是你自己的 成子 账号。</p><a className="wechat-open" href="/login?return_to=%2Fwechat">登录后继续</a></section>}
    {!signedOut && <>
    <section className="wechat-card">
      <h2>一次开启微信分析</h2>
      <p>开启截图识别、文字快判断、完整情绪与意图分布、六维互动信号；以后发新截图或打开报告不逐份确认。你主动提供的单聊截图原图交阿里云百炼识别，不在本站归档；最多 80 句、每句 160 字的可读文字摘录交美国 TypeSafe AI（Jev）分类，六维最多用同一对象最近 40 句，文字快判断最多用最近 6 句。第三方不会收到原截图、原录音、昵称字段或完整关系档案，但文字本身可能含双方个人信息。聊天文字与报告最多保存 7 天；可关闭后续发送或删除报告。模型百分比不是对方喜欢你的概率。<a href="https://typesafe.ai/legal/privacy-policy" target="_blank" rel="noreferrer">TypeSafe 隐私政策</a>。</p>
      <label className="wechat-link-row">本人单聊截图哪侧是我<select value={selfSide} onChange={event=>{setSelfSide(event.target.value);setAllowAll(false);}}><option value="right">右侧是我（绿色气泡）</option><option value="left">左侧是我</option></select></label>
      <label><input type="checkbox" checked={allowAll} onChange={event=>setAllowAll(event.target.checked)}/> 我有权提供双方内容，确认本人气泡位置，并同意上述阿里云百炼处理、向 TypeSafe AI 发送限定聊天文字及最多 7 天保存；以后不逐份确认</label>
      <label><input type="checkbox" checked={allowProfile} onChange={event=>setAllowProfile(event.target.checked)}/> 我另行同意开启长期关系档案，供绑定的微信会话读取。新档案初始为空；若此前暂停过，开启将恢复读取已保存的资料。档案不受上述 7 天期限限制，只有我确认的线索才写入长期档案；我可随时暂停或删除。</label>
      <button className="wechat-primary" type="button" disabled={busy||!allowAll||!allowProfile||!jevReady} onClick={()=>void enableAll()}>{crushEnabled&&quickJevEnabled&&fullJevEnabled&&affinityEnabled&&imageEnabled&&profile?.enabled&&!profile.paused?"重新确认并开启全部功能":"确认并一次开启全部功能"}</button>
      {!jevReady&&<p className="wechat-warning">完整分类服务暂未接通，暂不能开启全功能。</p>}
    </section>
    <details className="wechat-card"><summary>高级设置 · 单独关闭或调整某项功能</summary>
    <section className="wechat-card">
      <h2>聊天解读授权</h2>
      {crushEnabled ? <p>已开启聊天解读。截图先回逐句短判断，随后自动发送彩图；长记录再发「第2页」。原话、语气、可能意图和具体解释保留在报告中，直接发文字可继续追问。句子百分比是模型的相对解释权重，不是好感概率。{quickJevEnabled?"文字转发先回快速判断，成子继续整理完整报告。":"文字解读由成子整理。"}原聊天语音请先转文字再截图。</p> : <><p>开启后，你主动发送的聊天文字会交给阿里云百炼分析，聊天与报告最多保存 7 天，可随时在逐句页面关闭并删除。</p><label><input type="checkbox" checked={allowCrush} onChange={event=>setAllowCrush(event.target.checked)} /> 我确认有权提供这些聊天，并同意上述处理与短期保存</label></>}
      {jevReady&&!quickJevEnabled&&<><p>可选加速：同意后，系统会自动把最近最多 6 条、每条最多 160 字的聊天文字摘录发给美国的 TypeSafe AI 做即时分类；不发送原图、语音、昵称字段或完整关系档案。文字本身仍可能包含个人信息。逐句报告仍由阿里云百炼生成。<a href="https://typesafe.ai/legal/privacy-policy" target="_blank" rel="noreferrer">查看 TypeSafe 隐私政策</a>，联系：privacy@typesafe.ai。可随时关闭后续发送。</p><label><input type="checkbox" checked={allowJev} onChange={event=>setAllowJev(event.target.checked)} /> 我已知悉上述跨境处理，并单独同意将我有权提供的聊天文字摘录发给 TypeSafe AI 用于快判断</label></>}
      <div>{crushEnabled?(quickJevEnabled?<button className="wechat-secondary" type="button" disabled={busy} onClick={()=>void setQuickJev(false)}>关闭第三方快判断</button>:jevReady?<button className="wechat-primary" type="button" disabled={!allowJev||busy} onClick={()=>void setQuickJev(true)}>开启自动快判断</button>:null):<button className="wechat-primary" type="button" disabled={!allowCrush||busy||signedOut} onClick={()=>void enableCrush()}>开启微信聊天解读</button>}</div>
      {crushEnabled&&jevReady&&<div><h3>完整情绪与意图分布 · 一次开启</h3><p>微信先快速回复，网页报告再补全各类情绪和意图。开启一次后，打开新报告时会把最多 80 句、每句最多 160 字的可读聊天文字摘录发送给美国 TypeSafe AI（Jev）；旧报告仅在你主动打开时补全，不在后台批量发送。截图原图、语音文件、昵称字段和完整关系档案不发送，但聊天文字本身可能含个人信息。结果最多保存 7 天，可关闭后续发送或删除报告。百分比是模型分类分布，不是喜欢概率。<a href="https://typesafe.ai/legal/privacy-policy" target="_blank" rel="noreferrer">TypeSafe 隐私政策</a>，联系 privacy@typesafe.ai。</p>{!fullJevEnabled&&<label><input type="checkbox" checked={allowFullJev} onChange={event=>setAllowFullJev(event.target.checked)}/> 我有权提供这些聊天，并单独同意上述跨境处理；以后不必逐份确认</label>}<button className={fullJevEnabled?"wechat-secondary":"wechat-primary"} type="button" disabled={busy||(!fullJevEnabled&&!allowFullJev)} onClick={()=>void setFullJev(!fullJevEnabled)}>{fullJevEnabled?"关闭后续完整分类":"一次开启完整分布"}</button></div>}
      {crushEnabled&&quickJevEnabled&&<div><h3>六维互动信号</h3><p>这是额外的可选分析：开启后，本站会把同一对象最近最多 40 条、每条最多 160 字的聊天文字摘录发给美国的 TypeSafe AI，评估主动延续、回应投入、关心体贴、自我开放、亲密表达和实际行动。可能含双方个人信息；不发送原图、语音、昵称字段或完整关系档案。结果不是对方喜欢你的概率，材料不足就不显示总分。可随时关闭后续发送；<a href="https://typesafe.ai/legal/privacy-policy" target="_blank" rel="noreferrer">TypeSafe 隐私政策</a>及联系方式：privacy@typesafe.ai。</p>{!affinityEnabled&&<label><input type="checkbox" checked={allowAffinity} onChange={event=>setAllowAffinity(event.target.checked)} /> 我单独同意将上述最多 40 条聊天文字摘录发送给 TypeSafe AI 用于六维互动信号分析，并确认我有权提供</label>}<button className={affinityEnabled?"wechat-secondary":"wechat-primary"} type="button" disabled={busy||(!affinityEnabled&&!allowAffinity)} onClick={()=>void setAffinity(!affinityEnabled)}>{affinityEnabled?"关闭六维信号":"开启六维互动信号"}</button></div>}
    </section>
    <section className="wechat-card"><h2>截图识别 · 只需确认一次</h2><p>本人双人单聊截图的原图将发送给阿里云百炼识别。本站不归档原图；识别文字和报告最多保存7天。原图不会发给第三方分类服务；仅在另行同意后，限定文字摘录才会发送。关键事件只进入待确认区，你在网页确认后才成为长期档案。</p><p>请确认有权提供双方内容，避免包含无关敏感信息。不要使用群聊、他人转发给你的截图套用本人气泡设置；这些材料请在网页核对身份。</p><label className="wechat-link-row">本人截图哪一侧是我<select value={selfSide} onChange={event=>{setSelfSide(event.target.value);setAllowImage(false);}}><option value="right">右侧是我（通常绿色气泡）</option><option value="left">左侧是我</option></select></label><label><input type="checkbox" checked={allowImage} onChange={event=>setAllowImage(event.target.checked)}/> 我确认上述气泡身份，并单独同意原图发送给阿里云百炼识别</label><button type="button" className="wechat-primary" disabled={busy||!crushEnabled||!allowImage} onClick={()=>void setImageMapping(true)}>{imageEnabled?"保存截图设置":"开启截图快捷解读"}</button>{imageEnabled&&<button type="button" className="wechat-secondary" disabled={busy} onClick={()=>void setImageMapping(false)}>关闭截图识别</button>}<p>{imageEnabled?"已开启；当前微信可按已保存的气泡设置识别。":"尚未开启；不会自动把新截图发送给模型。"}</p></section>
    </details>
    <section className="wechat-card">
      <h2>连接你的微信</h2>
      {status?.links.length ? <>
        <p>已连接 {status.links.length} 个微信会话。发来的内容只会关联到你自己的档案。</p>
        {status.links.map((item) => <label className="wechat-link-row" key={item.id}>当前分析对象
          <select value={item.subjectId || ""} onChange={(event) => void setSubject(item.id, event.target.value)}>
            <option value="">不指定，先问清楚</option>
            {profile?.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.label}</option>)}
          </select>
        </label>)}
        <button className="wechat-secondary" type="button" onClick={() => void unbind()}>解除绑定</button>
      </> : <>
        <p>{profile?.enabled&&!profile.paused?"档案已开启，可直接生成一次性绑定码。绑定码 10 分钟后失效。":<>请先在上方一次开启分析与长期档案，或单独在<a href="/profile">关系档案</a>里授权，再生成绑定码。绑定码 10 分钟后失效。</>}</p>
        <button className="wechat-primary" type="button" disabled={busy || !status?.configured || !profile?.enabled || profile.paused} onClick={() => void createCode()}>生成绑定码</button>
        {code && <div className="wechat-code"><strong>{code}</strong><span>复制这串码，在微信客服会话里发送「绑定 {code}」</span></div>}
        {status?.kfUrl && <a className="wechat-open" href={status.kfUrl}>打开 成子 微信客服</a>}
        {status && !status.configured && <p className="wechat-warning">微信客服后台还没接通，暂时不能绑定。网页对话和实时语音仍可使用。</p>}
        <button className="wechat-secondary" type="button" onClick={() => void refresh()}>我已发送，刷新连接状态</button>
      </>}
      {notice && <p role="alert" className="wechat-warning">{notice}</p>}
    </section>
    <section className="wechat-card">
      <h2>完整能力在网页，微信只保留轻用法</h2>
      <p>推荐入口是截图。合并转发文字和单条语音属于补充方式：合并记录的语音可能只是占位，单独语音无法自动知道原聊天是谁说的。复杂说话人核对、长录音转写、完整历史与多对象比较，请在网页操作。</p>
      <p>你发给微信客服的内容会经企业微信接口送到本站，并发送给阿里云百炼完成识别和分析；分析图由本站托管服务 Cloudflare 渲染，包含本次原话与分析标签，不公开分享。仅在单独开启第三方快判断后，文字摘录才会再发送给 TypeSafe AI。原截图、原录音不在本站归档；等待处理的消息临时缓存最长 1 小时，处理后清空原始消息。开启逐句解读后，聊天文字与报告另行保存 7 天，可在逐句页面删除；归档线索仍需你去<a href="/profile">关系档案</a>确认。你也可以随时暂停档案或解除微信绑定。</p>
      <a className="wechat-open" href="/">进入实时语音对话</a>
    </section>
    </>}
  </main>;
}
