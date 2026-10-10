import {getD1} from "@/db";
import {env} from "cloudflare:workers";
import {getWechatMedia,sendWechatText,type Incoming} from "@/lib/wechat";
import {loadProfileContext} from "@/lib/profile-context";
import {analyzeLines,enrichReportDistribution,getThread,getSettings,refreshReportAffinity,reserveBudget,type PreparedLines} from "./service";
import {replyAdvice} from "./advice";
import {formatWechatBrief,formatWechatDecision,formatWechatImageNote,formatWechatImageFallback,cardPages} from "./card";
import {readScreenshot,readScreenshotQuickData,readScreenshotFromQuick,type ScreenshotSide} from "./screenshot";
import {firstScreenshotRead} from "./screenshot-race";
import {suggestScreenshotEvents} from "./archive";
import {pendingImages,appendPendingImage} from "./image-pending";
import {CrushError,type CrushResult} from "./types";
import {matchMergedSelfName,namesInMergedDraft,prepareMergedWechat,coverageText,mergedVoiceCount} from "./merged";
import {readableChat,unreadMediaGuidance} from "./evidence";
import {transcribeWechatVoice,voiceErrorCode,voicePublicError} from "@/lib/wechat-asr";
import {pendingVoices,appendPendingVoice,voiceRoleCommand,selectPendingVoices,confirmedVoicePrefix,labeledVoiceText} from "./voice-pending";
import {jevFailure} from "./jev-client";
import {parseChat} from "./parser";
import {quickJudgment} from "./quick";
import {quickJevJudgment} from "./quick-jev";
type Link={owner_id:string;subject_id:string|null};
export async function promptMemoryOffer(openKfId:string,externalUserId:string){
  const db=getD1(),now=Date.now();
  const row=await db.prepare("SELECT l.owner_id,l.subject_id,l.memory_offer_report_id,s.label FROM coach_wechat_links l JOIN coach_subjects s ON s.id=l.subject_id AND s.owner_id=l.owner_id JOIN coach_profiles p ON p.owner_id=l.owner_id JOIN coach_crush_settings c ON c.owner_id=l.owner_id WHERE l.open_kfid=? AND l.external_userid=? AND l.memory_offer_report_id IS NOT NULL AND l.memory_offer_asked_at=0 AND l.memory_offer_expires_at<=? AND p.consent_at IS NOT NULL AND p.paused=0 AND c.consent_at IS NOT NULL AND EXISTS(SELECT 1 FROM coach_crush_reports r JOIN coach_crush_threads t ON t.id=r.thread_id AND t.owner_id=r.owner_id WHERE r.id=l.memory_offer_report_id AND r.owner_id=l.owner_id AND t.subject_id=l.subject_id AND r.status='done' AND r.expires_at>?)").bind(openKfId,externalUserId,now,now).first<{owner_id:string;subject_id:string;memory_offer_report_id:string;label:string}>();
  if(!row)return false;
  const claimed=await db.prepare("UPDATE coach_wechat_links SET memory_offer_asked_at=?,memory_offer_expires_at=? WHERE owner_id=? AND open_kfid=? AND external_userid=? AND subject_id=? AND memory_offer_report_id=? AND memory_offer_asked_at=0 AND memory_offer_expires_at<=?").bind(now,now+3600000,row.owner_id,openKfId,externalUserId,row.subject_id,row.memory_offer_report_id,now).run();
  if(!claimed.meta.changes)return false;
  try{await sendWechatText(externalUserId,openKfId,"这段聊天先告一段落了。要把已识别的聊天文字存进「"+row.label.slice(0,40)+"」的长期记忆吗？回复「是」保存、「否」不保存。原图不保存；1小时不答就不保存。");return true;}
  catch(error){await db.prepare("UPDATE coach_wechat_links SET memory_offer_asked_at=0,memory_offer_expires_at=? WHERE owner_id=? AND open_kfid=? AND external_userid=? AND memory_offer_report_id=? AND memory_offer_asked_at=?").bind(Date.now()+60000,row.owner_id,openKfId,externalUserId,row.memory_offer_report_id,now).run();throw error;}
}
export async function handleCrushMessage(message:Incoming,link:Link,send:(text:string,reportId?:string)=>Promise<void>,sendImage:(result:CrushResult,page?:number)=>Promise<boolean|void>){
  if(message.msgtype!=="text"&&message.msgtype!=="merged_msg"&&message.msgtype!=="voice"&&message.msgtype!=="image")return false;
  const text=(message.text?.content||"").trim();
  if(/^我叫\s*(?:你的微信昵称|自己的微信昵称|微信昵称|昵称)$/.test(text)){
    await send("这句是操作示例，不能照抄。请把后半句换成你在聊天记录里的真实显示名。例如记录里你叫「小李」，就发：我叫小李。先在网页开启聊天解读授权：https://coach.lovetalk.love/wechat");
    return true;
  }
  const settings=await getSettings(link.owner_id);
  if(!settings?.consent_at){
    if(message.msgtype==="image"){await send("截图快捷解读需要先开启聊天授权，并单独同意图片识别。语音请先在原微信转文字，再截图：https://coach.lovetalk.love/wechat");return true;}
    if(message.msgtype==="merged_msg") {await send("我能读到合并转发里每条文字和发送者昵称。首次分析前请在网页开启聊天解读与资料处理同意，再把记录重新转发给我：https://coach.lovetalk.love/crush");return true;}
    if(text==="逐句模式"||text==="开始分段") {await send("先在网页开启逐句解读，并确认聊天文字可由所选服务处理、保存 7 天。\nhttps://coach.lovetalk.love/crush\n开启后直接把文字发过来即可。");return true;}
    if(/^我叫\s*\S/.test(text)) {await send("收到你的昵称指令，但聊天解读授权还没开启。我暂不保存昵称或分析私聊。请先在网页点「开启微信聊天解读」，再发一次这句：https://coach.lovetalk.love/wechat");return true;}
    return false;
  }
  const db=getD1(),baseKey="wechat:"+message.open_kfid+":"+message.external_userid+":";
  if(message.msgtype==="text"&&["是","保存记忆","否","不保存"].includes(text)){
    const offer=await db.prepare("SELECT memory_offer_report_id,memory_offer_expires_at,memory_offer_asked_at,memory_offer_start_revision,subject_id FROM coach_wechat_links WHERE owner_id=? AND external_userid=? AND open_kfid=?").bind(link.owner_id,message.external_userid,message.open_kfid).first<{memory_offer_report_id:string|null;memory_offer_expires_at:number;memory_offer_asked_at:number;memory_offer_start_revision:number;subject_id:string|null}>();
    if(offer?.memory_offer_report_id&&offer.memory_offer_asked_at>0&&offer.memory_offer_expires_at>Date.now()&&offer.subject_id===link.subject_id){
      const reportId=offer.memory_offer_report_id;
      if(text==="是"||text==="保存记忆"){
        const row=await db.prepare("SELECT r.thread_id,r.revision FROM coach_crush_reports r JOIN coach_crush_threads t ON t.id=r.thread_id AND t.owner_id=r.owner_id JOIN coach_profiles p ON p.owner_id=r.owner_id WHERE r.id=? AND r.owner_id=? AND r.status='done' AND r.expires_at>? AND t.subject_id=? AND p.consent_at IS NOT NULL AND p.paused=0").bind(reportId,link.owner_id,Date.now(),link.subject_id).first<{thread_id:string;revision:number}>();
        if(!row){await send("这次记录已过期或对象已切换，没有保存。请重新发截图。");return true;}
        const reports=await db.prepare("SELECT result FROM coach_crush_reports WHERE owner_id=? AND thread_id=? AND status='done' AND expires_at>? AND revision>=? AND revision<=? ORDER BY revision ASC").bind(link.owner_id,row.thread_id,Date.now(),offer.memory_offer_start_revision||row.revision,row.revision).all<{result:string}>();
        const lines=reports.results.flatMap(item=>{
          const report=JSON.parse(item.result) as CrushResult;
          return report.decision?report.lines.filter(line=>line.speaker!=="unknown"&&!/^[\[【](?:语音|图片|附件)/.test(line.text)).map(line=>(line.speaker==="self"?"我":"对方")+"："+line.text):[];
        });
        if(!lines.length){await send("这次没有可保存的已识别聊天文字。");return true;}
        const chunks:string[]=[];let chunk="";
        for(const line of lines){
          if(chunk&&chunk.length+line.length+1>12000){chunks.push(chunk);chunk="";}
          chunk+=(chunk?"\n":"")+line;
        }
        if(chunk)chunks.push(chunk);
        const evidences=chunks.map((_,index)=>chunks.length===1?reportId:reportId+"#"+(index+1));
        const existing=await db.prepare("SELECT evidence FROM coach_facts WHERE owner_id=? AND subject_id=? AND field='chatMemory' AND (evidence=? OR evidence LIKE ?)").bind(link.owner_id,link.subject_id,reportId,reportId+"#%").all<{evidence:string}>();
        const saved=new Set(existing.results.map(item=>item.evidence));
        const count=await db.prepare("SELECT COUNT(*) AS n FROM coach_facts WHERE owner_id=?").bind(link.owner_id).first<{n:number}>();
        if((count?.n||0)+evidences.filter(id=>!saved.has(id)).length>200){await send("这段有"+lines.length+"句已识别文字，但长期档案容量不足；本次未新增。请先在网页清理旧记忆。");return true;}
        for(let index=0;index<chunks.length;index++){
          const evidence=evidences[index];if(saved.has(evidence))continue;
          const inserted=await db.prepare("INSERT INTO coach_facts (id,owner_id,subject_id,field,value,source,evidence,confidence,status,created_at) SELECT ?,?,?,'chatMemory',?,'微信截图｜用户确认',?,'high','accepted',? WHERE EXISTS(SELECT 1 FROM coach_wechat_links l JOIN coach_profiles p ON p.owner_id=l.owner_id WHERE l.owner_id=? AND l.external_userid=? AND l.open_kfid=? AND l.subject_id=? AND l.memory_offer_report_id=? AND l.memory_offer_expires_at>? AND p.consent_at IS NOT NULL AND p.paused=0) AND NOT EXISTS(SELECT 1 FROM coach_facts WHERE owner_id=? AND subject_id=? AND field='chatMemory' AND evidence=?) AND (SELECT COUNT(*) FROM coach_facts WHERE owner_id=?)<200").bind(crypto.randomUUID(),link.owner_id,link.subject_id,chunks[index],evidence,Date.now(),link.owner_id,message.external_userid,message.open_kfid,link.subject_id,reportId,Date.now(),link.owner_id,link.subject_id,evidence,link.owner_id).run();
          if(!inserted.meta.changes){await send("这段聊天尚未完整归档；授权、对象或档案容量可能已改变。请在网页核对后再试。");return true;}
        }
        await db.prepare("UPDATE coach_wechat_links SET memory_offer_report_id=NULL,memory_offer_expires_at=0,memory_offer_asked_at=0,memory_offer_start_revision=0 WHERE owner_id=? AND external_userid=? AND open_kfid=? AND memory_offer_report_id=?").bind(link.owner_id,message.external_userid,message.open_kfid,reportId).run();
        await send(saved.size===chunks.length?"这段文字此前已保存，没有重复归档。":"已把这段"+lines.length+"句已识别文字存入当前对象的长期记忆；网页关系档案可查看和删除。");return true;
      }
      await db.prepare("UPDATE coach_wechat_links SET memory_offer_report_id=NULL,memory_offer_expires_at=0,memory_offer_asked_at=0,memory_offer_start_revision=0 WHERE owner_id=? AND external_userid=? AND open_kfid=? AND memory_offer_report_id=?").bind(link.owner_id,message.external_userid,message.open_kfid,reportId).run();
      await send("好，这次聊天只保留在 7 天逐句报告中，不进入长期记忆。");return true;
    }
  }
  // Only explicit user selection may associate an image with a person. No avatar/name guesses.
  const pendingRow=await db.prepare("SELECT id,image_pending,image_pending_expires_at FROM coach_crush_threads WHERE owner_id=? AND channel_key=? AND expires_at>?").bind(link.owner_id,baseKey+"default",Date.now()).first<{id:string;image_pending:string;image_pending_expires_at:number}>();
  const resume=async(selected:Link)=>{
    if(!pendingRow||pendingRow.image_pending_expires_at<=Date.now())return false;
    const scope=await db.prepare("SELECT l.created_at,p.consent_at,p.paused FROM coach_wechat_links l JOIN coach_profiles p ON p.owner_id=l.owner_id WHERE l.owner_id=? AND l.external_userid=? AND l.open_kfid=?").bind(link.owner_id,message.external_userid,message.open_kfid).first<{created_at:number;consent_at:number|null;paused:number}>();
    const active=await getSettings(link.owner_id);
    if(!scope?.consent_at||scope.paused||!active?.image_consent_at)return false;
    const entries=pendingImages(pendingRow.image_pending,pendingRow.image_pending_expires_at).filter(v=>v.stamp===scope.created_at+":"+scope.consent_at&&v.consentAt===settings.consent_at&&(!v.subjectId||v.subjectId===selected.subject_id));
    if(!entries.length)return false;
    if(entries.length===1)return handleCrushMessage({...message,msgid:entries[0].msgid,msgtype:"image",text:undefined,image:{media_id:entries[0].mediaId}},selected,send,sendImage);
    // Separate durable inbox jobs retain order and give each image its own reply. No recursive batch flooding.
    const now=Date.now();
    await db.batch(entries.map((entry,index)=>db.prepare("INSERT OR IGNORE INTO coach_wechat_inbox (id,open_kfid,external_userid,payload,status,attempts,created_at,updated_at,expires_at) VALUES (?,?,?,?,'pending',0,?,?,?)").bind(
      entry.msgid+":image-resume",message.open_kfid,message.external_userid,
      JSON.stringify({msgid:entry.msgid+":image-resume",open_kfid:message.open_kfid,external_userid:message.external_userid,origin:3,msgtype:"image",image:{media_id:entry.mediaId},coachImageScope:{ownerId:link.owner_id,subjectId:selected.subject_id,consentAt:settings.consent_at,imageConsentAt:active.image_consent_at,stamp:entry.stamp}}),
      now+index,now,entry.expiresAt)));
    const remaining=pendingImages(pendingRow.image_pending,pendingRow.image_pending_expires_at).filter(v=>!entries.some(entry=>entry.msgid===v.msgid));
    await db.prepare("UPDATE coach_crush_threads SET image_pending=?,image_pending_expires_at=? WHERE id=? AND owner_id=?").bind(remaining.length?JSON.stringify({entries:remaining}):"{}",Math.max(0,...remaining.map(v=>v.expiresAt)),pendingRow.id,link.owner_id).run();
    const queue=(env as {WECHAT_QUEUE?:Queue}).WECHAT_QUEUE;
    if(queue)await queue.send({kind:"message",openKfId:message.open_kfid,externalUserId:message.external_userid});
    await send("截图识别已就绪，已收下的"+entries.length+"张会按顺序处理。"+(selected.subject_id?"接着你刚选的对象。":"没选对象也先给临时判断，不写进任何人的档案。")+"\n后续直接发截图即可。");return true;
  };
  const objectMatch=text.match(/^(新对象|切换对象|对象)[：:\s]+(.{1,60})$/);
  if(message.msgtype==="text"&&["这段聊完了","聊天结束","结束这段"].includes(text)){
    const pending=await db.prepare("SELECT memory_offer_report_id,subject_id FROM coach_wechat_links WHERE owner_id=? AND external_userid=? AND open_kfid=? AND memory_offer_asked_at=0").bind(link.owner_id,message.external_userid,message.open_kfid).first<{memory_offer_report_id:string|null;subject_id:string|null}>();
    if(!pending?.memory_offer_report_id||!pending.subject_id||pending.subject_id!==link.subject_id){await send("当前没有待归档的这段聊天。选定对象后发截图即可。");return true;}
    const asked=Date.now();
    await db.prepare("UPDATE coach_wechat_links SET memory_offer_asked_at=?,memory_offer_expires_at=? WHERE owner_id=? AND external_userid=? AND open_kfid=? AND subject_id=? AND memory_offer_report_id=? AND memory_offer_asked_at=0").bind(asked,asked+3600000,link.owner_id,message.external_userid,message.open_kfid,link.subject_id,pending.memory_offer_report_id).run();
    const subject=await db.prepare("SELECT label FROM coach_subjects WHERE id=? AND owner_id=?").bind(link.subject_id,link.owner_id).first<{label:string}>();
    await send("要把这段已识别聊天文字存进「"+(subject?.label||"当前对象")+"」的长期记忆吗？回复「是」保存、「否」不保存。原图不保存；1小时不答就不保存。");return true;
  }
  if(objectMatch||text==="当前对象"||text==="对象列表"){
    const own=await db.prepare("SELECT id,label FROM coach_subjects WHERE owner_id=? ORDER BY updated_at DESC LIMIT 40").bind(link.owner_id).all<{id:string;label:string}>();
    if(!objectMatch){const current=own.results.find(v=>v.id===link.subject_id);await send("当前对象｜"+(current?.label||"尚未选择")+"\n你的对象｜"+(own.results.map(v=>v.label).join("、")||"暂无")+"\n发「对象 名字」切换；发「新对象 名字」建立档案。选定后发本人单聊截图。\n网页管理：https://coach.lovetalk.love/profile");return true;}
    const label=objectMatch[2].trim();if(!label)throw new CrushError("请写一个对象称呼。");
    let matches=own.results.filter(v=>v.label.toLocaleLowerCase()===label.toLocaleLowerCase());
    if(matches.length>1){await send("有重名对象，请先在网页改成不同称呼再选择：https://coach.lovetalk.love/profile");return true;}
    if(!matches.length){
      if(objectMatch[1]!=="新对象"){await send("没有这个对象。已有："+(own.results.map(v=>v.label).join("、")||"暂无")+"\n想新建请发「新对象 "+label+"」。不会把聊天自动归给陌生人。");return true;}
      if(own.results.length>=40)throw new CrushError("对象档案已达到上限，请在网页整理。",400);
      const id=crypto.randomUUID(),now=Date.now();
      const created=await db.prepare("INSERT INTO coach_subjects (id,owner_id,label,status,data,created_at,updated_at) SELECT ?,?,?,'draft','{}',?,? WHERE EXISTS (SELECT 1 FROM coach_profiles WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0) AND (SELECT COUNT(*) FROM coach_subjects WHERE owner_id=?)<40").bind(id,link.owner_id,label,now,now,link.owner_id,link.owner_id).run();
      if(!created.meta.changes)throw new CrushError("档案授权或对象数量已改变，请在网页检查。",409);
      matches=[{id,label}];
    }
    const updated=await db.prepare("UPDATE coach_wechat_links SET subject_id=?,memory_offer_report_id=NULL,memory_offer_expires_at=0,memory_offer_asked_at=0,memory_offer_start_revision=0,updated_at=? WHERE owner_id=? AND external_userid=? AND open_kfid=? AND EXISTS (SELECT 1 FROM coach_profiles WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0)").bind(matches[0].id,Date.now(),link.owner_id,message.external_userid,message.open_kfid,link.owner_id).run();
    if(!updated.meta.changes)throw new CrushError("微信绑定已改变，请重新绑定。",409);
    if(await resume({...link,subject_id:matches[0].id}))return true;
    await send("当前对象｜"+matches[0].label+"\n以后截图和追问都接着这个人的聊天。换人先发「对象 名字」。详细档案、六维图和择偶定位在网页：https://coach.lovetalk.love/profile");return true;
  }
  const imageCommand=text.match(/^同意截图识别[，,\s]*(右侧是我|左侧是我)$/);
  const sideCorrection=text.match(/^(右侧是我|左侧是我)$/);
  if(sideCorrection&&!settings.image_consent_at){
    await send("还没有开启图片处理授权。请确认有权提供这张本人单聊截图，再回复「同意截图识别 "+sideCorrection[1]+"」；确认前不会识图。");
    return true;
  }
  if(text==="同意截图识别"){
    await send("先确认这张本人单聊截图里哪侧是你。请回复「同意截图识别 右侧是我」或「同意截图识别 左侧是我」；不能只凭绿色气泡或聊天语气替你判断。确认前不会识图。");
    return true;
  }
  if(text==="处理已收截图"){
    if(await resume(link))return true;
    await send(settings.image_consent_at?"没有还在等待的截图，直接发新图即可。":"请确认截图哪侧是你：回复「同意截图识别 右侧是我」或「同意截图识别 左侧是我」。无需先选对象。");return true;
  }
  if(imageCommand||sideCorrection||text==="关闭截图识别"){
    const enabled=!!(imageCommand||sideCorrection),side=(imageCommand?.[1]||sideCorrection?.[1])==="左侧是我"?"left":"right",now=Date.now();
    await db.prepare("UPDATE coach_crush_settings SET image_consent_at=?,image_self_side=?,updated_at=? WHERE owner_id=? AND consent_at IS NOT NULL").bind(enabled?now:null,enabled?side:"ask",now,link.owner_id).run();
    if(!enabled){await db.prepare("UPDATE coach_crush_threads SET image_pending='{}',image_pending_expires_at=0 WHERE owner_id=?").bind(link.owner_id).run();await send("已关闭截图识别并清除待关联截图。已生成的短期报告可在网页删除。");return true;}
    if(await resume(link))return true;
    await send("截图识别已开启｜"+(side==="right"?"右侧":"左侧")+"是你\n如果刚才的分析认反了，以这次设置为准重发原图；旧报告不会自动改正，也不要据此判断对方。只用于你本人的双人单聊，换截图来源请重新确认。语音先转文字：https://coach.lovetalk.love/wechat");return true;
  }
  // A corrected screenshot-side mapping starts a fresh, non-destructive
  // conversation lane. Old reports remain reviewable but cannot contaminate
  // the next image or its natural follow-up with reversed speaker roles.
  const sideLane=settings.image_consent_at&&["left","right"].includes(settings.image_self_side||"")?":side:"+settings.image_self_side:"";
  let key=baseKey+(link.subject_id||"default")+sideLane;
  if(message.msgtype==="image"&&!link.subject_id)key=baseKey+"temporary:"+message.msgid+sideLane;
  if(message.msgtype==="text"&&!link.subject_id){
    const latest=await db.prepare("SELECT channel_key FROM coach_crush_threads WHERE owner_id=? AND subject_id IS NULL AND substr(channel_key,1,?)=? AND substr(channel_key,length(channel_key)-?+1)=? AND expires_at>? AND data!='[]' ORDER BY updated_at DESC LIMIT 1").bind(link.owner_id,(baseKey+"temporary:").length,baseKey+"temporary:",sideLane.length,sideLane,Date.now()).first<{channel_key:string}>();
    if(latest)key=latest.channel_key;
  }
  const thread=await getThread(link.owner_id,key,link.subject_id);
  const subject=link.subject_id?await db.prepare("SELECT label FROM coach_subjects WHERE id=? AND owner_id=?").bind(link.subject_id,link.owner_id).first<{label:string}>():null;
  const subjectLabel=subject?.label||"这段聊天";
  if(thread.lease_until>Date.now())throw new CrushError("这段聊天还在分析，请稍后再追加。",409);
  let scopeStamp:string|undefined,confirmedVoice=false;
  const stillLinked=async()=>{
    const current=await getSettings(link.owner_id);
    const row=await db.prepare("SELECT l.subject_id,l.created_at,p.consent_at,p.paused FROM coach_wechat_links l JOIN coach_profiles p ON p.owner_id=l.owner_id WHERE l.owner_id=? AND l.external_userid=? AND l.open_kfid=?").bind(link.owner_id,message.external_userid,message.open_kfid).first<{subject_id:string|null;created_at:number;consent_at:number|null;paused:number}>();
    if(!row?.consent_at||row.paused||row.subject_id!==link.subject_id||current?.consent_at!==settings.consent_at||(message.msgtype==="image"&&(current.image_consent_at!==settings.image_consent_at||current.image_self_side!==settings.image_self_side)))throw new CrushError("绑定、对象或处理授权已改变，本次处理已停止。",409);
    const stamp=row.created_at+":"+row.consent_at;
    if(scopeStamp!==undefined&&scopeStamp!==stamp)throw new CrushError("关系授权或微信绑定已改变，本次语音处理已停止。",409);
    scopeStamp=stamp;return stamp;
  };
  const saveVoices=async(buffer:ReturnType<typeof pendingVoices>)=>{
    await stillLinked();
    const expires=Math.max(0,...buffer.entries.map(entry=>entry.expiresAt));
    const saved=await db.prepare("UPDATE coach_crush_threads SET voice_pending = ?, voice_pending_expires_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?").bind(JSON.stringify(buffer),expires,Date.now(),thread.id,link.owner_id).run();
    if(!saved.meta.changes)throw new CrushError("会话已清空，本次语音没有保存。",409);
  };
  let acknowledged=false;
  const analyze=async(input:string,selfLabel:string,coverage?:CrushResult["coverage"],prepared?:PreparedLines,decision?:CrushResult["decision"],decisionAlreadySent=false)=>{
    await stillLinked();
    const lines=parseChat(input,selfLabel,"other");
    if(!readableChat(lines).length){await send(unreadMediaGuidance(lines));return false;}
    let quick:string|null=null;
    const priorQuick=await db.prepare("SELECT id FROM coach_wechat_outbox WHERE id = ?").bind(message.msgid+":1").first();
    if(!priorQuick&&!acknowledged&&!prepared)try{
      await reserveBudget(link.owner_id,"chat");
      const history=JSON.parse(thread.data||"[]") as typeof lines;
      quick=settings.jev_consent_at
        ? await quickJevJudgment(lines,history)
        : await quickJudgment(lines,history,await loadProfileContext(link.owner_id,link.subject_id,lines.map(line=>line.text).join("\n").slice(-500),700));
    }catch(error){console.warn("crush_quick_unavailable",jevFailure(error));}
    const current=await getSettings(link.owner_id);
    if(!current?.consent_at||current.consent_at!==settings.consent_at||current.jev_consent_at!==settings.jev_consent_at)throw new CrushError("聊天解读授权已改变，本次处理已停止。",409);
    await stillLinked();
    // On retries preserve outbox part numbering; a prior acknowledgement is reused.
    if(!acknowledged&&!prepared)await send(quick||"已收到这段聊天，正在做逐句分析；暂不凭片段猜测对方的真实想法。");
    let result:CrushResult;
    try{result=await analyzeLines(link.owner_id,input,{sourceKey:"wechat:"+message.msgid,channelKey:key,subjectId:link.subject_id,selfLabel,plainSpeaker:"other",providerOverride:"qwen",coverage,budgetMode:"chat",prepared,skipAffinity:!!prepared,decision});}
    catch(error){
      const stillAllowed=await getSettings(link.owner_id);
      if(!stillAllowed?.consent_at||stillAllowed.consent_at!==settings.consent_at||stillAllowed.jev_consent_at!==settings.jev_consent_at)return false;
      if(prepared){await send("这张截图的报告未保存成功："+(error instanceof CrushError?error.message:"服务暂时不可用，请稍后重发。"));return false;}
      await send("逐句报告暂时没完成："+(error instanceof CrushError?error.message:"服务暂时不可用，请稍后重试。")+"\n"+(confirmedVoice?"语音文字仍在1小时待确认期内，可以重发同一句身份确认指令重试。":"已暂存这段记录时可发「分析」重试；否则请重新发送。")+"快判断只是初步判断，别把它当成定论。");
      return false;
    }
    await stillLinked();
    let events=0;
    if(prepared&&!result.decision?.partial&&link.subject_id){
      try{events=await suggestScreenshotEvents(link.owner_id,link.subject_id,result);}
      catch{console.warn("wechat_screenshot_event_suggestion_failed");}
    }
    await stillLinked();
    if(prepared&&link.subject_id){
      await db.prepare("UPDATE coach_wechat_links SET memory_offer_start_revision=CASE WHEN memory_offer_report_id IS NULL OR (memory_offer_asked_at>0 AND memory_offer_expires_at<=?) THEN ? ELSE memory_offer_start_revision END,memory_offer_report_id=?,memory_offer_expires_at=?,memory_offer_asked_at=0 WHERE owner_id=? AND external_userid=? AND open_kfid=? AND subject_id=?").bind(Date.now(),result.revision,result.id,Date.now()+15*60000,link.owner_id,message.external_userid,message.open_kfid,link.subject_id).run();
    }
    if(!decisionAlreadySent)await send(prepared?formatWechatDecision(result,subjectLabel,events):formatWechatBrief(result,1,subjectLabel,events),result.id);
      return result;
  };
  if(message.msgtype==="image"){
    if(!message.image?.media_id){await send("微信未提供可下载的图片，请重新发送清晰截图。");return true;}
    const stamp=await stillLinked();
    if(!settings.image_consent_at||!["right","left"].includes(settings.image_self_side||"")){
      const hold=await getThread(link.owner_id,baseKey+"default",null);
      let entries=pendingImages(hold.image_pending,hold.image_pending_expires_at);
      try{entries=appendPendingImage(entries,{mediaId:message.image.media_id,msgid:message.msgid,consentAt:settings.consent_at!,stamp,subjectId:link.subject_id,expiresAt:Date.now()+3600000});}
      catch{throw new CrushError("已暂收8张截图，请先回复「同意截图识别」开启处理，或「取消分段」清空。本张尚未保存，开启后再发。",429);}
      await db.prepare("UPDATE coach_crush_threads SET image_pending=?,image_pending_expires_at=? WHERE id=? AND owner_id=?").bind(JSON.stringify({entries}),Math.max(...entries.map(v=>v.expiresAt)),hold.id,link.owner_id).run();
      await send(entries.length===1?"截图已收下，尚未识图。请先确认本人单聊截图哪侧是你：回复「同意截图识别 右侧是我」或「同意截图识别 左侧是我」。原图届时交阿里云百炼识别、不在本站归档；文字报告保留7天。原图不发给第三方分类服务，可随时关闭。":"已收下第"+entries.length+"张截图，没有覆盖前面的。确认哪侧是你后才会识图：回复「同意截图识别 右侧是我」或「同意截图识别 左侧是我」。");
      return true;
    }
    await reserveBudget(link.owner_id,"chat");
    // Confirm receipt before media download, profile loading, or vision inference.
    // The sync job may already have sent this through a separate durable ID.
    const earlyReceipt=await db.prepare("SELECT status FROM coach_wechat_outbox WHERE id=?").bind(message.msgid+":ack:1").first<{status:string}>();
    if(!earlyReceipt||!["sent","unknown"].includes(earlyReceipt.status))await send("收到，正在逐句看图。");
    const started=Date.now();
    let media:Awaited<ReturnType<typeof getWechatMedia>>;
    try{media=await getWechatMedia(message.image.media_id,2_000_000);}
    catch{throw new CrushError("微信图片下载暂未完成，请重新发送清晰截图。没有读到原图，本次不做判断。",503);}
    const downloadMs=Date.now()-started;
    await stillLinked();
    if(!/image\/(?:png|jpeg|jpg)/i.test(media.mime))throw new CrushError("请发送PNG或JPEG聊天截图。",415);
    const dataUrl="data:"+(media.mime.includes("png")?"image/png":"image/jpeg")+";base64,"+Buffer.from(media.bytes).toString("base64");
    const visionStarted=Date.now(),side=settings.image_self_side as ScreenshotSide;
    const profilePromise=loadProfileContext(link.owner_id,link.subject_id,"",1000);
    // OCR is usually fast. Avoid doubling upstream vision load on every image;
    // hedge only slow OCR, then use full vision if OCR or text analysis fails.
    let full:Promise<Awaited<ReturnType<typeof readScreenshot>>>|null=null;
    const startFull=()=>full??=profilePromise.then(profile=>readScreenshot(dataUrl,side,JSON.parse(thread.data||"[]"),profile,40000));
    const quick=readScreenshotQuickData(dataUrl,side);
    const first=await firstScreenshotRead(quick,startFull);
    let quickSent=false;
    let completed:{parsed:Awaited<ReturnType<typeof readScreenshot>>;source:"full"|"quick-text"};
    if(first.kind==="full"){
      completed={parsed:first.value,source:"full"};
    }else{
      const preview=first.value;
      if(preview?.text){await stillLinked();await send(preview.text);quickSent=true;}
      const fromQuick=preview?.raw
        ?readScreenshotFromQuick(preview.raw,side,JSON.parse(thread.data||"[]"),await profilePromise,26000)
        :Promise.reject(new CrushError("快判未得到可复用的原话。",422));
      const quickResult=fromQuick.then(parsed=>({parsed,source:"quick-text" as const}));
      if(full){
        completed=await Promise.any([quickResult,startFull().then(parsed=>({parsed,source:"full" as const}))])
          .catch(async()=>({parsed:await startFull(),source:"full" as const}));
      }else{
        completed=await quickResult.catch(async()=>({parsed:await startFull(),source:"full" as const}));
      }
    }
    const parsed=completed.parsed;
    console.info("wechat_screenshot_ready",{elapsedMs:Date.now()-started,downloadMs,visionMs:Date.now()-visionStarted,lineCount:parsed.count,source:completed.source,temporary:!link.subject_id});
    await stillLinked();
    const result=await analyze(parsed.text,"",undefined,parsed.prepared,parsed.decision,quickSent);
    if(result){
      const hold=await db.prepare("SELECT id,image_pending,image_pending_expires_at FROM coach_crush_threads WHERE owner_id=? AND channel_key=?").bind(link.owner_id,baseKey+"default").first<{id:string;image_pending:string;image_pending_expires_at:number}>();
      if(hold){const remaining=pendingImages(hold.image_pending,hold.image_pending_expires_at).filter(v=>v.msgid!==message.msgid);await db.prepare("UPDATE coach_crush_threads SET image_pending=?,image_pending_expires_at=? WHERE id=? AND owner_id=?").bind(remaining.length?JSON.stringify({entries:remaining}):"{}",Math.max(0,...remaining.map(v=>v.expiresAt)),hold.id,link.owner_id).run();}
      // A user's new screenshot permits up to five WeChat service replies.
      // Receipt + quick/decision + up to three cards fit the WeChat reply
      // window. The first compact card no longer hides later quotes below
      // oversized summary panels.
      const totalPages=cardPages(result).length;
      let cardsSent=0,firstCardMs:number|null=null,fallback=false;
      for(let page=1;page<=Math.min(3,totalPages);page++){
        await stillLinked();
        const sent=await sendImage(result,page);
        if(sent===false){fallback=true;await send(formatWechatImageFallback(result,page),result.id);break;}
        cardsSent++;
        if(firstCardMs===null)firstCardMs=Date.now()-started;
      }
      console.info("wechat_screenshot_delivery",{totalPages,cardsSent,firstCardMs,fallback,elapsedMs:Date.now()-started});
      // The customer stream must be released after the cards. Full Jev and
      // affinity work uses a separate report-specific queue lane, so the next
      // customer message never waits for optional post-processing.
      if(settings.jev_full_consent_at||settings.jev_consent_at&&settings.affinity_consent_at){
        const queue=(env as {WECHAT_QUEUE?:Queue}).WECHAT_QUEUE;
        if(queue)try{await queue.send({kind:"enrich",ownerId:link.owner_id,reportId:result.id});}
        catch{console.warn("wechat_report_enrichment_deferred");}
        else{
          if(settings.jev_full_consent_at)try{await enrichReportDistribution(link.owner_id,result.id);}catch{console.warn("wechat_full_distribution_unavailable");}
          if(settings.jev_consent_at&&settings.affinity_consent_at)try{await refreshReportAffinity(link.owner_id,result.id);}catch{console.warn("wechat_affinity_unavailable");}
        }
      }
    }
    return true;
  }
  if(message.msgtype==="voice"){
    if(!message.voice?.media_id){await send("微信没有提供这条语音的音频，暂时无法转写。合并转发中的语音占位文字不等于声音文件。");return true;}
    const stamp=await stillLinked();
    let buffer=pendingVoices(thread.voice_pending,settings.consent_at,stamp),entry=buffer.entries.find(entry=>entry.id===message.msgid);
    if(!entry){
      await reserveBudget(link.owner_id,"chat");
      const started=Date.now();
      let transcript;
      try{transcript=await transcribeWechatVoice(message.voice.media_id);}
      catch(error){console.warn("wechat_chat_voice_failed",{code:voiceErrorCode(error),elapsedMs:Date.now()-started});await stillLinked();await send(voicePublicError(error));return true;}
      await stillLinked();
      if(transcript.speakerCount>1){await send("这段录音有多个声音，不能整段归给你或对方。请用网页录音导入，分别确认各说话人：https://coach.lovetalk.love/import");return true;}
      buffer=appendPendingVoice(buffer,message.msgid,transcript.text);
      await saveVoices(buffer);entry=buffer.entries.at(-1)!;
      console.info("wechat_chat_voice_pending",{elapsedMs:Date.now()-started,textLength:entry.text.length});
    }
    await stillLinked();
    await send("第"+entry.number+"条语音已转文字：\n"+entry.text.slice(0,300)+(entry.text.length>300?"…（文字预览）":"")+"\n\n这是谁的聊天原话？回复「第"+entry.number+"条是我说的」或「第"+entry.number+"条是对方说的」，确认后接着同一段聊天分析。\n若是对军师提问，请发「军师：」加上识别文字；识别有误请先改正。待确认文字最多暂存1小时，不写入长期档案。");
    return true;
  }
  const voiceCommand=voiceRoleCommand(text);
  if(voiceCommand){
    const stamp=await stillLinked();
    const buffer=pendingVoices(thread.voice_pending,settings.consent_at,stamp),selected=selectPendingVoices(buffer,voiceCommand);
    const marked={...buffer,entries:buffer.entries.map(entry=>selected.some(item=>item.id===entry.id)?{...entry,role:voiceCommand.role}:entry)};
    await saveVoices(marked);
    const ready=confirmedVoicePrefix(marked);
    if(!ready.length){await send("已确认这条的说话人。为保持聊天顺序，请先确认第"+marked.entries[0].number+"条是谁说的，之后一起分析，不会把后发的话挪到前面。");return true;}
    const input=labeledVoiceText(ready);
    confirmedVoice=true;
    if(thread.collecting){
      const draft=[thread.draft,input].filter(Boolean).join("\n");
      if(draft.length>12000)throw new CrushError("当前分段文字已达到上限，请先分析已有文字。",400);
      await stillLinked();
      await db.prepare("UPDATE coach_crush_threads SET draft = ?, updated_at = ?, expires_at = ? WHERE id = ? AND owner_id = ?").bind(draft,Date.now(),Date.now()+7*86400000,thread.id,link.owner_id).run();
      await saveVoices({...marked,entries:marked.entries.filter(entry=>!ready.some(item=>item.id===entry.id))});
      await send("已按确认的说话人和原顺序加入这段聊天。继续补充，全部发完后发「分析」。");
    }else{
      const completed=await analyze(input,thread.self_label);
      if(completed)await saveVoices({...marked,entries:marked.entries.filter(entry=>!ready.some(item=>item.id===entry.id))});
    }
    return true;
  }
  if(message.msgtype==="merged_msg"){
    const voices=mergedVoiceCount(message);
    if(voices&&mergedVoiceCount(message,true)){await reserveBudget(link.owner_id,"chat");await send("已收到聊天记录，其中有 "+voices+" 条语音。正在读取可获取的音频；报告会注明哪些已转写、哪些没读到，不会把缺失内容当成对方态度。");acknowledged=true;}
    const merged=await prepareMergedWechat(message,async(id,signal)=>{
      const current=await getSettings(link.owner_id);
      if(!current?.consent_at||current.consent_at!==settings.consent_at)throw new CrushError("聊天解读授权已改变。",409);
      return transcribeWechatVoice(id,signal);
    });
    const matchedSelf=matchMergedSelfName(merged.names,thread.self_label);
    if(!matchedSelf){
      await db.prepare("UPDATE coach_crush_threads SET draft = ?, collecting = 1, updated_at = ? WHERE id = ? AND owner_id = ?").bind(merged.text,Date.now(),thread.id,link.owner_id).run();
      const current=await getSettings(link.owner_id);
      if(!current?.consent_at||current.consent_at!==settings.consent_at)throw new CrushError("聊天解读授权已改变。",409);
      await send(coverageText(merged.coverage)+"\n为避免认反人，请回复你在记录里的昵称；例如你叫「小李」，就发「我叫小李」。记录里昵称："+merged.names.join("、"));
      return true;
    }
    await db.prepare("UPDATE coach_crush_threads SET draft = ?, collecting = 1, updated_at = ?, expires_at = ? WHERE id = ? AND owner_id = ?").bind(merged.text,Date.now(),Date.now()+7*86400000,thread.id,link.owner_id).run();
    if(await analyze(merged.text,matchedSelf,merged.coverage))await db.prepare("UPDATE coach_crush_threads SET collecting = 0, draft = '' WHERE id = ? AND owner_id = ?").bind(thread.id,link.owner_id).run();
    return true;
  }
  const pageMatch=text.match(/^第\s*(\d{1,2})\s*页(起)?$/);
  if(pageMatch||text==="逐句"||text==="全部逐句"){
    const row=await db.prepare("SELECT id,result FROM coach_crush_reports WHERE thread_id = ? AND owner_id = ? AND status = 'done' AND expires_at > ? ORDER BY created_at DESC LIMIT 1").bind(thread.id,link.owner_id,Date.now()).first<{id:string;result:string}>();
    if(!row){await send("这段会话还没有报告，请先发聊天记录。");return true;}
    const result=JSON.parse(row.result) as CrushResult,page=pageMatch?Number(pageMatch[1]):1;
    await stillLinked();
    if(result.decision){
      const pages=cardPages(result);
      if(page<1||page>pages.length)throw new CrushError("这份逐句图共"+pages.length+"页，请发送有效页码。",400);
      const last=pageMatch?.[2]?Math.min(page+2,pages.length):page;
      let delivered=page;
      for(let number=page;number<=last;number++){
        await stillLinked();
        const sent=await sendImage(result,number);
        if(sent===false){await send(formatWechatImageFallback(result,number),row.id);return true;}
        delivered=number;
      }
      await stillLinked();
      await send(formatWechatImageNote(result,delivered),row.id);
    }else await send(formatWechatBrief(result,page,subjectLabel),row.id);
    return true;
  }
  if(text==="逐句模式"){await send("逐句解读已开启。直接发对方的话；整段记录请标「我：」「对方：」。\n你也可以发「我叫昵称」识别你的名字，发「开始分段」收集多条，再发「分析」。\n发送「军师：问题」可问其他关系问题。");return true;}
  if(/^我叫\s*\S/.test(text)){
    const label=text.replace(/^我叫\s*/,"").slice(0,60);
    await db.prepare("UPDATE coach_crush_threads SET self_label = ? WHERE id = ? AND owner_id = ?").bind(label,thread.id,link.owner_id).run();
    if(thread.collecting&&thread.draft){
      const names=namesInMergedDraft(thread.draft),matchedSelf=matchMergedSelfName(names,label);
      if(matchedSelf){
        if(await analyze(thread.draft,matchedSelf))await db.prepare("UPDATE coach_crush_threads SET collecting = 0, draft = '' WHERE id = ? AND owner_id = ?").bind(thread.id,link.owner_id).run();
        return true;
      }
      if(names.length){await send("记录里没有昵称「"+label+"」。请核对微信里你显示的昵称，再发「我叫昵称」。");return true;}
    }
    await send("记住了，你在这段聊天里的昵称是「"+label+"」。");return true;
  }
  if(text==="开始分段"){
    await db.prepare("UPDATE coach_crush_threads SET collecting = 1 WHERE id = ? AND owner_id = ?").bind(thread.id,link.owner_id).run();
    await send("开始收集。逐条发聊天文字，发送「分析」一起解读；发送「取消分段」丢弃未分析的草稿。");return true;
  }
  if(text==="取消分段"){
    await db.prepare("UPDATE coach_crush_threads SET collecting = 0, draft = '', voice_pending = '{}', voice_pending_expires_at = 0 WHERE id = ? AND owner_id = ?").bind(thread.id,link.owner_id).run();
    await db.prepare("UPDATE coach_crush_threads SET image_pending='{}',image_pending_expires_at=0 WHERE owner_id=? AND channel_key=?").bind(link.owner_id,baseKey+"default").run();
    await send("未分析的分段草稿、待确认语音和待关联截图已清空。");return true;
  }
  if(text==="清空聊天"){
    await db.batch([db.prepare("DELETE FROM coach_crush_reports WHERE thread_id = ? AND owner_id = ?").bind(thread.id,link.owner_id),db.prepare("DELETE FROM coach_crush_threads WHERE id = ? AND owner_id = ?").bind(thread.id,link.owner_id)]);
    await send("当前对象的微信逐句聊天与报告已清空，关系档案仍保留。");return true;
  }
  const naturalFollowup=!thread.collecting&&text!=="分析"&&thread.data!=="[]"&&!/^(?:我|对方|自己|他|她)[：:]/.test(text);
  if(naturalFollowup||text==="怎么回"||text==="我怎么回"||/^(?:军师[：:]|问[：:]|为什么|她是不是|他是不是|这说明|你觉得|接下来|我该怎么办|该不该|要不要|继续分析|再分析)/.test(text)){
    const row=await db.prepare("SELECT id FROM coach_crush_reports WHERE thread_id = ? AND owner_id = ? AND status = 'done' AND expires_at > ? ORDER BY created_at DESC LIMIT 1").bind(thread.id,link.owner_id,Date.now()).first<{id:string}>();
    if(!row&&/^(?:军师|问)[：:]/.test(text))return false;
    await stillLinked();
    const advice=row?(await replyAdvice(link.owner_id,row.id,text.replace(/^(?:军师|问)[：:]\s*/,""))).reply:"先选对象并发聊天截图，分析后再给你建议。";
    await stillLinked();await send("【"+subjectLabel+" · 军师】\n"+advice);return true;
  }
  if(thread.collecting && text!=="分析"){
    const draft=[thread.draft,text].filter(Boolean).join("\n");if(draft.length>12000)throw new CrushError("已达到分段上限，请发「分析」后再继续。");
    await db.prepare("UPDATE coach_crush_threads SET draft = ?, updated_at = ?, expires_at = ? WHERE id = ? AND owner_id = ?").bind(draft,Date.now(),Date.now()+7*86400000,thread.id,link.owner_id).run();
    // One acknowledgement per message, no model call while collecting.
    await send("已收下这段。全部发完后发送「分析」。");return true;
  }
  const input=text==="分析"?thread.draft:text;if(!input)throw new CrushError("还没有收到聊天文字，请先发一段。");
  // Keep the draft until both local report persistence and a durable reply have succeeded.
  const matchedSelf=text==="分析"?matchMergedSelfName(namesInMergedDraft(input),thread.self_label):null;
  const completed=await analyze(input,matchedSelf||thread.self_label);
  if(text==="分析"&&completed)await db.prepare("UPDATE coach_crush_threads SET collecting = 0, draft = '' WHERE id = ? AND owner_id = ?").bind(thread.id,link.owner_id).run();
  return true;
}
