import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code=ts.transpileModule(readFileSync('components/web-analysis/InsightExplorer.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const module={exports:{}};
new Function('require','module','exports',code)(()=>({}),module,module.exports);
const data=module.exports.insightExplorerData;
const focus=module.exports.insightFollowupFocus;

assert.deepEqual(data({},'chat').counts,{self:0,other:0,unknown:0});
assert.equal(data({},'social').coverage,null);
assert.equal(data({decision:{interactionInsight:{label:'不能凭标签补全',interpretation:'没有观察依据'}}},'chat').insights.length,0);
const chat=data({lines:[{speaker:'self',text:'原话A'},{speaker:'other',text:'原话B'},{speaker:'unknown',text:'不确定身份'},{speaker:'alien',text:'异常侧'},{speaker:'self',text:'  '},null],decision:{interactionInsight:{label:'合成假设',observed:'明确原话依据',interpretation:'待验证推测',alternative:'另一解释',verify:'具体观察'}}},'chat');
assert.deepEqual(chat.counts,{self:1,other:1,unknown:2});
assert.equal(chat.lines.length,4,'only readable messages enter the denominator');
assert.equal(chat.insights.length,1);
const social=data({moments:{summary:'合成摘要',hypotheses:[{title:'有据',evidence:'材料原文',possibility:'一种可能',alternative:'另一可能'},{title:'重复',evidence:'另一引用',possibility:'一种可能'},{title:'空证据',evidence:'',possibility:'没有依据'}]},fit:[{dimension:'甲',score:0},{dimension:'乙',score:null},{dimension:'丙',score:NaN},{dimension:'丁',score:101}]},'social');
assert.equal(social.insights.length,1,'duplicate or unsupported hypotheses are excluded');
assert.equal(social.insights[0].verify,'','missing verification is never manufactured');
assert.deepEqual(social.coverage,{known:1,total:4},'zero is a valid reference; invalid and missing scores remain unknown');
assert.equal(social.lines.length,0);
assert.equal('probability' in chat.insights[0],false,'no made-up confidence or probability');
for(const action of ['verify','alternative','wording']){
 const value=focus(chat.insights[0],'observed',action);
 assert.ok(value.title.includes('观察依据'));
 assert.ok(value.summary.includes('所选内容：明确原话依据'));
 assert.ok(value.summary.includes('不是已确认的人物事实'));
 assert.ok(value.question.includes('合成假设'));
 assert.ok(value.summary.length<=900);
}
const socialFocus=focus(social.insights[0],'alternative','wording');
assert.ok(socialFocus.summary.includes('所选内容：另一可能'));
assert.equal(socialFocus.summary.includes('验证观察：'),false,'missing observations cannot be fabricated for a follow-up');
assert.ok(socialFocus.question.includes('如果现在不适合发消息'));
const longFocus=focus({title:'题'.repeat(100),observed:'观察'.repeat(500),interpretation:'推测'.repeat(500),alternative:'替代'.repeat(500),verify:'验证'.repeat(500)},'verify','verify');
assert.ok(longFocus.summary.includes('所选内容：验证'));
assert.ok(longFocus.summary.length<=900,'chosen evidence fits the shared handoff budget');
console.log('PASS: insight evidence boundaries, actual readable-message denominators, unknown speakers, valid zero values and absent data.');
console.log('PASS: focused handoffs preserve the selected step, real evidence and uncertainty; missing verification stays absent.');
