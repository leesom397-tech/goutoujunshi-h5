import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import { suggestedFields } from "@/lib/profile";
import { qwenChat, qwenKey, qwenPublicError, parseQwenJson, type QwenContent } from "@/lib/qwen";

export const runtime = "edge";
type Suggestion = { target?: string; field?: string; value?: string; evidence?: string; confidence?: string };
type Extracted = { newSubjectLabel?: string | null; facts?: Suggestion[] };
const noStore = { "Cache-Control": "no-store" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: noStore });
const selfAllowed = new Set(["mbti", "strengths", "growthAreas", "goals", "values", "boundaries", "preferredRelationship"]);
const subjectAllowed = new Set<string>(suggestedFields);

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录后使用档案。" }, 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 8_000_000) return json({ error: "截图过大。" }, 413);
  let body: { text?: unknown; image?: unknown; subjectId?: unknown };
  try { body = await request.json(); } catch { return json({ error: "无法读取消息。" }, 400); }
  if (typeof body.text !== "string" || body.text.length > 4000 || !body.text.trim() && !body.image) return json({ error: "没有可整理的内容。" }, 400);
  if (body.image && (typeof body.image !== "string" || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.image) || body.image.length > 7_000_000)) return json({ error: "截图格式不支持或过大。" }, 400);
  const db = getD1();
  const owner = user.userId;
  const profile = await db.prepare("SELECT consent_at, paused FROM coach_profiles WHERE owner_id = ?").bind(owner).first<{ consent_at: number | null; paused: number }>();
  if (!profile?.consent_at || profile.paused) return json({ error: "档案未启用或已暂停。" }, 403);
  let selected: { id: string; label: string } | null = null;
  if (typeof body.subjectId === "string") {
    selected = await db.prepare("SELECT id, label FROM coach_subjects WHERE id = ? AND owner_id = ?").bind(body.subjectId, owner).first<{ id: string; label: string }>();
    if (!selected) return json({ error: "所选对象不存在。" }, 404);
  }
  if (!qwenKey()) return json({ error: "智能整理暂未开通，请联系客服。" }, 503);
  const content: QwenContent = [
    { type: "text", text: "当前选中对象：" + (selected?.label || "无") + "\n用户本轮内容：" + (body.text || "") },
  ];
  if (typeof body.image === "string") content.push({ type: "image_url", image_url: { url: body.image, detail: "high" } });
  let extracted: Extracted;
  try {
    const raw = await qwenChat([
      { role: "system", content: [
          "你只做关系档案候选信息提取，不提供分析。仅返回 JSON 对象：{newSubjectLabel:null或字符串,facts:[{target:'self'或'subject',field,value,evidence,confidence:'high'或'medium'或'low'}]}。",
          "只提取用户明确陈述或截图清晰可见的事实，不根据语气、性别、气泡左右、MBTI猜测、主观印象补全。截图说话人不明时不提取对应事实。",
          "newSubjectLabel 只有用户明确说出一个与当前选中对象不同的称呼/代号时才填写；代词、泛称、猜测不得建立新对象。",
          "不要给人打分，不提取心理诊断、性经历、财务、身份证明或完整聊天；每条 value 最多 180 字，evidence 是不超过 100 字的可核对原句摘要。最多 5 条；没有可靠新信息返回空数组。",
          "self 允许字段：mbti,strengths,growthAreas,goals,values,boundaries,preferredRelationship。subject 允许字段：mbti,stage,howMet,strengths,concerns,values,boundaries,notes,recentEvent。MBTI 只能来自用户明说。",
          "对于当前对象的关系行为，一次性变化用 recentEvent，不要永久定性成 strengths 或 concerns。未知或矛盾不填。",
        ].join("\n") },
      { role: "user", content },
    ], { vision: typeof body.image === "string", json: true, maxTokens: 900, timeoutMs: 45000 });
    extracted = parseQwenJson<Extracted>(raw);
  } catch (error) { return json({ error: qwenPublicError(error, "连接智能整理服务失败，请稍后再试。") }, 502); }
  const now = Date.now();
  let subjectId = selected?.id || null;
  let createdSubjectId: string | null = null;
  const label = typeof extracted.newSubjectLabel === "string" ? extracted.newSubjectLabel.trim().slice(0, 60) : "";
  if (label && label !== selected?.label) {
    const existing = await db.prepare("SELECT id FROM coach_subjects WHERE owner_id = ? AND lower(label) = lower(?)").bind(owner, label).first<{ id: string }>();
    if (existing) subjectId = existing.id;
    else {
      const count = await db.prepare("SELECT COUNT(*) AS n FROM coach_subjects WHERE owner_id = ?").bind(owner).first<{ n: number }>();
      if ((count?.n || 0) < 40) {
        subjectId = crypto.randomUUID();
        createdSubjectId = subjectId;
        await db.prepare("INSERT INTO coach_subjects (id, owner_id, label, status, data, created_at, updated_at) VALUES (?, ?, ?, 'draft', '{}', ?, ?)").bind(subjectId, owner, label, now, now).run();
      }
    }
  }
  let pendingCount = 0;
  for (const item of Array.isArray(extracted.facts) ? extracted.facts.slice(0, 5) : []) {
    const target = item.target === "self" ? "self" : "subject";
    const field = String(item.field || "");
    const value = String(item.value || "").trim().slice(0, 180);
    const evidence = String(item.evidence || "").trim().slice(0, 100);
    if (!value || !evidence || !(target === "self" ? selfAllowed : subjectAllowed).has(field)) continue;
    if (target === "subject" && !subjectId) continue;
    const relatedId = target === "subject" ? subjectId : null;
    const duplicate = await db.prepare("SELECT id FROM coach_facts WHERE owner_id = ? AND subject_id IS ? AND field = ? AND value = ? LIMIT 1").bind(owner, relatedId, field, value).first();
    if (duplicate) continue;
    const count = await db.prepare("SELECT COUNT(*) AS n FROM coach_facts WHERE owner_id = ?").bind(owner).first<{ n: number }>();
    if ((count?.n || 0) >= 200) break;
    await db.prepare("INSERT INTO coach_facts (id, owner_id, subject_id, field, value, source, evidence, confidence, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)").bind(
      crypto.randomUUID(), owner, relatedId, field, value, body.image ? "聊天截图／用户描述" : "用户描述", evidence,
      item.confidence === "high" ? "high" : item.confidence === "low" ? "low" : "medium", now + pendingCount,
    ).run();
    pendingCount++;
  }
  return json({ createdSubjectId, pendingCount });
}
