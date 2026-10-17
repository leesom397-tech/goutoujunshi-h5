import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
const nativeRequire=createRequire(import.meta.url);
const load=(file,mocks={},cache=new Map())=>{
  const path=resolve(file);if(cache.has(path))return cache.get(path);
  const exports={};cache.set(path,exports);
  const js=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','require',js)(exports,name=>{
    if(name in mocks)return mocks[name];
    if(name.startsWith('@/')||name.startsWith('.')){
      let next=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(path),name);
      if(!/\.(?:ts|mjs|json)$/.test(next))next+='.ts';
      return load(next,mocks,cache);
    }return nativeRequire(name);
  });return exports;
};
const pure=load('lib/conversation-profile-memory.ts');
const lines=[
  {localId:'self-interest',senderRole:'self',at:'2026-10-01 12:00',text:'我平时喜欢摄影，周末常去拍建筑。',kind:'text'},
  {localId:'self-city',senderRole:'self',at:'2026-10-01 12:01',text:'我现在住广州。',kind:'text'},
  {localId:'self-boundary',senderRole:'self',at:'2026-10-01 12:02',text:'我不接受临时加价。',kind:'text'},
  {localId:'other-occupation',senderRole:'other',at:'2026-10-01 12:03',text:'我现在做汽车维修。',kind:'text'},
  {localId:'other-goal',senderRole:'other',at:'2026-10-01 12:04',text:'我想把维修流程做得更清楚。',kind:'text'},
  {localId:'other-style',senderRole:'other',at:'2026-10-01 12:05',text:'我发你一份费用清单，先确认再修。',kind:'text'},
];
const candidates=[
  {sourceId:'self-interest',target:'self',field:'interests',value:'喜欢摄影，周末拍建筑',quote:lines[0].text,basis:'statement'},
  {sourceId:'self-city',target:'self',field:'city',value:'广州',quote:lines[1].text,basis:'statement'},
  {sourceId:'self-boundary',target:'self',field:'boundaries',value:'不接受临时加价',quote:lines[2].text,basis:'statement'},
  {sourceId:'other-occupation',target:'subject',field:'occupation',value:'汽车维修',quote:lines[3].text,basis:'statement'},
  {sourceId:'other-goal',target:'subject',field:'goals',value:'想把维修流程做得更清楚',quote:lines[4].text,basis:'statement'},
  {sourceId:'other-style',target:'subject',field:'communicationStyle',value:'可能偏好先写清费用，也可能只是这次维修流程要求。',quote:lines[5].text,basis:'inference'},
];
assert.equal(pure.cleanConversationProfileCandidates(candidates,lines).length,6);
for(const candidate of [
  {...candidates[0],target:'subject'}, {...candidates[0],sourceId:'absent'},
  {...candidates[0],quote:'我喜欢养狗，这不是原文。'}, {...candidates[0],field:'income'},
  {...candidates[0],basis:'inference'}, {...candidates[5],field:'occupation'},
]) assert.equal(pure.cleanConversationProfileCandidates([candidate],lines).length,0);
assert.equal(pure.cleanConversationProfileCandidates([candidates[0]], [{...lines[0],kind:'sticker'}]).length,0);
assert.equal(pure.cleanConversationProfileCandidates([candidates[0]], [...lines,{...lines[0],senderRole:'other'}]).length,0);
assert.equal(pure.cleanConversationProfileCandidates([candidates[0],candidates[0]],lines).length,1);
for(const text of ['你喜欢摄影吗？','我朋友说他喜欢摄影。','如果我住广州就好了。'])assert.equal(pure.cleanConversationProfileCandidates([{...candidates[0],quote:text}], [{...lines[0],text}]).length,0);
assert.throws(()=>pure.conversationMemoryLines([...lines,{...lines[0],text:'different'}]),/来源不一致/);
assert.deepEqual(pure.modelConversationMemoryLines(lines).map(line=>line.localId),['M1','M2','M3','M4','M5','M6']);
assert.equal(pure.resolveConversationMemoryAliases([{...candidates[0],sourceId:'M1'}],lines)[0].sourceId,'self-interest');
assert.equal(pure.cleanConversationProfileCandidates(pure.resolveConversationMemoryAliases([{...candidates[0],sourceId:'M999'}],lines),lines).length,0);
assert.equal(pure.cleanConversationProfileCandidates([{sourceId:'skill',target:'self',field:'strengths',basis:'statement',quote:'我拍照很厉害。',value:'自述擅长拍照'}],[{localId:'skill',senderRole:'self',at:'',text:'以后我给你拍，我拍照很厉害。',kind:'text'}]).length,1);
for(const statement of ['我已经到杭州了。','我在南京。','我出差住在苏州酒店。','我老家在武汉。','我以前住在成都。'])assert.equal(pure.cleanConversationProfileCandidates([{...candidates[1],quote:statement}], [{...lines[1],text:statement}]).length,0,'visits and former locations are not current residence');
for(const statement of ['我目前常住成都。','我住在南京。','我现在住广州。'])assert.equal(pure.cleanConversationProfileCandidates([{...candidates[1],quote:statement}], [{...lines[1],text:statement}]).length,1,'explicit present residence remains eligible');
for(const statement of ['他说：“我住在南京”。','要是我住在南京，就方便了。','我朋友告诉我他以前说“我住在南京”。','我开玩笑说“我住在南京”。'])assert.equal(pure.cleanConversationProfileCandidates([{...candidates[1],quote:'我住在南京'}], [{...lines[1],text:statement}]).length,0,'short quotes cannot bypass full-source attribution checks');

