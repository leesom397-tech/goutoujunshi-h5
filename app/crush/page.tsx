"use client";
import { BrandMark } from "@/components/BrandMark";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {ArrowLeft,ArrowRight,Check,Copy,Download,ImagePlus,MessageCircle,Plus,ScanText,ShieldCheck,Sparkles,Trash2} from "lucide-react";
import {CrushBubbles} from "@/components/crush-bubbles";
import {DecisionPanel} from "@/components/DecisionPanel";
import {drawLocalCard} from "@/lib/crush/local-card";
import type {CrushResult} from "@/lib/crush/types";
import {interactionScore} from "@/lib/crush/interaction-score";
type Status={enabled:boolean;imageEnabled:boolean;imageSelfSide:string;quickJevEnabled:boolean;fullJevEnabled:boolean;provider:"qwen"|"jev";jev:boolean;qwen:boolean;wechatConfigured:boolean;reports:{id:string;created_at:number;thread_id:string;subject_label?:string|null}[]};
const sample="我：周六一起去看展吗？\n对方：周六要加班，周日倒是有空。\n我：那周日下午？\n对方：可以呀，你挑一个～";
const demo:CrushResult={id:"demo",threadId:"demo",revision:1,provider:"qwen",model:"示例",createdAt:0,expiresAt:0,latencyMs:0,duplicateCount:0,lines:[
{id:"d1",speaker:"other",text:"周六要加班，周日倒是有空。"},
{id:"d2",speaker:"other",text:"可以呀，你挑一个～"}],annotations:[
{lineId:"d1",emotion:[{key:"calm",label:"平静"}],intent:[{key:"alternative",label:"提供替代安排"}],evidence:"limited",note:"不只是拒绝周六，还主动提出了可行时间。"},
{lineId:"d2",emotion:[{key:"positive",label:"轻松"}],intent:[{key:"agree",label:"接受邀约"}],evidence:"limited",note:"愿意一起安排，但不能仅凭两句话判断恋爱意愿。"}]};
export default function CrushPage(){
  const router=useRouter();
  const [auth,setAuth]=useState<"loading"|"in"|"out">("loading");
  const [status,setStatus]=useState<Status|null>(null),[subjects,setSubjects]=useState<{id:string;label:string}[]>([]);
  const [text,setText]=useState(""),[selfLabel,setSelfLabel]=useState(""),[subject,setSubject]=useState(""),[speaker,setSpeaker]=useState("other");
  const [screenshot,setScreenshot]=useState(""),[screenshotName,setScreenshotName]=useState(""),[selfSide,setSelfSide]=useState(""),[imagePermission,setImagePermission]=useState(false),[imageRights,setImageRights]=useState(false);
  const screenshotInput=useRef<HTMLInputElement>(null);
  const [consent,setConsent]=useState(false);
  const [jevConsent,setJevConsent]=useState(false),[quickResult,setQuickResult]=useState("");
  const [fullJevConsent,setFullJevConsent]=useState(false),[distributionBusy,setDistributionBusy]=useState(false);
  const [result,setResult]=useState<CrushResult|null>(null),[threadId,setThreadId]=useState<string>();
  const distributionAttempted=useRef(new Set<string>());
  const [busy,setBusy]=useState(""),[error,setError]=useState(""),[reply,setReply]=useState(""),[notice,setNotice]=useState("");
  const requestId=useRef<string|null>(null),sessionId=useRef<string|null>(null),resultRef=useRef<HTMLDivElement>(null);
  const [loginHref,setLoginHref]=useState("/login?return_to=%2Fcrush"),[imageUrl,setImageUrl]=useState("");
  useEffect(()=>()=>{if(imageUrl)URL.revokeObjectURL(imageUrl);},[imageUrl]);
  function newChat(){setSubject("");setThreadId(undefined);setResult(null);setQuickResult("");setReply("");setText("");setScreenshot("");setScreenshotName("");setSelfSide("");setImagePermission(false);setSelfLabel("");setImageUrl("");setError("");requestId.current=null;sessionId.current=crypto.randomUUID();setNotice("已开启新的临时聊天，不会带入上一段聊天的上下文。");}
  async function load(){
    const response=await fetch("/api/crush",{cache:"no-store"});
    if(response.status===401){setAuth("out");return false;}
    const data=await response.json() as Status & {error?:string};if(!response.ok)throw Error(data.error||"暂时无法读取分析设置。");
    setAuth("in");setStatus(data);
    const profiles=await fetch("/api/profile",{cache:"no-store"});if(profiles.ok)setSubjects((await profiles.json() as {subjects?:{id:string;label:string}[]}).subjects||[]);
    return true;
  }
  useEffect(()=>{const timer=setTimeout(()=>{void load().then(authenticated=>{const id=new URLSearchParams(window.location.search).get("id");if(id&&/^[a-f0-9-]{36}$/.test(id)){setLoginHref("/login?return_to="+encodeURIComponent("/crush?id="+id));if(authenticated)void openReport(id);}}).catch(e=>{setError(e.message);setAuth("out");});},0);return()=>clearTimeout(timer);},[]);
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search),token=params.get("share"),failure=params.get("share_error");
    if(failure){const message=failure==="invalid"?"分享的文件不是 5 MB 内的 PNG/JPG 截图，请在页面手动选择。":failure==="login"?"先登录 成子，再从相册分享截图；未登录的分享没有保存。":"系统分享未能交给网页，请在页面手动选择截图。";window.history.replaceState({},"","/crush");const timer=window.setTimeout(()=>setNotice(message),0);return()=>window.clearTimeout(timer);}
    if(!token||!/^[a-f0-9-]{36}$/.test(token)||auth==="loading")return;
    if(auth==="out"){const href="/login?return_to="+encodeURIComponent("/crush?share="+token);const timer=window.setTimeout(()=>setLoginHref(href),0);return()=>window.clearTimeout(timer);}
    let cancelled=false;
    void (async()=>{
      const cache=await caches.open("lovetalk-local-share-v1"),key=new Request(new URL("/.local-shares/"+token,window.location.origin));
      const response=await cache.match(key);
      if(!response)throw Error("手机分享的截图已过期或未找到，请重新分享。");
      const sessionResponse=await fetch("/api/auth/session",{cache:"no-store"});
      const session=sessionResponse.ok?await sessionResponse.json() as {loggedIn?:boolean;user?:{id?:string}}:null;
      if(!session?.loggedIn||!session.user?.id||session.user.id!==response.headers.get("X-Share-Owner")){await cache.delete(key);throw Error("登录账号与分享截图时不同，已删除本地截图；请在当前账号下重新分享。");}
      const created=Number(response.headers.get("X-Shared-At")||0),type=response.headers.get("Content-Type")||"";
      if(Date.now()-created>15*60*1000||!["image/png","image/jpeg"].includes(type)){await cache.delete(key);throw Error("分享的截图已过期或格式不支持，请重新分享。");}
      const blob=await response.blob();
      if(blob.size<16||blob.size>5_000_000){await cache.delete(key);throw Error("截图超过 5 MB，请选择更小的图片。");}
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(Error("截图读取失败"));reader.readAsDataURL(blob);});
      await cache.delete(key);
      if(cancelled)return;
      setScreenshot(data);setScreenshotName("手机分享的聊天截图");setText("");setQuickResult("");setSelfSide("");setImagePermission(false);setImageRights(false);requestId.current=null;
      setNotice("已接收手机分享的截图。请先核对双方气泡、本人所在侧和材料提供权，再点解读；没有自动上传。");
      window.history.replaceState({},"","/crush");
    })().catch(cause=>{if(!cancelled){setError(cause instanceof Error?cause.message:"分享的截图读取失败，请重试。");window.history.replaceState({},"","/crush");}});
    return()=>{cancelled=true;};
  },[auth]);
  async function post<T={ok:boolean}>(data:unknown):Promise<T>{
    const response=await fetch("/api/crush",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    const output=await response.json() as T & {error?:string};if(!response.ok)throw Error(output.error||"处理暂时未完成。");return output;
  }
  async function recoverScreenshot(id:string|null):Promise<CrushResult>{
    if(!id)throw Error("没有找到这次截图的请求编号，请重新提交。");
    setBusy("连接中断，正在确认截图是否已完成…");
    for(let attempt=0;attempt<20;attempt++){
      if(attempt)await new Promise(resolve=>window.setTimeout(resolve,3000));
      let response:Response;
      try{response=await fetch("/api/crush/screenshot/status?requestId="+encodeURIComponent(id),{cache:"no-store"});}
      catch{if(attempt===19)break;continue;}
      const value:unknown=await response.json().catch(()=>null);
      if(response.status===401)throw Error("登录状态已过期，请重新登录后查看。");
      if(!response.ok)throw Error(value&&typeof value==="object"&&"error" in value&&typeof value.error==="string"?value.error:"暂时无法查询截图进度，请保留页面后重试。");
      if(value&&typeof value==="object"&&"status" in value&&value.status==="done"&&"result" in value&&value.result&&typeof value.result==="object"){
        setBusy("截图已完成，正在整理报告…");
        return value.result as CrushResult;
      }
      if(value&&typeof value==="object"&&"status" in value&&value.status==="retry")throw Error("这次截图没有完成，已保留图片；请重新提交。");
    }
    throw Error("截图仍在处理中或暂时查不到结果；请稍后重试，重复提交会沿用同一请求编号。");
  }
  async function enrichDistribution(report:CrushResult){
    if(report.id==="demo"||report.provider==="jev"||distributionAttempted.current.has(report.id))return;
    distributionAttempted.current.add(report.id);
    setDistributionBusy(true);
    try{
      const updated=await post<CrushResult>({action:"enrichDistribution",reportId:report.id});
      setResult(current=>current?.id===report.id?updated:current);
    }catch(cause){setNotice("完整情绪与意图分布本次未完成；已保留原逐句报告。"+(cause instanceof Error?" "+cause.message:""));}
    finally{setDistributionBusy(false);}
  }
  useEffect(()=>{if(!status?.fullJevEnabled||!result||result.provider==="jev")return;const report=result;const timer=window.setTimeout(()=>{void enrichDistribution(report);},0);return()=>window.clearTimeout(timer);},[status?.fullJevEnabled,result?.id,result?.provider]);
  async function setFullJev(enabled:boolean){
    if(enabled&&!fullJevConsent){setError("请先确认完整分类的第三方处理范围。");return;}
    setBusy("正在保存完整分布设置…");setError("");
    try{
      await post({action:"fullJev",enabled,allowJevFull:enabled&&fullJevConsent});
      setStatus(current=>current?{...current,fullJevEnabled:enabled}:current);
      setFullJevConsent(false);
      setNotice(enabled?"已一次性开启完整分布：今后新报告将自动补全；旧报告不自动补发。":"已关闭后续第三方完整分类；现有报告按原期限保存，可删除。");
      if(enabled&&result&&result.id!=="demo"&&result.provider!=="jev")void enrichDistribution(result);
    }catch(cause){setError(cause instanceof Error?cause.message:"设置未完成。");}
    finally{setBusy("");}
  }
  async function chooseScreenshot(file?:File){
    if(!file)return;
    if(!["image/png","image/jpeg"].includes(file.type)||file.size>5_000_000){setError("请选 5 MB 内的 PNG 或 JPG 聊天截图。");return;}
    try{
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(Error("图片读取失败"));reader.readAsDataURL(file);});
      if(!/^data:image\/(?:png|jpeg);base64,/.test(data))throw Error("请选 PNG 或 JPG 截图。");
      setScreenshot(data);setScreenshotName(file.name);setText("");setQuickResult("");setSelfSide("");setImagePermission(false);setImageRights(false);setError("");requestId.current=null;
    }catch(error){setError(error instanceof Error?error.message:"图片读取失败，请重新选择。");}
  }
  async function analyze(){
    if(auth!=="in"){router.push(loginHref);return;}
    if(!text.trim()&&!screenshot){setError("先上传一张聊天截图、粘贴一段聊天，或者点「填入示例」。");return;}
    if(screenshot&&!selfSide){setError("请先选择截图里哪侧气泡是你。");return;}
    if(screenshot&&!imageRights){setError("请先确认这张截图属于你有权提供的本人双人单聊。");return;}
    setBusy(screenshot?"正在读取截图里的每句话…":"正在结合上下文逐句解读…");setError("");setReply("");setImageUrl("");setNotice("");
    try{
      if(!status?.enabled||status.provider!=="qwen"){
        if(!consent)throw Error("请先确认有权提供聊天，并同意本次处理与短期保存。");
        await post({action:"settings",enabled:true,provider:"qwen"});
        setStatus(current=>current?{...current,enabled:true,provider:"qwen",quickJevEnabled:false}:current);
      }
      requestId.current ||= crypto.randomUUID();
      sessionId.current ||= crypto.randomUUID();
      let output:CrushResult;
      if(screenshot){
        if(!status?.imageEnabled||status.imageSelfSide!==selfSide){
          if(!imagePermission)throw Error("请单独同意把截图发给阿里云百炼，并确认哪侧是你。");
          await post({action:"imageMapping",enabled:true,selfSide,allowImageProcessing:true});
          setStatus(current=>current?{...current,imageEnabled:true,imageSelfSide:selfSide}:current);
        }
        try{
          const response=await fetch("/api/crush/screenshot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:screenshot,confirmed:true,selfSide,requestId:requestId.current,sessionId:sessionId.current,threadId,subjectId:subject||null})});
          const data=await response.json() as CrushResult&{error?:string;processing?:boolean};
          if(response.ok)output=data;
          else if(data.processing)output=await recoverScreenshot(requestId.current);
          else throw Error(data.error||"截图解读未完成。");
        }catch(cause){if(!(cause instanceof TypeError))throw cause;output=await recoverScreenshot(requestId.current);}
        setScreenshot("");setScreenshotName("");setImageRights(false);if(screenshotInput.current)screenshotInput.current.value="";
      }else output=await post<CrushResult>({action:"analyze",text,selfLabel,subjectId:subject||null,speaker,sessionId:sessionId.current,requestId:requestId.current,threadId});
      setResult(output);setThreadId(output.threadId);requestId.current=null;
      if(status?.fullJevEnabled)void enrichDistribution(output);
      setNotice(output.duplicateCount?"已跳过 "+output.duplicateCount+" 条有明确时间或连续上下文的重复消息。":"已结合当前对象的近期上下文。可继续追加，不用重新解释。");
      const refresh=await fetch("/api/crush",{cache:"no-store"});if(refresh.ok)setStatus(await refresh.json() as Status);
      setTimeout(()=>resultRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),80);
    }catch(e){setError(e instanceof Error?e.message:"分析未完成，请重试。");}finally{setBusy("");}
  }
  async function quickLook(){
    if(auth!=="in"){router.push(loginHref);return;}
    if(!text.trim()||screenshot){setError("快判断先粘贴文字；截图请用下方完整逐句解读。");return;}
    setBusy("正在看最新一句…");setError("");setQuickResult("");
    try{
      if(!status?.enabled){
        if(!consent)throw Error("请先确认聊天处理与短期保存授权。");
        await post({action:"settings",enabled:true,provider:"qwen"});
        setStatus(current=>current?{...current,enabled:true,provider:"qwen",quickJevEnabled:false}:current);
      }
      if(!status?.quickJevEnabled){
        if(!jevConsent)throw Error("请单独同意第三方服务处理最多 6 条聊天文字后，再使用快判断。");
        await post({action:"quickJev",enabled:true,allowJev:true});
        setStatus(current=>current?{...current,quickJevEnabled:true}:current);
      }
      const output=await fetch("/api/crush/quick",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,subjectId:subject,selfLabel,speaker})});
      const data=await output.json() as {quick?:string;contextCount?:number;error?:string};
      if(!output.ok||!data.quick)throw Error(data.error||"快判断暂未完成。");
      setQuickResult(data.quick);
    }catch(cause){setError(cause instanceof Error?cause.message:"快判断暂未完成。");}
    finally{setBusy("");}
  }
  async function advice(){
    if(!result||result.id==="demo")return;
    setBusy("正在结合知识库生成下一步…");setError("");
    try{setReply((await post<{reply:string}>({action:"advice",reportId:result.id})).reply);}catch(e){setError((e as Error).message);}finally{setBusy("");}
  }
  async function refreshAffinity(){
    if(!result||result.id==="demo")return;
    setBusy("正在单独计算六维互动图…");setError("");
    try{setResult(await post<CrushResult>({action:"refreshAffinity",reportId:result.id}));}catch(e){setError((e as Error).message);}finally{setBusy("");}
  }
  async function download(){
    if(!result||result.id==="demo")return;
    setBusy("正在生成分析卡片…");setError("");
    try{
      const response=await fetch("/api/crush?id="+encodeURIComponent(result.id),{cache:"no-store"});
      const fresh=await response.json() as CrushResult & {error?:string};
      if(!response.ok)throw Error(fresh.error||"报告已删除或过期，无法保存。");
      const url=URL.createObjectURL(await drawLocalCard(fresh));setImageUrl(url);
      const a=document.createElement("a");a.href=url;a.download="聊天解读.jpg";a.click();
      setNotice("分析图已生成。如手机没有自动下载，请长按下方图片保存。");
    }catch(e){setError((e as Error).message);}finally{setBusy("");}
  }
  async function remove(){
    if(!confirm("关闭逐句解读并删除全部逐句聊天记录和报告？关系档案不会被删除。"))return;
    setBusy("正在删除…");setError("");
    try{const r=await fetch("/api/crush",{method:"DELETE"});if(!r.ok)throw Error("删除暂时未完成。");setResult(null);setThreadId(undefined);setReply("");setImageUrl("");setConsent(false);requestId.current=null;await load();setNotice("逐句聊天与报告已删除，处理授权已关闭。");}catch(e){setError((e as Error).message);}finally{setBusy("");}
  }
  async function openReport(id:string){
    setBusy("正在打开报告…");setError("");
    try{const r=await fetch("/api/crush?id="+encodeURIComponent(id),{cache:"no-store"});const d=await r.json() as CrushResult & {error?:string};if(!r.ok)throw Error(d.error);setResult(d);setSubject(d.subjectId||"");setSelfLabel(d.selfLabel||"");setThreadId(d.threadId);setReply("");setImageUrl("");requestId.current=null;setNotice("已打开原会话。追加内容会结合这份记录，或点「新聊天」从头开始。");if(status?.fullJevEnabled)void enrichDistribution(d);}catch(e){setError((e as Error).message);}finally{setBusy("");}
  }
  return <main className="crush-page">
    <header className="crush-header"><Link href="/" className="crush-brand"><span className="brand-mark"><BrandMark/></span><span>成子<small>聊天副驾</small></span></Link><Link href="/"><ArrowLeft size={15}/> 返回工作台</Link></header>
    <section className="crush-intro"><div className="crush-eyebrow"><ScanText size={15}/> 不用猜，先看这句话怎么说</div><h1>把聊天贴过来，<br/><em>一句一句看清楚。</em></h1><p>语气、互动好感信号、下一步。帮你少误读、回得更自然；互动评分不代表对方真实喜欢你的概率。</p><div className="crush-promises"><span><Check size={14}/> 消息下直接标注</span><span><Check size={14}/> 记住同一对象的上下文</span><span><Check size={14}/> 接着帮你回</span></div></section>
    <div className={"crush-workspace"+(result?"":" demo-first")}><section className="crush-input-panel">
      <div className="crush-panel-title"><span className="crush-step">01</span><h2>发截图或粘贴聊天</h2><button className="crush-quiet" disabled={!!busy} onClick={()=>{setScreenshot("");setScreenshotName("");setText(sample);setSelfLabel("");requestId.current=null;setError("");}}>填入示例</button>{auth==="in"&&<button className="crush-quiet" disabled={!!busy} onClick={newChat}>新聊天</button>}</div>
      <div className="crush-fields"><label>和谁的聊天<select value={subject} disabled={!!busy||auth!=="in"} onChange={e=>{setSubject(e.target.value);setThreadId(undefined);setResult(null);setQuickResult("");setReply("");setImageUrl("");setText("");setScreenshot("");setScreenshotName("");requestId.current=null;sessionId.current=crypto.randomUUID();}}><option value="">临时对象 · 不建长期档案</option>{subjects.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label><label>你的微信昵称<input value={selfLabel} maxLength={60} disabled={!!busy||auth!=="in"||!!screenshot} onChange={e=>{setSelfLabel(e.target.value);setQuickResult("");requestId.current=null;}} placeholder="用了「我：」可以不填"/></label></div>
      <input ref={screenshotInput} type="file" accept="image/png,image/jpeg" hidden onChange={event=>void chooseScreenshot(event.target.files?.[0])}/>
      <button className="crush-upload" type="button" disabled={!!busy||auth!=="in"} onClick={()=>screenshotInput.current?.click()}><ImagePlus size={20}/><span><strong>{screenshot?"更换聊天截图":"上传一张微信聊天截图"}</strong><small>相册选图；Android 安装 成子 后也可从相册“分享”进来 · 语音先转文字</small></span><ArrowRight size={16}/></button>
      {screenshot&&<div className="crush-screenshot"><img src={screenshot} alt="待分析的本人微信单聊截图"/><p>{screenshotName} · 请核对双方气泡完整可读</p><label>截图里哪侧是我<select value={selfSide} onChange={event=>{setSelfSide(event.target.value);setImagePermission(false);setImageRights(false);requestId.current=null;}}><option value="">请选择哪侧是我</option><option value="right">右侧是我</option><option value="left">左侧是我</option></select></label><label><input type="checkbox" checked={imageRights} onChange={event=>setImageRights(event.target.checked)}/> 我确认有权提供这张本人双人单聊截图</label>{(!status?.imageEnabled||status.imageSelfSide!==selfSide)&&<label><input type="checkbox" checked={imagePermission} onChange={event=>setImagePermission(event.target.checked)}/> 单独同意原图发给阿里云百炼识别，原图不进入长期档案</label>}<button type="button" className="crush-quiet" onClick={()=>{setScreenshot("");setScreenshotName("");}}>改用文字粘贴</button></div>}
      <label className="crush-chat-label" htmlFor="chat-input">聊天原文 <span>支持逐条粘贴或多段记录</span></label>
      <textarea id="chat-input" value={text} maxLength={12000} readOnly={auth!=="in"} disabled={!!busy||!!screenshot} onChange={e=>{setText(e.target.value);setQuickResult("");requestId.current=null;}} placeholder={"我：周六一起去看展吗？\n对方：周六要加班，周日倒是有空。\n\n只粘贴一句也可以；不带昵称时，选择是谁说的。"} />
      <div className="crush-input-meta"><label>无昵称的文字来自 <select value={speaker} disabled={!!busy||auth!=="in"} onChange={e=>{setSpeaker(e.target.value);requestId.current=null;}}><option value="other">对方</option><option value="self">我</option></select></label><span>{text.length.toLocaleString()} / 12,000</span></div>
      {auth==="in"&&<details className="crush-settings"><summary>如何分析 · 自动处理</summary><p>截图由千问一次识别完整可见气泡；微信先回逐句短判断，再自动发送彩色逐句图。网页可直接上传截图并在同一对象会话里接续，截断气泡会单独标记。六维互动图按需计算。<Link href="/wechat">查看微信设置</Link>。句子百分比是模型的相对解释权重，不是好感概率。</p></details>}
      {auth==="in"&&(!status?.enabled||status.provider!=="qwen")&&<label className="crush-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>我有权提供这些聊天，已去除不必要的身份信息，同意发送给阿里云千问处理，并在本站保存聊天文字及分析报告 7 天。可随时关闭并删除。</span></label>}
      {auth==="in"&&status?.jev&&!status.quickJevEnabled&&!screenshot&&<label className="crush-consent"><input type="checkbox" checked={jevConsent} onChange={e=>setJevConsent(e.target.checked)}/><span>单独同意最多 6 条聊天文字发送给第三方快判服务；不发送长期关系档案，本站不保存快判原文。可在设置中关闭。</span></label>}
      {auth==="in"&&!screenshot&&<button type="button" className="crush-quick-button" disabled={!!busy||!status?.jev} onClick={quickLook}><ScanText size={17}/>{status?.jev?"先看最新一句 · 快判断":"快判断暂未接通"}</button>}
      {quickResult&&<div className="crush-quick-result" role="status"><strong>最新一句 · 快判断</strong><p>{quickResult}</p><small>只参考最多 6 条近期文字；不会读取语音或推测真实好感。下方可继续生成完整逐句报告。</small></div>}
      <button className="crush-primary" disabled={!!busy||auth==="loading"} onClick={analyze}>{busy?<><span className="crush-spinner"/>{busy}</>:<><Sparkles size={17}/>{auth==="out"?"登录后解读我的聊天":screenshot?"解读这张截图":result&&result.id!=="demo"?"追加并分析":"开始逐句解读"}<ArrowRight size={17}/></>}</button>
      {auth==="out"&&<p className="crush-small">先看示例效果，登录后再粘贴私密聊天。<Link href={loginHref}>用 成子 账号登录</Link>。</p>}
      {error&&<p className="crush-error" role="alert">{error}</p>}
      {notice&&<p className="crush-small" role="status">{notice}</p>}
      <div className="crush-privacy"><ShieldCheck size={16}/><span>只对你本人可见 · 原文短期保留 · 不替对方读心</span></div>
    </section><section className="crush-result-panel" ref={resultRef}>
      <div className="crush-panel-title"><span className="crush-step">02</span><h2>{result?"逐句解读":"你会看到这样的结果"}</h2><span className="crush-source">{result?(result.provider==="jev"?"快速分类":"深度解读"):"演示 · 非实时结果"}</span></div>
      {auth==="in"&&status?.enabled&&status.jev&&<section className="crush-affinity" aria-label="完整情绪与意图分布设置"><strong>完整情绪与意图分布</strong>{status.fullJevEnabled?<><p>一次授权已开启。新报告先显示原判断，再自动补全分类；历史报告只在你打开时补全。{distributionBusy?" 正在补全本报告…":""}</p><button disabled={!!busy} onClick={()=>void setFullJev(false)}>关闭后续完整分类</button></>:<><p>开启一次后，新报告将把最多 80 句、每句最多 160 字的可读聊天文字摘录发送给美国 TypeSafe AI（Jev）做完整情绪与意图分类。截图原图、语音文件、昵称字段和完整关系档案不发送；文字本身仍可能含个人信息。已存报告只在你打开时补全，关闭后停止后续发送。结果和原报告最多保存 7 天，可删除。<a href="https://typesafe.ai/legal/privacy-policy" target="_blank" rel="noreferrer">查看 TypeSafe 隐私政策</a>。</p><label className="crush-consent"><input type="checkbox" checked={fullJevConsent} onChange={event=>setFullJevConsent(event.target.checked)}/><span>我有权提供这些聊天，并单独同意上述跨境文字处理；以后不必逐份确认</span></label><button disabled={!!busy||!fullJevConsent} onClick={()=>void setFullJev(true)}>一次开启完整分布</button></>}</section>}
      {result?.decision&&<DecisionPanel key={result.id} result={result}/>}
      {result?.decision?.affinityDeferred&&<section className="crush-affinity"><p>六维图按需计算，不拖慢回复。</p><button disabled={!!busy} onClick={refreshAffinity}>计算六维互动图</button></section>}
      {result?.affinity&&<section className="crush-affinity" aria-label="六维互动信号"><div className="crush-affinity-top"><span>好感互动信号 · 六维</span><strong>{result.affinity.value===null?"总分待验证":(result.affinity.valueScope==="partial"?"片段 ":"")+result.affinity.value+"/100"}</strong></div><p>基于最近 {result.affinity.contextCount} 条可见文字，依据六维互动信号规则；不是对方喜欢你的概率。{result.affinity.valueScope==="partial"?"当前是已知维度的参考指数，覆盖权重 "+result.affinity.coverageWeight+"%，不是完整六维总分。":""}{result.affinity.value===null||result.affinity.valueScope==="partial"?"未涉及的维度标为待验证，不计零分。":""}{result.affinity.boundaryApplied?"出现明确边界时，评分已受限制。":""}</p><div className="crush-affinity-grid">{result.affinity.dimensions.map(d=><div className="crush-affinity-row" key={d.key}><span>{d.label}</span><div className="crush-affinity-track"><i style={{width:(d.value??0)+"%"}}/></div><b>{d.value===null?"待验证":d.value}</b></div>)}</div></section>}
      {!result?.affinity&&result?.decision?.affinityPreview&&<section className="crush-affinity" aria-label="截图片段互动参考"><div className="crush-affinity-top"><span>综合互动参考</span><strong>{interactionScore(result).value+"/100"}{interactionScore(result).estimated?"（这轮暂估）":""}</strong></div><p>只依据本次可见文字{interactionScore(result).estimated?"做粗估；文字越少误差越大；":"，已覆盖 "+result.decision.affinityPreview.coverageWeight+"% 维度权重；"}缺失场景不计零分，也不是喜欢概率。后续可在同一对象中补充聊天，得到更稳的综合判断。</p><div className="crush-affinity-grid">{result.decision.affinityPreview.dimensions.map(d=><div className="crush-affinity-row" key={d.key}><span>{d.label}</span><div className="crush-affinity-track"><i style={{width:(d.value??0)+"%"}}/></div><b>{d.value===null?"未见场景":d.value}</b></div>)}</div></section>}
      {result?.decision?.replyReview&&<section className="crush-affinity"><strong>你已发回复的评价{result.decision.replyGrade?" · "+result.decision.replyGrade+" 级":""}</strong><p>{result.decision.replyReview}</p></section>}
      {!result?.affinity&&result?.affinityStatus==="unavailable"&&<p className="crush-error" role="status">好感评分服务本次未成功，不是聊天证据不足。逐句报告已保留，可稍后追加新消息重试。</p>}
      {result?.affinityStatus==="unread_media"&&<p className="crush-error" role="status">这份记录包含未读取的语音或附件正文，不能用占位文字判断关系，相关评分已停止展示。请复制微信的语音转写文字，或上传有权提供的录音；不要再次只转发语音占位。<Link href="/import">导入录音</Link></p>}
      {!!result?.unreadMediaCount&&<p className="crush-small">已读正文 {result.readableLineCount} 条；另有 {result.unreadMediaCount} 条未读取的语音或附件，占位符不参与分析。</p>}
      {!result?.affinity&&result?.affinityStatus==="insufficient"&&<p className="crush-small">当前可读的双方互动尚不足，暂不出六维总分；下面展示已读消息的逐句线索。</p>}
      {result?.coverage&&<p className="crush-small">导入 {result.coverage.total} 条，其中语音 {result.coverage.voice} 条，成功转写 {result.coverage.transcribed} 条。{result.coverage.noMedia?"微信未提供 "+result.coverage.noMedia+" 条语音的可下载音频。":""}{result.coverage.failedVoice?result.coverage.failedVoice+" 条语音转写未成功。":""}{result.coverage.multiSpeaker?result.coverage.multiSpeaker+" 条多说话人录音尚未确认身份。":""}{result.coverage.overLimit?result.coverage.overLimit+" 条语音请分段导入。":""}只依据已读文字分析，未读附件不视为关系负面信号。</p>}
      <CrushBubbles result={result||demo}/>
      <div className="crush-result-foot"><p>{result?.provider==="jev"?"数字来自第三方模型的分类分布，不代表真实动机或恋爱概率。":"文字标签是基于上下文的推测，不是已证实的事实。"}<br/>明确拒绝就是边界，不解释成欲擒故纵。</p>{result&&<span>报告保留至 {new Date(result.expiresAt).toLocaleDateString("zh-CN")}</span>}</div>
      {result&&<div className="crush-result-actions"><button disabled={!!busy} onClick={advice}><MessageCircle size={16}/> 我怎么回</button><button disabled={!!busy} onClick={download}><Download size={16}/> 保存分析图</button></div>}
      {imageUrl&&<div className="crush-image-preview"><p>长按保存分析图 · 仅供自己使用，请勿公开他人隐私</p>{/* Browser-generated JPEG, not an external or user-provided URL. */}<img src={imageUrl} alt="当前聊天的逐句分析卡片" /><a href={imageUrl} download="聊天解读.jpg">下载图片</a></div>}
      {reply&&<div className="crush-advice"><div><Sparkles size={15}/><strong>结合知识库的下一步</strong><button className="crush-quiet" onClick={()=>{void navigator.clipboard.writeText(reply).then(()=>setNotice("回复建议已复制。")).catch(()=>setNotice("浏览器未允许复制，请长按文字复制。"));}}><Copy size={14}/> 复制</button></div><p>{reply}</p></div>}
      {!result&&<button className="crush-demo-action" onClick={()=>{setText(sample);requestId.current=null;document.getElementById("chat-input")?.focus();}}><Plus size={16}/> 用这段示例试一遍</button>}
    </section></div>
    <section className="crush-bottom"><Link href="/wechat"><MessageCircle size={19}/><span><strong>微信随手聊 · 查看接入状态</strong><small>{status?.wechatConfigured?"连接后可发文字、截图和语音消息。":"微信客服暂未接通，当前请先在网页使用。"}</small></span><ArrowRight size={16}/></Link>{auth==="in"&&<button disabled={!!busy} onClick={remove}><Trash2 size={15}/> 关闭并删除逐句记录</button>}</section>
    {!!status?.reports?.length&&<section className="crush-history"><h2>最近的分析 <small>7 天内</small></h2><div>{status.reports.map(r=><button disabled={!!busy} key={r.id} onClick={()=>void openReport(r.id)}>{r.subject_label||"临时对象"} · {new Date(r.created_at).toLocaleString("zh-CN")} <ArrowRight size={13}/></button>)}</div></section>}
  </main>;
}


