import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
let tags;
new Function('Component',readFileSync('miniapp/components/signal-tags/index.js','utf8'))(value=>{tags=value;});
const view={data:{},setData(value){Object.assign(this.data,value);}};
tags.observers.tags.call(view,[{label:'平静',probability:.8},{label:'拒绝',key:'refuse',probability:0},{label:'猜测',probability:NaN}]);
assert.deepEqual(view.data.rows.map(row=>row.display),['80%','0%','待判断']);
assert.equal(view.data.rows[1].tone,'caution');
assert.equal(view.data.rows[2].value,null);
tags.observers.tags.call(view,[]); assert.deepEqual(view.data.rows,[]);
const tagsTemplate=readFileSync('miniapp/components/signal-tags/index.wxml','utf8');
assert.match(tagsTemplate,/<text wx:if="\{\{note\}\}" class="note">\{\{note\}\}<\/text>/);
assert.doesNotMatch(tagsTemplate,/bindtap|expanded|<button/,'per-message explanations are always visible');
tags.observers.tags.call(view,{'0':{label:'兴趣',key:'interest',probability:.7},'1':{label:'平静',probability:.3}});
assert.deepEqual(view.data.rows.map(row=>row.display),['70%','30%'],'runtime numeric-key lists retain the actual weights');
for (const bad of [{'1':{label:'gap'}},{foo:{label:'not a list'}},'not an array',null]) {
  tags.observers.tags.call(view,bad); assert.deepEqual(view.data.rows,[]);
}
let busy, serial=0, now=10000;
const timers=new Map();
new Function('Component','setInterval','clearInterval','Date',readFileSync('miniapp/components/busy-indicator/index.js','utf8'))(
  value=>{busy=value;}, fn=>{timers.set(++serial,fn);return serial;},id=>timers.delete(id),{now:()=>now});
const waiting={...busy.methods,data:{},setData(value){Object.assign(this.data,value);}};
busy.lifetimes.attached.call(waiting); assert.equal(timers.size,1);
now=15000;[...timers.values()][0]();assert.equal(waiting.data.seconds,5);
busy.pageLifetimes.hide.call(waiting);assert.equal(timers.size,0);
now=21000;busy.pageLifetimes.show.call(waiting);assert.equal(waiting.data.seconds,11);assert.equal(timers.size,1);
busy.lifetimes.detached.call(waiting);assert.equal(timers.size,0);
const quick=readFileSync('miniapp/pages/quick/index.wxml','utf8'), report=readFileSync('miniapp/pages/report/index.wxml','utf8');
assert.doesNotMatch(quick,/result.compatibility.fitScore/);
assert.match(report,/补充查看 · 最新资料适配/);
for(const template of [quick,report]) {assert.match(template,/<signal-tags/);assert.match(template,/语气与态度/);}
console.log('PASS: visible tag weights, invalid values unscored, always-visible per-message explanations, busy elapsed time and lifecycle cleanup, secondary nonduplicated compatibility');
