// Palette regression: original glass image, readable controls and both home states.
// Every API response is synthetic; SMS, registration and paid operations are never sent.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base='http://127.0.0.1:5191',output='outputs/clear-glass-release/homes';
await mkdir(output,{recursive:true});
const owner='88888888-8888-4888-8888-888888888888',person='11111111-1111-4111-8111-111111111111';
const people=[{id:person,label:'林可然',stage:'正在了解',updatedAt:Date.now()}];
const profile=await mkdtemp(join(tmpdir(),'chengzi-palette-qa-'));
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,serial=0,sessionId,loggedIn=false;
const pending=new Map(),exceptions=[],requests=[],pages=[],unexpected=[];
function call(method,params={},sid){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},25000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});}
const send=(method,params={})=>call(method,params,sessionId);
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+r.result.description);return r.result.value;}
async function until(expression,label){for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(80);}throw Error('Timed out: '+label);}
async function shot(name){const value=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`${output}/${name}.png`,Buffer.from(value.data,'base64'));}
function rgb(value){return (value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);}
function contrast(foreground,background){const luminance=value=>{const c=rgb(value).map(n=>{const v=n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];};const values=[luminance(foreground),luminance(background)].sort((a,b)=>a-b);return (values[1]+.05)/(values[0]+.05);}
function checkText(style,label){const ratio=contrast(style.color,style.background);assert.ok(ratio>=4.5,`${label} contrast ${ratio.toFixed(2)}: ${JSON.stringify(style)}`);return ratio;}
async function styles(selector,pseudo){return evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing '+${JSON.stringify(selector)});const s=getComputedStyle(n,${JSON.stringify(pseudo||null)}),normal=getComputedStyle(n);return {color:s.color,background:normal.backgroundColor,gradient:normal.backgroundImage,opacity:s.opacity}})()`);}
async function checkPrimary(selector,label){const style=await styles(selector);assert.equal(style.color,'rgb(255, 255, 255)',label+' must retain white text');const stops=[...style.gradient.matchAll(/rgba?\([^)]+\)/g)].map(match=>match[0]);if(!stops.length)stops.push(style.background);return {style,ratios:stops.map(background=>checkText({color:style.color,background},label))};}
async function respond(event){const path=new URL(event.request.url).pathname;requests.push({path,method:event.request.method});let data,status=200;
 if(event.request.method!=='GET'){data={error:'Mutations disabled in palette QA'};status=405;unexpected.push(path);}
 else if(path==='/api/auth/session')data={loggedIn,user:loggedIn?{id:owner,name:'林知夏'}:null};
 else if(!loggedIn){data={error:'请先登录'};status=401;}
 else if(path==='/api/account/credits')data={account:{userId:owner,balance:120,reserved:0,spent:20,active:true,enabledUntil:Date.now()+86400000,features:['analysis','chat','voice'],entries:[]},admin:false,user:{name:'林知夏'},prices:{text:5,analysisSmall:20,voice:20}};
 else if(path==='/api/web/workspace')data={people,peopleTotal:1,reports:[],total:0,page:1,pageSize:12,archive:{enabled:true,paused:false,pendingFacts:0,selfReady:false},followups:[],pendingFollowups:0};
 else if(path==='/api/web/profile')data={enabled:true,paused:false,self:{},subjects:people,facts:[],signals:[],trends:[]};
 else {data={error:'Unexpected synthetic GET '+path};status=501;unexpected.push(path);}
 await send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,responseHeaders:[{name:'content-type',value:'application/json'},{name:'cache-control',value:'no-store'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
}
try{
 let info;for(let i=0;i<80;i++){try{info=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break;}catch{await delay(100);}}
 if(!info)throw Error('Edge failed');socket=new WebSocket('ws://127.0.0.1:'+info[0]+info[1]);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Fetch.requestPaused')void respond(m.params).catch(error=>exceptions.push(String(error)));if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});sessionId=(await call('Target.attachToTarget',{targetId,flatten:true})).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:base+'/api/*',requestStage:'Request'}]});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 for(const width of [390,1280,320]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:width<700?1000:1040,deviceScaleFactor:1,mobile:width<700});
  for(const member of [false,true]){
   loggedIn=member;const name=member?'member':'guest';await send('Page.navigate',{url:base+'/workspace'});
   await until(`document.readyState==='complete'&&!!document.querySelector(${JSON.stringify(member?'.desk-hero':'.workspace-entry')})`,name+' home');
   await until(`(()=>{const n=document.querySelector('.cz-glass-stage img');return n&&n.complete&&n.naturalWidth>0})()`,'original glass loaded');await delay(300);
   const state=await evaluate(`(()=>{const n=document.querySelector('.cz-glass-stage'),r=n.getBoundingClientRect(),img=n.querySelector('img');const surface=document.querySelector('.desk-panel,.workspace-entry'),ss=getComputedStyle(surface),active=document.querySelector('.web-nav nav a[aria-current=page]'),as=getComputedStyle(active);let imageOpacity=1;for(let el=img;el;el=el.parentElement)imageOpacity*=Number(getComputedStyle(el).opacity);return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,image:img.getAttribute('src'),imageOpacity,background:getComputedStyle(document.body).backgroundColor,stageBackground:getComputedStyle(n).backgroundColor,mask:getComputedStyle(n).maskImage,surface:{background:ss.backgroundColor,gradient:ss.backgroundImage,backdrop:ss.backdropFilter,shadow:ss.boxShadow},activeNav:{color:as.color,background:as.backgroundColor},imageBounds:{x:r.x,y:r.y,width:r.width,height:r.height}}})()`);
   assert.equal(state.background,'rgb(245, 249, 251)','daylight body must reach each home state');assert.match(state.image,/relationship-daylight\.webp/,'retain original glass image');assert.ok(state.scrollWidth<=width+1,'home horizontal overflow');assert.ok(state.imageBounds.width>100&&state.imageBounds.height>80,'main image remains visible');assert.ok(state.imageOpacity>=.89,'old warm opacity must not fog the original image');assert.notEqual(state.surface.backdrop,'none','glass surface retains background blur');
   const primary=await checkPrimary(member?'.desk-primary':'.workspace-cta',name+' primary');await shot(`${name}-${width}`);pages.push({name,width,...state,primary});
   if(!member){
    await evaluate('document.querySelector(".workspace-entry").click()');await until('!!document.querySelector(".workspace-gate input[name=username]")','inline register');await delay(120);
    const sms=await styles('.register-code-button'),smsContrast=checkText(sms,'SMS button'),submit=await checkPrimary('.phone-register-submit','register submit');
    const input=await styles('.workspace-gate input[name=username]');const inputContrast=checkText(input,'registration input');
    const placeholder=await styles('.workspace-gate input[name=username]','::placeholder');const placeholderContrast=checkText(placeholder,'registration placeholder');
    const dialog=await evaluate(`(()=>{const n=document.querySelector('.workspace-gate'),r=n.getBoundingClientRect();return {left:r.left,right:r.right,scrollWidth:document.documentElement.scrollWidth,path:location.pathname}})()`);
    assert.equal(dialog.path,'/workspace');assert.ok(dialog.left>=-1&&dialog.right<=width+1&&dialog.scrollWidth<=width+1,'inline register fits viewport');await shot(`register-${width}`);pages.push({name:'register',width,sms,smsContrast,submit,input,placeholder,inputContrast,placeholderContrast,dialog});
   }
  }
 }
 assert.deepEqual(exceptions,[]);assert.deepEqual(unexpected,[]);assert.ok(requests.every(row=>row.method==='GET'));
 await writeFile(output+'/qa.json',JSON.stringify({passed:true,synthetic:true,pages,requests,exceptions},null,2));console.log(`PASS ${pages.length} home/modal palette checks at 320/390/1280; synthetic GET only.`);
}catch(error){await writeFile(output+'/qa.json',JSON.stringify({passed:false,synthetic:true,pages,requests,exceptions,unexpected,error:String(error.stack)},null,2));throw error;}
finally{if(socket?.readyState===1){try{await call('Browser.close');}catch{}socket.close();}edge.kill();for(const p of pending.values())clearTimeout(p.timer);}
