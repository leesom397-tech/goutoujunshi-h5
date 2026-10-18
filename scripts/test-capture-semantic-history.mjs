import assert from "node:assert/strict";
import { analyzeCaptureSemanticHistory, chunkCaptureHistory, hasCompleteHistorySynthesis, validatedChunkFindings, validatedSynthesis } from "../lib/capture-semantic-history.ts";

const row = (index, text = `第${index}条消息：周末见面以后继续聊安排。`) => ({
  localId: `real-source-${index}`, kind: "text", senderRole: index % 2 ? "other" : "self",
  at: `2026-10-${String(1 + Math.floor(index / 30)).padStart(2, "0")} 10:00`, text,
});

const all = Array.from({ length: 675 }, (_, i) => row(i + 1));
const chunks = chunkCaptureHistory(all);
assert.ok(chunks.length > 1);
assert.equal(chunks.flat().length, all.length);
assert.deepEqual(chunks.flat().map(item => item.localId), all.map(item => item.localId));
assert.equal(new Set(chunks.flat().map(item => item.alias)).size, all.length);
assert.ok(chunks.every(chunk => chunk.length <= 250 && chunk.reduce((n, item) => n + item.text.length, 0) <= 16_000));

const tampered = validatedChunkFindings({ findings: [
  { claim: "有证据的观察", confidence: "中", alternative: "也可能是普通社交", evidence: [{ sourceId: chunks[0][0].alias, quote: "周末见面" }] },
  { claim: "捏造来源", evidence: [{ sourceId: "H9999", quote: "周末见面" }] },
  { claim: "捏造原话", evidence: [{ sourceId: chunks[0][0].alias, quote: "我已经答应结婚" }] },
] }, chunks[0], 0);
assert.equal(tampered.length, 1);
assert.equal(tampered[0].evidence[0].sourceId, "real-source-1");

const seen = [];
const qwen = async messages => {
  const payload = JSON.parse(messages[1].content);
  if (payload.rows) {
    seen.push(...payload.rows.map(item => item.sourceId));
    const chosen = payload.rows.at(-1);
    return JSON.stringify({ findings: [{ claim: `第${payload.segment}段有持续交谈的原话`, confidence: "中", alternative: "也可能只是朋友聊天",
      evidence: [{ sourceId: chosen.sourceId, quote: "继续聊安排" }] }] });
  }
  return JSON.stringify({ summary: "双方有持续聊天，也需核对现实行动。", explanation: "原话中有安排的讨论，但讨论和实际兑现不同，现有材料不能直接确定恋爱意愿。", summaryEvidenceIds: payload.findings.map(item => item.id),
    trend: "待了解", reciprocity: "双方都参与了聊天，意图仍需继续观察。", action: "下一次确认具体安排。",
    actionEvidenceIds: [payload.findings[0].id] });
};
const result = await analyzeCaptureSemanticHistory({ historyRecords: all, totalImported: 675, selectedLineCount: 40 }, qwen);
assert.equal(result.status, "complete");
assert.equal(result.coverage.receivedText, 675);
assert.equal(result.coverage.analyzedText, 675);
assert.equal(result.coverage.missingFromText, 0);
assert.equal(result.coverage.selectedLineCount, 40);
assert.equal(seen.length, 675);
assert.equal(new Set(seen).size, 675);
assert.equal(result.findings.length, chunks.length);
assert.equal(result.findings.at(-1).evidence[0].sourceId, "real-source-675");
assert.equal(result.summaryEvidenceIds.length, chunks.length);

const sparse = await analyzeCaptureSemanticHistory({ historyRecords: all.slice(0, 396), totalImported: 675, selectedLineCount: 40 }, qwen);
assert.equal(sparse.coverage.analyzedText, 396);
assert.equal(sparse.coverage.missingFromText, 279);
assert.match(sparse.coverage.limitation, /不能当作已读正文/);

