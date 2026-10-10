import { miniappOwner } from "@/lib/miniapp-auth";
import { ownedReport } from "@/lib/crush/service";
import { CrushError } from "@/lib/crush/types";
import { loadRelationshipFit } from "@/lib/relationship-context";

export const runtime = "edge";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export async function GET(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!idPattern.test(id)) return json({ error: "报告编号不正确。" }, 400);
  try {
    const report = await ownedReport(identity.ownerId, id);
    const latestCompatibility = await loadRelationshipFit(identity.ownerId, report.subjectId);
    // Do not overwrite a stored historical assessment with a live projection.
    return json({ report: { ...report, latestCompatibility, compatibilityContext: {
      basis: 'current-confirmed-profile', computedAt: Date.now(), methodVersion: latestCompatibility?.methodVersion || null
    } } });
  } catch (error) {
    if (error instanceof CrushError) return json({ error: error.message }, error.status);
    throw error;
  }
}
