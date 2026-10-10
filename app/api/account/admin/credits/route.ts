import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { CreditError, isCreditAdmin, findCreditOwner, readCreditAccount, adjustCredits, setCreditPermissions } from "@/lib/account-credits.mjs";
export const runtime = "edge";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function admin() {
  const user = await getChatGPTUser();
  const settings = env as { COACH_ADMIN_OWNER_IDS?: string; COACH_WEB_ADMIN_OWNER_IDS?: string; COACH_WEB_PRIMARY_ADMIN_OWNER_ID?: string };
  return user && isCreditAdmin(user.userId, [settings.COACH_ADMIN_OWNER_IDS, settings.COACH_WEB_ADMIN_OWNER_IDS, settings.COACH_WEB_PRIMARY_ADMIN_OWNER_ID].filter(Boolean).join(",")) ? user : null;
}
function failure(error: unknown) {
  if (error instanceof CreditError) return json({ error: error.message, code: error.code }, error.status);
  return json({ error: "操作结果未能确认，请保留操作编号并刷新核对。减少积分不能超过可用余额。" }, 503);
}
export async function GET(request: Request) {
  if (!await admin()) return json({ error: "无管理员权限。" }, 403);
  try {
    const db = getD1();
    const params = new URL(request.url).searchParams;
    const selectedOwner = params.get("ownerId");
    let owner: string;
    if (selectedOwner) {
      if (selectedOwner.length > 200 || /[\x00-\x1f\x7f]/.test(selectedOwner)) return json({ error: "会员编号无效。" }, 400);
      const exists = await db.prepare("SELECT owner_id FROM coach_credit_accounts WHERE owner_id=? UNION SELECT 'chengzi:' || id FROM coach_web_users WHERE 'chengzi:' || id=? UNION SELECT owner_id FROM coach_miniapp_links WHERE owner_id=? LIMIT 1").bind(selectedOwner, selectedOwner, selectedOwner).first();
      if (!exists) return json({ error: "没有找到此会员。" }, 404);
      owner = selectedOwner;
    } else owner = await findCreditOwner(db, params.get("userId"));
    const account = await readCreditAccount(db, owner);
    const activity = await db.prepare(`SELECT * FROM (
      SELECT 'adjustment' AS kind, delta AS amount, reason AS detail, actor_id AS actor, '' AS state, '' AS feature, '' AS features, 0 AS enabled_until, created_at AS time FROM coach_credit_adjustments WHERE owner_id=?
      UNION ALL SELECT 'permissions', 0, reason, actor_id, '', '', features, enabled_until, created_at FROM coach_credit_permissions WHERE owner_id=?
      UNION ALL SELECT 'task', CASE WHEN status='released' THEN 0 ELSE -amount END, '', '', status, feature, '', 0, updated_at FROM coach_credit_tasks WHERE owner_id=?
    ) ORDER BY time DESC LIMIT 100`).bind(owner, owner, owner).all();
    return json({ account, activity: activity.results || [] });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "请求来源无效。" }, 403);
  const user = await admin();
  if (!user) return json({ error: "无管理员权限。" }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请使用 JSON 请求。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 4096) return json({ error: "请求过大。" }, 413);
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ error: "请求过大。" }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID");
  } catch { return json({ error: "请求格式无效。" }, 400); }
  try {
    const ownerId = await findCreditOwner(getD1(), body.userId);
    const base = { id: body.id, ownerId, actorId: user.userId, reason: body.reason };
    let operation;
    if (body.action === "adjust") operation = await adjustCredits(getD1(), { ...base, delta: body.delta });
    else if (body.action === "permissions") operation = await setCreditPermissions(getD1(), { ...base, features: body.features, enabledUntil: body.enabledUntil });
    else return json({ error: "操作类型无效。" }, 400);
    return json({ ok: true, ...operation, account: await readCreditAccount(getD1(), ownerId) });
  } catch (error) { return failure(error); }
}
