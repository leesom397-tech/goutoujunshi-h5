import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as savedReports from '../lib/saved-reports.mjs';

// Synthetic identities only; there is no network, model, file upload or charge.
const cache = new Map();
let db;
function load(file) {
  const filename = path.resolve(file);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {}; cache.set(filename, exports);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports','require','fetch',code)(exports, name => {
    if (name === '@/db') return { getD1: () => db };
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename),name + (path.extname(name) ? '' : '.ts')));
    throw Error('Unexpected dependency: ' + name);
  }, () => assert.fail('No external requests allowed'));
  return exports;
}
const { personalConnection, reportPersonalEvidence, uniquePersonalEvidence, extractQuickSelfProfile, capturePersonalEvidence } = load('lib/personal-context.ts');
const { loadPersonalContext, personalizeReport } = load('lib/personal-context-server.ts');
const { cleanData } = load('lib/profile.ts');
let checks = 0;
function check(name, callback) { callback(); console.log('PASS',name); checks++; }
const line = (speaker,text,id=crypto.randomUUID()) => ({id,speaker,text});
const chat = lines => ({id:'fixture-chat',lines});
check('完整历史共同点扫描早期双方自述，不依赖最近12句逐句标注',()=>{
  const history = [{localId:'early-self',senderRole:'self',at:'2026-01-01',text:'我喜欢摄影'}, {localId:'early-other',senderRole:'other',at:'2026-01-02',text:'我也喜欢摄影'}, ...Array.from({length:675},(_,i)=>({localId:'filler-'+i,senderRole:'other',at:'2026-10-01',text:'收到'}))];
  const evidence = capturePersonalEvidence(history,'subject-a','full-report');
  const current = personalConnection({analysisScope:'fullHistory',subjectId:'subject-a',lines:[],profileEvidence:evidence});
  assert.ok(current.commonPoints.some(item=>item.id==='common-photography'));
  assert.ok(current.sources.some(item=>item.sourceId==='early-self'));
});
const paired = personalConnection(chat([line('self','我喜欢摄影，也喜欢看展。'),line('other','我也喜欢摄影，周末经常看展。')]));
check('双侧原话支持摄影和审美交集，每项必须同时有self+other',()=>{
  assert.equal(paired.commonPoints.length,2);
  for (const item of paired.commonPoints) assert.deepEqual(new Set(item.evidenceIds.map(id=>paired.sources.find(x=>x.id===id)?.side)),new Set(['self','other']));
});
check('单侧话题不冒充共同点',()=>{
  const report=personalConnection(chat([line('other','我喜欢摄影。')]));
  assert.equal(report.commonPoints.length,0); assert.equal(report.status,'insufficient');
  assert.equal(report.entryPoints[0].kind,'inference'); assert.match(report.entryPoints[0].reading,/不能算/);
});
check('unknown、原始左右侧和非规范user角色不映射到本人',()=>{
  for (const speaker of ['unknown','left','right','user']) assert.equal(personalConnection(chat([line(speaker,'我喜欢摄影'),line('other','我喜欢摄影')])).commonPoints.length,0);
});
check('第三方喜好、反问、否定与假设不算共同兴趣',()=>{
  for (const text of ['朋友喜欢摄影','你喜欢摄影吗','如果我喜欢摄影呢','我不是不喜欢摄影','以前我喜欢摄影','我不喜欢摄影']) assert.equal(personalConnection(chat([line('self',text),line('other','我喜欢摄影')])).commonPoints.length,0,text);
});
check('真实偏好差异标推测，保留原话和另一种解释',()=>{
  const r=personalConnection(chat([line('self','我喜欢摄影'),line('other','我不喜欢摄影')]));
  assert.equal(r.differences.length,1); assert.equal(r.differences[0].kind,'inference'); assert.ok(r.differences[0].alternative);assert.equal(r.commonPoints.length,0);
});
check('快速标签中的独立空间、真诚沟通与共同成长支持双侧比较',()=>{
  const r=personalConnection(chat([line('other','我重视独立空间、真诚沟通和共同成长')]),{evidence:[{id:'self-tags',side:'self',source:'self-profile',label:'已确认相处偏好',quote:'独立空间；真诚；坦诚沟通；共同成长'}]});
  assert.ok(['common-quiet','common-honesty','common-growth'].every(id=>r.commonPoints.some(x=>x.id===id)));
});
check('表情包及照片描述不推导养狗、事业心或婚恋目标',()=>{
  const r=personalConnection({...chat([line('self','我喜欢养狗'),line('other','【表情包文字】我家狗狗'),{...line('other','我喜欢摄影'),kind:'sticker'}]),photoClues:[{item:'西装与豪车',inference:'事业心强'}],hypotheses:[{possibility:'希望结婚'}]});
  assert.equal(r.commonPoints.length,0); assert.ok(!JSON.stringify(r).includes('事业心强'));
});
check('朋友圈照片场景仍是observation，不能冒充兴趣自述',()=>{
  const r=personalConnection({lines:[line('self','我喜欢摄影')],moments:{posts:[{content:'照片展示一台相机和风景',evidence:'第1张图：相机照片'}]}});
  assert.equal(r.commonPoints.length,0);assert.equal(r.sources.find(x=>x.source==='moments').basis,'observation');
});
check('转发别人的第一人称不当成本人的自述',()=>{
  const r=personalConnection({lines:[line('self','我喜欢摄影')],moments:{posts:[{content:'转发朋友的记录：“我喜欢摄影”',evidence:'第1条动态：“我喜欢摄影”'}]}});
  assert.equal(r.commonPoints.length,0);
});
check('明确配文支持交集，targetSelf不做自我对照',()=>{
  const report={lines:[line('self','我喜欢摄影')],moments:{posts:[{content:'我喜欢摄影',evidence:'第1条动态：“我喜欢摄影”'}]}};
  assert.equal(personalConnection(report).commonPoints.length,1); assert.equal(personalConnection({...report,targetSelf:true}).status,'self');
});
check('重复截图与跨来源副本按双方原文去重',()=>{
  const ev=reportPersonalEvidence(chat([line('self','我喜欢摄影。'),line('self','我喜欢摄影'),line('other','我喜欢摄影')]));
  assert.equal(ev.length,2);
  assert.equal(uniquePersonalEvidence([...ev,{...ev[0],source:'self-profile',id:'copy'}]).length,2);
});
check('模型伪造共同点与概率没有双侧sources就丢弃',()=>{
  const r=personalConnection({personalConnection:{version:1,commonPoints:[{title:'100%合适'}],sources:[]}});
  assert.equal(r.commonPoints.length,0);assert.ok(!JSON.stringify(r).includes('100%'));
});
check('婚恋目标只比较明确双方自述，差异不是诈骗标签',()=>{
  const r=personalConnection(chat([line('self','我希望认真恋爱'),line('other','我只想短期关系，不想承诺')]));
  assert.equal(r.differences[0]?.id,'expectation');assert.equal(r.differences[0]?.kind,'inference');
  assert.equal(personalConnection(chat([line('self','我希望认真恋爱'),line('other','她说她想结婚')])).differences.length,0);
});
check('本人有材料但无交集仍保留self来源，重开不误称缺本人资料',()=>{
  const r=personalConnection(chat([line('self','我习惯晚上散步'),line('other','我喜欢摄影')]));
  assert.ok(r.sources.some(x=>x.side==='self'));assert.equal(personalConnection({personalConnection:r}).status,r.status);
});
check('短自述本地草稿不创建人物、不把对方介绍归本人',()=>{
  const r=extractQuickSelfProfile('我喜欢摄影，也喜欢看展。我希望认真恋爱。我习惯直接沟通。他说他喜欢养狗。');
  assert.match(r.draft.interests,/摄影/);assert.match(r.draft.preferredRelationship,/认真恋爱/);assert.ok(r.draft.communicationStyle);
  assert.ok(!JSON.stringify(r).includes('养狗'));assert.equal(r.method,'local');
  assert.deepEqual(extractQuickSelfProfile('对方喜欢摄影，他希望结婚。').draft,{});
});
check('新增self字段白名单可保存且超长拒绝',()=>{
  assert.deepEqual(cleanData({interests:'摄影、看展',communicationStyle:'简短自然',secret:'drop'},'self'),{interests:'摄影、看展',communicationStyle:'简短自然'});
  assert.throws(()=>cleanData({interests:'长'.repeat(801)},'self'));
});

