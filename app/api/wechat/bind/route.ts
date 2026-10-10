import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import { sha1, wechatPublicConfig } from "@/lib/wechat";

export const runtime = "edge";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录。" }, 401);
  const db = getD1();
  const links = await db.prepare("SELECT external_userid, subject_id, created_at FROM coach_wechat_links WHERE owner_id = ? ORDER BY created_at DESC LIMIT 5").bind(user.userId).all<{ external_userid: string; subject_id: string | null; created_at: number }>();
  return json({ ...wechatPublicConfig(), links: links.results.map((row) => ({ id: row.external_userid, subjectId: row.subject_id, createdAt: row.created_at })) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录。" }, 401);
  const db = getD1();
  const profile = await db.prepare("SELECT consent_at, paused FROM coach_profiles WHERE owner_id = ?").bind(user.userId).first<{ consent_at: number | null; paused: number }>();
  if (!profile?.consent_at || profile.paused) return json({ error: "请先启用关系档案并保持开启。" }, 403);
  let body: { action?: string; id?: string; subjectId?: string | null } = {};
  try { body = await request.json(); } catch { return json({ error: "请求格式不正确。" }, 400); }
  if (body.action === "subject") {
    if (!body.id || body.id.length > 128) return json({ error: "微信会话无效。" }, 400);
    if (body.subjectId) {
      const subject = await db.prepare("SELECT id FROM coach_subjects WHERE owner_id = ? AND id = ?").bind(user.userId, body.subjectId).first();
      if (!subject) return json({ error: "对象不存在。" }, 404);
    }
    const result = await db.prepare("UPDATE coach_wechat_links SET subject_id = ?, memory_offer_report_id=NULL, memory_offer_expires_at=0, memory_offer_asked_at=0, memory_offer_start_revision=0, updated_at = ? WHERE external_userid = ? AND owner_id = ?").bind(body.subjectId || null, Date.now(), body.id, user.userId).run();
    return json({ ok: !!result.meta.changes }, result.meta.changes ? 200 : 404);
  }
  if (body.action !== "create") return json({ error: "不支持的操作。" }, 400);
  if (!wechatPublicConfig().configured) return json({ error: "微信客服尚未完成后台授权。" }, 503);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = crypto.getRandomValues(new Uint8Array(10));
  const code = Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM coach_wechat_bind_codes WHERE owner_id = ?").bind(user.userId),
    db.prepare("INSERT INTO coach_wechat_bind_codes (code_hash, owner_id, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(sha1(code), user.userId, now + 10 * 60_000, now),
  ]);
  return json({ code, expiresAt: now + 10 * 60_000 });
}

export async function DELETE() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录。" }, 401);
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM coach_crush_reports WHERE owner_id = ? AND thread_id IN (SELECT id FROM coach_crush_threads WHERE owner_id = ? AND channel_key LIKE 'wechat:%')").bind(user.userId,user.userId),
    db.prepare("DELETE FROM coach_crush_threads WHERE owner_id = ? AND channel_key LIKE 'wechat:%'").bind(user.userId),
    db.prepare("DELETE FROM coach_wechat_outbox WHERE owner_id = ?").bind(user.userId),
    db.prepare("DELETE FROM coach_wechat_inbox WHERE external_userid IN (SELECT external_userid FROM coach_wechat_links WHERE owner_id = ?)").bind(user.userId),
    db.prepare("DELETE FROM coach_wechat_links WHERE owner_id = ?").bind(user.userId),
    db.prepare("DELETE FROM coach_wechat_bind_codes WHERE owner_id = ?").bind(user.userId),
  ]);
  return json({ ok: true });
}
