import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const exported = {};
new Function('exports', ts.transpileModule(readFileSync('lib/desktop-capture.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exported);
const {mergeCaptureRecords:merge, validateCaptureBatch:validate} = exported;
const ns={ownerId:'synthetic-owner',account:'wxid_synthetic',friend:'synthetic-friend',kind:'chat'};
const capturedAt=new Date(2026,9,15,16,0).toISOString(), at=new Date(2026,9,12,12,30,20).toISOString();
const batch=records=>({version:1,...ns,capturedAt,records,warnings:[]});
const png={mime:'image/png',name:'old-preview.png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGkAAAAASUVORK5CYII='};
const ui=(kind,text,source={})=>({kind,text,sender:'synthetic-friend',senderRole:'other',at:'2026年10月12日 12:30',source:{label:'Synthetic UI message',method:'uia',uiClass:'mmui::ChatTextItemView',...source}});
const db=(id,kind,text,source={})=>({id,kind,text,sender:'synthetic-friend',senderRole:'other',at,source:{label:'Synthetic DB message',method:'wechat-local-db',accountId:ns.account,sessionId:'wxid_friend',messageShard:'message/message_0.db',messageId:id,idStability:'stable',timestampOrigin:'wechat-create-time',...source}});
const left='这是用于对照的第一条唯一完整原始文字。',right='这是用于对照的第二条唯一完整原始文字。';
const uv=(text='语音6"秒',visible=false)=>ui(visible?'text':'other',text,{uiClass:'mmui::ChatVoiceItemView',rawMediaLabel:'语音6"秒',transcriptionStatus:visible?'visible-text':'not-visible',...(visible?{mediaKind:'voice',transcriptionSource:'wechat-native-transcript-copy',durationSeconds:6}:{})});
const dv=(id,done=false,text='Synthetic local transcript')=>db(id,done?'text':'other',done?text:'[语音]',{mediaKind:'voice',rawMediaLabel:'语音6.21"秒',durationSeconds:6.21,transcriptionStatus:done?'visible-text':'not-transcribed',voiceAvailability:done?'transcribed':'available',...(done?{transcriptionSource:'local-audio-asr'}:{})});
const originalRows=[ui('text',left),uv(),{...ui('image','[图片]',{uiClass:'mmui::ChatImageItemView'}),images:[png]},ui('text','好'),uv('Already verified native transcript',true),ui('text',right)];
const incoming=[db('left','text',left),dv('voice1'),db('picture','image','[图片]'),db('short','text','好'),dv('voice2'),db('right','text',right)];
const original=merge([],batch(originalRows),ns);
const bound=merge(original.records,batch(incoming),ns);
assert.deepEqual([bound.added,bound.total,bound.updatedVoice],[0,6,0]);
assert.deepEqual(bound.records.map(r=>r.localId),original.records.map(r=>r.localId));
assert.deepEqual(bound.records.map(r=>r.text),original.records.map(r=>r.text));
assert.deepEqual(bound.records[2].images,[png]);
assert.equal(bound.records[4].source.transcriptionSource,'wechat-native-transcript-copy');
assert.equal(bound.records[1].source.databaseIdentity.id,'voice1');
assert.equal(bound.records[1].source.databaseIdentity.durationSeconds,6.21);
assert.equal(bound.records[1].firstCapturedAt,original.records[1].firstCapturedAt);
const full=incoming.map(r=>r.id==='voice1'?dv(r.id,true):r.id==='voice2'?dv(r.id,true,'Different ASR rendition must not overwrite native'):r);
const completed=merge(bound.records,batch(full),ns);
assert.deepEqual([completed.added,completed.total,completed.updatedVoice],[0,6,1]);
assert.equal(completed.records[1].text,'Synthetic local transcript');
assert.equal(completed.records[1].source.legacyUiSource.text,original.records[1].text);
assert.equal(completed.records[1].source.legacyUiSource.at,original.records[1].at);
assert.equal(completed.records[4].text,'Already verified native transcript');
assert.equal(completed.records[4].source.transcriptionSource,'wechat-native-transcript-copy');
assert.deepEqual(completed.records.map(r=>r.localId),original.records.map(r=>r.localId));
assert.equal(merge(completed.records,batch(incoming),ns).added,0);
assert.equal(merge(completed.records,batch(full),ns).updatedVoice,0);
assert.deepEqual(merge(completed.records,batch(full),ns).records[2].images,[png]);
// Aliases written before sender was added remain mergeable. The sender is
// recovered from the stored UI row; the database identity fields are still
// required and are not regenerated from a display name.
const legacyBound=structuredClone(bound.records);
delete legacyBound[1].source.databaseIdentity.sender;
const legacyCompleted=merge(legacyBound,batch(full),ns);
const legacyVoice=legacyCompleted.records.find(r=>r.localId===legacyBound[1].localId);
console.error('LEGACY',JSON.stringify(legacyBound[1]),JSON.stringify(legacyVoice));
assert.equal(legacyVoice.text,'Synthetic local transcript','legacy alias still locates the same voice row');
assert.throws(()=>validate(batch([bound.records[0]])),/关联凭据/,'external batches may not forge internal aliases');
assert.throws(()=>validate(batch([{...incoming[0],source:{...incoming[0].source,databaseIdentity:bound.records[0].source.databaseIdentity}}])),/关联凭据/,'DB input cannot claim an internal UI alias either');
for(const change of [r=>({...r,senderRole:'self'}),r=>({...r,at:new Date(2026,9,12,12,31,20).toISOString()}),r=>({...r,source:{...r.source,durationSeconds:8}})]) {
  const changed=incoming.map(r=>r.id==='voice1'?change(r):r);
  const result=merge(original.records,batch(changed),ns);
  assert.equal(result.records.find(r=>r.localId===original.records[1].localId).source.databaseIdentity,undefined,'role, timestamp, and duration conflicts prevent interval binding');
}
const missing=merge(original.records,batch(incoming.filter(r=>r.id!=='short')),ns);
assert.equal(missing.records.find(r=>r.localId===original.records[1].localId).source.databaseIdentity.id,'voice1','missing unrelated text does not defeat a forced monotonic match');
const extraSystem=incoming.toSpliced(3,0,db('system','other','[其他消息]'));
const withSystem=merge(original.records,batch(extraSystem),ns);
assert.deepEqual([withSystem.added,withSystem.total],[1,7],'an added system row remains separate while neighboring proven records merge');
assert.equal(withSystem.records.find(r=>r.localId===original.records[1].localId).source.databaseIdentity.id,'voice1');
const repeatedVoices=merge([],batch([ui('text',left),uv(),uv(),ui('text',right)]),ns);
const ambiguousVoice=merge(repeatedVoices.records,batch([db('a','text',left),dv('v'),db('b','text',right)]),ns);
assert.equal(ambiguousVoice.records.filter(r=>r.source.databaseIdentity?.mediaKind==='voice').length,0,'two indistinguishable old voices cannot claim one new voice');
const ambiguousPhotos=merge([],batch([ui('text',left),ui('image','[图片]'),ui('image','[图片]'),uv(),ui('text',right)]),ns);
const alignedVoice=merge(ambiguousPhotos.records,batch([db('a','text',left),db('photo','image','[图片]'),dv('v'),db('b','text',right)]),ns);
assert.equal(alignedVoice.records.filter(r=>r.kind==='image').length,3,'ambiguous duplicate old images are retained without guessing');
assert.equal(alignedVoice.records.find(r=>r.localId===ambiguousPhotos.records[3].localId).source.databaseIdentity.id,'v','independently forced voice remains identifiable beside ambiguous photos');
const crossed=merge(original.records,batch([...incoming].reverse()),ns);
assert.equal(crossed.records.filter(r=>r.source.databaseIdentity).length,0,'crossing anchors reject cross-source binding');
const repeated=merge([],batch([ui('text',left),uv(),ui('text',left)]),ns);
assert.equal(merge(repeated.records,batch([db('a','text',left),dv('v'),db('b','text',left)]),ns).added,3,'repeated text never establishes unique anchors');
const voicesOnly=merge([],batch([uv()]),ns);
assert.equal(merge(voicesOnly.records,batch([dv('alone')]),ns).added,1,'voice time/duration alone never identifies a bubble');
for(const [edgeText,ambiguous] of [['好的谢谢',false],['好的',false],['好的谢谢',true]]) {
  const rows=[ui('text',left),ui('text',right),uv(),ui('text',edgeText),...(ambiguous?[ui('text',edgeText)]:[])];
  const news=[db('left','text',left),db('right','text',right),dv('edge'),db('edge-text','text',edgeText),...(ambiguous?[db('duplicate-edge-text','text',edgeText)]:[])];
  const base=merge([],batch(rows),ns), result=merge(base.records,batch(news),ns);
  const voice=result.records.find(r=>r.localId===base.records[2].localId);
  assert.equal(!!voice.source.databaseIdentity,edgeText.length>=4&&!ambiguous,'only a globally unique, timed >=4-character edge text closes the voice interval');
}
const undatedEdge=merge([],batch([ui('text',left),ui('text',right),uv(),{...ui('text','好的谢谢'),at:''}]),ns);
assert.equal(merge(undatedEdge.records,batch([db('l','text',left),db('r','text',right),dv('edge'),db('tail','text','好的谢谢')]),ns).records.find(r=>r.localId===undatedEdge.records[2].localId).source.databaseIdentity,undefined,'an undated short edge reply cannot locate a voice');
const headRows=[uv(),ui('text',left),ui('text','头部支持一'),ui('text','头部支持二'),ui('text',right)];
const headDb=[dv('head'),db('head-left','text',left),db('support1','text','头部支持一'),db('support2','text','头部支持二'),db('head-right','text',right)];
const headBase=merge([],batch(headRows),ns), headMerged=merge(headBase.records,batch(headDb),ns);
assert.equal(headMerged.records.find(r=>r.localId===headBase.records[0].localId).source.databaseIdentity.id,'head','unique complete head run with three text supports identifies preceding voice');
const tailRows=[ui('text',left),ui('text',right),uv('Native first edge voice',true),{...ui('image','图片'),images:[png]},uv('Native second edge voice',true),ui('text','好的'),ui('text','谢谢你')];
const tailDb=[db('tail-left','text',left),db('tail-right','text',right),dv('tail1',true,'different ASR one'),db('tail-photo','image','[图片]'),dv('tail2',true,'different ASR two'),db('yes','text','好的'),db('thanks','text','谢谢你'),db('later','text','后来新增的消息不能破坏旧尾部的身份。')];
const tailBase=merge([],batch(tailRows),ns), tailMerged=merge(tailBase.records,batch(tailDb),ns);
assert.equal(tailMerged.records.find(r=>r.localId===tailBase.records[2].localId).source.databaseIdentity.id,'tail1');
assert.equal(tailMerged.records.find(r=>r.localId===tailBase.records[4].localId).source.databaseIdentity.id,'tail2');
assert.equal(tailMerged.records.find(r=>r.localId===tailBase.records[4].localId).text,'Native second edge voice');
assert.deepEqual(tailMerged.records.find(r=>r.localId===tailBase.records[3].localId).images,[png],'UI image preview remains intact across bracket-only placeholder differences');
assert.equal(tailMerged.records.find(r=>r.localId===tailBase.records[3].localId).text,'图片');
const captioned=merge([],batch(tailRows.map((r,index)=>index===3?{...r,text:'用户核对过的图片内容'}:r)),ns);
assert.equal(merge(captioned.records,batch(tailDb),ns).records.find(r=>r.localId===captioned.records[4].localId).source.databaseIdentity,undefined,'arbitrary image captions are not generalized into placeholders');
for(const changed of [
 headDb.toSpliced(2,0,db('unseen','other','[其他消息]')),
 headDb.map(r=>r.id==='head'?{...r,senderRole:'self'}:r),
 headDb.map(r=>r.id==='head'?{...r,at:new Date(2026,9,12,12,31,20).toISOString()}:r),
 [...headDb,...headDb.map(r=>({...r,id:r.id+'-repeat',source:{...r.source,messageId:r.id+'-repeat'}}))],
])assert.equal(merge(headBase.records,batch(changed),ns).records.find(r=>r.localId===headBase.records[0].localId).source.databaseIdentity,undefined,'incomplete, conflicting, or repeated edge runs cannot bind the voice');
const unknownDate=merge([],batch(originalRows.map(r=>({...r,at:'无法核对的时间'}))),ns);
assert.equal(merge(unknownDate.records,batch(incoming),ns).added,6,'unknown nonempty timestamps cannot silently match');
const corrupt=structuredClone(bound.records); corrupt[1].source.databaseIdentity.accountId='other-account';
assert.throws(()=>merge(corrupt,batch(full),ns),/关联凭据/);
const changedAlias=structuredClone(bound.records); changedAlias[1].source.databaseIdentity.sender='an-impostor';
assert.throws(()=>merge(changedAlias,batch(full),ns),/关联凭据/,'an alias sender changed after persistence is rejected');
assert.throws(()=>merge(bound.records,batch(incoming.map(r=>r.id==='voice1'?{...r,source:{...r.source,sessionId:'another-session'}}:r)),ns),/来源发生冲突/);
const direct=merge([],batch([db('photo','image','[图片]')]),ns);
direct.records[0].images=[png];
assert.equal(merge(direct.records,batch([db('photo','image','[图片]')]),ns).added,0,'retained image previews do not break stable DB replay');
console.log('PASS cross-source anchors, strict interval proof, native transcript preservation, stable replay, media preservation and alias rejection');

