import { analyzeScreenshot } from "@/app/api/crush/screenshot/route";
import { miniappOwner } from "@/lib/miniapp-auth";
import { loadRelationshipFit } from "@/lib/relationship-context-server";

export const runtime = "edge";
export async function POST(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return Response.json({ error: "登录已过期，请重新登录。" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const response = await analyzeScreenshot(request, identity.ownerId);
  if (!response.ok) return response;
  const result = await response.json() as Record<string, unknown>;
  return Response.json({ ...result, compatibility: await loadRelationshipFit(identity.ownerId, typeof result.subjectId === "string" ? result.subjectId : null) }, { headers: { "Cache-Control": "no-store" } });
}
