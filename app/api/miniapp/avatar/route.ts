import {miniappOwner} from "@/lib/miniapp-auth";
import {getD1} from "@/db";
export const runtime="edge";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request:Request){
  const identity=await miniappOwner(request);
  if(!identity)return json({error:"请重新登录。"},401);
  if(!request.headers.get("content-type")?.includes("application/json"))return json({error:"请求格式不正确。"},415);
  if(Number(request.headers.get("content-length")||0)>50000)return json({error:"头像过大，请重新裁剪。"},413);
  let body;try{const raw=await request.text();if(raw.length>50000)return json({error:"头像过大。"},413);body=JSON.parse(raw);}catch{return json({error:"无法读取头像。"},400);}
  if(!body||body.confirmed!==true||!["self","subject"].includes(body.target))return json({error:"请确认头像归属。"},400);
  const avatar=body.avatar;
  if(typeof avatar!=="string"||avatar.length>48000||!/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(avatar))return json({error:"请使用裁剪后的 JPG 头像。"},400);
  const owner=identity.ownerId,db=getD1(),now=Date.now();
  const consent=await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{consent_at:number|null;paused:number}>();
  if(!consent?.consent_at||consent.paused)return json({error:"请先启用并恢复档案。"},403);
  const safe="CASE WHEN json_valid(data) THEN data ELSE '{}' END";
  if(body.target==="self"){
    const result=await db.prepare(`UPDATE coach_profiles SET data=json_set(${safe},'$.avatar',?),updated_at=? WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0`).bind(avatar,now,owner).run();
    if(!result.meta.changes)return json({error:"档案状态已变化，请刷新。"},409);
  }else{
    if(typeof body.subjectId!=="string"||!/^[a-f0-9-]{36}$/.test(body.subjectId))return json({error:"请选择人物。"},400);
    const result=await db.prepare(`UPDATE coach_subjects SET data=json_set(${safe},'$.avatar',?),updated_at=? WHERE id=? AND owner_id=? AND status='active' AND EXISTS (SELECT 1 FROM coach_profiles WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0)`).bind(avatar,now,body.subjectId,owner,owner).run();
    if(!result.meta.changes)return json({error:"人物不存在或档案已暂停。"},404);
  }
  return json({saved:true});
}
