import { getChatGPTUser } from "@/app/chatgpt-auth";
import { COACH_RULES, MODE_RULES } from "@/lib/coach";
import { qwenChat, qwenKey, qwenPublicError } from "@/lib/qwen";
import { buildKnowledgeContext, type KnowledgeMode } from "@/lib/knowledge";
import { loadProfileContext } from "@/lib/profile-context";

export const runtime = "edge";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录后使用语音分析。" }, 401);
  if (!qwenKey()) return json({ error: "百炼 API 密钥尚未配置。" }, 503);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 12000) return json({ error: "语音问题过长。" }, 413);
  let body: { query?: unknown; mode?: unknown; subjectId?: unknown };
  try { body = await request.json(); } catch { return json({ error: "无法读取语音问题。" }, 400); }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query || query.length > 4000 || !["reply", "signal", "decision"].includes(String(body.mode))) return json({ error: "语音问题无效。" }, 400);
  if (body.subjectId != null && (typeof body.subjectId !== "string" || body.subjectId.length > 100)) return json({ error: "对象无效。" }, 400);
  const mode = body.mode as KnowledgeMode;
  const knowledge = buildKnowledgeContext(query, mode);
  let profileContext = "";
  try { profileContext = await loadProfileContext(user.userId, body.subjectId as string | undefined); }
  catch { /* Voice analysis can continue without the saved profile. */ }
  try {
    const text = await qwenChat([
      { role: "system", content: COACH_RULES + "\n" + MODE_RULES[mode] + "\n\n" + knowledge.instructions + (profileContext ? "\n\n" + profileContext : "") + "\n这是语音通话中的后台分析。只返回一条核心判断、一条最有力的依据和一个下一步，合计尽量不超过 130 个汉字。未知处明确说未知，不用 Markdown。" },
      { role: "user", content: query },
    ], { fast: true, maxTokens: 550, timeoutMs: 30000 });
    return json({ text });
  } catch (error) { return json({ error: qwenPublicError(error, "千问语音分析暂时不可用。") }, 502); }
}
