import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
let now=1000, aborted=0;
const calls=[], module={exports:{}};
new Function('module','require','wx','Date',readFileSync('miniapp/lib/api.js','utf8'))(module,()=>({}),{
  request(options){calls.push(options);return {abort(){aborted++;}};}
},{now:()=>now});
const api=module.exports;
const stuck=api.request('/api/miniapp/screenshot/batch','POST',{taskId:'synthetic',uploadAction:'part'},'synthetic');
const rejected=assert.rejects(stuck,/重新核对后台任务进度/);
const normal=api.request('/api/miniapp/session','GET',null,'synthetic');
assert.equal(await api.releaseStalledUploads(),0,'in-time upload must not be cancelled');
now+=13000;
assert.equal(await api.releaseStalledUploads(),1);
await rejected;
assert.equal(aborted,1,'only scoped upload handle aborted');
calls[0].success({statusCode:200,data:{received:[0]}}); // stale late callback cannot revive promise
assert.equal(await api.releaseStalledUploads(),0,'release is idempotent');
calls[1].success({statusCode:200,data:{linked:true}});
assert.deepEqual(await normal,{linked:true},'unrelated request unaffected');
const fresh=api.request('/api/miniapp/screenshot/batch','POST',{taskId:'synthetic',uploadAction:'init'},'synthetic');
calls[2].success({statusCode:200,data:{status:'uploading',received:[0]}});
assert.deepEqual((await fresh).received,[0]);
console.log('PASS: foreground releases only overdue upload requests, rejects stuck promise once, ignores late response, preserves unrelated requests');
for (const path of ['/api/miniapp/social-profile','/api/miniapp/screenshot/batch']) {
  const oldIndex=calls.length;
  const waiting=api.request(path+'?taskId=synthetic','GET',null,'synthetic');
  const failure=assert.rejects(waiting,/重新核对后台任务进度/);
  api.markRequestsBackgrounded();
  const freshIndex=calls.length;
  const active=api.request(path+'?taskId=synthetic','GET',null,'synthetic');
  assert.equal(await api.releaseStalledUploads(),1,'return releases only requests that crossed background, before native timeout');
  await failure;
  calls[oldIndex].success({statusCode:200,data:{status:'running'}});
  calls[freshIndex].success({statusCode:200,data:{status:'done'}});
  assert.equal((await active).status,'done');
  assert.equal(await api.releaseStalledUploads(),0);
}
console.log('PASS: returning from background releases stuck social/chat status queries, leaves new requests alone and retrieves existing results');
