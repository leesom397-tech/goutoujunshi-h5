import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import {deleteCrush} from "@/lib/crush/service";
import { cleanData, type Fact, type ProfileState, type SelfData, type Subject, type SubjectData } from "@/lib/profile";
import { cleanEditableProfilePatch, editableProfileDataSql } from "@/lib/profile-updates";

export const runtime = "edge";
const noStore = { "Cache-Control": "no-store" };
type ProfileRow = { consent_at: number | null; paused: number; data: string };
type SubjectRow = { id: string; label: string; status: string; data: string; created_at: number; updated_at: number };
type FactRow = { id: string; subject_id: string | null; field: string; value: string; source: string; evidence: string; confidence: string; status: string; created_at: number };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: noStore });
const parse = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };

async function state(ownerId: string): Promise<ProfileState> {
  const db = getD1();
  const [profile, subjects, facts] = await Promise.all([
    db.prepare("SELECT consent_at, paused, data FROM coach_profiles WHERE owner_id = ?").bind(ownerId).first<ProfileRow>(),
    db.prepare("SELECT id, label, status, data, created_at, updated_at FROM coach_subjects WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 40").bind(ownerId).all<SubjectRow>(),
    db.prepare("SELECT id, subject_id, field, value, source, evidence, confidence, status, created_at FROM coach_facts WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200").bind(ownerId).all<FactRow>(),
  ]);
  return {
    enabled: !!profile?.consent_at,
    paused: !!profile?.paused,
    self: parse<SelfData>(profile?.data || "{}", {}),
    subjects: (subjects.results || []).map((item): Subject => ({
      id: item.id, label: item.label, status: item.status === "draft" ? "draft" : "active",
      data: parse<SubjectData>(item.data, {}), createdAt: item.created_at, updatedAt: item.updated_at,
    })),
    facts: (facts.results || []).map((item): Fact => ({
      id: item.id, subjectId: item.subject_id, field: item.field, value: item.value,
      source: item.source, evidence: item.evidence, confidence: item.confidence === "high" ? "high" : item.confidence === "low" ? "low" : "medium",
      status: item.status === "accepted" ? "accepted" : "pending", createdAt: item.created_at,
    })),
  };
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录，档案只对你本人可见。" }, 401);
  try { return json(await state(user.userId)); }
  catch { return json({ error: "档案暂时无法读取，请稍后再试。" }, 503); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录后管理档案。" }, 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 16000) return json({ error: "资料过长。" }, 413);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "无法读取资料。" }, 400); }
  const owner = user.userId;
  const db = getD1();
  const now = Date.now();
  try {
    if (body.action === "consent") {
      if (body.enabled === true) {
        await db.prepare("INSERT INTO coach_profiles (owner_id, consent_at, paused, data, updated_at) VALUES (?, ?, 0, '{}', ?) ON CONFLICT(owner_id) DO UPDATE SET consent_at = excluded.consent_at, paused = 0, updated_at = excluded.updated_at").bind(owner, now, now).run();
      } else if (body.enabled === false) {
        await db.prepare("UPDATE coach_profiles SET consent_at = NULL, paused = 1, updated_at = ? WHERE owner_id = ?").bind(now, owner).run();
      } else return json({ error: "请选择是否启用档案。" }, 400);
    } else if (body.action === "pause") {
      if (typeof body.paused !== "boolean") return json({ error: "暂停状态不正确。" }, 400);
      await db.prepare("UPDATE coach_profiles SET paused = ?, updated_at = ? WHERE owner_id = ?").bind(body.paused ? 1 : 0, now, owner).run();
    } else if (body.action === "self") {
      if (!await hasConsent(db, owner)) return json({ error: "请先同意保存档案。" }, 403);
      const data = cleanEditableProfilePatch(body.data, "self");
      await db.prepare(`UPDATE coach_profiles SET data = ${editableProfileDataSql("self")}, updated_at = ? WHERE owner_id = ?`).bind(JSON.stringify(data), now, owner).run();
    } else if (body.action === "subject-create") {
      if (!await hasConsent(db, owner)) return json({ error: "请先同意保存档案。" }, 403);
      const label = validLabel(body.label);
      if (!label) return json({ error: "请填写对象代号或称呼。" }, 400);
      const count = await db.prepare("SELECT COUNT(*) AS n FROM coach_subjects WHERE owner_id = ?").bind(owner).first<{ n: number }>();
      if ((count?.n || 0) >= 40) return json({ error: "对象已达到上限，请先整理旧档案。" }, 409);
      await db.prepare("INSERT INTO coach_subjects (id, owner_id, label, status, data, created_at, updated_at) VALUES (?, ?, ?, 'active', '{}', ?, ?)").bind(crypto.randomUUID(), owner, label, now, now).run();
    } else if (body.action === "subject-update") {
      if (!await hasConsent(db, owner)) return json({ error: "请先同意保存档案。" }, 403);
      if (typeof body.id !== "string") return json({ error: "对象无效。" }, 400);
      const label = validLabel(body.label);
      if (!label) return json({ error: "请填写对象代号或称呼。" }, 400);
      const data = cleanEditableProfilePatch(body.data, "subject");
      const result = await db.prepare(`UPDATE coach_subjects SET label = ?, status = 'active', data = ${editableProfileDataSql("subject")}, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(label, JSON.stringify(data), now, body.id, owner).run();
      if (!result.meta.changes) return json({ error: "没有找到这个对象。" }, 404);
    } else if (body.action === "subject-delete") {
      if (typeof body.id !== "string") return json({ error: "对象无效。" }, 400);
      await deleteCrush(owner,body.id);
      await db.batch([
        db.prepare("UPDATE coach_wechat_links SET subject_id = NULL WHERE subject_id = ? AND owner_id = ?").bind(body.id, owner),
        db.prepare("DELETE FROM coach_facts WHERE subject_id = ? AND owner_id = ?").bind(body.id, owner),
        db.prepare("DELETE FROM coach_subjects WHERE id = ? AND owner_id = ?").bind(body.id, owner),
      ]);
    } else if (body.action === "memory-delete") {
      if (typeof body.id !== "string") return json({ error: "记忆无效。" }, 400);
      const target=await db.prepare("SELECT subject_id,evidence FROM coach_facts WHERE id=? AND owner_id=? AND field='chatMemory' AND status='accepted'").bind(body.id,owner).first<{subject_id:string|null;evidence:string}>();
      if(!target)return json({error:"这条记忆已删除或不存在。"},404);
      const batch=/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:#\d+)?$/i.exec(target.evidence);
      const removed=batch
        ?await db.prepare("DELETE FROM coach_facts WHERE owner_id=? AND subject_id=? AND field='chatMemory' AND status='accepted' AND (evidence=? OR evidence LIKE ?)").bind(owner,target.subject_id,batch[1],batch[1]+"#%").run()
        :await db.prepare("DELETE FROM coach_facts WHERE id=? AND owner_id=? AND field='chatMemory' AND status='accepted'").bind(body.id,owner).run();
      if(!removed.meta.changes)return json({error:"这条记忆已删除或不存在。"},404);
    } else if (body.action === "fact-decide") {
      if (typeof body.id !== "string" || !["accept", "reject"].includes(String(body.decision))) return json({ error: "确认操作无效。" }, 400);
      if (!await hasConsent(db, owner)) return json({ error: "档案功能未启用。" }, 403);
      const fact = await db.prepare("SELECT id, subject_id, field, value FROM coach_facts WHERE id = ? AND owner_id = ? AND status = 'pending'").bind(body.id, owner).first<Pick<FactRow, "id" | "subject_id" | "field" | "value">>();
      if (!fact) return json({ error: "这条信息已处理或不存在。" }, 404);
      if (body.decision === "reject") {
        await db.prepare("DELETE FROM coach_facts WHERE id = ? AND owner_id = ?").bind(fact.id, owner).run();
      } else {
        if (fact.subject_id) {
          const row = await db.prepare("SELECT data FROM coach_subjects WHERE id = ? AND owner_id = ?").bind(fact.subject_id, owner).first<{ data: string }>();
          if (!row) return json({ error: "关联对象已删除。" }, 404);
          const data = parse<Record<string, unknown>>(row.data, {});
          if (fact.field === "recentEvent") data.notes = [data.notes, "事件：" + fact.value].filter(Boolean).join("\n").slice(-800);
          else data[fact.field] = fact.value;
          const clean = cleanData(data, "subject");
          await db.batch([
            db.prepare(`UPDATE coach_subjects SET data = ${editableProfileDataSql("subject")}, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(JSON.stringify(clean), now, fact.subject_id, owner),
            db.prepare("UPDATE coach_facts SET status = 'accepted' WHERE id = ? AND owner_id = ?").bind(fact.id, owner),
          ]);
        } else {
          const row = await db.prepare("SELECT data FROM coach_profiles WHERE owner_id = ?").bind(owner).first<{ data: string }>();
          const data = parse<Record<string, unknown>>(row?.data || "{}", {});
          data[fact.field] = fact.value;
          const clean = cleanData(data, "self");
          await db.batch([
            db.prepare(`UPDATE coach_profiles SET data = ${editableProfileDataSql("self")}, updated_at = ? WHERE owner_id = ?`).bind(JSON.stringify(clean), now, owner),
            db.prepare("UPDATE coach_facts SET status = 'accepted' WHERE id = ? AND owner_id = ?").bind(fact.id, owner),
          ]);
        }
      }
    } else if (body.action === "import-candidates") {
      if (!await hasConsent(db, owner)) return json({ error: "请先启用档案。" }, 403);
      if (typeof body.subjectId !== "string") return json({ error: "请先选择对象。" }, 400);
      const subject = await db.prepare("SELECT id FROM coach_subjects WHERE id = ? AND owner_id = ?").bind(body.subjectId, owner).first();
      if (!subject) return json({ error: "对象不存在。" }, 404);
      const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 3) : [];
      let saved = 0;
      for (const item of candidates) {
        if (!item || typeof item !== "object") continue;
        const candidate = item as { value?: unknown; evidence?: unknown };
        const value = typeof candidate.value === "string" ? candidate.value.trim().slice(0, 180) : "";
        const evidence = typeof candidate.evidence === "string" ? candidate.evidence.trim().slice(0, 100) : "";
        if (!value || !evidence) continue;
        const count = await db.prepare("SELECT COUNT(*) AS n FROM coach_facts WHERE owner_id = ?").bind(owner).first<{ n: number }>();
        if ((count?.n || 0) >= 200) break;
        await db.prepare("INSERT INTO coach_facts (id, owner_id, subject_id, field, value, source, evidence, confidence, status, created_at) VALUES (?, ?, ?, 'recentEvent', ?, '导入材料分析／待核对', ?, 'low', 'pending', ?)").bind(
          crypto.randomUUID(), owner, body.subjectId, value, evidence, now + saved,
        ).run();
        saved++;
      }
    } else if (body.action === "wipe") {
      await db.prepare("DELETE FROM coach_crush_settings WHERE owner_id = ?").bind(owner).run();
      await deleteCrush(owner);
      await db.batch([
        db.prepare("DELETE FROM coach_wechat_outbox WHERE owner_id = ?").bind(owner),
        db.prepare("DELETE FROM coach_wechat_inbox WHERE external_userid IN (SELECT external_userid FROM coach_wechat_links WHERE owner_id = ?)").bind(owner),
        db.prepare("DELETE FROM coach_wechat_links WHERE owner_id = ?").bind(owner),
        db.prepare("DELETE FROM coach_wechat_bind_codes WHERE owner_id = ?").bind(owner),
        db.prepare("DELETE FROM coach_positionings WHERE owner_id = ?").bind(owner),
        db.prepare("DELETE FROM coach_facts WHERE owner_id = ?").bind(owner),
        db.prepare("DELETE FROM coach_subjects WHERE owner_id = ?").bind(owner),
        db.prepare("DELETE FROM coach_profiles WHERE owner_id = ?").bind(owner),
      ]);
    } else return json({ error: "不支持的操作。" }, 400);
    return json(await state(owner));
  } catch (error) {
    if (error instanceof Error && /资料|评分|维度/.test(error.message)) return json({ error: error.message }, 400);
    return json({ error: "保存失败，请稍后再试。你的输入尚未丢失。" }, 503);
  }
}

async function hasConsent(db: D1Database, owner: string) {
  const row = await db.prepare("SELECT consent_at, paused FROM coach_profiles WHERE owner_id = ?").bind(owner).first<{ consent_at: number | null; paused: number }>();
  return !!row?.consent_at && !row.paused;
}
function validLabel(input: unknown) {
  return typeof input === "string" && input.trim().length >= 1 && input.trim().length <= 60 ? input.trim() : null;
}
