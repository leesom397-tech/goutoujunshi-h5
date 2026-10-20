import assert from 'node:assert/strict';
import {build} from 'esbuild';
const mocks=new Map([
 ['cloudflare:workers','export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}'],
 ['app','export default {}'],
 ['credits','export const CREDIT_PRICES={};export const reserveCredits=()=>{throw Error("No billing permitted")};export const finishCreditTask=()=>{throw Error("No billing permitted")};'],
 ['saved','export const beginSavedReport=()=>{};export const readAnalysisReport=async(_db,owner,id)=>globalThis.__captureReportStateReports.get(owner+":"+id)||null;'],
]);
const built=await build({stdin:{contents:"export {CaptureHistoryJobs} from './lib/capture-history-jobs.mjs';export * from './lib/capture-report-state.ts';export {captureCoverage} from './lib/capture-coverage.ts';export {captureVoiceTargets} from './lib/capture-voice-targets.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'synthetic-services',setup(builder){builder.onResolve({filter:/.*/},args=>{const key=args.path==='cloudflare:workers'?args.path:/dist\/server\/index\.js$/.test(args.path)?'app':args.path==='./account-credits.mjs'?'credits':args.path==='./saved-reports.mjs'?'saved':null;return key?{path:key,namespace:'mock'}:undefined;});builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks.get(args.path)}));}}]});
const {CaptureHistoryJobs,captureMaterialVersion,captureMaterialChanged,captureCoverage,captureVoiceTargets}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const values=new Map(),reports=new Map();globalThis.__captureReportStateReports=reports;
let alarm=1;
const storage={async get(key){return structuredClone(values.get(key));},async list(){return new Map([...values].map(([k,v])=>[k,structuredClone(v)]));},async getAlarm(){return alarm;},async setAlarm(value){alarm=value;},async put(key,value){values.set(key,structuredClone(value));},async transaction(run){return run(storage);}};
const jobs=new CaptureHistoryJobs({storage},{DB:{}});
const job=(taskId,libraryId,subjectId,status,createdAt)=>({taskId,owner:'owner',input:{libraryId,subjectId,kind:'chat',friend:'同名人物',expectedEpoch:2,expectedTotal:13},manifest:{primary:{id:libraryId,epoch:2,revision:7},related:[{libraryId:'moments-'+subjectId,kind:'moments',epoch:2,total:5,revision:3}]},status,createdAt,updatedAt:createdAt+1000,completedAt:status==='done'?createdAt+500:undefined,creditFinished:true});
for(const value of [job('old-report','library-a','subject-a','done',1000),job('running-other','library-b','subject-b','running',3000),{...job('foreign-report','library-a','subject-a','running',4000),owner:'foreign'}]){values.set('job:'+value.taskId,value);reports.set(value.owner+':'+value.taskId,{report:{summary:'Synthetic report only'}});}
const a=await jobs.status('owner',undefined,{libraryId:'library-a',subjectId:'subject-a',summaryOnly:true});
assert.equal(a.taskId,'old-report','the current person is not replaced by another running report');
assert.equal(a.result,undefined,'polling does not repeatedly download the full report');
assert.equal(a.completedAt,1500,'finish time survives later settlement updates');
assert.deepEqual(a.primarySnapshot,{libraryId:'library-a',expectedEpoch:2,expectedTotal:13,revision:7});
assert.equal(a.relatedSnapshots[0].libraryId,'moments-subject-a');
assert.equal(await jobs.status('owner','running-other',{libraryId:'library-a'}),null,'task id cannot bypass source scope');
assert.equal(await jobs.status('owner','foreign-report'),null,'another owner is never visible');
assert.equal(await jobs.status('owner',undefined,{libraryId:'library-a',subjectId:'subject-b'}),null,'same names do not bypass subject identity');
assert.equal((await jobs.status('owner','old-report')).result.summary,'Synthetic report only','explicit legacy callers can still retrieve their report');
await jobs.outcome('job:running-other',{status:'done'});
const before=values.get('job:running-other').completedAt;
await jobs.outcome('job:running-other',{creditFinished:true});assert.equal(values.get('job:running-other').completedAt,before);
const library={id:'local-a',updatedAt:'2026-01-01T00:00:00Z',cloud:{id:'cloud-a',epoch:1},records:[{localId:'voice-1',kind:'other',senderRole:'other',at:'2026-01-01',text:'[语音]',source:{mediaKind:'voice',transcriptionStatus:'failed',voiceAvailability:'available'}}]};
const initial=await captureMaterialVersion(library);
const same={...library,updatedAt:'2026-01-02T00:00:00Z',records:library.records.map(row=>({...row,source:{...row.source,capturedAt:'2026-01-02'}}))};
assert.equal(captureMaterialChanged(initial,[],await captureMaterialVersion(same),[]),false,'sync/collection timestamps alone do not ask for reanalysis');
const changed={...same,records:[{...library.records[0],text:'周六我来订餐厅。',kind:'text',source:{mediaKind:'voice',transcriptionStatus:'visible-text'}}]};
assert.equal(captureMaterialChanged(initial,[],await captureMaterialVersion(changed),[]),true,'same-count voice correction is new evidence');
assert.equal(captureMaterialChanged(initial,[],initial,[{...initial,libraryId:'moments'}]),true,'new Moments are distinct from the prior report');
const coverage=captureCoverage(library.records);assert.equal(coverage.voiceFailed,1);assert.equal(coverage.voiceAvailable,0);assert.equal(coverage.unreadVoice,1);
const voices=[{source:{method:"wechat-local-db",mediaKind:"voice",transcriptionStatus:"failed",messageShard:"message_0.db",messageId:"failed"}},{source:{method:"wechat-local-db",mediaKind:"voice",transcriptionStatus:"visible-text",messageShard:"message_0.db",messageId:"done"}},{source:{method:"wechat-local-db",mediaKind:"voice",transcriptionStatus:"pending",messageShard:"message_0.db",messageId:"pending"}}];
assert.deepEqual(captureVoiceTargets(voices).map(value=>value.messageId),["pending"],"automatic import never loops failed/completed voice targets");
assert.deepEqual(captureVoiceTargets(voices,true).map(value=>value.messageId),["failed","pending"],"explicit voice retry includes failed IDs but never rereads all chat");
delete globalThis.__captureReportStateReports;
console.log('PASS scoped report status/owner isolation, lightweight polling, immutable completion time, material-change detection, and terminal voice failure counts.');
