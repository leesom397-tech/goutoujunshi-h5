import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
function load(file,mocks={},cache=new Map()){
 const full=path.resolve(file);if(cache.has(full))return cache.get(full);const out={};cache.set(full,out);
 const code=ts.transpileModule(readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','require',code)(out,name=>{if(name in mocks)return mocks[name];if(name.startsWith('.'))return load(path.resolve(path.dirname(full),name+'.ts'),mocks,cache);throw Error(name)});return out;
}
const {relationshipEvidenceReview:review}=load('lib/relationship-evidence.ts');
const {reportUpdateHighlights:highlights}=load('lib/report-update-highlights.ts');
const row=(text,speaker='other',sourceId)=>({text,speaker,sourceId});
const report=(n,lines)=>({id:'r'+n,createdAt:n*1000,report:{subjectId:'person',lines:lines.map((line,i)=>({id:'l'+i,sourceAt:`2026-10-${String(n).padStart(2,'0')}`,...line}))}});
const run=reports=>review({},'person',reports.at(-1).id,reports);
const first=report(1,[row('我介意你又打断我，可以听我说完吗？','self'),row('没什么好谈的，你太敏感。')]);
const second=report(2,[row('我介意你又打断我，可以听我说完吗？','self'),row('没什么好谈的，你太敏感。')]);
let result=run([first,second]);assert.equal(result.cards[0].kind,'pattern');assert.equal(result.cards[0].sources.length,4);
assert.equal(highlights({evidenceReview:result},'r2').cards.length,1,'same words on distinct actual dates remain a recurring observation');
assert.equal(review({},'person','r1',[first,second]).cards.length,0,'old focus excludes later evidence');
for(const transform of [r=>r.report.lines.forEach(line=>delete line.sourceAt),r=>r.report.lines.forEach((line,i)=>line.sourceId='same-'+i)]){
 const pair=structuredClone([first,second]);pair.forEach(transform);assert.equal(run(pair).cards.filter(c=>c.kind==='pattern').length,0,'no fabricated repetition from undated or duplicated records');
}
const bad=structuredClone([first,second]);bad[1].report.subjectId='different';assert.equal(review({},'person','r1',bad).cards.length,0);
const service=run([report(1,[row('周二两点到店，我给你看电脑。')]),report(2,[row('周五三点来取电脑。')])]).cards.find(c=>c.kind==='pattern');assert.ok(service);assert.match(service.reading,/维修.*不能直接解释成好感/);
for(const answer of ['我愿意听你说，我们一起商量。','现在没空，晚上再聊。','她说没什么好谈的。']){
 const pair=[1,2].map(n=>report(n,[row('我有点不舒服，可以说清楚吗？','self'),row(answer)]));
 assert.equal(run(pair).cards.filter(c=>c.kind==='pattern').length,answer.startsWith('我愿意')?1:0);
}
const conflict=report(3,[row('我介意这次又加价，说好的费用变了。','self'),row('抱歉，我会提前确认费用。'),row('好的。','self')]);
let repair=run([conflict]).cards.find(c=>c.kind==='repair');assert.ok(repair);assert.equal(repair.steps.length,4);assert.match(repair.steps[2].detail,/不代表问题解决/);assert.equal(repair.steps[3].status,'unknown');
const recurrence=report(5,[row('我介意这次又加价，费用又变了。','self')]);
repair=run([conflict,recurrence]).cards.find(c=>c.kind==='repair');assert.ok(repair);assert.equal(repair.steps[3].status,'reappeared');assert.match(repair.reading,/核对是否同一约定/);
const noResponse=structuredClone(conflict);noResponse.report.lines.pop();repair=run([noResponse]).cards.find(c=>c.kind==='repair');assert.equal(repair.steps[2].status,'unknown');
const follow=structuredClone(conflict);follow.report.lines[2].text='这次按原来确认的费用付了。';repair=run([follow]).cards.find(c=>c.kind==='repair');assert.match(repair.steps[2].detail,/落实的自述/);
const distant=report(20,[row('抱歉，我会提前确认费用。')]);assert.equal(run([report(3,[conflict.report.lines[0]]),distant]).cards.filter(c=>c.kind==='repair').length,0,'distant unrelated apology does not close a conflict');
const stop=report(6,[row('不要再联系我。')]);assert.equal(run([conflict,recurrence,stop]).cards[0].kind,'change','explicit boundary stays above insights');
const quoted=report(3,[row('她说我介意这次又加价。','self'),row('抱歉，我会退费用。')]);assert.equal(run([quoted]).cards.length,0);
console.log('PASS relationship patterns: dated independent evidence, dedup, scope, ordinary service context, repair stages, recurrence, boundaries and quoted material.');

const {sharedExperienceCandidates:candidates}=load('lib/crush/shared-experiences.ts',{'@/db':{getD1(){throw Error('no real database')}},'../relationship-evidence-server':{}});
const fact=(quote,extra={})=>({id:'accepted-memory',status:'accepted',evidence:quote,event_meta:JSON.stringify({kind:'conversation-profile',basis:'statement',speaker:'self',sourceReportId:'r1'}),...extra});
const draft='周末一起看展吗？',allowed=new Set(['r1']);
const experience=candidates([fact('上次和你一起看展很开心。')],draft,allowed);assert.equal(experience.length,1);assert.equal(experience[0].anchor,'说起上次一起看展');
for(const text of ['我喜欢看展。','上次我自己看展很开心。','上次和你约好一起看展。','上次和你聊了看展的事。','上次和你一起看展没有去成。','如果上次和你一起看展就好了。','她说上次和你一起看展很开心。','上次和你一起看展吗？','上次和你一起看展不舒服。'])assert.equal(candidates([fact(text)],draft,allowed).length,0,text);
assert.equal(candidates([fact('上次和你一起看展很开心。',{status:'pending'})],draft,allowed).length,0);
assert.equal(candidates([fact('上次和你一起看展很开心。')],draft,new Set(['other-person-report'])).length,0);
assert.equal(candidates([fact('上次和你一起看展很开心。')],'明天修电脑吗？',allowed).length,0);
assert.equal(candidates([fact('上次和你一起看展很开心。')],'不要再找我看展。',allowed).length,0);
assert.equal(candidates([fact('上次和你一起看展很开心。',{event_meta:JSON.stringify({kind:'conversation-profile',basis:'inference',speaker:'self',sourceReportId:'r1'})})],draft,allowed).length,0);
const serviceExperience=candidates([fact('上次和你修电脑很顺利。')],'这台电脑维修进展怎么样？',allowed);assert.equal(serviceExperience[0].anchor,'说起上次那次电脑维修');
assert.equal(candidates([fact('上次你帮我修了电脑，一直用着很正常。')],'电脑维修好了吗？',allowed).length,1);
const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE coach_profiles(owner_id TEXT,consent_at INTEGER,paused INTEGER);CREATE TABLE coach_facts(id TEXT,owner_id TEXT,subject_id TEXT,status TEXT,evidence TEXT,event_meta TEXT,created_at INTEGER)');
sql.prepare('INSERT INTO coach_profiles VALUES (?,?,?)').run('owner',1,0);
for(const [id,owner,person,status,source]of [['mine','owner','person','accepted','r1'],['self','owner',null,'accepted','r1'],['pending','owner','person','pending','r1'],['foreign','foreign','person','accepted','r1'],['wrong-person','owner','other','accepted','r1'],['wrong-source','owner',null,'accepted','wrong']]){const item=fact('上次和你一起看展很开心。');const meta=JSON.parse(item.event_meta);meta.sourceReportId=source;sql.prepare('INSERT INTO coach_facts VALUES (?,?,?,?,?,?,?)').run(id,owner,person,status,item.evidence,JSON.stringify(meta),1);}
let revokeAfterRead=false;
const db={prepare(query){let args=[];return{bind(...values){args=values;return this},async first(){return sql.prepare(query).get(...args)||null},async all(){const results=sql.prepare(query).all(...args);if(revokeAfterRead)sql.prepare('UPDATE coach_profiles SET paused=1').run();return{results}}}}};
const server=load('lib/crush/shared-experiences.ts',{'@/db':{getD1:()=>db},'../relationship-evidence-server':{loadRelationshipEvidence:async(owner,person)=>({authorized:owner==='owner',validFocus:person==='person',reports:[{id:'r1'}]})}});
let selected=await server.loadSharedExperiences('owner','person','r2',draft);assert.equal(selected.length,1);assert.ok(['mine','self'].includes(selected[0].id),'only accepted owner/person or same-source self facts enter');
assert.deepEqual(await server.loadSharedExperiences('owner','other','r2',draft),[]);assert.deepEqual(await server.loadSharedExperiences('owner',null,'r2',draft),[]);
revokeAfterRead=true;assert.deepEqual(await server.loadSharedExperiences('owner','person','r2',draft),[],'pausing while facts load stops outbound enrichment');sql.close();
let calls=0,answer={text:'周末一起看展呀？',experienceId:'accepted-memory'},loaded=0;
const samples=['好呀，我看看具体安排再跟你说～','行，那就到时候再确认一下呀。','我应该有空，可以问问你嘛？'];
const rewrite=load('lib/crush/reply-rewrite.ts',{'@/db':{getD1:()=>({prepare:()=>({bind(){return this},run:async()=>({meta:{changes:1}})})})},'./service':{getSettings:async()=>({consent_at:1}),ownedReport:async()=>({id:'r2',subjectId:'person',threadId:'t',lines:samples.map(text=>({speaker:'self',text})),decision:{replyOptions:[{text:draft,weight:100}]}})},'./shared-experiences':{loadSharedExperiences:async()=>{loaded++;return loaded===4?[]:experience}},'@/lib/qwen':{qwenChat:async messages=>{calls++;const data=JSON.parse(messages[1].content);assert.equal(data.sharedExperiences[0]?.quote,'上次和你一起看展很开心。');return JSON.stringify(answer)},parseQwenJson:JSON.parse}});
let output=await rewrite.rewriteReply('owner','r2',0);assert.equal(calls,1);assert.equal(output.text,'说起上次一起看展，周末一起看展呀？');assert.equal(output.experienceEvidence[0].sourceReportId,'r1');
await assert.rejects(rewrite.rewriteReply('owner','r2',0),/共同经历档案已改变/,'removing confirmation while model runs prevents stale use');
answer={text:'周末一起看展呀？',experienceId:'invented'};await assert.rejects(rewrite.rewriteWithSamples(draft,samples,experience),/来源未通过/);
answer={text:'周末一定一起看展呀？',experienceId:'accepted-memory'};await assert.rejects(rewrite.rewriteWithSamples(draft,samples,experience),/承诺/);
answer={text:'周末一起看展呀？',experienceId:''};output=await rewrite.rewriteWithSamples(draft,samples,experience);assert.equal(output.experienceEvidence,undefined,'model can leave irrelevant memory out');
console.log('PASS shared experiences: accepted explicit completed events only, same-source scope, topic/boundary gating, one model call, immutable grounded prefix, revocation and commitment protection.');
