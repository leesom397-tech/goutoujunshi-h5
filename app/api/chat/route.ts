import { getChatGPTUser } from "@/app/chatgpt-auth";
import { COACH_RULES, MODE_RULES } from "@/lib/coach";
import { buildKnowledgeContext } from "@/lib/knowledge";
import { loadProfileContext } from "@/lib/profile-context";
import { parseQwenJson, qwenChat, qwenKey, qwenPublicError, type QwenContent, type QwenMessage } from "@/lib/qwen";
import { parseReplyPaths } from "@/lib/reply-paths";

export const runtime = "edge";
type Mode = keyof typeof MODE_RULES;
type Turn = { role: "user" | "assistant"; text: string; image?: string };
type ReplyResult = { summary?: unknown; options?: unknown };
const replyLabels = ["稳妥", "主动", "设边界"] as const;
const noStore = { "Cache-Control": "no-store" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: noStore });

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录后使用智能分析。" }, 401);
  if (!qwenKey()) return json({ error: "智能分析还未开通。站点所有者需要配置百炼 API 密钥。" }, 503);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "请求格式不正确。" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 8_000_000) return json({ error: "图片过大，请换一张小图。" }, 413);
  let body: { mode?: Mode; turns?: Turn[]; subjectId?: string | null };
  try { body = await request.json(); } catch { return json({ error: "无法读取消息。" }, 400); }
  if (!body.mode || !(body.mode in MODE_RULES) || !Array.isArray(body.turns) || body.turns.length < 1 || body.turns.length > 10) {
    return json({ error: "请先描述你的情况。" }, 400);
  }
  const messages: QwenMessage[] = [];
  let hasImage = false;
  for (const turn of body.turns) {
    if (!turn || !["user", "assistant"].includes(turn.role) || typeof turn.text !== "string" || turn.text.length > 4000) {
      return json({ error: "消息过长或格式不正确。" }, 400);
    }
    const content: QwenContent = [{ type: "text", text: turn.text }];
    if (turn.image) {
      if (turn.role !== "user" || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(turn.image) || turn.image.length > 7_000_000) {
        return json({ error: "图片格式不支持或过大。" }, 400);
      }
      content.push({ type: "image_url", image_url: { url: turn.image, detail: "high" } });
      hasImage = true;
    }
    messages.push({ role: turn.role, content });
  }
  const recentQuestion = body.turns.filter((turn) => turn.role === "user").slice(-2).map((turn) => turn.text).join("\n");
  const knowledge = buildKnowledgeContext(recentQuestion, body.mode);
  if (typeof body.subjectId === "string" && body.subjectId.length > 100) return json({ error: "对象无效。" }, 400);
  let profileContext = "";
  try { profileContext = await loadProfileContext(user.userId, body.subjectId, recentQuestion); }
  catch { /* Analysis can continue without saved context if storage is unavailable. */ }
  messages.unshift({
    role: "system",
    content: COACH_RULES + "\n" + MODE_RULES[body.mode] + "\n\n" + knowledge.instructions + (profileContext ? "\n\n" + profileContext : "") + (body.mode === "reply" ? "\n\n仅返回 JSON 对象：{summary:string,options:[{text:string,when:string},{text:string,when:string},{text:string,when:string}]}。summary 用不超过 160 字说明当前判断与关键未知。若用户提供了对方可辨认的原话或足够明确的情境与表达意图，按顺序给 3 条可直接发送的独立回复：稳妥、主动、设边界。每条 text 尽量短、自然、不油腻，不编造共同经历、承诺或对方动机；when 用一句话说明适用情境与取舍。不得给操控、施压或违背用户真实意愿的话术。若缺少对方原话、关系目标不清，或涉及暴力胁迫等不宜生成发信话术的情境，options 返回空数组，summary 提一个最关键的澄清问题或安全建议。不要输出 Markdown。" : ""),
  });
  if (body.mode === "reply") messages.push({ role: "system", content: "每个 options 元素再提供 next:{positive:string,unclear:string,stop:string}。这三项分别是在对方积极接话、含糊或暂未回应、拒绝或不适时，用户可以如何应对，每项不超过 45 汉字，贴合该回复，不能预测对方一定如此。拒绝分支必须尊重停止；不把沉默当同意，不建议连续追问。若用户是在发送前检查自己的草稿，summary 先指出草稿的主要沟通影响，再给三个符合真实意图的改写。" });
  try {
    if (body.mode === "reply") {
      const raw = await qwenChat(messages, { vision: hasImage, fast: true, json: true, quality: "flash", maxTokens: 2400, timeoutMs: 60000 });
      const result = parseQwenJson<ReplyResult>(raw);
      const summary = typeof result.summary === "string" ? result.summary.trim().slice(0, 500) : "";
      if (!summary) throw new Error("QWEN_REPLY_FORMAT_INVALID");
      const candidates = Array.isArray(result.options) ? result.options : [];
      const replyOptions = candidates.length === 3 ? candidates.map((item, index) => {
        const option = item && typeof item === "object" ? item as { text?: unknown; when?: unknown; next?: unknown } : {};
        return { label: replyLabels[index], text: typeof option.text === "string" ? option.text.trim().slice(0, 240) : "", when: typeof option.when === "string" ? option.when.trim().slice(0, 150) : "", next: parseReplyPaths(option.next) };
      }).filter((item) => item.text) : [];
      const completeOptions = replyOptions.length === 3 ? replyOptions : [];
      const text = summary + (completeOptions.length ? "\n\n" + completeOptions.map((item) => item.label + "：" + item.text).join("\n") : "");
      return json({ text, displayText: summary, replyOptions: completeOptions, knowledgeSources: knowledge.sources });
    }
    const text = await qwenChat(messages, { vision: hasImage, fast: true, quality: "flash", maxTokens: 2400, timeoutMs: 60000 });
    return json({ text, knowledgeSources: knowledge.sources });
  } catch (error) {
    return json({ error: qwenPublicError(error, body.mode === "reply" ? "没能整理出可靠的话术，请补充对方原话后重试。" : "连接智能分析服务失败，请稍后重试。") }, 502);
  }
}
