import { getD1 } from "@/db";
import { exchangeWxCode, issueMiniappSession, miniappConfigured, sha256 } from "@/lib/miniapp-auth";

export const runtime = "edge";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!miniappConfigured()) return json({ error: "小程序登录尚未配置。" }, 503);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 2048) return json({ error: "请求过大。" }, 413);
  let code: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: "请求过大。" }, 413);
    code = (JSON.parse(raw) as { code?: unknown }).code;
  }
  catch { return json({ error: "登录凭证无法读取。" }, 400); }
  let openId: string | null;
  try { openId = await exchangeWxCode(code); }
  catch (error) {
    const reason = error instanceof Error && /^MINIAPP_(?:UNCONFIGURED|WECHAT_(?:TIMEOUT|NETWORK|HTTP_\d{3}))$/.test(error.message)
      ? error.message : "MINIAPP_WECHAT_UNKNOWN";
    return json({ error: "暂时无法验证微信身份。", reason }, 503);
  }
  if (!openId) return json({ error: "微信登录凭证已过期，请重试。" }, 401);
  const db = getD1();
  const now = Date.now();
  // A WeChat OpenID creates a private Mini Program owner on first use. Never
  // infer a pre-existing 成子 web account or Customer Service identity.
  const ownerId = "miniapp:" + await sha256(openId);
  await db.prepare("INSERT OR IGNORE INTO coach_miniapp_links (open_id,owner_id,created_at,updated_at) VALUES (?,?,?,?)")
    .bind(openId, ownerId, now, now).run();
  return json({ linked: true, ...(await issueMiniappSession(openId)) });
}
