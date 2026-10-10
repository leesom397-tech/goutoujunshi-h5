import { env } from "cloudflare:workers";
import { webOwner } from "@/lib/request-identity.mjs";
import { workspaceOverview } from "@/lib/workspace-overview.mjs";
export const runtime = "edge";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const identity = await webOwner(request, env);
  if (!identity) return Response.json({ error: "请登录后查看你的关系空间。" }, { status: 401, headers });
  const query = new URL(request.url).searchParams;
  try {
    const data = await workspaceOverview(env.DB, identity.ownerId, { query: query.get("q") || "", page: Number(query.get("page") || 1) });
    return Response.json(data, { headers });
  } catch {
    return Response.json({ error: "最近记录暂未取回，请稍后重试。" }, { status: 503, headers });
  }
}
