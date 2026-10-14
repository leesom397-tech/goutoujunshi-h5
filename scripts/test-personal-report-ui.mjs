import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url), cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
  const module = { exports: {} }; cache.set(file, module);
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("require", "module", "exports", js)(name => {
    if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name.endsWith("/CaptureEvidence") || name === "./CaptureEvidence") return { CaptureEvidence: () => null };
    if (!name.startsWith(".") && !name.startsWith("@/")) return require(name);
    const base = name.startsWith("@/") ? path.resolve(name.slice(2)) : path.resolve(path.dirname(file), name);
    const target = [base, base + ".ts", base + ".tsx", base + ".json"].find(value => existsSync(value));
    if (!target) throw new Error("Cannot resolve " + name);
    return load(target);
  }, module, module.exports);
  return module.exports;
}
const { PersonalConnection } = load("components/web-analysis/PersonalConnection.tsx");
const { personalConnection } = load("lib/personal-context.ts");
const { publicPersonalConnection } = load("components/web-analysis/report-data.ts");
const { ReportReplyPreview } = load("components/web-analysis/ReportBrief.tsx");
const render = (report, props = {}) => renderToStaticMarkup(React.createElement(PersonalConnection, { report, ...props }));
const self = { id: "self", side: "self", source: "self-profile", label: "我的兴趣", quote: "我喜欢摄影和看展" };
const other = { id: "other", side: "other", source: "social-profile", label: "主页兴趣栏", quote: "摄影、看展" };
const report = { personalConnection: { version: 1, sources: [self, other] } };
const html = render(report), connection = personalConnection(report);
assert.equal(connection.commonPoints.length, 2);
assert.match(html, /你们的共同点/);
assert.equal((html.match(/data-personal-kind="common"/g) || []).length, 2);
assert.match(html, /data-side="self"/); assert.match(html, /data-side="other"/);
assert.match(html, /我喜欢摄影和看展/); assert.match(html, /主页兴趣栏/);
assert.doesNotMatch(html, /共同点.*100%/);
const oneSided = render({ personalConnection: { version: 1, sources: [other], commonPoints: [{ title: "没有证据的共同点" }] } });
assert.doesNotMatch(oneSided, /data-personal-kind="common"/);
assert.doesNotMatch(oneSided, /没有证据的共同点/);
assert.match(oneSided, /可以聊的话题/);
assert.match(oneSided, /\/archive\?tab=self&amp;quick=1/);
assert.doesNotMatch(render({ personalConnection: { version: 1, sources: [other] } }, { publicExample: true }), /快速补充我/);
assert.equal(render({ ...report, targetSelf: true }), "");
const disagree = render({ personalConnection: { version: 1, sources: [self, { ...other, quote: "不喜欢摄影，不喜欢看展" }] } });
assert.match(disagree, /相处时，留意这些不同/);
assert.match(disagree, /相处推测/); assert.match(disagree, /也可能/);
const reply = renderToStaticMarkup(React.createElement(ReportReplyPreview, { text: "周日两点可以，到时见。", reason: "承接具体时间。" }));
assert.match(reply, /复制/); assert.match(reply, /周日两点可以/);
const publicChat = load("data/public-chat-case.json"), social = load("data/public-social-cases.ts");
for (const [mode, sample] of [["chat", publicChat], ["moments", social.publicMomentsCase], ["social", social.publicSocialCase]]) {
  const demo = publicPersonalConnection(mode, sample), value = personalConnection({ ...sample, personalConnection: demo });
  assert.ok(demo.sources.every(source => source.label.includes("虚构")), mode + " must keep fictional provenance");
  assert.ok(value.commonPoints.length > 0, mode + " has supported personal overlap");
  for (const item of value.commonPoints) {
    const sources = value.sources.filter(source => item.evidenceIds.includes(source.id));
    assert.ok(sources.some(source => source.side === "self") && sources.some(source => source.side === "other"));
  }
  console.log("PASS demo", mode, value.commonPoints.length, "supported common points");
}
console.log("PASS personal report UI: two-sided sources, one-sided leads, no fake count, self-report hidden, optional profile entry, visible action, fictional demos.");
