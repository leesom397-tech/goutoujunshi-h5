export async function classifyOpenAIError(response: Response, fallback: string) {
  let code = "";
  try {
    const data = await response.json() as { error?: { code?: string } };
    code = data.error?.code || "";
  } catch { /* Some upstream errors are not JSON. */ }
  if (code === "billing_not_active") return { error: "站点使用的 OpenAI 项目尚未启用 API 计费，请联系站点所有者。", status: 503 };
  if (code === "project_spend_limit_exceeded" || code === "organization_spend_limit_exceeded" || code === "organization_usage_limit_exceeded") {
    return { error: "站点的 API 用量额度已达到上限，请联系站点所有者。", status: 503 };
  }
  if (response.status === 401 || response.status === 403) return { error: "站点的 API 凭据暂不可用，请联系站点所有者。", status: 503 };
  if (response.status === 429) return { error: "当前请求较多，请稍后重试。", status: 429 };
  return { error: fallback, status: 502 };
}
