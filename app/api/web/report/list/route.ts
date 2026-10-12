import { env } from 'cloudflare:workers';
import { webOwner } from '@/lib/request-identity.mjs';
import { listAnalysisReports } from '@/lib/saved-reports.mjs';
export const runtime='edge';
export async function GET(request:Request){
  const headers={'Cache-Control':'no-store'};
  const identity=await webOwner(request,env);
  if(!identity)return Response.json({error:'请登录后查看分析记录。'},{status:401,headers});
  const query=new URL(request.url).searchParams;
  try{
    const namespace=(env as unknown as {SOCIAL_PROFILE_JOBS?:{idFromName:(name:string)=>unknown;get:(id:unknown)=>{syncSavedReports:(owner:string)=>Promise<void>}}}).SOCIAL_PROFILE_JOBS;
    if(namespace)try{await namespace.get(namespace.idFromName(identity.ownerId)).syncSavedReports(identity.ownerId);}catch{console.warn('legacy_report_sync_unavailable');}
    return Response.json(await listAnalysisReports(env.DB,identity.ownerId,{query:query.get('q')||'',page:Number(query.get('page')||1)}),{headers});
  }catch{return Response.json({error:'分析记录暂未取回，请稍后再试。'},{status:503,headers});}
}
