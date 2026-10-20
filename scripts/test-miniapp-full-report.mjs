import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
const cache=new Map();
function load(path){path=resolve(path);if(!path.endsWith('.js'))path+='.js';if(cache.has(path))return cache.get(path);const m={exports:{}};cache.set(path,m.exports);new Function('require','module','exports',readFileSync(path,'utf8'))(id=>load(resolve(dirname(path),id)),m,m.exports);cache.set(path,m.exports);return m.exports;}
const {historyReport,reportScope,reportGeneratedTime,signalTags}=load('miniapp/lib/history-report.js');
const chatLibrary='cl_'+'a'.repeat(64),momentLibrary='cl_'+'b'.repeat(64);
const chatEvidence={libraryId:chatLibrary,sourceId:'chat-1',sourceKind:'chat',senderRole:'other',quote:'那就周六两点，到了我发消息给你。',at:'2026-10-20'};
const momentEvidence={libraryId:momentLibrary,sourceId:'moment-1',sourceKind:'moments',senderRole:'other',quote:'周末在海边散步。',at:'2026-10-19'};
// Mirrors the saved full-history schema; all names, messages and counts are synthetic.
const full={analysisScope:'fullHistory',captureFormat:'full-history',captureKind:'chat',participants:{other:{label:'合成对象'}},sourceCoverage:[{libraryId:chatLibrary,kind:'chat',total:210,textRead:194},{libraryId:momentLibrary,kind:'moments',total:3,momentCount:3,textRead:3}],decision:{replyOptions:[]},chatActivity:{self:110,other:100,activeDays:2,days:[{date:'2026-10-20',self:110,other:100}],starts:{self:1,other:1},unreadVoices:0},semanticHistory:{summary:'双方正在确认合成活动的时间。',action:'先确认自己的时间再答复。',actionEvidenceIds:['f-chat'],observeWindow:'这次安排前',stopCondition:'对方取消且不再另约时重新判断',coverage:{totalImported:210,analyzedText:194},findings:[{id:'f-chat',subject:'other',claim:'对方给了具体时间。',evidence:[chatEvidence],alternative:'可能只是普通活动安排。'},{id:'f-moment',subject:'other',claim:'动态出现散步生活话题。',evidence:[momentEvidence],alternative:'不能判断同行者。'}],sourceInsights:{moments:{status:'analyzed',summary:'有可接的生活话题。',evidenceIds:['f-moment'],crossSource:{summary:'两个来源都提到活动，但不代表同一次。',evidenceIds:['f-chat','f-moment']},unknowns:['不能确认同行者']}},actionPlan:{steps:[{title:'确认安排',action:'按自己的安排决定是否赴约。',why:'原话提出了具体时间。',evidenceIds:['f-chat'],reply:'周六两点可以。'}]},recentSentenceAnalysis:{scope:'recent',totalReadable:194,sampleCount:12,windowLabel:'最近12句样本；全部194条仍用于整体判断。',lines:Array.from({length:12},(_,i)=>({id:'line-'+i,sourceId:'chat-'+i,sourceKind:'chat',libraryId:chatLibrary,speaker:i%2?'other':'self',text:'合成活动安排原话 '+i,at:'2026-10-20'})),annotations:Array.from({length:12},(_,i)=>({lineId:'line-'+i,emotion:[{label:'平静',probability:.8}],intent:[{label:'确认安排',probability:.7}],note:'仅对这句原话作出的推测'}))}}};
const profile={...structuredClone(full),momentsStatistics:{basis:'capture-records',total:28,excludedProfileMaterials:2,withText:28,pinnedCount:1,previewsAvailable:4,dated:28,undated:0,months:[{month:'2026-10',count:28,sourceRefs:[{libraryId:momentLibrary,sourceId:'moment-1'}]}]},profileMaterials:[{libraryId:momentLibrary,sourceId:'cover',materialRole:'moments-cover'},{libraryId:momentLibrary,sourceId:'signature',materialRole:'profile-signature',text:'合成签名'}],mediaEvidence:[{libraryId:chatLibrary,sourceId:'chat-image',kind:'chat',observation:'聊天图里有活动海报。'},{libraryId:momentLibrary,sourceId:'moment-1',kind:'moments',observation:'预览图里有海边步道。'},{libraryId:momentLibrary,sourceId:'cover',kind:'moments',materialRole:'moments-cover',observation:'封面是合成风景。'}]};
full.generatedAt='2026-10-21T06:30:00.000Z';
const finding=full.semanticHistory.findings[0];
full.decision.replyOptions=[{text:'那就周六两点，到时见。',style:'确认安排',reason:'接住明确时间',evidenceIds:[finding.id]},{text:'我看一下时间，晚上给你答复。',style:'留点余地',reason:'保留安排空间',evidenceIds:[finding.id]}];
let value=historyReport(full);
assert.equal(value.scope.label,'完整关系报告');assert.match(value.generatedTime,/2026-10-21 14:30/);
assert.equal(value.coverage.totalImported,210);assert.equal(value.recent.lines.length,12);assert.equal(value.recent.totalReadable,194);assert.equal(value.recent.lines[0].emotionTags[0].probability,.8);
assert.equal(value.replies.length,2);assert.equal(value.replies[0].text,full.decision.replyOptions[0].text);assert.ok(value.replies[0].evidence[0].quote,'references resolve to actual quotes, not finding wrappers');
assert.ok(value.moments.length>=1);assert.ok(value.crossSource);assert.ok(value.actionOverview?.evidence.length);assert.ok(value.actionOverview.evidence.every(e=>e.quote));
const stats=historyReport(profile);assert.equal(stats.momentsStatistics.total,28);assert.equal(stats.momentsStatistics.excludedProfileMaterials,2);assert.equal(stats.momentsStatistics.previewsAvailable,4);assert.equal(stats.profileMaterials.length,2);assert.ok(stats.visuals.every(v=>!['moments-cover','profile-signature'].includes(v.materialRole)));assert.ok(stats.visuals.some(v=>v.kindLabel==='聊天'));
const old={...full,momentsStatistics:undefined,sourceCoverage:[]};assert.equal(historyReport(old).momentsStatistics,null);
assert.equal(historyReport({...full,captureKind:'moments'}).scope.label,'完整朋友圈报告');
assert.equal(reportScope({lines:[]}).label,'本次截图解读');assert.match(reportScope({lines:[]}).note,/不代表全部聊天/);
assert.match(reportScope({analysisScope:'supplement'}).note,/不重新统计全部历史/);
assert.equal(reportGeneratedTime({}), '');assert.equal(reportGeneratedTime({createdAt:'bad'}),'');
assert.deepEqual(signalTags('含蓄回应'),[{label:'含蓄回应'}]);assert.equal(signalTags([{label:'投入',weight:80}])[0].probability,.8);assert.equal(signalTags([{label:'未知',probability:8}])[0].probability,null);
const recentWithMoment=structuredClone(full);recentWithMoment.semanticHistory.recentSentenceAnalysis.lines.push({id:'fake-moment',text:'这是朋友圈',sourceKind:'moments'});assert.equal(historyReport(recentWithMoment).recent.lines.length,12);
const missingReplies=structuredClone(full);missingReplies.decision.replyOptions=[];assert.deepEqual(historyReport(missingReplies).replies,[]);missingReplies.semanticHistory.actionPlan.steps[0].reply='顺序步骤不当备选';assert.deepEqual(historyReport(missingReplies).replies,[]);
const subjectId='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',parentId='33333333-3333-4333-8333-333333333333';
let currentReport={...full,id,subjectId},currentKind='chat',calls=[],navigation=[],copied=[],confirm=false,definition;
const wx={getStorageSync:()=>({token:'synthetic-token',expiresAt:Date.now()+60000}),setClipboardData:o=>{copied.push(o.data);o.success?.();},navigateTo:o=>navigation.push(o.url),navigateBack:()=>navigation.push('back'),redirectTo:o=>navigation.push(o.url),showModal:o=>o.success({confirm}),removeStorageSync:()=>{throw Error('unexpected logout');}};
const api={STORAGE:'synthetic',session:async()=>({token:'synthetic-token'}),newId:async()=>id,request:async(path,method,body)=>{calls.push({path,method,body});if(path==='/api/miniapp/report?id='+id)return {report:structuredClone(currentReport),reportId:id,subjectId,kind:currentKind,createdAt:'2026-10-21T06:30:00Z'};if(path==='/api/miniapp/profile')return {enabled:false};if(path==='/api/miniapp/rewrite')return {text:'调整后的原话',status:'adjusted',note:'合成结果'};throw Error('Unexpected request '+path);}};
new Function('require','Page','wx',readFileSync('miniapp/pages/report/index.js','utf8'))(key=>key==='../../lib/api'?api:key==='../../lib/followup-context'?{openReportFollowup:async()=>{}}:load(resolve('miniapp/pages/report',key)),def=>definition=def,wx);
const page={...definition,data:structuredClone(definition.data),setData(data,cb){for(const [key,v]of Object.entries(data)){const parts=key.split('.');let dest=this.data;while(parts.length>1)dest=dest[parts.shift()];dest[parts[0]]=v;}cb?.();}};
page._id=id;await page.refresh();assert.equal(page.data.phase,'ready');assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.equal(page.data.report.fullHistory.replies.length,2);
page.chooseReply({currentTarget:{dataset:{index:1}}});assert.equal(page.data.replyFilter,1);assert.equal(calls.length,1);
page.copyReply({currentTarget:{dataset:{index:1}}});assert.equal(copied.at(-1),full.decision.replyOptions[1].text);assert.equal(calls.length,1);
page.supplement({currentTarget:{dataset:{kind:'moments'}}});assert.equal(navigation.at(-1),'/pages/social-profile/index?subjectId='+subjectId+'&returnReportId='+id+'&materialType=moments');
page.supplement({currentTarget:{dataset:{kind:'chat'}}});assert.match(navigation.at(-1),/pages\/quick\/index/);assert.equal(calls.length,1);
currentReport={id,analysisScope:'supplement',subjectId,lines:[{id:'l1',speaker:'other',text:'合成原话'}],annotations:[{lineId:'l1',intent:'确认安排',emotion:[{label:'开心',weight:80}]}],decision:{replyOptions:[{text:'那就这么定了',style:'确认'}]},supplementOf:{reportId:parentId,generatedAt:'2026-10-20T03:00:00Z'}};
await page.refresh();assert.equal(page.data.report.fullHistory,null);assert.equal(page.data.report.scope.label,'补充截图解读');assert.match(page.data.report.parentGeneratedTime,/2026-10-20 11:00/);assert.equal(page.data.report.lines[0].emotionTags[0].probability,.8);assert.equal(page.data.report.lines[0].intentTags[0].label,'确认安排');
page.parentReport();assert.equal(navigation.at(-1),'/pages/report/index?id='+parentId);
page.data.report.canPersonalize=true;const before=calls.length;await page.personalize({currentTarget:{dataset:{index:0}}});assert.equal(calls.length,before,'cancelled rewrite never submits');
confirm=true;await page.personalize({currentTarget:{dataset:{index:0}}});assert.equal(calls.at(-1).path,'/api/miniapp/rewrite');assert.equal(calls.at(-1).body.confirmed,true);
for(const kind of ['moments','social']){
 currentKind=kind;currentReport={summary:'合成社交资料',analysisScope:'screenshots'};const previous=navigation.length;await page.refresh();assert.equal(navigation.length,previous+1);assert.equal(navigation.at(-1),'/pages/social-profile/index?reportId='+id,'ordinary social/Moments must open their native reader');
 currentReport={...currentReport,analysisScope:'supplement',supplementOf:{reportId:parentId,scope:'fullHistory'}};await page.refresh();assert.equal(navigation.at(-1),'/pages/social-profile/index?reportId='+id,'social supplements also use the native social reader');
}
currentKind='moments';currentReport={...full,captureKind:'moments'};const previousNavigation=navigation.length;await page.refresh();assert.equal(navigation.length,previousNavigation,'full-history Moments stays in the complete-report reader');assert.ok(page.data.report.fullHistory);assert.equal(page.data.report.subjectId,subjectId,'saved report outer subject is preserved for supplement navigation');
let component;new Function('Component','wx',readFileSync('miniapp/components/history-report/index.js','utf8'))(v=>component=v,wx);
const comp={...component.methods,data:{...structuredClone(component.data),value},setData(next){Object.assign(this.data,next);}};
component.observers.value.call(comp,{...value,momentsOnly:true});assert.equal(comp.data.detail,'moments');comp.detail({currentTarget:{dataset:{detail:'recent'}}});assert.equal(comp.data.detail,'recent');comp.copy({currentTarget:{dataset:{text:'完整报告的原回复'}}});assert.equal(copied.at(-1),'完整报告的原回复');
let tags;new Function('Component',readFileSync('miniapp/components/signal-tags/index.js','utf8'))(v=>tags=v);const view={setData(next){this.data=next;}};tags.observers.tags.call(view,[{label:'开心',weight:80},{label:'待核对',probability:null}]);assert.deepEqual(view.data.rows.map(r=>r.display),['80%','待判断']);
const markup=readFileSync('miniapp/components/history-report/index.wxml','utf8'),pageMarkup=readFileSync('miniapp/pages/report/index.wxml','utf8');
assert.doesNotMatch(markup,/<scroll-view[^>]*scroll-y/);assert.match(markup,/value\.momentsStatistics\.months/);assert.match(markup,/value\.visuals/);assert.match(markup,/value\.actionOverview/);assert.match(markup,/value\.recent\.lines/);assert.match(markup,/value\.legacyGroups/);assert.match(pageMarkup,/返回原完整报告/);
if(process.argv.includes('--compiled-wxml')){
 const errors=[],host={window:{},console:{log(){},warn:message=>errors.push(message)},__wxAppData:{},__wxAppCode__:{},__WXML_GLOBAL__:{}};
 vm.runInNewContext(readFileSync('.tmp/miniapp-report-wxml.js','utf8'),host);
 const render=host.$gwx('components/history-report/index.wxml'),flatten=node=>typeof node==='string'?node:(node?.children||[]).map(flatten).join('\n');
 const renderText=(value,detail)=>flatten(render({value,tab:'now',detail,expanded:{firstAction:true,reply0:true},replyFilter:-1},{},{}));
 const overview=renderText(value,'interaction');assert.match(overview,/确认安排/);assert.match(overview,/那就周六两点，到了我发消息给你/);assert.match(overview,/2026-10-21 14:30/);
 const moments=renderText(historyReport(profile),'moments');assert.match(moments,/28/);assert.match(moments,/预览画面不等于原照片数量/);assert.match(moments,/海边步道/);assert.match(moments,/合成签名/);
 const recent=renderText(value,'recent');assert.match(recent,/最近12句样本/);assert.match(recent,/合成活动安排原话 11/);
 assert.deepEqual(errors,[],'real WXML compiler runtime reports no binding/template error');
 console.log('PASS real WeChat WXML compiler + synthetic rendering of overview, Moments, and recent sentences');
}
console.log('PASS miniapp saved full-report, Moments, evidence mapping, scope/time, percentages, genuine replies, copy/filter, supplement return, no implicit analysis, rewrite consent');