const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
const db={prepare(query){return {values:[],bind(...values){this.values=values;return this;},async first(){return sql.prepare(query).get(...this.values)||null;},async all(){return {results:sql.prepare(query).all(...this.values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...this.values).changes)}};}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const stmt of statements)result.push(await stmt.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const owner='synthetic-memory-owner',foreign='synthetic-other-owner',subject=crypto.randomUUID(),foreignSubject=crypto.randomUUID(),report=crypto.randomUUID();
sql.prepare('INSERT INTO coach_profiles(owner_id,consent_at,paused,data,updated_at) VALUES(?,1,0,?,1)').run(owner,JSON.stringify({city:'上海',boundaries:''}));
sql.prepare('INSERT INTO coach_profiles(owner_id,consent_at,paused,data,updated_at) VALUES(?,1,0,?,1)').run(foreign,'{}');
for(const [id,who] of [[subject,owner],[foreignSubject,foreign]])sql.prepare("INSERT INTO coach_subjects(id,owner_id,label,status,data,created_at,updated_at) VALUES(?,?,'合成维修联系人','active',?,1,1)").run(id,who,JSON.stringify({occupation:'电脑维修'}));
const server=load('lib/conversation-profile-memory-server.ts',{'@/db':{getD1:()=>db}});
const scope=await server.conversationMemoryScope(owner,subject,db);
let result=await server.saveConversationProfileMemory(owner,report,candidates,lines,scope,db);
assert.equal(result.pendingCount,6);assert.equal(result.selfCount,3);assert.equal(result.subjectCount,3);
assert.equal(result.items.filter(item=>item.conflict).length,3);
const rephrased=await server.saveConversationProfileMemory(owner,crypto.randomUUID(),[{...candidates[0],value:'自述喜欢摄影'}],lines,scope,db);
assert.equal(rephrased.items[0].id,result.items[0].id);assert.equal(rephrased.items[0].value,result.items[0].value,'same source/field reuses existing wording');assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM coach_facts').get().n,6);
assert.deepEqual(JSON.parse(sql.prepare('SELECT data FROM coach_profiles WHERE owner_id=?').get(owner).data),{city:'上海',boundaries:''},'proposals never modify profile');
assert.equal((await server.saveConversationProfileMemory(owner,crypto.randomUUID(),candidates,lines,scope,db)).items[0].id,result.items[0].id);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM coach_facts').get().n,6,'repeat import is idempotent');
assert.equal(await server.conversationMemoryScope(owner,foreignSubject,db),null);
sql.prepare('UPDATE coach_profiles SET paused=1 WHERE owner_id=?').run(owner);
assert.equal((await server.saveConversationProfileMemory(owner,report,candidates,lines,scope,db)).status,'disabled');
sql.prepare('UPDATE coach_profiles SET paused=0,consent_at=2 WHERE owner_id=?').run(owner);
assert.equal((await server.saveConversationProfileMemory(owner,report,candidates,lines,scope,db)).status,'disabled','revocation and reconsent invalidates old task');
sql.prepare('UPDATE coach_profiles SET consent_at=1 WHERE owner_id=?').run(owner);

const mocks={'@/db':{getD1:()=>db},'@/lib/miniapp-auth':{miniappOwner:async()=>({ownerId:owner})},'@/lib/crush/service':{deleteCrush:async()=>assert.fail('no deletion')}};
const api=load('app/api/miniapp/profile/route.ts',mocks);
const publicId=crypto.randomUUID();sql.prepare('INSERT INTO coach_credit_accounts(owner_id,public_id,created_at,updated_at) VALUES(?,?,1,1)').run(owner,publicId);
const wrongAccount=await api.POST(new Request('https://synthetic.test/api/web/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'fact-decide',decision:'reject',id:result.items[0].id,expectedOwnerId:crypto.randomUUID()})}));
assert.equal(wrongAccount.status,409,'a different public account cannot mutate facts');assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM coach_facts').get().n,6);
const accepted=await api.POST(new Request('https://synthetic.test/api/web/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'fact-decide-many',decision:'accept',ids:result.items.map(item=>item.id),expectedOwnerId:publicId})}));
assert.equal(accepted.status,200,await accepted.text());
const self=JSON.parse(sql.prepare('SELECT data FROM coach_profiles WHERE owner_id=?').get(owner).data);
const other=JSON.parse(sql.prepare('SELECT data FROM coach_subjects WHERE id=?').get(subject).data);
assert.equal(self.interests,'喜欢摄影，周末拍建筑');assert.equal(self.city,'上海');assert.equal(self.boundaries,'','an intentional clear is preserved');
assert.equal(other.occupation,'电脑维修');assert.equal(other.goals,'想把维修流程做得更清楚');assert.equal(other.communicationStyle,undefined,'inference remains an annotated clue');
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM coach_facts WHERE status='accepted'").get().n,6);
const context=load('lib/profile-context.ts',{'@/db':{getD1:()=>db}});
const profileText=await context.loadProfileContext(owner,subject);
assert.match(profileText,/摄影/);assert.match(profileText,/待验证推测/);assert.match(profileText,/维修/);
const personal=load('lib/personal-context-server.ts',{'@/db':{getD1:()=>db}});
const history=await personal.loadPersonalContext(owner,subject,db);
assert.ok(history.evidence.some(item=>item.side==='self'&&item.quote.includes('摄影')));
assert.ok(history.evidence.some(item=>item.side==='other'&&item.quote.includes('费用清单')&&item.basis==='observation'));
assert.ok(history.evidence.some(item=>item.quote.includes('汽车维修')&&item.basis==='observation'),'conflicting confirmed clue cannot overwrite present profile');
sql.prepare('UPDATE coach_profiles SET paused=1 WHERE owner_id=?').run(owner);
assert.equal(await context.loadProfileContext(owner,subject),'');
assert.equal((await personal.loadPersonalContext(owner,subject,db)).authorized,false);

// The existing two annotation batches remain two calls. Historical text is
// attached solely to the last existing summary call, never to every batch.
const modelRequests=[];
const screenshot=load('lib/crush/screenshot.ts',{
  'cloudflare:workers':{env:{}},
  '@/lib/qwen':{parseQwenJson:JSON.parse,qwenPublicError:(_e,fallback)=>fallback,qwenKey:()=>true,qwenChat:async(messages,options)=>{
    const input=JSON.parse(messages[1].content);modelRequests.push({input,options});
    if(input.profileMemoryLines)assert.match(messages[0].content,/必须先输出 memoryCandidates/);
    return JSON.stringify({memoryCandidates:input.profileMemoryLines?candidates.map((candidate,index)=>({...candidate,sourceId:'M'+(index+1)})):[],annotations:(input.targetIndices||input.lines.map((_,i)=>i)).map(()=>[[],[],"limited","明确陈述可见事项，不推测恋爱意图。"]),shouldReply:false,replyOptions:[],judgment:'双方在确认维修事项。'});
  }},
  '@/lib/knowledge':{selectKnowledge:()=>[]},
});
const quick={layout:'wechat-one-to-one',lines:lines.map(line=>[line.senderRole==='self'?'right':'left','text',line.text])};
const prepared=await screenshot.readScreenshotFromQuick(quick,'right',[],'x'.repeat(3000)+'本人已确认兴趣：摄影',30000,undefined,4,undefined,false,lines);
assert.equal(modelRequests.length,2,'no extra memory model request');
assert.equal(modelRequests.filter(row=>row.input.profileMemoryLines).length,1,'history appears only in summary');
assert.match(modelRequests.find(row=>row.input.profileMemoryLines).input.profile,/摄影/,'summary retains confirmed self interests');
assert.ok(modelRequests.filter(row=>!row.input.profileMemoryLines).every(row=>row.input.profile.length<=1000));
assert.equal(prepared.decision.memoryCandidates.length,6);
assert.deepEqual(prepared.decision.memoryDiagnostics,{sourceCount:6,receivedCount:6,acceptedCount:6,supplementalCount:0,totalCount:6,fieldPresent:true});
assert.equal(prepared.decision.memoryCandidates[0].sourceId,'self-interest','short transport ID never replaces a durable source');
const omittedMemory=screenshot.prepareQuickScreenshotAnalysis(quick,{annotations:quick.lines.map(()=>[[],[],"limited","明确陈述可见事项。"]),shouldReply:false},'right',lines);
assert.equal(omittedMemory.decision.memoryDiagnostics.fieldPresent,false,'missing model field stays distinguishable from an explicit empty array');
const missingSkill=screenshot.prepareQuickScreenshotAnalysis(quick,{annotations:quick.lines.map(()=>[[],[],"limited","明确陈述可见事项。"]),shouldReply:false},'right',[{localId:'skill-supplement',senderRole:'self',at:'',kind:'text',text:'我擅长制作模型。'}]);
assert.equal(missingSkill.decision.memoryCandidates.length,1,'explicit source statements supplement a model omission without another call');
assert.equal(missingSkill.decision.memoryDiagnostics.acceptedCount,0);assert.equal(missingSkill.decision.memoryDiagnostics.supplementalCount,1);
console.log('Conversation profile memory passed: source attribution, evidence, inference, conflicts, replay, consent, confirmation, downstream context. No private data or model calls.');
