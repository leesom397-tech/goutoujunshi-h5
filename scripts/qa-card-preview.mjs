// Generates a local visual QA image from fictional messages; no network or customer data.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(".");
const nativeRequire = createRequire(import.meta.url);
function load(file, cache = new Map()) {
  const path = resolve(root, file);
  if (cache.has(path)) return cache.get(path).exports;
  const loaded = { exports: {} };
  cache.set(path, loaded);
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = id => {
    if (id === "cloudflare:workers") return { env: {} };
    if (id.startsWith(".") || id.startsWith("@/")) {
      const next = id.startsWith("@/") ? resolve(root, id.slice(2)) : resolve(dirname(path), id);
      return load(/\.(?:[cm]?[jt]sx?|json)$/.test(next) ? next : next + ".ts", cache);
    }
    return nativeRequire(id);
  };
  new Function("require", "module", "exports", source)(require, loaded, loaded.exports);
  return loaded.exports;
}

const card = load("lib/crush/card.ts");
const lines = [
  { id: "1", speaker: "other", text: "周日一起看电影吗？" },
  { id: "2", speaker: "self", text: "可以呀，你下午方便吗？" },
  { id: "3", speaker: "other", text: "三点可以，电影院东门见。" },
];
const annotations = [
  { lineId: "1", emotion: [{ key: "calm", label: "平静" }], intent: [{ key: "invite", label: "发出邀约" }], evidence: "limited", note: "对方主动提出周日一起看电影，可能在推进见面；也可能只是想找人看这部片。" },
  { lineId: "2", emotion: [{ key: "positive", label: "轻松" }], intent: [{ key: "agree", label: "表示认同" }], evidence: "sufficient", note: "你接住邀约并问下午是否方便，让见面安排进入具体时间；还没确认地点。" },
  { lineId: "3", emotion: [{ key: "calm", label: "平静" }], intent: [{ key: "inform", label: "告知安排" }], evidence: "sufficient", note: "对方给出三点和东门两个具体细节，说明这次安排在落实；仍需看是否如约到场。" },
];
const result = {
  id: "fictional", threadId: "fictional", revision: 1, provider: "qwen", model: "fictional-layout-only",
  lines, annotations, createdAt: Date.now(), expiresAt: Date.now() + 60000, latencyMs: 0, duplicateCount: 0,
  decision: {
    observation: "对方提出活动并确认时间地点。", judgment: "对方在推进一次见面，但这不能证明长期意愿。", nextStep: "按实际情况回应东门位置，再等线下行动验证。", skipped: 0,
    replyOptions: [
      { style: "轻松确认", text: "好呀，那周日三点东门见～", reason: "直接承接已确认的安排。", cost: "如果地点还不熟，仍需再核对。", weight: 82 },
      { style: "核对位置", text: "三点可以，东门方便发个定位吗？", reason: "不假装知道集合位置。", cost: "需要对方多回一条信息。", weight: 95 },
    ],
  },
};
const html = card.renderCardHtml(result);
const directory = await mkdtemp(join(tmpdir(), "coach-card-preview-"));
const htmlPath = join(directory, "card.html");
const imagePath = join(directory, "card.png");
await writeFile(htmlPath, html, "utf8");
const edgePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--window-size=800,1920", "--screenshot=" + imagePath, "--user-data-dir=" + join(directory, "profile"), pathToFileURL(htmlPath).href];
const exitCode = await new Promise((resolveCode, reject) => {
  const browser = spawn(edgePath, args, { windowsHide: true, stdio: "ignore" });
  browser.on("error", reject);
  browser.on("exit", code => resolveCode(code));
});
if (exitCode !== 0) throw new Error("Local Edge card screenshot failed: " + exitCode);
const png = await readFile(imagePath);
if (png.length < 1000 || png[0] !== 137 || png[1] !== 80) throw new Error("Local Edge did not write a PNG card screenshot");
console.log(JSON.stringify({ imagePath, bytes: png.length, fictionalOnly: true }));