const sql=new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE coach_profiles(owner_id TEXT PRIMARY KEY,consent_at INTEGER,paused INTEGER,data TEXT,updated_at INTEGER);
CREATE TABLE coach_subjects(id TEXT PRIMARY KEY,owner_id TEXT,status TEXT,data TEXT,updated_at INTEGER);
CREATE TABLE coach_facts(owner_id TEXT,subject_id TEXT,field TEXT,value TEXT,status TEXT,created_at INTEGER,evidence TEXT,event_meta TEXT);
CREATE TABLE coach_saved_reports(id TEXT PRIMARY KEY,owner_id TEXT,subject_id TEXT,status TEXT,result TEXT,created_at INTEGER);
CREATE TABLE coach_crush_threads(id TEXT PRIMARY KEY,owner_id TEXT,subject_id TEXT);
CREATE TABLE coach_crush_reports(id TEXT PRIMARY KEY,owner_id TEXT,thread_id TEXT,status TEXT,result TEXT,created_at INTEGER);`);
db={prepare(query){let values=[];return{bind(...args){values=args;return this},async first(){return sql.prepare(query).get(...values)||null},async all(){return{results:sql.prepare(query).all(...values)}}}}};
for(const owner of ['owner-a','owner-b'])sql.prepare('INSERT INTO coach_profiles VALUES(?,1,0,?,1)').run(owner,JSON.stringify({interests:owner==='owner-a'?'摄影与看展':'仅其他账号秘密爱好'}));
for(const [id,owner] of [['subject-a','owner-a'],['subject-other','owner-a'],['subject-b','owner-b']])sql.prepare('INSERT INTO coach_subjects VALUES(?,?,\'active\',?,1)').run(id,owner,JSON.stringify({lifestyle:id==='subject-a'?'我喜欢摄影':'其他人物秘密内容'}));
sql.prepare('INSERT INTO coach_saved_reports VALUES(?,?,?,\'done\',?,1)').run('saved-a','owner-a','subject-a',JSON.stringify({subjectId:'subject-a',moments:{posts:[{content:'我周末喜欢看展',evidence:'第1条动态：“我周末喜欢看展”'}]}}));
sql.prepare('INSERT INTO coach_saved_reports VALUES(?,?,?,\'done\',?,2)').run('saved-wrong','owner-a','subject-a',JSON.stringify({subjectId:'subject-other',lines:[line('self','错误关联秘密内容')]}));
sql.prepare('INSERT INTO coach_saved_reports VALUES(?,?,?,\'done\',?,3)').run('saved-foreign','owner-b','subject-b',JSON.stringify(chat([line('self','其他账号聊天秘密内容')])));
sql.prepare('INSERT INTO coach_crush_threads VALUES(?,?,?)').run('thread-a','owner-a','subject-a');
sql.prepare('INSERT INTO coach_crush_reports VALUES(?,?,?,\'done\',?,4)').run('chat-a','owner-a','thread-a',JSON.stringify(chat([line('self','我喜欢看展'),line('other','我喜欢摄影')])));
sql.prepare('INSERT INTO coach_facts(owner_id,subject_id,field,value,status,created_at) VALUES(?,NULL,?,?,?,1)').run('owner-a','selfBasic:lifestyle','pending应不显示','pending');
const context=await loadPersonalContext('owner-a','subject-a',db);
check('owner+subject限定历史聚合，带原报告来源',()=>{
  const content=JSON.stringify(context);
  assert.ok(content.includes('saved-a'));assert.ok(content.includes('chat-a'));assert.ok(!/秘密|pending应/.test(content));
  assert.ok(context.evidence.some(x=>x.reportId==='saved-a'&&x.source==='moments'));
});
const foreign=await loadPersonalContext('owner-a','subject-b',db);
check('外人subjectId不能读取其档案/历史',()=>{
  assert.ok(foreign.evidence.every(x=>x.source==='self-profile'));assert.ok(!JSON.stringify(foreign).includes('秘密'));
});
const output=await personalizeReport('owner-a','subject-a',{lines:[line('other','我喜欢摄影')]});
check('真实服务端结果结合已授权self与同人物多个来源',()=>{
  assert.ok(output.commonPoints.some(x=>x.id==='common-photography'));assert.ok(output.commonPoints.some(x=>x.id==='common-art'));
});
const mismatched=await personalizeReport('owner-a','subject-other',{subjectId:'subject-a',lines:[line('other','我喜欢摄影')]});
check('当前报告与所选人物不一致时不混入历史',()=>{
  assert.equal(mismatched.commonPoints.length,0);assert.ok(!JSON.stringify(mismatched).includes('其他人物秘密'));
});
let profileReads=0;
const revokedDb={prepare(query){const base=db.prepare(query);return{bind(...args){base.bind(...args);return this},async first(){if(query.includes('FROM coach_profiles')&&++profileReads===2)return{consent_at:null,paused:1};return base.first()},async all(){return base.all()}}}};
const revoked=await loadPersonalContext('owner-a','subject-a',revokedDb);
check('读取期间撤回授权丢弃跨来源快照',()=>{assert.equal(revoked.authorized,false);assert.equal(revoked.evidence.length,0)});
let subjectReads=0;
const deletedDb={prepare(query){const base=db.prepare(query);return{bind(...args){base.bind(...args);return this},async first(){if(query.includes('FROM coach_subjects')&&++subjectReads===2)return null;return base.first()},async all(){return base.all()}}}};
const deleted=await loadPersonalContext('owner-a','subject-a',deletedDb);
check('读取期间删除人物不复用已删除人物原话',()=>{assert.ok(deleted.evidence.every(x=>x.source==='self-profile'))});
sql.prepare('UPDATE coach_profiles SET paused=1 WHERE owner_id=?').run('owner-a');
const paused=await loadPersonalContext('owner-a','subject-a',db);
check('暂停档案完全阻止历史材料复用',()=>{assert.equal(paused.authorized,false);assert.equal(paused.evidence.length,0)});
const currentOnly=await personalizeReport('owner-a','subject-a',chat([line('self','我喜欢摄影'),line('other','我喜欢摄影')]));
check('暂停后仍可就本次明确授权双方原话判断，不读历史',()=>{
  assert.equal(currentOnly.commonPoints.length,1);assert.ok(currentOnly.sources.every(x=>x.source==='chat'&&x.reportId==='fixture-chat'));
});
// Exercise the production GET route: new self data takes effect on an old saved
// report immediately. Nothing is persisted back and no model/credit API exists.
sql.exec("ALTER TABLE coach_saved_reports ADD COLUMN kind TEXT DEFAULT 'social'; ALTER TABLE coach_saved_reports ADD COLUMN image_count INTEGER DEFAULT 1;");
const routeId='3f11a441-f755-4e56-bd74-ff908a3d009c';
const historical={subjectId:'subject-a',summary:'保存时的原始结论',profileBasics:[{field:'lifestyle',value:'我喜欢摄影',evidence:'第1张图：“我喜欢摄影”'}]};
const historicalJson=JSON.stringify(historical);
sql.prepare("INSERT INTO coach_saved_reports(id,owner_id,subject_id,status,result,created_at) VALUES(?,?,?,'done',?,10)").run(routeId,'owner-a','subject-a',historicalJson);
sql.prepare('UPDATE coach_profiles SET paused=0,data=? WHERE owner_id=?').run(JSON.stringify({interests:'阅读'}),'owner-a');
const types=load('lib/crush/types.ts');let routeOwner='owner-a';
const mocks={
  '@/lib/miniapp-auth':{miniappOwner:async()=>({ownerId:routeOwner})},
  '@/lib/crush/service':{ownedReport:async()=>{throw new types.CrushError('报告不存在。',404)}},
  '@/lib/crush/types':types,'@/lib/relationship-context-server':{loadRelationshipFit:async()=>null},
  '@/db':{getD1:()=>db},'@/lib/saved-reports.mjs':savedReports,'@/lib/crush/evidence':{readableReport:value=>value},
  '@/lib/personal-context-server':load('lib/personal-context-server.ts'),
};
const route={};
const routeCode=ts.transpileModule(readFileSync('app/api/miniapp/report/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('exports','require','fetch',routeCode)(route,name=>{assert.ok(name in mocks,'unexpected GET dependency '+name);return mocks[name]},()=>assert.fail('GET cannot call an external model'));
const request=()=>new Request('https://fixture.test/api/web/report?id='+routeId);
const before=await(await route.GET(request())).json();
assert.ok(!before.report.personalConnection.commonPoints.some(x=>x.id==='common-photography'));
sql.prepare('UPDATE coach_profiles SET data=? WHERE owner_id=?').run(JSON.stringify({interests:'摄影'}),'owner-a');
const after=await(await route.GET(request())).json();
check('旧报告GET立即结合新本人资料，不重新收费、不改历史结论',()=>{
  assert.ok(after.report.personalConnection.commonPoints.some(x=>x.id==='common-photography'));
  assert.equal(after.report.summary,historical.summary);
  assert.equal(sql.prepare('SELECT result FROM coach_saved_reports WHERE id=?').get(routeId).result,historicalJson);
  assert.equal(after.report.personalConnectionContext.basis,'current-confirmed-material');
});
sql.prepare('UPDATE coach_saved_reports SET result=? WHERE id=?').run(JSON.stringify({...historical,compareWithSelf:false}),routeId);
const optedOut=await(await route.GET(request())).json();
check('旧报告明确关闭对照仍不复用本人资料',()=>{assert.equal(optedOut.report.personalConnection.commonPoints.length,0);assert.ok(optedOut.report.personalConnection.sources.every(x=>x.side==='other'))});
sql.prepare('UPDATE coach_saved_reports SET result=? WHERE id=?').run(JSON.stringify({...historical,targetSelf:true}),routeId);
const ownReport=await(await route.GET(request())).json();
check('本人报告GET不生成与自己的共同点',()=>{assert.equal(ownReport.report.personalConnection.status,'self')});
routeOwner='owner-b';const denied=await route.GET(request());
check('动态报告GET仍拒绝另一账号读取',()=>assert.equal(denied.status,404));
sql.close();
console.log(`Personal context: ${checks} checks passed; no external calls.`);
