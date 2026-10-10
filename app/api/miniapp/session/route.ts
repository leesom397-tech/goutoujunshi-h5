import { getD1 } from "@/db";
import { miniappOwner, revokeMiniappSession } from "@/lib/miniapp-auth";
import { getSettings } from "@/lib/crush/service";

export const runtime = "edge";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ linked: false }, 401);
  // Authenticate first. These owner-scoped reads have no dependency on each other.
  const [subjects, settings, phone] = await Promise.all([
    getD1().prepare("SELECT id,label FROM coach_subjects WHERE owner_id=? AND status='active' ORDER BY updated_at DESC LIMIT 40").bind(identity.ownerId).all<{ id: string; label: string }>(),
    getSettings(identity.ownerId),
    getD1().prepare("SELECT phone_last4,phone_verified_at FROM coach_miniapp_links WHERE open_id=? AND owner_id=?")
      .bind(identity.openId, identity.ownerId).first<{ phone_last4: string | null; phone_verified_at: number | null }>()
  ]);
  return json({ linked: true, subjects: subjects.results, phone: { verified: !!phone?.phone_verified_at, masked: phone?.phone_last4 ? "****" + phone.phone_last4 : "" }, screenshot: { enabled: !!(settings?.consent_at && settings.image_consent_at), selfSide: settings?.image_self_side || "ask" } });
}

export async function DELETE(request: Request) {
  await revokeMiniappSession(request);
  return json({ ok: true });
}
