import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const deep={};new Function('exports',compile('lib/deep-inference-guidance.ts'))(deep);
const policies={};new Function('exports','require',compile('lib/analysis-depth.ts'))(policies,name=>{if(name==='./deep-inference-guidance')return deep;throw Error(name);});
for(const key of ['ANALYSIS_DEPTH_GUIDANCE','PROFILE_DEPTH_GUIDANCE','CHAT_DEPTH_GUIDANCE']) {
  assert.ok(policies[key].includes(policies.COMMUNICATION_STYLE_GUIDANCE),key+' uses shared style reasoning');
  assert.match(policies[key],/一次短回复/);
  assert.match(policies[key],/旧档案评价与新原话冲突时修正/);
}
const knowledge={};new Function('exports','require',compile('lib/knowledge.ts'))(knowledge,name=>{
  if(name==='./knowledge.generated.json')return {default:JSON.parse(fs.readFileSync('lib/knowledge.generated.json','utf8'))};
  if(name==='./knowledge-public')return {publicKnowledgeSources:ids=>ids};
  throw Error(name);
});
for(const query of ['朋友圈 沟通风格','社交资料 伴侣选择','聊天风格 怎么回']) {
  assert.ok(knowledge.selectKnowledge(query,'signal',2).some(x=>x.title.includes('公开表达与沟通倾向')),query+' retrieves actual bundled guide');
}
assert.match(knowledge.selectKnowledge('朋友圈 威胁 勒索','signal',2)[0].title,/安全/,'safety precedes style');
const route=fs.readFileSync('app/api/miniapp/social-profile/route.ts','utf8');
assert.match(route,/cleanCommunicationReading\(parsed\)\?\.approach/);
assert.match(route,/avoid、evidence、adjustWhen/);
const page=fs.readFileSync('miniapp/pages/social-profile/index.js','utf8');
assert.equal((page.match(/approach:this.data.result.approach/g)||[]).length,2,'new/existing profile archive retains approach');
const view=fs.readFileSync('miniapp/components/moments-report.wxml','utf8');
assert.match(view,/何时换方式/);
assert.match(fs.readFileSync('miniapp/pages/social-profile/index.wxml','utf8'),/approach:result.approach/);
assert.match(fs.readFileSync('miniapp/pages/archive/index.wxml','utf8'),/approach:item.communicationReading.approach/);
console.log('PASS communication style: shared rules, routed knowledge, safety priority, profile output/save/display and revision condition');
