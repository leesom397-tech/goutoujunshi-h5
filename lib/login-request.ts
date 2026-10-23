export type LoginFailure = "timeout" | "network" | "server" | "credentials" | "rate-limit" | "cancelled" | "busy" | "invalid-response";
export class LoginRequestError extends Error {
  constructor(public code: LoginFailure, message: string) { super(message); this.name = "LoginRequestError"; }
}
const cancelled = () => new LoginRequestError("cancelled", "登录已取消。");

/** One user submission, one bounded request. Credentials are never persisted. */
export function createLoginRequest({ fetcher = fetch, timeoutMs = 20_000 }: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {
  let current: AbortController | null = null;
  return {
    cancel() { current?.abort(); },
    async submit(username: string, password: string): Promise<void> {
      if (current) throw new LoginRequestError("busy", "正在登录，请稍候。");
      const controller = new AbortController(); current = controller;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout>;
      let abort: () => void;
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => reject(timedOut ? new LoginRequestError("timeout", "登录请求超时，请稍后重试。") : cancelled());
        controller.signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      });
      const request = async () => {
        let response: Response;
        try {
          response = await fetcher("/api/auth/login", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }), signal: controller.signal,
            credentials: "same-origin", cache: "no-store", redirect: "error",
          });
        } catch {
          if (controller.signal.aborted) throw cancelled();
          throw new LoginRequestError("network", "未能连接登录服务，请检查网络后重试。");
        }
        if (!response.ok) {
          if (response.status === 400) throw new LoginRequestError("credentials", "请填写有效的用户名和密码。");
          if (response.status === 401) throw new LoginRequestError("credentials", "账号或密码不正确，请重新输入。");
          if (response.status === 429) throw new LoginRequestError("rate-limit", "登录尝试较多，请稍后再试。");
          throw new LoginRequestError("server", "登录服务暂时不可用，请稍后重试。");
        }
        let result: unknown;
        try { result = await response.json(); }
        catch {
          if (controller.signal.aborted) throw cancelled();
          throw new LoginRequestError("invalid-response", "尚未确认登录结果，请稍后重试。");
        }
        if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) throw new LoginRequestError("invalid-response", "尚未确认登录结果，请稍后重试。");
      };
      try { await Promise.race([interrupted, request()]); }
      finally {
        clearTimeout(timer!); controller.signal.removeEventListener("abort", abort!);
        if (current === controller) current = null;
      }
    },
  };
}
