import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { isCreditAdmin, readCreditAccount, CREDIT_PRICES } from "@/lib/account-credits.mjs";
export const runtime = "edge";
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const account = await readCreditAccount(getD1(), user.userId);
    const config = env as { COACH_ADMIN_OWNER_IDS?: string; COACH_WEB_ADMIN_OWNER_IDS?: string; COACH_WEB_PRIMARY_ADMIN_OWNER_ID?: string };
    return Response.json({ account, prices: CREDIT_PRICES, user: { name: user.displayName }, admin: isCreditAdmin(user.userId, [config.COACH_ADMIN_OWNER_IDS, config.COACH_WEB_ADMIN_OWNER_IDS, config.COACH_WEB_PRIMARY_ADMIN_OWNER_ID].filter(Boolean).join(",")), meteringReady: true, meteringScope: "web", contact: "lxlikex" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "积分账本暂不可用，请稍后重试。" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
