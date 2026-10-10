// Built local React pages; synthetic accounts/audio/model packets only.
// All /api requests are intercepted. Never uses a real microphone or paid model.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base='http://127.0.0.1:5191', output='outputs/conversation-parity';
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'chengzi-conversation-qa-'));
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,serial=0,sessionId,owner='11111111-1111-4111-8111-111111111111',failText=true,holdText=false,held;
let prices={text:5,transcription:5,voice:20};
const pending=new Map(),exceptions=[],checks=[],requests=[];
const ownerA=owner,ownerB='44444444-4444-4444-8444-444444444444',person='22222222-2222-4222-8222-222222222222',personB='33333333-3333-4333-8333-333333333333';
const answer={possibleIntent:'合成回答：先确认具体情境。',evidence:'合成依据',nextStep:'合成建议：确认时间。',replies:[]};
function call(method,params={},sid){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});}
const send=(method,params)=>call(method,params,sessionId);
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+r.result.description);return r.result.value;}
async function until(expression,label){for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(80);}throw Error('Timed out: '+label);}
async function navigate(path){await send('Page.navigate',{url:base+path});await until('document.readyState==="complete" && location.pathname==='+JSON.stringify(path.split('?')[0]),path);await delay(450);}
async function click(text){await evaluate(`(()=>{const n=[...document.querySelectorAll('button')].find(n=>n.textContent.includes(${JSON.stringify(text)}));if(!n||n.disabled)throw Error('Missing/disabled '+${JSON.stringify(text)});n.click()})()`);await delay(80);}
async function input(selector,value){await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing field');Object.getOwnPropertyDescriptor(n.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(70);}
async function consent(selector='.wa-composer input[type=checkbox]'){await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(n&&!n.checked)n.click()})()`);await delay(60);}
async function fulfill(id,data,status=200){await send('Fetch.fulfillRequest',{requestId:id,responseCode:status,responseHeaders:[{name:'content-type',value:'application/json'},{name:'cache-control',value:'no-store'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});}
async function respond(event){
 const path=new URL(event.request.url).pathname;
 if(path==='/api/auth/session')return fulfill(event.requestId,{loggedIn:true,user:{id:owner,name:'合成测试账号'}});
 if(path==='/api/account/credits')return fulfill(event.requestId,{account:{userId:owner,balance:100,reserved:0,features:['analysis','chat','voice'],active:true},prices});
 if(path==='/api/web/profile')return fulfill(event.requestId,{enabled:true,paused:false,subjects:[{id:person,label:'合成人物'},{id:personB,label:'另一位合成人物'}]});
 if(path==='/api/web/voice-live/status')return fulfill(event.requestId,{configured:true,remaining:30});
 if(path==='/api/web/text'){
  const body=JSON.parse(event.request.postData);requests.push(body);
  if(holdText){held=event.requestId;return;}
  if(failText){failText=false;return fulfill(event.requestId,{error:'合成断线，请重试'},503);}
  return fulfill(event.requestId,answer);
 }
 return fulfill(event.requestId,{error:'Unexpected synthetic API '+path},501);
}
const fakeAudio=`(()=>{
 const originalTimeout=window.setTimeout;
 const state=window.__voice={tracks:[],contexts:[],processors:[],sockets:[],sources:[],longTimers:0,deferMic:false,resolveMic:null};
 window.setTimeout=(callback,ms,...args)=>{if(ms===180000)state.longTimers++;return originalTimeout(callback,ms,...args)};
 class Context{constructor(){this.state='running';this.sampleRate=16000;this.currentTime=1;this.destination={};state.contexts.push(this)}resume(){return Promise.resolve()}close(){this.state='closed';return new Promise(r=>originalTimeout(r,35))}createMediaStreamSource(){return{connect(){},disconnect(){}}}createScriptProcessor(){const p={connect(){},disconnect(){},onaudioprocess:null};state.processors.push(p);return p}createGain(){return{connect(){},disconnect(){},gain:{value:1}}}createBuffer(_c,n){return{getChannelData:()=>new Float32Array(n)}}createBufferSource(){const s={buffer:null,connect(){},start(){},stop(){s.stopped=true},stopped:false,onended:null};state.sources.push(s);return s}}
 window.AudioContext=Context;
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{const track={stopped:false,onended:null,stop(){this.stopped=true}};state.tracks.push(track);const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};if(state.deferMic)return new Promise(resolve=>state.resolveMic=()=>resolve(stream));return stream}}});
 class Socket{static OPEN=1;static CLOSING=2;static CLOSED=3;constructor(url){this.url=url;this.readyState=1;this.sent=[];state.sockets.push(this);originalTimeout(()=>this.onopen?.(),10)}send(data){this.sent.push(JSON.parse(data))}close(){this.readyState=3}emit(data){this.onmessage?.({data:JSON.stringify(data)})}}
 window.WebSocket=Socket;
 window.__packet=packet=>state.sockets.at(-1).emit(packet);
})();`;

try{
 let info;for(let i=0;i<80;i++){try{info=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break;}catch{await delay(100);}}
 if(!info)throw Error('Edge failed');socket=new WebSocket('ws://127.0.0.1:'+info[0]+info[1]);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Fetch.requestPaused')void respond(m.params).catch(e=>exceptions.push(String(e)));if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});sessionId=(await call('Target.attachToTarget',{targetId,flatten:true})).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:base+'/api/*',requestStage:'Request'}]});await send('Page.addScriptToEvaluateOnNewDocument',{source:fakeAudio});await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await navigate('/chat');await until("!!document.querySelector('.wa-composer button')&&!document.body.innerText.includes('价格读取中')",'account ready');
 await input('.wa-composer textarea','合成问题A，不应串入B');await consent();await click('发送 ·');await until("document.body.innerText.includes('合成断线')",'failed text');
 await send('Page.reload');await until("document.querySelector('.wa-composer textarea')?.value==='合成问题A，不应串入B'",'draft restored');await consent();await click('发送 ·');await until("document.querySelectorAll('.wa-chat-message').length===2",'retry reply');
 assert.equal(requests[0].requestId,requests[1].requestId,'same failed task retries once after reload');assert.deepEqual(requests[0],requests[1]);
 checks.push('same request/body survives reload; successful reply restores normally');
 await evaluate("document.querySelector('.wa-chat-settings input[type=checkbox]').click()");await delay(100);
 owner=ownerB;await evaluate("window.dispatchEvent(new Event('focus'))");await until("document.querySelectorAll('.wa-chat-message').length===0",'account B isolation');
 const b=await evaluate(`JSON.parse(sessionStorage.getItem('chengzi-chat:${ownerB}'))`);
 assert.equal(b.owner,ownerB);assert.equal(b.messages.length,0);assert.equal(b.subject,'');
 assert.equal(await evaluate("document.querySelector('.wa-chat-settings input[type=checkbox]').checked"),false);
 assert.ok((await evaluate(`localStorage.getItem('chengzi-chat:${ownerA}')`)).includes('合成问题A'));
 checks.push('account switch clears visible state and never persists A content under B');

 owner=ownerA;await navigate('/chat?mode=positioning');await until("document.querySelector('.wa-chat-settings [role=tab][aria-selected=true]')?.textContent.includes('需求')",'mode deep link');
 await evaluate(`(()=>{const select=document.querySelector('.wa-chat-settings select');select.value='${person}';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await until(`new URLSearchParams(location.search).get('subjectId')==='${person}'`,'selected person updates entry URL');
 await send('Page.reload');await until(`document.querySelector('.wa-chat-settings select')?.value==='${person}'`,'selected person survives reload');
 await click('直接聊');assert.equal(await evaluate("new URLSearchParams(location.search).has('mode')"),false);
 await evaluate(`sessionStorage.setItem('web-followup:qa-report',JSON.stringify({accountId:'${ownerA}',subjectId:'${person}',title:'合成报告',summary:'${'前'.repeat(700)}尾部证据',expiresAt:Date.now()+60000}))`);
 await navigate('/chat?context=qa-report');await input('.wa-composer textarea','请继续解释这份合成报告');await consent();await click('发送 ·');await until("document.querySelectorAll('.wa-chat-message').length===2",'followup');
 assert.ok(requests.at(-1).history[1].content.includes('尾部证据'));
 await send('Page.reload');await until("document.querySelectorAll('.wa-chat-message').length===2",'report conversation retained after reload');
 checks.push('entry mode honored; report summary tail transmitted and conversation survives report reload');

 for(const reloadAfterExpiry of [false,true]){
  const handoff='qa-expiry-'+(reloadAfterExpiry?'reload':'same-page'),question='合成到期追问：'+handoff,before=requests.length;
  await evaluate(`sessionStorage.setItem('web-followup:${handoff}',JSON.stringify({accountId:'${ownerA}',subjectId:'${person}',title:'到期重试报告',summary:'这条证据属于原人物，重试应保持原样。',expiresAt:Date.now()+60000}))`);
  failText=true;await navigate('/chat?context='+handoff);await input('.wa-composer textarea',question);await consent();await click('发送 ·');await until("document.body.innerText.includes('合成断线')",'report request failed before expiry');
  const original=requests.at(-1);
  if(reloadAfterExpiry){
   await evaluate(`(()=>{const key='web-followup:${handoff}',data=JSON.parse(sessionStorage.getItem(key));data.expiresAt=Date.now()-1;sessionStorage.setItem(key,JSON.stringify(data))})()`);
   await send('Page.reload');await until(`document.querySelector('.wa-composer textarea')?.value===${JSON.stringify(question)}`,'expired pending draft restored');
   await until("document.body.innerText.includes('上次请求已保留')",'expiry recovery is explained');
   await send('Page.reload');await until(`document.querySelector('.wa-composer textarea')?.value===${JSON.stringify(question)}`,'second expired reload keeps original request');await consent();
  }else await evaluate('window.__qaActualNow=Date.now;Date.now=()=>window.__qaActualNow()+61000');
  await click('发送 ·');await until("document.querySelectorAll('.wa-chat-message').length===2",'expired pending answer recovered');
  assert.equal(requests.length,before+2);assert.deepEqual(requests.at(-1),original,'expired retry must reuse the entire original paid request body');
  assert.equal(requests.at(-1).subjectId,person);
  await input('.wa-composer textarea','这是一条过期后才写的新问题');await click('发送 ·');await until("document.body.innerText.includes('报告上下文已过期')",'new expired context request blocked');
  assert.equal(requests.length,before+2,'expiry must not allow a new paid request with old report material');
  if(!reloadAfterExpiry)await evaluate('Date.now=window.__qaActualNow');
 }
 checks.push('same-page expiry and repeated expired reload preserve original request/body; fresh expired-context sends are blocked');

 const beforePreset=requests.length;await navigate('/chat?subjectId='+person+'&preset=followup');
 await until("document.querySelector('.wa-composer textarea')?.value.includes('我实际做了什么')",'followup preset is editable');
 const followupDraft=await evaluate("document.querySelector('.wa-composer textarea').value");
 for(const part of ['对方的真实回应或具体行为','我自己的感受','现在最想弄清楚的问题'])assert.ok(followupDraft.includes(part));
 assert.equal(await evaluate("document.querySelector('.wa-chat-settings select').value"),person);
 assert.ok(await evaluate("document.querySelector('.wa-chat-settings [role=tab][aria-selected=true]').textContent.includes('直接聊')"));
 assert.equal(await evaluate("document.querySelector('.wa-composer input[type=checkbox]').checked"),false);
 assert.equal(requests.length,beforePreset,'opening a followup template cannot send or charge');
 checks.push('followup preset retains selected person, fills four concrete progress prompts and never sends automatically');

 const beforeFocused=requests.length,focusedQuestion='关于这条具体推测，哪一种真实回应会让判断改变？';
 await evaluate(`sessionStorage.setItem('web-followup:qa-focused',JSON.stringify({accountId:'${ownerA}',subjectId:'${person}',title:'核实选中的判断',summary:'选中的原话与另一种解释，不是已确认事实。',question:${JSON.stringify(focusedQuestion)},expiresAt:Date.now()+60000}))`);
 await navigate('/chat?context=qa-focused');await until(`document.querySelector('.wa-composer textarea')?.value===${JSON.stringify(focusedQuestion)}`,'focused question seeds editable composer');
 assert.equal(await evaluate("document.querySelector('.wa-composer input[type=checkbox]').checked"),false);
 await input('.wa-composer textarea','这是我改过的具体问题');await send('Page.reload');await until("document.querySelector('.wa-composer textarea')?.value==='这是我改过的具体问题'",'edited focus draft restored');
 await click('清空草稿');await until("document.querySelector('.wa-composer textarea')?.value===''",'focused draft cleared');await send('Page.reload');await until("!!document.querySelector('.chat-report-context')&&!!document.querySelector('.wa-composer textarea')",'empty focus conversation restored');
 assert.equal(await evaluate("document.querySelector('.wa-composer textarea').value"),'','cleared focus draft must not be re-seeded on reload');
 assert.equal(requests.length,beforeFocused,'focused question navigation and draft edits must never auto-send');
 checks.push('focused insight question seeds once; edits and cleared draft survive reload without auto-send');
 await evaluate("document.querySelector('[aria-label=\"开始新对话\"]').click()");

 holdText=true;await input('.wa-composer textarea','这个异步回答只属于A');await consent();await click('发送 ·');
 for(let i=0;i<50&&!held;i++)await delay(60);assert.ok(held);
 owner=ownerB;await evaluate("window.dispatchEvent(new Event('focus'))");await delay(400);await fulfill(held,answer);await delay(250);
 assert.equal(await evaluate("document.body.innerText.includes('这个异步回答只属于A')"),false);holdText=false;
 checks.push('late text response cannot refill a different account');

 await navigate('/voice?subjectId='+person);await consent('.wa-voice-card input[type=checkbox]');await consent('.wa-voice-card input[type=checkbox]:last-of-type');
 // Each checkbox belongs to a separate label, so select by collection for the global scope checkbox.
 await evaluate("(()=>{for(const n of document.querySelectorAll('.voice-page input[type=checkbox]'))if(!n.checked)n.click()})()");await click('开始通话');
 await until("window.__voice.sockets.length===1",'synthetic socket');
 assert.ok((await evaluate('window.__voice.sockets[0].url')).includes('profileConsent=1'));
 await evaluate("__packet({type:'session.updated'})");await until("document.body.innerText.includes('正在听你说话')",'talking');
 await evaluate("__packet({type:'session.updated'})");assert.equal(await evaluate('window.__voice.longTimers'),1,'duplicate ready cannot extend call');
 await evaluate("__packet({type:'response.audio.delta',delta:btoa('\\0'.repeat(1600))})");assert.equal(await evaluate('window.__voice.sources.length'),1);
 await evaluate("__packet({type:'input_audio_buffer.speech_started'})");assert.equal(await evaluate('window.__voice.sources[0].stopped'),true,'speaking interrupts playback');
 await click('静音');await evaluate("window.__voice.processors[0].onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.15)}})");
 assert.equal(await evaluate("window.__voice.sockets[0].sent.filter(p=>p.type==='input_audio_buffer.append').length"),0);
 await click('开启麦克风');await evaluate("window.__voice.processors[0].onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.15)}})");assert.equal(await evaluate("window.__voice.sockets[0].sent.filter(p=>p.type==='input_audio_buffer.append').length"),1);
 await evaluate('window.__voice.tracks[0].onended()');await until("document.body.innerText.includes('麦克风已停止')",'natural stop');await delay(150);
 assert.ok(await evaluate('window.__voice.tracks.every(t=>t.stopped)&&window.__voice.contexts.every(c=>c.state==="closed")'));
 checks.push('voice profile scope, duplicate-ready timer, interruption, mute/resume and natural-device-stop cleanup');

 await navigate('/voice');await evaluate('window.__voice.deferMic=true');await consent('.wa-voice-card input[type=checkbox]');await click('开始通话');await until('!!window.__voice.resolveMic','microphone permission pending');await click('结束通话');await evaluate('window.__voice.resolveMic()');await delay(250);
 assert.equal(await evaluate('window.__voice.sockets.length'),0);assert.ok(await evaluate('window.__voice.tracks.every(t=>t.stopped)'));
 checks.push('cancel while microphone permission is pending cannot open a paid socket');

 await navigate('/voice');await click('检测麦克风');await until('window.__voice.processors.length===1','local microphone check');
 await evaluate("window.__voice.processors[0].onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4096).fill(.15)}})");
 assert.equal(await evaluate('window.__voice.sockets.length'),0,'microphone check must not connect to paid provider');
 assert.ok(await evaluate("Array.from(document.querySelectorAll('.voice-sound-level i')).some(n=>parseFloat(n.style.height)>4)"));
 await click('停止检测');await until('window.__voice.tracks.every(t=>t.stopped)','local check releases microphone');
 checks.push('local microphone check measures actual samples without network voice session and releases resources');

 await navigate('/voice?subjectId='+person);await consent('.wa-voice-card input[type=checkbox]');await consent('.voice-setup input[type=checkbox]');await click('开始通话');await until('window.__voice.sockets.length===1','second voice session');
 await evaluate("__packet({type:'session.updated'});__packet({type:'gateway.session_meta',expiresAt:Date.now()+170000,maxDurationSeconds:180});__packet({type:'response.audio.delta',delta:btoa('\\0'.repeat(1600))})");
 await evaluate("__packet({type:'gateway.notice',code:'TRANSCRIPTION_FAILED',message:'这句话没能识别清楚，请再说一次。'})");
 await until("document.body.innerText.includes('这句话没能识别清楚')",'recognition failure is actionable without ending the call');
 assert.equal(await evaluate('window.__voice.sockets[0].readyState'),1);
 await click('打断，我来说');assert.equal(await evaluate('window.__voice.sources[0].stopped'),true);
 assert.equal(await evaluate("window.__voice.sockets[0].sent.filter(p=>p.type==='gateway.interrupt').length"),1);
 await evaluate("__packet({type:'gateway.interrupted'});__packet({type:'response.audio_transcript.delta',delta:'这条旧回答不应再出现'})");
 assert.equal(await evaluate("document.body.innerText.includes('这条旧回答不应再出现')"),false);
 await evaluate("__packet({type:'gateway.user_turn',transcript:'我们周末见面应该怎么准备？'});__packet({type:'conversation.item.input_audio_transcription.completed',transcript:'我们周末见面应该怎么准备？'});__packet({type:'response.audio_transcript.delta',delta:'可以先确认时间地点，给彼此轻松了解的空间。'});__packet({type:'response.done',response:{status:'completed'}})");
 await until('document.querySelectorAll(".voice-transcript-list article").length===2','full turn retained without duplicated input event');
 await evaluate("__packet({type:'gateway.session_end',reason:'time_limit'})");await until("document.body.innerText.includes('本次通话时间已到')",'normal time limit');
 assert.equal(await evaluate('!!document.querySelector(".wa-error")'),false);
 assert.ok(await evaluate('window.__voice.tracks.every(t=>t.stopped)&&window.__voice.contexts.every(c=>c.state==="closed")'));
 await evaluate(`(()=>{const select=document.querySelector('.voice-setup select');select.value='${personB}';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await until(`document.querySelector('.voice-setup select')?.value==='${personB}'`,'next-call person can change after ending');
 assert.equal(await evaluate('document.querySelectorAll(".voice-transcript-list article").length'),2,'changing next-call person must preserve the previous transcript');
 await click('带着这些继续聊');await until('location.pathname==="/chat"','voice context handoff');
 await until("document.body.innerText.includes('本次语音对话')",'voice context label');
 const context=await evaluate("JSON.parse(sessionStorage.getItem('web-followup:'+new URLSearchParams(location.search).get('context')))");
 assert.equal(context.accountId,owner);assert.ok(context.summary.includes('我们周末见面应该怎么准备'));assert.ok(context.summary.includes('先确认时间地点'));
 assert.equal(context.subjectId,person,'handoff retains the original call person after the next-call selection changes');
 assert.equal(await evaluate("document.querySelector('.wa-chat-settings select')?.value"),person,'text followup must use the transcript person');
 checks.push('immediate interrupt, stale speech suppression, real countdown, full current transcript, normal ending and person-bound text handoff after switching next-call person');

 prices={};await navigate('/chat');await consent();
 assert.equal(await evaluate("Array.from(document.querySelectorAll('.wa-composer button')).find(n=>n.textContent.includes('发送 ·')).disabled"),true);
 assert.equal(await evaluate("Array.from(document.querySelectorAll('.wa-composer button')).find(n=>n.textContent.includes('语音输入')).disabled"),true);
 await navigate('/voice');await consent('.wa-voice-card input[type=checkbox]');await click('开始通话');await until("document.body.innerText.includes('语音价格')",'missing voice price blocked');
 assert.equal(await evaluate('window.__voice.tracks.length'),0);assert.equal(await evaluate('window.__voice.sockets.length'),0);
 prices={text:5,transcription:5,voice:20};checks.push('missing individual prices block new text/transcription actions and voice before acquiring microphone');

 for(const width of [1280,390]){await send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:width===390});for(const path of ['/chat','/voice']){await navigate(path);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`${output}/${path.slice(1)}-${width}.png`,Buffer.from(shot.data,'base64'));}}
 checks.push('desktop/mobile chat and voice pages have no horizontal overflow');
 assert.deepEqual(exceptions,[]);await writeFile(output+'/qa.json',JSON.stringify({passed:true,synthetic:true,checks,exceptions},null,2));console.log('PASS '+checks.length+' conversation browser regression groups (synthetic model/audio only).');
}catch(error){await writeFile(output+'/qa.json',JSON.stringify({passed:false,synthetic:true,checks,exceptions,error:String(error.stack)},null,2));throw error;}
finally{if(socket?.readyState===1){try{await call('Browser.close');}catch{}socket.close();}edge.kill();for(const p of pending.values())clearTimeout(p.timer);}
