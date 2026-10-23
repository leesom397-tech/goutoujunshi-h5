import {getD1} from "@/db";
import {miniappOwner} from "@/lib/miniapp-auth";
import {requireSettings,reserveBudget} from "@/lib/crush/service";
import {CrushError} from "@/lib/crush/types";
import {qwenChat,qwenPublicError} from "@/lib/qwen";
import {cancelSentencePage,readSentencePage,readSentenceAttention,SentenceReadingError,supplementSentencePage} from "@/lib/capture-sentence-server";

export const runtime="edge";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const position=(value:unknown,max=20_000)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0&&value<=max;
function failure(error:unknown){
  if(error instanceof SentenceReadingError||error instanceof CrushError)return json({error:error.message},error.status);
  console.warn("sentence_page_unavailable",{kind:error instanceof Error?error.name:"unknown"});
  return json({error:qwenPublicError(error,"本页暂时无法补充，原文和已保存解读仍可查看。请稍后重试。")},503);
}
export async function GET(request:Request){
  const identity=await miniappOwner(request);if(!identity)return json({error:"请登录后查看聊天。"},401);
  const params=new URL(request.url).searchParams,id=params.get("id")||"";
  const before=params.get("before"),offset=Number(params.get("offset")||0),count=params.has("count")?Number(params.get("count")):undefined;
  if(!position(offset)||before!==null&&!position(Number(before))||count!==undefined&&(!position(count,12)||!count))return json({error:"分页范围不正确。"},400);
  try{return json(params.get("mode")==="attention"?await readSentenceAttention(getD1(),identity.ownerId,id):await readSentencePage(getD1(),identity.ownerId,id,before===null?{offset,count}:{before:Number(before)}));}catch(error){return failure(error);}
}
export async function POST(request:Request){
  const identity=await miniappOwner(request);if(!identity)return json({error:"请登录后补充解读。"},401);
  if(request.headers.get("origin")!==new URL(request.url).origin||!request.headers.get("content-type")?.startsWith("application/json"))return json({error:"请求来源无效。"},403);
  const raw=await request.text();if(raw.length>1200)return json({error:"请求过长。"},413);
  let body:{id:string;offset:number;count:number;requestId:string;confirmed?:boolean;action?:string};
  try{body=JSON.parse(raw);}catch{return json({error:"请求格式不正确。"},400);}
  if(!body||typeof body.id!=="string"||typeof body.requestId!=="string"||!position(body.offset)||!position(body.count,12)||!body.count)return json({error:"请选择要解读的页面。"},400);
  try{
    if(body.action==="cancel")return json(await cancelSentencePage(getD1(),identity.ownerId,body.id,body.offset,body.count,body.requestId));
    if(body.confirmed!==true||body.action!=="analyze")return json({error:"请确认补充本页解读；不会扣除积分。"},400);
    return json(await supplementSentencePage(getD1(),identity.ownerId,body.id,body.offset,body.count,body.requestId,async(messages,options)=>{const result=await qwenChat(messages,options);await requireSettings(identity.ownerId);return result;},async()=>{await requireSettings(identity.ownerId);await reserveBudget(identity.ownerId,"chat");}));
  }catch(error){return failure(error);}
}
