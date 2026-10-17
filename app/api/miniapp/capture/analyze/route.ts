import { POST as analyze } from "@/app/api/web/capture/analyze/route";
import { miniappOwner } from "@/lib/miniapp-auth";
import { captureCloudPublicOwner } from "@/lib/capture-cloud-server";

export const runtime = "edge";
export async function POST(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return Response.json({ error: "请先登录后分析。" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    if (Number(request.headers.get("content-length") || 0) > 10_000_000) throw Error();
    const raw = await request.clone().text();
    if (raw.length > 10_000_000) throw Error();
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
  } catch { return Response.json({ error: "材料格式不正确或过大。" }, { status: 400 }); }
  if (body.expectedOwnerId !== await captureCloudPublicOwner(identity.ownerId)) return Response.json({ error: "账号已变化，请重新打开资料库后再分析。" }, { status: 409 });
  return analyze(request);
}
