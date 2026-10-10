// Built pages; synthetic GET fixtures only. No mutations, model calls or media capture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const focusButton=process.argv.includes('--reports-button');
const focusGlass=process.argv.includes('--glass');
const base='http://127.0.0.1:5191',output=focusGlass?'outputs/clear-glass-release/pages':focusButton?'outputs/clear-glass-release/buttons':'outputs/page-scenes/qa';
const owner='88888888-8888-4888-8888-888888888888',person='11111111-1111-4111-8111-111111111111',reportId='33333333-3333-4333-8333-333333333333';
const prices={text:5,analysisSmall:20,analysisMedium:35,analysisLarge:50,profile:30,transcription:5,voice:20};
const account={userId:owner,balance:120,reserved:0,spent:25,features:['analysis','chat','voice'],active:true,enabledUntil:Date.now()+86400000,entries:[{kind:'settled',amount:20,label:'聊天截图分析',time:Date.now()}]};
const archive={enabled:true,paused:false,self:{},subjects:[{id:person,label:'合成人物',stage:'继续了解',updatedAt:Date.now()}],facts:[],signals:[],trends:[]};
const report={id:reportId,subjectId:person,status:'done',lines:[{id:'line1',speaker:'other',text:'周六一起喝咖啡吗？'},{id:'line2',speaker:'self',text:'好呀，下午三点怎么样？'}],annotations:[],affinity:{value:null,dimensions:[]},decision:{judgment:'合成报告：有明确的邀约信号，可以继续确认安排。',possibleIntent:'可能愿意进一步了解',evidence:'对方主动提出周六喝咖啡。',nextStep:'确认具体时间与地点，保留双方调整的空间。',interactionInsight:{observed:'提出具体活动',interpretation:'可能愿意线下见面',alternative:'也可能是普通朋友邀约',verify:'观察是否落实时间地点'},replyOptions:[]}};
const workspace={people:archive.subjects,peopleTotal:1,reports:[{id:reportId,label:'合成人物',summary:report.decision.judgment,createdAt:Date.now(),expiresAt:Date.now()+86400000}],total:1,page:1,pageSize:12,archive:{enabled:true,paused:false,pendingFacts:0,selfReady:false},progress:{pending:[],recent:[]}};
const routes=[{name:'analysis',path:'/analyze',variant:'analysis'},{name:'analysis-social',path:'/analyze?kind=profile',variant:'social'},{name:'chat',path:'/chat',variant:'chat'},{name:'voice',path:'/voice',variant:'voice'},{name:'report',path:'/report?id='+reportId,variant:'report'},{name:'reports',path:'/reports',variant:'report'},{name:'account',path:'/account',variant:'account'},{name:'archive',path:'/archive',variant:'archive'},{name:'archive-self',path:'/archive?tab=self',variant:'self'}];
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'chengzi-scenes-qa-'));
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,serial=0,sessionId;
const pending=new Map(),exceptions=[],requests=[],pages=[],unexpected=[];
function call(method,params={},sid){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},25000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});}
const send=(method,params)=>call(method,params,sessionId);
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+r.result.description);return r.result.value;}
async function until(expression,label){for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(80);}throw Error('Timed out: '+label);}
async function respond(event){const path=new URL(event.request.url).pathname;requests.push({path,method:event.request.method});let data;
 if(event.request.method!=='GET')data={error:'Visual review never submits paid or mutating requests'};
 else if(path==='/api/auth/session')data={loggedIn:true,user:{id:owner,name:'视觉合成账号'}};
 else if(path==='/api/account/credits')data={account,prices,user:{name:'视觉合成账号'},admin:false};
 else if(path==='/api/web/profile')data=archive;
 else if(path==='/api/web/session')data={linked:true,subjects:archive.subjects,screenshot:{enabled:true,selfSide:'right'}};
 else if(path==='/api/web/report')data={report};
 else if(path==='/api/web/workspace')data=workspace;
 else if(path==='/api/web/relationship-feedback')data={subjectId:person,cards:[],events:[]};
 else if(path==='/api/web/voice-live/status')data={remaining:30,configured:true};
 else if(path==='/api/web/settings')data={enabled:true,selfSide:'right'};
 else data={error:'Unexpected synthetic GET '+path};
 if(data.error)unexpected.push({path,method:event.request.method});
 await send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:data.error?501:200,responseHeaders:[{name:'content-type',value:'application/json'},{name:'cache-control',value:'no-store'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
}
try{
 let info;for(let i=0;i<80;i++){try{info=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break;}catch{await delay(100);}}
 if(!info)throw Error('Edge failed');socket=new WebSocket('ws://127.0.0.1:'+info[0]+info[1]);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Fetch.requestPaused')void respond(m.params).catch(error=>exceptions.push(String(error)));if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});sessionId=(await call('Target.attachToTarget',{targetId,flatten:true})).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:base+'/api/*',requestStage:'Request'}]});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 for(const width of [390,1280,320]){
  if(focusGlass&&width!==390)continue;
  if(focusButton&&width===320)continue;
  await send('Emulation.setDeviceMetricsOverride',{width,height:width<700?844:950,deviceScaleFactor:1,mobile:width<700});
  for(const route of routes){
   if(focusGlass&&!['analysis','chat','account','archive'].includes(route.name))continue;
   if(focusButton&&route.name!=='reports')continue;
   if(width===320&&!['analysis','chat','report','reports','account','archive'].includes(route.name))continue;
   await send('Page.navigate',{url:base+route.path});
   await until(`document.readyState==='complete'&&!!document.querySelector('[data-illustration="${route.variant}"]>svg')`,route.name+' SVG');await delay(600);
   if(route.name==='account')await until("document.querySelector('.account-balance strong')?.textContent==='120'",'account fixture');
   if(route.name==='reports')await until("document.querySelectorAll('.reports-item').length===1",'report list fixture');
   if(focusButton){const buttonStyle=await evaluate("(()=>{const s=getComputedStyle(document.querySelector('.reports-heading>.desk-primary'));return {color:s.color,background:s.backgroundColor,gradient:s.backgroundImage}})()");assert.equal(buttonStyle.color,'rgb(255, 255, 255)','reports action must use readable white text');const colors=[...buttonStyle.gradient.matchAll(/rgba?\(([^)]+)\)/g)].map(match=>match[1].split(',').slice(0,3).map(Number));if(!colors.length)colors.push(buttonStyle.background.match(/[\d.]+/g).slice(0,3).map(Number));for(const rgb of colors){const linear=rgb.map(value=>{const s=value/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});const luminance=linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;assert.ok(1.05/(luminance+.05)>=4.5,'reports action text contrast must reach 4.5 against every gradient stop');}}
   const result=await evaluate(`(()=>{
    const figures=[...document.querySelectorAll('.cz-page-illustration')].map(node=>{const svg=node.querySelector(':scope>svg'),r=node.getBoundingClientRect(),s=svg.getBoundingClientRect();let opacity=1;for(let el=node;el;el=el.parentElement){const cs=getComputedStyle(el);opacity*=Number(cs.opacity);if(cs.display==='none'||cs.visibility==='hidden')opacity=0;}const heading=node.closest('.wa-heading,.reports-heading,.account-heading,header');const collisions=heading?[...heading.querySelectorAll('h1,p,button,a')].filter(el=>{if(node.contains(el))return false;const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&Math.min(b.right,r.right)-Math.max(b.left,r.left)>2&&Math.min(b.bottom,r.bottom)-Math.max(b.top,r.top)>2;}).map(el=>el.textContent.slice(0,60)):[];return {variant:node.dataset.illustration,width:r.width,height:r.height,svgWidth:s.width,svgHeight:s.height,opacity,collisions,animation:getComputedStyle(svg).animationName};});
    const ids=[...document.querySelectorAll('[id^="cz-art-"]')].map(node=>node.id);
    const surface=document.querySelector('.wa-card,.account-card,section[class*="card"],article[class*="person"]');const s=surface?getComputedStyle(surface):null;
    return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,figures,duplicateIds:ids.filter((id,i)=>ids.indexOf(id)!==i),surface:s?{color:s.color,background:s.backgroundColor,gradient:s.backgroundImage,backdrop:s.backdropFilter,shadow:s.boxShadow}:null};
   })()`);
   pages.push({name:route.name,...result});
   assert.ok(result.scrollWidth<=width+1,`${route.name} ${width}: horizontal overflow ${result.scrollWidth}`);
   assert.deepEqual(result.duplicateIds,[],`${route.name}: reused SVG IDs`);
   const relevant=result.figures.filter(row=>row.variant===route.variant);assert.ok(relevant.length);
   for(const figure of result.figures){assert.ok(figure.width>=50&&figure.height>=38&&figure.opacity>.3,`${route.name} ${width}: hidden/small illustration ${JSON.stringify(figure)}`);assert.ok(Math.abs(figure.svgWidth-figure.width)<2,`${route.name}: inherited SVG width collapsed`);assert.deepEqual(figure.collisions,[],`${route.name} ${width}: illustration overlaps text/actions`);assert.equal(figure.animation,'none',`${route.name}: reduced motion ignored`);}
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`${output}/${route.name}-${width}.png`,Buffer.from(shot.data,'base64'));
  }
 }
 assert.deepEqual(exceptions,[]);assert.deepEqual(unexpected,[]);assert.ok(requests.every(row=>row.method==='GET'));
 await writeFile(output+'/qa.json',JSON.stringify({passed:true,synthetic:true,pages,requests,exceptions},null,2));console.log(`PASS ${pages.length} page/viewport illustration checks, synthetic GET only.`);
}catch(error){await writeFile(output+'/qa.json',JSON.stringify({passed:false,synthetic:true,pages,requests,exceptions,unexpected,error:String(error.stack)},null,2));throw error;}
finally{if(socket?.readyState===1){try{await call('Browser.close');}catch{}socket.close();}edge.kill();for(const p of pending.values())clearTimeout(p.timer);}
