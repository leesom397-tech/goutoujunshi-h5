import { getD1 } from "@/db";
import { readableReport } from "@/lib/crush/evidence";
import { miniappOwner } from "@/lib/miniapp-auth";
import type { CrushResult } from "@/lib/crush/types";

export const runtime = "edge";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!requestId || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId)) {
    return json({ error: "请求编号不正确。" }, 400);
  }
  const row = await getD1().prepare("SELECT status,result,updated_at FROM coach_crush_reports WHERE owner_id=? AND source_key=?")
    .bind(identity.ownerId, "web-image:" + requestId).first<{ status: string; result: string | null; updated_at: number }>();
  if (!row) return json({ status: "pending" });
  if (row.status === "done" && row.result) return json({ status: "done", result: readableReport(JSON.parse(row.result) as CrushResult) });
  if (row.status === "running" && Date.now() - row.updated_at < 330000) return json({ status: "running" });
  return json({ status: "retry" });
}
