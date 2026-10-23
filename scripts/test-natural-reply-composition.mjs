// Behavioral checks use only synthetic material and local modules, never providers.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const load=async file=>{const b=await build({entryPoints:[file],bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'});const m={exports:{}};new Function('module','exports',b.outputFiles[0].text)(m,m.exports);return m.exports;};
const {normalizeReplyChoices:normalize,replyVoiceSamples}=await load('lib/reply-composition.ts');
const browser=await build({stdin:{contents:'import {normalizeReplyChoices} from "./lib/reply-composition"; console.log(normalizeReplyChoices([]));',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});
assert.doesNotMatch(browser.outputFiles[0].text,/先判互动目的|context-consistent/, 'client reply helpers do not bundle generation skill text');
for(const minify of [false,true]){
 const shared=await build({stdin:{contents:'import {cleanMomentsReport} from "./lib/moments-report"; import {normalizeReplyChoices} from "./lib/reply-composition"; console.log(cleanMomentsReport({summary:"demo"}),normalizeReplyChoices([]));',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',minify,logLevel:'silent'});
 assert.doesNotMatch(shared.outputFiles[0].text,/context-consistent|tomwong001|humanizer-zh|chat-skills\.generated/,`shared Moments and reply cleaners exclude generation skills (minify=${minify})`);
}
// The real report reader is the relevant dependency boundary. Vite may strip
// pure annotations between stages, so this test deliberately ignores them and
// requires server guidance modules to be absent from the dependency graph.
const example=await build({entryPoints:['components/web-analysis/AnalysisExample.tsx'],bundle:true,write:false,format:'esm',platform:'browser',packages:'external',metafile:true,ignoreAnnotations:true,logLevel:'silent',plugins:[{name:'omit-css-only',setup(build){build.onLoad({filter:/\.css$/},()=>({contents:'export default {};',loader:'js'}));}}]});
assert.ok(example.metafile.inputs['components/web-analysis/ReportView.tsx'],'the real report component, not a stub, is bundled');
assert.ok(example.metafile.inputs['lib/moments-report.ts'],'the actual shared cleaner dependency is exercised');
assert.ok(!Object.keys(example.metafile.inputs).some(path=>/lib\/(?:chat-skill-adapter|chat-skills\.generated|reply-guidance|moments-guidance|history-guidance-quality)\./.test(path)),'browser report dependencies have no link to generation skills, even without pure annotations');
assert.doesNotMatch(example.outputFiles[0].text,/context-consistent|tomwong001|humanizer-zh|chat-skills\.generated/,'the complete AnalysisExample bundle has no generation skill text');
const skills=JSON.parse(readFileSync('lib/chat-skills.generated.json','utf8')),manifest=JSON.parse(readFileSync('third-party/chat-skills/manifest.json','utf8'));
const {reviewedChatSkillContext,CHAT_SKILL_REVISIONS}=await load('lib/chat-skill-adapter.ts');
for(const skill of skills){const pinned=manifest.skills.find(x=>x.id===skill.id);assert.match(skill.revision,/^[a-f0-9]{40}$/);assert.equal(skill.revision,pinned.revision);assert.ok(reviewedChatSkillContext('reply').includes(skill.content));}
assert.deepEqual(CHAT_SKILL_REVISIONS.map(x=>x.revision),skills.map(x=>x.revision));
assert.ok(!reviewedChatSkillContext('analysis').includes(skills.find(x=>x.id==='qingsheng').content),'pure editing need not load dating-stage examples');
const first={style:'接住分享',text:'五公里，今天跑爽了吧',reason:'对方刚分享跑完五公里'},second={label:'问个小细节',text:'今天跑的哪条路？',when:'对方正在分享这次跑步'};
assert.equal(normalize([first]).length,1,'one usable option does not require invented alternatives');
assert.deepEqual(normalize([first,second]).map(x=>x.label),['接住分享','问个小细节']);
assert.equal(normalize([first,{...first,text:'五公里 今天跑爽了吧！'},second]).length,2,'punctuation does not make a distinct option');
assert.equal(normalize([{...first,text:'我昨天也跑了[地点]'}]).length,0,'unfinished placeholders cannot become sendable replies');
assert.deepEqual(replyVoiceSamples([{senderRole:'self',text:'好耶'},{senderRole:'other',text:'不能学对方冒充本人'},{senderRole:'self',text:'这是模型解释',basis:'visual'},{senderRole:'self',sourceKind:'moments',text:'不是当前聊天口吻'},{senderRole:'self',text:'那周日见～'}]),['好耶','那周日见～']);
assert.equal(replyVoiceSamples(Array.from({length:10},(_,i)=>({senderRole:'self',text:String(i)}))).length,4,'voice samples remain small');
const {selectKnowledge}=await load('lib/knowledge.ts');
assert.match(selectKnowledge('聊天截图 怎么回','reply',1)[0].title,/实战话术编排器/,'a generic screenshot reply must select the actual composition reference');
assert.match(selectKnowledge('她说今天下雨，我想轻松自然一点','reply',1)[0].title,/场景感、松弛感/);
assert.match(selectKnowledge('她威胁我，怎么回','reply',1)[0].title,/法律安全|危机/,'ordinary tone changes must not displace explicit safety context');
assert.doesNotMatch(selectKnowledge('关系判断','decision',1)[0].title,/投入失衡/,'a neutral relationship question is not presumed imbalanced');
const {normalizeInteractionInsight}=await load('lib/crush/interaction-insight.ts');
const insight={label:'分享具体进展',observed:'对方说今天跑了五公里',interpretation:'对方正在分享刚完成的活动，可以回应这件事',alternative:'',verify:'先接今天跑步的具体体验'};
assert.equal(normalizeInteractionInsight(insight)?.alternative,'','clear ordinary exchanges do not need a manufactured competing explanation');
assert.equal(normalizeInteractionInsight({...insight,observed:''}),null,'observed evidence remains required');
const {cleanCommunicationReading}=await load('lib/communication-reading.ts'),{cleanSocialPhotoClues,mergeSocialPhotoInterpretations}=await load('lib/social-photo-clues.ts');
assert.equal(cleanCommunicationReading({hypotheses:[{title:'具体话题',evidence:'原文：周末登山',possibility:'从这次登山体验聊起',alternative:''}]})?.hypotheses.length,1,'saved communication readings do not need fabricated alternatives');
const photo={item:'山路',evidence:'图1可见登山步道',inference:'可聊这次路线的难度',alternative:''};
assert.equal(cleanSocialPhotoClues([photo])[0].inference,photo.inference);
assert.equal(cleanSocialPhotoClues([{...photo,evidence:''}]).length,0,'photo observations remain required');
assert.equal(mergeSocialPhotoInterpretations([{item:photo.item,evidence:photo.evidence}],[photo])[0].inference,photo.inference,'valid interpretations survive archival merge without a forced counter-story');
// Exercise the legacy route too: real composition rules, fake auth/model only.
let calls=0;
const route={},mocks={'@/app/chatgpt-auth':{getChatGPTUser:async()=>({userId:'synthetic'})},'@/lib/coach':await load('lib/coach.ts'),'@/lib/knowledge':{buildKnowledgeContext:()=>({instructions:'',sources:[]})},'@/lib/profile-context':{loadProfileContext:async()=>''},'@/lib/reply-paths':{parseReplyPaths:x=>x},'@/lib/reply-composition':await load('lib/reply-composition.ts'),'@/lib/qwen':{qwenKey:()=>true,parseQwenJson:JSON.parse,qwenPublicError:()=>'',qwenChat:async messages=>{calls++;for(const skill of skills)assert.ok(messages[0].content.includes(skill.content));return JSON.stringify({summary:'对方分享了这次跑步，接这件事即可。',options:[first,second]});}}};
const code=ts.transpileModule(readFileSync('app/api/chat/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','exports',code)(id=>{assert.ok(id in mocks,id);return mocks[id];},route);
const response=await route.POST(new Request('https://synthetic/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'reply',turns:[{role:'user',text:'对方说今天跑了五公里，怎么回？'}]})}));
assert.equal(response.status,200);assert.equal((await response.json()).replyOptions.length,2);assert.equal(calls,1,'skills are used in the existing request, not a rewrite pass');
console.log('PASS natural reply composition: one/two choices, dedupe, placeholders, original voice only, knowledge routing, optional uncertainty with evidence retained');
