import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function compile(file, resolve = require) {
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  });
  const result = { exports: {} };
  new Function("require", "module", "exports", outputText)(resolve, result, result.exports);
  return result.exports;
}
const data = compile("components/web-analysis/report-data.ts");
const labels = ["主动延续", "回应投入", "关心体贴", "自我开放", "亲密表达", "实际行动"];
const partial = { value: null, valueScope: "none", dimensions: labels.map((label, index) => ({ label, value: index === 0 ? 75 : index === 1 ? 0 : null, status: index < 2 ? "ambiguous" : "insufficient" })) };
const report = { lines: [{ id: "one", speaker: "other", text: "嗯嗯，好呀" }], decision: { affinityPreview: partial } };
assert.equal(data.reportAffinity(report), partial, "known dimensions must survive an unavailable combined score");
assert.equal(data.reportAffinity({ ...report, affinity: { value: null, dimensions: [] } }), partial, "empty primary result must not shadow the screenshot model");
assert.equal(data.reportAffinity({ ...report, affinityStatus: "unread_media" }), null, "blocked legacy media scores must remain blocked");
assert.equal(data.reportAffinity({ affinity: { value: 0, dimensions: [] } }).value, 0, "a genuine zero must not become unknown");
const image = { id: "img", speaker: "other", text: "[图片] 我最近喜欢跟你聊天，周日我订票去见你？" };
const sticker = { id: "sticker", speaker: "other", text: "[表情包] 小狗图片，文字：我最近想你啦？" };
assert.ok(data.visibleSignalProfile([image, sticker]).every(row => row.count === 0), "media descriptions must not become text interaction evidence");
assert.equal(data.interactionMetrics([image, sticker]).otherTurnCount, 0, "media descriptions must not inflate denominators");
const line = { id: "text", speaker: "other", text: "今天面试怎么样？记得你说三点开始。" };
assert.equal(data.visibleSignalProfile([line, line]).find(row => row.key === "care").count, 1, "duplicated source IDs must not multiply evidence");
const merged = data.mergeChatReports([{ lines: [], decision: { mediaBubbles: [{ kind: "sticker", lineId: "bubble-1", lineIndex: 1 }] } }, { lines: [], decision: { mediaBubbles: [{ kind: "image", lineId: "bubble-1", lineIndex: 1 }] } }]);
assert.deepEqual(merged.decision.mediaBubbles.map(row => [row.lineId, row.screenshotNumber, row.lineIndex]), [["1:bubble-1", 1, 1], ["2:bubble-1", 2, 1]], "media from each screenshot must retain its own location");
const components = compile("components/web-analysis/ReportEvidence.tsx", name => {
  if (name === "./report-data") return data;
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, key) => key === "default" ? new Proxy({}, { get: (_, name) => String(name) }) : String(key) });
  if (name === "./client") return { api() { throw Error("no network in fixture test"); } };
  if (name === "@/lib/screenshot-photo") return { isStickerPhotoClue: () => false };
  return require(name);
});
const html = renderToStaticMarkup(React.createElement(components.InteractionEvidence, { report }));
assert.match(html, /已知 2 \/ 6/);
assert.match(html, /主动延续：75\/100/);
assert.match(html, /回应投入：0\/100/);
assert.match(html, /关心体贴：待了解/);
assert.doesNotMatch(html, /主动表达|回应承接|回应扩展|邀约兑现|边界尊重|互惠稳定/);
assert.doesNotMatch(html, /<details|<button/, "the signal panel must not expand into another reading maze");
assert.match(html, /非喜欢你的概率/);
assert.doesNotMatch(html, /aria-label="好感信号指数/, "missing totals must not get an invented ring score");
assert.match(html, /当前材料不足以合成总分/);
const rated = { ...report, decision: { ...report.decision, judgment: "对方主动延续话题，也尊重你的节奏。", evidence: "对方原话：「周日一起去吗？」", nextStep: "可以确认周日的具体时间。", affinityPreview: { ...partial, value: 68, valueScope: "partial" } } };
const ratedHtml = renderToStaticMarkup(React.createElement(components.InteractionEvidence, { report: rated }));
assert.match(ratedHtml, /aria-label="好感信号指数 68\/100，已知维度参考；不是喜欢你的概率"/);
assert.match(ratedHtml, /stroke-dashoffset="32"/);
assert.match(ratedHtml, /有依据 2 \/ 6 维/);
assert.match(ratedHtml, /对方主动延续话题，也尊重你的节奏。/);
assert.match(ratedHtml, /对方原话：「周日一起去吗？」/);
assert.match(ratedHtml, /可以确认周日的具体时间。/);
assert.doesNotMatch(ratedHtml, /成功率|置信度|68%|<details|<button/);
const zeroHtml = renderToStaticMarkup(React.createElement(components.InteractionEvidence, { report: { ...rated, decision: { ...rated.decision, affinityPreview: { ...partial, value: 0, valueScope: "partial" } } } }));
assert.match(zeroHtml, /aria-label="好感信号指数 0\/100/);
assert.match(zeroHtml, /stroke-dashoffset="100" style="opacity:0"/);
console.log("Report signals: partial model dimensions, zero/missing values, media exclusion, dedupe, and multi-image locations passed.");
