// Isolated browser, synthetic model responses only. No production account or paid call.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base = 'http://127.0.0.1:5191', browserProfile = await mkdtemp(join(tmpdir(),'chengzi-chart-tools-qa-'));
await mkdir('outputs/chart-tools',{recursive:true});
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
async function navigate(path){await send('Page.navigate',{url:base+path});await until('document.readyState==="complete"&&location.pathname==='+JSON.stringify(path.split('?')[0]),path);await delay(150);}
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
 else if(path==='/api/web/report')data={report:{...report(2),affinity:{value:60,valueScope:'partial',dimensions:chartDimensions}}};
 else if(path==='/api/web/relationship-feedback')data={subjectId:personId,cards:[],events:[]};
 else throw Error('Unmocked API: '+path+' (blocked to prevent spending)');
 await send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,responseHeaders:[{name:'content-type',value:'application/json'},{name:'cache-control',value:'no-store'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
}

const chartLabels=['主动表达','回应承接','回应扩展','邀约兑现','边界尊重','互惠稳定'];
let chartDimensions=chartLabels.map((label,index)=>({label,value:[80,null,60,null,0,45][index],evidence:'合成依据-'+index}));
archive.signals=[{subjectId:personId,reportId:'chart-6',score:0,updatedAt:Date.now(),summary:'合成最新互动',dimensions:chartDimensions}];
archive.trends=[{subjectId:personId,points:[20,40,null,70,80,0].map((score,index)=>({
 reportId:'chart-'+(index+1),subjectId:personId,score,eventStart:'2026-10-0'+(index+1),eventEnd:'2026-10-0'+(index+1),axisLabel:'10/0'+(index+1),dateLabel:'2026-10-0'+(index+1),
 connectPrevious:[false,true,true,true,false,true][index],previousReportId:index?'chart-'+index:'',summary:'合成记录摘要-'+(index+1),sourceReportIds:['chart-'+(index+1)],eventDays:[],eventDayCount:1,undatedMessageCount:0,recordedDateLabel:'2026/10/09'
})).concat([{reportId:'chart-undated',subjectId:personId,score:99,eventStart:'',eventEnd:'',axisLabel:'待定',summary:'无日期不入图',sourceReportIds:['chart-undated'],eventDays:[],eventDayCount:0,undatedMessageCount:1,recordedDateLabel:'2026/10/09'}])}];

try{
 let info;for(let i=0;i<70;i++){try{info=(await readFile(join(browserProfile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break;}catch{await delay(100);}}if(!info)throw Error('Edge failed');
 socket=new WebSocket('ws://127.0.0.1:'+info[0]+info[1]);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.method==='Fetch.requestPaused')void response(data.params).catch(async error=>{exceptions.push(String(error));try{await send('Fetch.failRequest',{requestId:data.params.requestId,errorReason:'Aborted'});}catch{}});if(data.method==='Runtime.exceptionThrown')exceptions.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);const promise=pending.get(data.id);if(promise){clearTimeout(promise.timer);pending.delete(data.id);data.error?promise.reject(Error(data.error.message)):promise.resolve(data.result);}});
 const target=await call('Target.createTarget',{url:'about:blank'});sid=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:base+'/api/*',requestStage:'Request'}]});await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});


 await navigate('/archive?subjectId='+personId+'&section=trend');
 await until('!!document.querySelector(".cz-trend-tool")&&!!document.querySelector(".cz-radar-tool")','interactive chart mount');
 assert.equal(await evaluate('document.querySelectorAll(".cz-trend-node").length'),6,'undated not plotted');
 assert.equal(await evaluate('document.querySelectorAll(".cz-trend-chart .cz-chart-dot").length'),5,'unknown score has no numeric dot');
 assert.equal(await evaluate('document.querySelectorAll(".cz-trend-line").length'),2,'only valid consecutive comparable pairs connected');
 assert.equal(await evaluate('document.querySelector(".cz-trend-detail").textContent.includes("-80")'),true,'real zero value remains known and comparable');
 assert.equal(await evaluate('document.querySelectorAll(".cz-radar-chart .cz-chart-dot").length'),4,'zero is known and two missing dimensions absent');
 assert.equal(await evaluate('document.querySelectorAll(".cz-radar-area").length'),0,'missing dimension never closes radar polygon');
 await evaluate('document.querySelectorAll(".cz-dimension-button")[1].click()');
 await until('document.querySelector(".cz-radar-tool .cz-chart-detail").textContent.includes("材料待补充")','unknown dimension detail');
 assert.equal(await evaluate('document.querySelector(".cz-radar-tool .cz-chart-detail").textContent.includes("合成依据-1")'),true);
 await evaluate('document.querySelectorAll(".cz-dimension-button")[4].click()');
 await until('document.querySelector(".cz-radar-tool .cz-chart-detail").textContent.includes("0 / 100")','real zero dimension remains inspectable');
 await evaluate('document.querySelectorAll(".cz-trend-button")[2].click()');
 await until('document.querySelector(".cz-trend-detail").textContent.includes("合成记录摘要-3")','date record detail');
 assert.equal(await evaluate('document.querySelector(".cz-trend-change")===null'),true,'unknown score has no invented change');
 assert.equal(await evaluate('document.querySelector(".cz-trend-detail a").getAttribute("href")'),'/report?id=chart-3');
 await evaluate('document.querySelectorAll(".cz-trend-node")[1].focus()');
 await until('document.querySelector(".cz-trend-detail").textContent.includes("合成记录摘要-2")','keyboard focus selects chart record');
 assert.equal(await evaluate('document.querySelector(".cz-trend-change").textContent.includes("+20")'),true);
 results.push({check:'unknown/undated scores never become zero or points; only comparable actual adjacent pairs connect; real zero and delta retained',passed:true});
 results.push({check:'radar buttons, SVG keyboard focus and trend date controls expose actual evidence and report links',passed:true});
 assert.match(await evaluate("getComputedStyle(document.querySelector('.cz-trend-line')).animationName"),/cz-chart-draw/,'normal motion draws the real trend');
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 for(const width of [320,390,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'chart page no horizontal overflow '+width);
  await evaluate("document.querySelector('.cz-trend-tool').scrollIntoView({block:'start',behavior:'instant'})");
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  await writeFile('outputs/chart-tools/trend-'+width+'.png',Buffer.from(shot.data,'base64'));
 }
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.cz-trend-line')).animationName"),'none','reduced motion removes chart drawing animation');
 chartDimensions=chartLabels.map((label,index)=>({label,value:(index+1)*10,evidence:'合成完整依据-'+index}));
 archive.signals[0].dimensions=chartDimensions;
 await navigate('/archive?subjectId='+personId+'&section=trend');
 await until('!!document.querySelector(".cz-radar-area")','full known radar');
 assert.equal(await evaluate('document.querySelectorAll(".cz-radar-chart .cz-chart-dot").length'),6);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
 await evaluate("document.querySelector('.cz-radar-tool').scrollIntoView({block:'start',behavior:'instant'})");
 const radarShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
 await writeFile('outputs/chart-tools/radar-390.png',Buffer.from(radarShot.data,'base64'));
 results.push({check:'responsive chart controls at 320/390/1280; complete radar connects, drawing motion follows reduced motion preference',passed:true});
 chartDimensions[1].value=null;
 await navigate('/report?id=33333333-3333-4333-8333-000000000002');
 await until('!!document.querySelector("#signals .cz-radar-tool")','report uses same interactive radar');
 assert.equal(await evaluate('document.querySelectorAll("#signals .cz-radar-area").length'),0);
 assert.equal(await evaluate('document.querySelectorAll("#signals .cz-radar-chart .cz-chart-dot").length'),5);
 results.push({check:'chat report shares interactive radar while preserving partial dimension semantics',passed:true});
 assert.deepEqual(exceptions,[]);
 await writeFile('outputs/chart-tools/qa.json',JSON.stringify({local:true,synthetic:true,paidCalls:0,results,exceptions},null,2));
 console.log('PASS: '+results.length+' chart interaction and missing-data checks, zero paid calls.');
}catch(error){
 await writeFile('outputs/chart-tools/failure.json',JSON.stringify({error:String(error),results,exceptions},null,2));throw error;
}finally{
 if(socket?.readyState===1){try{await call('Browser.close');}catch{}socket.close();}
 edge.kill();for(const promise of pending.values())clearTimeout(promise.timer);
}
