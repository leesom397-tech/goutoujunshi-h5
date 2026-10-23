import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const compiled=await build({entryPoints:['lib/report-moments-value.ts'],bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'});
const mod={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(mod,mod.exports);
const project=mod.exports.reportMomentsValue;
const evidence=n=>({sourceKind:'moments',libraryId:'moments',sourceId:`source-${n}`,quote:`原配文 ${n}：项目中的一个环节`,basis:'caption'});
const findings=Array.from({length:8},(_,n)=>({id:`f${n}`,claim:`原报告第 ${n} 条工作线索`,alternative:'尚不能确定具体工作角色',evidence:[evidence(n)]}));
const interpretations=Array.from({length:6},(_,n)=>({dimension:'生活与工作',reading:`已经保存的具体解释 ${n}`,alternative:'具体职位仍未知',nextStep:`原来保存的接话 ${n}`,evidenceIds:[`f${n}`]}));
const report={semanticHistory:{findings,sourceInsights:{moments:{interpretations}},profileInsights:[{subject:'other',dimension:'工作线索',reading:'原来的独立人物解读',evidenceIds:['f0']},{subject:'self',dimension:'我的生活',reading:'本人资料不能变成对方画像',evidenceIds:['f0']}]},moments:{hypotheses:[{title:'完整推测',possibility:'旧版本保存的完整推测',evidence:'完整的配文依据',verify:'旧版本核实话题'}],photoClues:[{item:'活动现场',inference:'旧版本图片解释',evidence:'可见活动文字'}]},hypotheses:[{title:'外层推测',possibility:'外层保存的旧推测',evidence:'外层原话'}]};
const before=JSON.stringify(report),value=project(report);
assert.equal(value.primary.length,6,'sixth valid interpretation must not disappear');
assert.equal(value.primary[5].nextStep,'原来保存的接话 5');
assert.equal(value.primary[0].evidence[0].quote,evidence(0).quote,'source quote stays exact');
assert.ok(value.other.some(x=>x.reading==='原来的独立人物解读'));
assert.ok(!value.other.some(x=>x.reading.includes('本人资料')));
for(const content of ['旧版本保存的完整推测','旧版本图片解释','外层保存的旧推测','原报告第 7 条工作线索'])assert.ok(value.other.some(x=>x.reading===content),content);
assert.equal(JSON.stringify(report),before,'projection must not mutate saved report');
assert.equal(project({}).primary.length,0,'empty reports do not get invented insight');
assert.equal(project({...report,semanticHistory:{...report.semanticHistory,sourceInsights:{moments:{interpretations:interpretations.map(row=>({...row,alternative:''}))}}}}).primary.length,6,'valid interpretations do not require boilerplate alternatives');
const visual=(sourceId,observation,extra={})=>({libraryId:'photos',sourceId,mediaId:`image-${sourceId}`,kind:'moments',observation,...extra});
const workQuote='会议展板上有项目流程图。';
const visualReport={sourceCoverage:[{kind:'moments',libraryId:'photos'}],mediaEvidence:[
  visual('work',workQuote),visual('work',workQuote),
  visual('object','画面中可见黑色皮包，包上有清楚的字母标志 ACME。'),
  visual('scene','海边照片里有两把折叠椅。'),
  visual('selfie','镜前自拍中可见一件绿色外套。'),
  visual('climb','攀岩场景中可见绳索和岩壁。'),
  visual('cover','封面中有相机、会议、自拍和海边。',{materialRole:'moments-cover'}),
  visual('unread','可见皮包。',{readable:false}),
  visual('unknown','无法识别品牌。没有工作场景。'),
  visual('chat','画面中有钢琴。',{kind:'chat',sourceKind:'chat',libraryId:'chats'}),
],semanticHistory:{findings:[{id:'work',claim:'项目流程是这条工作动态里可聊的具体细节。',evidence:[{sourceId:'work',libraryId:'photos',sourceKind:'moments',basis:'visual',quote:workQuote},{sourceId:'work',libraryId:'photos',sourceKind:'moments',basis:'caption',quote:'刚把这个项目跑通。'}]}],actionPlan:{steps:[{evidenceIds:['work'],action:'这个项目里，哪个环节最费心？'}]}}};
const visualBefore=JSON.stringify(visualReport),visualValue=project(visualReport);
assert.equal(visualValue.visualThreads.length,6,'five observed themes and uncategorized reading limits are retained');
assert.equal(visualValue.featured.length,1,'only the saved judgment and action take a main card');
assert.equal(visualValue.observations.length,6,'observations remain in the secondary album section');
assert.equal(visualValue.visualThreads.find(item=>item.label==='工作与学习').sourceCount,1,'same image source is not a repeated post');
assert.ok(visualValue.featured.some(item=>item.observation===workQuote&&item.nextStep.includes('哪个环节')),'saved finding and action connect to the exact observed image');
const objectClue=visualValue.visualThreads.find(item=>item.label==='物件与消费线索');
assert.equal(objectClue.reading,'','object evidence does not manufacture wealth or ownership inference');
assert.match(objectClue.observation,/黑色皮包/);
assert.equal(objectClue.sourceCount,1,'cover, unread image and negated observations do not become object counts');
assert.ok(visualValue.visualThreads.every(item=>item.evidence.every(source=>!['cover','unread','chat'].includes(source.sourceId))),'only readable ordinary moments contribute');
assert.ok(visualValue.visualThreads.find(item=>item.evidence.some(source=>source.sourceId==='unknown')).category==='其他画面细节','recognition limits are retained without a positive object/work category');
assert.equal(JSON.stringify(visualReport),visualBefore,'enriched view does not rewrite original observations');

// A large selfie album cannot outrank or supply evidence to an unrelated judgment.
const priorityReport={sourceCoverage:[{kind:'moments',libraryId:'photos'}],mediaEvidence:[
 ...Array.from({length:12},(_,i)=>visual(`portrait-${i}`,'镜前自拍中可见绿色外套。')),
 visual('exact','会议展板上写着流程进度。'),
 visual('exact','这里有另一本相册的旅行箱。',{libraryId:'another-album'}),
 visual('work-2','另一条项目动态中可见工位。'),
 visual('exact','没有资料库标识的相机。',{libraryId:''}),
],semanticHistory:{findings:[
 {id:'inference',claim:'她更看重一件事从头到尾落地，这次是很好的具体切入点。',evidence:[{libraryId:'photos',sourceId:'exact',sourceKind:'moments',basis:'caption',quote:'终于完成了。'}]},
 {id:'work-2',claim:'工作项目是她近期反复投入的内容。',evidence:[{libraryId:'photos',sourceId:'work-2',sourceKind:'moments',basis:'caption',quote:'项目继续。'}]},
 {id:'art',claim:'展览里的构图细节比打卡地点更吸引她。',evidence:[evidence('art')]},
 {id:'social',claim:'她安排朋友聚会时会先确认大家方便的时间。',evidence:[evidence('social')]},
 {id:'food',claim:'一起做饭是她主动提到的共同活动。',evidence:[evidence('food')]},
 {id:'climb',claim:'攀岩是她持续参与的活动。',evidence:[evidence('climb')]},
],actionPlan:{steps:[{evidenceIds:['inference'],action:'从开始到落地，哪一步最让你有成就感？'}]}}};
const priorityBefore=JSON.stringify(priorityReport),priority=project(priorityReport);
assert.equal(priority.featured[0].reading,priorityReport.semanticHistory.findings[0].claim,'saved actionable inference wins even without image topic keywords');
assert.match(priority.featured[0].observation,/会议展板/,'caption and image link by exact source, not claim keywords');
assert.equal(priority.featured[0].sourceCount,1,'other-library same IDs and same-topic posts cannot inflate evidence');
assert.ok(priority.featured[0].evidence.every(item=>item.libraryId==='photos'&&item.sourceId==='exact'));
assert.equal(priority.featured.length,4,'at most four distinct saved judgment themes');
assert.ok(priority.featured.every(item=>item.reading||item.nextStep),'no observation-only main cards');
assert.ok(priority.remaining.some(item=>item.reading),'all remaining saved judgments stay expandable');
assert.equal(priority.observations.find(item=>item.label==='自拍与穿搭').sourceCount,12);
assert.equal(JSON.stringify(priorityReport),priorityBefore);
const isolated=project({captureKind:'moments',mediaEvidence:[visual('shared','镜前自拍中可见外套。',{libraryId:'photos'}),visual('unknown','相机放在桌上。',{libraryId:''}),visual('chat-explicit','海边旅行。',{kind:'chat',sourceKind:'chat'})],semanticHistory:{findings:[
 {id:'different-library',claim:'另一资料的已保存判断。',evidence:[{sourceKind:'moments',libraryId:'elsewhere',sourceId:'shared',quote:'原文。'}]},
 {id:'missing-library',claim:'未标资料库的已保存判断。',evidence:[{sourceKind:'moments',sourceId:'unknown',quote:'原文。'}]},
 {id:'different-media',claim:'同帖另一张图的已保存判断。',evidence:[{sourceKind:'moments',libraryId:'photos',sourceId:'shared',mediaId:'different',basis:'visual',quote:'另一图。'}]},
]}});
assert.ok([...isolated.featured,...isolated.remaining].every(item=>!item.observation),'ambiguous or mismatched source identities never attach an image');
assert.ok(isolated.observations.every(item=>item.evidence.every(source=>source.sourceId!=='chat-explicit')),'explicit chat source stays out even on a Moments-only report');
const observationOnlyReport={captureKind:'moments',mediaEvidence:[visual('only','桌上有一只陶杯。')],photoClues:[{item:'服装',observation:'穿绿色外套。',evidence:'原图可见。'},{item:'文字',valueHint:'ACME',evidence:'可见 ACME 字样。'}]};
const observationOnly=project(observationOnlyReport);
assert.equal(observationOnly.featured.length,0,'legacy observation/value fields are not relabelled as inference');
assert.equal(observationOnly.observations.length,3,'legacy facts remain available without a fabricated next step');
assert.ok(observationOnly.observations.every(item=>!item.reading&&!item.nextStep));

// Render the actual section; mock only source-dialog/image IO and legacy advice.
const uiBuild=await build({entryPoints:['components/web-analysis/MomentsValueOverview.tsx'],bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent',external:['react','react/jsx-runtime'],plugins:[{name:'static-evidence-boundaries',setup(build){
 build.onResolve({filter:/\/(CaptureEvidence|ReportEvidenceImage|SocialReadingPanels)$/},args=>({path:args.path,namespace:'evidence-fixture'}));
 build.onLoad({filter:/.*/,namespace:'evidence-fixture'},()=>({contents:`import {createElement} from 'react'; export const CaptureEvidence=()=>null; export const SocialNextAdvice=()=>null; export const ReportEvidenceImage=()=>createElement('i',{'data-fixture-image':true});`,loader:'js'}));
 build.onResolve({filter:/\.module\.css$/},args=>({path:args.path,namespace:'fixture-css'}));
 build.onLoad({filter:/.*/,namespace:'fixture-css'},()=>({contents:'export default {};',loader:'js'}));
}}]});
const uiMod={exports:{}};new Function('module','exports','require',uiBuild.outputFiles[0].text)(uiMod,uiMod.exports,createRequire(import.meta.url));
const render=(report,part='all')=>renderToStaticMarkup(createElement(uiMod.exports.MomentsValueOverview,{report,part}));
const observationHtml=render(observationOnlyReport);
assert.match(observationHtml,/data-moments-observation-only/);
assert.match(observationHtml,/尚未保存对应判断/);
assert.match(observationHtml,/data-moments-observations/);
assert.doesNotMatch(observationHtml,/data-moments-finding|data-reading-kind="inference"|从照片细节，到怎么相处/);
assert.match(render(observationOnlyReport,'lead'),/data-moments-observation-only/,'lead-only page does not pretend facts are insights');
assert.match(render(observationOnlyReport,'rest'),/data-moments-observations/,'all facts remain reachable in the secondary section');
const valueHtml=render(priorityReport),firstImage=valueHtml.indexOf('data-fixture-image');
assert.ok(valueHtml.indexOf(priority.featured[0].reading)<firstImage,'saved judgment appears before the supporting photo');
assert.ok(valueHtml.indexOf(priority.featured[0].nextStep)<firstImage,'concrete saved action appears before the supporting photo');
const photoBuild=await build({entryPoints:['lib/social-photo-clues.ts'],bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'});
const photoMod={exports:{}};new Function('module','exports',photoBuild.outputFiles[0].text)(photoMod,photoMod.exports);
const clean=photoMod.exports.cleanSocialPhotoClues;
const basePhoto={item:'包上文字',evidence:'图2，包上清晰文字为 ACME。'};
assert.equal(clean([{...basePhoto,valueHint:'ACME'}])[0].valueHint,'ACME','readable literal mark survives');
for(const guess of ['售价2万元','消费能力强','ACME 正品','另一品牌'])assert.equal(clean([{...basePhoto,valueHint:guess}])[0].valueHint,'','unreadable prices, ownership/value and authenticity are not image facts');
assert.equal(clean([{...basePhoto,category:'工作',inference:'可聊展板里提到的项目',alternative:''}])[0].alternative,'','no manufactured competing explanation');
if(process.argv[2]){
const actual=JSON.parse(await readFile(process.argv[2],'utf8')).report;
const actualValue=project(actual);
assert.equal(actualValue.primary.length,5);
assert.equal(actualValue.other.filter(x=>x.basis==='saved-profile').length,2);
assert.ok(actualValue.primary.some(x=>x.nextStep.includes('科技生态大会')));
assert.ok(actualValue.primary.some(x=>x.nextStep.includes('追鲸')));
assert.ok(actualValue.crossSource.evidence.some(x=>x.sourceKind==='moments')&&actualValue.crossSource.evidence.some(x=>x.sourceKind==='chat'));
}
console.log('PASS saved Moments value: all interpretations, profiles, legacy hypotheses/photos, original evidence, Audrey topics and cross-source comparison.');
