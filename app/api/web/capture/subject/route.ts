import { getD1 } from "@/db";
import { miniappOwner } from "@/lib/miniapp-auth";
import { browserRequestAllowed } from "@/lib/request-identity.mjs";
import { ensureCreditAccount } from "@/lib/account-credits.mjs";
import { bindCaptureSubject, CaptureSubjectError } from "@/lib/capture-subject-server";

export const runtime = "edge";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  try {
    if (!browserRequestAllowed(request)) throw new CaptureSubjectError("请求来源无效。", 403);
    const identity = await miniappOwner(request);
    if (!identity) throw new CaptureSubjectError("请先登录后导入材料。", 401);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new CaptureSubjectError("请求格式不正确。", 415);
    if (Number(request.headers.get("content-length") || 0) > 160000) throw new CaptureSubjectError("联系人资料过长。", 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 160000) throw new CaptureSubjectError("联系人资料过长。", 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new CaptureSubjectError("无法读取联系人资料。"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CaptureSubjectError("联系人资料格式不正确。");
    const db = getD1(), account = await ensureCreditAccount(db, identity.ownerId);
    return json(await bindCaptureSubject(identity.ownerId, account.public_id, body as Record<string, unknown>, db));
  } catch (error) {
    return error instanceof CaptureSubjectError ? json({ error: error.message }, error.status) : json({ error: "人物档案暂时无法保存，请稍后重试。" }, 500);
  }
}
