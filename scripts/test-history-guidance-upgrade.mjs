import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';

async function load(entry){const compiled=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'});const m={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(m,m.exports);return m.exports;}
const {upgradeHistoryGuidance}=await load('lib/history-guidance-upgrade.ts');
const {validatedSynthesis}=await load('lib/capture-semantic-history.ts');
const source=(sourceId,quote,extra={})=>({sourceId,quote,at:'2026-10-01 10:00',senderRole:'other',sourceKind:'chat',...extra});
const findings=[
 {id:'chat',claim:'谈过看展',confidence:'中',alternative:'可能只是普通朋友聊天',evidence:[source('c1','周末经常看展。')]},
 {id:'moment',claim:'分享展览',confidence:'中',alternative:'可能是偶尔路过',evidence:[source('m1','这个展的画很有意思。',{sourceKind:'moments',basis:'caption',libraryId:'moments'})]},
];
const step={title:'接着聊刚提到的展',action:'问哪件作品印象深。',why:'对方说了经常看展。',evidenceIds:['chat'],observeFor:'看对方有没有具体展开',advanceWhen:'如果提到作品就接着聊作品',stopWhen:'不想展开就结束这一轮',reply:'最近哪个展让你印象深？'};
const response={action:step.action,actionEvidenceIds:['chat'],observeWindow:'接下来一轮聊天',stopCondition:step.stopWhen,actionPlan:{goal:'connection',rationale:step.why,steps:[step]},replyOptions:[{style:'聊细节',text:step.reply,reason:step.why,cost:'对方愿意继续这个话题时再问',evidenceIds:['chat']}],sourceInsights:{moments:{interpretations:[{dimension:'聊天对照',reading:'聊天和动态都提过展览，可从具体作品聊起。',alternative:'这还不能说明固定爱好或对人的态度。',nextStep:step.action,evidenceIds:['chat','moment']}]}}};
const raw={summary:'有共同话题可继续聊。',explanation:'看展出现在原话里，能接着了解具体作品，不能直接推恋爱意愿。',summaryEvidenceIds:['chat'],affinityAssessment:{dimensions:[{key:'engagement',level:2,status:'ambiguous',reason:'愿意聊具体话题。',evidenceIds:['chat']}],boundary:{active:false}},riskAssessment:{status:'no_supported_signal',summary:'没有足够具体的风险原话。',items:[]},profileInsights:[{subject:'other',dimension:'生活与兴趣',reading:'提过看展。',evidenceIds:['chat'],alternative:'可能是阶段性活动。'}],...response,sourceInsights:{moments:{summary:'动态中提到展览。',evidenceIds:['moment'],unknowns:['不了解长期偏好。'],crossSource:{summary:'两种来源都提过展览。',evidenceIds:['chat','moment']}}}};
const semantic={...validatedSynthesis(raw,findings),findings,sourceInsights:{moments:{...raw.sourceInsights.moments,status:'analyzed',savedMetadata:{kept:true}}}};
const report={analysisScope:'fullHistory',analysisQuestion:'panorama',semanticHistory:semantic,generatedAt:123};
const original=JSON.stringify(report);
let calls=0;
const result=await upgradeHistoryGuidance(report,async(messages,options)=>{calls++;assert.ok(messages[0].content.includes('不替用户制造'));assert.equal(options.maxTokens,6500);const payload=JSON.parse(messages[1].content);assert.deepEqual(payload.findings,findings);return JSON.stringify({...response,summary:'不可覆盖原结论',findings:[],affinity:{score:100},riskAssessment:{status:'signals'}});});
assert.equal(calls,1);assert.equal(result.strictValidated,true);assert.equal(result.attempts,1);
assert.equal(JSON.stringify(report),original,'helper must not mutate its historical input');
assert.equal(result.patch.replyOptions[0].text,step.reply);
assert.ok(!Object.hasOwn(result.patch,'summary')&&!Object.hasOwn(result.patch,'findings')&&!Object.hasOwn(result.patch,'riskAssessment')&&!Object.hasOwn(result.patch,'affinity'));
assert.equal(result.patch.sourceInsights.moments.status,'analyzed');
assert.deepEqual(result.patch.sourceInsights.moments.savedMetadata,{kept:true});
assert.equal(result.patch.sourceInsights.moments.summary,raw.sourceInsights.moments.summary,'partial moments patch preserves already saved summary');
assert.equal(result.patch.sourceInsights.moments.interpretations.length,1);

calls=0;
const repaired=await upgradeHistoryGuidance(report,async messages=>{calls++;if(calls===1)return JSON.stringify({...response,replyOptions:[{...response.replyOptions[0],text:'发这个[图片/链接]给你'}]});assert.ok(JSON.parse(messages[1].content).repair.issues.includes('reply_contains_placeholder_or_instruction'));return JSON.stringify(response);});
assert.equal(repaired.attempts,2);assert.equal(calls,2);
for(const invalid of [
 {},
 {...response,replyOptions:[{...response.replyOptions[0],evidenceIds:['made-up']}]},
 {...response,actionPlan:{steps:[{...step,evidenceIds:['made-up']}]}},
 {...response,sourceInsights:{moments:{interpretations:[{...response.sourceInsights.moments.interpretations[0],dimension:'图文对照'}]}}},
]){calls=0;await assert.rejects(()=>upgradeHistoryGuidance(report,async()=>{calls++;return JSON.stringify(invalid)}),/原报告已保留/);assert.equal(calls,2,'invalid data has only one bounded repair');}
calls=0;await assert.rejects(()=>upgradeHistoryGuidance({...report,semanticHistory:{...semantic,riskAssessment:null}},async()=>{calls++;return JSON.stringify(response)}),/risk_assessment_invalid/);assert.equal(calls,2,'maintenance cannot waive a bad historical risk assessment');
await assert.rejects(()=>upgradeHistoryGuidance({semanticHistory:{findings:[]}},async()=>assert.fail('must not call provider without evidence')),/已核实依据/);

// Optional private local fixture is read only; no chat, identity or original
// prose is printed. The callback is a deterministic mock, never a paid model.
if(process.argv[2]){
 const snapshot=JSON.parse(readFileSync(process.argv[2],'utf8'));const saved=snapshot.report||snapshot.response?.report||snapshot;
 const before=JSON.stringify(saved);let count=0;
 const upgraded=await upgradeHistoryGuidance(saved,async messages=>{
  count++;const payload=JSON.parse(messages[1].content),current=payload.currentGuidance;
  const replyOptions=(current.replyOptions||[]).map((item,index)=>({...item,text:index?'这个话题，你想先聊哪一部分？':'你刚说的这件事，后来怎么样了？'}));
  const actionPlan={...current.actionPlan,steps:(current.actionPlan?.steps||[]).map(step=>({...step,reply:'你刚说的这件事，后来怎么样了？'}))};
  return JSON.stringify({...current,replyOptions,actionPlan});
 });
 assert.equal(upgraded.strictValidated,true);assert.equal(count,1);assert.equal(JSON.stringify(saved),before);
 assert.ok(upgraded.patch.actionPlan.steps.length);
 console.log('PASS private saved-report schema, affinity reconstruction, full strict validation, no input mutation; 1 mock call.');
}
console.log('PASS guidance maintenance: strict full-report gate, whitelist patch, nested metadata, bounded repair, no network or credits.');
