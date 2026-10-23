import { env } from 'cloudflare:workers';
import { getD1 } from '@/db';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { isCreditAdmin } from '@/lib/account-credits.mjs';
import { maintainReportGuidance, GuidanceMaintenanceError } from '@/lib/report-guidance-maintenance.mjs';
import { upgradeHistoryGuidance } from '@/lib/history-guidance-upgrade';
import { qwenChat } from '@/lib/qwen';

export const runtime = 'edge';
const json = (value:unknown,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request) {
  const user = await getChatGPTUser();
  if (!user) return json({error:'请先登录。'},401);
  const config = env as Record<string,string|undefined>;
  const admins = [config.COACH_ADMIN_OWNER_IDS,config.COACH_WEB_ADMIN_OWNER_IDS,config.COACH_WEB_PRIMARY_ADMIN_OWNER_ID].filter(Boolean).join(',');
  if (!isCreditAdmin(user.userId,admins)) return json({error:'仅管理员可维护报告。'},403);
  if (request.headers.get('origin') !== new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('application/json')) return json({error:'请求来源无效。'},403);
  const raw = await request.text();
  if (raw.length > 1024) return json({error:'请求过长。'},413);
  let body:{reportId?:string;confirmed?:boolean};
  try { body=JSON.parse(raw); } catch { return json({error:'请求格式无效。'},400); }
  if (!body || body.confirmed !== true || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.reportId||'')) return json({error:'请确认报告编号。'},400);
  try {
    return json(await maintainReportGuidance(getD1(),user.userId,body.reportId,(report:unknown)=>upgradeHistoryGuidance(report,qwenChat)));
  } catch(error) {
    if (error instanceof GuidanceMaintenanceError) return json({error:error.message},error.status);
    const message=error instanceof Error?error.message:'';
    console.warn('report_guidance_maintenance_failed',{reason:message.startsWith('建议补充')?message:'provider_or_validation_failed'});
    return json({error:message.startsWith('建议补充')?message:'建议补充暂未完成，原报告已保留。'},502);
  }
}
