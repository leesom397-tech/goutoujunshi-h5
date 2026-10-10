// Real locally built page; all API responses are synthetic and no model is called.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base='http://127.0.0.1:5191', output='outputs/person-comparison';
const fixture=JSON.parse(await readFile('.tmp/miniapp-comparison-fixture.json','utf8'));
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'chengzi-comparison-qa-'));
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,serial=0,sessionId;
const pending=new Map(),exceptions=[],checks=[],requests=[];
function call(method,params={},sid){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));});}
const send=(method,params)=>call(method,params,sessionId);
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+r.result.description);return r.result.value;}
async function until(expression,label){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(80);}throw Error('Timed out: '+label);}
async function click(selector){const box=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing target');e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...box});await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box});await delay(100);}
async function respond(event){const path=new URL(event.request.url).pathname;requests.push({path,method:event.request.method});let data;
 if(path==='/api/web/profile')data=fixture;
 else if(path==='/api/auth/session')data={loggedIn:true,user:{id:'11111111-1111-4111-8111-111111111111',name:'合成对照测试'}};
 else if(path==='/api/account/credits')data={account:{userId:'11111111-1111-4111-8111-111111111111',balance:100,active:true,features:['analysis','chat','voice']},prices:{text:5,profile:30,voice:20}};
 else data={error:'Unexpected synthetic API '+path};
 await send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:data.error?501:200,responseHeaders:[{name:'content-type',value:'application/json'},{name:'cache-control',value:'no-store'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});}
const panel='section[aria-label="人物对照"]';
try{
 let info;for(let i=0;i<80;i++){try{info=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break;}catch{await delay(100);}}
 if(!info)throw Error('Edge failed');socket=new WebSocket('ws://127.0.0.1:'+info[0]+info[1]);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Fetch.requestPaused')void respond(m.params).catch(error=>exceptions.push(String(error)));if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});sessionId=(await call('Target.attachToTarget',{targetId,flatten:true})).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:base+'/api/*',requestStage:'Request'}]});await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'/archive'});await until(`!!document.querySelector('${panel}')`,'archive loaded');await delay(300);
 await click(panel+' button');await until(`document.querySelectorAll('${panel} fieldset label').length===4`,'comparison expanded');assert.equal(await evaluate(`document.querySelectorAll('${panel} fieldset label').length`),4);
 await click(panel+' fieldset label:nth-of-type(2)');assert.equal(await evaluate(`!!document.querySelector('${panel} table')`),false);
 await click(panel+' fieldset label:nth-of-type(1)');await until(`!!document.querySelector('${panel} table')`,'two-person table');
 assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${panel} thead a'),n=>n.textContent.replace(' ↗',''))`),['合成人物 B','合成人物 A']);
 const cellExpression=label=>`Array.from(document.querySelectorAll('${panel} tbody tr')).find(r=>r.querySelector('th').textContent===${JSON.stringify(label)}).querySelector('td').innerText`;
 assert.equal((await evaluate(cellExpression('常住地'))).trim(),'未提供');assert.match(await evaluate(cellExpression('待核对线索')),/待核对：深圳/);assert.match(await evaluate(cellExpression('互动参考')),/片段参考，暂不可比较/);
 checks.push('real pointer selection requires two people, respects chosen order and separates pending/partial evidence');
 await click(panel+' fieldset label:nth-of-type(3)');assert.equal(await evaluate(`document.querySelector('${panel} fieldset label:nth-of-type(4) input').disabled`),true);
 await click(panel+' fieldset label:nth-of-type(2)');assert.equal(await evaluate(`document.querySelector('${panel} fieldset label:nth-of-type(4) input').disabled`),false);await click(panel+' fieldset label:nth-of-type(4)');
 assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${panel} thead a'),n=>n.textContent.replace(' ↗',''))`),['合成人物 A','合成人物 C','合成人物 D']);
 checks.push('fourth selection disabled; deselect/replacement updates columns immediately');
 await click(panel+' fieldset label:nth-of-type(4)');await click(panel+' fieldset label:nth-of-type(2)');
 const rows=await evaluate(`document.querySelectorAll('${panel} tbody tr').length`);
 await click(panel+' input[type=checkbox]:not(fieldset input)');
 assert.equal(await evaluate(`document.querySelectorAll('${panel} tbody tr').length`),rows+10);
 assert.ok(await evaluate(`document.querySelector('${panel} table').innerText.includes('同城不计分')`));
 await click(panel+' input[type=checkbox]:not(fieldset input)');
 checks.push('expanded basics and six compatibility dimensions retain existing evidence without recalculation');
 for(const width of [1280,390]){
   await send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:width===390});
   await evaluate(`document.querySelector('${panel}').scrollIntoView({block:'start'})`);await delay(130);
   assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'page itself cannot overflow horizontally');
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`${output}/comparison-${width}.png`,Buffer.from(shot.data,'base64'));
   if(width===390){
     assert.ok(await evaluate(`(()=>{const e=document.querySelector('${panel} [role=region]');return e.scrollWidth>e.clientWidth})()`));
     await evaluate(`document.querySelector('${panel} [role=region]').scrollIntoView({block:'start'})`);
     const rect=await evaluate(`(()=>{const r=document.querySelector('${panel} [role=region]').getBoundingClientRect();return{x:r.x+220,y:r.y+100}})()`);
     await send('Input.dispatchMouseEvent',{type:'mouseWheel',...rect,deltaX:310,deltaY:0});await delay(180);
     assert.ok(await evaluate(`document.querySelector('${panel} [role=region]').scrollLeft>0`),'horizontal wheel scrolls the table');
     const scrollShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(output+'/comparison-390-scrolled.png',Buffer.from(scrollShot.data,'base64'));
   }
 }
 checks.push('desktop/mobile layout stays within viewport; real horizontal wheel reveals further columns');
 assert.deepEqual(exceptions,[]);assert.ok(requests.every(item=>item.method==='GET'));assert.ok(requests.every(item=>['/api/auth/session','/api/web/profile','/api/account/credits'].includes(item.path)));
 checks.push('comparison makes no extra API requests, mutations or paid model calls');
 await writeFile(output+'/qa.json',JSON.stringify({passed:true,synthetic:true,checks,requests,exceptions},null,2));console.log('PASS '+checks.length+' comparison browser regression groups.');
}catch(error){try{const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(output+'/failure.png',Buffer.from(shot.data,'base64'));}catch{}await writeFile(output+'/qa.json',JSON.stringify({passed:false,synthetic:true,checks,requests,exceptions,error:String(error.stack)},null,2));throw error;}
finally{if(socket?.readyState===1){try{await call('Browser.close');}catch{}socket.close();}edge.kill();for(const value of pending.values())clearTimeout(value.timer);}
