import { getD1 } from "@/db";
import { getSettings } from "@/lib/crush/service";
import { miniappOwner } from "@/lib/miniapp-auth";

export const runtime = "edge";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 2048) return json({ error: "请求过大。" }, 413);
  let body: { consent?: unknown; selfSide?: unknown; allowImageProcessing?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: "请求过大。" }, 413);
    body = JSON.parse(raw);
  }
  catch { return json({ error: "无法读取授权设置。" }, 400); }
  if (body.consent !== true || body.allowImageProcessing !== true || !["left", "right"].includes(String(body.selfSide))) {
    return json({ error: "请确认材料提供权、阿里云截图识别和本人气泡位置。" }, 403);
  }
  const owner = identity.ownerId;
  const previous = await getSettings(owner);
  const now = Date.now();
  await getD1().prepare(
    "INSERT INTO coach_crush_settings (owner_id,consent_at,image_consent_at,image_self_side,provider,updated_at) VALUES (?,?,?,?,'qwen',?) ON CONFLICT(owner_id) DO UPDATE SET consent_at=COALESCE(coach_crush_settings.consent_at,excluded.consent_at),image_consent_at=excluded.image_consent_at,image_self_side=excluded.image_self_side,provider='qwen',updated_at=excluded.updated_at"
  ).bind(owner, previous?.consent_at || now, now, body.selfSide, now).run();
  return json({ ok: true, imageSelfSide: body.selfSide });
}
