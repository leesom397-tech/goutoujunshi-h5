import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const cache=new Map();function native(path){path=resolve(path);if(cache.has(path))return cache.get(path);const module={exports:{}};new Function('module','exports','require',readFileSync(path,'utf8'))(module,module.exports,id=>native(resolve(dirname(path),id+'.js')));cache.set(path,module.exports);return module.exports;}
const entry=native('miniapp/lib/analysis-entry.js'),prices={analysisSingle:5,analysisSmall:10,analysisMedium:15,analysisLarge:20};
const id='22222222-2222-4222-8222-222222222222';
function setup(kind){
 const storage=new Map([['session',{token:'old-token',expiresAt:Date.now()+60000}]]),calls=[];let definition,sessionCalls=0;
 const api={STORAGE:'session',BACKGROUND_BATCH:true,pendingUpload:()=>null,finishUpload:async()=>{},session:async()=>{sessionCalls++;return {token:storage.get('session').token,state:{subjects:[],screenshot:{enabled:true,selfSide:'right'}}}},request:async(path,method,body,token)=>{calls.push({path,token});if(path===entry.CREDIT_PATH)return{prices,priceVersion:entry.VERSION};throw Object.assign(Error('报告不属于这个账号'),{status:404});}};
 const wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,v)=>storage.set(key,v),removeStorageSync:key=>storage.delete(key)};
 new Function('require','Page','wx',readFileSync('miniapp/pages/'+kind+'/index.js','utf8'))(name=>name.endsWith('/api')?api:native(resolve('miniapp/pages',kind,name+'.js')),v=>definition=v,wx);
 const page={...definition,data:{...structuredClone(definition.data),phase:'ready',token:'old-token',result:{reportId:'old-private-report'},people:[{id:'old-person',label:'旧人物'}],personIndex:0},_token:'old-token',_loaded:true,_selectedSubject:'',_entry:{},setData(next,done){for(const [key,v]of Object.entries(next)){const keys=key.split('.');let target=this.data;while(keys.length>1)target=target[keys.shift()];target[keys[0]]=v;}done?.();}};
 return {page,storage,api,calls,sessionCalls:()=>sessionCalls,change(){storage.set('session',{token:'new-token',expiresAt:Date.now()+60000});storage.delete('chat-analysis-task');storage.delete('social-profile-task');}};
}
for(const kind of ['quick','social-profile']){
 const t=setup(kind);await t.page.onShow();await Promise.resolve();assert.equal(t.sessionCalls(),0,kind+' normal return does not authenticate again');assert.equal(t.page.data.result.reportId,'old-private-report');
 t.change();const returning=t.page.onShow();assert.notEqual(t.page.data.result?.reportId,'old-private-report',kind+' clears private result synchronously');assert.equal(t.page.data.people.some(p=>p.id==='old-person'),false);await returning;await Promise.resolve();assert.equal(t.sessionCalls(),1);assert.equal(kind==='quick'?t.page.data.token:t.page._token,'new-token');assert.equal(t.calls.at(-1).token,'new-token');
}
{
 const t=setup('quick');let finish;const deferred=new Promise(resolve=>finish=resolve);t.storage.set('chat-analysis-task',{taskId:id});t.api.waitForJob=async()=>deferred;const old=t.page.resumeBackground();await Promise.resolve();t.change();await t.page.onShow();finish({entries:[{id,lines:[{id:'l',speaker:'other',text:'旧账号私密消息'}],decision:{}}]});await old;assert.notEqual(t.page.data.result?.reportId,id);assert.doesNotMatch(JSON.stringify(t.page.data.result),/旧账号私密消息/);assert.equal(t.page.data.busy,false);
}
{
 const t=setup('social-profile');let finish;const deferred=new Promise(resolve=>finish=resolve),request=t.api.request;t.api.request=async(path,method,body,token)=>path.includes('?taskId=')?deferred:request(path,method,body,token);const old=t.page._resumeTask(id);await Promise.resolve();t.change();await t.page.onShow();finish({status:'done',result:{summary:'旧账号私密动态'},target:'other',totalCount:1});await old;assert.equal(t.page.data.result,null);assert.equal(t.page.data.busy,false);assert.equal(t.page.data.analysisPreview,null);
}
{
 const t=setup('social-profile');let finish;const deferred=new Promise(resolve=>finish=resolve);t.page._savedReportId=id;t.api.request=async(path,method,body,token)=>token==='old-token'?deferred:Promise.reject(Object.assign(Error('新账号无权读取'),{status:404}));const old=t.page.loadSavedReport();await Promise.resolve();t.change();await t.page.onShow();finish({reportId:id,kind:'moments',report:{summary:'旧账号私密已存报告'}});await old;assert.equal(t.page.data.result,null);assert.match(t.page.data.error,/新账号无权读取/);
}
console.log('PASS miniapp account-return: unchanged token adds no authentication; account switch clears old people/results; late quick/social jobs and saved reports cannot repaint into new account. Synthetic services only.');
