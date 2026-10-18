import { miniappOwner } from "@/lib/miniapp-auth";
import { ownedReport } from "@/lib/crush/service";
import { CrushError } from "@/lib/crush/types";
import { loadRelationshipFit } from "@/lib/relationship-context-server";
import { getD1 } from "@/db";
import { readAnalysisReport, deleteAnalysisReport } from "@/lib/saved-reports.mjs";
import { readableReport } from "@/lib/crush/evidence";
import type { CrushResult } from "@/lib/crush/types";
import {personalizeReport} from "@/lib/personal-context-server";
import { reportFreshness } from "@/lib/report-freshness";

export const runtime = "edge";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export async function GET(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!idPattern.test(id)) return json({ error: "报告编号不正确。" }, 400);
  try {
    const saved=await readAnalysisReport(getD1(),identity.ownerId,id);
    if(saved){
      if(saved.report.importAnalysis || saved.report.riskAnalysis) return json(saved);
      if(saved.kind==='chat'){
        saved.entries=saved.entries?.map((entry:CrushResult)=>readableReport(entry));
        saved.report=readableReport(saved.report as CrushResult);
      }
      // This owner-scoped read projection reflects newly confirmed self material
      // without mutating historical model conclusions or charging for analysis.
      const connection=await personalizeReport(identity.ownerId,saved.subjectId,{...saved.report,subjectId:saved.subjectId,targetSelf:saved.targetSelf,...(saved.entries?{entries:saved.entries}:{})});
      const personalConnectionContext={basis:'current-confirmed-material',computedAt:Date.now()};
      saved.report={...saved.report,personalConnection:connection,personalConnectionContext};
      if(saved.entries)saved.entries=saved.entries.map((entry:CrushResult)=>({...entry,personalConnection:connection}));
      const freshness = await reportFreshness(getD1(), identity.ownerId, saved.subjectId || null, saved.report);
      return json({...saved, ...(freshness ? {freshness} : {})});
    }
    const report = await ownedReport(identity.ownerId, id);
    const latestCompatibility = await loadRelationshipFit(identity.ownerId, report.subjectId);
    const connection=await personalizeReport(identity.ownerId,report.subjectId,report);
    // Do not overwrite a stored historical assessment with a live projection.
    return json({kind:'chat',reportId:id,subjectId:report.subjectId,retention:'until-deleted',report: { ...report, reportId:id,retention:'until-deleted',personalConnection:connection,personalConnectionContext:{basis:'current-confirmed-material',computedAt:Date.now()},latestCompatibility, compatibilityContext: {
      basis: 'current-confirmed-profile', computedAt: Date.now(), methodVersion: latestCompatibility?.methodVersion || null
    } } });
  } catch (error) {
    if (error instanceof CrushError) return json({ error: error.message }, error.status);
    throw error;
  }
}

export async function DELETE(request:Request){
  const identity=await miniappOwner(request);
  if(!identity)return json({error:'请登录后删除报告。'},401);
  if(new URL(request.url).pathname.startsWith('/api/web/') && request.headers.get('origin')!==new URL(request.url).origin)return json({error:'请求来源无效。'},403);
  const id=new URL(request.url).searchParams.get('id')||'';
  if(!idPattern.test(id))return json({error:'报告编号不正确。'},400);
  return await deleteAnalysisReport(getD1(),identity.ownerId,id)?json({ok:true}):json({error:'报告不存在或已删除。'},404);
}
