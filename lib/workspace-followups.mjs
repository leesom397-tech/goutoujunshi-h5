const labels = {
  not_done: '尚未执行', waiting: '已执行，等待反馈', positive: '有积极反馈',
  alternative: '对方提出其他安排', declined: '对方明确拒绝', uncomfortable: '这次相处让我不舒服',
};
const text = (value, length) => typeof value === 'string' ? value.trim().slice(0, length) : '';
const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const array = value => { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const reportId = value => typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : '';

// Read-only projection of archived advice and explicitly saved user feedback.
// These are suggestions and reported outcomes, never tasks created from pending
// facts or a claim that a relationship has progressed. Array order follows the
// append-only feedback log, including revisions with equal timestamps.
export async function workspaceFollowups(db, owner, now, reportsEnabled) {
  const valid = "CASE WHEN json_valid(s.data) THEN s.data ELSE '{}' END";
  const rows = await db.prepare(`SELECT s.id,s.label,json_extract(${valid},'$.relationshipHistory') AS history,json_extract(${valid},'$.actionFeedback') AS feedback
    FROM coach_subjects s WHERE s.owner_id=? AND s.status='active'
    AND EXISTS (SELECT 1 FROM coach_profiles p WHERE p.owner_id=s.owner_id AND p.consent_at IS NOT NULL AND p.paused=0)`)
    .bind(owner).all();
  const candidates = [];
  for (const subject of rows.results || []) {
    const cards = new Map();
    for (const point of array(subject.history)) {
      if (!record(point) || (point.subjectId !== undefined && point.subjectId !== subject.id)) continue;
      const id = reportId(point.reportId), action = text(point.nextStep, 1200);
      if (!id || !action) continue;
      cards.set(id, { reportId: id, action, suggestedAt: timestamp(point.updatedAt), outcome: null,
        outcomeLabel: '尚未反馈', recordedAt: null, sourceAvailable: Boolean(text(point.summary, 1200)) });
    }
    for (const entry of array(subject.feedback)) {
      if (!record(entry) || !Object.hasOwn(labels, entry.outcome)) continue;
      const id = reportId(entry.reportId);
      if (!id) continue;
      const current = cards.get(id);
      const action = current?.action || text(entry.action, 1200);
      if (!action) continue;
      cards.set(id, { reportId: id, action, suggestedAt: current?.suggestedAt || null,
        outcome: entry.outcome, outcomeLabel: labels[entry.outcome], recordedAt: timestamp(entry.recordedAt),
        sourceAvailable: current?.sourceAvailable || false });
    }
    for (const card of cards.values()) candidates.push({ subjectId: subject.id, label: text(subject.label, 60), ...card, reportAvailable: false });
  }
  const pendingFollowups = candidates.filter(card => card.outcome === null).length;
  const followups = candidates.sort((a, b) => Number(b.outcome === null) - Number(a.outcome === null)
    || (b.recordedAt || b.suggestedAt || 0) - (a.recordedAt || a.suggestedAt || 0)
    || a.subjectId.localeCompare(b.subjectId) || a.reportId.localeCompare(b.reportId)).slice(0, 3);
  if (reportsEnabled && followups.length) {
    const ids = [...new Set(followups.map(card => card.reportId))];
    const available = await db.prepare(`SELECT r.id,s.id AS subject_id FROM coach_crush_reports r
      LEFT JOIN coach_crush_threads t ON t.id=r.thread_id AND t.owner_id=r.owner_id
      JOIN coach_subjects s ON s.id=COALESCE(t.subject_id,json_extract(CASE WHEN json_valid(r.result) THEN r.result ELSE '{}' END,'$.subjectId')) AND s.owner_id=r.owner_id AND s.status='active'
      WHERE r.owner_id=? AND r.status='done' AND r.id IN (${ids.map(() => '?').join(',')})
      AND EXISTS (SELECT 1 FROM coach_profiles p WHERE p.owner_id=r.owner_id AND p.consent_at IS NOT NULL AND p.paused=0)
      AND EXISTS (SELECT 1 FROM coach_crush_settings c WHERE c.owner_id=r.owner_id AND c.consent_at IS NOT NULL)`)
      .bind(owner, ...ids).all();
    const sources = new Set((available.results || []).map(row => JSON.stringify([row.subject_id, row.id])));
    for (const card of followups) card.reportAvailable = sources.has(JSON.stringify([card.subjectId, card.reportId]));
  }
  return { followups, pendingFollowups };
}
