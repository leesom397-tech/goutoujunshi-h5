import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const bundle=await build({entryPoints:['lib/reply-attention.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {computeReplyAttention:compute,isDirectReplyQuestion:isQuestion,replyAttentionPrompt}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const row=(id,role,text,at,extra={})=>({localId:id,senderRole:role,text,at,...extra});
const at=(day,hour=10,minute=0)=>`2026-10-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+08:00`;
const full={scope:'full-history'};
assert.equal(isQuestion('周六一起吃饭吗？'),true);
assert.equal(isQuestion('哈哈？'),false);
assert.equal(isQuestion('这不是很好吗？'),false);
assert.equal(isQuestion('“你喜欢我吗？”'),false);
let result=compute([row('a','self','今晚有空吗？',at(10)),row('b','other','有空呀',at(10,10,5))],full);
assert.equal(result.questions[0].status,'answered');assert.equal(result.questions[0].elapsedMinutes,5);
assert.equal(result.questions[0].question.sourceId,'a');assert.equal(result.questions[0].responses[0].sourceId,'b');
result=compute([row('a','self','你在哪儿？',at(10)),row('b','other','嗯',at(10,10,5))],full);
assert.equal(result.questions[0].status,'unclear','an acknowledgment does not answer an open location question');
for(const answer of ['yes','YES!','No.','nope','OK']) {
  const got=compute([row('q','self','要换模式了吗',at(10)),row('a','other',answer,at(10,10,5))],full);
  assert.equal(got.questions[0].status,'answered',`a closed question accepts explicit ${answer}`);
}
for(const [question,answer] of [
  ['几点出发？','可以'],['几点见？','嗯'],['几点见？','今天没事'],['几点走？','不知道8点能不能走'],
  ['什么时候来？','周六还没定'],['你在哪儿？','yes'],['在哪见？','我在忙'],
  ['在哪见？','我在考虑去公司'],['明天去还是后天去？','可以'],['什么时候有空？','有空'],
]) {
  const got=compute([row('q','self',question,at(10)),row('a','other',answer,at(10,10,5))],full);
  assert.equal(got.questions[0].status,'unclear',`${question} / ${answer} does not fill the requested detail`);
  assert.doesNotMatch(got.questions[0].label,/拒绝|不回|跳过/,'an unrecognized reply never becomes refusal or nonresponse');
}
for(const [question,answer] of [
  ['几点见？','下午两点半'],['几点出发？','14:30'],['哪天见？','周六'],
  ['你在哪里？','我在公司'],['你在哪儿？','家里'],['周六有空吗？','没空，下周再说'],
]) assert.equal(compute([row('q','self',question,at(10)),row('a','other',answer,at(10,10,5))],full).questions[0].status,'answered',`${question} / ${answer} has a concrete reply`);
result=compute([row('a','self','你愿意说说你的想法吗？',at(10)),row('b','other','不想回答，换个话题吧',at(10,10,5))],full);
assert.equal(result.questions[0].status,'bypassed');assert.match(result.headline,/明确跳过/);
result=compute([row('a','self','周六一起吃饭吗？',at(10)),row('b','other','哈哈哈',at(10,10,5))],full);
assert.equal(result.questions[0].status,'unclear');assert.match(result.headline,/没给出答案/);
result=compute([row('a','self','今晚有空吗？',at(10))],{...full,cutoffAt:at(10,12)});
assert.equal(result.questions[0].status,'cutoff');assert.equal(result.questions[0].elapsedMinutes,120);
assert.doesNotMatch(result.reading,/已读不回|不喜欢|拒绝/);assert.equal(result.cutoffAt,'2026-10-10T04:00:00.000Z');
assert.equal(compute([row('a','self','今晚有空吗？',at(10))],full).questions[0].elapsedMinutes,0,'never uses wall clock');
result=compute([row('a','self','今晚有空吗？',at(10)),row('b','other','[语音]',at(10,10,5),{kind:'other'})],full);
assert.equal(result.questions[0].status,'unread-context');
result=compute([row('a','self','今晚有空吗？',at(10),{sequence:1}),row('b','other','不想回答',at(10,10,5),{sequence:3})],full);
assert.equal(result.questions[0].status,'unread-context','missing records do not become ignored questions');
result=compute([row('a','self','今晚有空吗？',at(10)),row('b','self','那周日呢？',at(10,10,1)),row('c','other','有空',at(10,10,5))],full);
assert.equal(result.questions.find(q=>q.question.sourceId==='a').status,'unclear','later answer cannot be assigned to an earlier superseded question');
assert.equal(result.questions.find(q=>q.question.sourceId==='b').status,'answered');
result=compute([row('a','self','你好',at(10)),row('b','self','在吗？',at(10,10,1)),row('c','self','今天一起吃饭吗？',at(11)),row('d','self','忙完了吗？',at(12))],full);
assert.equal(result.initiations[0].attempts,3);assert.equal(result.initiations[0].messages,4);assert.equal(result.initiations[0].laterReply,null);
assert.match(result.initiations[0].reading,/材料截止后的回应未知/);
assert.equal(compute([row('a','self','在吗？',at(10)),row('b','self','你好',at(10,10,1)),row('c','self','你好',at(10,10,2))],full).initiations.length,0,'three bubbles are not three initiations');
const comparison=[];for(const day of [2,3,4,19,20,21])comparison.push(row('q'+day,'self','今晚有空吗？',at(day)),row('a'+day,'other',day<10?'有空':'换个话题吧',at(day,11)));
result=compute(comparison,full);assert.equal(result.comparison.status,'changed');assert.equal(result.recent.answered,0);assert.equal(result.previous.answered,3);assert.match(result.comparison.text,/下降/);
const ambiguousComparison=comparison.map(r=>r.localId==='a19'?{...r,text:'我下午先处理完手头的事'}:r);
const ambiguousResult=compute(ambiguousComparison,full);
assert.equal(ambiguousResult.recent.unclear,1);assert.equal(ambiguousResult.comparison.status,'insufficient');
assert.match(ambiguousResult.comparison.text,/结合原话核对/);assert.doesNotMatch(ambiguousResult.comparison.text,/下降|降温|增多/,'a rule that cannot interpret a reply must not infer a worsening response trend');
assert.equal(result.questions[0].question.sourceId,'q21','latest comes first');assert.ok(replyAttentionPrompt(result).length<20000);
assert.equal(compute(comparison,{scope:'evidence-only'}).questions.length,0);
assert.equal(compute([row('a','self','今晚有空吗？',at(10),{libraryId:'one'}),row('b','other','不去',at(10,11),{libraryId:'two'})],full).status,'insufficient');
assert.equal(compute([row('a','self','今晚有空吗？','昨天')],full).questions[0].elapsedMinutes,null);
assert.equal(compute([row('a','self','今晚有空吗？',at(10),{source:{timestampOrigin:'captured-at'}})],full).recent,null,'capture time is never a message date');
assert.equal(compute([row('a','self','你好',at(10),{sequence:1}),row('b','self','在吗？',at(11),{sequence:3})],full).initiations.length,0,'missing intermediate messages cannot establish uninterrupted self-only initiations');
assert.equal(compute([row('a','self','今晚有空吗？','2026-02-30T10:00:00+08:00')],full).questions[0].elapsedMinutes,null);
assert.equal(compute([row('a','self','今晚有空吗？',at(10)),row('b','other','有空',at(10))],full).questions[0].status,'unread-context','same timestamp does not establish order');
const originals=[row('a','self','今晚有空吗？',at(10)),row('b','other','有空',at(10,11))],before=JSON.stringify(originals);
assert.deepEqual(compute([...originals,...originals],full),compute(originals,full));assert.equal(JSON.stringify(originals),before);
assert.equal(compute([row('a','self','今晚有空吗？',at(10)),row('a','other','你说什么？',at(10))],full).questionCount,0);
assert.equal(compute([row('a','self','今晚有空吗？',at(10),{sourceKind:'moments'})],full).questionCount,0);
const large=Array.from({length:20000},(_,i)=>row('long'+i,'self','今晚有空吗？',new Date(Date.UTC(2026,0,1)+i*60000).toISOString()));
const started=performance.now(),largeResult=compute(large,full);assert.equal(largeResult.questionCount,20000);assert.equal(largeResult.questions.length,8);assert.ok(performance.now()-started<3000,'20k unanswered messages must remain a bounded linear scan');
console.log('PASS reply attention: direct questions, explicit bypass, vague reply, material cutoff, fixed-time duration, unread media/gaps, superseded questions, separated initiations, recent vs previous, evidence/identity isolation and no mutation.');
const ui=await build({entryPoints:['components/web-analysis/ReplyAttentionOverview.tsx'],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react/jsx-runtime'],plugins:[{name:'test-css',setup(b){b.onLoad({filter:/\.module\.css$/},()=>({contents:'export default {};',loader:'js'}));}}]});
const require=createRequire(import.meta.url),module={exports:{}};new Function('require','module','exports',ui.outputFiles[0].text)(require,module,module.exports);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const tail=compute([row('t','self','周六一起吃饭吗？',at(10))],{...full,cutoffAt:at(10,12)});
const html=renderToStaticMarkup(React.createElement(module.exports.ReplyAttentionOverview,{report:{id:'synthetic',semanticHistory:{replyAttention:tail}}}));
assert.match(html,/材料到这里，后续未知/);assert.match(html,/2 小时/);assert.match(html,/不是截至现在的等待时长/);assert.match(html,/周六一起吃饭吗/);assert.doesNotMatch(html,/已读不回/);
const unsafe=renderToStaticMarkup(React.createElement(module.exports.ReplyAttentionOverview,{report:{id:'old',analysisScope:'fullHistory',recentSentenceAnalysis:{scope:'recent',lines:[row('t','self','为什么不回我？',at(10))]}}}));
assert.equal(unsafe,'','legacy annotated snippets cannot fabricate continuous reply history');
console.log('PASS reply-attention UI: saved summary renders original question and fixed cutoff; unsafe legacy samples stay excluded.');
