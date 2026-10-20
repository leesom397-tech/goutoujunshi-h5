import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const cache=new Map();
function native(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m={exports:{}};cache.set(path,m.exports);new Function('module','exports','require',readFileSync(path,'utf8'))(m,m.exports,name=>native(resolve(dirname(path),name+'.js')));cache.set(path,m.exports);return m.exports;}
const entry=native('miniapp/lib/analysis-entry.js');
const prices={analysisSingle:5,analysisSmall:10,analysisMedium:15,analysisLarge:20,profile:30,text:5};
for(const [n,amount] of [[1,5],[2,10],[3,10],[4,15],[6,15],[7,20],[9,20]])assert.deepEqual(entry.screenshotQuote(n,prices),{version:entry.VERSION,amount});
assert.throws(()=>entry.screenshotQuote(10,prices));assert.throws(()=>entry.validatePrices({priceVersion:'old',prices}));
const person='11111111-1111-4111-8111-111111111111',parent='22222222-2222-4222-8222-222222222222',report='33333333-3333-4333-8333-333333333333';
const people=[{id:person,label:'合成人物'},{id:report,label:'另一个人'}];
assert.ok(entry.context({subjectId:person,returnReportId:'https://foreign'}).error);
await assert.rejects(entry.verifyContext(entry.context({subjectId:person,returnReportId:parent}),{request:async()=>({reportId:parent,subjectId:report})},'token',people),/不一致/);
for (const original of [{analysisScope:'screenshots'},{analysisScope:'fullHistory',partial:true},{analysisScope:'fullHistory',targetSelf:true}]) await assert.rejects(entry.verifyContext(entry.context({subjectId:person,returnReportId:parent}),{request:async()=>({reportId:parent,subjectId:person,report:original})},'token',people),/已完成的完整报告/);
const storage=new Map([['session',{token:'native-test',expiresAt:Date.now()+60000}]]),navigation=[],uploads=[];
let mismatched=false;
const api={STORAGE:'session',BACKGROUND_BATCH:true,pendingUpload:()=>null,newId:async()=>report,
 session:async()=>({token:'native-test',state:{subjects:people,screenshot:{enabled:true,selfSide:'right'}}}),
 request:async(path,method,body)=>{if(path===entry.CREDIT_PATH)return{prices,priceVersion:entry.VERSION};if(path.startsWith('/api/miniapp/report?'))return{reportId:parent,subjectId:mismatched?report:person,report:{analysisScope:'fullHistory'}};if(path.endsWith('/settings'))return{};throw Error('unexpected '+path);},
 createUpload:async(path,images,parameters)=>{uploads.push({path,images,parameters});return{taskId:report};},
 resumeUpload:async()=>{throw Object.assign(Error('合成暂停'),{status:400});},finishUpload:async()=>{},setCurrentSubject(){}};
const wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),navigateTo:options=>navigation.push(options.url),pageScrollTo(){},
 chooseMedia:options=>options.success({tempFiles:[{tempFilePath:'/fake/image.png',size:1000}]}),getImageInfo:options=>options.success({type:'png',width:100,height:100})};
