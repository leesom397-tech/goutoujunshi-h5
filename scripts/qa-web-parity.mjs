// Fresh headless browser. Native auth/profile use an isolated LOCAL DB;
// model results and admin UI are synthetic fixtures, never production accounts.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base='http://127.0.0.1:5191';
const profile=await mkdtemp(join(tmpdir(),'chengzi-web-qa-'));
await mkdir('outputs/web-parity',{recursive:true});
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let socket,serial=0,sessionId,mock=false;
const pending=new Map(),exceptions=[],results=[],writes=[];
const personId='11111111-1111-4111-8111-111111111111',accountId='22222222-2222-4222-8222-222222222222',reportId='33333333-3333-4333-8333-333333333333';
const account={userId:accountId,balance:100,reserved:0,spent:0,features:['analysis','chat','voice'],active:true,enabledUntil:Date.now()+86400000,entries:[],signupCredits:0};
const prices={text:5,analysisSmall:20,analysisMedium:35,analysisLarge:50,profile:30,transcription:5,voice:20};
const subject={id:personId,label:'合成人物小林',updatedAt:Date.now(),city:'杭州',stage:'正在了解',values:'真诚沟通',compatibility:{fit:[],fitScore:null,fitSummary:'资料待补充',coverage:0,total:6,commonPoints:[]}};
const archive={enabled:true,paused:false,self:{city:'杭州',values:'真诚沟通'},subjects:[subject],facts:[],signals:[],trends:[]};
const report={id:reportId,subjectId:personId,status:'done',lines:[{id:'1',speaker:'other',text:'周六一起喝咖啡吗？'},{id:'2',speaker:'self',text:'好呀，下午三点怎么样？'}],annotations:[{lineId:'1',note:'对方提出具体邀约。',emotion:[{key:'happy',label:'友好',weight:.8}],intent:[{key:'invite',label:'邀约',weight:.9}]}],decision:{judgment:'有明确的邀约信号',evidence:'周六一起喝咖啡',nextStep:'确认时间和地点',replies:[{text:'可以呀，下午三点见。',reason:'回应具体安排'}]},replies:[{text:'可以呀，下午三点见。',reason:'回应具体安排'}]};
function call(method,params={},sid){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});}
const send=(method,params)=>call(method,params,sessionId);
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+r.result.description);return r.result.value;};
async function until(expression,label){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+label);}
async function navigate(path){await send('Page.navigate',{url:base+path});await until('document.readyState==="complete" && location.pathname==='+JSON.stringify(path.split('?')[0]),path);await delay(450);}
async function input(selector,value){await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('input missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function clickText(label){await evaluate(`(()=>{const n=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(label)}));if(!n)throw Error('button missing');n.click();})()`);}
async function respond(event){const path=new URL(event.request.url).pathname;let data,status=200;const body=event.request.postData?JSON.parse(event.request.postData):{};
 if(path==='/api/auth/session')data={loggedIn:true,user:{id:'fixture-owner',name:'合成测试账号'}};
 else if(path==='/api/account/credits')data={account,prices,user:{name:'合成测试管理员'},admin:true};
 else if(path==='/api/account/admin/credits'){if(event.request.method==='POST'){writes.push(body);if(body.action==='adjust')account.balance+=body.delta;else{account.features=body.features;account.enabledUntil=body.enabledUntil;}}data={account,ok:true};}
 else if(path==='/api/web/profile')data=archive;
 else if(path==='/api/web/session')data={linked:true,subjects:archive.subjects,screenshot:{enabled:true,selfSide:'right'}};
 else if(path==='/api/web/relationship-feedback')data={subjectId:personId,cards:[],events:[]};
 else if(path==='/api/web/report')data={report};
 else if(path==='/api/web/text'){writes.push(body);data={text:'这次有具体邀约，可以确认时间地点。',knowledgeSources:[]};}
 else if(path==='/api/web/voice-live/status')data={remaining:30,configured:true};
 else if(path==='/api/web/settings')data={ok:true};
 else return send('Fetch.continueRequest',{requestId:event.requestId});
 await send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,responseHeaders:[{name:'content-type',value:'application/json'},{name:'cache-control',value:'no-store'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
}
try{
 let info;for(let i=0;i<60;i++){try{info=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break;}catch{await delay(100);}}
 if(!info)throw Error('browser failed');socket=new WebSocket('ws://127.0.0.1:'+info[0]+info[1]);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Fetch.requestPaused')void respond(m.params).catch(e=>exceptions.push(String(e)));if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Page.javascriptDialogOpening')void send('Page.handleJavaScriptDialog',{accept:true});const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const target=await call('Target.createTarget',{url:'about:blank'});sessionId=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 if(!process.argv.includes('--skip-native')){
 await navigate('/register');
 const username='QaWeb'+Date.now();
 await input('input[autocomplete=username]',username);await input('input[autocomplete=new-password]','SyntheticLocalPassword42');
 await input('input[autocomplete=new-password]:last-of-type','SyntheticLocalPassword42');
 // The confirmation input belongs to another label, use DOM index explicitly.
 await evaluate(`(()=>{const n=[...document.querySelectorAll('input[type=password]')][1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'SyntheticLocalPassword42');n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('input[type=checkbox]').click();})()`);
 await clickText('创建账户');await until('location.pathname==="/account" && document.body?.innerText.includes("等待开通")','native register/account');
 const native=await evaluate('fetch("/api/auth/session").then(r=>r.json())');assert.equal(native.loggedIn,true);assert.equal(native.user.name,username);assert.ok(native.user.id.startsWith('chengzi:'));
 const wallet=await evaluate('fetch("/api/account/credits").then(r=>r.json())');assert.equal(wallet.account.balance,0);assert.equal(wallet.account.features.length,0);assert.equal(wallet.admin,false);
 assert.equal(await evaluate('document.cookie.includes("cz_session")'),false,'session HttpOnly');
 const forbidden=await evaluate('fetch("/api/account/admin/credits?userId=22222222-2222-4222-8222-222222222222").then(r=>r.status)');assert.equal(forbidden,403);
 const localPerson=await evaluate(`(async()=>{await fetch('/api/web/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'consent',enabled:true})});const id=crypto.randomUUID();const r=await fetch('/api/web/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create-manual',id,label:'本地合成人物',data:{city:'杭州'},confirmed:true})});return {status:r.status,data:await r.json()};})()`);assert.equal(localPerson.status,200);
 await navigate('/archive');await until('document.body?.innerText.includes("本地合成人物")','actual native profile');
 results.push({check:'native registration, HttpOnly session, zero grant, admin denial, actual owner profile',passed:true});
 await send('Page.navigate',{url:base+'/logout'});await delay(500);await until('location.pathname!=="/logout"','logout');assert.equal((await evaluate('fetch("/api/auth/session").then(r=>r.json())')).loggedIn,false);
 await navigate('/login');await input('input[autocomplete=username]',username);await input('input[type=password]','SyntheticLocalPassword42');await clickText('登录并继续');await until('location.pathname==="/workspace"','native login');results.push({check:'logout revocation and native password login',passed:true});
 }
 mock=true;await send('Fetch.enable',{patterns:[{urlPattern:base+'/api/*',requestStage:'Request'}]});
 for(const width of [390,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:width===390});
  for(const path of ['/workspace','/analyze?mode=chat','/analyze?mode=moments','/analyze?mode=social','/chat','/voice','/archive','/archive?tab=self','/archive?subjectId='+personId,'/person-new','/account','/admin/credits','/report?id='+reportId,'/sales','/privacy','/library','/history','/import','/positioning','/profile','/quick','/crush','/wechat','/miniapp/manage','/login','/register']){
   await navigate(path);await delay(200);
   const metric=await evaluate('({width:innerWidth,content:document.documentElement.scrollWidth,h1:document.querySelector("h1")?.textContent,text:document.body.innerText})');
   assert.ok(metric.h1,'heading '+path);assert.ok(metric.content<=width+1,'overflow '+width+' '+path+' '+metric.content);assert.ok(!/lovetalk/i.test(metric.text),'old brand '+path);
   assert.equal(await evaluate('[...document.images].filter(x=>!x.complete||!x.naturalWidth).length'),0,'image load '+path);
   const file=path.split('?')[0].slice(1).replaceAll('/','-')+(path.includes('tab=self')?'-self':path.includes('subjectId=')?'-person':path.includes('mode=moments')?'-moments':path.includes('mode=social')?'-social':'');
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`outputs/web-parity/${file}-${width}.png`,Buffer.from(shot.data,'base64'));
   results.push({route:path,width,passed:true});
  }
 }
 await navigate('/workspace');
 await evaluate('(()=>{const n=document.querySelector(".workspace-hero");const b=n.getBoundingClientRect();n.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerType:"mouse",clientX:b.left+100,clientY:b.top+100}));})()');
 assert.ok(await evaluate('document.querySelector(".workspace-hero").style.getPropertyValue("--mx")'),'pointer light position');
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".workspace-art")).animationName'),'none');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".workspace-entry")).animationName'),'none');
 await send('Emulation.setEmulatedMedia',{features:[]});results.push({check:'real images loaded, pointer spotlight and reduced-motion preference',passed:true});
 await navigate('/admin/credits');await input('.admin-card input',accountId);await clickText('查询账户');await until('document.body?.innerText.includes("1. 调整积分")','admin target');await input('input[placeholder="例如：已核对订单后的人工开通"]','合成订单');await input('input[type=number]','20');await clickText('确认积分调整');await until('document.body?.innerText.includes("积分调整已保存")','admin credit');await clickText('确认功能权限');await until('document.body?.innerText.includes("功能与有效期已保存")','admin permissions');
 assert.equal(writes.filter(x=>x.action==='adjust').length,1);assert.equal(writes.filter(x=>x.action==='permissions').length,1);assert.notEqual(writes[0].id,writes[1].id);results.push({check:'admin lookup then independent credit and permission mutations',passed:true});
 assert.deepEqual(exceptions,[],'uncaught browser exceptions');
 await writeFile('outputs/web-parity/qa.json',JSON.stringify({local:true,synthetic:true,results,exceptions},null,2));console.log('PASS: native local auth/profile + '+results.length+' mobile/desktop route and admin checks; no overflow, no old brand, no uncaught exceptions.');
}finally{if(socket?.readyState===1){try{await call('Browser.close');}catch{}socket.close();}edge.kill();for(const p of pending.values())clearTimeout(p.timer);}



