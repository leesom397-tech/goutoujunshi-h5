import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),cache=new Map(),prompts=[];
const fakeDb={prepare(){return {bind(){return this;},async first(){return null;},async run(){return {meta:{changes:1}};}};}};
const overrides={
 '@/db':{getD1:()=>fakeDb},
 '@/lib/miniapp-auth':{miniappOwner:async()=>({ownerId:'synthetic-local-owner'})},
 '@/lib/profile-context':{loadProfileContext:async()=>''},
 '@/lib/credit-response.mjs':{creditResponse:async(_db,_owner,_request,_action,_cost,execute)=>execute()},
 '@/lib/qwen':{qwenKey:()=>true,parseQwenJson:JSON.parse,qwenPublicError:()=>{throw Error('unexpected model failure');},qwenChat:async messages=>{prompts.push(messages);return JSON.stringify({observation:'对方提出稍后再沟通。',judgment:'目前只能判断这次回应。',possibleIntent:'先把约定和后续行动分开核对。',evidence:'每次都是我道歉',nextStep:'先核对双方约好的下一次沟通。',replies:[]});}}
};
function load(path){
 path=resolve(path);if(cache.has(path))return cache.get(path);
 if(path.endsWith('.json'))return JSON.parse(readFileSync(path,'utf8'));
 const exports={};cache.set(path,exports);
 const compiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','exports',compiled)(name=>{
  if(overrides[name])return overrides[name];
  if(name.startsWith('@/')||name.startsWith('.')){const target=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(path),name);return load([target,target+'.ts',target+'.json'].find(existsSync));}
  return require(name);
 },exports);return exports;
}
const {selectKnowledge,buildKnowledgeContext,getKnowledgeStats}=load('lib/knowledge.ts');
const target='互动循环与修复复盘';
const cases=['看聊天记录，我越问越躲，怎么回？','道歉后又失约，想知道修复有没有落地','每次都是我道歉，如何复盘？','约定反复落空，我想看互动失衡','她说需要情绪支持，我该怎么回？','争吵后双方都冷静了，怎么重新谈？'];
for(const mode of ['reply','signal','decision'])for(const query of cases){const docs=selectKnowledge(query,mode,1);assert.equal(docs.length,1);assert.ok(docs[0].title.startsWith(target),`${mode}: ${query}`);}
for(const query of ['他说法前后矛盾，又让我投虚拟币转账','他说收入很高，约会后向我借钱投资']){
 const selected=selectKnowledge(query,'signal',1)[0];assert.ok(selected.title.startsWith('09-'),query+' must prioritize money solicitation');
 assert.ok(selected.content.slice(0,850).includes('先不转账、不继续追加'),'short callers receive actual money-risk guidance');
}
for(const query of ['约会后聊了收入和城市','多人比较时看看消费观','约会复盘：我做理财工作，他收入很高'])assert.ok(selectKnowledge(query,'signal',1)[0].title.startsWith('人物核对与多对象比较'),query+' is ordinary profile discussion');
assert.ok(selectKnowledge('对方威胁我转账投资','signal',1)[0].title.startsWith('17-'),'urgent danger remains first');
const guide=selectKnowledge(cases[0],'signal',1)[0];
const essentials=guide.content.slice(0,850);
for(const text of ['明确拒绝按拒绝理解','至少出现多个可核对片段','约定实际兑现','支持意愿','统一的三天或两周期限','安全与求助指引'])assert.ok(essentials.includes(text),`short callers retain ${text}`);
assert.ok(selectKnowledge('投入失衡且对方威胁和暴力','signal',1)[0].title.startsWith('17-'));
assert.ok(!selectKnowledge('第一次见面想自然开场邀约','reply',1)[0].title.startsWith(target));
assert.ok(selectKnowledge('朋友圈的公开表达与沟通风格','signal',1)[0].title.startsWith('公开表达与沟通倾向'));
for(const mode of ['reply','signal','decision']){const docs=selectKnowledge(cases[0],mode);assert.ok(docs.length<=3);assert.equal(new Set(docs.map(x=>x.id)).size,docs.length);}
const context=buildKnowledgeContext(cases[0],'signal');
assert.ok(context.instructions.startsWith('以下是 成子 核心规则'));assert.ok(!context.instructions.includes('LoveTalk'));
assert.ok(context.instructions.includes('修复状态不等于修复分数'));
assert.ok(context.sources.some(x=>x.label===target&&x.anchor.startsWith('guide-')));
const manifest=JSON.parse(readFileSync('lib/knowledge-manifest.generated.json','utf8'));
assert.equal(manifest.totalDocuments,getKnowledgeStats().total);
assert.ok(manifest.documents.some(x=>x.id===guide.id));
const miniModule={exports:{}};new Function('module',readFileSync('miniapp/lib/knowledge-stats.js','utf8'))(miniModule);const miniStats=miniModule.exports;assert.equal(miniStats.sourceCount,manifest.referenceDocuments);
const license=readFileSync('third-party/she-love-me/LICENSE','utf8');
assert.match(license,/MIT License/);assert.match(license,/Copyright \(c\) 2026 她不一样/);assert.match(license,/Permission is hereby granted/);
assert.ok(readFileSync('THIRD_PARTY_NOTICES.md','utf8').includes('third-party/she-love-me/LICENSE'));
// Exercise the actual shared quick-judgment prompt constructor with a model stub.
const {quickJudgment}=load('lib/crush/quick.ts');
const quick=await quickJudgment([{id:'synthetic',speaker:'self',text:'每次都是我道歉，想要情绪支持。'}]);
assert.ok(quick.includes('先给你一个快判断'));assert.ok(prompts.at(-1)[0].content.includes('# '+target));
assert.ok(prompts.at(-1)[0].content.includes('修复分开记录'));
// Exercise all actual text handler modes through the exact web re-export. All
// identity, SQL, credits and model calls are stubs; no network or paid requests.
const mini=load('app/api/miniapp/text/route.ts'),web=load('app/api/web/text/route.ts');assert.equal(web.POST,mini.POST);
for(const mode of ['chat','conversation','positioning']){
 const response=await web.POST(new Request('http://local.test/api/web/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,mode,other:'每次都是我道歉，约定反复落空。',self:'我想复盘互动失衡，也需要情绪支持。'})}));
 assert.equal(response.status,200);assert.equal((await response.json()).mode,mode);
 assert.ok(prompts.at(-1)[0].content.includes('# '+target),`${mode} actually receives adapted guide`);
 assert.ok(prompts.at(-1)[0].content.includes('不生成被爱指数'));
}
const comparisonTarget='人物核对与多对象比较';
const comparisonCases=['聊天记录有前后矛盾，怎么核对说法？','对比这几个对象，按我的需要判断','我在几个对象之间怎么选？','约会后想复盘事实和感受','如何自然验真对方的说法？','多人比较时有哪些信息还未知？'];
for(const mode of ['reply','signal','decision'])for(const query of comparisonCases)assert.ok(selectKnowledge(query,mode,1)[0].title.startsWith(comparisonTarget),mode+': '+query);
const comparison=selectKnowledge(comparisonCases[0],'signal',1)[0],shortComparison=comparison.content.slice(0,850);
for(const text of ['两条可比原话','来源与时间','生活变化','允许对方不回答','资料少不等于更差','不得强制排名','用户自己的感受','不能证明诚信'])assert.ok(shortComparison.includes(text),text+' retained in short prompt');
assert.ok(selectKnowledge('多人比较中发现暴力威胁和前后矛盾','signal',1)[0].title.startsWith('17-'));
assert.ok(buildKnowledgeContext(comparisonCases[1],'decision').sources.some(x=>x.label===comparisonTarget));
assert.ok(readFileSync('third-party/wechat-chat-analysis/UPSTREAM-LICENSE-NOTICE.md','utf8').includes('fd59b2d1d11f492acde2963d6d2560aa165ed653'));
assert.ok(readFileSync('third-party/wechat-chat-analysis/UPSTREAM-LICENSE-NOTICE.md','utf8').includes('No standalone LICENSE'));
await quickJudgment([{id:'synthetic-compare',speaker:'self',text:'这两条原话前后矛盾，帮我核对。'}]);
assert.ok(prompts.at(-1)[0].content.includes('# '+comparisonTarget));
for(const mode of ['chat','conversation','positioning']){
 const response=await web.POST(new Request('http://local.test/api/web/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,mode,other:'两条原话前后矛盾，想核对。',self:'对比这几个对象，按我的实际需要判断。'})}));
 assert.equal(response.status,200);assert.ok(prompts.at(-1)[0].content.includes('# '+comparisonTarget),mode+' actually receives comparison guide');
 assert.ok(prompts.at(-1)[0].content.includes('不得强制排名'));
}
assert.equal(prompts.length,8);
console.log('PASS: 36 focused route cases for both repositories plus financial-risk priority and neutral counterexamples; safety priority; unrelated intents; short-prompt safeguards; public source manifest and exact license provenance; 2 real quick prompts and all 3 shared text modes for each guide inject adapted content. All model/SQL/identity calls mocked; zero network or paid calls.');