function page(name){let definition;new Function('require','Page','wx',readFileSync(`miniapp/pages/${name}/index.js`,'utf8'))(id=>id.endsWith('/api')?api:native(resolve('miniapp/pages',name,id+'.js')),value=>{definition=value;},wx);return{...definition,data:structuredClone(definition.data),setData(value,done){Object.assign(this.data,value);done?.();}};}
const quick=page('quick');quick.onLoad({subjectId:person,returnReportId:parent});await quick.refresh();await quick.loadPrices();
assert.equal(quick.data.personIndex,1);assert.equal(quick.data.supplementLabel,'合成人物');
quick.choose();await new Promise(resolve=>setImmediate(resolve));assert.equal(quick.data.personIndex,1,'choosing new screenshots keeps the original person');
quick.personChange({detail:{value:'2'}});assert.equal(quick.data.personIndex,1,'supplement cannot switch to a different person');
quick.setData({side:'right',agreed:true});await quick.analyze();
assert.deepEqual(uploads.at(-1).parameters.priceConfirmation,{version:entry.VERSION,amount:5});assert.equal(uploads.at(-1).parameters.parentReportId,parent);assert.equal(uploads.at(-1).parameters.subjectId,person);
quick.returnToReport();assert.equal(navigation.at(-1),'/pages/report/index?id='+parent);storage.delete('chat-analysis-task');
quick.reset();assert.equal(quick.data.personIndex,1,'another screenshot batch preserves the explicit person');
mismatched=true;const invalid=page('quick');invalid.onLoad({subjectId:person,returnReportId:parent});await invalid.refresh();assert.equal(invalid.data.phase,'error');assert.match(invalid.data.error,/不一致/);mismatched=false;
const social=page('social-profile');social.onLoad({subjectId:person,returnReportId:parent,materialType:'moments'});await social.onShow();await social.loadPrices();
assert.equal(social.data.materialType,'moments');assert.equal(social.data.personIndex,1);
social.targetChange({currentTarget:{dataset:{target:'self'}}});assert.equal(social.data.targetSelf,false,'a same-person supplement cannot silently become self analysis');
social.setData({images:[{path:'/fake/one.png',type:'png'},{path:'/fake/two.png',type:'png'}],imageCount:2,agreed:true});await social.analyze();
assert.equal(uploads.at(-1).parameters.parentReportId,parent);assert.equal(uploads.at(-1).parameters.subjectId,person);assert.deepEqual(uploads.at(-1).parameters.priceConfirmation,{version:entry.VERSION,amount:10});
social.returnToReport();assert.equal(navigation.at(-1),'/pages/report/index?id='+parent);
const normalRequest=api.request;
for(const kind of ['moments','social']){
 api.request=async()=>({reportId:report,subjectId:person,kind,totalCount:2,report:{analysisScope:'supplement',summary:'新截图补充解释',supplementOf:{reportId:parent,scope:'fullHistory',generatedAt:'2026-10-20T03:00:00Z'}}});
 const savedSocial=page('social-profile');savedSocial.onLoad({reportId:report});await savedSocial.loadSavedReport();assert.equal(savedSocial.data.phase,'ready');assert.equal(savedSocial.data.returnReportId,parent);assert.equal(savedSocial.data.supplementLabel,'合成人物');assert.match(savedSocial.data.parentGeneratedTime,/2026-10-20 11:00/);savedSocial.returnToReport();assert.equal(navigation.at(-1),'/pages/report/index?id='+parent);
}
api.request=normalRequest;
const home=page('home');for(const [entryName,url] of [['library','/pages/library/index'],['affinity','/pages/quick/index?focus=affinity'],['quick','/pages/quick/index'],['social-profile','/pages/social-profile/index'],['voice','/pages/voice/index']]){home.open({currentTarget:{dataset:{entry:entryName}}});assert.equal(navigation.at(-1),url);}
const homeMarkup=readFileSync('miniapp/pages/home/index.wxml','utf8');assert.equal((homeMarkup.match(/class="hero-primary"/g)||[]).length,1);assert.equal((homeMarkup.match(/class="entry-card(?: entry-warm)?"/g)||[]).length,4);
assert.match(homeMarkup,/class="hero-primary" data-entry="library"/);assert.match(readFileSync('miniapp/pages/library/index.wxml','utf8'),/bindtap="toggleOriginals"/);
assert.match(readFileSync('miniapp/pages/quick/index.wxml','utf8'),/原报告保留，不会被覆盖/);assert.match(readFileSync('miniapp/pages/library/index.wxml','utf8'),/手机新截图单独解读，不自动并入旧报告/);
// The full-history screen uses a server quote, never the screenshot price.
const library=page('library');library._generation=1;library._token='native-test';library._unloaded=false;
library.setData({ownerId:'public-owner',library:{id:'cloud-chat',kind:'chat',friend:'合成人物',subjectId:person,epoch:1,total:675},libraries:[{id:'cloud-moments',kind:'moments',subjectId:person,total:94,epoch:1}]});
let consent=false,starts=0,priceChanged=false,reuse=false,quotes=0,failed=false;
wx.showModal=options=>options.success({confirm:consent});
api.request=async(path,method,body)=>{
 if(path.endsWith('/settings'))return{};
 if(path.includes('/capture/analyze?'))return{taskId:report,status:'done',libraryId:'cloud-chat',subjectId:person};
 if(path.endsWith('/capture/analyze')){
  assert.equal(body.expectedOwnerId,'public-owner');assert.equal(body.expectedTotal,675);assert.equal(body.relatedSnapshots[0].expectedTotal,94);
  if(body.quoteOnly){quotes++;assert.equal(body.confirmed,false);if(failed&&body.requestId===report)return{taskId:report,status:'error',creditTaskStatus:'released',creditSettlementPending:false,libraryId:'cloud-chat',subjectId:person};return reuse?{taskId:report,status:'done',libraryId:'cloud-chat',subjectId:person}:{quote:{version:entry.VERSION,amount:40,label:'全部资料 · 501–3000 条'}};}
  starts++;assert.equal(body.confirmed,true);assert.deepEqual(body.priceConfirmation,{version:entry.VERSION,amount:40});
  if(priceChanged)throw Object.assign(Error('需要重新确认费用'),{status:409,details:{code:'PRICE_CONFIRMATION_REQUIRED'}});
  return{taskId:report,status:'done'};
 }
 throw Error('unexpected '+path);
};
await library.loadPrice();const originalQuote=library._quote;assert.equal(library.data.price,40);assert.equal(starts,0);
await library.analyzeAll();assert.equal(starts,0,'cancelled fee modal never creates an analysis');
consent=true;priceChanged=true;await library.analyzeAll();assert.equal(starts,1);assert.equal(library.data.price,null);assert.match(library.data.notice,/重新核价并确认/);
await new Promise(resolve=>setImmediate(resolve));assert.equal(starts,1,'409 never automatically accepts a changed price');
priceChanged=false;reuse=true;await library.analyzeAll();assert.equal(starts,1,'an existing complete report is opened without starting or charging');assert.equal(navigation.at(-1),'/pages/report/index?id='+report);
reuse=false;failed=true;const pendingKey='chengzi_cloud_analysis_v1';storage.set(pendingKey,{signature:originalQuote.signature,requestId:report,ownerId:'public-owner',libraryId:'cloud-chat'});await library.loadPrice();assert.equal(storage.has(pendingKey),false,'confirmed refunded failure retires its old request id');assert.equal(library.data.fullTaskRunning,false);assert.equal(library.data.price,null);
api.newId=async()=>parent;await library.loadPrice();assert.equal(library._quote.requestId,parent,'a user-requested quote after refund can create a fresh attempt');assert.equal(library.data.price,40);assert.equal(starts,1,'retiring a failed task does not automatically start paid work');
storage.set(pendingKey,{signature:originalQuote.signature,requestId:report,ownerId:'public-owner',libraryId:'cloud-chat'});library.failedFullTask({taskId:report,status:'error',creditTaskStatus:'reserved',creditSettlementPending:true});clearTimeout(library._taskTimer);assert.ok(storage.has(pendingKey),'unsettled task retains id and cannot be charged again');assert.equal(library.data.fullTaskRunning,true);library.setData({fullTaskRunning:false});
assert.ok(quotes>=3);storage.set('session',{token:'different-account',expiresAt:Date.now()+60000});const before=quotes;await library.analyzeAll();assert.equal(quotes,before,'account change prevents quoting or analyzing another owner material');
console.log('PASS miniapp intake v2: 7 price boundaries; version rejection; owned same-person parent validation; photo selection/reset/person-lock; chat and Moments upload price/parent parameters; original report return; four home entries and separate full-history scope. All services synthetic.');
