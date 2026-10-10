const AUTH_ORIGIN = "https://ai.lovetalk.love";
const SESSION_COOKIE = "lt_next_session";
const noStore = { "Cache-Control": "no-store" };

function sameOriginPost(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

function sessionCookie(value: string, secure: boolean, clear = false): string {
  return `${SESSION_COOKIE}=${clear ? "" : value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 604800}${secure ? "; Secure" : ""}`;
}

export async function loveTalkLogin(request: Request): Promise<Response> {
  if (!sameOriginPost(request)) return Response.json({ error: "请求来源无效。" }, { status: 403, headers: noStore });
  if (Number(request.headers.get("content-length") || 0) > 4096) return Response.json({ error: "请求过大。" }, { status: 413, headers: noStore });

  let body: { username?: unknown; password?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "无法读取登录信息。" }, { status: 400, headers: noStore }); }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || username.length > 100 || !password || password.length > 256) {
    return Response.json({ error: "请填写 成子 手机号／用户名和密码。" }, { status: 400, headers: noStore });
  }

  try {
    const upstream = await fetch(`${AUTH_ORIGIN}/next/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: AUTH_ORIGIN },
      body: JSON.stringify({ username, password, agree: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const result = await upstream.json() as { logged_in?: unknown; user?: unknown; error?: unknown; message?: unknown };
    if (!upstream.ok || result.logged_in !== true || typeof result.user !== "string" || !result.user.trim()) {
      return Response.json({ error: typeof result.error === "string" ? result.error : "登录失败，请检查账号密码。" }, { status: upstream.status >= 400 ? upstream.status : 401, headers: noStore });
    }
    const setCookie = upstream.headers.get("set-cookie") || "";
    const session = /(?:^|,\s*)lt_next_session=([A-Za-z0-9_-]{20,128})(?:;|$)/.exec(setCookie)?.[1];
    if (!session) return Response.json({ error: "成子 登录会话未建立，请稍后重试。" }, { status: 502, headers: noStore });
    const headers = new Headers(noStore);
    headers.set("Set-Cookie", sessionCookie(session, new URL(request.url).protocol === "https:"));
    return Response.json({ ok: true, user: result.user.trim() }, { headers });
  } catch {
    return Response.json({ error: "暂时无法连接 成子 登录服务。" }, { status: 502, headers: noStore });
  }
}

export async function loveTalkLogout(request: Request): Promise<Response> {
  if (!sameOriginPost(request)) return Response.json({ error: "请求来源无效。" }, { status: 403, headers: noStore });
  const cookie = request.headers.get("cookie") || "";
  const session = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(SESSION_COOKIE + "="))?.slice(SESSION_COOKIE.length + 1);
  try {
    if (session && /^[A-Za-z0-9_-]{20,128}$/.test(session)) {
      await fetch(`${AUTH_ORIGIN}/next/api/logout`, {
        method: "POST", headers: { Cookie: `${SESSION_COOKIE}=${session}`, Origin: AUTH_ORIGIN },
        cache: "no-store", signal: AbortSignal.timeout(8000),
      });
    }
  } catch { /* Clear the local cookie even if the upstream is temporarily unavailable. */ }
  const headers = new Headers(noStore);
  headers.set("Set-Cookie", sessionCookie("", new URL(request.url).protocol === "https:", true));
  return Response.json({ ok: true }, { headers });
}
