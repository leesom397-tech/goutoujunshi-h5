import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
const cache=new Map();let db;
function load(file){const full=path.resolve(file);if(cache.has(full))return cache.get(full);const exports={};cache.set(full,exports);const code=ts.transpileModule(readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require','fetch',code)(exports,name=>name==='@/db'?{getD1:()=>db}:name.startsWith('.')?load(path.resolve(path.dirname(full),name+'.ts')):(()=>{throw Error(name)})(),()=>assert.fail('Evidence comparison must not make a network request'));return exports;}
const {relationshipEvidenceReview:review}=load('lib/relationship-evidence.ts');
const {loadRelationshipEvidence:read}=load('lib/relationship-evidence-server.ts');
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,subject='person-a';
const report=(n,lines=[],extra={})=>({id:id(n),kind:'chat',createdAt:n*1000,report:{subjectId:subject,lines:lines.map((line,i)=>({id:'line-'+i,speaker:'other',timestampRaw:'2026-10-0'+n,text:line})),...extra}});
const old=report(1,['我现在住在上海。','我是一名设计师。','我想认真谈恋爱，以结婚为目的。','想和你见面。']);
const fresh=report(2,['我现在住在深圳。','我是一名程序员。','我不想谈恋爱。','周六两点见，我订了餐厅。']);
const before=structuredClone([old,fresh]);const result=review({},subject,id(2),[old,fresh]);
assert.equal(result.cards.length,4);assert.equal(result.cards.filter(c=>c.kind==='consistency').length,3);
assert.match(result.cards[0].explanation,/不代表已经赴约/);assert.equal(result.cards[0].sources[0].date,'2026-10-01');assert.equal(result.cards[0].sources[1].date,'2026-10-02');
assert.deepEqual([old,fresh],before,'comparison does not rewrite the source');
assert.equal(review({},subject,id(1),[old,fresh]).cards.length,0,'old report excludes later sources');
assert.equal(review({},subject,'foreign',[old,fresh]).cards.length,0);
assert.equal(review({},subject,id(2),[old,report(2,[],{summary:'我现在住在深圳，我是程序员',decision:{judgment:'他已经答应了'}})]).cards.length,0,'model summaries are not original evidence');
assert.equal(review({},subject,id(2),[old,report(2,[],{moments:{posts:[{content:'我住在深圳，我是程序员，周六两点见。',date:'2026-10-02'}]}})]).cards.length,0,'compact moments captions can be model descriptions and are not direct speech');
assert.equal(review({},subject,id(2),[report(1,['我是一名教师。']),report(2,['我是一名老师。'])]).cards.length,0,'occupation synonyms do not create a difference card');
for(const line of ['她说我现在住在深圳。','你说我现在住在深圳。','我以前住在深圳。','我在深圳出差。','如果我现在住在深圳呢？'])assert.equal(review({},subject,id(2),[old,report(2,[line])]).cards.length,0,line);
assert.equal(review({},subject,id(2),[old,report(2,['我现在住在深圳。'],{targetSelf:true})]).cards.length,0);
assert.equal(review({},subject,id(2),[old,report(2,[],{profileBasics:[{field:'city',value:'深圳',evidence:'第2张主页信息栏'}]})]).cards[0].sources[1].kind,'profile-field','extracted profile field is not labeled a verbatim quote');
assert.equal(review({},subject,id(2),[report(1,['我期待稳定关系。']),report(2,['我想结婚。'])]).cards.length,0,'stable dating and possible marriage are compatible');
assert.equal(review({},subject,id(2),[old,report(2,['昨天没和你见面。'])]).cards.length,0,'a negated recap is not an event');
for(const line of ['我不想明天见面。','我不打算周六两点见面。','明天不方便见面。','我不愿意明天见面。','我不一定明天见面。','假如周六两点见面。','她说明天见面。','明天有空就见面。','周六两点见吗？'])assert.equal(review({},subject,id(2),[old,report(2,[line])]).cards.length,0,'not an agreed arrangement: '+line);
assert.equal(review({},subject,id(2),[old,report(2,['[表情包：昨天和你见面很开心]'])]).cards.length,0);
const boundary=review({},subject,id(2),[old,report(2,['不要再联系我。'])]).cards[0];assert.equal(boundary.question,'');assert.match(boundary.observe,/停止/);
for(const line of ['不要再联系那个骗子了。','我没有说不要再联系我。','不要再联系我朋友。','我没让你不要再联系我。'])assert.equal(review({},subject,id(2),[old,report(2,[line])]).cards.length,0,'third-party or denied boundary: '+line);
const unknown=report(2,['周六两点见。']);unknown.report.lines[0].timestampRaw='昨天';assert.match(review({},subject,id(2),[old,unknown]).cards[0].reading,/日期不足/);
const feedback={actionFeedback:[{reportId:id(1),outcome:'positive',note:'见面聊得开心',recordedAt:1500,eventDate:'2026-10-01'},{reportId:id(1),outcome:'not_done',note:'更正：还没有行动',recordedAt:1800,eventDate:''},{reportId:id(1),outcome:'positive',note:'未来反馈不应该进入旧报告',recordedAt:3000,eventDate:'2026-10-03'}]};
const correction=review(feedback,subject,id(2),[old,fresh]).cards.find(c=>c.kind==='feedback');assert.match(correction.title,/还没有执行/);assert.equal(correction.sources[0].date,'');assert.doesNotMatch(JSON.stringify(correction),/未来反馈/);


const quotedMoment=report(1,[],{moments:{posts:[{date:"2026-10-01",content:"配文：“我现在住在上海。”",evidence:"动态1"}]}});
const cross=review({},subject,id(2),[quotedMoment,report(2,["我现在住在深圳。"])]);
assert.equal(cross.cards.length,1);assert.equal(cross.cards[0].sources[0].kind,"quoted-post");assert.match(cross.cards[0].sources[0].label,/朋友圈明确引文/);
const exactMoment=report(1,[],{moments:{posts:[{content:"我现在住在上海。",date:"2026-10-01"}],behaviorClues:[{quote:"我现在住在上海。"}]}});
assert.equal(review({},subject,id(2),[exactMoment,report(2,["我现在住在深圳。"])]).cards.length,1,"matching separately retained quote can be compared");
for(const content of ["海报写着“我现在住在上海。”","转发朋友：“我现在住在上海。”","图片文字：“我现在住在上海。”","歌词：“我现在住在上海。”","配文：“朋友说我现在住在上海。”"]){
 assert.equal(review({},subject,id(2),[report(1,[],{moments:{posts:[{content,date:"2026-10-01"}]}}),report(2,["我现在住在深圳。"])]).cards.length,0,"unattributed content: "+content);
}
assert.equal(review({},subject,id(2),[report(1,[],{moments:{posts:[{content:"他可能住在上海，照片像上海街景"}],behaviorClues:[{quote:"我现在住在上海。"}]}}),report(2,["我现在住在深圳。"])]).cards.length,0,"behavior quote must actually occur in post content");
const statement=report(1,["我很重视沟通。"]);
const scene=response=>({...report(2),report:{subjectId:subject,lines:[{id:"question",speaker:"self",timestampRaw:"2026-10-02",text:"我有点不舒服，可以把这件事聊清楚吗？"},{id:"answer",speaker:"other",text:response}]}});
const closing=review({},subject,id(2),[statement,scene("没什么好谈的，你太敏感。")]).cards.find(c=>c.title.includes("分歧回应"));
assert.ok(closing);assert.equal(closing.sources.length,3);assert.match(closing.explanation,/一次回应不能证明/);
const opening=review({},subject,id(2),[statement,scene("我愿意听你说，我们一起商量。")]).cards.find(c=>c.title.includes("对应表达"));assert.ok(opening);assert.match(opening.explanation,/不等于已理解/);
for(const reply of ["现在不方便，晚上再聊。","我累了，晚点聊。","我不是不想谈这个。","她说没什么好谈的。","好的","不要再联系我。"]){
 assert.equal(review({},subject,id(2),[statement,scene(reply)]).cards.filter(c=>c.title.includes("沟通的自述")).length,0,"not disagreement avoidance: "+reply);
}
assert.equal(review({},subject,id(2),[statement,report(2,["没什么好谈的，你太敏感。"])]).cards.filter(c=>c.title.includes("沟通的自述")).length,0,"no visible disagreement context");
assert.equal(review({},subject,id(2),[report(1,["我不重视沟通。"]),scene("没什么好谈的")]).cards.filter(c=>c.title.includes("沟通的自述")).length,0,"negated statement");
const interrupted=scene("没什么好谈的");interrupted.report.lines.splice(1,0,{speaker:"unknown",text:"[无法识别]"});
assert.equal(review({},subject,id(2),[statement,interrupted]).cards.filter(c=>c.title.includes("沟通的自述")).length,0,"unknown line interrupts adjacency");
const split=report(2,[],{entries:[]});split.entries=[{lines:[{speaker:"self",text:"我有点不舒服，可以把这件事聊清楚吗？"}]},{lines:[{speaker:"other",text:"没什么好谈的"}]}];
assert.equal(review({},subject,id(2),[statement,split]).cards.filter(c=>c.title.includes("沟通的自述")).length,0,"separate screenshot segments are not an adjacent response");
console.log("PASS: exact quoted moments/chat cross-check, communication statement plus visible disagreement response, exclusions and adjacency.");


const repeatCity=review({},subject,id(3),[report(1,["我现在住在上海。"]),report(2,["我现在住在深圳。"]),report(3,["我现在住在深圳。"])]);
assert.equal(repeatCity.cards.length,0,"repeating latest stated city is not a new contradiction with older superseded city");
const reversed=review({},subject,id(2),[report(1,["我现在住在上海。"]),report(2,[],{moments:{posts:[{content:"配文：“我现在住在深圳。”",date:"2026-10-02"}]}})]);
assert.equal(reversed.cards[0].sources[1].kind,"quoted-post","chat to explicitly quoted moments also works");

const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE coach_profiles(owner_id TEXT,consent_at INTEGER,paused INTEGER);CREATE TABLE coach_subjects(id TEXT,owner_id TEXT,status TEXT,data TEXT);CREATE TABLE coach_saved_reports(id TEXT,owner_id TEXT,subject_id TEXT,kind TEXT,status TEXT,result TEXT,created_at INTEGER,report_ids TEXT);CREATE TABLE coach_crush_threads(id TEXT,owner_id TEXT,subject_id TEXT);CREATE TABLE coach_crush_reports(id TEXT,thread_id TEXT,owner_id TEXT,status TEXT,result TEXT,created_at INTEGER);`);
sql.prepare('INSERT INTO coach_profiles VALUES (?,?,?)').run('owner-a',1,0);sql.prepare('INSERT INTO coach_profiles VALUES (?,?,?)').run('owner-b',1,0);
for(const [person,owner]of[[subject,'owner-a'],['person-b','owner-a'],['person-c','owner-b']])sql.prepare('INSERT INTO coach_subjects VALUES (?,?,?,?)').run(person,owner,'active','{}');
function save(row,owner='owner-a',person=subject,memberIds=[]){sql.prepare('INSERT INTO coach_saved_reports VALUES (?,?,?,?,?,?,?,?)').run(row.id,owner,person,row.kind||'chat','done',JSON.stringify(row.report),row.createdAt,JSON.stringify(memberIds));}
save(old);save(fresh);save(report(3,['未来材料']), 'owner-a');save(report(4,['其他人物']), 'owner-a','person-b');save(report(5,['其他账号']), 'owner-b','person-c');save(report(6,[],{targetSelf:true}));save(report(7,[],{subjectId:'wrong-person'}));
sql.prepare('INSERT INTO coach_crush_threads VALUES (?,?,?)').run('thread-a','owner-a',subject);
function legacy(row){sql.prepare('INSERT INTO coach_crush_reports VALUES (?,?,?,?,?,?)').run(row.id,'thread-a','owner-a','done',JSON.stringify(row.report),row.createdAt);}
legacy(report(8,['批次原句']));legacy(report(9,['独立旧报告']));save(report(10,[],{entries:[{id:id(8),subjectId:subject,lines:[{id:'m',speaker:'other',text:'批次原句'}]}]}),'owner-a',subject,[id(8)]);
let afterRead=null;
db={prepare(query){let values=[];return{bind(...args){values=args;return this},async first(){const value=sql.prepare(query).get(...values)||null;afterRead?.(query,values);return value;},async all(){const results=sql.prepare(query).all(...values);afterRead?.(query,values);return{results};}}}};
let snapshot=await read('owner-a',subject,id(2));assert.equal(snapshot.validFocus,true);assert.deepEqual(snapshot.reports.map(r=>r.id).sort(),[id(1),id(2)]);
snapshot=await read('owner-a',subject);assert.deepEqual(snapshot.reports.map(r=>r.id).sort(),[id(1),id(2),id(3),id(9),id(10)],'owner, subject, self, wrong payload and batch members are isolated');
for(const target of [id(4),id(5),'missing']){snapshot=await read('owner-a',subject,target);assert.equal(snapshot.validFocus,false);assert.equal(snapshot.reports.length,0,'foreign focus must not fall through to person history');}
snapshot=await read('owner-a',subject,id(8));assert.equal(snapshot.cutoff,8000);assert.ok(snapshot.reports.some(r=>r.id===id(8)));assert.ok(snapshot.reports.every(r=>r.createdAt<=8000),'member focus uses its own saved cutoff');
save(report(11,[],{entries:[{id:id(13),subjectId:subject,lines:[{speaker:'other',text:'未知创建时间的批次成员'}]}]}));
sql.prepare('UPDATE coach_saved_reports SET created_at=? WHERE id=?').run(1500,id(11));
snapshot=await read('owner-a',subject,id(2));assert.ok(!snapshot.reports.some(r=>r.id===id(11)),'a non-focus batch with unknown member time is excluded from a historical snapshot');
snapshot=await read('owner-a',subject);assert.ok(snapshot.reports.some(r=>r.id===id(11)),'current archive view may still read undated legacy material without inventing its chronology');
snapshot=await read('owner-a',subject,id(11));assert.ok(snapshot.reports.some(r=>r.id===id(11)),'opening the complete batch preserves its own original contents');
const actualBatch=JSON.stringify({subjectId:subject,entries:[{id:id(8),createdAt:8000,subjectId:subject,lines:[{speaker:'other',text:'当前成员原话'}]},{id:id(12),createdAt:12000,subjectId:subject,lines:[{speaker:'other',text:'不应混入的后续成员'}]}]});
sql.prepare('UPDATE coach_saved_reports SET result=?,created_at=? WHERE id=?').run(actualBatch,7000,id(10));
snapshot=await read('owner-a',subject,id(8));assert.ok(snapshot.reports.some(r=>r.id===id(8)));assert.ok(!snapshot.reports.some(r=>r.id===id(10)),'a batch starts before its members; member focus cannot expose the complete later batch');
sql.prepare('DELETE FROM coach_crush_reports WHERE id=?').run(id(8));snapshot=await read('owner-a',subject,id(8));assert.equal(snapshot.validFocus,true);assert.ok(snapshot.reports.some(r=>r.id===id(10)),'retained batch resolves an old compacted member');
assert.doesNotMatch(JSON.stringify(snapshot.reports),/不应混入的后续成员/,'compacted member focus also trims later batch entries');
sql.prepare('UPDATE coach_saved_reports SET result=? WHERE id=?').run(JSON.stringify({subjectId:subject,entries:[{id:id(8),subjectId:subject,lines:[]}]}),id(10));
snapshot=await read('owner-a',subject,id(8));assert.equal(snapshot.validFocus,false,'missing member timestamp cannot use complete batch as its historical moment');
sql.prepare('UPDATE coach_saved_reports SET result=? WHERE id=?').run(actualBatch,id(10));
let changed=false;afterRead=query=>{if(!changed&&query.includes('ORDER BY created_at DESC,id DESC')){changed=true;sql.prepare('UPDATE coach_saved_reports SET status=? WHERE id=?').run('deleted',id(2));}};
snapshot=await read('owner-a',subject,id(2));assert.equal(snapshot.validFocus,false);assert.equal(snapshot.reports.length,0,'focus deleted during read invalidates response');
sql.prepare('UPDATE coach_saved_reports SET status=? WHERE id=?').run('done',id(2));changed=false;afterRead=query=>{if(!changed&&query.includes('ORDER BY created_at DESC,id DESC')){changed=true;sql.prepare('UPDATE coach_profiles SET paused=1 WHERE owner_id=?').run('owner-a');}};
snapshot=await read('owner-a',subject);assert.equal(snapshot.authorized,false);assert.equal(snapshot.reports.length,0,'consent is checked after reads');
sql.prepare('UPDATE coach_profiles SET paused=0 WHERE owner_id=?').run('owner-a');changed=false;afterRead=query=>{if(!changed&&query.includes('ORDER BY created_at DESC,id DESC')){changed=true;sql.prepare('UPDATE coach_subjects SET status=? WHERE id=?').run('deleted',subject);}};
snapshot=await read('owner-a',subject);assert.equal(snapshot.validFocus,false);assert.equal(snapshot.reports.length,0,'subject deletion race invalidates the snapshot');
sql.close();console.log('PASS: original evidence, dated action expressions, profile differences, uncertainty, feedback corrections; actual SQLite owner/subject/focus isolation, batch dedup, future exclusion, deletion and consent races.');