const invalidSynthesis = await analyzeCaptureSemanticHistory({ historyRecords: [row(1)], totalImported: 2, selectedLineCount: 1 }, async messages => {
  const payload = JSON.parse(messages[1].content);
  return payload.rows ? JSON.stringify({ findings: [{ claim: "观察", evidence: [{ sourceId: "H1", quote: "继续聊安排" }] }] })
    : JSON.stringify({ summary: "没有依据的结论", summaryEvidenceIds: ["fake:id"], trend: "升温", action: "立刻表白", actionEvidenceIds: ["fake:id"] });
});
assert.match(invalidSynthesis.summary, /局部线索包括：观察/);
assert.deepEqual(invalidSynthesis.summaryEvidenceIds, ["history:1:1"]);
assert.equal(invalidSynthesis.trend, "待了解");
assert.equal(invalidSynthesis.action, "");
assert.equal(invalidSynthesis.status,"unavailable");
assert.match(invalidSynthesis.coverage.limitation,/综合判断与推理尚未完整生成/);
const summaryOnly=await analyzeCaptureSemanticHistory({historyRecords:[row(1)],totalImported:1,selectedLineCount:0},async messages=>{
 const payload=JSON.parse(messages[1].content);
 return payload.rows?JSON.stringify({findings:[{claim:"讨论安排",evidence:[{sourceId:"H1",quote:"继续聊安排"}]}]}):JSON.stringify({summary:"需要核实具体安排。",summaryEvidenceIds:[payload.findings[0].id]});
});
assert.equal(summaryOnly.coverage.analyzedText,1);assert.equal(summaryOnly.status,"unavailable");
assert.ok(summaryOnly.findings.length,"incomplete synthesis must retain verified original evidence");
assert.equal(hasCompleteHistorySynthesis({summary:"有互动。",explanation:"仅讨论安排，尚未确认。",summaryEvidenceIds:["one"]},[{id:"one"}]),true,"concise valid reasoning must not be rejected by a word-count quota");
assert.equal(hasCompleteHistorySynthesis({summary:"有互动。",explanation:"仅讨论安排。",summaryEvidenceIds:["one","fake"]},[{id:"one"}]),false);
assert.equal(hasCompleteHistorySynthesis({},[]),true,"no findings must not force invented reasoning");
let noFindingsCalls=0;
const noFindingsResult=await analyzeCaptureSemanticHistory({historyRecords:[row(1)],totalImported:1,selectedLineCount:0},async()=>{noFindingsCalls++;return JSON.stringify({findings:[]});});
assert.equal(noFindingsResult.status,"complete");assert.equal(noFindingsResult.summary,"");assert.equal(noFindingsCalls,1,"reading without a meaningful observation must not request invented synthesis");

const failed = await analyzeCaptureSemanticHistory({ historyRecords: [row(1)], totalImported: 2, selectedLineCount: 1 }, async () => { throw Error("model failed"); });
assert.equal(failed.status, "unavailable");
assert.equal(failed.coverage.analyzedText, 0);
assert.match(failed.coverage.limitation, /0 \/ 1/);
const empty = await analyzeCaptureSemanticHistory({ historyRecords: [], totalImported: 675, selectedLineCount: 40 }, async () => { throw Error("unexpected call"); });
assert.equal(empty.status, "no_text");
assert.equal(empty.coverage.analyzedText, 0);
const evidenceFindings=[
 {id:"chat",claim:"主动安排",confidence:"中",alternative:"普通约定",evidence:[{sourceId:"c1",at:"2026-10-01",senderRole:"other",quote:"周末去散步"}]},
 {id:"moment",claim:"分享散步",confidence:"低",alternative:"生活记录",evidence:[{sourceId:"m1",sourceKind:"moments",libraryId:"moments-library",basis:"caption",at:"2026-10-02",senderRole:"other",quote:"今天去了步道"}]},
 {id:"photo",claim:"图片可见步道",confidence:"低",alternative:"仅图片",evidence:[{sourceId:"m2",sourceKind:"moments",libraryId:"moments-library",basis:"visual",at:"2026-10-02",senderRole:"other",quote:"图中有步道"}]}
];
const joint=validatedSynthesis({profileInsights:[{dimension:"投入与行动",reading:"确有具体安排，是否兑现还要继续看。",evidenceIds:["chat"],alternative:"也可能是朋友活动"},{dimension:"关系期待",reading:"由照片认定想结婚",evidenceIds:["photo"]}],sourceInsights:{moments:{summary:"动态可见步道生活记录。",evidenceIds:["moment"],unknowns:["不能判断是否和用户同行"],crossSource:{summary:"两边都出现散步话题，不能直接证明赴约。",evidenceIds:["chat","moment"]}}}},evidenceFindings);
assert.equal(joint.profileInsights.length,1);assert.deepEqual(joint.sourceInsights.moments.crossSource.evidenceIds,["chat","moment"]);
assert.deepEqual(validatedSynthesis({sourceInsights:{moments:{summary:"伪造动态来源",evidenceIds:["chat"]}}},evidenceFindings).sourceInsights,{});
assert.equal(validatedSynthesis({sourceInsights:{moments:{summary:"仅动态",evidenceIds:["moment"],crossSource:{summary:"假称核对了聊天",evidenceIds:["moment"]}}}},evidenceFindings).sourceInsights.moments.crossSource,undefined);
assert.deepEqual(validatedSynthesis({profileInsights:[{dimension:"沟通方式",reading:"无证据",evidenceIds:["fake"]}]},evidenceFindings).profileInsights,[]);
const selfOnly={id:"self-only",claim:"用户主动",confidence:"中",alternative:"仅一方表达",evidence:[{sourceId:"s1",at:"2026-10-01",senderRole:"self",quote:"我想见你"}]};
const makeSignal=(direction,signal,evidenceIds)=>({direction,signal,meaning:"具体约定比客气寒暄更能支持愿意继续接触，但不能直接确定恋爱意愿。",evidenceIds,alternative:"也可能是普通朋友活动"});
const signals=validatedSynthesis({affinityValue:83,affinitySignals:[
 makeSignal("support","提出具体安排",["chat"]),makeSignal("support","提出具体 安排",["chat"]),
 makeSignal("counter","限制线索",["chat"]),makeSignal("uncertain","仍需核实关系意愿",["chat"]),
 makeSignal("support","照片证明喜欢",["photo"]),makeSignal("support","发动态证明喜欢",["moment"]),
 makeSignal("support","我主动证明对方喜欢",["self-only"]),makeSignal("support","伪造来源",["fake"]),
 makeSignal("unknown","无效方向",["chat"]),
]},[...evidenceFindings,selfOnly]);
assert.deepEqual(signals.affinitySignals.map(item=>item.direction),["support","counter","uncertain"]);
assert.equal(signals.affinitySignals[0].alternative,"也可能是普通朋友活动");
assert.equal(signals.affinityValue,undefined,"the structured signal result must never invent or retain a numeric affinity score");
assert.deepEqual(validatedSynthesis({affinitySignals:[makeSignal("support","夹带假引用",["chat","fake"])]},evidenceFindings).affinitySignals,[]);

