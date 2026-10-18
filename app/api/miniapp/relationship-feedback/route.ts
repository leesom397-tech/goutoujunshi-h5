import { miniappOwner } from "@/lib/miniapp-auth";
import { getD1 } from "@/db";
import { appendActionFeedback, actionFeedbackCards, relationshipProgressEvents, FeedbackError } from "@/lib/relationship-feedback";
import { automaticRelationshipUpdate } from "@/lib/relationship-updates";
import { loadRelationshipEvidence } from "@/lib/relationship-evidence-server";
import { reportVersionChanges } from "@/lib/report-version-changes";

export const runtime = "edge";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  const subjectId = new URL(request.url).searchParams.get("subjectId");
  if (!subjectId || subjectId.length > 64) return json({ error: "请选择人物。" }, 400);
  try {
    const db = getD1();
    const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(identity.ownerId).first<{ consent_at: number | null; paused: number }>();
    if (!profile?.consent_at || profile.paused) return json({ error: "请先启用并恢复档案。" }, 403);
    const subject = await db.prepare("SELECT data FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(subjectId, identity.ownerId).first<{ data: string }>();
    if (!subject) return json({ error: "人物档案不存在。" }, 404);
    const data = JSON.parse(subject.data);
    if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "档案数据暂不可用。" }, 409);
    const facts = await db.prepare("SELECT id,value,evidence,event_meta,status,created_at FROM coach_facts WHERE owner_id=? AND subject_id=? AND field='recentEvent' AND status='accepted' ORDER BY created_at DESC LIMIT 200").bind(identity.ownerId,subjectId).all<{id:string;value:string;evidence:string;event_meta:string|null;status:string;created_at:number}>();
    const reportId = new URL(request.url).searchParams.get("reportId") || "";
    if (reportId && !/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(reportId)) return json({ error: "报告标识不正确。" }, 400);
    const snapshot = await loadRelationshipEvidence(identity.ownerId, subjectId, reportId, db);
    if (!snapshot.authorized) return json({ error: "请先启用并恢复档案。" }, 403);
    if (!snapshot.validFocus) return json({ error: "人物或报告已不可用，请重新打开。" }, 404);
    const availableIds = new Set(snapshot.reports.flatMap(row => [row.id, ...(row.entries || []).map(entry => entry.id).filter(id => typeof id === "string")]));
    const history = Array.isArray(snapshot.data.relationshipHistory) ? snapshot.data.relationshipHistory.filter((point: any) => availableIds.has(point?.reportId) && Number.isFinite(point.updatedAt) && point.updatedAt <= snapshot.cutoff) : [];
    const effectiveData: Record<string, unknown> = { ...snapshot.data, relationshipHistory: history };
    const scopedData = reportId ? { ...effectiveData, actionFeedback: Array.isArray(effectiveData.actionFeedback) ? effectiveData.actionFeedback.filter((item: any) => availableIds.has(item?.reportId) && Number.isFinite(item.recordedAt) && item.recordedAt <= snapshot.cutoff) : [] } : effectiveData;
    const scopedFacts = reportId ? (facts.results || []).filter(fact => fact.created_at <= snapshot.cutoff) : facts.results;
    // New feedback belongs to this report even when recorded after it. Keep
    // historical comparisons at their original cutoff; expose latest edits separately.
    const currentFeedback = reportId ? actionFeedbackCards(snapshot.data).find(card => card.reportId === reportId) || null : null;
    return json({ subjectId, currentFeedback, versionChanges: reportId ? reportVersionChanges(snapshot.reports,reportId) : null, cards: actionFeedbackCards(scopedData), events: relationshipProgressEvents(scopedData,scopedFacts), automatic: automaticRelationshipUpdate(scopedData, subjectId, reportId, snapshot.reports) });
  } catch { return json({ error: "行动记录暂时无法读取。" }, 503); }
}

