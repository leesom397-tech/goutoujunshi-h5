export const PERMANENT_REPORT_EXPIRES_AT = 253402300799999;
const uuid = /^[a-f0-9-]{36}$/;
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export async function beginSavedReport(db, options) {
  const { ownerId, id, kind } = options;
  if (!ownerId || !uuid.test(id || '') || !['chat','moments','social'].includes(kind)) throw new Error('SAVED_REPORT_INVALID');
  const createdAt = Number(options.createdAt) || Date.now();
  const subjectId = typeof options.subjectId === 'string' ? options.subjectId : null;
  await db.prepare("INSERT OR IGNORE INTO coach_saved_reports (id,owner_id,kind,subject_id,image_count,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM coach_report_deletions WHERE owner_id=? AND deleted_before>=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM coach_subjects WHERE owner_id=? AND id=? AND status='active'))")
    .bind(id,ownerId,kind,subjectId,Math.max(1,Math.min(9,Number(options.imageCount)||1)),createdAt,createdAt,ownerId,createdAt,subjectId,ownerId,subjectId).run();
  const row = await db.prepare('SELECT owner_id,kind,status FROM coach_saved_reports WHERE id=? AND owner_id=?').bind(id,ownerId).first();
  if (!row || row.status === 'deleted' || row.kind !== kind) throw new Error('SAVED_REPORT_DELETED');
}

export async function saveAnalysisReport(db, options) {
  await beginSavedReport(db, options);
  const { ownerId, id, kind } = options;
  const source = options.result && typeof options.result === 'object' ? options.result : {};
  const entries = kind === 'chat' && Array.isArray(source.entries) ? source.entries : [];
  const reportIds = [...new Set(entries.map(entry => entry?.id).filter(value => uuid.test(value || '')))];
  const last = entries.at(-1) || source;
  const summary = text(kind === 'chat' ? last.decision?.judgment || last.decision?.possibleIntent : source.moments?.summary || source.summary);
  const payload = { ...source, reportId: id, reportKind: kind, retention: 'until-deleted', expiresAt: PERMANENT_REPORT_EXPIRES_AT,
    subjectId: options.subjectId || source.subjectId || null,
    targetSelf: options.targetSelf === true, totalCount: Number(options.totalCount) || Number(options.imageCount) || 1,
    ...(options.selfSide === 'left' || options.selfSide === 'right' ? {selfSide:options.selfSide} : {}) };
  const result = await db.prepare("UPDATE coach_saved_reports SET result=?,report_ids=?,summary=?,status='done',updated_at=? WHERE id=? AND owner_id=? AND status!='deleted' AND NOT EXISTS (SELECT 1 FROM coach_report_deletions WHERE owner_id=? AND deleted_before>=coach_saved_reports.created_at)")
    .bind(JSON.stringify(payload),JSON.stringify(reportIds),summary,Date.now(),id,ownerId,ownerId).run();
  if (!result.meta.changes) throw new Error('SAVED_REPORT_DELETED');
  return payload;
}

export async function readAnalysisReport(db, owner, id) {
  if (!uuid.test(id || '')) return null;
  const row = await db.prepare("SELECT id,kind,result,created_at,image_count FROM coach_saved_reports WHERE id=? AND owner_id=? AND status='done'").bind(id,owner).first();
  if (!row) return null;
  const payload = parse(row.result);
  let entries = row.kind === 'chat' && Array.isArray(payload.entries) ? payload.entries : undefined;
  if(entries?.length){
    // Optional affinity/distribution enrichment updates the source report after
    // the batch first completes. Keep that saved data when reopening the batch.
    const current=await db.prepare("SELECT id,result FROM coach_crush_reports WHERE owner_id=? AND status='done' AND id IN (SELECT value FROM json_each(?))").bind(owner,JSON.stringify(entries.map(entry=>entry.id))).all();
    const byId=new Map((current.results||[]).map(item=>[item.id,parse(item.result)]));
    entries=entries.map(entry=>{const fresh=byId.get(entry.id);return fresh?.id===entry.id?fresh:entry;});
  }
  return { report: entries ? { ...entries.at(-1), reportId:row.id, retention:'until-deleted', expiresAt:PERMANENT_REPORT_EXPIRES_AT } : { ...payload, id:payload.id || row.id },
    ...(entries ? {entries} : {}), kind:row.kind, reportId:row.id, createdAt:row.created_at, imageCount:row.image_count,
    subjectId:payload.subjectId || null, targetSelf:payload.targetSelf === true, totalCount:payload.totalCount || row.image_count, selfSide:payload.selfSide,
    retention:'until-deleted', partial:payload.partial === true };
}

