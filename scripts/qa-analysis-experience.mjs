// Isolated browser, synthetic model responses only. No production account or paid call.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base = 'http://127.0.0.1:5191', browserProfile = await mkdtemp(join(tmpdir(),'chengzi-analysis-experience-qa-'));
await mkdir('outputs/analysis-experience',{recursive:true});
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+browserProfile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const accountId='22222222-2222-4222-8222-222222222222', personId='11111111-1111-4111-8111-111111111111';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const prices={text:5,analysisSmall:20,analysisMedium:35,analysisLarge:50,profile:30,transcription:5,voice:20};
const account={userId:accountId,balance:500,reserved:0,spent:0,features:['analysis','chat','voice'],active:true,enabledUntil:Date.now()+86400000,entries:[],signupCredits:0};
const person={id:personId,label:'合成小林',updatedAt:Date.now()};
const archive={enabled:true,paused:false,self:{city:'杭州'},subjects:[person],facts:[],signals:[],trends:[]};
const report=n=>({id:`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`,subjectId:personId,lines:[{id:'line-'+n,speaker:'other',text:`这是第${n}张合成原话`}],annotations:[],decision:{judgment:'合成判断'+n,possibleIntent:'这次有明确邀约',evidence:'周六喝咖啡',nextStep:'确认具体时间',photoClues:[{location:'聊天照片',speaker:'other',observation:'第'+n+'张照片可见咖啡杯',inference:'可能喜欢咖啡',alternative:'也可能只是转发',verify:'问问是哪家店'}],replyOptions:[{style:'自然',text:'好呀，周六下午怎么样？',reason:'承接明确邀约',cost:'需要你有空',weight:80}]}});
const socialReport={kind:'profile',summary:'合成资料总评',coverage:'合成两张截图',note:'线索需要核对',visibleFacts:[{title:'兴趣',evidence:'简介提到阅读',meaning:'可以聊书'}],positives:[{title:'共同话题',evidence:'书架',meaning:'阅读'}],cautions:[],hypotheses:[{title:'交流节奏',possibility:'可能偏好慢慢了解',evidence:'简介说明',alternative:'也可能最近忙',verify:'观察回复安排'}],approach:{attitude:'平等了解',emotion:'自然承接',pace:'按实际回应',avoid:'连续追问',evidence:'简介',adjustWhen:'对方表达边界'},photoClues:[{category:'环境',item:'资料里的书架',style:'整洁',evidence:'主页照片',valueHint:'不据此猜经济状况'}],profileBasics:[{field:'city',value:'合成杭州',evidence:'简介城市'}],profileContext:[{field:'stage',value:'认识初期',evidence:'相识描述'}],knowledgeSources:[{anchor:'fixture-source',label:'合成沟通方法'}],riskSignals:[{category:'时间安排',level:'低',evidence:'自述',check:'确认具体安排'}],fit:[{dimension:'生活方式',status:'待了解',selfNeed:'一起阅读',reading:'喜欢阅读',evidence:'简介',conclusion:'继续了解'}],fitCoverage:1,fitScore:null,fitSummary:'资料尚待补充',commonPoints:[{title:'阅读',meaning:'可以交流书单',evidence:'双方介绍'}],questions:['喜欢哪类书？'],unknowns:['周末安排'],nextMaterials:['补充完整简介']};
const results=[],exceptions=[],requests=[],jobs=new Map();let socket,serial=0,sid,scenario='batch',failPart=true,failText=true;
const pending=new Map();
function call(method,params={},session){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});}
const send=(method,params={})=>call(method,params,sid);
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.result.description||result.exceptionDetails.text);return result.result.value;}
async function until(expression,label){for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+label+'\n'+await evaluate('document.body.innerText'));}
async function navigate(path){await send('Page.navigate',{url:base+path});await until('document.readyState==="complete"&&location.pathname==='+JSON.stringify(path.split('?')[0]),path);await until('document.body.innerText.includes("500")','account loaded');await delay(150);}
async function click(label){await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent.includes(${JSON.stringify(label)}));if(!button)throw Error('missing button '+${JSON.stringify(label)});if(button.disabled)throw Error('button disabled '+${JSON.stringify(label)});button.click();})()`);}
async function textInput(selector,value){await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function consent(label){await evaluate(`(()=>{const node=[...document.querySelectorAll('label')].find(node=>node.textContent.includes(${JSON.stringify(label)}))?.querySelector('input[type=checkbox]');if(!node)throw Error('consent missing');if(!node.checked)node.click();})()`);}
async function chooseFiles(count){await evaluate(`(()=>{const raw=atob(${JSON.stringify(png)}),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),transfer=new DataTransfer();for(let i=0;i<${count};i++)transfer.items.add(new File([bytes],'synthetic-'+i+'.png',{type:'image/png'}));const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until('document.querySelectorAll(".wa-image").length==='+count,'files');}
async function side(){await evaluate(`(()=>{const node=[...document.querySelectorAll('select')].find(n=>[...n.options].some(o=>o.value==='right'));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(node,'right');node.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function idbTask(){return evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('chengzi-web-uploads',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('tasks').objectStore('tasks').get('${accountId}');q.onsuccess=()=>{db.close();resolve(q.result?{id:q.result.taskId,count:q.result.files.length}:null)};q.onerror=reject;};r.onerror=reject;})`);}
async function response(event){const url=new URL(event.request.url),path=url.pathname,body=event.request.postData?JSON.parse(event.request.postData):{};requests.push({path,method:event.request.method,body,headers:event.request.headers,scenario});let data,status=200;
 if(path==='/api/account/credits')data={account,prices:scenario==='missingPrice'?{...prices,profile:undefined}:prices,user:{name:'合成账号'}};
 else if(path==='/api/auth/session')data={loggedIn:true,user:{id:'fixture',name:'合成账号'}};
 else if(path==='/api/web/profile'){if(event.request.method==='POST'&&body.action==='create-manual'){const created={id:body.id,label:body.label};archive.subjects.push(created);data={...archive,createdSubjectId:body.id};}else data=archive;}
 else if(path==='/api/web/settings')data={ok:true};
 else if(path==='/api/web/screenshot/batch'||path==='/api/web/social-profile'){
  const taskId=body.taskId||url.searchParams.get('taskId');let job=jobs.get(taskId);
  if(event.request.method==='POST'){
   assert.equal(event.request.headers['X-Request-Id']||event.request.headers['x-request-id'],taskId,'request identity header');
   if(body.uploadAction==='init') {if(!job){job={id:taskId,received:[],count:body.imageCount,status:'uploading',polls:0,kind:path.endsWith('/social-profile')?'profile':'chat',totalCount:(body.previousCount||0)+body.imageCount};jobs.set(taskId,job);}data={taskId,status:job.status,imageCount:job.count,received:job.received};}
   else if(body.uploadAction==='part'){assert.ok(job,'existing job');if(scenario==='partialUpload'&&body.index===1&&failPart){failPart=false;return send('Fetch.failRequest',{requestId:event.requestId,errorReason:'InternetDisconnected'});}assert.ok(/^data:image\/(?:png|jpeg);base64,/.test(body.image));if(!job.received.includes(body.index))job.received.push(body.index);data={taskId,status:'uploading',received:job.received,imageCount:job.count};}
   else if(body.uploadAction==='commit'){assert.equal(job.received.length,job.count);job.status='running';data={taskId,status:'running'};}
   else throw Error('unexpected upload action '+body.uploadAction);
  }else{assert.ok(job,'GET known job');job.polls++;if(job.status==='done'||job.polls>1){job.status='done';data={taskId,status:'done',imageCount:job.count,totalCount:job.totalCount||job.count,result:job.kind==='profile'?socialReport:{entries:Array.from({length:job.count},(_,i)=>report(i+1))}};}else data={taskId,status:'running',imageCount:job.count,completedCount:1,partialResult:{entries:[report(1)]}};}
 }else if(path==='/api/web/text'){if(failText){failText=false;return send('Fetch.failRequest',{requestId:event.requestId,errorReason:'InternetDisconnected'});}data={mode:'conversation',possibleIntent:'合成回答：可以先确认安排',evidence:'想确认周末的时间',nextStep:'问一个具体的问题',replies:[]};}
 else if(path==='/api/web/voice-live/status')data={configured:true};
 else if(path==='/api/web/report')data={report:report(2)};
 else throw Error('Unmocked API: '+path+' (blocked to prevent spending)');
 await send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,responseHeaders:[{name:'content-type',value:'application/json'},{name:'cache-control',value:'no-store'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
}
try{
 let info;for(let i=0;i<70;i++){try{info=(await readFile(join(browserProfile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break;}catch{await delay(100);}}if(!info)throw Error('Edge failed');
 socket=new WebSocket('ws://127.0.0.1:'+info[0]+info[1]);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.method==='Fetch.requestPaused')void response(data.params).catch(async error=>{exceptions.push(String(error));try{await send('Fetch.failRequest',{requestId:data.params.requestId,errorReason:'Aborted'});}catch{}});if(data.method==='Runtime.exceptionThrown')exceptions.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);const promise=pending.get(data.id);if(promise){clearTimeout(promise.timer);pending.delete(data.id);data.error?promise.reject(Error(data.error.message)):promise.resolve(data.result);}});
 const target=await call('Target.createTarget',{url:'about:blank'});sid=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:base+'/api/*',requestStage:'Request'}]});await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});

 await navigate('/analyze?mode=chat');
 assert.equal(await evaluate("document.querySelector('.ax-steps [aria-current=step] strong').textContent.includes('添加材料')"),true);
 assert.equal(await evaluate("document.querySelector('.ax-options').open"),false);
 await evaluate("window.__picker=0;document.querySelector('input[type=file]').click=()=>window.__picker++;document.querySelector('.ax-dropzone').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));document.querySelector('.ax-dropzone').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));");
 assert.equal(await evaluate("window.__picker"),2);
 results.push({check:'keyboard upload invokes picker and initial optional settings are collapsed',passed:true});

 const imageTransfer="const raw=atob("+JSON.stringify(png)+"),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),transfer=new DataTransfer();transfer.items.add(new File([bytes],'experience.png',{type:'image/png'}));";
 await evaluate("(()=>{"+imageTransfer+"document.querySelector('.ax-dropzone').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));})()");
 await until('document.querySelectorAll(".wa-image").length===1','drop screenshot');
 await evaluate("(()=>{"+imageTransfer+"document.body.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));})()");
 await until('document.querySelectorAll(".wa-image").length===2','paste screenshot');
 assert.equal(await evaluate("document.querySelector('.ax-steps [aria-current=step] strong').textContent.includes('确认分析')"),true);
 await evaluate("(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['invalid'],'wrong.gif',{type:'image/gif'}));document.querySelector('.ax-dropzone').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));})()");
 await until('document.body.innerText.includes("有效 JPG 或 PNG")','shared validation error');
 assert.equal(await evaluate('document.querySelectorAll(".wa-image").length'),2);
 await evaluate("(()=>{"+imageTransfer+"for(let n=0;n<7;n++)transfer.items.add(new File([bytes],'extra-'+n+'.png',{type:'image/png'}));document.querySelector('.ax-dropzone').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));})()");
 await until('document.body.innerText.includes("每组最多 9 张，还能添加 7 张")','shared count limit');
 assert.equal(await evaluate('document.querySelectorAll(".wa-image").length'),2);
 await evaluate("new Promise(resolve=>{const canvas=document.createElement('canvas');canvas.width=5000;canvas.height=4000;const context=canvas.getContext('2d');context.fillStyle='#bad8e0';context.fillRect(0,0,5000,4000);canvas.toBlob(blob=>{const transfer=new DataTransfer();transfer.items.add(new File([blob],'large-experience.png',{type:'image/png'}));document.querySelector('.ax-dropzone').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));canvas.width=canvas.height=1;resolve(true)},'image/png')})");
 await until('document.querySelectorAll(".wa-image").length===3','large screenshot accepted for chat');
 await evaluate("(()=>{"+imageTransfer+"document.body.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));})()");await until('document.querySelectorAll(".wa-image").length===4','additional pasted screenshot');
 assert.equal(await evaluate("document.querySelector('.ax-order-summary').textContent.includes('35 积分')"),true);
 await click('朋友圈');await until('document.querySelector(".ax-modes [aria-selected=true]").textContent.includes("朋友圈")','switch material kind');
 assert.equal(await evaluate('document.querySelectorAll(".wa-image").length'),4);
 assert.equal(await evaluate('Array.from(document.querySelectorAll(".wa-image small")).some(node=>node.textContent.includes("已优化.jpg"))'),true,'changing to social optimizes previously chosen image');
 await click('聊天截图');await until('document.querySelector(".ax-modes [aria-selected=true]").textContent.includes("聊天截图")','return to chat');
 results.push({check:'drop/paste share count/format validation and fee updates; changing material kind retains images and runs social optimization',passed:true});
 await click('开始分析');
 await until('document.body.innerText.includes("请确认截图里哪侧气泡是你")','identity guard');
 assert.equal(requests.filter(r=>r.path.endsWith('/screenshot/batch')).length,0);
 await side();await click('开始分析');
 await until('document.body.innerText.includes("请确认材料提供权")','processing consent guard');
 assert.equal(requests.filter(r=>r.path.endsWith('/screenshot/batch')).length,0);
 await consent('我有权提供这些材料');
 for(const width of [320,390,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'no horizontal overflow '+width);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,fromSurface:true});
  await writeFile('outputs/analysis-experience/materials-'+width+'.png',Buffer.from(shot.data,'base64'));
 }
 await click('开始分析');
 await until('document.querySelector(".ax-steps [aria-current=step] strong").textContent.includes("获得建议")','running step');
 await until('document.body.innerText.includes("合成判断4")','four-image result');
 assert.equal(await idbTask(),null);
 assert.equal(await evaluate('document.querySelector(".ax-workspace")===null'),true,'result reading removes completed form');
 assert.equal(await evaluate('document.querySelectorAll(".ax-result-links a").length>=2'),true);
 assert.equal(await evaluate('document.querySelector(".ax-result-heading").textContent.includes("本次分析已完成")'),true);
 await click('开始新分析');
 await until('document.querySelector(".ax-workspace")!==null','new analysis resets view');
 assert.equal(await evaluate('document.querySelectorAll(".wa-image").length'),0);
 results.push({check:'identity/consent required, no payment before confirmation, real step progression and result/new-analysis navigation',passed:true});

 scenario='partialUpload';await chooseFiles(2);await side();await consent('我有权提供这些材料');await click('开始分析');await until('document.body.innerText.includes("连接中断")','upload interrupted');const partial=await idbTask();assert.equal(partial.count,2);
 await navigate('/analyze?mode=chat');await until('document.body.innerText.includes("发现上次未完成的任务")','pending restored');await click('继续查看');await until('document.body.innerText.includes("合成判断2")','resumed result');
 const replay=requests.filter(r=>r.scenario==='partialUpload'&&r.path.endsWith('/screenshot/batch')&&r.method==='POST');
 assert.equal(replay.filter(r=>r.body.uploadAction==='part'&&r.body.index===0).length,1);
 assert.ok(replay.every(r=>r.body.taskId===partial.id));assert.equal(await idbTask(),null);
 results.push({check:'interrupted upload still resumes saved task without resending accepted image or changing paid task identity',passed:true});

 scenario='social';await navigate('/analyze?mode=social');await chooseFiles(1);
 await evaluate("(()=>{const select=[...document.querySelectorAll('select')].find(n=>[...n.options].some(o=>o.value==='self'));select.value='self';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
 assert.equal(await evaluate('document.querySelectorAll(".wa-image").length'),1,'changing material owner retains screenshots');
 await evaluate("(()=>{const select=[...document.querySelectorAll('select')].find(n=>[...n.options].some(o=>o.value==='self'));select.value='other';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
 await evaluate("(()=>{const select=document.querySelector('.ax-options select');select.value="+JSON.stringify(personId)+";select.dispatchEvent(new Event('change',{bubbles:true}));})()");
 assert.equal(await evaluate('document.querySelectorAll(".wa-image").length'),1,'linking person retains screenshots');
 await evaluate("document.querySelector('.ax-link-option').open=true");
 await evaluate("(()=>{"+imageTransfer+"document.querySelector('input[type=url]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));})()");
 assert.equal(await evaluate('document.querySelectorAll(".wa-image").length'),1,'pasting while typing URL does not upload');
 await consent('我有权提供这些材料');await click('开始分析');await until('document.body.innerText.includes("合成资料总评")','social result');
 await click('继续补图');await chooseFiles(1);await consent('我有权提供这些材料');await click('开始分析');await until('document.body.innerText.includes("合成资料总评")','social continuation');
 const continuation=requests.filter(r=>r.scenario==='social'&&r.body.uploadAction==='init').at(-1).body;
 assert.equal(continuation.previousCount,1);assert.equal(continuation.previous.riskSignals[0].category,'时间安排');assert.equal(continuation.subjectId,personId);
 results.push({check:'social settings keep selected material, URL editing is not intercepted, continuation preserves person and earlier structured evidence',passed:true});

 scenario='missingPrice';await navigate('/analyze?mode=social');await chooseFiles(1);await consent('我有权提供这些材料');
 assert.equal(await evaluate("document.querySelector('.ax-submit').disabled"),true);
 assert.equal(requests.filter(r=>r.scenario==='missingPrice'&&r.path==='/api/web/social-profile').length,0);
 results.push({check:'missing current price blocks paid analysis while keeping material',passed:true});
 assert.deepEqual(exceptions,[]);
 await writeFile('outputs/analysis-experience/qa.json',JSON.stringify({local:true,synthetic:true,paidCalls:0,results,exceptions},null,2));
 console.log('PASS: '+results.length+' analysis experience checks; keyboard/drop/paste, consent, result flow, resumability, social continuation, responsive widths. No paid calls.');
}catch(error){
 await writeFile('outputs/analysis-experience/failure.json',JSON.stringify({error:String(error),results,exceptions,requests:requests.map(({headers,...rest})=>rest)},null,2));throw error;
}finally{
 if(socket?.readyState===1){try{await call('Browser.close');}catch{}socket.close();}
 edge.kill();for(const promise of pending.values())clearTimeout(promise.timer);
}
