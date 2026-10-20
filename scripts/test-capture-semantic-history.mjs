import assert from "node:assert/strict";
import { build } from "esbuild";
const compiled=await build({entryPoints:["lib/capture-semantic-history.ts"],bundle:true,write:false,format:"cjs",platform:"node",logLevel:"silent"});
const compiledModule={exports:{}};new Function("module","exports",compiled.outputFiles[0].text)(compiledModule,compiledModule.exports);
const { analyzeCaptureSemanticHistory, chunkCaptureHistory, hasCompleteHistorySynthesis, validatedHistoryAffinity, validatedChunkFindings, validatedSynthesis,validatedRiskAssessment,groundedRiskFindings }=compiledModule.exports;

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
const distinctActors=validatedChunkFindings({findings:[{subject:'other',claim:'主动讨论安排',evidence:[{sourceId:chunks[0][0].alias,quote:'继续聊安排'}]},{subject:'self',claim:'主动讨论安排',evidence:[{sourceId:chunks[0][1].alias,quote:'继续聊安排'}]}]},chunks[0],0);
assert.deepEqual(distinctActors.map(item=>item.subject),['other','self'],'the same wording about different actors must not merge their identities');

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
 return JSON.stringify({riskAssessment:{status:"no_supported_signal",summary:"目前没有可核验的边界风险表达。",items:[]},actionPlan:{goal:"connection",steps:[{title:"确认安排",action:"问清双方方便的时间。",why:"对方提到了可以继续安排。",evidenceIds:[chat.id],observeFor:"下次交流",advanceWhen:"双方明确愿意再约",stopWhen:"明确拒绝后停止"}]},summary:"有继续接触的线索，但关系意愿尚待确认。",summaryEvidenceIds:[chat.id],explanation:deepExplanation,affinityAssessment:{dimensions:[],unavailableReason:"仅有安排讨论，维度不足。"},affinitySignals:[makeSignal("uncertain","接触意愿与恋爱意愿还不能等同",[chat.id])],profileInsights:[{dimension:"投入与行动",reading:"有具体安排的讨论，材料尚未包含兑现结果。",evidenceIds:[chat.id],alternative:"也可能是朋友相约"}],sourceInsights:{moments:{summary:"动态里分享了散步生活记录。",evidenceIds:[moment.id],unknowns:["不清楚是否与用户同行"],crossSource:{summary:"聊天和动态出现相近话题，不能据此断定已经共同赴约。",evidenceIds:[chat.id,moment.id]}}}});
});
assert.equal(rich.status,"complete");assert.equal(rich.coverage.analyzedText,240);assert.equal(rich.coverage.supplementalAnalyzed,3);
assert.equal(rich.coverage.sources["moments-library"].captions,3);
assert.equal(rich.explanation,deepExplanation);assert.equal(rich.affinitySignals.length,1);assert.equal(rich.profileInsights.length,1);
assert.ok(rich.sourceInsights.moments.crossSource);assert.equal(calls.filter(call=>call.payload.rows).length,2);
assert.ok(calls.at(-1).options.maxTokens>=7000,"rich structured sections must have enough output budget alongside the reasoning");
const ratedKeys=["initiative","engagement","care"],rated=ratedKeys.map((key,i)=>({key,level:i===2?2:3,status:"ambiguous",reason:"对方具体提出安排，仍可能是朋友相处。",evidenceIds:["chat"]}));
const rubric=validatedHistoryAffinity({value:99,dimensions:rated},evidenceFindings,675);
assert.equal(rubric.value,66,"weighted reference index is derived from cited rubric levels, never the model's suggested overall score");
assert.equal(rubric.contextCount,675);assert.equal(rubric.coverageWeight,55);assert.equal(rubric.valueScope,"partial");assert.equal(rubric.status,"ambiguous");
assert.equal(rubric.dimensions.find(d=>d.key==="action").value,null,"absent opportunity is not scored zero");
assert.equal(validatedHistoryAffinity({dimensions:rated.slice(0,2)},evidenceFindings).value,null);
assert.equal(validatedHistoryAffinity({dimensions:rated.map(d=>({...d,evidenceIds:["photo"]}))},evidenceFindings).value,null,"public photos cannot establish private interest");
assert.equal(validatedHistoryAffinity({dimensions:rated.map(d=>({...d,level:0}))},evidenceFindings).value,0,"genuine evidenced zero remains a valid rating");
assert.equal(validatedHistoryAffinity({dimensions:rated.map(d=>({...d,level:7}))},evidenceFindings).value,null);
const later={id:"later",claim:"对方明确提出边界",confidence:"高",alternative:"不猜测隐藏意图",evidence:[{sourceId:"c2",senderRole:"other",at:"2026-10-04",quote:"我只想做普通朋友，请不要追求我。"}]};
const boundary=validatedHistoryAffinity({dimensions:rated,boundary:{active:true,reason:"后来明确说只做朋友。",evidenceIds:["later"]}},[...evidenceFindings,later]);
assert.equal(boundary.value,25);assert.equal(boundary.boundaryApplied,true);assert.deepEqual(boundary.boundaryEvidenceIds,["later"]);
assert.equal(validatedHistoryAffinity({dimensions:rated,boundary:{active:true,reason:"伪造限制",evidenceIds:["fake"]}},evidenceFindings).boundaryApplied,false);
const change={title:"从讨论安排到明确朋友边界",before:{reading:"先前讨论散步安排。",evidenceIds:["chat"]},after:{reading:"之后明确只做普通朋友。",evidenceIds:["later"]},meaning:"后来的明确表达限制了前面邀约可以被解释的范围。",alternative:"此前散步可能本来就是朋友活动。"};
const step={title:"回应边界",action:"明确回应已听见对方只做朋友的期待，并停止追求。",why:"后来的表达比先前普通邀约更明确。",evidenceIds:["later"],observeFor:"本次回应之后的实际往来",advanceWhen:"仅在双方愿意的普通朋友范围内交流。",stopWhen:"对方不愿继续联系时停止。",reply:"明白，我尊重你的想法，不会继续追求。"};
const structured=validatedSynthesis({changeInsights:[change,{...change,title:"反向编造时间",before:change.after,after:change.before},{...change,title:"同一依据不能制造变化",after:change.before}],actionPlan:{goal:"risk",rationale:"明确边界已经出现。",steps:[step,{...step,title:"重复步骤"},{...step,action:"没有依据的建议",evidenceIds:["fake"]}]}},[...evidenceFindings,later]);
assert.equal(structured.changeInsights.length,1);assert.equal(structured.changeInsights[0].before.at,"2026-10-01");assert.equal(structured.changeInsights[0].after.at,"2026-10-04");
assert.equal(structured.actionPlan.goal,"risk");assert.equal(structured.actionPlan.steps.length,1);assert.equal(structured.actionPlan.steps[0].reply,step.reply);
assert.equal(hasCompleteHistorySynthesis({summary:"有活动线索",explanation:"只能判断可见活动，不能判断关系意愿。",summaryEvidenceIds:["chat"]},evidenceFindings),false,"known Moments evidence must not disappear from a completed report");
assert.equal(hasCompleteHistorySynthesis({summary:"有活动线索",explanation:"只能判断可见活动。",summaryEvidenceIds:["photo"],sourceInsights:{moments:{summary:"图片可见步道，仅是可见场景。",evidenceIds:["photo"]}}},[evidenceFindings[2]]),true,"photos-only Moments may have bounded visual descriptions");
const detailedBase={summary:"有具体安排",explanation:"有讨论但尚不能确定关系意愿。",summaryEvidenceIds:["chat"]};
assert.equal(hasCompleteHistorySynthesis(detailedBase,[evidenceFindings[0]],true),false,"full reports must explicitly evaluate or decline the affinity index");
const explicitInsufficient={...detailedBase,affinityAssessment:{dimensions:[],unavailableReason:"当前只出现一个具体安排维度，不能合成总值。"}};
assert.equal(hasCompleteHistorySynthesis(explicitInsufficient,[evidenceFindings[0]],true,"connection"),true,"insufficient evidence is a complete assessment state, not a retry loop");
assert.equal(hasCompleteHistorySynthesis({...explicitInsufficient,action:"确认安排",actionEvidenceIds:["chat"]},[evidenceFindings[0]],true),false,"a grounded proposed action must not lose its usable plan");
assert.equal(hasCompleteHistorySynthesis({...explicitInsufficient,action:"确认安排",actionEvidenceIds:["chat"],actionPlan:{goal:"connection",steps:[{...step,evidenceIds:["chat"]}]}},[evidenceFindings[0]],true,"connection"),true);
assert.equal(hasCompleteHistorySynthesis({...detailedBase,affinityAssessment:{dimensions:[{...rated[0],level:90}]}},[evidenceFindings[0]],true),false);
const riskOriginal=[{localId:'risk-original',kind:'text',senderRole:'other',at:'2026-10-01T10:00:00Z',text:'把验证码发给我。'},{localId:'self-refusal',kind:'text',senderRole:'self',at:'2026-10-01T10:01:00Z',text:'我不会给你验证码。'},{localId:'later-response',kind:'text',senderRole:'other',at:'2026-10-01T10:05:00Z',text:'不用给我验证码了，你在官方页面自己操作。'}];
const riskReview={signals:[{title:'索取验证码',alternative:'可能误把正常流程说错，需核实。',sources:[{sourceId:'risk-original',at:'1999-01-01',quote:'把验证码发给我。',response:{sourceId:'self-refusal',at:'1999-01-01',quote:'我不会给你验证码。'}}]}]};
const anchors=groundedRiskFindings(riskReview,riskOriginal);
assert.equal(anchors[0].subject,'other');assert.equal(anchors[0].evidence[0].at,riskOriginal[0].at,'risk dates come from originals, not supplied review metadata');
assert.deepEqual(groundedRiskFindings({...riskReview,signals:[{...riskReview.signals[0],sources:[{sourceId:'self-refusal',quote:'我不会给你验证码。'}]}]},riskOriginal),[],'self words cannot become a warning about the other person');
assert.deepEqual(groundedRiskFindings({...riskReview,signals:[{...riskReview.signals[0],sources:[{sourceId:'risk-original',quote:'发银行卡给我'}]}]},riskOriginal),[],'stale or invented risk excerpts are rejected');
const riskFinding=[...anchors,{id:'refusal',claim:'你拒绝提供',confidence:'高',alternative:'不推测动机',evidence:[{...riskOriginal[1],sourceId:riskOriginal[1].localId,quote:riskOriginal[1].text}]},{id:'clarification',claim:'对方后来改变说明',confidence:'中',alternative:'仍需独立核验',evidence:[{...riskOriginal[2],sourceId:riskOriginal[2].localId,quote:riskOriginal[2].text}]}];
const riskItem={title:'验证码索取后来已有明确更正',subject:'other',meaning:'对方曾要求你提供账号验证码，之后明确说改由你自行操作，前后说明需要一并看。',evidenceIds:['risk:1'],timeRange:{start:'1900-01-01',end:'2099-01-01'},resolution:{status:'clarified',reading:'五分钟后对方改口，要求你自己在官方页面操作。',evidenceIds:['clarification']},alternative:'可能是对流程表达不清，澄清也不能替代你自己验证操作渠道。',verify:{action:'仅在自己确认的官方页面操作，不分享验证码。',question:'我会在官方页面自行操作，可以确认你不需要我的验证码吗？',outcomes:[{when:'对方接受你自行操作',nextStep:'保留边界并核实官方流程；不因一句澄清就发送验证码。'},{when:'对方再次要求验证码',nextStep:'停止这一操作并保留记录。'}]}};
const riskAssessment={status:'signals',summary:'一项账号边界表达后来更正，核实后再决定是否操作。',items:[riskItem]};
const checkedRisk=validatedRiskAssessment(riskAssessment,riskFinding);
assert.equal(checkedRisk.items[0].resolution.status,'clarified','genuine later clarification on the same day is accepted');
assert.deepEqual(checkedRisk.items[0].timeRange,{start:'2026-10-01',end:'2026-10-01'});
assert.equal(validatedRiskAssessment({...riskAssessment,items:[{...riskItem,resolution:{...riskItem.resolution,evidenceIds:['refusal']}}]},riskFinding),undefined,'the user refusing is not the other person clarifying');
assert.equal(validatedRiskAssessment({...riskAssessment,items:[{...riskItem,subject:'self'}]},riskFinding),undefined);
assert.equal(validatedRiskAssessment({...riskAssessment,items:[{...riskItem,evidenceIds:['refusal']}]},riskFinding),undefined);
assert.equal(validatedRiskAssessment({...riskAssessment,items:[{...riskItem,evidenceIds:['photo']}]},[...riskFinding,...evidenceFindings]),undefined,'public photos cannot become private risk signals');
const riskBase={summary:'核实账号边界',explanation:'原始要求与后续更正都存在，应保持不提供验证码的边界。',summaryEvidenceIds:['risk:1'],affinityAssessment:{dimensions:[],unavailableReason:'这些原话不支持评价接近意愿。'}};
assert.equal(hasCompleteHistorySynthesis(riskBase,riskFinding,true,'risk'),false,'risk goals cannot complete with only generic prose');
assert.equal(hasCompleteHistorySynthesis({...riskBase,riskAssessment},riskFinding,true,'risk'),true);
assert.equal(hasCompleteHistorySynthesis({...riskBase,riskAssessment:{status:'no_supported_signal',summary:'没有风险',items:[]}},riskFinding,true,'risk'),false,'verified risk anchors cannot be silently omitted');
assert.equal(hasCompleteHistorySynthesis({...explicitInsufficient,riskAssessment:{status:'no_supported_signal',summary:'当前邀请原话没有明确风险信号，仍不能确认绝对安全。',items:[]}},[evidenceFindings[0]],true,'risk'),true,'a risk report does not have to invent a warning');
const selfProfile=validatedSynthesis({profileInsights:[{subject:'other',dimension:'投入与行动',reading:'对方很主动',evidenceIds:['self-only']},{subject:'self',dimension:'投入与行动',reading:'你表达了见面意愿',evidenceIds:['self-only']}]},[selfOnly]);
assert.equal(selfProfile.profileInsights.length,1);assert.equal(selfProfile.profileInsights[0].subject,'self');
assert.equal(signals.affinitySignals[0].subject,'other');assert.equal(signals.affinitySignals[0].toward,'self');assert.equal(structured.actionPlan.actor,'self');
const fullContract={...riskBase,riskAssessment,profileUnavailableReason:'这些原话只涉及账号操作，暂不据此判断稳定人格。',actionPlan:{goal:'risk',steps:[{...step,evidenceIds:['risk:1']}]}};
assert.equal(hasCompleteHistorySynthesis(fullContract,riskFinding,true,'panorama'),true);
assert.equal(hasCompleteHistorySynthesis({...fullContract,riskAssessment:undefined},riskFinding,true,'panorama'),false,'global analysis must not silently omit risk review');
assert.equal(hasCompleteHistorySynthesis({...fullContract,actionPlan:undefined},riskFinding,true,'panorama'),false,'global analysis needs a usable next step');
assert.equal(hasCompleteHistorySynthesis({...fullContract,profileUnavailableReason:undefined},riskFinding,true,'panorama'),false,'missing personality interpretation must be explicit');
const dimensions=['沟通方式','关系期待','投入与行动','边界与相处','生活与兴趣','情绪表达','价值与匹配','说法与兑现'];
const expandedProfiles=validatedSynthesis({profileInsights:dimensions.map(dimension=>({subject:'other',dimension,reading:'这个维度只能依据具体邀请和后续回应作有限解释。',evidenceIds:['chat'],alternative:'也可能是普通朋友活动。'}))},evidenceFindings);
assert.equal(expandedProfiles.profileInsights.length,8,'supported personality dimensions must not be truncated to four');
console.log("Capture semantic history passed: all source rows, verified rubric reference ratings, meaningful chronology and action plans, required Moments sections, genuine evidence and honest incomplete states.");
