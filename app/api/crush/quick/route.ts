import {getChatGPTUser} from "@/app/chatgpt-auth";
import {getD1} from "@/db";
import {parseChat,retainRecent} from "@/lib/crush/parser";
import {quickJevJudgment} from "@/lib/crush/quick-jev";
import {getSettings} from "@/lib/crush/service";
import {jevFailure} from "@/lib/crush/jev-client";
import {CrushError,type ChatLine} from "@/lib/crush/types";
export const runtime="edge";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});

export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return json({error:"请先登录。"},401);
  if(!request.headers.get("content-type")?.includes("application/json"))return json({error:"格式不正确。"},415);
  let body:Record<string,unknown>;
  try{const raw=await request.text();if(raw.length>15000)throw new CrushError("这次聊天过长，请分段分析。",413);body=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=="object")throw Error();}
  catch(error){return json({error:error instanceof CrushError?error.message:"无法读取聊天。"},error instanceof CrushError?error.status:400);}
  try{
    const owner=user.userId,settings=await getSettings(owner);
    if(!settings?.consent_at||!settings.jev_consent_at)throw new CrushError("请先单独开启第三方快判断授权。",403);
    if(typeof body.text!=="string"||typeof body.subjectId!=="string"||typeof body.selfLabel!=="string"||!(["self","other"] as unknown[]).includes(body.speaker))throw new CrushError("请提供一段有说话人标记的聊天。",400);
    if(body.text.length>12000||body.subjectId.length>100||body.selfLabel.length>60)throw new CrushError("材料过长，请分段分析。",413);
    const lines=parseChat(body.text,body.selfLabel,body.speaker as "self"|"other");
    const db=getD1(),now=Date.now();let history:ChatLine[]=[];
    if(body.subjectId){
      if(!await db.prepare("SELECT id FROM coach_subjects WHERE id=? AND owner_id=?").bind(body.subjectId,owner).first())throw new CrushError("对象不存在或已删除。",404);
      const row=await db.prepare("SELECT data FROM coach_crush_threads WHERE owner_id=? AND subject_id=? AND expires_at>? ORDER BY updated_at DESC LIMIT 1").bind(owner,body.subjectId,now).first<{data:string}>();
      if(row){try{history=retainRecent(JSON.parse(row.data) as ChatLine[]).slice(-5);}catch{history=[];}}
    }
    // Quick look gets its own small quota; a resend should not fan out endlessly
    // to a paid third-party endpoint. Do not persist the private input here.
    const day=new Date().toISOString().slice(0,10);
    for(const [key,limit] of [[owner+":quick:"+day,60],["global:quick:"+day,2000]] as const){
      await db.prepare("INSERT OR IGNORE INTO coach_crush_budget (id,uses,expires_at) VALUES (?,0,?)").bind(key,now+2*86400000).run();
      const spent=await db.prepare("UPDATE coach_crush_budget SET uses=uses+1 WHERE id=? AND uses<?").bind(key,limit).run();
      if(!spent.meta.changes)throw new CrushError("今天的快判服务已达到试运行上限，请明天再来。",429);
    }
    const quick=await quickJevJudgment(lines,history,false);
    const latest=await getSettings(owner);
    if(!latest?.consent_at||latest.jev_consent_at!==settings.jev_consent_at)throw new CrushError("快判授权已改变，结果未显示。",409);
    if(!quick)throw new CrushError("快判断暂未接通，请使用完整逐句解读。",503);
    return json({quick,contextCount:Math.min(6,history.length+lines.length),linkedToSubject:!!body.subjectId});
  }catch(error){
    if(error instanceof CrushError)return json({error:error.message},error.status);
    console.warn("crush_quick_failed",{code:jevFailure(error)});
    return json({error:"快判断暂未完成，请重试或改用完整逐句解读。"},503);
  }
}
