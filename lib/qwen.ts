import { env } from "cloudflare:workers";

export type QwenContent = string | Array<
  { type: "text"; text: string } |
  { type: "image_url"; image_url: { url: string; detail?: "high" } }
>;
export type QwenMessage = { role: "system" | "user" | "assistant"; content: QwenContent };

export function qwenKey() {
  return (env as { DASHSCOPE_API_KEY?: string }).DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY;
}

export function qwenWorkspaceId() {
  const id = (env as { DASHSCOPE_WORKSPACE_ID?: string }).DASHSCOPE_WORKSPACE_ID || process.env.DASHSCOPE_WORKSPACE_ID;
  return id && /^[A-Za-z0-9-]{3,100}$/.test(id) ? id : null;
}

export async function qwenChat(messages: QwenMessage[], options: {
  vision?: boolean;
  fast?: boolean;
  json?: boolean;
  quality?: "max" | "flash";
  model?: "qwen3-vl-flash";
  maxTokens?: number;
  timeoutMs?: number;
} = {}) {
  const key = qwenKey();
  if (!key) throw new Error("QWEN_API_KEY_MISSING");
  const workspaceId = qwenWorkspaceId();
  if (!workspaceId) throw new Error("QWEN_WORKSPACE_MISSING");
  const started=Date.now();
  let response:Response;
  try{response = await fetch("https://" + workspaceId + ".cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs || 60000),
    body: JSON.stringify({
      // Keep the working flash deployment as the default. Max is only used
      // when explicitly requested, since a workspace may not grant access.
      model: options.model || (options.quality === "max" ? "qwen3.8-max" : "qwen3.8-flash"),
      messages,
      max_tokens: options.maxTokens || 2400,
      enable_thinking: !options.fast && !options.json,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });}catch(error){
    if(options.vision)console.warn("qwen_vision_failed",{stage:"request",elapsedMs:Date.now()-started,errorType:error instanceof Error&&/^(TimeoutError|AbortError|TypeError)$/.test(error.name)?error.name:"other"});
    throw error;
  }
  const headersMs=Date.now()-started;
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("QWEN_AUTH_FAILED");
    if (response.status === 402) throw new Error("QWEN_BALANCE_EMPTY");
    if (response.status === 429) throw new Error("QWEN_BUSY");
    throw new Error("QWEN_UPSTREAM_ERROR");
  }
  let data:{ choices?: Array<{ message?: { content?: string } }> };
  try{data=await response.json();}catch(error){
    if(options.vision)console.warn("qwen_vision_failed",{stage:"response",headersMs,elapsedMs:Date.now()-started,errorType:error instanceof Error&&/^(TimeoutError|AbortError|SyntaxError)$/.test(error.name)?error.name:"other"});
    throw error;
  }
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("QWEN_EMPTY_RESPONSE");
  if(options.vision)console.info("qwen_vision_ready",{headersMs,elapsedMs:Date.now()-started});
  return content;
}

export function qwenPublicError(error: unknown, fallback: string) {
  const code = error instanceof Error ? error.message : "";
  if (code === "QWEN_API_KEY_MISSING") return "千问尚未配置百炼 API 密钥。";
  if (code === "QWEN_WORKSPACE_MISSING") return "千问尚未配置北京地域的百炼业务空间 ID。";
  if (code === "QWEN_AUTH_FAILED") return "当前千问模型访问被拒绝，请稍后重试或联系站点管理员。";
  if (code === "QWEN_BALANCE_EMPTY") return "百炼账户余额不足，请联系站点管理员。";
  if (code === "QWEN_BUSY") return "千问当前繁忙，请稍后再试。";
  return fallback;
}

export function parseQwenJson<T>(raw: string): T {
  return JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim()) as T;
}
