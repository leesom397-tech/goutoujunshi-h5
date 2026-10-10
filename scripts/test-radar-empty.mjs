import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const labels=["主动表达","回应承接","回应扩展","邀约兑现","边界尊重","互惠稳定"];
let texts=[],arcs=0,fills=0;
const ctx={clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},setStrokeStyle(){},stroke(){},setFillStyle(){},fill(){fills++;},arc(){arcs++;},setTextAlign(){},setFontSize(){},fillText(text){texts.push(text);},draw(){}};
const module={exports:{}};
new Function("module","wx",readFileSync("miniapp/lib/radar.js","utf8"))(module,{createCanvasContext:()=>ctx});
for(const rows of [[],undefined,null]) {
  texts=[];arcs=0;fills=0;
  module.exports.drawRadar({},"interaction",rows,labels);
  assert.deepEqual(texts.filter((_,i)=>i%2===0),labels);
  assert.equal(texts.filter(text=>text==="待了解").length,6);
  assert.equal(arcs,0);assert.equal(fills,0,"unknown values must not produce a filled zero polygon");
}
texts=[];arcs=0;fills=0;
module.exports.drawRadar({},"interaction",[{label:"明确的自定义维度",value:0},{value:NaN},{value:Infinity},{score:50},{value:-1},{value:101}],labels);
assert.equal(texts[0],"明确的自定义维度");
assert.equal(texts[1],"0","a real zero must not become unknown");
assert.equal(texts.filter(text=>text==="待了解").length,4);
assert.equal(arcs,2);assert.equal(fills,2,"only the two known points are filled, not a complete polygon");
console.log("PASS: empty radar retains axis meanings, missing/invalid values unscored, partial points and real zero preserved");