export async function listAnalysisReports(db, owner, options = {}) {
  const query = text(options.query || options.q, 80);
  const page = Math.max(1,Math.min(10000,Math.floor(Number(options.page)||1))), pageSize=12;
  // Existing single-image reports remain accessible. A durable batch suppresses
  // its member rows, so one upload appears once in history, including partials.
  const union = `SELECT saved.id,saved.kind,person.id AS subject_id,COALESCE(person.label,'') AS label,saved.summary,saved.created_at,saved.image_count
    FROM coach_saved_reports saved LEFT JOIN coach_subjects person ON person.id=saved.subject_id AND person.owner_id=saved.owner_id AND person.status='active'
    WHERE saved.owner_id=? AND saved.status='done'
    UNION ALL
    SELECT r.id,'chat' AS kind,person.id AS subject_id,COALESCE(person.label,'') AS label,
      COALESCE(json_extract(CASE WHEN json_valid(r.result) THEN r.result ELSE '{}' END,'$.decision.judgment'),json_extract(CASE WHEN json_valid(r.result) THEN r.result ELSE '{}' END,'$.decision.possibleIntent'),'') AS summary,r.created_at,1 AS image_count
    FROM coach_crush_reports r LEFT JOIN coach_crush_threads t ON t.id=r.thread_id AND t.owner_id=r.owner_id
      LEFT JOIN coach_subjects person ON person.id=COALESCE(t.subject_id,json_extract(CASE WHEN json_valid(r.result) THEN r.result ELSE '{}' END,'$.subjectId')) AND person.owner_id=r.owner_id AND person.status='active'
    WHERE r.owner_id=? AND r.status='done' AND NOT EXISTS (SELECT 1 FROM coach_saved_reports batch,json_each(batch.report_ids) member WHERE batch.owner_id=r.owner_id AND member.value=r.id)`;
  const filtered = `SELECT * FROM (${union}) WHERE (?='' OR instr(lower(label || ' ' || summary),lower(?))>0)`;
  const values=[owner,owner,query,query];
  const [count,rows]=await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM (${filtered})`).bind(...values).first(),
    db.prepare(`${filtered} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...values,pageSize,(page-1)*pageSize).all(),
  ]);
  return { reports:(rows.results||[]).map(row=>({id:row.id,kind:row.kind,subjectId:row.subject_id||null,label:text(row.label,60),summary:text(row.summary)||'打开查看这次分析',createdAt:row.created_at,imageCount:row.image_count,expiresAt:PERMANENT_REPORT_EXPIRES_AT,retention:'until-deleted'})), total:count?.count||0,page,pageSize };
}

export async function deleteAnalysisReport(db, owner, id) {
  if (!uuid.test(id || '')) return false;
  const saved=await db.prepare('SELECT id,report_ids FROM coach_saved_reports WHERE owner_id=? AND (id=? OR EXISTS(SELECT 1 FROM json_each(report_ids) WHERE value=?)) LIMIT 1').bind(owner,id,id).first();
  if(saved){
    await db.batch([
      db.prepare("UPDATE coach_saved_reports SET status='deleted',result='{}',summary='',updated_at=? WHERE id=? AND owner_id=?").bind(Date.now(),saved.id,owner),
      db.prepare('DELETE FROM coach_crush_reports WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))').bind(owner,saved.report_ids||'[]'),
    ]);
    return true;
  }
  const deleted=await db.prepare('DELETE FROM coach_crush_reports WHERE id=? AND owner_id=?').bind(id,owner).run();
  return Boolean(deleted.meta.changes);
}

// Keep content-free tombstones so a delayed Durable Object alarm cannot restore
// a report the user already deleted. Uploads and live context have separate TTLs.
export async function clearSavedReports(db, owner, subjectId) {
  if(subjectId){
    await db.prepare("UPDATE coach_saved_reports SET status='deleted',result='{}',summary='',updated_at=? WHERE owner_id=? AND subject_id=?").bind(Date.now(),owner,subjectId).run();
  }else{
    const now=Date.now();
    await db.batch([
      db.prepare('INSERT INTO coach_report_deletions (owner_id,deleted_before) VALUES (?,?) ON CONFLICT(owner_id) DO UPDATE SET deleted_before=MAX(deleted_before,excluded.deleted_before)').bind(owner,now),
      db.prepare("UPDATE coach_saved_reports SET status='deleted',result='{}',summary='',updated_at=? WHERE owner_id=?").bind(now,owner),
    ]);
  }
}
