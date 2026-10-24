import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import ts from 'typescript';
const bundled=await build({entryPoints:['lib/capture-sentence-server.ts'],bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'});
const module={exports:{}};new Function('module','exports',bundled.outputFiles[0].text)(module,module.exports);
const {readSentencePage,readSentenceAttention,supplementSentencePage,cancelSentencePage,SentenceReadingError}=module.exports;
const sql=new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE coach_saved_reports(id TEXT PRIMARY KEY,owner_id TEXT,subject_id TEXT,status TEXT,result TEXT,updated_at INTEGER);
CREATE TABLE coach_capture_libraries(id TEXT PRIMARY KEY,owner_id TEXT,subject_id TEXT,epoch INTEGER,revision INTEGER,deleted_at INTEGER);
CREATE TABLE coach_capture_records(owner_id TEXT,library_id TEXT,epoch INTEGER,seq INTEGER,sort_known INTEGER,sort_time INTEGER,record_json TEXT);`);
sql.exec(readFileSync('drizzle/0022_report_sentence_pages.sql','utf8'));
const db={prepare:query=>({bind:(...values)=>({first:async()=>sql.prepare(query).get(...values)||null,all:async()=>({results:sql.prepare(query).all(...values)}),run:async()=>({meta:sql.prepare(query).run(...values)})})})};
const owner='owner-a',id='af750f19-0502-4d43-a382-04c3dfac3eb8',libraryId='cl_'+'a'.repeat(64);
const request=()=>crypto.randomUUID();
const original={id,analysisScope:'fullHistory',captureKind:'chat',archiveSnapshot:{libraryId,epoch:1,revision:1},semanticHistory:{summary:'unchanged'},summary:'original',generatedAt:'2026-10-24'};
let clock=Date.now();const realNow=Date.now;Date.now=()=>clock;
function reset(rows=Array.from({length:37},(_,i)=>({localId:'m'+i,kind:i===8?'image':'text',senderRole:i===11?'unknown':i%2?'self':'other',at:new Date(1792800000000+i*1000).toISOString(),text:i===8?'[图片]':`第${i}句：今天一起吃饭吗？`,source:{method:'wechat-local-db'}}))){
  sql.exec('DELETE FROM coach_report_sentence_pages;DELETE FROM coach_capture_records;DELETE FROM coach_capture_libraries;DELETE FROM coach_saved_reports;');
  sql.prepare("INSERT INTO coach_saved_reports VALUES (?,?,NULL,'done',?,1)").run(id,owner,JSON.stringify(original));
  sql.prepare('INSERT INTO coach_capture_libraries VALUES (?,?,NULL,1,1,NULL)').run(libraryId,owner);
  rows.forEach((row,i)=>sql.prepare('INSERT INTO coach_capture_records VALUES (?,?,1,?,0,?,?)').run(owner,libraryId,i,i,JSON.stringify(row)));
  clock+=10000;return rows;
}
const output=targets=>JSON.stringify({sentenceReadings:targets.map(row=>({sourceId:row.sourceId,emotion:{happy:1},intent:{answer:1},note:'这句接住了前面的具体话题，表达愿意继续讨论安排。'}))});
let calls=0,budgets=0;
const model=async(messages,options)=>{calls++;const payload=JSON.parse(messages[1].content);assert.ok(payload.targets.length<=12);assert.ok(payload.targets.reduce((sum,row)=>sum+row.text.length,0)<=12000);assert.equal(options.timeoutMs,45000);assert.ok(options.maxTokens<=3600);return output(payload.targets);};
const budget=async()=>{budgets++;};
const supplement=(page,qwen=model,key=request())=>supplementSentencePage(db,owner,id,page.offset,page.lines.length,key,qwen,budget);
try{
  reset();
  await assert.rejects(()=>readSentencePage(db,'foreign',id,{offset:0}),e=>e.status===404);
  const latest=await readSentencePage(db,owner,id,{before:20000});
  assert.equal(latest.totalReadable,35);assert.equal(latest.offset,23);assert.equal(latest.lines.length,12);
  const seen=[];let cursor=0;
  do{const page=await readSentencePage(db,owner,id,{offset:cursor});seen.push(...page.lines.map(row=>row.id));cursor=page.nextOffset;}while(cursor<latest.totalReadable);
  assert.equal(new Set(seen).size,35);assert.ok(!seen.includes('m8')&&!seen.includes('m11'));
  let release;const wait=new Promise(resolve=>release=resolve),key=request();
  const pending=supplement(latest,async(...args)=>{await wait;return model(...args);},key);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal((await readSentencePage(db,owner,id,{offset:23,count:12})).status,'running');
  await assert.rejects(()=>supplement(latest),e=>e.status===409);
  await assert.rejects(()=>supplementSentencePage(db,owner,id,0,12,request(),model,budget),e=>e.status===429);
  release();const completed=await pending;
  assert.equal(completed.status,'complete');assert.equal(completed.totalAnalyzed,12);
  assert.equal((await supplement(latest)).status,'complete');assert.equal(calls,1);assert.equal(budgets,1);
  assert.deepEqual(JSON.parse(sql.prepare('SELECT result FROM coach_saved_reports').get().result),original,'original report fields never rewritten');

  // A partial valid model response is retained; retry requests only missing IDs.
  clock+=3000;const first=await readSentencePage(db,owner,id,{offset:0});
  const partial=await supplement(first,async messages=>output(JSON.parse(messages[1].content).targets.slice(0,5)));
  assert.equal(partial.status,'partial');assert.equal(partial.totalAnalyzed,17);
  clock+=3000;const full=await supplement(first,async messages=>{const targets=JSON.parse(messages[1].content).targets;assert.equal(targets.length,7);return output(targets);});
  assert.equal(full.status,'complete');assert.equal(full.totalAnalyzed,24);

  // Cancellation is queued while a bounded model call settles, then blocks its save.
  reset();const page=await readSentencePage(db,owner,id,{offset:0}),cancelId=request();
  let releaseCancel;const gate=new Promise(resolve=>releaseCancel=resolve);
  const cancelling=supplement(page,async(...args)=>{await gate;return model(...args);},cancelId);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal((await cancelSentencePage(db,owner,id,0,12,cancelId)).status,'cancelling');
  await assert.rejects(()=>supplement(page),e=>e.status===409);
  releaseCancel();await assert.rejects(()=>cancelling,e=>e.status===409);
  assert.equal((await readSentencePage(db,owner,id,{offset:0})).totalAnalyzed,0);
  // A cancellation arriving before POST is a tombstone for the same request ID.
  reset();const early=request();await cancelSentencePage(db,owner,id,0,12,early);
  await assert.rejects(()=>supplementSentencePage(db,owner,id,0,12,early,model,budget),e=>e.status===429);
  const beforeCalls=calls;
  await assert.rejects(()=>supplementSentencePage(db,owner,id,0,12,request(),model,async()=>{throw new SentenceReadingError('quota',429);}),e=>e.status===429);
  assert.equal(calls,beforeCalls);
  reset();const expiredCalls=calls;
  await assert.rejects(()=>supplementSentencePage(db,owner,id,0,12,request(),model,async()=>{clock+=65001;}),e=>e.status===409);
  assert.equal(calls,expiredCalls,'an expired lease cannot start a model after slow consent/budget checks');

  // Delete/revision changes during the model call cannot restore derived data.
  for(const change of ['revision','delete','subject']){
    reset();const p=await readSentencePage(db,owner,id,{offset:0});
    await assert.rejects(()=>supplement(p,async(...args)=>{
      if(change==='revision')sql.prepare('UPDATE coach_capture_libraries SET revision=2 WHERE id=?').run(libraryId);
      if(change==='delete')sql.prepare("UPDATE coach_saved_reports SET status='deleted',result='{}' WHERE id=?").run(id);
      if(change==='subject')sql.prepare("UPDATE coach_capture_libraries SET subject_id='another' WHERE id=?").run(libraryId);
      return model(...args);
    }),e=>e.status===409);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM coach_report_sentence_pages').get().n,0);
    if(change==='revision'){const current=await readSentencePage(db,owner,id,{offset:0});assert.equal(current.sourceUpdated,true);assert.equal(current.revision,2);assert.equal(current.reportRevision,1);assert.equal(current.totalAnalyzed,0);}
    else await assert.rejects(()=>readSentencePage(db,owner,id,{offset:0}),e=>[404,409].includes(e.status));
  }
  reset();const p=await readSentencePage(db,owner,id,{offset:0});await supplement(p);
  sql.prepare('UPDATE coach_capture_libraries SET revision=2 WHERE id=?').run(libraryId);
  const livePage=await readSentencePage(db,owner,id,{offset:0});assert.equal(livePage.sourceUpdated,true);clock+=3000;
  assert.equal((await supplement(livePage)).status,'complete','an old report can supplement current same-person sources without re-analysis');
  assert.deepEqual(JSON.parse(sql.prepare('SELECT result FROM coach_saved_reports').get().result),original,'a current-source supplement cannot rewrite old conclusions');
  sql.prepare('UPDATE coach_saved_reports SET result=? WHERE id=?').run(JSON.stringify({...original,archiveSnapshot:{...original.archiveSnapshot,revision:2}}),id);
  assert.equal((await readSentencePage(db,owner,id,{offset:0})).totalAnalyzed,12,'same current-source revision reuses only its new cache');

  // Long messages produce bounded pages with complete forward/backward coverage.
  reset(Array.from({length:29},(_,i)=>({localId:'long'+i,kind:'text',senderRole:i%2?'self':'other',at:'2026-10-24T10:00:00Z',text:'文'.repeat(i%3===0?5900:900),source:{method:'wechat-local-db'}})));
  const all=new Set();let before=20000;
  do{const page=await readSentencePage(db,owner,id,{before});assert.ok(page.lines.reduce((sum,row)=>sum+row.text.length,0)<=12000);page.lines.forEach(row=>all.add(row.id));const interpreted=await supplement(page);assert.deepEqual(interpreted.lines,page.lines,'explicit range never expands during supplement');before=page.offset;clock+=3000;}while(before>0);
  assert.equal(all.size,29);assert.equal((await readSentencePage(db,owner,id,{offset:0})).totalAnalyzed,29,'overlapping page boundaries count each original once');

  // Cross-device legacy summaries use every original, including unread media,
  // and reuse the same revision without invoking a model or credit ledger.
  reset([{localId:'question',kind:'text',senderRole:'self',at:'2026-10-24T10:00:00Z',text:'周六一起吃饭吗？',source:{}},{localId:'photo',kind:'image',senderRole:'other',at:'2026-10-24T10:01:00Z',text:'[图片]',source:{}}]);
  const attentionCalls=calls,attention=await readSentenceAttention(db,owner,id);
  assert.equal(attention.totalReadable,1);assert.equal(attention.replyAttention.messages,2);assert.equal(attention.replyAttention.questions[0].status,'unread-context');assert.equal(attention.cached,false);assert.equal(attention.cost,0);
  assert.equal((await readSentenceAttention(db,owner,id)).cached,true);assert.equal(calls,attentionCalls);
  sql.prepare("UPDATE coach_report_sentence_pages SET payload=json_remove(payload,'$.replyAttention.rulesVersion') WHERE page_key='attention'").run();
  const repairedAttention=await readSentenceAttention(db,owner,id);
  assert.equal(repairedAttention.cached,false,'an old rule cache must be recomputed from originals');
  assert.equal(repairedAttention.replyAttention.rulesVersion,3);assert.equal(calls,attentionCalls,'rule updates never require another model analysis');
  assert.equal((await readSentencePage(db,owner,id,{offset:0})).totalAnalyzed,0,'behavior summary never counts as model sentence analysis');
  await assert.rejects(()=>readSentenceAttention(db,'foreign',id),e=>e.status===404);
  const racedb={prepare:query=>({bind:(...values)=>{const statement=db.prepare(query).bind(...values);return{...statement,first:async()=>{const value=await statement.first();if(query.startsWith('SELECT payload FROM coach_report_sentence_pages'))sql.prepare("UPDATE coach_capture_libraries SET subject_id='changed' WHERE id=?").run(libraryId);return value;}};}})};
  await assert.rejects(()=>readSentenceAttention(racedb,owner,id),e=>e.status===409,'a cached summary must revalidate source ownership after its read');
  sql.prepare('UPDATE coach_capture_libraries SET subject_id=NULL WHERE id=?').run(libraryId);
  sql.prepare('UPDATE coach_capture_libraries SET revision=2 WHERE id=?').run(libraryId);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM coach_report_sentence_pages').get().n,0,'source changes purge the summary cache too');

  // The previous rules missed spoken invitations. Version 3 must replace a
  // version-2 summary from the same source revision, without model or credits.
  reset([{localId:'earlier',kind:'text',senderRole:'self',at:'2026-10-24T10:00:00Z',text:'你开始了吗？',source:{}},{localId:'answer',kind:'text',senderRole:'other',at:'2026-10-24T10:01:00Z',text:'对，还有点紧张。',source:{}},{localId:'invite',kind:'text',senderRole:'self',at:'2026-10-24T10:02:00Z',text:'啥时候有空我带你去公园，就上次拍照那个地方。',source:{}}]);
  await readSentenceAttention(db,owner,id);
  sql.prepare("UPDATE coach_report_sentence_pages SET payload=json_set(payload,'$.replyAttention.rulesVersion',2,'$.replyAttention.questionCount',1,'$.replyAttention.headline','旧版只看到了更早的回答') WHERE page_key='attention'").run();
  const beforeUpgrade={calls,budgets},upgraded=await readSentenceAttention(db,owner,id);
  assert.equal(upgraded.cached,false);assert.equal(upgraded.cost,0);assert.equal(upgraded.replyAttention.rulesVersion,3);
  assert.equal(upgraded.replyAttention.questionCount,2);assert.equal(upgraded.replyAttention.questions[0].question.sourceId,'invite');assert.equal(upgraded.replyAttention.questions[0].status,'cutoff');
  assert.deepEqual({calls,budgets},beforeUpgrade,'version upgrade performs no model call or budget reservation');
  assert.equal((await readSentenceAttention(db,owner,id)).cached,true,'recomputed version-3 summary is reused');
  assert.deepEqual(JSON.parse(sql.prepare('SELECT result FROM coach_saved_reports').get().result),original,'free observation upgrade never rewrites the saved report conclusions');

  // Only validated model weights are stored. An ungrounded response stays unread.
  reset();const invalid=await readSentencePage(db,owner,id,{offset:0});
  await assert.rejects(()=>supplement(invalid,async()=>JSON.stringify({sentenceReadings:[{sourceId:'S999',emotion:{happy:1},intent:{answer:1},note:'invented'}]})),e=>e.status===502);
  assert.equal((await readSentencePage(db,owner,id,{offset:0})).totalAnalyzed,0);

  // Execute route authentication/CSRF/range boundaries with the real handler.
  const routeModule={exports:{}},source=ts.transpileModule(readFileSync('app/api/web/report/sentences/route.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  let who=null,seenOwner='';
  new Function('require','module','exports',source)(name=>{
    if(name==='@/db')return{getD1:()=>db};
    if(name==='@/lib/miniapp-auth')return{miniappOwner:async()=>who?{ownerId:who}:null};
    if(name==='@/lib/crush/types')return{CrushError:class extends Error{}};
    if(name==='@/lib/crush/service')return{requireSettings:async()=>{},reserveBudget:async()=>{}};
    if(name==='@/lib/qwen')return{qwenChat:model,qwenPublicError:(_,fallback)=>fallback};
    if(name==='@/lib/capture-sentence-server')return{...module.exports,readSentencePage:async(_db,owner)=>{seenOwner=owner;return{ok:true};}};
    throw Error(name);
  },routeModule,routeModule.exports);
  const url='https://coach.lovetalk.love/api/web/report/sentences';
  assert.equal((await routeModule.exports.GET(new Request(url+'?id='+id))).status,401);
  who=owner;assert.equal((await routeModule.exports.GET(new Request(url+'?id='+id+'&offset=-1'))).status,400);
  assert.equal((await routeModule.exports.GET(new Request(url+'?id='+id+'&owner=foreign'))).status,200);assert.equal(seenOwner,owner);
  const body={id,offset:0,count:12,action:'analyze',confirmed:true,requestId:request()};
  assert.equal((await routeModule.exports.POST(new Request(url,{method:'POST',headers:{origin:'https://foreign.test','content-type':'application/json'},body:JSON.stringify(body)}))).status,403);
  assert.equal(/reserveCredit|debitCredit|settleCredit/.test(source),false);
  console.log('PASS sentence pages: all readable originals, bounded long-message pages, real SQLite leases, cached/partial retry, cancellation before/during request, quota, source revision/subject/delete guards, full coverage counts, route owner/CSRF, zero customer credit mutations');
}finally{Date.now=realNow;sql.close();}
