import { getD1 } from "@/db";
import { miniappOwner } from "@/lib/miniapp-auth";
import { verifyMiniappPhone } from "@/lib/miniapp-phone";

export const runtime = "edge";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "微信身份会话已过期，请重新进入小程序。" }, 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 2048) return json({ error: "请求过大。" }, 413);
  let code: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: "请求过大。" }, 413);
    code = (JSON.parse(raw) as { code?: unknown }).code;
  } catch { return json({ error: "手机号授权凭证无法读取。" }, 400); }
  let last4: string;
  try { last4 = await verifyMiniappPhone(code); }
  catch (error) {
    const reason = error instanceof Error && /^MINIAPP_PHONE_(?:UNCONFIGURED|CODE_INVALID|TOKEN_HTTP|TOKEN_REJECTED|HTTP|REJECTED|MISMATCH)$/.test(error.message)
      ? error.message : "MINIAPP_PHONE_NETWORK";
    return json({ error: "手机号授权暂未完成，请稍后重试；也可以暂不绑定继续使用。", reason }, reason === "MINIAPP_PHONE_CODE_INVALID" ? 400 : 503);
  }
  const verifiedAt = Date.now();
  await getD1().prepare("UPDATE coach_miniapp_links SET phone_last4=?,phone_verified_at=?,updated_at=? WHERE open_id=? AND owner_id=?")
    .bind(last4, verifiedAt, verifiedAt, identity.openId, identity.ownerId).run();
  return json({ verified: true, masked: "****" + last4, verifiedAt });
}
