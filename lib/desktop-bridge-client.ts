// Credentials stay in this tab. Nothing is sent to the website's server.
export const DESKTOP_BRIDGE = "http://127.0.0.1:17863";
export type BridgeHealth = { version: string; ready: boolean; message?: string; backgroundMessage?: string; backgroundStatus?: string; backgroundModelReady?: boolean; backgroundMaxRows?: number; backgroundPageSize?: number; capabilities: { chat: boolean; moments: boolean; deferredVoice?: boolean; backgroundChat?: boolean; backgroundVoice?: boolean; backgroundHistory?: boolean } };
export class BridgeError extends Error { constructor(message: string, public status=0, public code="") { super(message); } }
export async function bridgeRequest<T>(path: string, options: { token?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  if (!/^\/(?:health|session|pair(?:\/handoff)?|contacts\/search|capture|jobs\/[a-zA-Z0-9_-]+(?:\/cancel)?)$/.test(path)) throw Error("采集请求地址无效。");
  if (typeof window !== "undefined" && !window.isSecureContext) throw Error("连接本机助手需要 HTTPS 网页，请从正式网站打开采集页。");
  const controller = new AbortController(), abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort(); else options.signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Number.isFinite(options.timeoutMs) ? Math.min(60000, Math.max(1000, options.timeoutMs!)) : 12000);
  let response: Response;
  try {
    const request: RequestInit & { targetAddressSpace?: "loopback" } = {
      method: options.body === undefined ? "GET" : "POST", mode: "cors", credentials: "omit", cache: "no-store", redirect: "error",
      targetAddressSpace: "loopback",
      headers: { ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.token ? { Authorization: "Bearer " + options.token } : {}) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    };
    response = await fetch(DESKTOP_BRIDGE + path, request);
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result)) throw Error("采集助手返回了无法识别的数据，请更新或重新启动助手。");
    if (!response.ok) {
      const detail = (result as { error?: unknown }).error;
      const message = typeof detail === "string" ? detail : detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as { message?: unknown }).message : undefined;
      const code = detail && typeof detail === "object" ? (detail as {code?:unknown}).code : "";
      throw new BridgeError(typeof message === "string" && message.trim() ? message.trim().slice(0, 1000) : "采集助手暂未完成请求，请检查本机窗口。", response.status, typeof code === "string" ? code : "");
    }
    return result as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (timedOut) throw Error("连接本机采集助手超时。请确认助手仍在运行，再点击连接；也可使用窗口采集。");
    if (error instanceof TypeError || error instanceof DOMException) throw Error("未能连接本机助手。请先启动助手，并允许浏览器的「本机／本地网络访问」权限；若此前拒绝，可在本站的网站设置中重新允许。Mac 还需检查系统的本地网络权限。也可改用窗口采集。");
    if (error instanceof SyntaxError) throw Error("采集助手返回的数据格式不正确，请更新或重新启动助手。");
    throw error;
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
