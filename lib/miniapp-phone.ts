import { env } from "cloudflare:workers";

type PhoneEnv = { MINIAPP_APPID?: string; MINIAPP_APPSECRET?: string };
type TokenReply = { errcode?: number; access_token?: string; expires_in?: number };
type PhoneReply = { errcode?: number; phone_info?: { purePhoneNumber?: string; countryCode?: string; watermark?: { appid?: string } } };
const codePattern = /^[A-Za-z0-9_-]{8,256}$/;
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken() {
  const settings = env as PhoneEnv;
  if (!settings.MINIAPP_APPID || !settings.MINIAPP_APPSECRET) throw new Error("MINIAPP_PHONE_UNCONFIGURED");
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", settings.MINIAPP_APPID);
  url.searchParams.set("secret", settings.MINIAPP_APPSECRET);
  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("MINIAPP_PHONE_TOKEN_HTTP");
  const result = await response.json() as TokenReply;
  if (result.errcode || !result.access_token) throw new Error("MINIAPP_PHONE_TOKEN_REJECTED");
  cachedToken = { value: result.access_token, expiresAt: Date.now() + Math.max(60, (result.expires_in || 7200) - 300) * 1000 };
  return cachedToken.value;
}

export async function verifyMiniappPhone(code: unknown): Promise<string> {
  if (typeof code !== "string" || !codePattern.test(code)) throw new Error("MINIAPP_PHONE_CODE_INVALID");
  const settings = env as PhoneEnv;
  const token = await accessToken();
  const response = await fetch("https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=" + encodeURIComponent(token), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("MINIAPP_PHONE_HTTP");
  const result = await response.json() as PhoneReply;
  if (result.errcode || !result.phone_info) throw new Error("MINIAPP_PHONE_REJECTED");
  const info = result.phone_info;
  if (info.watermark?.appid !== settings.MINIAPP_APPID || !/^\d{6,15}$/.test(info.purePhoneNumber || "") || !/^\d{1,4}$/.test(info.countryCode || "")) {
    throw new Error("MINIAPP_PHONE_MISMATCH");
  }
  // Never persist or return the complete phone number.
  return info.purePhoneNumber!.slice(-4);
}
