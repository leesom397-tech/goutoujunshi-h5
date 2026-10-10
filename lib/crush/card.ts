import {env} from "cloudflare:workers";
import {CrushError,probabilityText,type CrushResult,type Tag} from "./types";
import {coverageText} from "./merged";
import {readableReport,unavailableMedia,unreadMediaGuidance} from "./evidence";
import {rankedReplyOptions} from "./reply-options";
import {interactionScore} from "./interaction-score";
export const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export function reportLink(id:string){return "https://coach.lovetalk.love/crush?id="+encodeURIComponent(id);}
export function affinityText(result:CrushResult){
  result=readableReport(result);
  if(result.affinityStatus==="unread_media")return "语音正文未读取，这份记录不展示好感评分。";
  if(result.affinity){
    const signal=result.affinity;
    return "好感互动信号："+(signal.value===null?"总分待验证":signal.valueScope==="partial"?"片段参考 "+signal.value+"/100（覆盖权重 "+signal.coverageWeight+"%，非完整总分）":signal.value+"/100")+"；不是喜欢概率"+(signal.boundaryApplied?"；已有明确边界，不宜继续推进":"")+"\n"+signal.dimensions.map(d=>d.label+" "+(d.value===null?"待验证":d.value)).join(" · ");
  }
  if(result.affinityStatus==="unavailable")return "好感评分服务本次未成功，不是聊天证据不足；逐句解读仍可看。";
  if(result.affinityStatus==="insufficient")return "好感互动信号：当前可读的双方互动尚不足，先展示逐句线索。";
  return "";
}
const utf8=(text:string)=>new TextEncoder().encode(text).length;
function byteClip(text:string,limit:number){let result="";for(const c of text){if(utf8(result+c)>limit)break;result+=c;}return result.length<text.length?result+"…":result;}
export function formatWechatPages(result:CrushResult){
  result=readableReport(result);
  if(result.readableLineCount===0)return [unreadMediaGuidance(result.lines)+"\n原记录："+reportLink(result.id)];
  const signal=affinityText(result);
  const coverage=result.coverage?byteClip(coverageText(result.coverage),480):"";
  const common=[signal,coverage].filter(Boolean).join("\n");
  const lines=result.lines.map((line,index)=>{
    const a=result.annotations.find(item=>item.lineId===line.id);
    const quote=(index+1)+". "+(line.speaker==="self"?"我":"对方")+"：「"+line.text.slice(0,32)+(line.text.length>32?"…":"")+"」";
    if(unavailableMedia(line.text))return quote+"\n未读取正文，不参与判断或评分。";
    if(!a||a.evidence==="insufficient")return quote+"\n这句含义待验证，原文已保留。";
    const tags=(values:typeof a.emotion)=>values.filter(t=>t.probability===undefined||t.probability>0).slice(0,2).map(t=>t.label.slice(0,12)+(t.probability===undefined?"":" "+probabilityText(t.probability))).join(" / ");
    return quote+"\n"+tags(a.emotion)+" · "+tags(a.intent)+(a.evidence==="limited"?"（暂判）":"");
  });
  const bodyBudget=1900-utf8(common)-utf8(reportLink(result.id))-300;
  const groups:string[][]=[[]];
  for(const line of lines){let group=groups.at(-1)!;if(group.length&&(group.length>=8||utf8([...group,line].join("\n\n"))>bodyBudget)){group=[];groups.push(group);}group.push(line);}
  return groups.map((group,index)=>"【逐句报告 · "+(index+1)+"/"+groups.length+" 页】已读正文 "+result.readableLineCount+" 条"+(result.unreadMediaCount?"，另有 "+result.unreadMediaCount+" 条未读占位":"")+"\n"+(common?common+"\n\n":"")+group.join("\n\n")+"\n\n"+(index+1<groups.length?"发「第"+(index+2)+"页」继续，或":"")+"发「怎么回」问建议。标签是推测。\n完整报告："+reportLink(result.id));
}
export function formatWechatText(result:CrushResult,page=1){
  const pages=formatWechatPages(result);
  if(!Number.isSafeInteger(page)||page<1||page>pages.length)throw new CrushError("这份报告共 "+pages.length+" 页，请发送有效页码，例如「第1页」。",400);
  return pages[page-1];
}
export function formatWechatBriefPages(result:CrushResult,subjectLabel="当前对象",pendingEvents=0){
  result=readableReport(result);
  if(!result.readableLineCount)return formatWechatPages(result);
  const blocks=result.lines.map((line,index)=>{
    const a=result.annotations.find(item=>item.lineId===line.id);
    const quote=(index+1)+"｜"+(line.speaker==="self"?"我":"对方")+"\n「"+line.text.slice(0,48)+(line.text.length>48?"…":"")+"」";
    if(unavailableMedia(line.text))return quote+"\n正文｜未读取，不判断";
    if(!a||a.evidence==="insufficient")return quote+"\n语气｜待核对\n意图｜证据不足，不打分";
    const tags=(values:typeof a.emotion)=>values.filter(v=>v.probability===undefined||v.probability>0).slice(0,2).map(v=>v.label+(v.probability===undefined?"":" "+probabilityText(v.probability))).join(" / ");
    return quote+"\n语气｜"+tags(a.emotion)+"\n可能意图｜"+tags(a.intent)+(a.evidence==="limited"?"（暂判）":"");
  });
  const signal=result.decision?.affinityDeferred?"六维参考｜留在网页按需计算，不拖慢微信回复\n":result.affinity?.value!=null?"互动参考｜"+result.affinity.value+"/100（"+(result.affinity.valueScope==="partial"?"片段、非完整总分；":"")+"不是喜欢概率）\n":result.affinityStatus==="unavailable"?"六维参考｜本次评分服务未完成\n":result.affinityStatus==="insufficient"?"六维参考｜可读互动不足，暂不评分\n":result.affinityStatus==="disabled"?"六维参考｜未开启，可在网页设置\n":"";
  const footer="\n\n发「怎么回」拿回复；直接问军师可继续剖析。\n"+(pendingEvents?"关键事件待你在档案确认，未当作事实。\n":"")+"标签仅为推测。全部原文与六维图：\n"+reportLink(result.id);
  const groups:string[][]=[[]];
  for(const block of blocks){let group=groups.at(-1)!;if(group.length&&(group.length>=5||utf8([...group,block].join("\n\n"))>1100)){group=[];groups.push(group);}group.push(block);}
  return groups.map((group,i)=>"【"+subjectLabel.slice(0,40)+" · 逐句 "+(i+1)+"/"+groups.length+"】\n"+signal+group.join("\n\n")+(i+1<groups.length?"\n\n发「第"+(i+2)+"页」看后续，共"+result.lines.length+"句，没有丢弃。":"")+footer);
}
export function formatWechatBrief(result:CrushResult,page=1,subjectLabel="当前对象",pendingEvents=0){
  const pages=formatWechatBriefPages(result,subjectLabel,pendingEvents);
  if(!Number.isSafeInteger(page)||page<1||page>pages.length)throw new CrushError("这份报告共 "+pages.length+" 页，请发送有效页码。",400);
  return pages[page-1];
}
function interactionCounts(result:CrushResult){
  const counted={questions:0,replies:0,invites:0,boundaries:0};
  for(const line of result.lines){
    const a=result.annotations.find(item=>item.lineId===line.id);
    const visibleQuestion=line.speaker==="other"&&/[？?]/.test(line.text);
    if(visibleQuestion)counted.questions++;
    if(!a||a.evidence==="insufficient")continue;
    const key=a.intent[0]?.key;
    if(line.speaker==="other"&&!visibleQuestion&&["ask","clarify"].includes(key))counted.questions++;
    if(line.speaker==="self"&&["answer","agree","acknowledge","continue"].includes(key))counted.replies++;
    if(line.speaker==="other"&&["invite","invite_hint"].includes(key))counted.invites++;
    if(line.speaker==="other"&&["refuse","boundary"].includes(key))counted.boundaries++;
  }
  return counted;
}
function visibleSignals(result:CrushResult){
  const counted=interactionCounts(result);
  return [counted.questions?"对方提问 "+counted.questions+" 次":"",counted.replies?"你回应 "+counted.replies+" 次":"",counted.invites?"对方邀约/试探 "+counted.invites+" 次":"",counted.boundaries?"对方表达边界 "+counted.boundaries+" 次":""].filter(Boolean).join(" · ");
}
// Lead with an actionable exchange summary. A colored per-line image follows
// automatically; the text also keeps the visible original lines accessible.
export function formatWechatDecision(result:CrushResult,subjectLabel="当前对象",pendingEvents=0,memoryQuestion=""){
  const clean=(value:string|undefined,limit:number)=>byteClip((value||"").replace(/[\r\n]+/g," ").trim(),limit);
  const decision=result.decision;
  const recommended=rankedReplyOptions(decision?.replyOptions)[0]?.text||decision?.replyDraft;
  const rows=result.lines.map((line,index)=>({line,index})).filter(({line})=>!unavailableMedia(line.text));
  const signals=visibleSignals(result);
  const visualPages=cardPages(result).length;
  const overflow=visualPages>3;
  const heading="【"+clean(subjectLabel,50)+" · "+rows.length+"句】\n"+
    "判断｜"+clean(decision?.judgment||decision?.observation||"先看可见互动。",130)+"\n"+
    (signals?"信号｜"+signals+"\n":"");
  const ending="\n下一步｜"+clean(decision?.nextStep||"顺着眼前话题接一句。",90)+
    (recommended?"\n可直接回｜"+clean(recommended,130):"")+
    "\n逐句彩图随后发（共"+result.lines.length+"句、"+visualPages+"页）"+(visualPages>1?"；若后页未收到，可发「第2页」续看":"")+(overflow?"；本次先发前3页，发「第4页起」续看后3页":"")+"。完整报告："+reportLink(result.id)+memoryQuestion;
  let details="",shown=0;
  // Leave room for the overflow notice and WeChat's 2 KB text boundary.
  const budget=Math.max(160,1750-utf8(heading)-utf8(ending));
  for(const {line,index} of rows){
    const a=result.annotations.find(item=>item.lineId===line.id);
    const useful=(values:Tag[])=>values.filter(v=>v.key!=="unknown"&&(v.probability===undefined||v.probability>0)).slice(0,3).map(v=>v.label+(v.probability===undefined?"":" "+probabilityText(v.probability))).join(" / ");
    const intent=a?.evidence!=="insufficient"&&a?.intent?.length?useful(a.intent):"这句暂难判断";
    const emotion=a?.evidence!=="insufficient"&&a?.emotion?.length?useful(a.emotion.filter(v=>v.key!=="calm")):"";
    const meaningfulNote=a?.evidence!=="insufficient"&&a?.note&&!/^(基于可见文字|请结合前后文|标签描述这句话|仅部分表达标签)/.test(a.note)?clean(a.note,105):"";
    const block="\n"+(index+1)+" "+(line.speaker==="self"?"我":"对方")+"「"+clean(line.text,100)+"」\n  "+(intent||"这句暂难判断")+(emotion?" · "+emotion:"")+(meaningfulNote?"｜"+meaningfulNote:"");
    if(shown&&utf8(details+block)>budget)break;
    details+=block;shown++;
  }
  return heading+details+(shown<rows.length?"\n其余"+(rows.length-shown)+"句见彩图或报告。":"")+ending;
}
export function cardPages(result:CrushResult){
  const rows=result.lines.flatMap((line,index)=>{
    const chars=Array.from(line.text),chunks:string[]=[];
    for(let i=0;i<chars.length;i+=360)chunks.push(chars.slice(i,i+360).join(""));
    return (chunks.length?chunks:[""]).map((text,part)=>({line,text,index,part,parts:chunks.length}));
  });
  const pages:typeof rows[]=[[]];let weight=0;
  for(const row of rows){
    // Bound image height without trimming the original quote. Long quotes continue on the next card.
    const next=240+Math.ceil(Array.from(row.text).length/28)*39;
    const first=pages.length===1;
    // Page one includes summary, six dimensions and reply options. Keep its
    // quotes short enough to be visible on a phone. A continuation image with
    // seven or eight annotated quotes can exceed the renderer/upload budget;
    // keep each later card to four quotes and send the next card separately.
    if(pages.at(-1)!.length&&(pages.at(-1)!.length>=(first?3:4)||weight+next>(first?1800:1700))){pages.push([]);weight=0;}
    pages.at(-1)!.push(row);weight+=next;
  }
  return pages;
}
export function formatWechatImageNote(result:CrushResult,page=1){
  const pages=cardPages(result),decision=result.decision;
  return "逐句图 "+page+"/"+pages.length+" 页 · 共"+result.lines.length+"句"+
    (page<pages.length?"\n发「第"+(page+1)+"页起」续看后3页。":"")+
    (decision?.partial?"\n模糊、截断或说话人不明的气泡未评分。":"")+
    (page===1&&decision?.replyDraft?"\n可复制回复：\n"+byteClip(decision.replyDraft,240):"")+
    "\n可直接追问「怎么回」。完整报告：\n"+reportLink(result.id);
}
export function formatWechatImageFallback(result:CrushResult,page=1){
  const pages=cardPages(result),rows=pages[page-1];
  if(!rows)throw new CrushError("页码无效。",400);
  const blocks=rows.map(({line,text,index,part,parts})=>{
    const a=result.annotations.find(v=>v.lineId===line.id);
    const enough=!unavailableMedia(line.text)&&a&&a.evidence!=="insufficient";
    const intent=enough?cleanTag(a.intent[0]?.label):"这句暂无法可靠解读";
    const emotion=enough&&a.emotion[0]?.key!=="unknown"?" · "+cleanTag(a.emotion[0]?.label):"";
    const note=rows.length<=4&&enough&&a.note&&!/^(基于可见文字|请结合前后文|标签描述这句话|仅部分表达标签)/.test(a.note)?"\n解读："+byteClip(a.note,110):"";
    return (index+1)+"｜"+(line.speaker==="self"?"我":"对方")+(parts>1?"（续 "+(part+1)+"/"+parts+"）":"")+"「"+byteClip(text,48)+"」\n意图："+intent+emotion+note;
  });
  const heading="分析图这次没发出来，先看逐句文字 · "+page+"/"+pages.length+"\n",footer="\n完整逐句解释和回复选择：\n"+reportLink(result.id);
  let body="",shown=0;
  for(const block of blocks){if(shown&&utf8(heading+body+"\n\n"+block+footer)>1800)break;body+=(shown?"\n\n":"")+block;shown++;}
  return heading+body+(shown<blocks.length?"\n本页其余"+(blocks.length-shown)+"句见网页报告。":"")+footer;
}
function cleanTag(value?:string){return byteClip((value||"待核对").replace(/[\r\n]/g," "),48);}
export function renderCardHtml(result:CrushResult,page=1){
  result=readableReport(result);
  if(result.readableLineCount===0)throw new CrushError("语音正文未读取，不能生成分析卡片；请先提供转写文字。",400);
  const pages=cardPages(result);
  if(!Number.isSafeInteger(page)||page<1||page>pages.length)throw new CrushError("这份逐句图共"+pages.length+"页，请发送有效页码。",400);
  const bubbles=pages[page-1].map(({line,text,index,part,parts})=>{
    const a=result.annotations.find(item=>item.lineId===line.id);
    const insufficient=unavailableMedia(line.text)||!a||a.evidence==="insufficient";
    const score=insufficient?0:a.evidence==="limited"?1:2;
    const tags=(label:string,values:{label:string;probability?:number}[])=>'<div class="tags"><span class="key">'+label+'</span>'+values.filter(t=>t.probability===undefined||t.probability>0).slice(0,3).map(t=>'<b>'+escapeHtml(t.label)+(t.probability===undefined?'':'<small>'+probabilityText(t.probability)+'</small>')+'</b>').join("")+'</div>';
    const meaningfulTone=insufficient?[]:a.emotion.filter(v=>v.key!=="unknown"&&(v.key!=="calm"||v.probability!==undefined));
    const note=!insufficient&&a.note&&!/^(基于可见文字|请结合前后文|标签描述这句话|仅部分表达标签)/.test(a.note)?'<p class="note">解读 · '+escapeHtml(a.note.slice(0,120))+'</p>':'';
    return '<article class="'+(line.speaker==="self"?"self":"other")+'"><div class="speaker"><span>第'+(index+1)+'句 · '+(line.speaker==="self"?"我":line.speaker==="other"?"对方":"身份未确认")+(parts>1?' · 原文 '+(part+1)+'/'+parts:'')+'</span><strong class="score s'+score+'">依据 '+score+'/2</strong></div><div class="bubble">'+escapeHtml(text)+'</div>'+(insufficient?'<div class="unsure">这句暂无法可靠解读</div>':tags("可能意思",a.intent)+(meaningfulTone.length?tags("明显语气",meaningfulTone):''))+note+'</article>';
  }).join("");
  const d=result.decision;
  const signals=visibleSignals(result),counts=interactionCounts(result);
  const dimensions=page===1?'<div class="dimensions">'+[
    ['谁在主动',counts.questions?'对方主动提问 '+counts.questions+' 次':result.lines[0]?.speaker==='other'?'对方先开口，可能想开启话题':'这轮由你先开口，等对方接话'],
    ['有没有接话',counts.replies?'你回应了 '+counts.replies+' 次':'暂没看到你如何接话'],
    ['有没有推进',counts.invites?'对方可能在试着约见／推进':'暂没看到约见或落实动作'],
    ['有没有边界',counts.boundaries?'对方表达了拒绝或边界':'没看到明确拒绝；不等于默认同意'],
  ].map(([label,value])=>'<div><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value)+'</strong></div>').join('')+'</div>':'';
  const summary=page===1&&d?'<section class="summary"><b>军师怎么看</b><p>'+escapeHtml(d.judgment||d.observation)+'</p>'+(signals?'<p class="signals">看得见的线索 · '+escapeHtml(signals)+'</p>':'')+(d.nextStep?'<p class="action">建议下一步 · '+escapeHtml(d.nextStep)+'</p>':'')+'</section>':'';
  const preview=result.affinity||d?.affinityPreview;
  const scoreInfo=interactionScore(result);
  const scored=!scoreInfo.estimated;
  const score=scoreInfo.value;
  const dimensionItems=preview?.dimensions.filter(item=>item.value!==null)||[];
  const affinityPanel=page===1?'<section class="review"><b>综合互动参考 · '+score+'/100'+(scored?'':'（这轮暂估）')+'</b><p>'+(scored?'根据本轮能看清的互动估算':'根据本轮能看清的提问、回应、约见和边界做粗估')+'；没出现的行为不扣分，文字越少误差越大。这不是对方喜欢你的概率。</p>'+(dimensionItems.length?'<div class="affinity-mini">'+dimensionItems.map(item=>'<span>'+escapeHtml(item.label)+' '+item.value+'</span>').join('')+'</div>':'')+'</section>':'';
  const review=page===1&&d?.replyReview?'<section class="review"><b>你刚才回得怎么样'+(d.replyGrade?' · '+escapeHtml(d.replyGrade)+' 级':'')+'</b><p>'+escapeHtml(d.replyReview)+'</p></section>':'';
  const ranked=rankedReplyOptions(d?.replyOptions);
  const options=page===1&&ranked.length?'<section class="reply-options"><b>接下来怎么聊 · 选一句适合你的</b>'+ranked.map((option,index)=>'<div class="reply-option"><strong>'+String(index+1)+' · '+escapeHtml(option.style)+'</strong><p>「'+escapeHtml(option.text)+'」</p><small>'+escapeHtml(option.reason)+'</small></div>').join('')+'</section>':'';
  const unread=page===1&&(d?.unreadText||d?.unknownSpeaker)?'<p class="warning">另有'+(d.unreadText?d.unreadText+'句文字未读清 ':'')+(d.unknownSpeaker?d.unknownSpeaker+'句说话人未确认':'')+'，未纳入判断。</p>':'';
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';"><style>*{box-sizing:border-box}body{margin:0;background:#edf1f3;font-family:"Noto Sans CJK SC","WenQuanYi Zen Hei",sans-serif;color:#192e38}#card{width:740px;padding:32px}header{display:flex;justify-content:space-between;font-size:18px;padding-bottom:22px;border-bottom:1px solid #cbd6dc}header b{color:#126956}h1{font-size:32px;margin:22px 0 6px}.sub{font-size:17px;color:#526a76;margin:0 0 22px}.summary{background:#133c38;color:white;border-radius:14px;padding:20px 24px;margin-bottom:16px;font-size:20px;line-height:1.6}.summary b{color:#9bdcc6;font-size:17px}.summary p{margin:8px 0}.summary .action{font-size:18px;color:#d7e9e5}.review,.reply-options{background:#fff;border:1px solid #dbe3e7;border-radius:14px;padding:15px 19px;margin-bottom:14px;font-size:18px;line-height:1.5}.review{border-left:6px solid #d5a35d}.review b,.reply-options>b{color:#174c48}.review p{margin:8px 0 0}.affinity-mini{display:grid;grid-template-columns:1fr 1fr;gap:5px;color:#316778;font-size:16px}.reply-option{padding:9px 0;border-top:1px solid #e8eef0}.reply-option:first-of-type{margin-top:10px}.reply-option strong{color:#316778;font-size:17px}.reply-option p{font-size:20px;margin:4px 0}.reply-option small{color:#627986}.dimensions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 20px}.dimensions div{background:#fff;border:1px solid #dbe3e7;border-radius:12px;padding:11px 14px;min-height:80px}.dimensions span{display:block;color:#61737e;font-size:15px;margin-bottom:6px}.dimensions strong{font-size:18px;color:#1e604f;font-weight:600}.warning{font-size:16px;line-height:1.5;background:#fff3d6;padding:12px;border-radius:10px}article{background:white;border:1px solid #dbe3e7;border-left:6px solid #75aaba;border-radius:15px;padding:18px 22px;margin:0 0 16px}.self{background:#f3faf6;border-color:#b8d5c5;border-left-color:#4a9a73}.speaker{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:17px;color:#516773;margin:0 0 12px}.score{font-size:16px;background:#e6f3eb;padding:5px 10px;border-radius:7px;color:#247046;white-space:nowrap}.s1{color:#806215;background:#fff3d6}.s0{color:#646d77;background:#edf0f3}.bubble{white-space:pre-wrap;overflow-wrap:anywhere;font-size:24px;line-height:1.65;padding-bottom:8px}.tags{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:9px;font-size:18px}.key{color:#61737e;min-width:88px}.tags b{background:#e8effb;color:#354c77;font-weight:500;padding:5px 10px;border-radius:6px}small{font-size:16px;margin-left:6px}.note,.unsure{font-size:16px;line-height:1.7;color:#445c68;margin:12px 0 0}.footer{font-size:15px;color:#526976;line-height:1.7;border-top:1px solid #cbd6dc;padding-top:15px}</style></head><body><div id="card"><header><b>成子 · 聊天副驾</b><span>逐句图 '+page+' / '+pages.length+'</span></header><h1>看懂原话，再决定怎么回。</h1><p class="sub">本页 '+new Set(pages[page-1].map(row=>row.index)).size+' 句 / 全部 '+result.lines.length+' 句 · 原话 / 可能意思 / 依据有多足</p>'+summary+affinityPanel+review+options+dimensions+unread+bubbles+'<div class="footer">依据 2 = 清楚，1 = 有限，0 = 不足；不是好感分。'+(page<pages.length?'<br>余下原话见后续页或网页报告。':'')+'<br>成子 · 仅据本张截图</div></div></body></html>';
}
type BrowserBinding={quickAction:(action:string,options:Record<string,unknown>)=>Promise<Response>};
export class CardRenderFailure extends CrushError {
  constructor(public readonly phase:"request"|"response",public readonly browserStatus:number|null){super("分析图暂时未生成，请先查看文字结果。",503);}
}
export function cardConfigured(){return typeof (env as unknown as {BROWSER?:BrowserBinding}).BROWSER?.quickAction==="function";}
export async function renderCard(result:CrushResult,page=1){
  const browser=(env as unknown as {BROWSER?:BrowserBinding}).BROWSER;
  if(!browser?.quickAction)throw new CrushError("分析图服务暂时不可用，文字解读仍可正常使用。",503);
  let response:Response;
  try{response=await browser.quickAction("screenshot",{html:renderCardHtml(result,page),selector:"#card",viewport:{width:740,height:7200,deviceScaleFactor:1.5},gotoOptions:{waitUntil:"domcontentloaded",timeout:15000},screenshotOptions:{type:"jpeg",quality:78}});}
  catch{throw new CardRenderFailure("request",null);}
  if(!response.ok||!response.headers.get("content-type")?.includes("image"))throw new CardRenderFailure("response",response.status);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length>2000000)throw new CrushError("分析图过大，请改为网页查看。",413);
  return bytes;
}
export async function renderCardsBatch(result:CrushResult,count=Math.min(3,cardPages(result).length)){
  const binding=(env as unknown as {BROWSER?:import("@cloudflare/puppeteer").BrowserWorker}).BROWSER;
  if(!binding)throw new CrushError("分析图服务暂时不可用，文字解读仍可正常使用。",503);
  if(!Number.isSafeInteger(count)||count<1||count>3||count>cardPages(result).length)throw new CrushError("逐句图页数无效。",400);
  const {default:puppeteer}=await import("@cloudflare/puppeteer");
  let browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined;
  try{
    // Browser Run can allow several live sessions yet throttle new launches.
    // A second customer's card should wait for the next acquisition window
    // instead of failing immediately while another report is rendering.
    for(let attempt=0;attempt<2&&!browser;attempt++){
      try{browser=await puppeteer.launch(binding);}
      catch(error){
        const limited=error instanceof Error&&/\b429\b/.test(error.message);
        if(!limited||attempt===1)throw new CardRenderFailure("request",limited?429:null);
        const limits=await puppeteer.limits(binding).catch(()=>null);
        // The limits endpoint may briefly report zero while the launch path
        // still rejects a simultaneous acquisition. Use a real cooldown, not
        // several 1-second retries that consume the same throttled window.
        const waitMs=Math.min(25000,Math.max(21000,(limits?.timeUntilNextAllowedBrowserAcquisition||0)+600+Math.floor(Math.random()*900)));
        await new Promise(resolve=>setTimeout(resolve,waitMs));
      }
    }
    if(!browser)throw new CardRenderFailure("request",429);
    const page=await browser.newPage();
    await page.setViewport({width:740,height:7200,deviceScaleFactor:1.5});
    const images:Uint8Array[]=[];
    for(let number=1;number<=count;number++){
      await page.setContent(renderCardHtml(result,number),{waitUntil:"domcontentloaded",timeout:15000});
      const card=await page.$("#card");
      if(!card)throw new Error("CARD_ELEMENT_MISSING");
      const bytes=new Uint8Array(await card.screenshot({type:"jpeg",quality:78}));
      if(bytes.length>2000000)throw new CrushError("分析图过大，请改为网页查看。",413);
      images.push(bytes);
    }
    return images;
  }catch(error){
    if(error instanceof CrushError)throw error;
    throw new CardRenderFailure("request",error instanceof Error&&/\b429\b/.test(error.message)?429:null);
  }finally{
    if(browser)try{await browser.close();}catch{}
  }
}
