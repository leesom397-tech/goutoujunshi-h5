// Pure, synthetic samples: no model calls, credentials, writes or real chat data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
function load(file, mocks = {}, cache = new Map()) {
  const path = resolve(file);
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} }; cache.set(path, module);
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = id => {
    if (id in mocks) return mocks[id];
    if (id === "cloudflare:workers") return { env: {} };
    if (!id.startsWith(".") && !id.startsWith("@/")) return nativeRequire(id);
    let next = id.startsWith("@/") ? resolve(id.slice(2)) : resolve(dirname(path), id);
    if (!/\.[cm]?[jt]s$/.test(next)) next += ".ts";
    return load(next, mocks, cache);
  };
  new Function("require", "module", "exports", code)(require, module, module.exports);
  return module.exports;
}
const server = load("lib/crush/reply-style.ts");
const evidence = load("lib/crush/evidence.ts");
const clientSource = readFileSync("miniapp/pages/quick/index.js", "utf8");
const client = new Function("require", "Page", "wx", clientSource + ";return {styleSamples,readableStyleText};")(() => ({}), () => {}, {});
const stickerWords = ["今天也是元气满满快乐打工的一天", "不要叫我上班我只想安静睡觉", "人生已经如此艰难有些事情不要拆穿"];
const stickers = stickerWords.map((text, index) => ({ id: String(index), speaker: "self", text: "【表情包文字】" + text }));
const originalWords = ["我周日下午大概三点有空，你看方便吗？", "好呀，我们到时候在电影院门口碰面就行。", "我到了给你发消息，你路上慢慢来不用着急。"];
const originals = originalWords.map((text, index) => ({ id: "text-" + index, speaker: "self", text }));
const originalSnapshot = structuredClone([...stickers, ...originals]);

for (const samples of [server.replyStyleSamples, client.styleSamples]) {
  assert.deepEqual(samples(stickers), { samples: [], eligible: false }, "three long self stickers cannot unlock personal writing style");
  assert.deepEqual(samples([...stickers, ...originals.slice(0, 2)]), { samples: originalWords.slice(0, 2), eligible: false }, "borrowed sticker words cannot fill the three-sample threshold");
  assert.deepEqual(samples([...stickers, ...originals, { speaker: "other", text: "这是对方的措辞，不能算我的原创表达。" }]), { samples: originalWords, eligible: true }, "mixed reports use only confirmed self text");
  for (const prefix of ["【表情包文字】", "[表情包文字]", "【表情包】", "[sticker]", "[STICKER TEXT]"]) {
    assert.equal(samples(stickerWords.map(text => ({ speaker: "self", text: " \n" + prefix + text }))).eligible, false, "media source prefix is excluded: " + prefix);
  }
  const mention = "我觉得【表情包文字】这个标记挺容易认的。";
  assert.deepEqual(samples([{ speaker: "self", text: mention }]).samples, [mention], "ordinary discussion of stickers is not removed");
}
assert.deepEqual([...stickers, ...originals], originalSnapshot, "sampling never rewrites or deletes report quotes");
assert.equal(server.personalizeReplyText("好的，我们三点见。", stickers).status, "insufficient");
assert.ok(stickers.every(line => evidence.unavailableMedia(line.text) === null), "readable sticker text must not become globally unreadable media");
assert.deepEqual(evidence.readableChat(stickers), stickers, "sticker quotes remain available to sentence-level analysis and inference");

const screenshot = load("lib/crush/screenshot.ts", {
  "@/lib/knowledge": { selectKnowledge: () => [] },
  "@/lib/qwen": { parseQwenJson: JSON.parse, qwenPublicError: (_error, fallback) => fallback, qwenChat: async () => { throw new Error("No model request is allowed in this test"); } }
});
const annotations = [[{ key: "calm", weight: 100 }], [{ key: "share", weight: 100 }], "limited", "这是可读的表情包文字，保留媒介身份，不当成个人原创措辞。"];
const parsed = screenshot.prepareScreenshot({ layout: "wechat-one-to-one", complete: true, lines: stickerWords.map(text => ["right", "sticker", text, ...annotations]) }, "right");
assert.deepEqual(parsed.prepared.lines.map(line => line.text), stickers.map(line => line.text), "OCR-to-report path still preserves every marked quote");
assert.ok(parsed.prepared.lines.every(line => line.speaker === "self"));
assert.equal(parsed.count, 3);
assert.equal(parsed.decision.partial, false);
assert.equal(server.replyStyleSamples(parsed.prepared.lines).eligible, false);
assert.equal(client.styleSamples(parsed.prepared.lines).eligible, false);
console.log("PASS style sample media isolation: sticker-only blocked, mixed self text retained, client/server agree, OCR quotes and inference remain readable");
