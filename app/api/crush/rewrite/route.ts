import { getChatGPTUser } from "@/app/chatgpt-auth";
import { rewriteReply } from "@/lib/crush/reply-rewrite";
import { CrushError } from "@/lib/crush/types";
import { qwenPublicError } from "@/lib/qwen";

export const runtime = "edge";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function rewriteForOwner(request: Request, owner: string) {
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 512) return json({ error: "请求过大。" }, 413);
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 512) return json({ error: "请求过大。" }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
  } catch { return json({ error: "无法读取请求。" }, 400); }
  if (body.confirmed !== true || typeof body.reportId !== "string" || !/^[a-f0-9-]{36}$/.test(body.reportId) || !Number.isInteger(body.optionIndex)) return json({ error: "请确认本次云端改写并选择候选回复。" }, 400);
  try { return json(await rewriteReply(owner, body.reportId, body.optionIndex as number, body.styleReportIds as string[] | undefined)); }
  catch (error) { return json({ error: error instanceof CrushError ? error.message : qwenPublicError(error, "云端改写暂未完成，原推荐仍可使用。") }, error instanceof CrushError ? error.status : 503); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录。" }, 401);
  return rewriteForOwner(request, user.userId);
}
