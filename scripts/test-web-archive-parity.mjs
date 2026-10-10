import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url), cache=new Map();
function load(path){
 path=resolve(path);if(cache.has(path))return cache.get(path);
 const exports={};cache.set(path,exports);
 const compiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 new Function('require','exports',compiled)(name=>{
  if(name.endsWith('.module.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
  if(name.endsWith('.css'))return {};
  if(name.startsWith('@/')||name.startsWith('.')){const target=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(path),name);return load([target,target+'.ts',target+'.tsx'].find(existsSync));}
  return require(name);
 },exports);return exports;
}
const {personDisplayData}=load('app/archive/types.ts');
const person={id:'A',label:'甲',city:'杭州',updatedAt:1};
const fact=(field,value,status='pending',subjectId='A')=>({id:field+value,subjectId,kind:'subjectBasic:'+field,value,status,source:'截图',evidence:'明确原文'});
const original=[fact('ageRange','31岁'),fact('ageRange','28岁','accepted'),fact('city','上海'),fact('occupation','工程师','accepted'),fact('lifestyle','只属于其他人','accepted','B')];
const display=personDisplayData(person,original);
assert.equal(display.ageRange,'待确认 · 31岁');assert.equal(display.city,'杭州');assert.equal(display.occupation,'工程师');assert.equal(display.lifestyle,undefined);assert.equal(person.ageRange,undefined);assert.equal(original[0].status,'pending');
const {ArchiveRadar,ArchiveTrend}=load('components/ArchiveCharts.tsx');
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const partial=render(ArchiveRadar,{rows:[{label:'主动',value:0},{label:'回应',value:72}]});
assert.equal((partial.match(/<text /g)||[]).length,6,'all six axes remain present');assert.equal((partial.match(/class="cz-chart-dot"/g)||[]).length,2,'zero is an observed score');assert.equal((partial.match(/<strong>待了解<small>/g)||[]).length,4,'missing axes stay unknown');assert.ok(!partial.includes('class="cz-radar-area"'),'incomplete data must not draw an area polygon');
const invalid=render(ArchiveRadar,{rows:[{label:'无效',value:NaN},{label:'超限',value:120},{label:'无限',value:Infinity}]});assert.ok(!invalid.includes('class="cz-data-chart'),'invalid scores must not produce a chart');
const full=render(ArchiveRadar,{rows:Array.from({length:6},(_,i)=>({label:'维度'+i,value:60}))});assert.ok(full.includes('class="cz-radar-area"'));
const timeline=Array.from({length:10},(_,i)=>({reportId:'r'+i,eventStart:`2026-10-${String(i+1).padStart(2,'0')}`,axisLabel:`D${i+1}`,score:50,connectPrevious:i>0,previousReportId:'r'+(i-1)}));
const trend=render(ArchiveTrend,{points:timeline});assert.equal((trend.match(/class="cz-chart-dot"/g)||[]).length,8);assert.ok(!trend.includes('>D1<'));assert.ok(trend.includes('>D10<'));assert.equal((trend.match(/class="cz-trend-line"/g)||[]).length,7);
const gap=render(ArchiveTrend,{points:[{...timeline[0],score:45},{...timeline[1],score:null},{...timeline[2],score:65}]});assert.ok(gap.includes('待了解'));assert.ok(!gap.includes('class="cz-trend-line"'),'unknown scores break trend segments');
const mismatch=render(ArchiveTrend,{points:[timeline[0],{...timeline[1],previousReportId:'different'}]});assert.ok(!mismatch.includes('class="cz-trend-line"'),'unrelated records cannot be connected');
const {cleanMomentsReport}=load('lib/moments-report.ts');
const {MomentsReportView}=load('components/ArchiveInsights.tsx');
const report=cleanMomentsReport({summary:'来自真实分类的统计',posts:[{date:'10月1日',content:'旅行记录',evidence:'图1',contentTags:['旅行'],copyTags:['生活记录'],selfie:'yes'},{date:'10月2日',content:'一张照片',evidence:'图2',contentTags:[],copyTags:[],selfie:'no'},{date:'10月3日',content:'模糊图片',evidence:'图3',contentTags:[],copyTags:[],selfie:'unknown'}]});
const markup=render(MomentsReportView,{report});for(const label of ['已识别去重 3 条','1 条可分类，2 条未分类','文案表达：1 条可分类文案','1 / 2 条可判断动态（50%）','另有 1 条无法判断'])assert.ok(markup.includes(label),label);
const unknown=render(MomentsReportView,{report:cleanMomentsReport({summary:'未知样本',posts:[{date:'未知',content:'模糊',evidence:'图1'}]})});assert.ok(unknown.includes('尚无可判断的动态'));assert.ok(!unknown.includes('（%）'));
console.log('PASS: newest evidence precedence, scoped pending labels, six-axis unknowns, zero/invalid chart guards, eight-date trend gaps, complete moments denominators and unknown selfie handling.');
