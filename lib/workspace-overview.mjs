import { workspaceFollowups } from './workspace-followups.mjs';

const object = value => { try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };
const text = (value, length = 200) => typeof value === 'string' ? value.trim().slice(0, length) : '';

// Only summaries needed by the workspace leave the server. All reads are scoped
// to the authenticated owner, and paused/revoked archive data is not surfaced.
export async function workspaceOverview(db, owner, options = {}) {
  const now = Date.now();
  const query = text(options.query, 80);
  const rawPage = Number(options.page);
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.min(10000, Math.floor(rawPage))) : 1;
  const pageSize = 12;
  const [profile, settings] = await Promise.all([
    db.prepare('SELECT consent_at,paused,data FROM coach_profiles WHERE owner_id=?').bind(owner).first(),
    db.prepare('SELECT consent_at FROM coach_crush_settings WHERE owner_id=?').bind(owner).first(),
  ]);
  const enabled = Boolean(profile?.consent_at), paused = Boolean(profile?.paused);
  const visible = enabled && !paused;
  const [subjects, pending, subjectCount, followupData] = visible ? await Promise.all([
    db.prepare("SELECT id,label,data,updated_at FROM coach_subjects WHERE owner_id=? AND status='active' AND (?='' OR instr(lower(label || ' ' || COALESCE(json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.stage'),'')),lower(?))>0) ORDER BY updated_at DESC,id DESC LIMIT 40").bind(owner, query, query).all(),
    db.prepare("SELECT COUNT(*) AS count FROM coach_facts f WHERE f.owner_id=? AND f.status='pending' AND (f.field IN ('recentEvent','profileClue','selfProfileClue') OR f.field LIKE 'selfBasic:%' OR f.field LIKE 'subjectBasic:%') AND (f.subject_id IS NULL OR EXISTS(SELECT 1 FROM coach_subjects s WHERE s.id=f.subject_id AND s.owner_id=f.owner_id AND s.status='active'))").bind(owner).first(),
    db.prepare("SELECT COUNT(*) AS count FROM coach_subjects WHERE owner_id=? AND status='active'").bind(owner).first(),
    workspaceFollowups(db, owner, now, Boolean(settings?.consent_at)),
  ]) : [{ results: [] }, { count: 0 }, { count: 0 }, { followups: [], pendingFollowups: 0 }];
  const people = (subjects.results || []).map(row => ({ id: row.id, label: text(row.label, 60), stage: text(object(row.data).stage, 60), updatedAt: row.updated_at }));
  const self = visible ? object(profile.data) : {};
  const selfReady = ['preferredRelationship', 'values', 'boundaries', 'goals'].some(key => text(self[key]).length > 0);
  let reports = [], total = 0;
  if (settings?.consent_at && !paused) {
    const valid = "CASE WHEN json_valid(r.result) THEN r.result ELSE '{}' END";
    const summary = `COALESCE(json_extract(${valid}, '$.decision.judgment'),json_extract(${valid}, '$.decision.possibleIntent'),'')`;
    const name = visible ? "COALESCE(s.label,'')" : "''";
    const join = "LEFT JOIN coach_crush_threads t ON t.id=r.thread_id AND t.owner_id=r.owner_id LEFT JOIN coach_subjects s ON s.id=t.subject_id AND s.owner_id=r.owner_id AND s.status='active'";
    const where = `r.owner_id=? AND r.status='done' AND r.expires_at>? AND (?='' OR instr(lower(${name} || ' ' || ${summary}),lower(?))>0)`;
    const values = [owner, now, query, query];
    const [count, rows] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS count FROM coach_crush_reports r ${join} WHERE ${where}`).bind(...values).first(),
      db.prepare(`SELECT r.id,r.created_at,r.expires_at,${summary} AS summary,${name} AS label,${visible ? 's.id' : 'NULL'} AS subject_id FROM coach_crush_reports r ${join} WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?`).bind(...values, pageSize, (page - 1) * pageSize).all(),
    ]);
    total = count?.count || 0;
    reports = (rows.results || []).map(row => ({ id: row.id, subjectId: row.subject_id || null, label: text(row.label, 60), summary: text(row.summary) || '打开查看这次聊天的判断与回复建议', createdAt: row.created_at, expiresAt: row.expires_at }));
  }
  return { archive: { enabled, paused, pendingFacts: pending?.count || 0, selfReady }, people, peopleTotal: subjectCount?.count || 0, ...followupData, reports, total, page, pageSize };
}
