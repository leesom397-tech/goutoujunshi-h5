import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { webOwner } from "@/lib/request-identity.mjs";
import { getSettings } from "@/lib/crush/service";
import { nativeLogout } from "@/lib/web-native-auth.mjs";
export const runtime = "edge";
export async function GET(request: Request) {
  const identity = await webOwner(request, env);
  const headers = { "Cache-Control": "no-store" };
  if (!identity) return Response.json({ linked: false, error: "请先登录。" }, { status: 401, headers });
  const [subjects, settings] = await Promise.all([
    getD1().prepare("SELECT id,label FROM coach_subjects WHERE owner_id=? AND status='active' ORDER BY updated_at DESC LIMIT 40").bind(identity.ownerId).all<{ id: string; label: string }>(),
    getSettings(identity.ownerId),
  ]);
  return Response.json({ linked: true, user: identity.displayName, subjects: subjects.results,
    screenshot: { enabled: !!(settings?.consent_at && settings.image_consent_at), selfSide: settings?.image_self_side || "ask" } }, { headers });
}
export async function DELETE(request: Request) { return nativeLogout(request, env); }