export async function DELETE(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  let body: Record<string, unknown>;
  try { const raw = await request.text(); if (raw.length > 1000) return json({ error: "请求过长。" }, 413); body = JSON.parse(raw); }
  catch { return json({ error: "无法读取请求。" }, 400); }
  if (!body || typeof body !== "object" || body.confirmed !== true || typeof body.subjectId !== "string" || !body.subjectId || body.subjectId.length > 64 || typeof body.reportId !== "string" || !body.reportId || body.reportId.length > 64) return json({ error: "请确认删除这条建议的全部反馈记录。" }, 400);
  try {
    const db = getD1();
    for (let attempt = 0; attempt < 3; attempt++) {
      const subject = await db.prepare("SELECT data FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(body.subjectId, identity.ownerId).first<{ data: string }>();
      if (!subject) return json({ error: "人物档案不存在。" }, 404);
      const data = JSON.parse(subject.data);
      const entries = Array.isArray(data.actionFeedback) ? data.actionFeedback : [];
      const kept = entries.filter((entry: { reportId: string }) => entry.reportId !== body.reportId);
      if (kept.length === entries.length) return json({ deleted: true });
      // Removing personal data remains possible even after pausing or revoking consent.
      const saved = await db.prepare("UPDATE coach_subjects SET data=json_set(data,'$.actionFeedback',json(?)),updated_at=? WHERE id=? AND owner_id=? AND status='active' AND data=?")
        .bind(JSON.stringify(kept), Date.now(), body.subjectId, identity.ownerId, subject.data).run();
      if (saved.meta.changes) return json({ deleted: true });
    }
    return json({ error: "档案正在更新，请稍后重试。" }, 409);
  } catch { return json({ error: "反馈暂未删除，请稍后重试。" }, 503); }
}

export async function POST(request: Request) {
  const identity = await miniappOwner(request);
  if (!identity) return json({ error: "登录已过期，请重新登录。" }, 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 5000) return json({ error: "反馈内容过长。" }, 413);
  let body: Record<string, unknown>;
  try { const raw = await request.text(); if (raw.length > 5000) return json({ error: "反馈内容过长。" }, 413); body = JSON.parse(raw); }
  catch { return json({ error: "无法读取反馈。" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.subjectId !== "string" || body.subjectId.length > 64 || body.confirmed !== true) return json({ error: "请确认保存到当前人物档案。" }, 400);
  const db = getD1(), owner = identity.ownerId;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const profile = await db.prepare("SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?").bind(owner).first<{ consent_at: number | null; paused: number }>();
      if (!profile?.consent_at || profile.paused) return json({ error: "请先启用并恢复档案。" }, 403);
      const subject = await db.prepare("SELECT data FROM coach_subjects WHERE id=? AND owner_id=? AND status='active'").bind(body.subjectId, owner).first<{ data: string }>();
      if (!subject) return json({ error: "人物档案不存在。" }, 404);
      let data: Record<string, unknown>;
      try { data = JSON.parse(subject.data); if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(); }
      catch { return json({ error: "档案数据暂不可用，请稍后重试。" }, 409); }
      const now = Date.now();
      const result = appendActionFeedback(data, body, now);
      if (result.duplicate) return json({ feedback: result.entry, duplicate: true });
      const saved = await db.prepare("UPDATE coach_subjects SET data=json_set(data,'$.actionFeedback',json(?)),updated_at=? WHERE id=? AND owner_id=? AND status='active' AND data=? AND EXISTS (SELECT 1 FROM coach_profiles WHERE owner_id=? AND consent_at IS NOT NULL AND paused=0)")
        .bind(JSON.stringify(result.entries), now, body.subjectId, owner, subject.data, owner).run();
      if (saved.meta.changes) return json({ feedback: result.entry, duplicate: false });
    }
    return json({ error: "档案正在更新，请稍后重试。" }, 409);
  } catch (error) {
    if (error instanceof FeedbackError) return json({ error: error.message }, error.status);
    return json({ error: "反馈暂未保存，请稍后重试。" }, 503);
  }
}
