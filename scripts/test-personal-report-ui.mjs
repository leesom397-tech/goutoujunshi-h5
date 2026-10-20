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
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function("require", "module", "exports", js)(name => {
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
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
assert.match(html, /data-personal-starter/);
assert.match(html, /复制这句话/);
const risky = render({ ...report, lines: [{ speaker: "other", text: "把验证码发给我" }] });
assert.match(risky, /data-personal-priority/);
assert.doesNotMatch(risky, /data-personal-starter|可以这样接近/);
const expectations = render({ ...report, lines: [{ speaker: "other", text: "我只想短期关系" }] });
assert.match(expectations, /先确认双方的关系期待/);
assert.doesNotMatch(expectations, /data-personal-starter/);
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

// Raw enum values must stay in data, while quoted English remains verbatim.
const { reportPersonLabel, reportSenderLabel } = load("components/report-person-label.ts");
assert.equal(reportPersonLabel("self"), "我");
assert.equal(reportPersonLabel("other"), "对方");
assert.equal(reportPersonLabel("unknown"), "身份待确认");
assert.equal(reportSenderLabel("other", "other"), "对方");
assert.equal(reportSenderLabel("unknown", "unknown"), "身份待确认");
assert.equal(reportSenderLabel("other", "Alice"), "Alice");
assert.equal(reportSenderLabel("other", "小欣 · #0123456789abcdef"), "小欣");
const { ConversationPanel } = load("components/MaterialReport.tsx");
const { RelationshipDiagnosisPanel } = load("components/web-analysis/RelationshipDiagnosisPanel.tsx");
const quote = "Be your self; respect the other person.";
const material = renderToStaticMarkup(React.createElement(ConversationPanel, {me:"本人称呼",other:"对方称呼",ready:true,result:{lineInsights:[{speaker:"self",quote,signal:"说明边界",alternative:"需要核对",certainty:"低"},{speaker:"other",quote:"好的",signal:"回应",alternative:"待观察",certainty:"低"},{speaker:"unknown",quote:"来源待核对",signal:"未知",alternative:"待观察",certainty:"低"}],replyOptions:[]}}));
assert.match(material, /<strong>我<\/strong>/);assert.match(material, /<strong>对方<\/strong>/);assert.match(material, /<strong>身份待确认<\/strong>/);
assert.ok(material.includes(quote));assert.doesNotMatch(material, /<strong>(self|other|unknown)<\/strong>/);
const semantic = renderToStaticMarkup(React.createElement(RelationshipDiagnosisPanel,{semanticHistory:{findings:[{id:"a",claim:"本人表达",evidence:[{senderRole:"self",quote}]},{id:"b",claim:"他人表达",evidence:[{senderRole:"other",quote:"收到"}]},{id:"c",claim:"身份缺失",evidence:[{senderRole:"unknown",quote:"待核对"}]}]}}));
assert.ok(semantic.includes(quote));assert.doesNotMatch(semantic, /<small>(self|other|unknown)/);assert.match(semantic, /身份待确认/);
const enumLabels = render({personalConnection:{version:1,sources:[{...self,label:"self",quote:"我喜欢摄影，self is an English word about 摄影."},{...other,label:"other",quote:"摄影，other is an English word about 摄影."}]}});
assert.doesNotMatch(enumLabels, /<small>(self|other|unknown)<\/small>/);
assert.match(enumLabels, /self is an English word/);assert.match(enumLabels, /other is an English word/);
console.log("PASS report labels: self/other/unknown are localized; source names and English quotes remain unchanged.");

// Exercise the actual global-report sections, including two different findings
// with an identical title. Both IDs must remain resolvable for later sections.
const {HistoryReportReading,HistoryActionReading}=load("components/web-analysis/HistoryReportInsights.tsx");
const globalReport={analysisScope:'fullHistory',analysisQuestion:'panorama',captureKind:'chat',participants:{other:{label:'合成对象'}},sourceCoverage:[{libraryId:'moments',kind:'moments',total:1,textRead:1,imagesExpected:1,imagesAnalyzed:1}],mediaEvidence:[{libraryId:'moments',sourceId:'post-1',mediaId:'photo-1',kind:'moments',observation:'图片可见海边步道。'}],semanticHistory:{status:'complete',findings:[
 {id:'self',claim:'表达了要求',subject:'self',evidence:[{sourceId:'chat-self',senderRole:'self',quote:'我会自行处理账户。'}]},
 {id:'risk',claim:'表达了要求',subject:'other',evidence:[{sourceId:'chat-other',senderRole:'other',quote:'把验证码发给我。'}]},
 {id:'moment',claim:'公开记录步道活动',subject:'other',evidence:[{sourceId:'post-1',libraryId:'moments',sourceKind:'moments',basis:'caption',senderRole:'other',quote:'今天去海边走走。'}]}
 ],profileInsights:[{subject:'other',dimension:'边界与相处',reading:'提出索取账号验证码，需要先明确账号边界。',evidenceIds:['risk'],alternative:'也可能是不清楚流程。'}],sourceInsights:{moments:{summary:'公开动态记录海边散步，可作生活话题线索。',evidenceIds:['moment']}},riskAssessment:{status:'signals',summary:'有一项账号边界表达需要核实。',items:[{subject:'other',title:'索取验证码',meaning:'此要求涉及账号访问权限。',evidenceIds:['risk'],resolution:{reading:'后续尚未有明确更正。',evidenceIds:[]},alternative:'也可能对流程不了解。',verify:{action:'自行确认官方流程，不分享验证码。',question:'你确认不需要我的验证码吗？',outcomes:[{when:'接受自行操作',nextStep:'保持边界。'},{when:'坚持索取',nextStep:'停止操作。'}]}}]},actionPlan:{goal:'risk',steps:[{title:'保持账号边界',action:'自行确认官方流程。',why:'对方索取了验证码。',evidenceIds:['risk'],observeFor:'本次操作前',advanceWhen:'接受你自行操作',stopWhen:'仍然坚持索取'}]}}};
const renderSection=section=>renderToStaticMarkup(React.createElement(HistoryReportReading,{report:globalReport,section}));
const globalRisk=renderSection('risk');
for(const phrase of ['风险与边界','索取验证码','此要求涉及账号访问权限','把验证码发给我','后续尚未有明确更正','接受自行操作','坚持索取'])assert.ok(globalRisk.includes(phrase),phrase+' is visible in global analysis');
assert.ok(renderSection('profile').includes('提出索取账号验证码'),'same-title findings from different speakers retain their own citations');
for(const phrase of ['公开动态记录海边散步','今天去海边走走','图片可见海边步道'])assert.ok(renderSection('moments').includes(phrase),phrase+' remains visible');
const globalAction=renderToStaticMarkup(React.createElement(HistoryActionReading,{report:globalReport}));
for(const phrase of ['自行确认官方流程','本次操作前','接受你自行操作','仍然坚持索取'])assert.ok(globalAction.includes(phrase));
console.log('PASS global report UI: risk, quotes, competing interpretations, conditional actions and Moments image analysis remain visible with exact subject/source mapping.');
