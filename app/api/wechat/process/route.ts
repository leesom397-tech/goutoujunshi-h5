import {env} from "cloudflare:workers";
import {pullAndAnswer,processConversation} from "../callback/route";
import {quickJevJudgment} from "@/lib/crush/quick-jev";
import {affinityJev} from "@/lib/crush/affinity-jev";
import {jevFailure} from "@/lib/crush/jev-client";
import {parseChat} from "@/lib/crush/parser";
import {getD1} from "@/db";
import {uploadWechatImage,WechatMediaUploadRejected,wechatAccountHealth,WechatSendRejected} from "@/lib/wechat";
import {classify} from "@/lib/crush/provider";
import {transcribeWechatAudio} from "@/lib/wechat-asr";
import {recheckWechatVoice} from "@/lib/wechat-voice-recheck";
import {promptMemoryOffer} from "@/lib/crush/wechat";
import {createHash} from "node:crypto";
import {readScreenshot,readScreenshotQuick,readScreenshotQuickData,readScreenshotFromQuick,type QuickScreenshotFailure} from "@/lib/crush/screenshot";
import {prepareScreenshot} from "@/lib/crush/screenshot";
import {parseQwenJson,qwenChat,qwenKey,qwenWorkspaceId} from "@/lib/qwen";
import {CardRenderFailure,renderCard,renderCardsBatch} from "@/lib/crush/card";
import {CrushError,type CrushResult} from "@/lib/crush/types";
import {enrichReportDistribution,getSettings,ownedReport,refreshReportAffinity} from "@/lib/crush/service";
import {rewriteWithSamples} from "@/lib/crush/reply-rewrite";
import {handleVoiceBrandOperator,readOperatorJson} from "@/lib/voice-brand-operator";
export const runtime="edge";
export async function POST(request:Request){
  const config=env as {WECHAT_CALLBACK_TOKEN?:string;WECHAT_KF_ID?:string};
  if(!config.WECHAT_CALLBACK_TOKEN||request.headers.get("X-Wechat-Queue-Token")!==config.WECHAT_CALLBACK_TOKEN)return new Response("not found",{status:404});
  const body=await readOperatorJson(request);
  if(body instanceof Response)return body;
  const data=body as {kind?:string;token?:string;openKfId?:string;externalUserId?:string;ownerId?:string;reportId?:string;messageId?:string;imageData?:string;page?:number;probeId?:string;lane?:string}|null;
  if(data?.kind==="voice-brand-operator")return handleVoiceBrandOperator(data as Record<string,unknown>);
  if(data?.kind==="queue-probe-start"){
    // Operator-only, synthetic queue round trip. No customer identifiers or
    // messages are created. The temporary rows expire through normal cleanup.
    const now=Date.now(),slot=await getD1().prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,1,?)").bind("queue-probe-limit:"+Math.floor(now/60000),now+120000).run();
    if(!slot.meta.changes)return Response.json({status:"rate_limited"},{status:429});
    const probeId=crypto.randomUUID();
    const queueEnv=env as unknown as {WECHAT_PULL_QUEUE?:Queue;WECHAT_QUEUE?:Queue};
    for(const lane of ["pull","analysis"]){
      await getD1().prepare("INSERT INTO coach_crush_budget (id,uses,expires_at) VALUES (?,?,?)").bind("queue-probe-start:"+probeId+":"+lane,now,now+120000).run();
      const queue=lane==="pull"?queueEnv.WECHAT_PULL_QUEUE:queueEnv.WECHAT_QUEUE;
      if(!queue)return Response.json({status:"queue_unavailable",lane},{status:503});
      await queue.send({kind:"queue-probe",probeId,lane});
    }
    return Response.json({status:"queued",probeId},{headers:{"Cache-Control":"no-store"}});
  }
  if(data?.kind==="queue-probe-status"){
    if(!data.probeId||!/^[0-9a-f-]{36}$/.test(data.probeId))return Response.json({status:"invalid_probe"},{status:400});
    const lanes=[];
    for(const lane of ["pull","analysis"]){
      const start=await getD1().prepare("SELECT uses FROM coach_crush_budget WHERE id=? AND expires_at>?").bind("queue-probe-start:"+data.probeId+":"+lane,Date.now()).first<{uses:number}>();
      if(!start)return Response.json({status:"not_found"},{status:404});
      const done=await getD1().prepare("SELECT uses FROM coach_crush_budget WHERE id=? AND expires_at>?").bind("queue-probe-done:"+data.probeId+":"+lane,Date.now()).first<{uses:number}>();
      lanes.push({lane,status:done?"consumed":"pending",...(done?{queueWaitMs:Math.max(0,done.uses-start.uses)}:{})});
    }
    return Response.json({status:"ok",lanes},{headers:{"Cache-Control":"no-store"}});
  }
  if(data?.kind==="queue-probe"){
    if(!data.probeId||!/^[0-9a-f-]{36}$/.test(data.probeId)||!(["pull","analysis"].includes(data.lane||"")))return new Response("invalid probe",{status:400});
    const start=await getD1().prepare("SELECT uses FROM coach_crush_budget WHERE id=? AND expires_at>?").bind("queue-probe-start:"+data.probeId+":"+data.lane,Date.now()).first();
    if(!start)return new Response("expired probe",{status:410});
    await getD1().prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,?,?)").bind("queue-probe-done:"+data.probeId+":"+data.lane,Date.now(),Date.now()+120000).run();
    return new Response("ok");
  }
  if(data?.kind==="capacity-diagnostic"){
    // Operator-only: no browser is launched, no customer record is read, and
    // session identifiers are intentionally not returned.
    const binding=(env as unknown as {BROWSER?:import("@cloudflare/puppeteer").BrowserWorker}).BROWSER;
    if(!binding)return Response.json({status:"browser_not_configured"},{status:503});
    try{
      const {default:puppeteer}=await import("@cloudflare/puppeteer");
      const limits=await puppeteer.limits(binding);
      return Response.json({status:"ok",activeBrowserSessions:limits.activeSessions.length,maxConcurrentBrowserSessions:limits.maxConcurrentSessions,allowedBrowserAcquisitions:limits.allowedBrowserAcquisitions,timeUntilNextAllowedBrowserAcquisitionMs:limits.timeUntilNextAllowedBrowserAcquisition},{headers:{"Cache-Control":"no-store"}});
    }catch{return Response.json({status:"limits_unavailable"},{status:503});}
  }
  if(data?.kind==="qwen-text-diagnostic"||data?.kind==="qwen-text-max-diagnostic"){
    // Fixed fictional ping. Separates general model/auth latency from vision
    // latency without returning model text or sending any customer message.
    const now=Date.now(),slot=await getD1().prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,1,?)").bind(data.kind+":"+Math.floor(now/60000),now+120000).run();
    if(!slot.meta.changes)return Response.json({status:"rate_limited"},{status:429});
    try{
      const max=data.kind==="qwen-text-max-diagnostic";
      const raw=await qwenChat([{role:"system",content:"只返回 JSON {\"ok\":true}。"},{role:"user",content:"固定虚构连通性测试。"}],{fast:true,json:true,quality:max?"max":"flash",maxTokens:32,timeoutMs:max?45000:15000});
      const value=parseQwenJson<{ok?:boolean}>(raw);
      return Response.json({syntheticOnly:true,status:value.ok===true?"ok":"format_mismatch",elapsedMs:Date.now()-now,model:max?"qwen3.8-max":"qwen3.8-flash",wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
    }catch(error){
      const message=error instanceof Error?error.message:"";
      const failureKind=error instanceof Error&&["TimeoutError","AbortError"].includes(error.name)?"timeout":message==="QWEN_AUTH_FAILED"?"auth":message==="QWEN_BALANCE_EMPTY"?"balance":message==="QWEN_BUSY"?"rate_limit":message==="QWEN_UPSTREAM_ERROR"?"upstream":error instanceof SyntaxError?"json":error instanceof TypeError?"network":"other";
      return Response.json({syntheticOnly:true,status:"failed",model:data.kind==="qwen-text-max-diagnostic"?"qwen3.8-max":"qwen3.8-flash",failureKind,elapsedMs:Date.now()-now,wechatReplies:0,profileWrites:0},{status:503,headers:{"Cache-Control":"no-store"}});
    }
  }
  if(data?.kind==="reply-open-question-diagnostic"){
    // Fixed fictional text, no image, report, customer record or WeChat send.
    const now=Date.now(),slot=await getD1().prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,1,?)").bind("reply-open-question-diagnostic:"+Math.floor(now/60000),now+120000).run();
    if(!slot.meta.changes)return Response.json({status:"rate_limited"},{status:429});
    try{
      const ocr={layout:"wechat-one-to-one",lines:[["left","text","周日一起去看电影吧？"],["right","text","好呀，你下午有空吗？"],["left","text","有空，三点在电影院东门见。你知道东门怎么走吗？"]],judgment:"对方确认时间地点，并问东门路线。",nextStep:"按实际情况回答是否知道东门。",replyOptions:[{style:"知道路线",text:"东门我知道，周日三点见。"},{style:"不确定路线",text:"我不太确定东门怎么走，方便发个定位吗？"}]};
      let modelOptionCount=-1;
      const analyzed=await readScreenshotFromQuick(ocr,"right",[],"固定虚构测试；没有真实用户或对象。",26000,undefined,2,count=>{modelOptionCount=count;});
      const options=analyzed.decision.replyOptions||[];
      const complete=options.length>0&&options.length<=3&&options.every(option=>!!option.text&&!!option.reason&&!!option.cost&&typeof option.weight==="number")&&options.every((option,index)=>index===0||(options[index-1].weight??-1)>=(option.weight??-1));
      return Response.json({syntheticOnly:true,status:complete?"ok":"no_complete_reply",lineCount:analyzed.count,modelOptionCount,optionCount:options.length,hasIntent:!!analyzed.decision.possibleIntent,hasEvidence:!!analyzed.decision.evidence,hasAdvice:!!analyzed.decision.nextStep,elapsedMs:Date.now()-now,customerReads:0,wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
    }catch(error){return Response.json({syntheticOnly:true,status:"failed",failureKind:error instanceof Error&&["TimeoutError","AbortError"].includes(error.name)?"timeout":"analysis_or_format",elapsedMs:Date.now()-now,customerReads:0,wechatReplies:0,profileWrites:0},{status:503,headers:{"Cache-Control":"no-store"}});}
  }
  if(data?.kind==="rewrite-diagnostic"){
    // Operator-only fixed fiction. No report, profile, screenshot or request
    // supplied text enters the same model path used by the user button.
    const now=Date.now(),slot=await getD1().prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,1,?)").bind("rewrite-diagnostic:"+Math.floor(now/60000),now+120000).run();
    if(!slot.meta.changes)return Response.json({status:"rate_limited"},{status:429});
    try{
      const output=await rewriteWithSamples("周日下午我想问一下，你可以一起看展吗？",[
        "好呀，周日下午我应该有空～","行，那我到时候发你消息呀。","想问下你周末有没有空，一起看展？",
      ]);
      return Response.json({syntheticOnly:true,status:"ok",changed:output.status==="adjusted",length:output.text.length,elapsedMs:Date.now()-now,customerReads:0,wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
    }catch(error){
      const code=error instanceof CrushError&&error.message.includes("具体数字")?"numeric_anchor_changed":error instanceof CrushError?"validation_"+error.status:error instanceof Error&&["TimeoutError","AbortError"].includes(error.name)?"timeout":"provider_or_format";
      return Response.json({syntheticOnly:true,status:"failed",failureKind:code,elapsedMs:Date.now()-now,customerReads:0,wechatReplies:0,profileWrites:0},{status:503,headers:{"Cache-Control":"no-store"}});
    }
  }
  if(data?.kind==="wechat-account-diagnostic"){
    // Uses the deployed Worker secrets to verify API authentication and that
    // its configured customer-service account is returned by WeChat. Read-only.
    const now=Date.now(),slot=await getD1().prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,1,?)").bind("wechat-account-diagnostic:"+Math.floor(now/60000),now+120000).run();
    if(!slot.meta.changes)return Response.json({status:"rate_limited"},{status:429});
    try{
      const health=await wechatAccountHealth();
      return Response.json({status:health.configuredAccountPresent?"ok":"account_missing",accountCount:health.accountCount,configuredAccountPresent:health.configuredAccountPresent,customerReads:0,wechatReplies:0},{status:health.configuredAccountPresent?200:503,headers:{"Cache-Control":"no-store"}});
    }catch(error){
      const failureKind=error instanceof WechatSendRejected?"api_secret_rejected":error instanceof Error&&error.message==="WECHAT_NOT_CONFIGURED"?"configuration_missing":"api_unavailable";
      return Response.json({status:"failed",failureKind,customerReads:0,wechatReplies:0},{status:503,headers:{"Cache-Control":"no-store"}});
    }
  }
  if(data?.kind==="qwen-ocr-public-diagnostic"){
    // Fixed public example from Alibaba's OCR documentation. No request image,
    // customer record, or WeChat message can enter this operator-only probe.
    const now=Date.now(),slot=await getD1().prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,1,?)").bind("qwen-ocr-public-diagnostic:"+Math.floor(now/60000),now+120000).run();
    if(!slot.meta.changes)return Response.json({status:"rate_limited"},{status:429});
    const key=qwenKey(),workspace=qwenWorkspaceId();
    if(!key||!workspace)return Response.json({status:"configuration_missing"},{status:503});
    try{
      const upstream=await fetch("https://"+workspace+".cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",{
        method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},signal:AbortSignal.timeout(30000),
        body:JSON.stringify({model:"qwen3.5-ocr",input:{messages:[{role:"user",content:[{image:"https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241108/ctdzex/biaozhun.jpg",min_pixels:3072,max_pixels:8388608,enable_rotate:false}]}]},parameters:{ocr_options:{task:"advanced_recognition"}}}),
      });
      if(!upstream.ok)return Response.json({syntheticOnly:true,status:"upstream_error",httpStatus:upstream.status,elapsedMs:Date.now()-now,wechatReplies:0,profileWrites:0},{status:503});
      type OcrWord={text?:string;rotate_rect?:number[]};
      type OcrResponse={output?:{choices?:Array<{message?:{content?:Array<{ocr_result?:{words_info?:OcrWord[]}}>}}>}};
      const payload=await upstream.json() as OcrResponse;
      const words=payload.output?.choices?.[0]?.message?.content?.[0]?.ocr_result?.words_info||[];
      const located=words.filter(word=>typeof word.text==="string"&&Array.isArray(word.rotate_rect)&&word.rotate_rect.length===5).length;
      return Response.json({syntheticOnly:true,status:located?"ok":"empty",model:"qwen3.5-ocr",elapsedMs:Date.now()-now,wordCount:words.length,locatedCount:located,wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
    }catch(error){return Response.json({syntheticOnly:true,status:"failed",failureKind:error instanceof Error&&["TimeoutError","AbortError"].includes(error.name)?"timeout":"network_or_format",elapsedMs:Date.now()-now,wechatReplies:0,profileWrites:0},{status:503});}
  }
  if(data?.kind==="card-diagnostic"||data?.kind==="card-upload-diagnostic"||data?.kind==="card-batch-diagnostic"||data?.kind==="card-batch-upload-diagnostic"){
    // Fixed fictional input only. Never reads profiles or sends a message to a real WeChat user.
    const page=data.page??1;
    if(!Number.isInteger(page)||page<1||page>3)return Response.json({status:"invalid_page"},{status:400});
    const now=Date.now(),slot=await getD1().prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,1,?)").bind(data.kind+":"+page+":"+Math.floor(now/60000),now+120000).run();
    if(!slot.meta.changes)return Response.json({status:"rate_limited"},{status:429});
    const lines=[{id:"1",speaker:"other" as const,text:"周日一起去看电影吧？"},{id:"2",speaker:"self" as const,text:"好呀，你下午有空吗？"},{id:"3",speaker:"other" as const,text:"有空，三点在电影院门口见。"},{id:"4",speaker:"self" as const,text:"哈哈，那到时候见～"},{id:"5",speaker:"other" as const,text:"电影院门口是东门，你知道怎么走吗？"},{id:"6",speaker:"self" as const,text:"我还没去过那里，你能发个定位吗？"},{id:"7",speaker:"other" as const,text:"可以，我把位置发给你。"},{id:"8",speaker:"self" as const,text:"收到，谢谢！"},{id:"9",speaker:"other" as const,text:"电影结束后要不要顺便喝杯咖啡？"},{id:"10",speaker:"self" as const,text:"可以呀，到时看时间。"}];
    const grades=["sufficient","sufficient","sufficient","limited","sufficient","sufficient","sufficient","limited","sufficient","sufficient"] as const;
    const actions=[{key:"invite",label:"发出邀约"},{key:"agree",label:"表示认同"},{key:"inform",label:"告知信息"},{key:"continue",label:"延续话题"},{key:"ask",label:"询问信息"},{key:"ask",label:"询问信息"},{key:"inform",label:"告知信息"},{key:"thanks",label:"表达感谢"},{key:"invite",label:"发出邀约"},{key:"agree",label:"表示认同"}];
    const result:CrushResult={id:"fictional",threadId:"fictional",revision:1,provider:"qwen",model:"fictional-layout-only",lines,annotations:lines.map((line,i)=>({lineId:line.id,emotion:[{key:"calm",label:"平静"}],intent:[actions[i]],evidence:grades[i],note:i===0?"对方主动提出周日一起看电影，还把活动说得很具体；这至少是在推动一次线下见面，也可能只是想找人看这部电影，不能仅凭邀约认定长期恋爱意愿。":i===2?"对方接住我方对时间的追问，并给出三点和电影院门口两个可执行细节，说明这次安排正在落实；但是否会如约见面，还要以实际行动验证。":"虚构排版测试，不代表真实判断。"})),decision:{observation:"固定虚构对话",judgment:"虚构示例：对方提出活动并确认时间。",nextStep:"对方问你是否知道东门位置；先按实际情况回答，别假装知道。",replyDraft:"",replyReview:"你答应邀约并追问时间，承接自然；最后一句确认见面，没有多发或催促。",replyGrade:"S",replyOptions:[{style:"如果知道",text:"东门我知道，周日三点见～",reason:"直接回答对方的问题"},{style:"如果不确定",text:"我不太确定东门在哪，方便发个定位吗？",reason:"诚实确认集合位置"},{style:"先自己确认",text:"我先查下东门位置，确定了跟你说～",reason:"不假装熟悉地点"}],skipped:0},createdAt:now,expiresAt:now+60000,latencyMs:0,duplicateCount:0};
    let stage="render";
    try{
      if(data.kind==="card-batch-diagnostic"||data.kind==="card-batch-upload-diagnostic"){
        const cards=await renderCardsBatch(result,3);
        if(cards.length!==3||cards.some(bytes=>bytes.length<1000||bytes[0]!==0xff||bytes[1]!==0xd8))throw new Error("CARD_BATCH_INVALID");
        if(data.kind==="card-batch-upload-diagnostic"){
          stage="upload";
          await uploadWechatImage(cards[page-1]);
          return Response.json({status:"ok",syntheticOnly:true,page,stage:"upload",batchPages:cards.length,bytes:cards[page-1].length,elapsedMs:Date.now()-now,wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
        }
        return new Response(new Uint8Array(cards[page-1]).buffer,{headers:{"Content-Type":"image/jpeg","Cache-Control":"no-store","X-Card-Elapsed-Ms":String(Date.now()-now),"X-Card-Batch-Bytes":cards.map(bytes=>bytes.length).join(","),"X-Synthetic-Only":"true"}});
      }
      const bytes=await renderCard(result,page);
      if(data.kind==="card-upload-diagnostic"){
        stage="upload";
        await uploadWechatImage(bytes);
        return Response.json({status:"ok",syntheticOnly:true,page,stage:"upload",bytes:bytes.length,elapsedMs:Date.now()-now,wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
      }
      return new Response(bytes,{headers:{"Content-Type":"image/jpeg","Cache-Control":"no-store","X-Card-Elapsed-Ms":String(Date.now()-now),"X-Synthetic-Only":"true"}});
    }catch(error){return Response.json({syntheticOnly:true,status:"card_failed",stage,...(error instanceof CardRenderFailure?{browserPhase:error.phase,browserStatus:error.browserStatus}:{}),...(error instanceof WechatMediaUploadRejected?{wechatCode:error.code,httpStatus:error.httpStatus}:{}),elapsedMs:Date.now()-now,wechatReplies:0,profileWrites:0},{status:503});}
  }
  if(data?.kind==="screenshot-diagnostic"||data?.kind==="screenshot-full-ten-diagnostic"||data?.kind==="screenshot-staged-diagnostic"||data?.kind==="screenshot-parallel-diagnostic"||data?.kind==="screenshot-quick-diagnostic"||data?.kind==="screenshot-quick-ten-diagnostic"||data?.kind==="screenshot-quick-ten-vl-diagnostic"||data?.kind==="screenshot-ocr-ten-diagnostic"||data?.kind==="screenshot-quick-text-diagnostic"||data?.kind==="screenshot-quick-text-ten-diagnostic"||data?.kind==="screenshot-quick-text-ten-wide-diagnostic"){
    // Operator-only and pinned to the committed fictional fixture. No user uploads,
    // WeChat messages, profile reads or persistent reports may enter this probe.
    if(typeof data.imageData!=="string"||data.imageData.length>200000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.imageData))return new Response("invalid fixture",{status:400});
    const bytes=Buffer.from(data.imageData.split(",")[1],"base64");
    const tenLines=data.kind==="screenshot-full-ten-diagnostic"||data.kind==="screenshot-quick-text-ten-diagnostic"||data.kind==="screenshot-quick-text-ten-wide-diagnostic"||data.kind==="screenshot-quick-ten-diagnostic"||data.kind==="screenshot-quick-ten-vl-diagnostic"||data.kind==="screenshot-ocr-ten-diagnostic";
    const wide=data.kind==="screenshot-quick-text-ten-wide-diagnostic";
    const quickTen=data.kind==="screenshot-quick-ten-diagnostic"||data.kind==="screenshot-quick-ten-vl-diagnostic";
    const vl=data.kind==="screenshot-quick-ten-vl-diagnostic";
    if(createHash("sha256").update(bytes).digest("hex")!==(tenLines?"d952c35448734dc51551d81aef659313be5804851b506ff52efd354792018c18":"48a33dd540ade09e6e005790f06de926448bbbfe712c70c89e3db7c27c82813c"))return new Response("invalid fixture",{status:400});
    const now=Date.now(),slot=await getD1().prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,1,?)").bind("screenshot-diagnostic:"+(data.kind==="screenshot-ocr-ten-diagnostic"?"ten-ocr:":vl?"ten-vl:":quickTen?"ten-quick:":wide?"ten-wide:":data.kind==="screenshot-full-ten-diagnostic"?"ten-full:":tenLines?"ten:":"three:")+Math.floor(now/60000),now+120000).run();
    if(!slot.meta.changes)return Response.json({status:"rate_limited"},{status:429});
    let diagnosticStage="start";
    const batchTimings:import("@/lib/crush/screenshot").ScreenshotBatchTiming[]=[];
    let quickFailure:QuickScreenshotFailure|undefined;
    try{
      if(data.kind==="screenshot-ocr-ten-diagnostic"){
        diagnosticStage="ocr_model";
        const key=qwenKey(),workspace=qwenWorkspaceId();
        if(!key||!workspace)return Response.json({syntheticOnly:true,status:"configuration_missing"},{status:503});
        const upstream=await fetch("https://"+workspace+".cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",{
          method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},signal:AbortSignal.timeout(30000),
          body:JSON.stringify({model:"qwen3.5-ocr",input:{messages:[{role:"user",content:[{image:data.imageData,min_pixels:3072,max_pixels:8388608,enable_rotate:false}]}]},parameters:{ocr_options:{task:"advanced_recognition"}}}),
        });
        if(!upstream.ok)return Response.json({syntheticOnly:true,status:"upstream_error",httpStatus:upstream.status,elapsedMs:Date.now()-now},{status:503});
        type OcrWord={text?:string;rotate_rect?:number[]};
        type OcrResponse={output?:{choices?:Array<{message?:{content?:Array<{ocr_result?:{words_info?:OcrWord[]}}>}}>}};
        const payload=await upstream.json() as OcrResponse;
        const words=payload.output?.choices?.[0]?.message?.content?.[0]?.ocr_result?.words_info||[];
        const expected=["周末有空吗","有空，你想做什么","新开了一家咖啡店","听起来不错","周六下午一起去","可以，几点","三点怎么样","三点可以","那我把位置发你","好，收到位置我过去"];
        const clean=(value:unknown)=>String(value||"").replace(/[？?。.!！\s]/g,"");
        const bubbles=words.filter(word=>expected.some(text=>clean(word.text)===clean(text))).sort((a,b)=>(a.rotate_rect?.[1]||0)-(b.rotate_rect?.[1]||0));
        const correct=bubbles.length===expected.length&&bubbles.every((word,index)=>clean(word.text)===clean(expected[index])&&Array.isArray(word.rotate_rect)&&word.rotate_rect.length===5&&((word.rotate_rect[0]||0)<375)===(index%2===0));
        return Response.json({syntheticOnly:true,status:correct?"ok":"ocr_mismatch",model:"qwen3.5-ocr",elapsedMs:Date.now()-now,wordCount:words.length,bubbleCount:bubbles.length,bubbles:bubbles.map(word=>({text:String(word.text||"").slice(0,45),x:Math.round(word.rotate_rect?.[0]||0),y:Math.round(word.rotate_rect?.[1]||0)})),wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
      }
      if(quickTen){
        diagnosticStage="quick_ocr";
        const quick=await readScreenshotQuickData(data.imageData,"right",vl?"qwen3-vl-flash":undefined,kind=>{quickFailure=kind;});
        const expected=["周末有空吗？","有空，你想做什么？","新开了一家咖啡店。","听起来不错。","周六下午一起去？","可以，几点？","三点怎么样？","三点可以。","那我把位置发你。","好，收到位置我过去。"];
        const clean=(value:unknown)=>String(value||"").replace(/[？?。.!！\s]/g,"");
        const rows=quick?.raw.lines||[];
        const mismatches=rows.flatMap((row,index)=>Array.isArray(row)&&row[0]===(index%2?"right":"left")&&row[1]==="text"&&clean(row[2])===clean(expected[index])?[]:[{index,side:Array.isArray(row)?row[0]:null,kind:Array.isArray(row)?row[1]:null,observed:Array.isArray(row)?String(row[2]||"").slice(0,80):null,expected:expected[index]||null}]);
        const verified=rows.length===expected.length&&mismatches.length===0;
        return Response.json({syntheticOnly:true,status:verified?"ok":quick?"ocr_mismatch":"quick_unavailable",...(quickFailure?{failureKind:quickFailure}:{}),model:vl?"qwen3-vl-flash":"qwen3.8-flash",elapsedMs:Date.now()-now,lineCount:rows.length,quickPreviewReady:!!quick?.text,...(verified?{}:{mismatches}),wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
      }
      if(data.kind==="screenshot-quick-text-diagnostic"||tenLines&&data.kind!=="screenshot-full-ten-diagnostic"){
        diagnosticStage="quick_ocr";
        const quick=await readScreenshotQuickData(data.imageData,"right",undefined,kind=>{quickFailure=kind;});
        if(!quick?.raw)return Response.json({syntheticOnly:true,status:"quick_unavailable",...(quickFailure?{failureKind:quickFailure}:{}),elapsedMs:Date.now()-now,wechatReplies:0,profileWrites:0},{status:503});
        const ocrMs=Date.now()-now;
        diagnosticStage="text_analysis";
        let modelOptionCount=-1;
        const analyzed=await readScreenshotFromQuick(quick.raw,"right",[],"仅为虚构性能测试，不对应真实用户或对象。",26000,timing=>batchTimings.push(timing),wide?4:2,count=>{modelOptionCount=count;});
        const expected=tenLines?["周末有空吗？","有空，你想做什么？","新开了一家咖啡店。","听起来不错。","周六下午一起去？","可以，几点？","三点怎么样？","三点可以。","那我把位置发你。","好，收到位置我过去。"]:["周日一起去看电影吧？","好呀，你下午有空吗？","有空，三点在电影院门口见。"];
        const clean=(value:string)=>value.replace(/[？?。.!！\s]/g,"");
        const verified=analyzed.count===expected.length&&analyzed.prepared.lines.every((line,index)=>clean(line.text)===clean(expected[index])&&line.speaker===(index%2?"self":"other"));
        const decision=analyzed.decision,options=decision.replyOptions||[];
        const hasIntent=!!decision.possibleIntent&&decision.possibleIntent!=="对方意图的依据还不够";
        const hasEvidence=!!decision.evidence?.startsWith("对方原话：「");
        const hasAdvice=!!decision.nextStep;
        const optionsComplete=options.length<=3&&options.every(option=>!!option.text&&!!option.reason&&!!option.cost&&typeof option.weight==="number");
        const optionsRanked=options.every((option,index)=>index===0||(options[index-1].weight??-1)>=(option.weight??-1));
        const decisionReady=hasIntent&&hasEvidence&&hasAdvice&&optionsComplete&&optionsRanked;
        return Response.json({syntheticOnly:true,status:!verified?"count_or_quote_mismatch":decisionReady?"ok":"decision_incomplete",ocrMs,totalMs:Date.now()-now,lineCount:analyzed.count,batchConcurrency:wide?4:2,batchTimings:batchTimings.sort((a,b)=>a.index-b.index),decision:{hasIntent,hasEvidence,hasAdvice,replyAvailability:options.length?"offered":"abstained",optionCount:options.length,modelOptionCount,quickOptionCount:Array.isArray(quick.raw.replyOptions)?quick.raw.replyOptions.length:-1,partial:!!decision.partial,unreadText:decision.unreadText||0,unknownSpeaker:decision.unknownSpeaker||0,lastSpeaker:analyzed.prepared.lines.at(-1)?.speaker||"none",optionsComplete,optionsRanked},wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
      }
      if(data.kind==="screenshot-quick-diagnostic"){
        const quick=await readScreenshotQuick(data.imageData,"right");
        return Response.json({syntheticOnly:true,status:quick?"ok":"unavailable",elapsedMs:Date.now()-now,fictionalPreview:quick?.slice(0,500)||"",wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
      }
      if(data.kind==="screenshot-staged-diagnostic"||data.kind==="screenshot-parallel-diagnostic"){
        const parallel=data.kind==="screenshot-parallel-diagnostic";
        const fullStarted=Date.now();
        const fullPromise=parallel?readScreenshot(data.imageData,"right",[],"仅为虚构性能测试，不对应真实用户或对象.").then(result=>({result,fullMs:Date.now()-fullStarted,error:null}),error=>({result:null,fullMs:Date.now()-fullStarted,error})):null;
        const ocrStarted=Date.now();
        const ocr=parseQwenJson<{layout?:string;complete?:boolean;lines?:unknown[];judgment?:string;nextStep?:string}>(await qwenChat([
          {role:"system",content:"先逐个抄写这张微信双方单聊截图中从上到下的全部聊天气泡。右侧是我，左侧是对方；不按头像或语气猜人。语音未转文字标voice，截断或看不清标unread，不猜文字。再仅根据可读原话写一句不读心的局部判断和一个具体可做的下一步，各不超过35字；不判断喜欢概率。只返回JSON {layout:'wechat-one-to-one'或'other',complete:boolean,lines:[[left/right/unknown,text/voice/image/unread,原文或空字符串],...],judgment,nextStep}。"},
          {role:"user",content:[{type:"text",text:"固定虚构测试截图。请逐个抄写所有文字气泡。"},{type:"image_url",image_url:{url:data.imageData,detail:"high"}}]}
        ],{vision:true,fast:true,json:true,maxTokens:750,timeoutMs:22000}));
        const ocrMs=Date.now()-ocrStarted;
        const rows=Array.isArray(ocr.lines)?ocr.lines:[];
        const expected=["周日一起去看电影吧","好呀，你下午有空吗","有空，三点在电影院门口见"];
        const clean=(value:unknown)=>String(value||"").replace(/[？?。.!！\s]/g,"");
        const correct=ocr.layout==="wechat-one-to-one"&&rows.length===3&&rows.every((row,index)=>Array.isArray(row)&&row[0]===(index===1?"right":"left")&&clean(row[2])===expected[index]);
        if(!correct){await fullPromise;return Response.json({syntheticOnly:true,status:"ocr_mismatch",ocrMs,lineCount:rows.length,wechatReplies:0,profileWrites:0});}
        if(fullPromise){
          const full=await fullPromise;
          if(full.error)throw full.error;
          if(!full.result)throw new Error("DIAGNOSTIC_FULL_RESULT_MISSING");
          return Response.json({syntheticOnly:true,status:full.result.count===3?"ok":"full_mismatch",ocrMs,fullMs:full.fullMs,totalMs:Date.now()-now,lineCount:full.result.count,fictionalQuickPreview:String(ocr.judgment||"").slice(0,70),fictionalNextStep:String(ocr.nextStep||"").slice(0,70),wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
        }
        const detailStarted=Date.now();
        const detailed=parseQwenJson<import("@/lib/crush/screenshot").ScreenshotOutput>(await qwenChat([
          {role:"system",content:"你是谨慎的关系聊天分析器。输入是已核对的微信气泡原文，所有气泡都必须按原顺序原样返回，不能增删改。只返回JSON {layout:'wechat-one-to-one',complete:true,lines:[[side,'text',原文,emotions,intents,evidence,note],...],observation,judgment,nextStep,replyDraft,replyReview,replyGrade,replyOptions,affinityDims,boundary}。emotions/intents各为[{key,weight}]且本组weight总和100，意图优先给1至3个有证据的候选；evidence为sufficient/limited/insufficient。每句note写45到90字，说明可见依据、可能沟通作用和另一种解释，不能读心。评估当前互动并给一个具体下一步。replyOptions为3个自然承接/轻松推进/明确邀约选择，每个有style,text,reason。affinityDims按initiative/engagement/care/openness/intimacy/action各返回[key,0到4或null,sufficient/limited/insufficient]，无证据给null。"},
          {role:"user",content:JSON.stringify({confirmedSelfSide:"right",lines:rows})}
        ],{fast:true,json:true,maxTokens:1800,timeoutMs:22000}));
        const detailMs=Date.now()-detailStarted;
        const prepared=prepareScreenshot(detailed,"right");
        const accurate=prepared.count===3&&prepared.prepared.lines.every((line,index)=>clean(line.text)===expected[index]);
        return Response.json({syntheticOnly:true,status:accurate?"ok":"detail_mismatch",ocrMs,detailMs,totalMs:Date.now()-now,lineCount:prepared.count,wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
      }
      const result=await readScreenshot(data.imageData,"right",[],"仅为虚构性能测试，不对应真实用户或对象。");
      const expected=tenLines?["周末有空吗？","有空，你想做什么？","新开了一家咖啡店。","听起来不错。","周六下午一起去？","可以，几点？","三点怎么样？","三点可以。","那我把位置发你。","好，收到位置我过去。"]:["周日一起去看电影吧","好呀，你下午有空吗","有空，三点在电影院门口见"];
      const passed=result.count===expected.length&&result.prepared.lines.every((line,i)=>line.text.replace(/[？?。.!！\s]/g,"")===expected[i].replace(/[？?。.!！\s]/g,""))&&result.prepared.lines.every((line,i)=>line.speaker===(i%2?"self":"other"));
      return Response.json({syntheticOnly:true,status:passed?"ok":"mismatch",elapsedMs:Date.now()-now,lineCount:result.count,
        // This fixture is pinned, fictional and has no profile or real WeChat data.
        decisionPreview:result.decision.judgment.slice(0,100),
        labels:result.prepared.lines.map(line=>({speaker:line.speaker,evidence:line.annotation.evidence,emotions:line.annotation.emotion.map(tag=>({label:tag.label,weight:tag.probability})),intents:line.annotation.intent.map(tag=>({label:tag.label,weight:tag.probability})),note:line.annotation.note.slice(0,105)})),
        wechatReplies:0,profileWrites:0},{headers:{"Cache-Control":"no-store"}});
    }catch(error){
      const cause=error instanceof Error?error.cause:null;
      const kind=cause instanceof Error&&["TimeoutError","AbortError","TypeError"].includes(cause.name)?cause.name:
        cause instanceof Error&&/^QWEN_(?:BUSY|UPSTREAM_ERROR|EMPTY_RESPONSE|AUTH_FAILED|BALANCE_EMPTY)$/.test(cause.message)?cause.message:
        error instanceof CrushError&&error.message==="截图解读格式未完成，请稍后重试。"?"model_json_invalid":
        error instanceof CrushError&&error.message==="截图没有生成可读结果。"?"model_json_empty":"other";
      const validationCode=error instanceof CrushError?({"快判文字未能完整转为逐句分析。":"annotation_count","快判气泡结构不完整。":"ocr_shape","快判逐句标签不完整。":"annotation_shape"} as Record<string,string>)[error.message]||"other":null;
      return Response.json({syntheticOnly:true,status:"failed",stage:diagnosticStage,failureKind:kind,errorClass:error instanceof CrushError?"validation_"+error.status:error instanceof Error&&["TimeoutError","AbortError","TypeError","SyntaxError"].includes(error.name)?error.name:"other",validationCode,batchTimings:batchTimings.sort((a,b)=>a.index-b.index),elapsedMs:Date.now()-now,wechatReplies:0,profileWrites:0});
    }
  }
  if(data?.kind==="voice-recheck"){
    if(!config.WECHAT_KF_ID||typeof data.messageId!=="string")return new Response("invalid diagnostic",{status:400});
    return Response.json(await recheckWechatVoice(data.messageId,config.WECHAT_KF_ID),{headers:{"Cache-Control":"no-store"}});
  }
  if(data?.kind==="provider-diagnostic"||data?.kind==="analysis-diagnostic"||data?.kind==="asr-diagnostic"||data?.kind==="realtime-diagnostic"){
    // Operator-only, fixed fictional input, at most one probe per minute.
    const db=getD1(),now=Date.now(),id=data.kind+":"+Math.floor(now/60000);
    const slot=await db.prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,1,?)").bind(id,now+120000).run();
    if(!slot.meta.changes)return Response.json({status:"rate_limited"},{status:429});
    if(data.kind==="asr-diagnostic"){
      // Two seconds of generated silence. No user's voice or third-party audio.
      const wav=Buffer.alloc(64044);wav.write("RIFF",0);wav.writeUInt32LE(64036,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(64000,40);
      const started=Date.now();try{await transcribeWechatAudio(wav,"wav",AbortSignal.timeout(20000),true);return Response.json({status:"reachable",elapsedMs:Date.now()-started});}catch(error){const code=error instanceof Error&&/^WECHAT_ASR_(?:EMPTY|NOT_CONFIGURED|HTTP_\d{3})$/.test(error.message)?error.message:"ASR_NETWORK_OR_FORMAT";return Response.json({status:code==="WECHAT_ASR_EMPTY"?"reachable_silence":"failed",elapsedMs:Date.now()-started,code,detail:(error as {diagnostic?:string})?.diagnostic});}
    }
    if(data.kind==="realtime-diagnostic"){
      // Fixed, silent handshake only: no microphone, user content or model response generation.
      const started=Date.now(),key=qwenKey(),workspace=qwenWorkspaceId();
      if(!key||!workspace)return Response.json({status:"failed",code:"VOICE_NOT_CONFIGURED"});
      let upstream:Response;
      try{upstream=await fetch("https://"+workspace+".cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-flash-realtime",{headers:{Upgrade:"websocket",Authorization:"Bearer "+key},signal:AbortSignal.timeout(12000)});}
      catch{return Response.json({status:"failed",code:"VOICE_CONNECT_FAILED",elapsedMs:Date.now()-started});}
      const webSocket=(upstream as Response&{webSocket?:WebSocket}).webSocket;
      if(upstream.status!==101||!webSocket)return Response.json({status:"failed",code:"VOICE_HTTP_"+upstream.status,elapsedMs:Date.now()-started});
      webSocket.accept();
      const result=await new Promise<{status:string;code?:string;events:string[]}>(resolve=>{
        let settled=false;
        const events:string[]=[];
        const finish=(value:{status:string;code?:string})=>{if(settled)return;settled=true;clearTimeout(timer);resolve({...value,events});};
        const timer=setTimeout(()=>finish({status:"failed",code:"VOICE_SESSION_TIMEOUT"}),8000);
        webSocket.addEventListener("message",event=>{if(typeof event.data!=="string")return;try{
          const packet=JSON.parse(event.data) as {type?:string;error?:{code?:string}};
          if(["session.created","session.updated","error"].includes(packet.type||""))events.push(packet.type!);
          if(packet.type==="session.created")webSocket.send(JSON.stringify({type:"session.update",session:{modalities:["text","audio"],voice:"Ethan",input_audio_format:"pcm",output_audio_format:"pcm",input_audio_transcription:{model:"qwen3-asr-flash-realtime"},turn_detection:{type:"semantic_vad",threshold:0.5,silence_duration_ms:700},instructions:"只进行连通性诊断，不生成回复。"}}));
          else if(packet.type==="session.updated")finish({status:"ready"});
          else if(packet.type==="error")finish({status:"failed",code:typeof packet.error?.code==="string"&&/^[A-Za-z0-9_.-]{1,40}$/.test(packet.error.code)?"VOICE_PROVIDER_"+packet.error.code:"VOICE_SESSION_REJECTED"});
        }catch{}});
        webSocket.addEventListener("close",event=>finish({status:"failed",code:"VOICE_CLOSED_"+event.code}));
      });
      try{webSocket.close(1000,"诊断完成");}catch{}
      return Response.json({...result,elapsedMs:Date.now()-started});
    }
    const lines=parseChat("我：周末一起喝咖啡吗？\n对方：好呀，周日下午可以。\n我：三点在图书馆旁的咖啡店？\n对方：可以，我很想听听你最近的新项目。\n我：谢谢你的关心。\n对方：别太累了，到时候见。");
    if(data.kind==="analysis-diagnostic"){
      const context=Array.from({length:28},(_,index)=>({...lines[index%lines.length],id:"fictional-"+index})),started=Date.now();
      try{const results=await Promise.all([classify(context,context.slice(0,16),"qwen"),classify(context,context.slice(16),"qwen")]);return Response.json({status:"ok",elapsedMs:Date.now()-started,lineCount:results.reduce((sum,result)=>sum+result.annotations.length,0),classifiedCount:results.reduce((sum,result)=>sum+result.annotations.filter(a=>a.evidence!=="insufficient").length,0)});}catch{return Response.json({status:"failed",elapsedMs:Date.now()-started});}
    }
    const check=async(name:string,operation:()=>Promise<unknown>)=>{const start=Date.now();try{const result=await operation();return {name,elapsedMs:Date.now()-start,status:result?"ok":"empty",...(name==="affinity"&&result?{signal:result}:{})};}catch(error){const message=error instanceof Error?error.message:"";return {name,elapsedMs:Date.now()-start,status:"failed",code:jevFailure(error),errorType:error instanceof Error?error.name:"unknown",runtimeIssue:/AbortSignal|timeout is not a function/.test(message)?"abort_timeout_unavailable":/undefined.*JEV|JEV.*undefined/.test(message)?"env_unavailable":/context|I\/O|request/.test(message)?"request_context":"other"};}};
    return Response.json({checks:await Promise.all([check("quick",()=>quickJevJudgment(lines)),check("affinity",()=>affinityJev(lines))])});
  }
  if(data?.kind==="enrich"){
    if(!data.ownerId||data.ownerId.length>200||!data.reportId||!/^[a-f0-9-]{36}$/.test(data.reportId))return new Response("invalid job",{status:400});
    const settings=await getSettings(data.ownerId);
    if(!settings?.consent_at)return new Response("ok");
    let retryError:unknown=null;
    if(settings.jev_full_consent_at)try{await enrichReportDistribution(data.ownerId,data.reportId);}
    catch(error){if(!(error instanceof CrushError)||![403,404,409].includes(error.status))retryError=error;else console.warn("wechat_full_distribution_skipped",{status:error.status});}
    if(settings.jev_consent_at&&settings.affinity_consent_at)try{
      const report=await ownedReport(data.ownerId,data.reportId);
      if(report.affinityStatus!=="ready")await refreshReportAffinity(data.ownerId,data.reportId);
    }
    catch(error){if(!(error instanceof CrushError)||![403,404,409].includes(error.status))retryError=error;else console.warn("wechat_affinity_skipped",{status:error.status});}
    if(retryError)throw retryError;
    return new Response("ok");
  }
  if(!data?.openKfId||data.openKfId!==config.WECHAT_KF_ID)return new Response("invalid job",{status:400});
  if(data.kind==="memoryPrompt"){
    if(!data.externalUserId||data.externalUserId.length>200)return new Response("invalid job",{status:400});
    await promptMemoryOffer(data.openKfId,data.externalUserId);
    return new Response("ok");
  }
  if(data.kind==="message"){
    if(!data.externalUserId||data.externalUserId.length>200)return new Response("invalid job",{status:400});
    await processConversation(data.openKfId,data.externalUserId);
  }else{
    if(data.kind!=="pull"||typeof data.token!=="string"||data.token.length>2000)return new Response("invalid job",{status:400});
    await pullAndAnswer(data.token,data.openKfId);
  }
  return new Response("ok");
}
