// Synthetic OCR structures only: no network, real screenshots, credentials, or storage.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';

const nativeRequire=createRequire(import.meta.url),root=resolve('.');
function load(file,mocks={},cache=new Map()) {
  const path=resolve(root,file);
  if(cache.has(path))return cache.get(path).exports;
  const module={exports:{}};cache.set(path,module);
  if(path.endsWith('.json')){module.exports=JSON.parse(readFileSync(path,'utf8'));return module.exports;}
  const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const require=id=>{
    if(id in mocks)return mocks[id];
    if(id==='cloudflare:workers')return {env:{}};
    if(id.startsWith('.')||id.startsWith('@/')) {
      let next=id.startsWith('@/')?resolve(root,id.slice(2)):resolve(dirname(path),id);
      if(!/\.(?:[cm]?[jt]sx?|json)$/.test(next))next+='.ts';
      return load(next,mocks,cache);
    }
    return nativeRequire(id);
  };
  new Function('require','module','exports',source)(require,module,module.exports);
  return module.exports;
}
const tags=()=>[[{key:'calm',weight:100}],[{key:'share',weight:100}],'limited','通过表情包或文字接续话题，也可能只是轻松表达，不能据此认定承诺。'];
const row=(side,kind,text='')=>[side,kind,text,...(['text','sticker'].includes(kind)?tags():[[],[],'insufficient',''])];
const photo={location:'第3个气泡',observation:'茶杯和茶汤',inference:'这张照片可能在分享茶饮体验',alternative:'也可能是转发的图片',verify:'这是最近看到的茶吗？'};
const reply={style:'轻松承接',text:'哈哈，这个表情很可爱',reason:'对方发送了表情包',cost:'只轻松回应，不升级亲密度',weight:70};
const mocks={
  '@/lib/knowledge':{selectKnowledge:()=>[]},
  '@/lib/qwen':{parseQwenJson:JSON.parse,qwenPublicError:()=>'',qwenChat:async()=>{throw new Error('Unexpected model request');}},
};
const screenshot=load('lib/crush/screenshot.ts',mocks);
const photoApi=load('lib/screenshot-photo.ts');
const base={layout:'wechat-one-to-one',complete:true,lines:[row('right','text','今天忙吗？'),row('left','sticker','我想你了'),row('left','image','')],photoClues:[{...photo,lineIndex:2,side:'left',speaker:'self'}]};
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}

await test('sticker letters survive with a medium marker, correct order and both self-side settings',()=>{
  const snapshot=structuredClone(base);
  for(const [selfSide,speakers] of [['right',['self','other']],['left',['other','self']]]){
    const result=screenshot.prepareScreenshot(base,selfSide);
    assert.equal(result.count,2);
    assert.equal(result.skipped,1);
    assert.equal(result.decision.unreadText,0);
    assert.equal(result.decision.partial,false);
    assert.deepEqual(result.prepared.lines.map(line=>line.speaker),speakers);
    assert.deepEqual(result.prepared.lines.map(line=>line.text),['今天忙吗？','【表情包文字】我想你了']);
    assert.match(result.text,/【表情包文字】我想你了/);
  }
  const right=screenshot.prepareScreenshot(base,'right');
  assert.match(right.decision.evidence,/对方表情包文字/);
  assert.match(screenshot.formatScreenshotQuick(right,'测试对象'),/对方表情包文字/);
  assert.deepEqual(base,snapshot,'validation must not mutate OCR source data');
});

