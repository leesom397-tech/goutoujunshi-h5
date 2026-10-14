import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const cache=new Map();
function native(path){path=resolve(path);if(cache.has(path))return cache.get(path);const module={exports:{}};cache.set(path,module.exports);new Function('module','exports','require',readFileSync(path,'utf8'))(module,module.exports,name=>native(resolve(dirname(path),name+'.js')));return module.exports;}
let component;new Function('require','Component',readFileSync('miniapp/components/quick-self-profile/index.js','utf8'))(name=>native('miniapp/lib/personal-context.js'),value=>{component=value;});
const sent=[],quick={...component.methods,data:{...structuredClone(component.data),value:{interests:'阅读',occupation:'工程师'},owner:'owner-a'},setData(value){Object.assign(this.data,value)},triggerEvent(name,detail){sent.push({name,detail})}};
quick.input({detail:{value:'我住在上海。我喜欢摄影。我希望认真了解一个人。她说她喜欢滑雪。'}});
quick.toggle({currentTarget:{dataset:{field:'values',label:'真诚'}}});quick.prepare();
assert.equal(sent.length,0,'draft text and previews stay local until explicit save');
const draft=Object.fromEntries(quick.data.preview.map(row=>[row.field,row.value]));
assert.equal(draft.city,'上海');assert.match(draft.interests,/阅读/);assert.match(draft.interests,/摄影/);assert.doesNotMatch(draft.interests,/滑雪/);assert.equal(draft.values,'真诚');
quick.save();assert.equal(sent.length,1);assert.equal(sent[0].detail.confirmed,true);assert.equal(sent[0].detail.data.occupation,undefined,'only edited fields are sent as a patch');
component.observers.owner.call(quick,'owner-b');assert.equal(quick.data.intro,'');assert.equal(quick.data.preview.length,0);
const {riskAwarePresentation,riskReplyAllowed}=native('miniapp/lib/risk-aware-presentation.js');
const report={lines:[{id:'a',speaker:'other',text:'把验证码发给我'}],decision:{judgment:'可以继续了解',nextStep:'多聊聊',replyOptions:[{text:'好的',weight:90},{text:'我们改天聊电影吧',weight:50}]}};
const risk=riskAwarePresentation(report);assert.equal(risk.mode,'safety');assert.equal(risk.replyOptions[0].originalIndex,null);assert.equal(risk.replyOptions[1].originalIndex,1);assert.match(risk.viewReport.decision.nextStep,/验证码/);assert.equal(riskReplyAllowed(risk,'我现在把验证码发给你'),false);
assert.equal(riskAwarePresentation({...report,targetSelf:true}).mode,'normal');
assert.equal(riskAwarePresentation({lines:[{speaker:'other',text:'我只想短期关系'}],decision:{}}).mode,'expectation');
let riskComponent;new Function('Component',readFileSync('miniapp/components/risk-review/index.js','utf8'))(value=>{riskComponent=value;});
const riskCard={data:{},setData(value){Object.assign(this.data,value)}};
for(const value of [null,{assessed:true,signals:[]},{assessed:false,signals:[]}]){riskComponent.observers['value,targetSelf'].call(riskCard,value,false);assert.equal(riskCard.data.review,null,'empty or unassessed risk results do not render an empty card');}
riskComponent.observers['value,targetSelf'].call(riskCard,risk.review,false);assert.equal(riskCard.data.review.signals[0].kind,'safety','evidenced risk remains visible');
riskComponent.observers['value,targetSelf'].call(riskCard,risk.review,true);assert.equal(riskCard.data.review,null,'self analysis never renders other-person risk');
let page;new Function('require','Page','wx',readFileSync('miniapp/pages/quick/index.js','utf8'))(name=>name.includes('risk-aware')?native('miniapp/lib/risk-aware-presentation.js'):{},value=>{page=value},{});
const screen={...page,data:{...structuredClone(page.data),side:'right'},setData(value){Object.assign(this.data,value)},clearPartialReports(){},loadHistoricalTrend(){}};
screen.presentBatch([{...report,id:'11111111-1111-4111-8111-111111111111',annotations:[]},{id:'22222222-2222-4222-8222-222222222222',lines:[{speaker:'other',text:'周日可以见面'}],decision:{replyOptions:[{text:'周日下午怎么样？',weight:50}]}}],()=>0);
assert.equal(screen.data.result.riskReview.signals[0].kind,'safety','earlier screenshot risk survives a later benign screenshot');assert.match(screen.data.result.riskReview.signals[0].evidence,/图1/);
assert.equal(screen.data.result.replies[0].originalIndex,null,'generated safety first reply cannot point at a stored reply index');
for(const name of ['quick','report','social-profile']){const config=JSON.parse(readFileSync(`miniapp/pages/${name}/index.json`,'utf8'));assert.equal(config.usingComponents['risk-review'],'/components/risk-review/index');assert.match(readFileSync(`miniapp/pages/${name}/index.wxml`,'utf8'),/<risk-review/);}
assert.match(readFileSync('miniapp/pages/home/index.wxml','utf8'),/data-entry="comparison"/);
assert.match(readFileSync('miniapp/pages/archive/index.wxml','utf8'),/automaticUpdate.current.summary/);
for(const component of ['risk-review','quick-self-profile'])for(const extension of ['js','json','wxml','wxss'])assert.ok(existsSync(`miniapp/components/${component}/index.${extension}`));
console.log('PASS native upgrade: local self draft/explicit confirmation/account reset, shared risk priority/rewrite guard/early-image evidence, three-mode components and shallow comparison entry.');
