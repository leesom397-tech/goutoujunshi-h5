import { env } from "cloudflare:workers";
import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

type WechatEnv = {
  WECHAT_CORP_ID?: string;
  WECHAT_KF_SECRET?: string;
  WECHAT_CALLBACK_TOKEN?: string;
  WECHAT_ENCODING_AES_KEY?: string;
  WECHAT_KF_ID?: string;
  WECHAT_KF_URL?: string;
};
const config = () => env as WechatEnv;
const apiBase = "https://qyapi.weixin.qq.com/cgi-bin/";
let cachedToken: { value: string; expiresAt: number } | null = null;

// First-time URL verification happens BEFORE WeChat issues the API Secret.
export function wechatCallbackConfigured() {
  const c = config();
  return !!(c.WECHAT_CORP_ID && c.WECHAT_CALLBACK_TOKEN && c.WECHAT_ENCODING_AES_KEY);
}

export function wechatConfigured() {
  const c = config();
  return wechatCallbackConfigured() && !!(c.WECHAT_KF_SECRET && c.WECHAT_KF_ID);
}

export function wechatPublicConfig() {
  const c = config();
  return {
    configured: wechatConfigured(),
    kfUrl: c.WECHAT_KF_URL && /^https:\/\//.test(c.WECHAT_KF_URL) ? c.WECHAT_KF_URL : null,
  };
}

export function sha1(input: string) {
  return createHash("sha1").update(input).digest("hex");
}

export function verifyAndDecrypt(signature: string, timestamp: string, nonce: string, encrypted: string) {
  const c = config();
  if (!c.WECHAT_CALLBACK_TOKEN || !c.WECHAT_ENCODING_AES_KEY || !c.WECHAT_CORP_ID) throw new Error("WECHAT_NOT_CONFIGURED");
  if (!/^\d{10,13}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 600) throw new Error("WECHAT_EXPIRED");
  if (!/^[A-Za-z0-9]{1,128}$/.test(nonce) || !/^[A-Za-z0-9+/=]+$/.test(encrypted)) throw new Error("WECHAT_INVALID");
  const expected = sha1([c.WECHAT_CALLBACK_TOKEN, timestamp, nonce, encrypted].sort().join(""));
  if (!/^[a-f0-9]{40}$/i.test(signature) || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature.toLowerCase()))) throw new Error("WECHAT_SIGNATURE");
  const key = Buffer.from(c.WECHAT_ENCODING_AES_KEY + "=", "base64");
  if (key.length !== 32) throw new Error("WECHAT_KEY");
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
  const padding = plaintext[plaintext.length - 1];
  if (!padding || padding > 32 || !plaintext.subarray(plaintext.length - padding).every((byte) => byte === padding)) throw new Error("WECHAT_PADDING");
  const unpadded = plaintext.subarray(0, plaintext.length - padding);
  const length = unpadded.readUInt32BE(16);
  if (length > unpadded.length - 20) throw new Error("WECHAT_LENGTH");
  const receiver = unpadded.subarray(20 + length).toString("utf8");
  if (receiver !== c.WECHAT_CORP_ID) throw new Error("WECHAT_RECEIVER");
  return unpadded.subarray(20, 20 + length).toString("utf8");
}

export function xmlField(xml: string, field: string) {
  const match = xml.match(new RegExp("<" + field + ">(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/" + field + ">"));
  return match ? (match[1] ?? match[2] ?? "") : "";
}

async function accessToken() {
  const c = config();
  if (!c.WECHAT_CORP_ID || !c.WECHAT_KF_SECRET) throw new Error("WECHAT_NOT_CONFIGURED");
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const url = apiBase + "gettoken?corpid=" + encodeURIComponent(c.WECHAT_CORP_ID) + "&corpsecret=" + encodeURIComponent(c.WECHAT_KF_SECRET);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await response.json() as { errcode?: number; access_token?: string; expires_in?: number };
  if (!response.ok || data.errcode !== 0 || !data.access_token) {
    const code=Number.isInteger(data.errcode)?data.errcode!:-1;
    console.warn("WeChat token rejected",{httpStatus:response.status,errcode:code});
    throw new WechatSendRejected(code,response.status);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + Math.max(60, (data.expires_in || 7200) - 300) * 1000 };
  return cachedToken.value;
}

// Read-only production check. Never return an access token, account ID, name,
// customer identifier or message content to the diagnostic caller.
export async function wechatAccountHealth() {
  const selected = config().WECHAT_KF_ID;
  if (!selected) throw new Error("WECHAT_NOT_CONFIGURED");
  const token = await accessToken();
  let accountCount = 0;
  let configuredAccountPresent = false;
  for (let offset = 0; offset < 1000; offset += 100) {
    const response = await fetch(apiBase + "kf/account/list?access_token=" + encodeURIComponent(token), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset, limit: 100 }), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json() as { errcode?: number; account_list?: Array<{ open_kfid?: string }> };
    if (!response.ok || data.errcode !== 0 || !Array.isArray(data.account_list)) throw new Error("WECHAT_ACCOUNT_LIST_FAILED");
    accountCount += data.account_list.length;
    if (data.account_list.some(account => account.open_kfid === selected)) configuredAccountPresent = true;
    if (data.account_list.length < 100) return { accountCount, configuredAccountPresent };
  }
  throw new Error("WECHAT_ACCOUNT_LIST_TOO_LARGE");
}

