import {spawn} from 'node:child_process';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'chengzi-reference-'));
const out='outputs/design-refresh/references';await mkdir(out,{recursive:true});
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws,id=0,sid;const pending=new Map();
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const next=++id;const t=setTimeout(()=>{pending.delete(next);reject(Error(method));},25000);pending.set(next,{resolve,reject,t});ws.send(JSON.stringify({id:next,method,params,...(sessionId?{sessionId}:{})}));});}
try{let parts;for(let i=0;i<60;i++){try{parts=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break;}catch{await delay(100);}}ws=new WebSocket('ws://127.0.0.1:'+parts[0]+parts[1]);await new Promise(r=>ws.addEventListener('open',r,{once:true}));ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.t);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});const target=await call('Target.createTarget',{url:'about:blank'});sid=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;await call('Page.enable',{},sid);await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sid);
for(const [name,url] of [['linear','https://linear.app/'],['raycast','https://www.raycast.com/'],['apple','https://www.apple.com/apple-intelligence/']]){await call('Page.navigate',{url},sid);await delay(7000);const result=await call('Page.captureScreenshot',{format:'png'},sid);await writeFile(join(out,name+'.png'),Buffer.from(result.data,'base64'));console.log(name+' captured');}
}finally{if(ws?.readyState===1){try{await call('Browser.close');}catch{}ws.close();}edge.kill();for(const p of pending.values())clearTimeout(p.t);}
