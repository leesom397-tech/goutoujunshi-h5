import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {recognitionSnapshot} from '../lib/screenshot-recognition-review.mjs';
import * as reportSupplement from '../lib/report-supplement.mjs';
const module={exports:{}};let settings={consent_at:1,image_consent_at:2,image_self_side:'right'},cache={},ocr=0,analysis=0,fallback=0,budgets=0,saves=0,syntax=false,checkpointDown=false,limitUses=29;
class CrushError extends Error{constructor(message,status){super(message);this.status=status;}}
const raw={layout:'wechat-one-to-one',lines:[['unknown','text','周日见'],['right','unread','']]};
const db={prepare(query){return{bind(){return this},async first(){return query.includes('coach_crush_budget')?{uses:limitUses}:null}}}};
const checkpoint=async(_task,_id,owner,key,update)=>{assert.equal(owner,'fixture-owner');assert.equal(key,'fixture-secret');if(checkpointDown)throw Error('down');if(update)cache={...cache,...update};return {...cache,reviewOnDoubt:true};};
const mocks={
 '@/lib/report-supplement.mjs':reportSupplement,
 '@/app/chatgpt-auth':{getChatGPTUser:async()=>null},'@/db':{getD1:()=>db},
 '@/lib/crush/service':{getSettings:async()=>settings,getThread:async()=>({id:'thread',subject_id:null,data:'[]',channel_key:'fixture'}),reserveBudget:async()=>{budgets++},analyzeLines:async(_owner,text)=>{saves++;return{id:'report',lines:[{text}]}}},
 '@/lib/crush/screenshot':{readScreenshotQuickData:async(_img,_side,_m,_f,mode)=>{assert.equal(mode,'review-recognition');ocr++;return{raw:structuredClone(raw)}},readScreenshotFromQuick:async data=>{analysis++;if(syntax)throw new SyntaxError('synthetic');return{text:data.lines[0][2],count:1,prepared:{},decision:{}}},readScreenshot:async()=>{fallback++;throw Error('must not redo reviewed OCR')}},
 '@/lib/crush/types':{CrushError},'@/lib/profile-context':{loadProfileContext:async()=>''},'@/lib/crush/archive':{suggestScreenshotEvents:async()=>{}},'@/lib/qwen':{qwenPublicError:(_e,msg)=>msg},'@/lib/crush/evidence':{readableReport:x=>x},
 '@/lib/screenshot-recognition-review.mjs':{recognitionSnapshot},'cloudflare:workers':{env:{WECHAT_CALLBACK_TOKEN:'fixture-secret',SOCIAL_PROFILE_JOBS:{idFromName:x=>x,get:()=>({screenshotCheckpoint:checkpoint})}}}
};
new Function('require','exports','module',ts.transpileModule(readFileSync('app/api/crush/screenshot/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(id=>{assert.ok(id in mocks,id);return mocks[id]},module.exports,module);
const request=()=>new Request('http://fixture/api/web/screenshot',{method:'POST',headers:{'content-type':'application/json','x-screenshot-task':'11111111-1111-4111-8111-111111111111','x-screenshot-job-key':'fixture-secret'},body:JSON.stringify({confirmed:true,selfSide:'right',image:'data:image/png;base64,AA==',requestId:'22222222-2222-4222-8222-222222222222',sessionId:'33333333-3333-4333-8333-333333333333'})});
let response=await module.exports.analyzeScreenshot(request(),'fixture-owner');assert.equal(response.status,202);assert.equal((await response.json()).reviewRequired,true);assert.equal(analysis,0);assert.equal(saves,0);assert.equal(ocr,1);assert.equal(budgets,1);
cache={...cache,reviewed:true,raw:{...raw,lines:[['left','text','用户修正原话'],['right','sticker','']]}};
limitUses=30; // Another completed task reaches the limit while this already-reserved OCR waits.
response=await module.exports.analyzeScreenshot(request(),'fixture-owner');assert.equal(response.status,200);assert.equal((await response.json()).lines[0].text,'用户修正原话');assert.equal(ocr,1);assert.equal(budgets,1);assert.equal(saves,1);
syntax=true;response=await module.exports.analyzeScreenshot(request(),'fixture-owner');assert.equal(response.status,503);assert.equal(fallback,0);assert.equal(ocr,1);assert.equal(budgets,1);assert.equal(saves,1,'failed reviewed model result cannot persist or re-OCR');
syntax=false;checkpointDown=true;response=await module.exports.analyzeScreenshot(request(),'fixture-owner');assert.equal(response.status,503);assert.equal(saves,1);assert.equal(ocr,1,'checkpoint failure is closed, never ignores corrected raw');
checkpointDown=false;settings={...settings,image_self_side:'left'};response=await module.exports.analyzeScreenshot(request(),'fixture-owner');assert.equal(response.status,409);assert.equal(saves,1,'review never overrides authorization settings');
console.log('PASS real screenshot route with synthetic models: no full analysis before doubt confirmation, same OCR/budget reused, corrected source survives fallback failure, checkpoint/settings guards.');