await test('a photo description cannot become a typed quote, including the tea regression',()=>{
  const result=screenshot.prepareScreenshot({...base,lines:[row('right','text','今天忙吗？'),row('left','image','我喝茶'),row('left','text','刚有空')],photoClues:[{...photo,lineIndex:1,side:'left'}]},'right');
  assert.deepEqual(result.prepared.lines.map(line=>line.text),['今天忙吗？','刚有空']);
  assert.doesNotMatch(result.text,/我喝茶|茶杯/);
  assert.equal(result.decision.photoClues[0].observation,'茶杯和茶汤');
  assert.equal(result.decision.photoClues[0].speaker,'other');
  assert.equal(result.decision.photoClues[0].lineId,'bubble-1');
  const ambiguous=screenshot.prepareScreenshot({...base,lines:[row('right','text','今天忙吗？'),row('left','image','我想你了')]},'right');
  assert.equal(ambiguous.count,1,'legacy image.text is not enough to assert sticker lettering');
});

await test('photo ownership follows the actual linked bubble and selfSide, never a model speaker',()=>{
  for(const [selfSide,speaker] of [['right','other'],['left','self']]){
    const clue=screenshot.prepareScreenshot(base,selfSide).decision.photoClues[0];
    assert.deepEqual(clue,{...photo,lineIndex:2,side:'left',speaker,lineId:'bubble-2'});
  }
  const objects={...base,lines:base.lines.map(line=>({side:line[0],kind:line[1],text:line[2],emotions:line[3],intents:line[4],evidence:line[5],note:line[6]}))};
  assert.equal(screenshot.prepareScreenshot(objects,'right').decision.photoClues[0].speaker,'other');
  const direct=photoApi.bindScreenshotPhotoClues([{...photo,lineIndex:2,speaker:'self'}],base.lines,'right')[0];
  assert.equal(direct.speaker,'other','even a supplied speaker must not override bubble position');
});

await test('conflicting, invalid, non-photo and old unlinked clues remain unknown',()=>{
  const cases=[
    {...photo,lineIndex:2,side:'right'},
    {...photo,lineIndex:1,side:'left'},
    {...photo,lineIndex:-1,side:'left'},
    {...photo,lineIndex:1.5,side:'left'},
    {...photo,lineIndex:80,side:'left'},
    {...photo,lineIndex:'2',side:'left'},
    {...photo,side:'left',speaker:'self'},
    {...photo,speaker:'self',lineId:'bubble-2'},
    photo,
  ];
  for(const raw of cases){
    const clue=screenshot.prepareScreenshot({...base,photoClues:[raw]},'right').decision.photoClues[0];
    assert.equal(clue.speaker,'unknown',JSON.stringify(raw));
    assert.equal(clue.side,'unknown');
    assert.equal(clue.lineId,'');
    assert.equal(clue.observation,photo.observation);
  }
  assert.deepEqual(photoApi.screenshotPhotoClues([photo]),[photo],'legacy fields remain compatible');
  const unknown=screenshot.prepareScreenshot({...base,lines:[row('right','text','今天忙吗？'),row('unknown','image','')],photoClues:[{...photo,lineIndex:1}]},'right').decision.photoClues[0];
  assert.equal(unknown.speaker,'unknown');
  assert.equal(unknown.side,'unknown');
  const noIdentity=photoApi.bindScreenshotPhotoClues([{...photo,lineIndex:2}],base.lines,'unknown')[0];
  assert.equal(noIdentity.speaker,'unknown');
});

await test('uncertain sticker lettering or side is not invented, and a final media bubble cannot trigger another reply',()=>{
  const unknown=screenshot.prepareScreenshot({...base,lines:[row('right','text','今天忙吗？'),row('unknown','sticker','我想你了')]},'right');
  assert.equal(unknown.count,1);assert.equal(unknown.decision.unknownSpeaker,1);assert.equal(unknown.decision.partial,true);
  const unread=screenshot.prepareScreenshot({...base,lines:[row('right','text','今天忙吗？'),row('left','unread','我想…')]},'right');
  assert.equal(unread.count,1);assert.equal(unread.decision.unreadText,1);
  for(const side of ['right','left']){
    const result=screenshot.prepareScreenshot({...base,lines:[row('right','text','今天忙吗？'),row('left','sticker','我想你了'),row(side,'image','')],replyDraft:reply.text,replyOptions:[reply]},'right');
    assert.equal(result.decision.replyDraft,'');assert.deepEqual(result.decision.replyOptions,[]);
  }
  const clear=screenshot.prepareScreenshot({...base,lines:base.lines.slice(0,2),replyDraft:reply.text,replyOptions:[reply]},'right');
  assert.equal(clear.decision.replyOptions.length,1);
});

