import { env } from 'cloudflare:workers';
import { miniappOwner } from '@/lib/miniapp-auth';
import { captureCloudPublicOwner } from '@/lib/capture-cloud-server';
import { listAnalysisReports } from '@/lib/saved-reports.mjs';

export const runtime = 'edge';
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  const identity = await miniappOwner(request);
  if (!identity) return Response.json({ error: '请重新连接微信身份后查看历史报告。' }, { status: 401, headers });
  const query = new URL(request.url).searchParams;
  try {
    const namespace = (env as unknown as { SOCIAL_PROFILE_JOBS?: { idFromName: (name: string) => unknown; get: (id: unknown) => { syncSavedReports: (owner: string) => Promise<void> } } }).SOCIAL_PROFILE_JOBS;
    if (namespace) try { await namespace.get(namespace.idFromName(identity.ownerId)).syncSavedReports(identity.ownerId); } catch { console.warn('legacy_report_sync_unavailable'); }
    const [list, ownerId] = await Promise.all([
      listAnalysisReports(env.DB, identity.ownerId, { query: query.get('q') || '', page: Number(query.get('page') || 1) }),
      captureCloudPublicOwner(identity.ownerId),
    ]);
    return Response.json({ ...list, ownerId, webLinked: !identity.ownerId.startsWith('miniapp:') }, { headers });
  } catch {
    return Response.json({ error: '历史报告暂未取回，请稍后重试。' }, { status: 503, headers });
  }
}
