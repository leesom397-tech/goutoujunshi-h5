import assert from "node:assert/strict";
import {build} from "esbuild";
const built=await build({stdin:{contents:`
export * from './lib/capture-history-context';
export * from './lib/capture-semantic-history';
export * from './lib/relationship-risk';
export * from './lib/relationship-diagnosis';
export * from './lib/chat-activity';
export * from './lib/knowledge-public';
export {AFFINITY_DIMENSIONS} from './vendor/crush-monitor/shared/affinity';`,resolveDir:process.cwd()},bundle:true,write:false,format:"cjs",platform:"node",logLevel:"silent"});
const module={exports:{}};
new Function("module","exports",built.outputFiles[0].text)(module,module.exports);
const {attachCaptureContext,orderedCaptureMemory,segmentCaptureContext,chunkCaptureHistory,validatedChunkFindings,validatedSentenceTags,validatedRiskAssessment,validatedSynthesis,hasCompleteHistorySynthesis,contextGroundedSynthesis,analyzeCaptureSemanticHistory,fullHistoryRiskReview,buildRelationshipDiagnosis,computeChatActivity,knowledgeManifest,AFFINITY_DIMENSIONS}=module.exports;
const row=(id,text,role="other",kind="text")=>({localId:id,text,kind,senderRole:role,source:{method:"synthetic",label:"synthetic"},at:"2026-10-20 14:00"});
const tags={calm:{label:"平静"},happy:{label:"开心"}};
for(const raw of ["平静",{invented:.7,calm:.3},{calm:1.4},{calm:NaN},{calm:.5},[{key:"calm",probability:1}]])
  assert.equal(validatedSentenceTags(raw,tags),null,"malformed/unregistered/unbalanced weights cannot create a report distribution");
