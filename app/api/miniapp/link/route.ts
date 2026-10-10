import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import { miniappConfigured, sha256 } from "@/lib/miniapp-auth";

export const runtime = "edge";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录 成子。" }, 401);
  const rows = await getD1().prepare("SELECT open_id,created_at FROM coach_miniapp_links WHERE owner_id=? ORDER BY created_at DESC LIMIT 10").bind(user.userId).all<{ open_id: string; created_at: number }>();
  return json({ links: rows.results.map(row => ({ id: row.open_id, createdAt: row.created_at })) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录 成子。" }, 401);
  if (!miniappConfigured()) return json({ error: "小程序绑定尚未配置。" }, 503);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "请求来源无效。" }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 2048) return json({ error: "请求过大。" }, 413);
  let ticket: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: "请求过大。" }, 413);
    ticket = (JSON.parse(raw) as { ticket?: unknown }).ticket;
  }
  catch { return json({ error: "绑定请求无效。" }, 400); }
  if (typeof ticket !== "string" || !/^[a-f0-9]{64}$/.test(ticket)) return json({ error: "绑定请求无效。" }, 400);
  const db = getD1();
  const hash = await sha256(ticket);
  const row = await db.prepare("SELECT open_id FROM coach_miniapp_pairings WHERE code_hash=? AND expires_at>?").bind(hash, Date.now()).first<{ open_id: string }>();
  if (!row) return json({ error: "绑定链接已过期，请在小程序重新打开。" }, 410);
  const existing = await db.prepare("SELECT owner_id FROM coach_miniapp_links WHERE open_id=?").bind(row.open_id).first<{ owner_id: string }>();
  if (existing && existing.owner_id !== user.userId) {
    if (!existing.owner_id.startsWith("miniapp:")) return json({ error: "这个微信身份已绑定其他 成子 账号，请先在原账号解除绑定。" }, 409);
    const privateOwner = existing.owner_id;
    const protectedTables = ["coach_subjects", "coach_crush_reports", "coach_crush_threads", "coach_positionings", "coach_facts"] as const;
    for (const table of protectedTables) {
      const data = await db.prepare(`SELECT 1 AS found FROM ${table} WHERE owner_id=? LIMIT 1`).bind(privateOwner).first();
      if (data) return json({ error: "小程序里已有独立档案或报告；为避免覆盖，请先在小程序清理或保留这个账号，不会自动合并。" }, 409);
    }
  }
  const now = Date.now();
  const result = await db.batch([
    db.prepare("UPDATE coach_miniapp_links SET owner_id=?,updated_at=? WHERE open_id=? AND owner_id=? AND NOT EXISTS (SELECT 1 FROM coach_subjects WHERE owner_id=?) AND NOT EXISTS (SELECT 1 FROM coach_crush_reports WHERE owner_id=?) AND NOT EXISTS (SELECT 1 FROM coach_crush_threads WHERE owner_id=?) AND NOT EXISTS (SELECT 1 FROM coach_positionings WHERE owner_id=?) AND NOT EXISTS (SELECT 1 FROM coach_facts WHERE owner_id=?)")
      .bind(user.userId, now, row.open_id, existing?.owner_id || "", ...Array(5).fill(existing?.owner_id || "")),
    db.prepare("DELETE FROM coach_miniapp_pairings WHERE code_hash=?").bind(hash),
  ]);
  if (!result[0].meta.changes) return json({ error: "这个微信身份已绑定其他账号。" }, 409);
  return json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录 成子。" }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "请求来源无效。" }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 2048) return json({ error: "请求过大。" }, 413);
  let openId: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: "请求过大。" }, 413);
    openId = (JSON.parse(raw) as { openId?: unknown }).openId;
  }
  catch { return json({ error: "请指定要解除的微信身份。" }, 400); }
  if (typeof openId !== "string" || openId.length > 128) return json({ error: "微信身份无效。" }, 400);
  const db = getD1();
  const own = await db.prepare("SELECT open_id FROM coach_miniapp_links WHERE open_id=? AND owner_id=?").bind(openId, user.userId).first();
  if (!own) return json({ error: "找不到这个绑定。" }, 404);
  await db.batch([
    db.prepare("DELETE FROM coach_miniapp_sessions WHERE open_id=?").bind(openId),
    db.prepare("DELETE FROM coach_miniapp_pairings WHERE open_id=?").bind(openId),
    db.prepare("DELETE FROM coach_miniapp_links WHERE open_id=? AND owner_id=?").bind(openId, user.userId),
  ]);
  return json({ ok: true });
}
