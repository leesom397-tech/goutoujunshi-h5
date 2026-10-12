// Controlled synthetic model promises only: no network or production data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { setImmediate as flush } from "node:timers/promises";
import ts from "typescript";
import { mapBoundedTasks } from "../lib/bounded-task-pool.mjs";

const nativeRequire = createRequire(import.meta.url);
function load(file, mocks, cache = new Map()) {
  const path = resolve(file);
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} }; cache.set(path, module);
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = id => {
    if (id in mocks) return mocks[id];
    if (!id.startsWith(".") && !id.startsWith("@/")) return nativeRequire(id);
    let next = id.startsWith("@/") ? resolve(id.slice(2)) : resolve(dirname(path), id);
    if (!/\.[cm]?[jt]s$/.test(next)) next += ".ts";
    return load(next, mocks, cache);
  };
  new Function("require", "module", "exports", code)(require, module, module.exports);
  return module.exports;
}

let calls=[];
const ocr={layout:'wechat-one-to-one',lines:[['left','text','周日三点见。'],['right','text','好的。']],chatTitle:'合成测试'};
const screenshot=load('lib/crush/screenshot.ts',{
 '@/lib/knowledge':{selectKnowledge:()=>[]},
 './provider':{normalizeQwenAnnotations:(rows,lines)=>lines.map((line,index)=>({lineId:line.id,emotion:[],intent:[],evidence:'limited',note:'合成解释'}))},
 '@/lib/qwen':{parseQwenJson:JSON.parse,qwenPublicError:()=>'',qwenChat:async(messages,options)=>{calls.push({messages,options});return options.vision?JSON.stringify(ocr):JSON.stringify({annotations:(JSON.parse(messages.at(-1).content).targetIndices || [0,1]).map(()=>[[],[],'limited','合成解释']),judgment:'见面时间已确认',nextStep:'等待见面',shouldReply:false,replyOptions:[]});}}
});
const recognized=await screenshot.readScreenshotQuickData('data:image/png;base64,AA==','right',undefined,undefined,'recognition');
assert.deepEqual(recognized.raw,ocr);
assert.equal(recognized.text,'');
assert.ok(calls[0].messages[0].content.includes('不生成判断'));
assert.ok(calls[0].messages[1].content.includes('sticker'),'retain media fidelity instructions');
// Last message from other, but explicit waiting decision must not trigger a
// second text-model request. Unspecified decisions retain the existing check.
ocr.lines[1][0]='left';
await screenshot.readScreenshotFromQuick(ocr,'right',[],'');
assert.equal(calls.length,2,'one OCR request and one complete analysis request');
const before=calls.length;
const split=await screenshot.readScreenshotFromQuick(ocr,'right',[],'',26000,undefined,4,undefined,true);
assert.equal(calls.length-before,2,'summary and annotations have independent calls');
assert.deepEqual(JSON.parse(calls[before].messages.at(-1).content).targetIndices,[],'long summary starts first');
assert.deepEqual(split.prepared.lines.map(line=>line.text),ocr.lines.map(line=>line[2]),'split retains every original quote in order');
const source=readFileSync('lib/social-profile-jobs.mjs','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export class ','class ').replaceAll('export async function ','async function ');
const memory=new Map(),storage={get:async key=>structuredClone(memory.get(key)),put:async(key,value)=>memory.set(key,structuredClone(value)),delete:async key=>memory.delete(key)};
const Jobs=new Function('DurableObject','app','finishCreditTask','reserveCredits','CREDIT_PRICES','requestOwner','isWebApi','webSessionCookie',source+';return SocialProfileJobs;')(class{constructor(ctx,env){this.ctx=ctx;this.env=env}}, {},()=>{},()=>{},{},()=>{},()=>{},()=>{});
const job={taskId:'fixture',kind:'chat',ownerId:'fixture-owner',status:'running',expiresAt:Date.now()+60000,requestIds:['image-one'],completedCount:0};
memory.set('job:fixture',job);
const jobs=new Jobs({storage},{WECHAT_CALLBACK_TOKEN:'fixture-token'});
await assert.rejects(jobs.screenshotCheckpoint('fixture','image-one','fixture-owner','wrong',{phase:'ocr'}),/DENIED/);
await assert.rejects(jobs.screenshotCheckpoint('fixture','image-one','other-owner','fixture-token'),/STALE/);
await assert.rejects(jobs.screenshotCheckpoint('fixture','old-image','fixture-owner','fixture-token'),/STALE/);
await jobs.screenshotCheckpoint('fixture','image-one','fixture-owner','fixture-token',{phase:'text_analysis',raw:ocr});
assert.deepEqual((await jobs.screenshotCheckpoint('fixture','image-one','fixture-owner','fixture-token')).raw,ocr,'retry reuses exact transcript');
await jobs.screenshotCheckpoint('fixture','image-one','fixture-owner','fixture-token',{phase:'save'});
assert.deepEqual((await jobs.screenshotCheckpoint('fixture','image-one','fixture-owner','fixture-token')).raw,ocr,'phase updates preserve OCR');
await jobs.removePayload(job);
assert.equal(memory.has('screenshot:fixture:image-one'),false,'terminal cleanup deletes OCR');
console.log('PASS recognition-only OCR, explicit waiting avoids redundant call, owner-bound retry cache and cleanup');
