// Operator-only signed echo against the deployed callback. No customer data or messages.
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../outputs/wechat-callback-private.html", import.meta.url), "utf8");
const match = html.match(/<script[^>]*id="setup-data"[^>]*>([\s\S]*?)<\/script>/);
if (!match) throw Error("LOCAL_SETUP_NOT_FOUND");
const config = JSON.parse(match[1]);
const corpId = config.WECHAT_CORP_ID;
const token = config.WECHAT_CALLBACK_TOKEN;
const encodedKey = config.WECHAT_ENCODING_AES_KEY;
if (!/^ww[a-zA-Z0-9]{16,30}$/.test(corpId || "") || !token || !/^[A-Za-z0-9]{43}$/.test(encodedKey || "")) {
  throw Error("LOCAL_CALLBACK_CONFIGURATION_MISSING");
}

const echo = "lovetalk-callback-" + randomBytes(12).toString("hex");
const body = Buffer.from(echo);
const length = Buffer.alloc(4);
length.writeUInt32BE(body.length);
const plain = Buffer.concat([randomBytes(16), length, body, Buffer.from(corpId)]);
const padding = 32 - plain.length % 32;
const key = Buffer.from(encodedKey + "=", "base64");
const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
cipher.setAutoPadding(false);
const encrypted = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.alloc(padding, padding)])), cipher.final()]).toString("base64");
const timestamp = String(Math.floor(Date.now() / 1000));
const nonce = randomBytes(12).toString("hex");
const signature = createHash("sha1").update([token, timestamp, nonce, encrypted].sort().join("")).digest("hex");
const url = new URL("https://coach.lovetalk.love/api/wechat/callback");
url.search = new URLSearchParams({ msg_signature: signature, timestamp, nonce, echostr: encrypted }).toString();

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  const answer = await response.text();
  const matched = response.status === 200 && answer === echo;
  console.log(JSON.stringify({ httpStatus: response.status, status: matched ? "ok" : "echo_mismatch", customerReads: 0, wechatReplies: 0 }));
  if (!matched) process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ status: "callback_probe_unavailable", customerReads: 0, wechatReplies: 0 }));
  process.exitCode = 1;
}
