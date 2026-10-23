import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
const calls=[];
let beforeRead=()=>{};
const db={prepare(query){return{args:[],bind(...args){this.args=args;return this;},async first(){calls.push({query,args:this.args});beforeRead(query,this.args);return sql.prepare(query).get(...this.args)||null;},async all(){calls.push({query,args:this.args});beforeRead(query,this.args);return{results:sql.prepare(query).all(...this.args)};},async run(){assert.fail('Reading self memory must not write to D1');}};}};
const cache=new Map();
function load(file){const path=resolve(file);if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require','fetch',code)(exports,name=>{if(name==='@/db')return{getD1:()=>db};let next=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(path),name);if(!/\.(?:ts|mjs)$/.test(next))next+='.ts';return load(next);},()=>assert.fail('No network or model calls'));return exports;}
const {loadSelfArchiveMemory}=load('lib/self-archive-memory.ts');
const fields=['interests','communicationStyle','preferredRelationship','values','boundaries','lifestyle','goals','strengths'];
const owner='batch-owner';
function profile(who){sql.prepare("INSERT INTO coach_profiles VALUES(?,77,0,'{}',1)").run(who);}
function subject(id,who=owner){sql.prepare("INSERT INTO coach_subjects(id,owner_id,label,status,data,created_at,updated_at) VALUES(?,?,?,'active','{}',1,1)").run(id,who,id);}
function library(id,person,who=owner){sql.prepare("INSERT INTO coach_capture_libraries(id,owner_id,account,friend,kind,subject_id,created_at,updated_at) VALUES(?,?,'wx',?,'chat',?,'2026-10-01','2026-10-01')").run(id,who,id,person);}
function source(libraryId,localId,text,who=owner){sql.prepare("INSERT INTO coach_capture_records(library_id,owner_id,epoch,local_id,digest,record_json,updated_at) VALUES(?,?,1,?,?,?,1)").run(libraryId,who,localId,localId,JSON.stringify({localId,senderRole:'self',kind:'text',at:'2026-10-01',text}));}
function fact(libraryId,items,removed=[],who=owner){const memory={version:1,libraryId,epoch:1,items,removed};sql.prepare("INSERT INTO coach_facts(id,owner_id,subject_id,field,value,source,evidence,status,created_at) VALUES(?,?,NULL,'selfArchiveSummary',?,'test','','derived',1)").run('self-archive:'+libraryId+':1',who,JSON.stringify(memory));}
function item(libraryId,index,quote){return{id:'item-'+index,sourceId:'same-local-id-'+index,field:fields[index%fields.length],label:fields[index%fields.length],value:quote,quote,at:'2026-10-01',basis:'statement'};}

profile(owner);subject('active-person');subject('deleted-person');
for(let libraryIndex=0;libraryIndex<100;libraryIndex++){
 const id='batch-'+libraryIndex;library(id,libraryIndex===2?'deleted-person':'active-person');
 const items=Array.from({length:64},(_,index)=>{const quote=`我喜欢合成资料 ${libraryIndex}-${index}`;const entry=item(id,index,quote);source(id,entry.sourceId,quote);return entry;});fact(id,items);
}
let state=await loadSelfArchiveMemory(owner,db);
assert.equal(state.status,'ready');assert.equal(state.summaries.length,100);assert.equal(state.summaries.flatMap(value=>value.items).length,6400);
const chunks=calls.filter(call=>call.query.startsWith('SELECT r.library_id,r.epoch,r.local_id'));
assert.equal(chunks.length,13);assert.ok(chunks.every(call=>JSON.parse(call.args[0]).length<=500));assert.equal(calls.length,17,'100 summaries with 6,400 citations need 17 reads, not 203');
assert.ok(chunks.every(call=>call.args[1]===owner&&call.args[2]===owner));
const plan=sql.prepare('EXPLAIN QUERY PLAN '+chunks[0].query).all(...chunks[0].args).map(row=>row.detail).join('\n');
assert.match(plan,/SEARCH r USING INDEX .+\(library_id=\? AND epoch=\? AND local_id=\?\)/,'source citations must use the exact composite index');
assert.doesNotMatch(plan,/SCAN r\b/,'a batched citation read must not scan all imported records');
const benchmark={summaries:100,citations:6400,queries:calls.length,sourceQueries:chunks.length,maxCitationsPerQuery:Math.max(...chunks.map(call=>JSON.parse(call.args[0]).length))};

// A quote that only exists at the same local ID in another library must fail.
const changed=JSON.parse(sql.prepare("SELECT value FROM coach_facts WHERE id='self-archive:batch-0:1'").get().value);
changed.items[0].quote='我喜欢合成资料 1-0';
sql.prepare("UPDATE coach_facts SET value=? WHERE id='self-archive:batch-0:1'").run(JSON.stringify(changed));
state=await loadSelfArchiveMemory(owner,db);
assert.equal(state.summaries.find(value=>value.id==='self-archive:batch-0:1').items.length,63,'a foreign library cannot validate the quote');

// Epoch resets, deleted libraries/people, and edited/deleted evidence invalidate memory.
sql.prepare("UPDATE coach_capture_libraries SET epoch=2 WHERE id='batch-0'").run();
sql.prepare("UPDATE coach_capture_libraries SET deleted_at=1 WHERE id='batch-1'").run();
sql.prepare("UPDATE coach_subjects SET status='deleted' WHERE id='deleted-person'").run();
sql.prepare("DELETE FROM coach_capture_records WHERE library_id='batch-3' AND local_id='same-local-id-0'").run();
sql.prepare("UPDATE coach_capture_records SET record_json=json_set(record_json,'$.text','更正后的原文') WHERE library_id='batch-4' AND local_id='same-local-id-0'").run();
state=await loadSelfArchiveMemory(owner,db);
assert.equal(state.summaries.length,97);
for(const id of ['batch-0','batch-1','batch-2'])assert.ok(!state.summaries.some(value=>value.id==='self-archive:'+id+':1'));
for(const id of ['batch-3','batch-4'])assert.equal(state.summaries.find(value=>value.id==='self-archive:'+id+':1').items.length,63);

// Recheck source liveness when a library disappears after the initial lookup.
let deletedDuringRead=false;
beforeRead=query=>{if(!deletedDuringRead&&query.startsWith('SELECT r.library_id,r.epoch,r.local_id')){deletedDuringRead=true;sql.prepare("UPDATE coach_capture_libraries SET deleted_at=1 WHERE id='batch-5'").run();}};
state=await loadSelfArchiveMemory(owner,db);beforeRead=()=>{};
assert.ok(deletedDuringRead);assert.ok(!state.summaries.some(value=>value.id==='self-archive:batch-5:1'));

// Revoke while citations are read: none of the material may be returned.
let revoked=false;
beforeRead=query=>{if(!revoked&&query.startsWith('SELECT r.library_id,r.epoch,r.local_id')){revoked=true;sql.prepare("UPDATE coach_profiles SET paused=1 WHERE owner_id=?").run(owner);}};
state=await loadSelfArchiveMemory(owner,db);beforeRead=()=>{};
assert.equal(state.status,'disabled');assert.deepEqual(state.summaries,[]);
sql.prepare("UPDATE coach_profiles SET paused=0 WHERE owner_id=?").run(owner);
beforeRead=query=>{if(query==='SELECT consent_at,paused FROM coach_profiles WHERE owner_id=?')sql.prepare("UPDATE coach_profiles SET consent_at=78 WHERE owner_id=?").run(owner);};
state=await loadSelfArchiveMemory(owner,db);beforeRead=()=>{};
assert.equal(state.status,'disabled');assert.deepEqual(state.summaries,[],'changing the consent generation invalidates the read');

// A forged fact referencing another owner's live library remains invisible.
profile('outsider');
sql.prepare("INSERT INTO coach_facts(id,owner_id,subject_id,field,value,source,evidence,status,created_at) VALUES('forged-source','outsider',NULL,'selfArchiveSummary',?,'test','','derived',1)").run(JSON.stringify({version:1,libraryId:'batch-6',epoch:1,items:[item('batch-6',0,'我喜欢合成资料 6-0')],removed:[]}));
assert.equal((await loadSelfArchiveMemory('outsider',db)).summaries.length,0);

// Empty summaries still carry cross-library removal tombstones.
const removedOwner='removed-owner';profile(removedOwner);subject('removed-person',removedOwner);
for(const id of ['removed-source','duplicate-source'])library(id,'removed-person',removedOwner);
const quote='我喜欢摄影';fact('removed-source',[],['interests:'+quote],removedOwner);
source('duplicate-source','same-local-id-0',quote,removedOwner);fact('duplicate-source',[item('duplicate-source',0,quote)],[],removedOwner);
assert.equal((await loadSelfArchiveMemory(removedOwner,db)).summaries.length,0,'an empty source summary must still suppress removed statements elsewhere');

console.log('PASS self memory batched reads:',JSON.stringify(benchmark),'with owner/epoch/person/source deletion, exact per-library citations, mid-read consent revocation, empty tombstones. No writes/network/model calls.');
