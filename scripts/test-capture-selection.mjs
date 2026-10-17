import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['lib/capture-selection.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {selectPendingCaptureRecords:select}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const row=(i,extra={})=>({localId:'source-'+i,id:'',namespace:'synthetic',firstCapturedAt:'2026-10-15T08:00:00Z',lastCapturedAt:'2026-10-15T08:00:00Z',kind:'text',sender:'合成人物',senderRole:i%2?'self':'other',at:'',text:'合成原文 '+i,source:{label:'合成界面 '+i,method:'uia',order:'oldest-first'},...extra});
const library=(records,extra={})=>({id:'synthetic-library',ownerId:'synthetic-owner',account:'synthetic-wechat',friend:'合成人物',kind:'chat',createdAt:'2026-10-15T08:00:00Z',updatedAt:'2026-10-15T08:00:00Z',records,reportLinks:[],warnings:[],...extra});
const latest=library(Array.from({length:500},(_,i)=>row(i))),original=JSON.stringify(latest);
assert.deepEqual(select(latest).map(r=>r.localId),Array.from({length:40},(_,i)=>'source-'+(460+i)),'latest 40 chosen, returned oldest→newest for analysis');
assert.equal(JSON.stringify(latest),original,'selection must not mutate source order, content or analysis receipts');
const analyzed=library(latest.records,{reportLinks:[{reportId:'existing-report',sourceIds:latest.records.slice(-10).map(r=>r.localId),createdAt:'2026-10-15T09:00:00Z'}]});
assert.deepEqual(select(analyzed).map(r=>r.localId),Array.from({length:40},(_,i)=>'source-'+(450+i)),'already analyzed recent records are skipped, never selected for another automatic charge');
const withMedia=library([...latest.records,row(500,{kind:'image',text:'[图片]'}),row(501,{kind:'sticker',text:'[动画表情]'}),row(502,{kind:'other',text:'[语音]'}),row(503,{kind:'sticker',text:'已经核对过的表情包文字',ocrTextVerified:true})]);
assert.deepEqual(select(withMedia).map(r=>r.localId),[...Array.from({length:39},(_,i)=>'source-'+(461+i)),'source-503'],'unread media placeholders skipped; verified sticker words can be included without treating images as text');
const budgeted=select(latest,rows=>rows.length>3?'本批预算已满':'');
assert.deepEqual(budgeted.map(r=>r.localId),['source-497','source-498','source-499'],'existing per-batch checks limit the newest window before returning original order');
assert.equal(select(library([row(1,{kind:'image',text:'[图片]'})])).length,0);
const posts=library(Array.from({length:20},(_,i)=>row(i,{kind:'post',source:{label:'动态'+i,method:'uia',order:'newest-first'}})),{kind:'moments'});
assert.deepEqual(select(posts).map(r=>r.localId),Array.from({length:12},(_,i)=>'source-'+i),'moments keep newest-first and choose the first 12');
assert.deepEqual(select({...posts,reportLinks:[{reportId:'done',sourceIds:['source-0','source-1','source-2']}]}).map(r=>r.localId),Array.from({length:12},(_,i)=>'source-'+(3+i)));
for(const method of ['screen-capture','video-import']){
 const frames=library(Array.from({length:12},(_,i)=>row(i,{kind:'image',text:'',source:{label:'画面'+i,method,videoTime:i*2},images:[{mime:'image/jpeg',data:'synthetic',name:'frame'}]})));
 assert.deepEqual(select(frames).map(r=>r.localId),Array.from({length:9},(_,i)=>'source-'+i),method+' keeps the original first nine frames');
 assert.deepEqual(select({...frames,reportLinks:[{reportId:'done',sourceIds:['source-0','source-1','source-2']}]}).map(r=>r.localId),Array.from({length:9},(_,i)=>'source-'+(3+i)));
}
assert.deepEqual(select(library([])),[]);
console.log('PASS capture selection: newest40 from500, original submission order, analyzed/media skip, verified text, budget, newest-first moments12 and unchanged window/video9');