export type Incoming = {
  msgid: string;
  open_kfid: string;
  external_userid: string;
  origin: number;
  msgtype: string;
  send_time?: number;
  text?: { content?: string };
  image?: { media_id?: string };
  voice?: { media_id?: string };
  merged_msg?: { title?: string; item?: Array<{ sender_name?: string; msgtype?: string; msg_content?: string | Record<string, unknown>; send_time?: number }> };
};

export async function syncMessages(token: string, cursor: string, openKfId: string) {
  const response = await fetch(apiBase + "kf/sync_msg?access_token=" + encodeURIComponent(await accessToken()), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token:token||undefined, cursor: cursor || undefined, open_kfid: openKfId, voice_format: 0, limit: 100 }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json() as { errcode?: number; next_cursor?: string; has_more?: number; msg_list?: Incoming[] };
  if (!response.ok || data.errcode !== 0) throw new Error("WECHAT_SYNC");
  return data;
}

export class WechatSendUncertain extends Error {}
export class WechatSendRejected extends Error {
  constructor(public readonly code: number, public readonly httpStatus: number) { super("WECHAT_SEND_REJECTED"); }
}
export class WechatMediaUploadRejected extends Error {
  constructor(public readonly code: number, public readonly httpStatus: number) { super("WECHAT_IMAGE_UPLOAD_REJECTED"); }
}
async function sendMessage(body:Record<string,unknown>){
  const token=await accessToken();
  let response:Response,data:{errcode?:number};
  try{
    response=await fetch(apiBase+"kf/send_msg?access_token="+encodeURIComponent(token),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    data=await response.json() as {errcode?:number};
  }catch{throw new WechatSendUncertain("WECHAT_SEND_OUTCOME_UNKNOWN");}
  if(response.status>=500)throw new WechatSendUncertain("WECHAT_SEND_OUTCOME_UNKNOWN");
  if(!response.ok||data.errcode!==0){
    const code=Number.isInteger(data.errcode)?data.errcode!:-1;
    console.warn("WeChat send rejected",{httpStatus:response.status,errcode:code});
    throw new WechatSendRejected(code,response.status);
  }
}
export async function sendWechatText(to:string,openKfId:string,text:string){
  const encoder=new TextEncoder();let content=text.trim();
  while(encoder.encode(content).length>1900)content=content.slice(0,-1);
  await sendMessage({touser:to,open_kfid:openKfId,msgtype:"text",text:{content}});
}
export async function sendWechatImage(to:string,openKfId:string,mediaId:string){
  await sendMessage({touser:to,open_kfid:openKfId,msgtype:"image",image:{media_id:mediaId}});
}
export function imageMultipart(bytes:Uint8Array,boundary:string){
  if(!/^[A-Za-z0-9-]{16,80}$/.test(boundary)||!bytes.length)throw Error("WECHAT_IMAGE_MULTIPART_INVALID");
  const enc=new TextEncoder();
  const start=enc.encode("--"+boundary+"\r\nContent-Disposition: form-data; name=\"media\"; filename=\"chat-analysis.jpg\"; filelength="+bytes.length+"\r\nContent-Type: image/jpeg\r\n\r\n");
  const end=enc.encode("\r\n--"+boundary+"--\r\n");
  const body=new Uint8Array(start.length+bytes.length+end.length);
  body.set(start);body.set(bytes,start.length);body.set(end,start.length+bytes.length);
  return body;
}
export async function uploadWechatImage(bytes:Uint8Array){
  if(bytes.length>2000000)throw Error("WECHAT_IMAGE_SIZE");
  const boundary="lovetalk-"+crypto.randomUUID().replace(/-/g,"");
  const body=imageMultipart(bytes,boundary);
  const response=await fetch(apiBase+"media/upload?access_token="+encodeURIComponent(await accessToken())+"&type=image",{method:"POST",headers:{"Content-Type":"multipart/form-data; boundary="+boundary},body,signal:AbortSignal.timeout(15000)});
  const data=await response.json() as {media_id?:string;errcode?:number};
  if(!response.ok||data.errcode && data.errcode!==0||!data.media_id)throw new WechatMediaUploadRejected(Number.isInteger(data.errcode)?data.errcode!:-1,response.status);
  return data.media_id;
}

export async function getWechatMedia(mediaId: string, maxBytes: number, signal?:AbortSignal) {
  if (!mediaId || mediaId.length > 512) throw new Error("WECHAT_MEDIA_ID");
  const response = await fetch(apiBase + "media/get?access_token=" + encodeURIComponent(await accessToken()) + "&media_id=" + encodeURIComponent(mediaId), {
    signal: signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),
  });
  if (!response.ok || response.headers.get("content-type")?.includes("application/json")) throw new Error("WECHAT_MEDIA");
  if (Number(response.headers.get("content-length") || 0) > maxBytes) throw new Error("WECHAT_MEDIA_SIZE");
  if (!response.body) throw new Error("WECHAT_MEDIA_EMPTY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("WECHAT_MEDIA_SIZE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, mime: response.headers.get("content-type") || "application/octet-stream" };
}
