import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import { buildPositioningReport, cleanPositioningInput, cleanPositioningReport } from "@/lib/positioning";

export const runtime = "edge";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
type Row = { input_json: string; report_json: string; updated_at: number };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录后查看你的择偶定位。" }, 401);
  try {
    const row = await getD1().prepare("SELECT input_json, report_json, updated_at FROM coach_positionings WHERE owner_id = ?").bind(user.userId).first<Row>();
    return json(row ? { input: cleanPositioningInput(JSON.parse(row.input_json)), report: cleanPositioningReport(JSON.parse(row.report_json)), updatedAt: row.updated_at } : { input: null, report: null, updatedAt: null });
  } catch { return json({ error: "已保存的定位暂时无法读取，请稍后再试。" }, 503); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录后使用择偶定位。" }, 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 12000) return json({ error: "填写内容过长。" }, 413);
  let body: { action?: unknown; input?: unknown; report?: unknown };
  try { body = await request.json(); } catch { return json({ error: "无法读取填写内容。" }, 400); }
  let input;
  try { input = cleanPositioningInput(body.input); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "填写内容不完整。" }, 400); }

  if (body.action === "generate") return json({ input, report: buildPositioningReport(input), saved: false });
  if (body.action !== "save") return json({ error: "不支持的操作。" }, 400);
  let report;
  try { report = cleanPositioningReport(body.report); }
  catch { return json({ error: "请先生成完整报告，再保存。" }, 400); }
  try {
    const now = Date.now();
    await getD1().prepare("INSERT INTO coach_positionings (owner_id, input_json, report_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET input_json = excluded.input_json, report_json = excluded.report_json, updated_at = excluded.updated_at")
      .bind(user.userId, JSON.stringify(input), JSON.stringify(report), now).run();
    return json({ input, report, updatedAt: now });
  } catch { return json({ error: "保存失败，请稍后再试；当前报告还在页面上。" }, 503); }
}

export async function DELETE() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录。" }, 401);
  try {
    await getD1().prepare("DELETE FROM coach_positionings WHERE owner_id = ?").bind(user.userId).run();
    return json({ deleted: true });
  } catch { return json({ error: "删除失败，请稍后再试。" }, 503); }
}
