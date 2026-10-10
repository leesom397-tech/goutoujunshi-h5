import { getChatGPTUser } from "@/app/chatgpt-auth";
import { COACH_RULES } from "@/lib/coach";
import { buildKnowledgeContext } from "@/lib/knowledge";
import { loadProfileContext } from "@/lib/profile-context";
import { parseQwenJson, qwenChat, qwenKey, qwenPublicError } from "@/lib/qwen";

export const runtime = "edge";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
type Recap = { assessment: string; known: string; unknown: string; nextStep: string };

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录后使用通话总结。" }, 401);
  if (!qwenKey()) return json({ error: "智能分析尚未开通。" }, 503);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 18000) return json({ error: "通话内容过长。" }, 413);
  let body: { turns?: Array<{ role?: unknown; text?: unknown }>; subjectId?: unknown };
  try { body = await request.json(); } catch { return json({ error: "无法读取通话内容。" }, 400); }
  if (body.subjectId != null && (typeof body.subjectId !== "string" || body.subjectId.length > 100)) return json({ error: "对象无效。" }, 400);
  if (!Array.isArray(body.turns) || !body.turns.length || body.turns.length > 36) return json({ error: "通话内容不足，暂时无法总结。" }, 400);
  const turns: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const turn of body.turns) {
    if (!turn || !["user", "assistant"].includes(String(turn.role)) || typeof turn.text !== "string" || turn.text.length > 1000) return json({ error: "通话内容格式不正确。" }, 400);
    if (turn.text.trim()) turns.push({ role: turn.role as "user" | "assistant", text: turn.text.trim() });
  }
  if (!turns.some((turn) => turn.role === "user" && turn.text.length >= 8)) return json({ error: "通话内容不足，暂时无法总结。" }, 400);
  const transcript = turns.map((turn) => (turn.role === "user" ? "用户：" : "助手：") + turn.text).join("\n").slice(0, 12000);
  const knowledge = buildKnowledgeContext(turns.filter((turn) => turn.role === "user").map((turn) => turn.text).join("\n").slice(-3500), "decision");
  let profileContext = "";
  try { profileContext = await loadProfileContext(user.userId, body.subjectId as string | undefined, turns.filter(turn => turn.role === "user").map(turn => turn.text).join("\n").slice(-500)); }
  catch { /* A call recap is still useful without saved context. */ }
  try {
    const raw = await qwenChat([
      { role: "system", content: COACH_RULES + "\n\n" + knowledge.instructions + (profileContext ? "\n\n" + profileContext : "") + "\n\n根据语音转写生成用户可回看的通话卡片。转写可能漏字或认错说话人，只把用户明确描述且不自相矛盾的内容写入 known；助手在通话中的说法不是事实证据。不得编造对方动机、承诺或已发生的结果。只返回 JSON：{assessment:string,known:string,unknown:string,nextStep:string}。各字段用简短自然中文；assessment 是暂定判断，unknown 是最关键的待验证点，nextStep 是一次具体、低压力且可退出的行动。若出现明确拒绝或安全风险，优先尊重边界和安全。" },
      { role: "user", content: transcript },
    ], { json: true, fast: true, maxTokens: 650, timeoutMs: 30000 });
    const result = parseQwenJson<Recap>(raw);
    const recap = {
      assessment: typeof result.assessment === "string" ? result.assessment.trim().slice(0, 240) : "",
      known: typeof result.known === "string" ? result.known.trim().slice(0, 240) : "",
      unknown: typeof result.unknown === "string" ? result.unknown.trim().slice(0, 240) : "",
      nextStep: typeof result.nextStep === "string" ? result.nextStep.trim().slice(0, 240) : "",
    };
    if (Object.values(recap).some((value) => !value)) throw new Error("QWEN_RECAP_FORMAT_INVALID");
    return json({ recap });
  } catch (error) { return json({ error: qwenPublicError(error, "这次通话暂时没能生成可靠的总结，请稍后再试。") }, 502); }
}