await test('quick vision schema explicitly distinguishes visible sticker letters from photo descriptions',async()=>{
  let sent;
  const raw={layout:'wechat-one-to-one',lines:[['right','text','今天忙吗？'],['left','sticker','我想你了']],anchor:'我想你了',judgment:'对方发来一句表情包文字。',nextStep:'轻松接住表情包。',replyOptions:[{style:reply.style,text:reply.text}]};
  const module=load('lib/crush/screenshot.ts',{...mocks,'@/lib/qwen':{...mocks['@/lib/qwen'],qwenChat:async(messages,options)=>{sent={messages,options};return JSON.stringify(raw);}}});
  const result=await module.readScreenshotQuickData('data:image/png;base64,synthetic','right');
  assert.match(result.text,/对方表情包文字「我想你了」/);
  const prompt=sent.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
  assert.match(prompt,/text\/sticker\/voice\/image\/unread/);
  assert.match(prompt,/text只逐字抄写图片上真实存在的字/);
  assert.match(prompt,/不能改变发送者/);
  assert.match(prompt,/不能写成‘我喝茶’/);
  assert.match(prompt,/lineIndex.*零基索引/);
  assert.equal(sent.options.vision,true);
  assert.equal(sent.options.maxTokens,3200,'media correctness must not change model budget');
});

await test('short quick-OCR reuse preserves sticker kind and photo bubble indices without a vision retry',async()=>{
  const ocr={layout:base.layout,lines:base.lines.map(line=>line.slice(0,3)),photoClues:base.photoClues};
  ocr.lines[2][2]='我喝茶';
  const expectedLines=ocr.lines.map(line=>line[1]==='image'?[line[0],line[1],'']:line);
  const requests=[];
  const module=load('lib/crush/screenshot.ts',{...mocks,'@/lib/qwen':{...mocks['@/lib/qwen'],qwenChat:async(messages,options)=>{
    requests.push({messages,options});
    const input=JSON.parse(messages[1].content);
    assert.deepEqual(input.lines,expectedLines);
    assert.doesNotMatch(messages[1].content,/我喝茶/,'pure-photo captions must not become text-model input');
    return JSON.stringify({annotations:input.lines.map(line=>line[1]==='image'?[[],[],'insufficient','']:tags()),replyOptions:[]});
  }}});
  const result=await module.readScreenshotFromQuick(ocr,'right',[],'');
  assert.equal(requests.length,1);
  assert.ok(requests.every(request=>!request.options.vision));
  assert.match(requests[0].messages[0].content,/kind=sticker/);
  assert.equal(result.prepared.lines[1].text,'【表情包文字】我想你了');
  assert.equal(result.prepared.lines[1].speaker,'other');
  assert.equal(result.decision.photoClues[0].lineId,'bubble-2');
  assert.equal(result.decision.photoClues[0].speaker,'other');
  assert.equal(ocr.lines[2][2],'我喝茶','sanitizing text-model input does not mutate OCR source');
});

