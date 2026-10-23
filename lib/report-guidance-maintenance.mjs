// Administrative correction layer: historical conclusions and credit ledger stay intact.
export const GUIDANCE_VERSION = '2026-10-22-v1';
const fields = ['action','actionEvidenceIds','actionPlan','actionUnavailableReason','observeWindow','stopCondition','replyOptions','sourceInsights'];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export class GuidanceMaintenanceError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function withReportGuidance(payload) {
  const {presentationGuidance:layer,guidanceMaintenance:_maintenance,...original} = payload;
  if (layer?.version !== GUIDANCE_VERSION || layer.strictValidated !== true || !layer.updatedAt) return original;
  const report = original.aggregateReport || original;
  const semantic = report.semanticHistory || report.relationshipDiagnosis?.semanticHistory;
  if (!semantic || report.analysisScope !== 'fullHistory') return original;
  const patch = Object.fromEntries(fields.filter(key=>Object.hasOwn(object(layer.patch),key)).map(key=>[key,layer.patch[key]]));
  const updated = {...report, guidanceUpdatedAt:layer.updatedAt, semanticHistory:{...semantic,...patch},
    ...(report.relationshipDiagnosis ? {relationshipDiagnosis:{...report.relationshipDiagnosis,semanticHistory:{...semantic,...patch}}} : {}),
    ...(report.relationshipReport ? {relationshipReport:{...report.relationshipReport,actionPlan:patch.actionPlan||report.relationshipReport.actionPlan}} : {}),
    ...(report.decision ? {decision:{...report.decision,nextStep:patch.action||patch.actionUnavailableReason||report.decision.nextStep,replyOptions:patch.replyOptions||[]}} : {})};
  return original.aggregateReport ? {...original,aggregateReport:updated} : updated;
}

/** A CAS lease on the owner's completed report prevents concurrent calls and
 * resurrection after deletion. At most two bounded maintenance runs per version. */
export async function maintainReportGuidance(db, owner, id, upgrade, now = Date.now) {
  const row = await db.prepare("SELECT result,updated_at FROM coach_saved_reports WHERE id=? AND owner_id=? AND status='done'").bind(id,owner).first();
  if (!row) throw new GuidanceMaintenanceError('报告不存在或已删除。',404);
  const payload = JSON.parse(row.result), report = payload.aggregateReport || payload;
  if (report.analysisScope !== 'fullHistory' || !(report.semanticHistory || report.relationshipDiagnosis?.semanticHistory)) throw new GuidanceMaintenanceError('这份报告没有可补充的完整分析。',422);
  if (payload.presentationGuidance?.version === GUIDANCE_VERSION && payload.presentationGuidance.strictValidated === true) return {ok:true,reused:true,updatedAt:payload.presentationGuidance.updatedAt};
  const old = payload.guidanceMaintenance?.version === GUIDANCE_VERSION ? payload.guidanceMaintenance : {};
  if (old.status === 'running' && old.leaseUntil > now()) throw new GuidanceMaintenanceError('这份报告的建议正在补充。',409);
  if ((old.attempts||0) >= 2) throw new GuidanceMaintenanceError('本版本的维护次数已用完，请先检查失败原因。',429);
  const started = Math.max(now(),Number(row.updated_at)+1);
  const lease = {version:GUIDANCE_VERSION,status:'running',attempts:(old.attempts||0)+1,leaseUntil:started+180000};
  const reserved = {...payload,guidanceMaintenance:lease};
  const lock = await db.prepare("UPDATE coach_saved_reports SET result=?,updated_at=? WHERE id=? AND owner_id=? AND status='done' AND updated_at=?").bind(JSON.stringify(reserved),started,id,owner,row.updated_at).run();
  if (!lock.meta.changes) throw new GuidanceMaintenanceError('报告已更新，请重新检查。',409);
  try {
    const generated = await upgrade(report);
    if (generated.strictValidated !== true || !generated.patch || typeof generated.patch !== 'object') throw Error('GUIDANCE_NOT_VALIDATED');
    const finished = Math.max(now(),started+1), updatedAt = new Date(finished).toISOString();
    const result = {...payload,presentationGuidance:{version:GUIDANCE_VERSION,strictValidated:true,updatedAt,patch:generated.patch},guidanceMaintenance:{...lease,status:'done',leaseUntil:0}};
    const saved = await db.prepare("UPDATE coach_saved_reports SET result=?,updated_at=? WHERE id=? AND owner_id=? AND status='done' AND updated_at=?").bind(JSON.stringify(result),finished,id,owner,started).run();
    if (!saved.meta.changes) throw new GuidanceMaintenanceError('报告在补充期间已更新或删除，本次结果未写入。',409);
    return {ok:true,reused:false,updatedAt,attempts:generated.attempts};
  } catch(error) {
    // Keep the original report even when a provider/validation fails. A stale
    // operation must not replace a newer report or undo a deletion tombstone.
    await db.prepare("UPDATE coach_saved_reports SET result=?,updated_at=? WHERE id=? AND owner_id=? AND status='done' AND updated_at=?")
      .bind(JSON.stringify({...payload,guidanceMaintenance:{...lease,status:'failed',leaseUntil:0}}),Math.max(now(),started+1),id,owner,started).run();
    throw error;
  }
}
