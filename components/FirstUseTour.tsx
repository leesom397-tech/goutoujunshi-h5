"use client";
import {useCallback,useEffect,useId,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {ArrowLeft,ArrowRight,Check,ScanLine,X} from "lucide-react";
import styles from "./FirstUseTour.module.css";

type Page="capture"|"analyze";
type Step={id:string;selector:string;title:string;text:string};
type Run={key:string;steps:Step[];index:number};
type Box={top:number;left:number;width:number;height:number};
const VERSION="2026-10-18-v2";
export const TOUR_EVENT="chengzi:show-operation-guide";
const memory=new Set<string>();
const storageKey=(owner:string,page:Page)=>"chengzi-first-use:"+JSON.stringify([VERSION,owner,page]);
const visible=(selector:string)=>Array.from(document.querySelectorAll<HTMLElement>(selector)).find(node=>{const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&getComputedStyle(node).visibility!=="hidden";});
function completed(key:string){try{return memory.has(key)||!!localStorage.getItem(key);}catch{return memory.has(key);}}
function remember(key:string){memory.add(key);try{localStorage.setItem(key,JSON.stringify({completedAt:Date.now()}));}catch{/* An unavailable store must not block using the page. */}}
function stepsFor(page:Page,method:string):Step[]{
 if(page==="analyze"){
  if(visible("[data-live-analysis]"))return[{id:"task",selector:"[data-live-analysis] h2",title:"进度和已完成结果都在这里",text:"识别原文会先出现。有疑点再核对，刷新会继续原任务，不必重复提交。"}];
  if(visible("#analysis-result .ax-result-heading"))return[{id:"report",selector:"#analysis-result .ax-result-heading",title:"报告已留在历史中",text:"先看判断和下一步；离开后可从顶部“历史”继续查看，不需要重新上传。"}];
  const available:Step[]=[
   {id:"upload",selector:"#analysis-upload",title:"先把材料放在这里",text:"选截图、拖进来或直接粘贴。聊天按最早到最新排列，每组最多 9 张。"},
   {id:"person",selector:'[data-tour="analysis-person"]',title:"认清双方，选好人物",text:"聊天先确认哪侧是你；关联人物后，新材料会接着已有档案分析。不选人物也能继续。"},
   {id:"confirm",selector:".ax-submit-row",title:"核对费用后，再开始",text:"检查上方实际张数与积分，勾选授权后再点“开始分析”。引导不会替你提交。"}
  ];
  return available;
 }
 if(visible("#capture-preview"))return[
  {id:"records",selector:'[aria-label="采集原文列表"]',title:"核对导入范围",text:"这里可以分页回看原文。完整关系报告使用已保存的全部可读聊天；尚未转写的语音会单独标明。"},
  {id:"selection",selector:'[data-tour="capture-selection"]',title:"确认本次分析范围",text:"完整聊天分析使用全部已保存的可读聊天，分页不会缩小范围。截图逐句解读只看本次上传。"},
  {id:"analysis",selector:'[data-tour="capture-analysis"]',title:"关联人物，确认后分析",text:"选好人物并核对材料；文字材料确认费用后分析，截图会进入左右身份与顺序确认。"}
 ];
 const common:Step={id:"method",selector:'[data-tour="capture-method"]',title:"先选适合你的采集方式",text:"Windows 可用本机助手；Mac / Windows 可共享窗口；手机可导入微信录屏。"};
 if(method==="video")return[common,
  {id:"kind",selector:'[aria-label="采集内容"]',title:"这段录屏是聊天还是朋友圈？",text:"每段只录一位好友。慢慢滑动并停顿，提取出来的文字会更清楚。"},
  {id:"video",selector:"[data-video-import] button",title:"选录屏，先在本机提取画面",text:"视频留在本机。选取片段并检查截图后，再进入分析确认；不会直接上传整段录屏。"}
 ];
 if(method==="window")return[common,
  {id:"friend",selector:'[data-tour="capture-friend"]',title:"先填好友与当前微信号",text:"用于在本机区分不同好友、不同微信账号。填好下方微信号后，窗口采集按钮就能使用。"},
  {id:"window",selector:'[aria-label="微信窗口自动截图"] button',title:"选择微信窗口，再开始截取",text:"共享后框选聊天或动态区域，慢慢滚动。暂停后先核对画面，再确认分析。"}
 ];
 return[
  {id:"connect",selector:'[data-tour="capture-connect"]',title:"下载网页上的助手",text:"点「下载 Windows 助手」，安装后回到这一页选择好友。截图和手机录屏也可以，不必先装助手。"},
  {id:"friend",selector:'[data-tour="capture-friend"]',title:"搜索名字，选中具体好友",text:"输入名字的一部分即可搜索。按头像、备注和微信号选中要导入的那位，再点击导入全部资料。"}
 ];
}

/** A tour describes visible controls; it never clicks, uploads, pairs or confirms for the user. */
export function FirstUseTour({owner,page,method="desktop",ready=true,auto=false}:{owner?:string;page:Page;method?:string;ready?:boolean;auto?:boolean}){
 const key=owner?storageKey(owner,page):"",[run,setRun]=useState<Run|null>(null),[box,setBox]=useState<Box|null>(null),[tip,setTip]=useState({top:0,left:0});
 const panel=useRef<HTMLDivElement>(null),portal=useRef<HTMLDivElement>(null),previousFocus=useRef<HTMLElement|null>(null),title=useId(),description=useId(),autoStarted=useRef(new Set<string>());
 const active=run&&run.key===key&&ready?run:null;
 const finish=useCallback(()=>{if(key)remember(key);setRun(null);setBox(null);},[key]);
 const start=useCallback(()=>{
  if(!key||!ready||document.querySelector("dialog[open]"))return;
  const steps=stepsFor(page,method).filter(step=>visible(step.selector)).slice(0,3);
  if(!steps.length)return;
  previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  setBox(null);setRun({key,steps,index:0});
 },[key,ready,page,method]);
 useEffect(()=>{setRun(null);setBox(null);},[key]);
 useEffect(()=>{
  const show=(event:Event)=>{const requested=(event as CustomEvent<{page?:Page}>).detail?.page;if(!requested||requested===page)start();};
  window.addEventListener(TOUR_EVENT,show);return()=>window.removeEventListener(TOUR_EVENT,show);
 },[start,page]);
 useEffect(()=>{
  if(!auto||!ready||!key||run?.key===key||completed(key)||autoStarted.current.has(key))return;
  const timer=setTimeout(()=>{if(document.querySelector("dialog[open]")||document.hidden)return;autoStarted.current.add(key);start();},650);
  return()=>clearTimeout(timer);
 },[auto,ready,key,start,run?.key]);
 useEffect(()=>{
  if(!active)return;
  const originalOverflow=document.body.style.overflow;
  const nodes=Array.from(document.body.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&node!==portal.current&&node.tagName!=="SCRIPT");
  const inert=nodes.map(node=>[node,node.inert] as const);inert.forEach(([node])=>{node.inert=true;});
  document.body.style.overflow="hidden";
  const focus=()=>panel.current?.querySelector<HTMLElement>("button")?.focus({preventScroll:true});
  const timer=requestAnimationFrame(focus);
  const onKey=(event:KeyboardEvent)=>{
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();event.stopImmediatePropagation();return;}
   if(event.key==="Escape"){event.preventDefault();event.stopPropagation();finish();return;}
   if(event.key!=="Tab")return;
   const items=Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")||[]);
   if(!items.length)return;
   const first=items[0],last=items[items.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  document.addEventListener("keydown",onKey,true);
  return()=>{cancelAnimationFrame(timer);document.removeEventListener("keydown",onKey,true);document.body.style.overflow=originalOverflow;inert.forEach(([node,value])=>{node.inert=value;});if(previousFocus.current?.isConnected)previousFocus.current.focus({preventScroll:true});};
 },[!!active,finish]);
 useEffect(()=>{
  if(!active)return;
  if(!active.steps.length){setRun(null);return;}
  const step=active.steps[active.index],target=visible(step.selector);
  if(!target){setRun(value=>value?{...value,steps:value.steps.filter(item=>item.id!==step.id),index:Math.max(0,value.index-1)}:null);return;}
  const first=target.getBoundingClientRect(),height=window.innerHeight,desiredTop=height<650?30:80;
  if(first.top<desiredTop||first.bottom>height-300)window.scrollTo({top:Math.max(0,window.scrollY+first.top-desiredTop),behavior:"instant"});
  let frame=0;
  const place=()=>{
   const rect=target.getBoundingClientRect(),width=window.innerWidth,height=window.innerHeight;
   const padding=6,left=Math.max(6,rect.left-padding),top=Math.max(6,rect.top-padding),right=Math.min(width-6,rect.right+padding),bottom=Math.min(height-6,rect.bottom+padding);
   const next={left,top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
   setBox(next);
   const card=panel.current?.getBoundingClientRect(),cardWidth=card?.width||Math.min(380,width-24),cardHeight=card?.height||260;
   let x=Math.max(12,Math.min(width-cardWidth-12,next.left)),y=next.top+next.height+16;
   if(width<600){y=height-cardHeight-12;if(next.top+next.height>y-12&&next.top-cardHeight-16>=12)y=next.top-cardHeight-16;}
   else if(y+cardHeight>height-12){if(next.top-cardHeight-16>=12)y=next.top-cardHeight-16;else if(right+cardWidth+24<width){x=right+16;y=Math.max(12,Math.min(height-cardHeight-12,next.top));}else y=height-cardHeight-12;}
   setTip({left:x,top:Math.max(12,y)});
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(place);};
  const observer=new ResizeObserver(schedule);observer.observe(target);if(panel.current)observer.observe(panel.current);
  window.addEventListener("resize",schedule);window.addEventListener("scroll",schedule,true);window.visualViewport?.addEventListener("resize",schedule);schedule();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener("resize",schedule);window.removeEventListener("scroll",schedule,true);window.visualViewport?.removeEventListener("resize",schedule);};
 },[active?.key,active?.index,active?.steps]);
 useEffect(()=>{if(active&&box&&!panel.current?.contains(document.activeElement))panel.current?.querySelector<HTMLElement>("button")?.focus({preventScroll:true});},[!!active,!!box]);
 if(!active||!active.steps.length)return null;
 const step=active.steps[active.index],last=active.index===active.steps.length-1;
 return createPortal(<div ref={portal} className={styles.root} data-first-use-tour data-tour-step={step.id}>
  <div className={styles.shield} aria-hidden="true"/>
  {box&&<div className={styles.highlight} data-tour-highlight style={{...box}} aria-hidden="true"/>}
  <div ref={panel} role="dialog" aria-modal="true" aria-label="操作引导" aria-labelledby={title} aria-describedby={description} className={styles.tip} style={{left:tip.left,top:tip.top,visibility:box?"visible":"hidden"}}>
   <header><span><ScanLine size={17}/>操作引导 · {active.index+1} / {active.steps.length}</span><button type="button" onClick={finish} aria-label="关闭操作引导"><X size={20}/></button></header>
   <h2 id={title}>{step.title}</h2><p id={description}>{step.text}</p>
   <footer><button type="button" className={styles.skip} onClick={finish}>跳过引导</button><div>{active.index>0&&<button type="button" className={styles.previous} onClick={()=>{setBox(null);setRun({...active,index:active.index-1});}} aria-label="上一步"><ArrowLeft size={18}/></button>}<button type="button" className={styles.next} onClick={()=>last?finish():(setBox(null),setRun({...active,index:active.index+1}))}>{last?<><Check size={17}/>知道了，开始使用</>:<>下一步<ArrowRight size={17}/></>}</button></div></footer>
  </div>
 </div>,document.body);
}