assert.deepEqual(validatedSentenceTags({},tags),[],"missing classification must not acquire fabricated weights");
const product=[row("p1","你看看我开发的软件页面怎么样","self"),row("p2","这个颜色就很AI，就很很理性，没有没有感情，全是技巧"),row("p3","下次换一组配色","self")];
const enriched=attachCaptureContext(product,product,[],"chat-library");
const chunk=chunkCaptureHistory(enriched)[0];
const source=chunk[1];
const rejected=validatedChunkFindings({findings:[{subject:"other",claim:"你们双方的感情缺乏温度，关系比较理性",evidence:[{sourceId:source.alias,quote:"没有没有感情，全是技巧"}]}]},chunk,0);
assert.equal(rejected.length,0,"product criticism must not become emotional distance");
const valid=validatedChunkFindings({findings:[{subject:"other",claim:"对方认为软件颜色显得机械，给出直接产品反馈",evidence:[{sourceId:source.alias,quote:source.text}]}]},chunk,0);
assert.equal(valid.length,1);
assert.equal(valid[0].evidence[0].sourceKind,"chat");
assert.equal(valid[0].evidence[0].libraryId,"chat-library");
assert.ok(valid[0].evidence[0].context.some(item=>/软件页面/.test(item.text)));
assert.equal(hasCompleteHistorySynthesis({summary:"双方感情缺乏温度",explanation:"你们关系缺少情感投入",summaryEvidenceIds:[valid[0].id]},valid),false);
const wrongAdvice='针对ALYSSA指出的“全是技巧没有感情”，通过展示真实脆弱的自我，拉近心理距离，验证她是否愿意进入更深层的情感共鸣。';
const neutralSummary={summary:"她在提供软件界面意见",explanation:"表达针对软件颜色。",summaryEvidenceIds:[valid[0].id]};
assert.equal(contextGroundedSynthesis({...neutralSummary,affinityAssessment:{unavailableReason:"软件意见不能直接判断对你的好感。",dimensions:[]}},valid),true,"an explicit evidence limitation must remain allowed");
for(const section of [
  {actionPlan:{steps:[{why:wrongAdvice,evidenceIds:[valid[0].id]}]}},
  {affinitySignals:[{meaning:wrongAdvice,evidenceIds:[valid[0].id]}]},
  {profileInsights:[{reading:wrongAdvice,evidenceIds:[valid[0].id]}]},
  {changeInsights:[{before:{reading:wrongAdvice,evidenceIds:[valid[0].id]}}]},
  {riskAssessment:{items:[{resolution:{reading:wrongAdvice,evidenceIds:[valid[0].id]}}]}},
])assert.equal(contextGroundedSynthesis({...neutralSummary,...section},valid),false,"nested recommendations and interpretations must respect their own referenced topic");
const invitation={id:"invitation",claim:"明确邀请周末一起活动",evidence:[{sourceId:"invite",senderRole:"other",sourceKind:"chat",quote:"周六我们一起去散步吧",at:"2026-10-21"}]};
const replies=validatedSynthesis({replyOptions:[
  {style:"自然接话",text:"好呀，周六下午怎么样？",reason:"回应已经发出的邀请",cost:"先确认双方时间",evidenceIds:["invitation"]},
  {style:"明确安排",text:"我周六三点后方便，你想去哪个公园？",reason:"把邀约落实到地点",cost:"只在确实有空时使用",evidenceIds:["invitation"]},
  {style:"重复",text:"好呀，周六下午怎么样？",reason:"重复不能增加方案数",evidenceIds:["invitation"]},
  {style:"虚构",text:"我们上次约会好开心",reason:"没有来源",evidenceIds:["unknown"]}
]},[invitation]).replyOptions;
assert.equal(replies.length,2,"real distinct reply variants are preserved, duplicates and invalid references rejected");
assert.equal(validatedSynthesis({replyOptions:[{style:"推进",text:"我对你有感情",reason:"软件评价被误当关系",evidenceIds:[valid[0].id]}]},valid).replyOptions.length,0,"product-only feedback cannot generate relationship replies");
assert.equal(contextGroundedSynthesis({...neutralSummary,actionPlan:{steps:[{action:"接住她明确提出的散步邀约，再观察双方是否愿意推进关系",evidenceIds:["invitation"]}]}},[...valid,invitation]),true,"genuine cited personal invitation remains actionable even after software discussion");
for(const text of ["软件页面挺好的。不过我们相处时你总是这么理性，我感受不到你的在乎。","我不是说软件，我是说你总是很理性，跟你相处感觉没有感情。"]){
  const originals=[row("self","你看我做的软件怎么样","self"),row("other",text)];
  const scoped=chunkCaptureHistory(attachCaptureContext(originals,originals,[],"mixed-topic"))[0];
  const findings=validatedChunkFindings({findings:[{subject:"other",claim:"她明确谈到相处中感受不到被在乎，双方情感投入需要核对",evidence:[{sourceId:scoped[1].alias,quote:text}]}]},scoped,0);
  assert.equal(findings.length,1,"an explicit shift from product feedback to personal experience must not be erased");
  assert.equal(findings[0].contextScope,"personal_interaction");
}
const inflated={...neutralSummary,affinityAssessment:{dimensions:AFFINITY_DIMENSIONS.map(d=>({key:d.key,level:4,status:"clear",reason:"她认真评价了软件配色，并提供了具体修改建议。",evidenceIds:[valid[0].id]}))}};
assert.equal(contextGroundedSynthesis(inflated,valid),false,"romantic dimension semantics require personal evidence even with a neutral reason");
assert.equal(hasCompleteHistorySynthesis(inflated,valid,true,"attitude"),false);
assert.equal(validatedSynthesis(inflated,valid).affinity.value,null,"direct projection cannot resurrect a rejected 100-point product-only rating");
assert.ok(validatedSynthesis(inflated,valid).affinity.dimensions.every(item=>item.value===null));
const implicitAdvice={...neutralSummary,actionPlan:{steps:[{title:"回应她",action:"告诉她你能懂她",why:"她需要被你理解，看似只评论界面，实际上在试探你能不能懂她。",evidenceIds:[valid[0].id],observeFor:"下次交流",advanceWhen:"她愿意多说",stopWhen:"她不想聊"}]}};
assert.equal(contextGroundedSynthesis(implicitAdvice,valid),false,"the action-plan evidence contract rejects product-only personal advice without depending on trigger words");
assert.equal(validatedSynthesis(implicitAdvice,valid).actionPlan,undefined);
const productOnlyComplete={...neutralSummary,affinityAssessment:{dimensions:[],unavailableReason:"只有产品评价，不能据此评价对用户的好感。"},profileInsights:[],profileUnavailableReason:"没有关系层面的人物依据。",action:"",actionPlan:{steps:[]},actionUnavailableReason:"目前只看到软件反馈，没有足够个人互动依据来给出关系推进方案。",riskAssessment:{status:"no_supported_signal",summary:"产品评价不支持具体关系风险判断。",items:[]}};
assert.equal(hasCompleteHistorySynthesis(productOnlyComplete,valid,true,"panorama"),true,"insufficient personal material must finish honestly instead of forcing an invented relationship plan");
assert.ok(validatedSynthesis(productOnlyComplete,valid).unknowns.includes(productOnlyComplete.actionUnavailableReason));

