import { env } from 'cloudflare:workers';
import { getD1 } from '@/db';
import { miniappOwner } from '@/lib/miniapp-auth';
import { CreditError, isCreditAdmin, findCreditOwner, readCreditAccount, adjustCredits, setCreditPermissions } from '@/lib/account-credits.mjs';

export const runtime = 'edge';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function admin(request: Request) {
  const identity = await miniappOwner(request);
  const settings = env as { COACH_ADMIN_OWNER_IDS?: string };
  return identity && isCreditAdmin(identity.ownerId, settings.COACH_ADMIN_OWNER_IDS) ? identity : null;
}
function failure(error: unknown) {
  if (error instanceof CreditError) return json({ error: error.message, code: error.code }, error.status);
  // Do not return database internals, owner ids or admin allowlists.
  return json({ error: '操作未能确认，请刷新核对余额；减少积分时不能超过可用余额。' }, 503);
}
export async function GET(request: Request) {
  if (!await admin(request)) return json({ error: '无管理员权限。' }, 403);
  try {
    const ownerId = await findCreditOwner(getD1(), new URL(request.url).searchParams.get('userId'));
    return json({ account: await readCreditAccount(getD1(), ownerId) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const identity = await admin(request);
  if (!identity) return json({ error: '无管理员权限。' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: '请求格式无效。' }, 415);
  if (Number(request.headers.get('content-length') || 0) > 4000) return json({ error: '请求过长。' }, 413);
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 4000) return json({ error: '请求过长。' }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID');
  } catch { return json({ error: '请求格式无效。' }, 400); }
  try {
    const ownerId = await findCreditOwner(getD1(), body.userId);
    const base = { id: body.id, ownerId, actorId: identity.ownerId, reason: body.reason };
    let operation;
    if (body.action === 'adjust') operation = await adjustCredits(getD1(), { ...base, delta: body.delta });
    else if (body.action === 'permissions') operation = await setCreditPermissions(getD1(), { ...base, features: body.features, enabledUntil: body.enabledUntil });
    else return json({ error: '操作类型无效。' }, 400);
    return json({ ok: true, ...operation, account: await readCreditAccount(getD1(), ownerId) });
  } catch (error) { return failure(error); }
}
