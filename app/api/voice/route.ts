import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { qwenKey, qwenWorkspaceId } from "@/lib/qwen";

export const runtime = "edge";
const noStore = { "Cache-Control": "no-store" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: noStore });

function selection(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const subjectId = url.searchParams.get("subjectId");
  return { mode: mode === "signal" || mode === "decision" ? mode : "reply", subjectId };
}

// Session policy is returned only to an authenticated user; the API key is never sent to the browser.
export async function GET(request: Request) {
  if (!await getChatGPTUser()) return json({ error: "请先登录后使用语音。" }, 401);
  if (!qwenKey()) return json({ error: "双工语音尚未开通：站点所有者需要配置阿里云百炼 API 密钥。" }, 503);
  if (!qwenWorkspaceId()) return json({ error: "双工语音尚未配置百炼业务空间 ID。" }, 503);
  const { subjectId } = selection(request);
  if (subjectId && subjectId.length > 100) return json({ error: "对象无效。" }, 400);
  const voiceId = (env as { QWEN_VOICE_ID?: string }).QWEN_VOICE_ID || process.env.QWEN_VOICE_ID;
  return json({
    session: {
      modalities: ["text", "audio"],
      voice: voiceId || "longanqian_v3.1",
      input_audio_transcription: { language: "zh" },
      output_audio: { language: "zh" },
      turn_detection: { type: "smart_turn" },
      instructions: [
        "你是 成子 的实时中文语音助手。像认真倾听的关系顾问一样自然交流，语气温暖、清醒、直接。用户可以随时打断或纠正你。你是 AI，不要假装是声音原主本人。",
        "普通寒暄、共情、澄清和对刚听到内容的简单追问，直接回应，不要为了每句话调用工具。不要固定说‘我听到了’或‘我结合情况想一下’。",
        "只有用户需要调用过往关系档案、分析较长聊天或多轮事件、判断对象适配、制定重要推进或退出策略时，才调用 analyze_relationship。需要个人历史而工具未返回时，不要假装记得。",
        "每轮先说最关键的一点，通常两三句即可；需要时只问一个关键问题。不要念报告、罗列三套方案或反复总结用户原话。对方动机未知时说明不确定，尊重边界和拒绝。",
        "调用工具后，用自然口语转述一条判断、一条理由和一个下一步；不要逐字朗读工具结果，也不要加上工具没有证据支持的结论。工具失败时说明暂时无法查证，继续陪用户澄清事实。",
      ].join("\n"),
      tools: [{
        type: "function",
        function: {
          name: "analyze_relationship",
          description: "在需要过往档案、较长关系事件、对象适配或重要关系决策时调用。普通接话与简单追问直接回答，不必调用。由千问文本模型结合知识库和用户确认的档案分析。",
          parameters: {
            type: "object",
            properties: { query: { type: "string", description: "用户刚说的完整问题及关键事实，中文，勿杜撰。" } },
            required: ["query"],
          },
        },
      }],
    },
  });
}

export async function POST(request: Request) {
  if (!await getChatGPTUser()) return json({ error: "请先登录后使用语音。" }, 401);
  const key = qwenKey();
  if (!key) return json({ error: "双工语音尚未开通：站点所有者需要配置阿里云百炼 API 密钥。" }, 503);
  const { subjectId } = selection(request);
  if (subjectId && subjectId.length > 100) return json({ error: "对象无效。" }, 400);
  if (!request.headers.get("content-type")?.includes("application/sdp")) return json({ error: "语音请求格式不正确。" }, 415);
  const sdp = await request.text();
  if (!sdp || sdp.length > 200_000 || !sdp.includes("m=audio")) return json({ error: "语音连接请求无效。" }, 400);
  const workspaceId = qwenWorkspaceId();
  if (!workspaceId) return json({ error: "双工语音尚未配置百炼业务空间 ID。" }, 503);
  const endpoint = "https://" + workspaceId + ".cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen-audio-3.1-realtime-plus";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/sdp" },
      body: sdp,
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return json({ error: "百炼密钥或业务空间配置无效。" }, 502);
      return json({ error: "千问语音服务暂时无法建立连接，请稍后重试。" }, 502);
    }
    return new Response(await response.text(), { headers: { "Content-Type": "application/sdp", ...noStore } });
  } catch { return json({ error: "千问语音连接超时，请稍后重试。" }, 502); }
}