const pet=[row("pet1","大勋今天好懒"),row("petpic","[图片]","other","image"),row("pet2","我家猫最近老在这个窝里睡","other")];
const visual={...row("visual","可见一只猫趴在猫窝里"),sourceLocalId:"petpic",sourceKind:"chat",libraryId:"pets",mediaId:"img1",basis:"visual"};
const petContext=attachCaptureContext(pet.filter(r=>r.kind==="text"),pet,[visual],"pets");
assert.ok(petContext[0].context.some(item=>item.basis==="visual"&&item.mediaId==="img1"));
assert.ok(petContext[0].context.some(item=>item.text.includes("我家猫")));
const orderedPet=orderedCaptureMemory(petContext,attachCaptureContext([visual],pet,[visual],"pets"));
assert.deepEqual(orderedPet.map(item=>item.sourceLocalId||item.localId),["pet1","petpic","pet2"],"the image stays between the original neighboring turns");
assert.equal(segmentCaptureContext(orderedPet).length,0,"already-present originals and images are not repeated for every line");
const missing=attachCaptureContext(pet.slice(0,1),pet,[],"pets");
assert.ok(missing[0].context.some(item=>item.basis==="unavailable-media"));
assert.ok(!missing[0].context.some(item=>item.basis==="visual"),"no image data must never be represented as a read picture");
const unrelated=attachCaptureContext(pet.slice(0,1),pet,[{...visual,libraryId:"someone-else"}],"pets");
assert.ok(!unrelated[0].context.some(item=>item.basis==="visual"),"matching local ids across libraries cannot borrow another person's image");
const moment={...row("m1","今天在公园"),sourceKind:"moments",libraryId:"moments-library",basis:"caption"};
const keptMoment=attachCaptureContext([moment],product,[],"chat-library")[0];
assert.equal(keptMoment.sourceKind,"moments");assert.equal(keptMoment.libraryId,"moments-library");assert.equal(keptMoment.context,undefined);

const habit="原来保安的话，我会去图书馆呢，因为我就住在旁边那个学习氛围真的挺好的。我觉得福田不知道哎，没有试过";
const diagnosis=buildRelationshipDiagnosis(computeChatActivity([row("h1",habit)]),"panorama",[{speaker:"other",text:habit}]);
assert.ok(!diagnosis.claimActions.some(item=>item.id==="claim-action:commitment"),"past routine is not a promise");
const promise=buildRelationshipDiagnosis(computeChatActivity([row("h2","明天我会给你发资料")]),"panorama",[{speaker:"other",text:"明天我会给你发资料"}]);
assert.ok(promise.claimActions.some(item=>item.id==="claim-action:commitment"),"direct future commitment remains available");
const business=[row("a1","这个软件只需要微信登录账号"),row("a2","把验证码输入登录页面后再点确认"),row("a3","目前这个项目我不给任何承诺"),row("a4","按钮提示文案写验证码发给我不合适，应该改成发送验证码")];
assert.equal(fullHistoryRiskReview(business).signals.length,0,"product instructions, copy critique and delivery uncertainty are not relationship safety signals");
assert.ok(fullHistoryRiskReview([row("danger","现在把验证码发给我")]).signals.some(item=>item.kind==="safety"));
const fakeRiskFinding=[{id:"account",claim:"讨论账号流程",evidence:[{sourceId:"a1",at:"2026-10-20",senderRole:"other",sourceKind:"chat",quote:business[0].text}]}];
const proposedRisk={status:"signals",summary:"账号信息有待核实",items:[{subject:"other",title:"出现账号信息索取",meaning:"对方要求账号信息",alternative:"可能是业务需求",evidenceIds:["account"],resolution:{status:"unknown",reading:"没有后续",evidenceIds:[]},verify:{action:"先不要提供账号",question:"为什么要账号？",outcomes:[{when:"说明原因",nextStep:"核实"},{when:"不能说明",nextStep:"停止"}]}}]};
assert.equal(validatedRiskAssessment(proposedRisk,fakeRiskFinding),undefined,"a generic account mention cannot ground a solicitation claim");

