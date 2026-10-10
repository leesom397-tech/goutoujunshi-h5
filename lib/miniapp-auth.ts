import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { isWebApi, webOwner } from "@/lib/request-identity.mjs";

type MiniappEnv = { MINIAPP_APPID?: string; MINIAPP_APPSECRET?: string };
type WechatSession = { openid?: unknown; errcode?: unknown };
const codePattern = /^[A-Za-z0-9_-]{8,256}$/;
const tokenPattern = /^[a-f0-9]{64}$/;
const expiry = 7 * 24 * 60 * 60 * 1000;

export function miniappConfigured() {
  const settings = env as MiniappEnv;
  return !!(settings.MINIAPP_APPID && settings.MINIAPP_APPSECRET);
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function exchangeWxCode(code: unknown): Promise<string | null> {
  if (typeof code !== "string" || !codePattern.test(code)) return null;
  const settings = env as MiniappEnv;
  if (!settings.MINIAPP_APPID || !settings.MINIAPP_APPSECRET) throw new Error("MINIAPP_UNCONFIGURED");
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", settings.MINIAPP_APPID);
  url.searchParams.set("secret", settings.MINIAPP_APPSECRET);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");
  let response: Response;
  try {
    response = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
  } catch (error) {
    throw new Error(error instanceof Error && error.name === "TimeoutError" ? "MINIAPP_WECHAT_TIMEOUT" : "MINIAPP_WECHAT_NETWORK");
  }
  if (!response.ok) throw new Error("MINIAPP_WECHAT_HTTP_" + response.status);
  const result = await response.json() as WechatSession;
  if (result.errcode || typeof result.openid !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(result.openid)) return null;
  // session_key and UnionID are deliberately not stored or sent to the client.
  return result.openid;
}

export async function miniappOwner(request: Request): Promise<{ ownerId: string; openId: string | null } | null> {
  if (isWebApi(request)) return webOwner(request, env);
  if (!miniappConfigured()) return null;
  const header = request.headers.get("authorization") || "";
  const token = /^Bearer ([a-f0-9]{64})$/.exec(header)?.[1];
  if (!token || !tokenPattern.test(token)) return null;
  const hash = await sha256(token);
  const row = await getD1().prepare(
    "SELECT l.owner_id, s.open_id FROM coach_miniapp_sessions s JOIN coach_miniapp_links l ON l.open_id=s.open_id WHERE s.token_hash=? AND s.expires_at>?"
  ).bind(hash, Date.now()).first<{ owner_id: string; open_id: string }>();
  return row?.owner_id ? { ownerId: row.owner_id, openId: row.open_id } : null;
}

export async function revokeMiniappSession(request: Request) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) return;
  await getD1().prepare("DELETE FROM coach_miniapp_sessions WHERE token_hash=?").bind(await sha256(token)).run();
}

export async function issueMiniappSession(openId: string) {
  const token = randomToken();
  const now = Date.now();
  await getD1().prepare("INSERT INTO coach_miniapp_sessions (token_hash,open_id,expires_at,created_at) VALUES (?,?,?,?)")
    .bind(await sha256(token), openId, now + expiry, now).run();
  return { token, expiresAt: now + expiry };
}
