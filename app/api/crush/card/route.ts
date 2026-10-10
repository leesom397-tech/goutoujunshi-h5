import {getChatGPTUser} from "@/app/chatgpt-auth";
import {ownedReport,requireSettings,reserveBudget} from "@/lib/crush/service";
import {renderCard} from "@/lib/crush/card";
import {CrushError} from "@/lib/crush/types";
export const runtime="edge";
export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return Response.json({error:"请先登录。"}, {status:401});
  try{
    if(!request.headers.get("content-type")?.includes("application/json"))throw new CrushError("请求格式无效。",415);
    const raw=await request.text();if(raw.length>300)throw new CrushError("请求过长。",413);
    const data=JSON.parse(raw);if(typeof data.id!=="string")throw new CrushError("请选择分析报告。");
    const settings=await requireSettings(user.userId);
    await reserveBudget(user.userId);
    const report=await ownedReport(user.userId,data.id),bytes=await renderCard(report,data.page??1);
    const current=await requireSettings(user.userId);if(current.updated_at!==settings.updated_at)throw new CrushError("处理授权已改变。",409);
    await ownedReport(user.userId,data.id);
    return new Response(bytes,{headers:{"Content-Type":"image/jpeg","Content-Disposition":'attachment; filename="chat-analysis.jpg"',"Cache-Control":"private, no-store"}});
  }catch(e){return Response.json({error:e instanceof CrushError?e.message:"分析图暂时无法生成，请先查看文字结果。"},{status:e instanceof CrushError?e.status:503,headers:{"Cache-Control":"no-store"}});}
}
