import type {CaptureBatch,CaptureCoverage} from './desktop-capture';
import {captureMaterialCounts} from './capture-material';

export type MomentsAttempt={jobId:string;startedAt:number;entryKey?:string;friend:string;contactId:string;accountKey:string;allVisible:boolean;status:'running'|'complete'|'partial'|'empty'|'failed'|'stale';received:number;momentCount?:number;profileMaterialCount?:number;added:number;repeated:number;total:number;libraryId?:string;coverage?:CaptureCoverage;detail:string};
export function momentsEntryKey(params:URLSearchParams){return JSON.stringify(['kind','subjectId','libraryId','intent','contactSearch'].map(key=>params.get(key)||''));}
export function isMacMomentsCacheOnly(health:{platform?:string;capabilities?:{momentsCached?:boolean;momentsAllVisible?:boolean}}|null|undefined){
 return health?.platform==='darwin'&&health.capabilities?.momentsCached===true&&health.capabilities.momentsAllVisible!==true;
}
export function momentsRequestScope(health:Parameters<typeof isMacMomentsCacheOnly>[0],allVisible:boolean){
 const cacheOnly=isMacMomentsCacheOnly(health);
 return {cacheOnly,allVisible:cacheOnly?false:allVisible,actionLabel:cacheOnly?'导入已加载的朋友圈':allVisible?'导入全部可见朋友圈':'开始采集朋友圈'};
}
/** Completion belongs to the current job payload, never to accumulated library size. */
export function momentsOutcome(batch:CaptureBatch,attempt:MomentsAttempt,interim=false):Pick<MomentsAttempt,'status'|'received'|'coverage'|'detail'|'momentCount'|'profileMaterialCount'>{
 const received=Array.isArray(batch.records)?batch.records.length:0,at=Date.parse(batch.capturedAt);
 if(batch.kind!=='moments'||!Number.isFinite(at)||at<attempt.startedAt-10000||at>Date.now()+60000)return {status:'stale',received:0,detail:'助手返回的不是这次朋友圈任务的有效结果，请重新采集。旧材料没有计入本次结果。'};
 if(!received)return {status:interim?'running':'empty',received:0,coverage:batch.coverage,detail:interim?'正在读取朋友圈，尚未收到动态。':batch.coverage?.scope==='local-cache'?'本机尚未缓存这位好友的动态。先在 Mac 微信打开并浏览这位好友的朋友圈，再更新缓存；也可以直接上传朋友圈截图。':'这次没有读到朋友圈。请确认已打开所选好友的朋友圈，再重试；已有材料没有算作这次成功。'};
 const coverage=batch.coverage;
 const counts=captureMaterialCounts(batch.records),scope=`${counts.momentCount} 条动态${counts.profileMaterialCount?`及 ${counts.profileMaterialCount} 项封面／签名资料`:''}`;
 if(interim)return {status:'running',received,coverage,...counts,detail:`这次已读到 ${scope}，仍在采集中。`};
 if(coverage?.scope==='local-cache')return {status:'partial',received,coverage,...counts,detail:`已保存本机加载过的 ${scope}。尚未自动扫描全部可见历史。${coverage.imageOmittedCount?`其中 ${coverage.imageOmittedCount} 项图片或视频未读取画面。`:''}${coverage.unreadableCount?`有 ${coverage.unreadableCount} 条缓存结构未识别。`:''}可以使用已有正文继续；在微信加载更多后再更新缓存。`};
 if(!counts.momentCount)return {status:'partial',received,coverage,...counts,detail:'本次只读到封面或签名，尚未读到朋友圈动态。资料已保留，可以重试采集动态。'};
 // Coverage counts posts. Cover/signature records are supporting profile
 // material, so comparing recordCount against all records falsely marks every
 // complete album containing profile material as partial.
 const complete=received>=attempt.received&&!!coverage&&coverage.recordCount===counts.momentCount&&coverage.unreadableCount===0&&coverage.imageOmittedCount===0&&(attempt.allVisible?coverage.scope==='all-visible'&&coverage.complete&&coverage.stopReason==='visible-end':coverage.complete||coverage.scope==='requested-count'&&coverage.stopReason==='requested-count');
 return {status:complete?'complete':'partial',received,coverage,...counts,detail:complete?attempt.allVisible?'已确认采集到这位好友的可见末尾。':'所选数量已采集，未代表全部朋友圈。':`这次读到 ${scope}，但尚未确认采集完整。${coverage?.stopReason==='navigation-stalled'?'微信列表未能继续翻页。':''}${coverage?.unreadableCount?`有 ${coverage.unreadableCount} 条未能读取。`:''}${coverage?.imageOmittedCount?`有 ${coverage.imageOmittedCount} 张配图未保存。`:''}已读原文会保留，可继续重试。`};
}

/** Only final, source-verified batches may continue; incomplete coverage stays explicit. */
export function canContinueMoments(attempt:MomentsAttempt|null|undefined){
 return !!attempt && (attempt.status==='complete'||attempt.status==='partial') && attempt.received>0 && !!attempt.libraryId;
}