// A few public posts appended after a large chat must get a source-specific
// evidence pass instead of competing for its last eight observation slots.
const momentsRows=Array.from({length:3},(_,i)=>({...row(i+1,`动态${i+1}：周末沿步道散步。`),localId:`moment-${i+1}`,sourceLocalId:`original-moment-${i+1}`,basis:"caption",sourceKind:"moments",libraryId:"moments-library",senderRole:"other"}));
const grouped=chunkCaptureHistory([...all.slice(0,240),...momentsRows]);
assert.equal(grouped.length,2);
assert.equal(grouped[0].length,240);assert.equal(grouped[1].length,3);
assert.deepEqual(grouped.flat().map(item=>item.alias),Array.from({length:243},(_,i)=>`H${i+1}`));
const calls=[];
const deepExplanation=["对方提出了具体安排，这比一句礼貌回应提供了更多可以核对的内容。", "不过，愿意一起活动和明确恋爱意愿仍有区别，现有原话不能把这一步直接等同于关系确认。", "需要把下一次是否回应安排、双方对相处节奏的表达放在一起看。"].join("\n\n");
const rich=await analyzeCaptureSemanticHistory({historyRecords:all.slice(0,240),totalImported:240,selectedLineCount:0,fullHistory:true,supplementalRecords:momentsRows},async (messages,options)=>{
 const payload=JSON.parse(messages[1].content);calls.push({payload,options});
 if(payload.rows){const source=payload.rows.find(item=>item.role==="other");return JSON.stringify({findings:[{claim:source.sourceKind==="moments"?"动态记录散步话题":"聊天提出继续安排",confidence:"中",alternative:"可能是普通朋友活动",evidence:[{sourceId:source.sourceId,quote:source.text}]}]});}
 const chat=payload.findings.find(item=>!item.evidence[0].basis),moment=payload.findings.find(item=>item.evidence[0].sourceKind==="moments");
 assert.ok(chat&&moment,"synthesis must receive verified findings from both sources");
 // The only restrictive output schema must include the richer sections; it
 // previously silently contradicted the earlier profile/Moments guidance.
 const schema=messages[0].content.split("只返回 JSON ").at(-1).split("。summary")[0];
 assert.match(schema,/affinitySignals:/);assert.match(schema,/profileInsights:/);assert.match(schema,/sourceInsights:/);
 return JSON.stringify({summary:"有继续接触的线索，但关系意愿尚待确认。",summaryEvidenceIds:[chat.id],explanation:deepExplanation,affinitySignals:[makeSignal("uncertain","接触意愿与恋爱意愿还不能等同",[chat.id])],profileInsights:[{dimension:"投入与行动",reading:"有具体安排的讨论，材料尚未包含兑现结果。",evidenceIds:[chat.id],alternative:"也可能是朋友相约"}],sourceInsights:{moments:{summary:"动态里分享了散步生活记录。",evidenceIds:[moment.id],unknowns:["不清楚是否与用户同行"],crossSource:{summary:"聊天和动态出现相近话题，不能据此断定已经共同赴约。",evidenceIds:[chat.id,moment.id]}}}});
});
assert.equal(rich.status,"complete");assert.equal(rich.coverage.analyzedText,240);assert.equal(rich.coverage.supplementalAnalyzed,3);
assert.equal(rich.coverage.sources["moments-library"].captions,3);
assert.equal(rich.explanation,deepExplanation);assert.equal(rich.affinitySignals.length,1);assert.equal(rich.profileInsights.length,1);
assert.ok(rich.sourceInsights.moments.crossSource);assert.equal(calls.filter(call=>call.payload.rows).length,2);
assert.ok(calls.at(-1).options.maxTokens>=7000,"rich structured sections must have enough output budget alongside the reasoning");
console.log("Capture semantic history passed: all rows processed, independent source passes, grounded affinity/profile/Moments/cross-source insights, no photo/self-only romance inference or numeric score, honest coverage and failures.");
