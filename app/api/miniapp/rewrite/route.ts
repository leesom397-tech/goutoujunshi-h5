import { rewriteForOwner } from "@/app/api/crush/rewrite/route";
import { miniappOwner } from "@/lib/miniapp-auth";

export const runtime = "edge";
export async function POST(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return Response.json({ error: "登录已过期，请重新登录。" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return rewriteForOwner(request, identity.ownerId);
}
