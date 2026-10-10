// Browser interaction checks with synthetic, read-only API fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base='http://127.0.0.1:5191',out='outputs/product-upgrade';
await mkdir(out,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'chengzi-product-'));
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,serial=0,sid,loggedIn=true,name='林知夏',searchTerms=[];
const pending=new Map(),failures=[],results=[],requests=[];
const owner='88888888-8888-4888-8888-888888888888',person='11111111-1111-4111-8111-111111111111',report='33333333-3333-4333-8333-333333333333';
const people=[{id:person,label:'林可然',stage:'正在了解',updatedAt:Date.now()},{id:'22222222-2222-4222-8222-222222222222',label:'陈遇安',stage:'朋友',updatedAt:Date.now()-86400000}];
const account={userId:owner,balance:120,reserved:0,spent:25,active:true,features:['analysis','chat','voice'],enabledUntil:Date.now()+86400000,entries:[]};
const reports=[{id:report,subjectId:person,label:'林可然',summary:'主动提出见面，可以继续确认具体安排',createdAt:Date.now()-3600000,expiresAt:Date.now()+6*86400000},{id:'44444444-4444-4444-8444-444444444444',subjectId:people[1].id,label:'陈遇安',summary:'回应里有共同话题，关系节奏仍需要进一步了解',createdAt:Date.now()-86400000,expiresAt:Date.now()+5*86400000}];
const expiredReport='55555555-5555-4555-8555-555555555555';
// The API exposes three cards and the total from all archived advice, so the
// count must not be inferred from the two unreported cards visible here.
const followups=[
 {subjectId:person,label:people[0].label,reportId:report,action:'先确认双方方便的时间，再决定是否见面，不用急着替对方安排。',suggestedAt:Date.now()-3600000,outcome:null,outcomeLabel:'尚未反馈',recordedAt:null,sourceAvailable:true,reportAvailable:true},
 {subjectId:person,label:people[0].label,reportId:expiredReport,action:'上次留意的边界，后来有没有被认真对待？按你舒服的节奏记下来。',suggestedAt:Date.now()-9*86400000,outcome:null,outcomeLabel:'尚未反馈',recordedAt:null,sourceAvailable:true,reportAvailable:false},
 {subjectId:people[1].id,label:people[1].label,reportId:reports[1].id,action:'这次先停一下，留意自己的感受，再决定愿意继续聊到哪里。',suggestedAt:Date.now()-86400000,outcome:'uncomfortable',outcomeLabel:'这次相处让我不舒服',recordedAt:Date.now()-900000,sourceAvailable:true,reportAvailable:true},
];
const feedbackCards=followups.map(item=>{const latest=item.outcome?{id:'66666666-6666-4666-8666-666666666666',reportId:item.reportId,action:item.action,outcome:item.outcome,note:'我还没有决定下一步，先保留自己的感受。',eventDate:'',recordedAt:item.recordedAt,revisionOf:null,review:'不舒服的感受值得认真对待，可以先暂停推进。'}:null;return {...item,sourceSummary:'这是本人已保存的合成分析摘要。',sourceEventStart:'',sourceEventEnd:'',latest,revisions:latest?[latest]:[],revisionCount:latest?1:0};});
function call(method,params={},sessionId){const id=++serial;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
const send=(method,params={})=>call(method,params,sid);
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.result.description||r.exceptionDetails.text);return r.result.value;}
async function until(expression,label){for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(80);}throw Error('Timed out: '+label);}
async function input(selector,value){await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function go(path){await send('Page.navigate',{url:base+path});await until(`document.readyState==='complete' && location.pathname===${JSON.stringify(path.split('?')[0])}`,path);await delay(250);}
async function shot(file){const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`${out}/${file}.png`,Buffer.from(image.data,'base64'));}
async function checkFollowups(width){
 await until('document.querySelectorAll(".desk-followups article").length===3','followup cards');
 assert.equal(await evaluate('document.querySelector(".desk-hero-actions .desk-primary").getAttribute("href")'),`/report?id=${report}`,'resume uses the actual latest report');
 assert.match(await evaluate('document.querySelector(".desk-hero-actions .desk-primary").textContent'),/继续上次分析/);
 assert.match(await evaluate('document.querySelector(".desk-followups .desk-heading").textContent'),/5 条建议可记下进展/,'pending total is not just the visible card count');
 assert.equal(await evaluate(`(()=>{const n=document.querySelector('.desk-followups .desk-heading>span'),r=n?.getBoundingClientRect();return !!n&&getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden'&&r.width>0&&r.height>0;})()`),true,`pending total must remain visible at ${width}px`);
 const cards=await evaluate(`Array.from(document.querySelectorAll('.desk-followups article')).map(n=>({text:n.innerText,links:Array.from(n.querySelectorAll('a')).map(a=>({href:a.getAttribute('href'),label:a.textContent.trim()})),bounds:Array.from(n.querySelectorAll('header,p,.desk-followup-actions')).map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))}))`);
 cards.forEach((card,index)=>{
   const expected=followups[index];
   assert.ok(card.text.includes(expected.label)&&card.text.includes(expected.outcomeLabel)&&card.text.includes(expected.action));
   assert.equal(card.links.find(link=>link.label===expected.label)?.href,`/archive?subjectId=${expected.subjectId}`);
   assert.equal(card.links.find(link=>link.label===(expected.outcome?'更新进展':'记下进展'))?.href,`/archive?subjectId=${expected.subjectId}&followup=${expected.reportId}`,'record link binds both person and advice');
   assert.equal(card.links.find(link=>link.label==='带着进展聊聊')?.href,`/chat?subjectId=${expected.subjectId}&preset=followup`);
   const reportLinks=card.links.filter(link=>link.href.startsWith('/report?'));
   assert.deepEqual(reportLinks.map(link=>link.href),expected.reportAvailable?[`/report?id=${expected.reportId}`]:[],'unavailable report has no dead link');
   assert.ok(card.bounds.every(rect=>rect.left>=-1&&rect.right<=width+1),`followup card content overflows ${width}px`);
 });
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`followup overflow ${width}`);
 await evaluate('document.querySelector(".desk-followups").scrollIntoView({block:"start"})');await shot('workspace-followups-'+width);
 results.push(`followups ${width}px: real pending total, exact person/advice links, latest report resume and no expired-report dead link`);
}
async function respond(event){const url=new URL(event.request.url),path=url.pathname;requests.push({path,method:event.request.method});let data,status=200;
 if(event.request.method!=='GET'){data={error:'Mutations disabled in product QA'};status=405;failures.push('unexpected write '+path);}
 else if(path==='/api/auth/session')data={loggedIn,user:loggedIn?{id:owner,name}:null};
 else if(!loggedIn){data={error:'请先登录'};status=401;}
 else if(path==='/api/account/credits')data={account,admin:true,user:{name},prices:{text:5,analysisSmall:20,analysisMedium:35,analysisLarge:50,profile:30,transcription:5,voice:20}};
 else if(path==='/api/web/workspace'){const q=url.searchParams.get('q')||'';searchTerms.push(q);const filtered=reports.filter(row=>!q||(row.summary+row.label).includes(q));data={archive:{enabled:true,paused:false,selfReady:true,pendingFacts:3},people:q==='旧人物'?[{id:person,label:'旧人物',stage:'很久以前认识',updatedAt:1}]:people.filter(row=>!q||(row.label+row.stage).includes(q)),peopleTotal:43,followups,pendingFollowups:5,reports:filtered,total:filtered.length,page:1,pageSize:12};}
 else if(path==='/api/web/profile')data={enabled:true,paused:false,self:{values:'真诚'},subjects:people,facts:[],signals:[],trends:[]};
 else if(path==='/api/web/relationship-feedback'){const subjectId=url.searchParams.get('subjectId');data={subjectId,cards:feedbackCards.filter(card=>card.subjectId===subjectId),events:[]};}
 else if(path==='/api/web/session')data={linked:true,subjects:people,screenshot:{enabled:true,selfSide:'right'}};
 else {data={error:'Unexpected read '+path};status=501;}
 await send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,responseHeaders:[{name:'content-type',value:'application/json'},{name:'cache-control',value:'no-store'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
}
try{
 let port;for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}if(!port)throw Error('Edge failed');
 const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();socket=new WebSocket(version.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
 socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id){const request=pending.get(value.id);if(request){clearTimeout(request.timeout);pending.delete(value.id);value.error?request.reject(Error(value.error.message)):request.resolve(value.result);}}else if(value.method==='Fetch.requestPaused')void respond(value.params).catch(e=>failures.push(e.message));else if(value.method==='Runtime.exceptionThrown')failures.push(value.params.exceptionDetails.exception?.description||value.params.exceptionDetails.text);});
 const target=await call('Target.createTarget',{url:'about:blank'});sid=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:base+'/api/*'}]});
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 for(const width of [1280,390,320]){
   await send('Emulation.setDeviceMetricsOverride',{width,height:width<500?1000:1040,deviceScaleFactor:1,mobile:width<500});
   await go('/workspace');await until('!!document.querySelector(".desk-report-list")','member dashboard');
   assert.equal(await evaluate('document.querySelector(".desk-metrics strong").textContent'),'43');
   assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`workspace overflow ${width}`);
   assert.equal(await evaluate('!!document.querySelector(".desk-admin")'),true);
   await shot('workspace-'+width);results.push(`member workbench ${width}px: real total, reports, admin, no overflow`);
   await checkFollowups(width);
 }
 // Navigate through real anchors. Opening feedback must only open the requested
 // saved suggestion and never submit a mutation or consume analysis credits.
 for(const selected of [followups[1],followups[2]]){
   const link=`/archive?subjectId=${selected.subjectId}&followup=${selected.reportId}`;
   await evaluate(`document.querySelector('.desk-followup-record[href="${link}"]').click()`);
   await until(`location.pathname==='/archive'&&new URLSearchParams(location.search).get('subjectId')===${JSON.stringify(selected.subjectId)}&&new URLSearchParams(location.search).get('followup')===${JSON.stringify(selected.reportId)}`,'followup navigation');
   await until(`!!document.querySelector('[data-report-id="${selected.reportId}"] textarea')`,'target feedback editor');
   const editors=await evaluate(`Array.from(document.querySelectorAll('[data-report-id]')).filter(n=>n.querySelector('textarea')).map(n=>n.getAttribute('data-report-id'))`);
   assert.deepEqual(editors,[selected.reportId],'deep link opens only the exact saved suggestion');
   assert.equal(await evaluate(`document.querySelector('[data-report-id="${selected.reportId}"] select').value`),selected.outcome||'','existing feedback is preserved for revision');
   await evaluate(`Array.from(document.querySelectorAll('[data-report-id="${selected.reportId}"] button')).find(button=>button.textContent.trim()==='有进展').click()`);
   await until(`document.querySelector('[data-report-id="${selected.reportId}"] select').value==='positive'`,'feedback shortcut selects outcome');
   await delay(100);
   assert.equal(requests.filter(request=>request.path==='/api/web/relationship-feedback'&&request.method!=='GET').length,0,'choosing a result requires explicit save before sending');
   assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'feedback deep link mobile overflow');
   await shot('workspace-followup-editor-'+(selected.outcome?'revision':'pending'));
   await go('/workspace');await until('document.querySelectorAll(".desk-followups article").length===3','return from feedback');
 }
 results.push('real followup anchors select the exact person and advice; pending/revision editors and outcome shortcuts require explicit save before any write');
 await evaluate('document.querySelector(".web-search-trigger").click()');await until('document.querySelector(".quick-search-dialog")?.open','search opens');await until('document.querySelector(".quick-search-results").innerText.includes("林可然")','private search results');
 await input('#quick-search-field','旧人物');await until('document.querySelector(".quick-search-results").innerText.includes("很久以前认识")','server-side older person search');assert.ok(searchTerms.includes('旧人物'));await shot('search-mobile');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until('!document.querySelector(".quick-search-dialog")','Escape closes search');results.push('search reaches older records and Escape closes native dialog');
 await go('/reports');await until('document.querySelectorAll(".reports-item").length===2','reports list');await input('.reports-toolbar input','林可然');await until('document.querySelectorAll(".reports-item").length===1','report filter');await input('.reports-toolbar input','不存在的报告');await until('!!document.querySelector(".reports-empty")','empty report result');assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);results.push('report query and empty state');
 await go('/workspace');await until('!!document.querySelector(".desk-report-list")','dashboard return');await evaluate('document.querySelector(".web-search-trigger").click()');await until('document.querySelector(".quick-search-results")?.innerText.includes("林可然")','private search before logout');loggedIn=false;await evaluate('window.dispatchEvent(new Event("focus"))');await until('!document.querySelector(".quick-search-results")?.innerText.includes("林可然")','no previous private data after logout');assert.equal(await evaluate('document.querySelector(".quick-search-results")?.innerText.includes("会员管理后台")'),false);await evaluate('document.querySelector(".quick-search-input button").click()');results.push('open search clears private results and admin entry on identity recheck');
 await go('/workspace');await until('!!document.querySelector(".workspace-entry")','visitor home');await shot('visitor-home-mobile');await evaluate('document.querySelector(".workspace-entry").click()');await until('!!document.querySelector(".workspace-gate input[name=username]")','inline register');assert.equal(await evaluate('location.pathname'),'/workspace');assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await shot('visitor-register-mobile');results.push('guest sees homepage; feature opens inline registration without navigation');
 assert.deepEqual(failures,[]);await writeFile(`${out}/workspace-qa.json`,JSON.stringify({passed:true,results,failures,requests},null,2));console.log('PASS '+results.length+' product interaction groups; synthetic APIs only; '+out);
}finally{for(const value of pending.values())clearTimeout(value.timeout);try{if(socket?.readyState===1)await call('Browser.close');}catch{}socket?.close();edge.kill();}
