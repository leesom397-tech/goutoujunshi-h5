import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
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
assert.equal(visualValue.visualThreads.length,5,'five observed themes are retained, without fabricated image analysis');
assert.equal(visualValue.featured.length,4,'first screen stays at four distinct clues');
assert.ok(visualValue.remaining.length,'remaining observed themes remain expandable');
assert.equal(visualValue.visualThreads.find(item=>item.label==='工作与学习').sourceCount,1,'same image source is not a repeated post');
assert.ok(visualValue.featured.some(item=>item.observation===workQuote&&item.nextStep.includes('哪个环节')),'saved finding and action connect to the exact observed image');
const objectClue=visualValue.visualThreads.find(item=>item.label==='物件与消费线索');
assert.equal(objectClue.reading,'','object evidence does not manufacture wealth or ownership inference');
assert.match(objectClue.observation,/黑色皮包/);
assert.equal(objectClue.sourceCount,1,'cover, unread image and negated observations do not become object counts');
assert.ok(visualValue.visualThreads.every(item=>item.evidence.every(source=>!['cover','unread','unknown','chat'].includes(source.sourceId))),'only readable ordinary moments contribute');
assert.equal(JSON.stringify(visualReport),visualBefore,'enriched view does not rewrite original observations');
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