const many=Array.from({length:30},(_,i)=>({...row("r"+i,`第${i}次聊周末一起去公园的安排`,i%2?"self":"other"),at:`2026-10-20 14:${String(i).padStart(2,"0")}`}));
let segmentCalls=0,synthesisCalls=0,sentMethods=[];
const result=await analyzeCaptureSemanticHistory({historyRecords:many,totalImported:30,selectedLineCount:0,fullHistory:true,question:"attitude",supplementalRecords:[moment]},async messages=>{
  const payload=JSON.parse(messages.at(-1).content);
  if(payload.rows){
    segmentCalls++;
    const first=payload.rows[0];
    return JSON.stringify({findings:[{subject:first.role,claim:first.sourceKind==="moments"?"发布了公园活动":"讨论一起出行安排",evidence:[{sourceId:first.sourceId,quote:first.text}]}],sentenceReadings:(payload.sentenceTargets||[]).map(sourceId=>({sourceId,emotion:{calm:0.8,happy:0.2},intent:{inform:0.6,continue:0.4},note:"这属于安排讨论，还不能单凭这句确认亲密关系。"}))});
  }
  synthesisCalls++;sentMethods=payload.methods;
  const chat=payload.findings.find(f=>f.evidence[0].sourceKind==="chat"),moments=payload.findings.find(f=>f.evidence[0].sourceKind==="moments");
  return JSON.stringify({summary:"当前有讨论共同活动的线索",explanation:"原话谈到出行安排，支持继续核实双方方便的时间；讨论本身不能证明已经约成或恋爱意愿。",summaryEvidenceIds:[chat.id],affinityAssessment:{dimensions:[],unavailableReason:"没有足够的亲密意愿表达"},sourceInsights:{moments:{summary:"公开动态记录了公园活动，不能确认是否与用户同行。",evidenceIds:[moments.id],unknowns:["同行者不明"]}}});
});
assert.equal(result.status,"complete");
assert.equal(result.coverage.analyzedText,30);assert.equal(result.recentSentenceAnalysis.sampleCount,12);assert.equal(result.recentSentenceAnalysis.totalReadable,30);
assert.equal(result.recentSentenceAnalysis.lines[0].sourceId,"r18");assert.equal(result.recentSentenceAnalysis.lines.at(-1).sourceId,"r29");
assert.ok(Array.isArray(result.recentSentenceAnalysis.annotations[0].emotion));assert.equal(result.recentSentenceAnalysis.annotations[0].emotion[0].probability,0.8);assert.equal(result.recentSentenceAnalysis.annotations[0].emotion[0].label,"平静");assert.equal(result.recentSentenceAnalysis.annotations[0].intent[0].label,"告知信息");assert.doesNotMatch(result.coverage.limitation,/所选 0 条/);
assert.equal(segmentCalls,2);assert.equal(synthesisCalls,1,"sentence interpretation must reuse segment requests, not start a second paid pass");
assert.ok(result.sourceInsights.moments.summary);
assert.ok(sentMethods.length>0&&result.knowledgeSources.length>0);
for(const source of result.knowledgeSources)assert.ok(knowledgeManifest.documents.some(item=>item.label===source.label&&item.anchor===source.anchor),"method references must resolve to actual bundled source metadata");
console.log("PASS capture context: product-vs-relationship, pets/unknown media, source identity, routine-vs-promise, business-vs-safety, full-history statistics + recent sentence sample and real method provenance.");
