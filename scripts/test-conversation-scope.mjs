import assert from 'node:assert/strict';
import {restoreConversation,fitConversationRequest} from '../lib/web-conversation-state.mjs';
const owner='owner-A',subject='22222222-2222-4222-8222-222222222222',requestId='33333333-3333-4333-8333-333333333333';
const body={mode:'conversation',self:'需要一起比较的未发送问题',other:'',subjectId:null,contextScope:'all',requestId,confirmed:true,history:[]};
const saved={owner,subject:'',contextScope:'all',contextKey:'',mode:'conversation',draft:body.self,other:'',messages:[{role:'assistant',content:'旧整体回答'}],opening:'旧背景',requestId,requestBody:body};
assert.equal(restoreConversation(null,owner).contextScope,'all');
assert.equal(restoreConversation({...saved,contextScope:undefined,requestBody:null},owner).contextScope,'none','old unscoped drafts are never silently upgraded');
assert.equal(restoreConversation({...saved,subject,contextScope:undefined,requestBody:null},owner).contextScope,'person');
assert.equal(restoreConversation(saved,owner).requestBody,body,'same all-scope retry keeps the exact request');
const changed=restoreConversation(saved,owner,{contextScope:'none'});
assert.equal(changed.contextScope,'none');assert.equal(changed.draft,body.self);assert.equal(changed.messages.length,0);assert.equal(changed.opening,'');assert.equal(changed.requestBody,null);
assert.equal(restoreConversation({...saved,requestBody:{...body,contextScope:undefined}},owner).requestBody,null,'scope drift invalidates the previous request identity');
assert.equal(restoreConversation(saved,'owner-B').contextScope,'all');assert.equal(restoreConversation(saved,'owner-B').messages.length,0);
for(const entry of [{subject,contextScope:'person'}, {subject:'',contextKey:'report-self',contextScope:'person'}]){
 const state=restoreConversation(saved,owner,entry);assert.equal(state.contextScope,'person');assert.equal(state.requestBody,null);assert.equal(state.messages.length,0);
}
const corrupt=restoreConversation({...saved,subject,requestBody:{...body,subjectId:subject}},owner);
assert.equal(corrupt.contextScope,'person');assert.equal(corrupt.requestBody,null,'all cannot coexist with a selected subject');
assert.equal(fitConversationRequest(body).contextScope,'all');assert.equal(fitConversationRequest(body).subjectId,null);
console.log('PASS conversation scope: fresh all, legacy isolation, single-person/report handoff, exact retry body, scope-change reset and owner separation.');