await test('batched quick-OCR reuse keeps text order, original photo indices and sticker ownership',async()=>{
  const ocr={layout:base.layout,lines:[['right','text','今天忙吗？'],['left','image','我喝茶'],['left','sticker','我想你了'],['right','text','哈哈看到了'],['left','text','刚下班'],['right','text','先休息一下吧']],photoClues:[{...photo,lineIndex:1,side:'left'}]};
  const expectedLines=ocr.lines.map(line=>line[1]==='image'?[line[0],line[1],'']:line);
  const requests=[];
  const module=load('lib/crush/screenshot.ts',{...mocks,'@/lib/qwen':{...mocks['@/lib/qwen'],qwenChat:async(messages,options)=>{
    const input=JSON.parse(messages[1].content);requests.push({input,options,prompt:messages[0].content});
    assert.deepEqual(input.lines,expectedLines);
    assert.doesNotMatch(messages[1].content,/我喝茶/);
    return JSON.stringify({annotations:input.targetIndices.map(index=>input.lines[index][1]==='image'?[[],[],'insufficient','']:tags()),replyOptions:[]});
  }}});
  const result=await module.readScreenshotFromQuick(ocr,'right',[],'');
  assert.equal(requests.length,2);
  assert.deepEqual(requests.flatMap(request=>request.input.targetIndices).sort((a,b)=>a-b),[0,1,2,3,4,5]);
  assert.ok(requests.every(request=>!request.options.vision&&/kind=sticker/.test(request.prompt)));
  assert.deepEqual(result.prepared.lines.map(line=>line.text),['今天忙吗？','【表情包文字】我想你了','哈哈看到了','刚下班','先休息一下吧']);
  assert.equal(result.prepared.lines[1].speaker,'other');
  assert.equal(result.decision.photoClues[0].lineIndex,1);
  assert.equal(result.decision.photoClues[0].speaker,'other');
});

await test('full vision uses the same media contract without changing its token budget',async()=>{
  let sent;
  const module=load('lib/crush/screenshot.ts',{...mocks,'@/lib/qwen':{...mocks['@/lib/qwen'],qwenChat:async(messages,options)=>{sent={messages,options};return JSON.stringify(base);}}});
  const result=await module.readScreenshot('data:image/png;base64,synthetic','right',[],'');
  assert.match(sent.messages[0].content,/kind为text\/sticker\/voice\/image\/system\/unread/);
  assert.match(sent.messages[0].content,/不能写成‘我喝茶’/);
  assert.match(sent.messages[0].content,/不因发图就认定拍摄者/);
  assert.equal(sent.options.maxTokens,3600);
  assert.equal(result.prepared.lines[1].text,'【表情包文字】我想你了');
  assert.equal(result.decision.photoClues[0].speaker,'other');
});

await test('interaction insight survives quick analysis with photo sender evidence and no extra request',async()=>{
  const insight={label:'接住但暂未升级',observed:'我发表情包想你，对方回Really后发茶图',interpretation:'可能在缓冲亲密话题，同时继续互动',alternative:'也可能只是自然分享日常',verify:'留意后续是否主动延续亲密表达'};
  const ocr={layout:base.layout,lines:[['right','sticker','想你'],['left','text','Really'],['left','image','']],photoClues:[{...photo,lineIndex:2,side:'left'}]};
  let count=0;
  const module=load('lib/crush/screenshot.ts',{...mocks,'@/lib/qwen':{...mocks['@/lib/qwen'],qwenChat:async(messages)=>{
    count++;
    const input=JSON.parse(messages[1].content);
    assert.equal(input.photoClues[0].speaker,'other');
    assert.match(messages[0].content,/不能仅凭换话题定性欲拒还迎/);
    return JSON.stringify({interactionInsight:insight,annotations:input.lines.map(line=>line[1]==='image'?[[],[],'insufficient','']:tags()),replyOptions:[]});
  }}});
  const result=await module.readScreenshotFromQuick(ocr,'right',[],'');
  assert.equal(count,1);
  assert.deepEqual(result.decision.interactionInsight,insight);
  assert.equal(result.prepared.lines[0].speaker,'self');
  assert.equal(result.decision.photoClues[0].speaker,'other');
  assert.equal(screenshot.prepareScreenshot({...base,interactionInsight:{label:'残缺结论'}},'right').decision.interactionInsight,null);
});

console.log(`PASS ${passed} screenshot-media regression tests (synthetic OCR only; no real-image accuracy claim)`);
