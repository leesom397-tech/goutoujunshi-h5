import { getChatGPTUser } from "@/app/chatgpt-auth";
import { buildKnowledgeContext, type KnowledgeMode } from "@/lib/knowledge";

export const runtime = "edge";

// This route returns licensed reference text, so it is not exposed to
// anonymous visitors. The hosting access policy must remain owner-private.
export async function POST(request: Request) {
  if (!await getChatGPTUser()) {
    return Response.json({ error: "请先登录后使用语音知识库。" }, { status: 401 });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "请求格式不正确。" }, { status: 415 });
  }
  if (Number(request.headers.get("content-length") || 0) > 8000) {
    return Response.json({ error: "问题过长。" }, { status: 413 });
  }
  let body: { query?: unknown; mode?: unknown };
  try { body = await request.json(); } catch {
    return Response.json({ error: "无法读取问题。" }, { status: 400 });
  }
  if (typeof body.query !== "string" || body.query.length < 1 || body.query.length > 2000 ||
      !["reply", "signal", "decision"].includes(String(body.mode))) {
    return Response.json({ error: "问题或模式无效。" }, { status: 400 });
  }
  return Response.json(buildKnowledgeContext(body.query, body.mode as KnowledgeMode), {
    headers: { "Cache-Control": "no-store" },
  });
}
