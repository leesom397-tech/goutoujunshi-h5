import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';

const cache=new Map();
function load(file){
 const path=resolve(file);if(cache.has(path))return cache.get(path);
 const exports={};cache.set(path,exports);
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 new Function('exports','require',code)(exports,name=>load(resolve(dirname(path),name)+'.ts'));
 return exports;
}
const {validateCaptureBatch,splitCaptureBatch}=load('lib/desktop-capture.ts');
const {momentsOutcome,canContinueMoments,isMacMomentsCacheOnly,momentsRequestScope}=load('lib/capture-moments-outcome.ts');
const {validateCloudCaptureRecord}=load('lib/capture-cloud.ts');
const {bridgeRequest}=load('lib/desktop-bridge-client.ts');
const now=new Date().toISOString();
const row=(text='缓存原文',source={})=>({id:'cache1',kind:'post',sender:'合成好友',senderRole:'other',at:now,text,
 source:{label:'Mac 微信 · 合成好友 · 朋友圈缓存',method:'macos-local-cache',materialRole:'moment',cachedMediaCount:2,sourceRecordId:'123',timePrecision:'source-timestamp',...source}});
const coverage={scope:'local-cache',stopReason:'cache-only',complete:false,recordCount:2,imageOmittedCount:4,unreadableCount:0};
const raw={version:1,kind:'moments',friend:'合成好友',account:'test-owner',capturedAt:now,records:[row(),row('',{sourceRecordId:'124'})],warnings:[],coverage};
const batch=validateCaptureBatch(raw);
assert.equal(batch.records[1].text,'','unread media stays empty, not an invented caption');
assert.equal(batch.coverage.scope,'local-cache');
for(const patch of [{complete:true},{stopReason:'visible-end'},{scope:'all-visible'}])assert.throws(()=>validateCaptureBatch({...raw,coverage:{...coverage,...patch}}),/范围信息/);
for(const source of [{method:'uia'},{cachedMediaCount:0},{cachedMediaCount:101},{cachedMediaCount:'2'},{materialRole:'moments-cover'}]){
 assert.throws(()=>validateCaptureBatch({...raw,records:[row('',source)]}),/空条目/);
}
assert.throws(()=>validateCaptureBatch({...raw,kind:'chat',coverage:undefined,records:[row('')]}),/空条目/);
const chunks=splitCaptureBatch({...raw,records:Array.from({length:1002},(_,i)=>({...row(),id:String(i)})),coverage:{...coverage,recordCount:1002}});
assert.deepEqual(chunks.map(item=>item.coverage.stopReason),['cache-only','cache-only']);
assert.ok(chunks.every(item=>!item.coverage.complete));

const attempt={startedAt:Date.now(),received:0,allVisible:false,libraryId:'test-library'};
const cached=momentsOutcome(batch,attempt);
assert.equal(cached.status,'partial');
assert.equal(canContinueMoments({...attempt,...cached}),true);
assert.match(cached.detail,/已保存本机加载过/);
assert.match(cached.detail,/4 项图片或视频未读取/);
assert.doesNotMatch(cached.detail,/重试|已确认采集到/);
const empty=momentsOutcome({...batch,records:[],coverage:{...coverage,recordCount:0}},attempt);
assert.equal(empty.status,'empty');assert.match(empty.detail,/先在 Mac 微信打开并浏览/);assert.doesNotMatch(empty.detail,/重试/);
assert.equal(momentsOutcome(batch,attempt,true).status,'running');

const win={platform:'win32',capabilities:{moments:true,momentsAllVisible:true,personBundle:true}};
const mac={platform:'darwin',capabilities:{moments:true,momentsCached:true,momentsAllVisible:false,personBundle:false}};
assert.equal(isMacMomentsCacheOnly(mac),true);
assert.deepEqual(momentsRequestScope(mac,true),{cacheOnly:true,allVisible:false,actionLabel:'导入已加载的朋友圈'});
assert.deepEqual(momentsRequestScope(win,true),{cacheOnly:false,allVisible:true,actionLabel:'导入全部可见朋友圈'});
assert.equal(isMacMomentsCacheOnly({...win,capabilities:mac.capabilities}),false,'never narrow Windows because of a stray capability');
assert.equal(isMacMomentsCacheOnly({platform:'darwin',capabilities:{moments:true}}),false,'unknown helper is not a cache promise');
const windowsBatch=validateCaptureBatch({...raw,records:[row('Windows 原文',{method:'uia'})],coverage:{scope:'all-visible',stopReason:'visible-end',complete:true,recordCount:1,imageOmittedCount:0,unreadableCount:0}});
assert.equal(momentsOutcome(windowsBatch,{...attempt,allVisible:true}).status,'complete');

const cloud=validateCloudCaptureRecord({...row('',{rawPath:'/private/secret',key:'private-key',url:'https://secret.invalid/?token=secret'}),
 localId:'test-local',firstCapturedAt:now,lastCapturedAt:now,imageCount:0});
assert.equal(cloud.source.cachedMediaCount,2);assert.equal(cloud.source.sourceRecordId,'123');assert.equal(cloud.source.timePrecision,'source-timestamp');
for(const field of ['rawPath','key','url'])assert.equal(cloud.source[field],undefined);
assert.equal(validateCaptureBatch({...raw,records:[cloud]}).records[0].text,'','cross-device round trip accepts only the same unread-media metadata');

const originalFetch=globalThis.fetch;
try{
 for(const health of [mac,win]){
  globalThis.fetch=async()=>new Response(JSON.stringify({version:'test',ready:true,...health}),{status:200,headers:{'Content-Type':'application/json'}});
  const received=await bridgeRequest('/health');
  assert.equal(received.platform,health.platform);assert.deepEqual(received.capabilities,health.capabilities);
 }
}finally{globalThis.fetch=originalFetch;}

const page=readFileSync('app/capture/page.tsx','utf8');
assert.match(page,/data-mac-moments-scope/,'cache scope explanation must be visible before the import action');
assert.match(page,/isMacMomentsCacheOnly\(status\)&&!macCachedMoments&&!resume/,'newly discovered Mac must stop for the newly displayed scope, not silently downgrade');
assert.match(page,/momentsRequestScope\(health,personImporting.current \|\| allVisibleMoments\)\.allVisible/,'request scope uses the same capability policy as the action label');
assert.match(page,/导入聊天与已加载朋友圈/);
assert.match(page,/data-mac-cache-preview/);
console.log('PASS Mac cache scope, unread-media round trip, native health retention, explicit action boundary, and unchanged Windows completion.');
