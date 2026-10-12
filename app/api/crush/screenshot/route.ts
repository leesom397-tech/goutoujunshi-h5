import {getChatGPTUser} from "@/app/chatgpt-auth";
import {getD1} from "@/db";
import {getSettings,getThread,analyzeLines,reserveBudget,type Thread} from "@/lib/crush/service";
import {readScreenshot,readScreenshotFromQuick,readScreenshotQuickData} from "@/lib/crush/screenshot";
import {CrushError} from "@/lib/crush/types";
import {loadProfileContext} from "@/lib/profile-context";
import {suggestScreenshotEvents} from "@/lib/crush/archive";
import {qwenPublicError} from "@/lib/qwen";
import {readableReport} from "@/lib/crush/evidence";
import type {CrushResult} from "@/lib/crush/types";
import {env} from "cloudflare:workers";

export const runtime="edge";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const uuid=(value:unknown)=>typeof value==="string"&&/^[a-f0-9-]{36}$/.test(value);

export async function POST(request:Request){
  const user=await getChatGPTUser();
  if(!user)return json({error:"请先登录后分析自己的聊天。"},401);
  return analyzeScreenshot(request,user.userId);
}

// Reused by the native Mini Program after a server-verified, explicitly linked
// OpenID session. The caller must authenticate before passing ownerId.
export async function analyzeScreenshot(request:Request,owner:string){
  const started=Date.now();
  let stage="request";
  let ocrMs=0,textMs=0;
  if(!request.headers.get("content-type")?.includes("application/json"))return json({error:"请上传 PNG 或 JPG 聊天截图。"},415);
  if(Number(request.headers.get("content-length")||0)>7_100_000)return json({error:"截图超过 5 MB，请选择更小的图片。"},413);
  let body:Record<string,unknown>;
  try{
    const raw=await request.text();
    if(raw.length>7_100_000)return json({error:"截图超过 5 MB，请选择更小的图片。"},413);
    body=JSON.parse(raw);
    if(!body||Array.isArray(body)||typeof body!=="object")throw Error();
  }catch{return json({error:"截图材料无法读取。"},400);}
  try{
    if(body.confirmed!==true)throw new CrushError("请确认你有权提供这张本人双人单聊截图。",403);
    if(typeof body.image!=="string"||body.image.length>7_000_000||!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(body.image))throw new CrushError("请上传 5 MB 内的 PNG 或 JPG 截图。",400);
    if(!uuid(body.requestId)||!uuid(body.sessionId)||body.threadId!=null&&!uuid(body.threadId))throw new CrushError("请重新提交本次截图。",400);
    if(body.subjectId!=null&&(typeof body.subjectId!=="string"||body.subjectId.length>100))throw new CrushError("对象无效。",400);
    const subject=typeof body.subjectId==="string"?body.subjectId:null;
    const settings=await getSettings(owner);
    if(!settings?.consent_at||!settings.image_consent_at||!(["left","right"].includes(settings.image_self_side||"")))throw new CrushError("请先在页面同意截图识别并确认哪侧是你。",403);
    if(body.selfSide!==settings.image_self_side)throw new CrushError("截图的本人气泡位置与已保存设置不一致，请重新确认。",409);
    // A mobile client may time out after the report was saved. Resolve the
    // same owner/request before calling vision again; otherwise a retry pays
    // for OCR twice and can exceed the mobile request window repeatedly.
    const prior=await getD1().prepare("SELECT r.status,r.result,r.updated_at,t.subject_id FROM coach_crush_reports r JOIN coach_crush_threads t ON t.id=r.thread_id AND t.owner_id=r.owner_id WHERE r.owner_id=? AND r.source_key=? AND r.expires_at>?")
      .bind(owner,"web-image:"+body.requestId,Date.now()).first<{status:string;result:string|null;updated_at:number;subject_id:string|null}>();
    if(prior){
      if(prior.subject_id!==subject)throw new CrushError("本次截图对应的对象已改变，请重新选择截图。",409);
      if(prior.status==="done"&&prior.result)return json(readableReport(JSON.parse(prior.result) as CrushResult));
      if(prior.status==="running"&&Date.now()-prior.updated_at<330000)return json({error:"这张截图仍在分析，请稍后查看进度。",processing:true},409);
    }
    const channelKey="web:"+(subject||"temporary:"+body.sessionId);
    const thread=body.threadId
      ? await getD1().prepare("SELECT * FROM coach_crush_threads WHERE id=? AND owner_id=? AND expires_at>?").bind(body.threadId,owner,Date.now()).first<Thread>()
      : await getThread(owner,channelKey,subject);
    if(!thread||thread.subject_id!==subject)throw new CrushError("这张图属于另一位对象或已失效的聊天，请开启新聊天。",409);
    // A report opened from WeChat keeps its original thread and person when
    // the user continues that conversation on the web.
    const day=new Date().toISOString().slice(0,10);
    for(const [key,limit] of [[owner+":"+day,30],["global:"+day,500]] as const){
      const budget=await getD1().prepare("SELECT uses FROM coach_crush_budget WHERE id=?").bind(key).first<{uses:number}>();
      if(budget&&budget.uses>=limit)throw new CrushError("今天的深度分析已达到试运行上限，请明天继续。",429);
    }
    await reserveBudget(owner,"chat");
    const existing=JSON.parse(thread.data||"[]");
    const selfSide=settings.image_self_side as "left"|"right";
    const runtime=env as unknown as {WECHAT_CALLBACK_TOKEN?:string;SOCIAL_PROFILE_JOBS?:DurableObjectNamespace};
    const taskId=request.headers.get("x-screenshot-task");
    const internal=!!runtime.WECHAT_CALLBACK_TOKEN && request.headers.get("x-screenshot-job-key")===runtime.WECHAT_CALLBACK_TOKEN && uuid(taskId);
    const stub=internal && runtime.SOCIAL_PROFILE_JOBS ? runtime.SOCIAL_PROFILE_JOBS.get(runtime.SOCIAL_PROFILE_JOBS.idFromName(owner)) as unknown as {screenshotCheckpoint:(task:string,id:string,owner:string,token:string,update?:unknown)=>Promise<{raw?:import("@/lib/crush/screenshot").QuickScreenshotOutput}>} : null;
    const checkpoint=async(update?:unknown)=>{
      if(!stub)return null;
      try{return await stub.screenshotCheckpoint(taskId!,body.requestId as string,owner,runtime.WECHAT_CALLBACK_TOKEN!,update);}
      catch{console.warn("screenshot_checkpoint_unavailable");return null;}
    };
    const cached=await checkpoint();
    // Mobile clients have a finite request window.  First separate OCR from
    // the text-only analysis, which is faster and has proved more resilient
    // for long screenshots than one oversized vision request.  If OCR cannot
    // complete, keep a bounded legacy pass as a compatibility fallback.
    stage="ocr";
    await checkpoint({phase:cached?.raw?"text_analysis":"ocr"});
    const ocrStarted=Date.now();
    const [profile,quick]=await Promise.all([
      loadProfileContext(owner,subject,"",1000),
      cached?.raw ? Promise.resolve({raw:cached.raw}) : readScreenshotQuickData(body.image,selfSide,undefined,kind=>{
        console.warn("miniapp_screenshot_quick_unavailable",{kind});
      },"recognition")
    ]);
    ocrMs=Date.now()-ocrStarted;
    stage="text_analysis";
    await checkpoint({phase:"text_analysis",...(quick?.raw?{raw:quick.raw}:{})});
    const textStarted=Date.now();
    let parsed;
    let source="full_fallback";
    if(quick?.raw){
      try{
        parsed=await readScreenshotFromQuick(quick.raw,selfSide,existing,profile,26000,undefined,4,undefined,true);
        source="quick_text";
      }catch(error){
        console.warn("miniapp_screenshot_text_analysis_unavailable",{kind:error instanceof Error?error.name:"unknown"});
        // Network/provider failures cannot be fixed by reading the same image
        // again. The durable retry reuses the OCR checkpoint instead.
        if(!(error instanceof SyntaxError || error instanceof CrushError && error.status===422))throw error;
        parsed=await readScreenshot(body.image,selfSide,existing,profile,30000);
      }
    }else{
      parsed=await readScreenshot(body.image,selfSide,existing,profile,30000);
    }
    textMs=Date.now()-textStarted;
    stage="save";
    await checkpoint({phase:"save"});
    const current=await getSettings(owner);
    if(!current?.consent_at||current.consent_at!==settings.consent_at||current.image_consent_at!==settings.image_consent_at||current.image_self_side!==settings.image_self_side)throw new CrushError("截图处理授权已改变，本次停止保存。",409);
    const result=await analyzeLines(owner,parsed.text,{sourceKey:"web-image:"+body.requestId,channelKey:thread.channel_key,subjectId:subject,threadId:thread.id,prepared:parsed.prepared,skipAffinity:true,decision:parsed.decision,budgetMode:"deep"});
    if(subject&&!result.decision?.partial){
      try{await suggestScreenshotEvents(owner,subject,result);}
      catch{console.warn("web_screenshot_event_suggestion_failed");}
    }
    console.info("screenshot_analysis_ready",{elapsedMs:Date.now()-started,ocrMs,textMs,lineCount:parsed.count,source,imageBytes:Math.floor(body.image.length*3/4)});
    return json(result);
  }catch(error){console.warn("screenshot_analysis_failed",{stage,elapsedMs:Date.now()-started,errorType:error instanceof CrushError?"validation_"+error.status:error instanceof Error&&["TimeoutError","AbortError","TypeError"].includes(error.name)?error.name:"other"});return json({error:error instanceof CrushError?error.message:qwenPublicError(error,"截图识别这次没有完成，未生成判断；请稍后重试。"),...(error instanceof Error&&["QWEN_AUTH_FAILED","QWEN_BALANCE_EMPTY","QWEN_API_KEY_MISSING","QWEN_WORKSPACE_MISSING"].includes(error.message)?{retryable:false}:{})},error instanceof CrushError?error.status:503);}
}
