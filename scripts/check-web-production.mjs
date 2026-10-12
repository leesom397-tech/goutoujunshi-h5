// Anonymous post-deploy checks only: no login, registration credentials, grants,
// model calls or production records. The sole POST has an empty invalid body.
import { mkdir, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

const base = "https://coach.lovetalk.love";
const hostname = new URL(base).hostname;
const output = "outputs/web-parity/production.json";
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw Error("TLS certificate verification must remain enabled.");
const results = [];
let fallbackAddress;
const escapeMessage = error => error instanceof Error ? `${error.message}${error.cause?.code ? ` (${error.cause.code})` : ""}` : String(error);
async function address() {
  if (!fallbackAddress) fallbackAddress = (async () => {
    const configured = process.env.CHENGZI_PRODUCTION_IP;
    if (configured) { if (!isIP(configured)) throw Error("CHENGZI_PRODUCTION_IP must be an IP address."); return configured; }
    // This override only resolves the exact project host. HTTPS still sends and
    // verifies that hostname; no certificate checks or global DNS are changed.
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    resolver.setServers(["1.1.1.1", "8.8.8.8"]);
    const addresses = await resolver.resolve4(hostname);
    if (!addresses.length) throw Error("No project-host DNS result.");
    return addresses[0];
  })();
  return fallbackAddress;
}
async function fallback(url, options) {
  const ip = await address();
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { method: options.method || "GET", servername: hostname, rejectUnauthorized: true,
      headers: { ...options.headers, "accept-encoding": "identity" },
      lookup(name, config, callback) { if (name !== hostname) { callback(Error("DNS override host rejected.")); return; } if (config.all) callback(null, [{ address: ip, family: isIP(ip) }]); else callback(null, ip, isIP(ip)); },
    }, response => {
      const chunks = []; let bytes = 0;
      response.on("data", chunk => { bytes += chunk.length; if (bytes > 3 * 1024 * 1024) request.destroy(Error("Unexpectedly large response.")); else chunks.push(chunk); });
      response.on("error", reject);
      response.on("end", () => { try { let body = Buffer.concat(chunks); if (response.headers["content-encoding"] === "br") body = brotliDecompressSync(body); if (response.headers["content-encoding"] === "gzip") body = gunzipSync(body); if (response.headers["content-encoding"] === "deflate") body = inflateSync(body); resolve({ status: response.statusCode, text: body.toString("utf8"), headers: response.headers, transport: "https-scoped-dns-override" }); } catch (error) { reject(error); } });
    });
    request.setTimeout(18000, () => request.destroy(Error("HTTPS request timed out.")));
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}
async function get(path, options = {}) {
  const url = new URL(path, base);
  if (url.origin !== base) throw Error("Only the deployed project origin can be checked.");
  const headers = { "cache-control": "no-cache", "user-agent": "Chengzi-Anonymous-Deployment-Check/1.0", ...options.headers };
  try {
    const response = await fetch(url, { ...options, headers, redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(18000) });
    return { status: response.status, text: await response.text(), headers: Object.fromEntries(response.headers), transport: "fetch" };
  } catch (error) {
    try { return await fallback(url, { ...options, headers }); }
    catch (fallbackError) { throw Error(`${escapeMessage(error)}; scoped fallback: ${escapeMessage(fallbackError)}`); }
  }
}
function decode(text) { return text.replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number))).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function visibleText(html) { return decode((/<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] || html).replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }
async function check(name, path, inspect, options) {
  try { const response = await get(path, options); const details = inspect(response); results.push({ name, path, passed: true, status: response.status, transport: response.transport, ...details }); }
  catch (error) { results.push({ name, path, passed: false, error: escapeMessage(error) }); }
}
function requireValue(condition, text) { if (!condition) throw Error(text); }

await Promise.all(["/workspace", "/register", "/login", "/sales", "/privacy", "/reports", "/voice"].map(path => check("public page branding", path, response => {
  requireValue(response.status === 200, `Expected 200, received ${response.status}.`);
  const title = decode(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(response.text)?.[1] || "").trim();
  requireValue(title === "成子关系决策智能体", `Unexpected title: ${title || "missing"}.`);
  const visible = visibleText(response.text);
  requireValue(visible.length > 30, "No meaningful page content.");
  requireValue(!/lovetalk/i.test(visible), "Visible previous branding found.");
  if (path === "/workspace") {
      requireValue(response.text.includes("data-knowledge-evidence"), "Knowledge evidence section missing.");
      requireValue(!response.text.includes('id="experience"'), "Homepage must not contain a full demo report.");
      requireValue(response.text.includes("data-feature-grid"), "Feature entry section missing.");
      requireValue(response.text.includes("cz-brand-mark"), "Relationship brand mark missing.");
  }
  return { title, visibleCharacters: visible.length, previousBrandVisible: false };
})));
await Promise.all(["/visuals/relationship-daylight.webp", "/visuals/conversation-daylight.webp", "/icon-192.png", "/images/aurora-fluted-light-v3.webp"].map(path => check("deployed visual asset", path, response => {
  requireValue(response.status === 200, `Expected image 200, received ${response.status}.`);
  requireValue(String(response.headers["content-type"]).startsWith("image/"), "Wrong image content type.");
  return { image: true };
}, { method: "HEAD" })));
await check("anonymous session", "/api/auth/session", response => { requireValue(response.status === 200, `Expected 200, received ${response.status}.`); const data = JSON.parse(response.text); requireValue(data.loggedIn === false, "Anonymous request appeared logged in."); return { loggedIn: false }; });
const randomTask = crypto.randomUUID();
await Promise.all(["/api/account/credits", "/api/account/admin/credits", "/api/web/profile", "/api/web/workspace", "/api/web/voice-live/status", `/api/web/screenshot/batch?taskId=${randomTask}`].map(path => check("anonymous request denied", path, response => { const expected = path === "/api/account/admin/credits" ? 403 : 401; requireValue(response.status === expected, `Expected ${expected}, received ${response.status}.`); return { unauthorized: true }; })));
await check("voice operator is private", "/api/wechat/process", response => { requireValue(response.status === 404, `Expected 404, received ${response.status}.`); return { unauthorized: true }; }, { method: "POST", headers: { "content-type": "application/json" }, body: '{"kind":"voice-brand-operator","action":"list"}' });
await check("cross-origin registration denied before writes", "/api/auth/register", response => {
  requireValue(response.status === 403, `Expected 403, received ${response.status}.`);
  requireValue(!String(response.headers["set-cookie"] || "").includes("cz_session="), "Cross-origin request unexpectedly issued a session.");
  return { crossOriginRejected: true, requestBody: "empty object; no valid credentials or registration consent" };
}, { method: "POST", headers: { "content-type": "application/json", origin: "https://example.invalid", "sec-fetch-site": "cross-site" }, body: "{}" });

await mkdir("outputs/web-parity", { recursive: true });
const failed = results.filter(result => !result.passed);
await writeFile(output, JSON.stringify({ checkedAt: new Date().toISOString(), base, anonymous: true, credentialsUsed: false, productionRecordsCreated: false, modelCallsMade: false, tlsVerification: true, results }, null, 2));
console.log(`${failed.length ? "FAIL" : "PASS"}: ${results.length - failed.length}/${results.length} anonymous production checks; ${output}`);
for (const result of failed) console.error(`${result.path}: ${result.error}`);
if (failed.length) process.exitCode = 1;

