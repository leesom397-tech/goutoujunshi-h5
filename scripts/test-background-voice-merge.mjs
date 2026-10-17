import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync('lib/desktop-capture.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exports);
const {mergeCaptureRecords:merge}=exports;
const ns={ownerId:'synthetic-owner',account:'wxid_synthetic',friend:'合成联系人',kind:'chat'};
const batch=(records,at='2026-10-15T08:00:00Z')=>({version:1,kind:'chat',account:ns.account,friend:ns.friend,capturedAt:at,records,warnings:[]});
function voice(id,shard='message_0.db',availability='available'){
 return {id,kind:'other',sender:'合成联系人',senderRole:'other',at:'2026-10-15T07:00:00Z',text:'语音6"秒',source:{label:'合成数据库语音',method:'wechat-local-db',accountId:ns.account,sessionId:'wxid_other',messageShard:shard,messageId:id,mediaKind:'voice',durationSeconds:6,rawMediaLabel:'语音6"秒',transcriptionStatus:'not-visible',voiceAvailability:availability}};
}
const done=(row,text)=>({...row,kind:'text',text,source:{...row.source,transcriptionStatus:'visible-text',voiceAvailability:'transcribed',transcriptionSource:'local-audio-asr'}});
const initial=merge([],batch([voice('a'),voice('b','message_1.db','missing-local')]),ns);
const update=merge(initial.records,batch([done(voice('a'),'合成测试语音第一条。'),voice('b','message_1.db')],'2026-10-15T08:01:00Z'),ns);
assert.deepEqual([update.added,update.updatedVoice,update.total],[0,1,2]);
assert.deepEqual(update.records.map(r=>r.localId),initial.records.map(r=>r.localId));
assert.equal(update.records[1].source.voiceAvailability,'available','sync refreshed availability without duplication');
assert.equal(update.records[0].firstCapturedAt,initial.records[0].firstCapturedAt);
const rescan=merge(update.records,batch([voice('a'),voice('b','message_1.db','missing-local')],'2026-10-15T08:02:00Z'),ns);
assert.equal(rescan.added,0);assert.equal(rescan.records[0].text,update.records[0].text,'fast scan never erases cached transcript');
assert.equal(rescan.records[0].source.transcriptCapturedAt,'2026-10-15T08:01:00Z');
const final=merge(rescan.records,batch([done(voice('a'),'合成测试语音第一条。'),done(voice('b','message_1.db'),'合成测试语音第二条。')],'2026-10-15T08:03:00Z'),ns);
assert.deepEqual([final.added,final.updatedVoice,final.total],[0,1,2]);
assert.equal(merge(final.records,batch(final.records),ns).added,0);
assert.throws(()=>merge(final.records,batch([done(voice('a'),'不同正文不可无提示覆盖。')]),ns),/不同/);
for(const bad of [
 {...voice('a'),senderRole:'self'},
 {...voice('a'),at:'2026-10-15T07:01:00Z'},
 {...voice('a'),source:{...voice('a').source,sessionId:'another-session'}},
 {...voice('a'),source:{...voice('a').source,messageShard:'message_2.db'}},
 {...voice('a'),source:{...voice('a').source,accountId:'another-account'}},
 {...voice('a'),source:{...voice('a').source,messageId:''}},
])assert.throws(()=>merge(initial.records,batch([done(bad,'合成文字。')]),ns));
assert.throws(()=>merge(initial.records,batch([voice('a'),voice('a')]),ns),/重复/);
const distinct=merge(initial.records,batch([voice('c','message_2.db')]),ns);
assert.equal(distinct.added,1,'same sender/time/duration never conflates distinct database IDs');
// Invalid DB metadata must never fall through to legacy UI sequence matching.
const anchor=(id,text)=>({id,kind:'text',sender:ns.friend,senderRole:'other',at:'2026-10-15T07:00:00Z',text,source:{label:'合成原文依据',method:'uia'}});
const left=anchor('left','合成前方锚点消息'),right=anchor('right','合成后方锚点消息');
const anchored=merge([],batch([left,voice('anchored'),right]),ns);
const untrusted=done(voice('anchored'),'合成但未核验的正文');untrusted.source.transcriptionSource='not-asr';
const before=JSON.stringify(anchored.records);
assert.throws(()=>merge(anchored.records,batch([left,untrusted,right]),ns),/已完成的本机音频转写/);
assert.equal(JSON.stringify(anchored.records),before,'rejected transcript leaves originals unchanged');
for(const malformed of [
 {...voice('anchored'),kind:'text',text:'没有完成转写状态的文本'},
 {...done(voice('anchored'),'完整文本'),source:{...done(voice('anchored'),'完整文本').source,voiceAvailability:'available'}},
 done(voice('anchored'),'正在转文字…'),
 done(voice('anchored'),'语音6"秒'),
 {...voice('anchored'),text:'占位类型里混入了任意正文'},
])for(const existing of [[],anchored.records])assert.throws(()=>merge(existing,batch([malformed]),ns),/本机语音/);
// First imports require the same collision checks as upgrades of an existing library.
for(const records of [
 [voice('fresh'),voice('fresh')],
 [voice('fresh'),{...voice('fresh'),source:{...voice('fresh').source,sessionId:'another-session'}}],
 [voice('fresh'),done(voice('fresh'),'同一个ID的第二份正文')],
 [voice('fresh'),{...voice('fresh'),id:'different-id'}],
 [voice('fresh'),anchor('fresh','伪装为普通文字的相同ID')],
])assert.throws(()=>merge([],batch(records),ns),/重复|冲突/);
assert.throws(()=>merge(initial.records,batch([{...voice('a'),id:'changed-source-id'}]),ns),/编号发生变化/);
// An equivalent legacy UI bubble must not be upgraded by a DB voice source.
const uiVoice={...voice('anchored'),id:undefined,source:{label:'旧版UI语音',method:'uia',mediaKind:'voice',uiClass:'mmui::ChatVoiceItemView',rawMediaLabel:'语音6"秒',durationSeconds:6,transcriptionStatus:'not-visible'}};
const legacy=merge([],batch([left,uiVoice,right]),ns);
const separated=merge(legacy.records,batch([left,done(voice('anchored'),'数据库单独识别的文字'),right]),ns);
assert.equal(separated.updatedVoice,0);assert.equal(separated.added,1);assert.equal(separated.records.find(r=>r.localId===legacy.records[1].localId).kind,'other','DB records never attach through legacy visual anchors');
console.log('PASS background voice identity, rescan, cache, missing media, partial upgrade, conflict and replay checks');
