import { readFileSync, existsSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve("miniapp");
const readJson = path => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const project = readJson("project.config.json");
const app = readJson("app.json");
const failures = [];
const checks = [];
const check = (label, passed, detail) => {
  checks.push({ label, passed, detail });
  if (!passed) failures.push(label);
};
const sourceFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = resolve(directory, entry.name);
  return entry.isDirectory() ? sourceFiles(path) : entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
});

check("Mini Program project type", project.compileType === "miniprogram", project.compileType || "missing");
check("Production AppID configured", typeof project.appid === "string" && /^wx[0-9a-f]{16}$/i.test(project.appid), project.appid === "touristappid" ? "placeholder touristappid" : project.appid || "missing");
check("URL validation enabled", project.setting?.urlCheck === true, String(project.setting?.urlCheck));
check("Native entry page declared", app.pages?.[0] === "pages/home/index", String(app.pages?.[0]));
check("All declared pages exist", Array.isArray(app.pages) && app.pages.length > 0 && app.pages.every(page => [".js", ".wxml", ".wxss"].every(ext => existsSync(resolve(root, page + ext)))), `${app.pages?.length || 0} page(s)`);
check("Sitemap exists", app.sitemapLocation === "sitemap.json" && existsSync(resolve(root, app.sitemapLocation)), app.sitemapLocation || "missing");
check("Coach API host is production HTTPS", readFileSync(resolve(root, "lib/api.js"), "utf8").includes('const BASE = "https://coach.lovetalk.love";'), "miniapp/lib/api.js");
check("No web login page in the native package", !app.pages?.includes("pages/web/index") && !/pages\/web\/index/.test(readFileSync(resolve(root, "pages/home/index.js"), "utf8")), "home and app.json");
check("Server-side AppSecret exchange exists", readFileSync(resolve("lib/miniapp-auth.ts"), "utf8").includes("MINIAPP_APPSECRET") && readFileSync(resolve("lib/miniapp-auth.ts"), "utf8").includes("searchParams.set(\"secret\""), "lib/miniapp-auth.ts");
check("No server secret assignment in client JavaScript", !/(?:MINIAPP_APPSECRET|WECHAT_ENCODING_AES_KEY)\s*[:=]/.test(sourceFiles(root).map(path => readFileSync(path, "utf8")).join("\n")), "scanned all miniapp JavaScript source files");
const knowledgeRoot = resolve("knowledge");
const markdownFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = resolve(directory, entry.name);
  return entry.isDirectory() ? markdownFiles(path) : entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
});
const publicDocs = markdownFiles(knowledgeRoot).filter(path => relative(knowledgeRoot, path).replaceAll("\\", "/") !== "SKILL.md");
const actualKnowledge = publicDocs.filter(path => relative(knowledgeRoot, path).replaceAll("\\", "/").startsWith("references/knowledge/")).length;
const actualCharacters = publicDocs.reduce((count, path) => count + (readFileSync(path, "utf8").match(/\p{Script=Han}/gu) || []).length, 0);
const generatedStatsSource = readFileSync(resolve(root, "lib/knowledge-stats.js"), "utf8");
const generatedStatsMatch = generatedStatsSource.match(/module\.exports\s*=\s*(\{[^;]+\});/);
const generatedStats = generatedStatsMatch ? JSON.parse(generatedStatsMatch[1]) : {};
check("Homepage knowledge counters match source markdown", generatedStats.sourceCount === publicDocs.length && generatedStats.knowledgeCount === actualKnowledge && generatedStats.practicalCount === publicDocs.length - actualKnowledge && generatedStats.hanCharacters === actualCharacters, `${publicDocs.length} references, ${actualCharacters} Han characters`);
const releaseNotes = readFileSync(resolve(root, "README.md"), "utf8");
check("Registration domain release requirement documented", releaseNotes.includes("ai.lovetalk.love"), "miniapp/README.md");

for (const item of checks) console.log(`${item.passed ? "PASS" : "BLOCK"} ${item.label}: ${item.detail}`);
console.log("\nNOT VERIFIED BY STATIC CHECK:");
for (const gate of [
  "Production Worker has matching MINIAPP_APPID and MINIAPP_APPSECRET secret names and a successful real wx.login exchange",
  "WeChat console request domain and ownership file are verified",
  "Privacy guide, category, filing and platform review requirements are approved",
  "Experience build works on iOS and Android: silent WeChat login, screenshot, typed advice, report and archive",
]) console.log("PENDING " + gate);
if (failures.length) {
  console.log(`\nStatic package is blocked by ${failures.length} item(s); external release gates above are still unverified.`);
  process.exitCode = 1;
} else {
  console.log("\nStatic package checks passed. This is NOT a full release approval; the external gates above still require live evidence.");
}
