import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { isCreditAdmin } from "@/lib/account-credits.mjs";

export const runtime = "edge";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  const settings = env as { COACH_ADMIN_OWNER_IDS?: string; COACH_WEB_ADMIN_OWNER_IDS?: string; COACH_WEB_PRIMARY_ADMIN_OWNER_ID?: string };
  const allowlist = [settings.COACH_ADMIN_OWNER_IDS, settings.COACH_WEB_ADMIN_OWNER_IDS, settings.COACH_WEB_PRIMARY_ADMIN_OWNER_ID].filter(Boolean).join(",");
  if (!user || !isCreditAdmin(user.userId, allowlist)) return json({ error: "无管理员权限。" }, 403);
  const params = new URL(request.url).searchParams;
  const search = (params.get("search") || "").trim().slice(0, 80);
  const status = params.get("status") || "all";
  if (!["all", "active", "pending", "expired"].includes(status)) return json({ error: "筛选条件无效。" }, 400);
  const page = Math.min(10000, Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1));
  const limit = 30, now = Date.now();
  const base = `WITH ids AS (
    SELECT owner_id FROM coach_credit_accounts
    UNION SELECT 'chengzi:' || id FROM coach_web_users
    UNION SELECT owner_id FROM coach_miniapp_links
  ), members AS (
    SELECT i.owner_id, a.public_id, a.balance, a.features, a.enabled_until, a.created_at AS account_created_at,
      u.username, u.created_at AS web_created_at, u.last_login_at, l.last_link_at,
      COALESCE(a.updated_at,u.last_login_at,u.created_at,l.last_link_at,0) AS sort_time
    FROM ids i LEFT JOIN coach_credit_accounts a ON a.owner_id=i.owner_id
    LEFT JOIN coach_web_users u ON i.owner_id='chengzi:' || u.id
    LEFT JOIN (SELECT owner_id, MAX(updated_at) AS last_link_at FROM coach_miniapp_links GROUP BY owner_id) l ON l.owner_id=i.owner_id
  )`;
  const where = `WHERE (?='' OR lower(COALESCE(username,'') || ' ' || COALESCE(public_id,'') || ' ' || owner_id) LIKE '%' || lower(?) || '%')
    AND (?='all' OR (?='active' AND enabled_until>? AND features IS NOT NULL AND json_array_length(features)>0)
      OR (?='pending' AND COALESCE(enabled_until,0)=0)
      OR (?='expired' AND enabled_until>0 AND enabled_until<=?))`;
  const filters = [search, search, status, status, now, status, status, now];
  try {
    const db = getD1();
    const [count, rows, summary] = await Promise.all([
      db.prepare(`${base} SELECT COUNT(*) AS total FROM members ${where}`).bind(...filters).first(),
      db.prepare(`${base} SELECT * FROM members ${where} ORDER BY sort_time DESC, owner_id ASC LIMIT ? OFFSET ?`).bind(...filters, limit, (page - 1) * limit).all(),
      db.prepare(`${base} SELECT COUNT(*) AS total, SUM(CASE WHEN enabled_until>? AND features IS NOT NULL AND json_array_length(features)>0 THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN COALESCE(enabled_until,0)=0 THEN 1 ELSE 0 END) AS pending FROM members`).bind(now).first(),
    ]);
    const members = (rows.results || []).map((row: Record<string, unknown>) => {
      const ownerId = String(row.owner_id || "");
      const source = ownerId.startsWith("chengzi:") ? "web" : ownerId.startsWith("lovetalk:") ? "existing" : "miniapp";
      const name = String(row.username || (source === "existing" ? ownerId.slice(9) : source === "miniapp" ? `小程序用户 · ${ownerId.slice(-6)}` : `网页用户 · ${ownerId.slice(-6)}`));
      const features = typeof row.features === "string" ? JSON.parse(row.features) : [];
      const enabledUntil = Number(row.enabled_until || 0);
      return { ownerId, userId: row.public_id || null, name, source, balance: Number(row.balance || 0), features, enabledUntil,
        status: enabledUntil > now && features.length ? "active" : enabledUntil ? "expired" : "pending",
        createdAt: Number(row.account_created_at || row.web_created_at || row.last_link_at || 0), lastLoginAt: Number(row.last_login_at || 0) };
    });
    return json({ members, page, pageSize: limit, total: Number(count?.total || 0), summary: { total: Number(summary?.total || 0), active: Number(summary?.active || 0), pending: Number(summary?.pending || 0) } });
  } catch { return json({ error: "会员列表暂时无法读取，请稍后刷新。" }, 503); }
}
