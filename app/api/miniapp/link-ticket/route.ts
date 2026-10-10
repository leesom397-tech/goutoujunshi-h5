import { getD1 } from "@/db";
import { miniappOwner, randomToken, sha256 } from "@/lib/miniapp-auth";

export const runtime = "edge";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  if (!identity.ownerId.startsWith("miniapp:")) return json({ error: "这个微信身份已关联 成子 账号。" }, 409);
  const db = getD1(), now = Date.now(), ticket = randomToken();
  await db.batch([
    db.prepare("DELETE FROM coach_miniapp_pairings WHERE open_id=?").bind(identity.openId),
    db.prepare("INSERT INTO coach_miniapp_pairings (code_hash,open_id,expires_at,created_at) VALUES (?,?,?,?)")
      .bind(await sha256(ticket), identity.openId, now + 10 * 60 * 1000, now),
  ]);
  return json({ ticket, expiresAt: now + 10 * 60 * 1000 });
}
