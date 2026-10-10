import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { interactionMetrics, historicalTrend, mergeChatReports, socialPrevious, socialArchiveMaterial, validScore } from '../components/web-analysis/report-data.ts';
const checks=[];
const check=(name,fn)=>{fn();checks.push(name)};
check('missing/media-separated turns never count as full responses or zero samples',()=>{
 const empty=interactionMetrics([]);assert.equal(empty.activeRate,null);assert.equal(empty.replyExpansion,null);
 const result=interactionMetrics([{id:'1',speaker:'self',text:'周末有什么安排？'},{id:'2',speaker:'unknown',text:'身份不清楚'},{id:'3',speaker:'other',text:'一起喝咖啡吗？'}]);assert.equal(result.responseCount,0);assert.equal(result.invitationCount,1);
});
check('source ID overlap is deduplicated; ordinary repeated phrases remain independent',()=>{
 const lines=[{id:'1',speaker:'self',text:'晚上好'},{id:'2',speaker:'other',text:'你好'},{id:'3',speaker:'self',text:'今天好吗？'},{id:'4',speaker:'other',text:'你好'}];
 assert.equal(interactionMetrics([...lines,lines[3]]).otherTurnCount,2);
 assert.equal(interactionMetrics([{speaker:'other',text:'昨天一起喝咖啡，后来取消了'}]).invitationCount,0);
 assert.equal(interactionMetrics([{speaker:'other',text:'不要再联系我'}]).boundary,true);
});
check('trend requires explicitly connected, non-overlapping valid dates and scores',()=>{
 const a={subjectId:'p',reportId:'a',score:42,eventStart:'2026-10-01',eventEnd:'2026-10-02'};
 const b={subjectId:'p',reportId:'b',score:58,eventStart:'2026-10-04',eventEnd:'2026-10-05',previousReportId:'a',connectPrevious:true};
 assert.equal(historicalTrend([a,b],'p','b').delta,16);
 assert.equal(historicalTrend([a,{...b,eventStart:'2026-10-02'}],'p','b').delta,null);
 assert.equal(historicalTrend([a,{...b,eventStart:'2026-02-30'}],'p','b').delta,null);
 assert.equal(historicalTrend([a,{...b,score:null}],'p','b').delta,null);
 assert.equal(historicalTrend([{...b,sourceReportIds:['a']}],'p','a').title,'已记录的互动');
});
check('batch merge keeps every photo and disambiguates annotations with repeated line IDs',()=>{
 const result=mergeChatReports([1,2].map(n=>({id:'r'+n,lines:[{id:'1',speaker:'other',text:'原话'+n}],annotations:[{lineId:'1',note:'依据'+n}],decision:{judgment:'判断'+n,photoClues:[{location:'下方',observation:'线索'+n}]}})));
 assert.equal(result.decision.judgment,'判断2');assert.equal(result.decision.photoClues.length,2);assert.match(result.decision.photoClues[0].location,/图 1/);
 assert.notEqual(result.lines[0].id,result.lines[1].id);assert.equal(result.annotations[1].lineId,result.lines[1].id);assert.equal(result.lines[1].screenshotNumber,2);
});
check('continuation and import retain risk, fit, question and contextual basic fields',()=>{
 const report={summary:'摘要',riskSignals:[{category:'需核实',evidence:'原话',check:'询问',level:'中'}],fit:[{dimension:'边界',selfNeed:'尊重',evidence:'依据',reading:'待核实',conclusion:'先了解',status:'待了解'}],questions:['可以聊聊周末吗？'],visibleFacts:[{title:'兴趣',evidence:'阅读'}],profileBasics:[{field:'city',value:'杭州',evidence:'简介'}],profileContext:[{field:'stage',value:'认识初期',evidence:'自述'}]};
 const prior=socialPrevious(report);assert.equal(prior.riskSignals[0].category,'需核实');assert.equal(prior.fit[0].dimension,'边界');assert.equal(prior.questions.length,1);
 const material=socialArchiveMaterial(report,false);assert.equal(material.basics.length,2);assert.equal(material.candidates[1].title,'关系阶段：认识初期');assert.equal(socialArchiveMaterial(report,true).basics.length,1);
 assert.equal(validScore(null),false);assert.equal(validScore(NaN),false);assert.equal(validScore(0),true);assert.equal(validScore(101),false);
});
const contracts=JSON.parse(await readFile('scripts/analysis-wxml-contract.json','utf8'));
for(const name of ['quick','social-profile','report']){
 const wxml=await readFile(`miniapp/pages/${name}/index.wxml`,'utf8');
 const source=await readFile(`miniapp/pages/${name}/index.js`,'utf8');
 const api={request:async()=>({prices:{analysisSmall:23,analysisMedium:36,analysisLarge:51,text:6,profile:32}})};
 let page;vm.runInNewContext(source,{require:path=>path.endsWith('/api')?api:{},Page:value=>{page=value},wx:{},console,Date,Map,Set,setInterval,clearInterval,setTimeout,clearTimeout});
 page.data=structuredClone(page.data);page.setData=value=>Object.assign(page.data,value);
 check(name+': original WXML event and conditional contracts remain',()=>{
  const remaining=[...wxml.matchAll(/\b(?:bind|catch)[\w:]*="[^"]+"/g)].map(match=>match[0]);
  for(const event of contracts[name].events){const index=remaining.indexOf(event);assert.ok(index>=0,'lost event '+event);remaining.splice(index,1)}
  const conditions=[...wxml.matchAll(/\bwx:(?:if|elif|else|for|key|for-item|for-index)="[^"]*"/g)].map(match=>match[0]);
  for(const condition of contracts[name].conditions){const index=conditions.indexOf(condition);assert.ok(index>=0,'lost condition '+condition);conditions.splice(index,1)}
  for(const match of wxml.matchAll(/\b(?:bind|catch)[\w:]*="(\w+)"/g))assert.equal(typeof page[match[1]],'function','missing handler '+match[1]);
 });
 if(name!=='report'){
  page.data.token='test-token';page._token='test-token';await page.loadPrices();assert.equal(page.data.pricesReady,true);assert.equal(page.data.prices.profile,32);
  api.request=async()=>({prices:{profile:NaN}});await page.loadPrices();assert.equal(page.data.pricesReady,false);assert.ok(page.data.priceError);
  const calls=[];api.request=async(...args)=>{calls.push(args);return {}};page.data.busy=false;page.data.phase='ready';page.data.image='fixture';page.data.images=[{path:'fixture'}];page.data.imageCount=1;page.data.side='right';page.data.agreed=true;await page.analyze();assert.equal(calls.length,0);assert.match(page.data.error,/价格/);
  checks.push(name+': current prices accepted; invalid/missing price blocks a new paid action');
 }
}
console.log('PASS '+checks.length+' parity logic/template checks (synthetic only):\n'+checks.map(name=>' - '+name).join('\n'));
