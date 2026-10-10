// Independent computed typography/contrast review. Synthetic GET fixtures only.
// Run only after the coordinator confirms the final local build is ready.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectReadability } from './readability-collector.mjs';
const base='http://127.0.0.1:5191', output='outputs/readability';
const owner='88888888-8888-4888-8888-888888888888', person='11111111-1111-4111-8111-111111111111', reportId='33333333-3333-4333-8333-333333333333';
const archive=JSON.parse(await readFile('.tmp/miniapp-comparison-fixture.json','utf8'));
archive.subjects[0].id=person;for(const fact of archive.facts)if(fact.subjectId==='a')fact.subjectId=person;
for(const signal of archive.signals)if(signal.subjectId==='a'){signal.subjectId=person;signal.reportId=reportId;}
for(const trend of archive.trends)if(trend.subjectId==='a'){trend.subjectId=person;for(const point of trend.points){point.subjectId=person;point.reportId=reportId;}}
archive.subjects[0].notes='这是合成人物资料，用于检查说明文字的可读性。';
archive.subjects[0].communicationReading={summary:'现有线索支持继续了解，仍需核实具体相处安排。',hypotheses:[{title:'沟通节奏',possibility:'可能更喜欢有明确时间的邀约',evidence:'对方提出周六喝咖啡',alternative:'也可能只是这周刚好有空',verify:'观察是否愿意落实时间与地点'}],approach:{attitude:'平等交流',emotion:'自然回应',pace:'跟随真实反馈',avoid:'连续追问',evidence:'具体邀约',adjustWhen:'对方表达不方便时'}};
const prices={text:5,analysisSmall:20,analysisMedium:35,analysisLarge:50,profile:30,transcription:5,voice:20};
const account={userId:owner,balance:120,reserved:0,spent:25,features:['analysis','chat','voice'],active:true,enabledUntil:Date.now()+86400000,signupCredits:0,entries:[{kind:'settled',amount:20,label:'聊天截图分析',time:Date.now()},{kind:'released',amount:5,label:'文字咨询已退回',time:Date.now()-86400000}]};
const report={id:reportId,subjectId:person,status:'done',lines:[{id:'line1',speaker:'other',text:'周六一起喝咖啡吗？',timestampRaw:'2026-10-05 16:20'},{id:'line2',speaker:'self',text:'好呀，下午三点怎么样？',timestampRaw:'2026-10-05 16:22'}],annotations:[{lineId:'line1',note:'对方提出具体邀约，需要继续核实时间和地点。',emotion:[{label:'友好',weight:.8}],intent:[{label:'邀约',weight:.9}]}],affinity:{value:67,valueScope:'full',dimensions:[{label:'主动表达',value:70},{label:'回应承接',value:65},{label:'回应扩展',value:66},{label:'邀约兑现',value:null},{label:'边界尊重',value:80},{label:'互惠稳定',value:60}]},decision:{judgment:'有明确的邀约信号，可以继续确认安排。',possibleIntent:'可能愿意进一步了解',evidence:'对方主动提出周六喝咖啡。',nextStep:'确认具体时间与地点，保留双方调整的空间。',interactionInsight:{observed:'提出具体活动',interpretation:'可能愿意线下见面',alternative:'也可能是普通朋友邀约',verify:'观察是否落实时间地点'},replyOptions:[{style:'自然承接',text:'好呀，周六下午三点怎么样？',reason:'回应具体安排，给出可确认的时间。',cost:'需要确认自己的日程，并接受对方调整。',weight:80}],photoClues:[{location:'聊天照片',speaker:'other',observation:'可见一杯咖啡',inference:'可能正在咖啡馆',alternative:'也可能是旧图或转发',verify:'可以自然询问是哪家店'}]}};
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'chengzi-readability-qa-'));
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,serial=0,sessionId;
const pending=new Map(),exceptions=[],requests=[],pages=[];let visitorMode=false,adminMode=false;
function call(method,params={},sid){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},25000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});}
const send=(method,params)=>call(method,params,sessionId);
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+r.result.description);return r.result.value;}
async function until(expression,label){for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(90);}throw Error('Timed out: '+label);}
async function respond(event){const path=new URL(event.request.url).pathname;requests.push({path,method:event.request.method});let data;
 if(event.request.method!=='GET')data={error:'Readability review never submits paid or mutating requests'};
 else if(path==='/api/auth/session')data=visitorMode?{loggedIn:false,user:null}:{loggedIn:true,user:{id:owner,name:'可读性合成账号'}};
 else if(path==='/api/account/credits')data={account,prices,user:{name:'可读性合成账号'},admin:adminMode};
 else if(path==='/api/account/admin/members')data={members:[{ownerId:'chengzi:'+person,userId:person,name:'林可然',source:'web',balance:120,features:['analysis','chat'],enabledUntil:Date.now()+86400000,status:'active',createdAt:Date.now()-604800000,lastLoginAt:Date.now()}],summary:{total:1,active:1,pending:0},total:1,page:1,pageSize:30};
 else if(path==='/api/account/admin/credits')data={account,activity:[{kind:'adjustment',amount:120,detail:'合成订单开通',actor:'lovetalk:chengyi01',state:'',feature:'',features:'',enabled_until:0,time:Date.now()},{kind:'permissions',amount:0,detail:'开通分析和咨询',actor:'lovetalk:chengyi01',state:'',feature:'',features:'["analysis","chat"]',enabled_until:Date.now()+86400000,time:Date.now()-3600000},{kind:'task',amount:-20,detail:'',actor:'',state:'settled',feature:'analysis',features:'',enabled_until:0,time:Date.now()-7200000}]};
 else if(path==='/api/web/profile')data=archive;
 else if(path==='/api/web/session')data={linked:true,subjects:archive.subjects,screenshot:{enabled:true,selfSide:'right'}};
 else if(path==='/api/web/report')data={report};
 else if(path==='/api/web/relationship-feedback')data={subjectId:person,cards:[],events:[]};
 else if(path==='/api/web/voice-live/status')data={remaining:30,configured:true};
 else if(path==='/api/web/settings')data={enabled:true,selfSide:'right'};
 else data={error:'Unexpected synthetic GET '+path};
 await send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:data.error?501:200,responseHeaders:[{name:'content-type',value:'application/json'},{name:'cache-control',value:'no-store'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
}
const routes=[
 {name:'workspace',path:'/workspace',ready:'!!document.querySelector(".workspace-hero")'},
 {name:'workspace-register',path:'/workspace',ready:'!!document.querySelector(".workspace-hero")',gate:true},
 {name:'admin-members',path:'/admin/credits',ready:'!!document.querySelector(".admin-member-list")',admin:true},
 {name:'account',path:'/account',ready:'!!document.querySelector(".account-balance strong")'},
 {name:'login',path:'/login',ready:'!!document.querySelector("input[type=password]")'},
 {name:'register',path:'/register',ready:'!!document.querySelector(".register-code-button")'},
 {name:'analysis',path:'/analyze',ready:'!!document.querySelector(".wa-upload-zone") || !!document.querySelector("input[type=file]")'},
 {name:'analysis-social',path:'/analyze?kind=profile',ready:'!!document.querySelector("input[type=file]")'},
 {name:'report',path:'/report?id='+reportId,ready:'document.body.innerText.includes("有明确的邀约信号")'},
 {name:'archive',path:'/archive',ready:'!!document.querySelector("section[aria-label=人物对照]")'},
 {name:'archive-person',path:'/archive?subjectId='+person,ready:'document.body.innerText.includes("这段关系，现在怎么看")'},
 {name:'chat',path:'/chat',ready:'!!document.querySelector(".wa-chat-message[data-role=assistant]")'},
 {name:'voice',path:'/voice',ready:'!!document.querySelector(".wa-voice-card")'},
 {name:'comparison',path:'/archive',ready:'!!document.querySelector("section[aria-label=人物对照]")',comparison:true},
];
const cell=value=>String(value??'').replace(/\|/g,'／').replace(/[\r\n]+/g,' ').slice(0,160);
function reportMarkdown(){
 const lines=['# 网页文字可读性：计算样式独立检查','',`检查 ${pages.length} 个页面/宽度组合；全部使用合成 GET 数据，关闭动态效果。`,'','这份报告给出实际 CSS 证据，不构成全自动通过结论。普通正文最低 14px，目标 15px；辅助文字最低 12px，目标 13px；文本对浅底的目标对比为 4.5。禁用控件与装饰英文单独记录。透明色按祖先背景逐层合成；渐变使用已知色标的最低候选值；图片、伪元素或分组透明度需人工复核。',''];
 for(const page of pages){
   const unique=new Map();for(const row of page.rows.filter(item=>item.issues.length&&!item.disabled&&item.role!=='decorative')){const key=row.role+'|'+row.selector+'|'+row.size+'|'+row.foreground+'|'+row.issues.join(',');if(!unique.has(key))unique.set(key,row);}
   const findings=[...unique.values()].sort((a,b)=>Number(b.issues.includes('below-minimum-size'))-Number(a.issues.includes('below-minimum-size'))||(a.contrast??99)-(b.contrast??99));
   lines.push(`## ${page.name} · ${page.viewport.width}px`,'',`采集 ${page.rows.length} 个文字节点；有 ${findings.length} 类需查看的项目。完整 computed 数据见 JSON。`,'','| 文字 / 角色 | 字号 / 字重 | 前景 | 对比候选 | 项目 | 选择器 |','|---|---|---|---|---|---|');
   for(const row of findings)lines.push(`| ${cell(row.text)} / ${row.role} | ${row.size}px / ${row.weight} | ${cell(row.foreground)} | ${row.contrast??'未知'} · ${cell(row.contrastMethod)} | ${row.issues.join(', ')} | ${cell(row.selector)} |`);
   if(!findings.length)lines.push('| 本次计算未发现低于阈值的文本；仍需目视确认背景图与层级。 | | | | | |');
   lines.push('');
 }
 return lines.join('\n');
}
try{
 let info;for(let i=0;i<80;i++){try{info=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break;}catch{await delay(100);}}
 if(!info)throw Error('Edge failed');socket=new WebSocket('ws://127.0.0.1:'+info[0]+info[1]);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Fetch.requestPaused')void respond(m.params).catch(error=>exceptions.push(String(error)));if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});sessionId=(await call('Target.attachToTarget',{targetId,flatten:true})).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:base+'/api/*',requestStage:'Request'}]});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const chatSeed={owner,subject:'',mode:'conversation',draft:'合成提问：我想确认下一步怎么自然地回应。',other:'',messages:[{id:'synthetic-u',role:'user',content:'最近对方主动提起了周末见面，我有点期待，也担心自己理解错了。'},{id:'synthetic-a',role:'assistant',content:'可以先看对方是否愿意确认时间与地点。明确邀请是积极线索，但还不足以直接确认关系意图。你可以自然回应，同时给彼此调整安排的空间。',evidence:'对方提出了具体活动，后续是否落实还需要观察。'}]};
 await send('Page.addScriptToEvaluateOnNewDocument',{source:'sessionStorage.setItem('+JSON.stringify('chengzi-chat:'+owner)+','+JSON.stringify(JSON.stringify(chatSeed))+');'});
 for(const width of [320,390,1280]){
   await send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:width===390});
   for(const route of routes){
     if(width===320 && !["workspace","workspace-register","admin-members","account","analysis","chat","comparison","register"].includes(route.name))continue;
     const only=process.argv.find(value=>value.startsWith("--only="))?.slice(7).split(",");if(only&&!only.includes(route.name))continue;
     visitorMode=Boolean(route.gate);adminMode=Boolean(route.admin);await send('Page.navigate',{url:base+route.path});await until('document.readyState==="complete" && ('+route.ready+')',route.name);await evaluate('document.fonts.ready.then(()=>true)');await delay(350);
     if(route.gate){await evaluate('document.querySelector(".workspace-entry").click()');await until('!!document.querySelector(".workspace-gate .phone-register-form")',route.name+' dialog');await delay(150);}
     if(route.admin){await until('!!document.querySelector(".admin-member-item")',route.name+' list');await evaluate('document.querySelector(".admin-member-item").click()');await until('!!document.querySelector(".admin-action-cards")',route.name+' detail');await delay(100);}
     if(route.comparison){await evaluate(`(()=>{const p=document.querySelector('section[aria-label="人物对照"]');p.querySelector('button').click()})()`);await delay(80);await evaluate(`(()=>{const p=document.querySelector('section[aria-label="人物对照"]');const c=p.querySelectorAll('fieldset input');c[0].click();c[1].click()})()`);await delay(120);await evaluate(`document.querySelector('section[aria-label="人物对照"] input:not(fieldset input)').click()`);await delay(80);}
     if(['report','archive-person','comparison'].includes(route.name))await evaluate(`document.querySelectorAll('main details').forEach(e=>e.open=true)`);
     const data=await evaluate('('+collectReadability.toString()+')()');pages.push({name:route.name,...data});
     await evaluate(route.comparison?`document.querySelector('section[aria-label="人物对照"]').scrollIntoView({behavior:'instant',block:'start'})`:'scrollTo({top:0,behavior:"instant"})');
     const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`${output}/${route.name}-${width}.png`,Buffer.from(shot.data,'base64'));
     console.log(`${route.name} ${width}: ${data.rows.length} text nodes, ${data.rows.filter(row=>row.issues.includes('below-minimum-size')).length} below minimum, ${data.rows.filter(row=>row.issues.includes('low-contrast')).length} solid contrast candidates`);
   }
 }
}finally{
 await writeFile(output+'/computed.json',JSON.stringify({collectedAt:new Date().toISOString(),synthetic:true,reducedMotion:true,pages,requests,exceptions},null,2));await writeFile(output+'/findings.md',reportMarkdown());
 if(socket?.readyState===1){try{await call('Browser.close');}catch{}socket.close();}edge.kill();for(const value of pending.values())clearTimeout(value.timer);
}
