import type {CaptureBatch,CaptureCoverage} from './desktop-capture';

export type MomentsAttempt={jobId:string;startedAt:number;entryKey?:string;friend:string;contactId:string;accountKey:string;allVisible:boolean;status:'running'|'complete'|'partial'|'empty'|'failed'|'stale';received:number;added:number;repeated:number;total:number;libraryId?:string;coverage?:CaptureCoverage;detail:string};
export function momentsEntryKey(params:URLSearchParams){return JSON.stringify(['kind','subjectId','libraryId','intent','contactSearch'].map(key=>params.get(key)||''));}
/** Completion belongs to the current job payload, never to accumulated library size. */
export function momentsOutcome(batch:CaptureBatch,attempt:MomentsAttempt,interim=false):Pick<MomentsAttempt,'status'|'received'|'coverage'|'detail'>{
 const received=Array.isArray(batch.records)?batch.records.length:0,at=Date.parse(batch.capturedAt);
 if(batch.kind!=='moments'||!Number.isFinite(at)||at<attempt.startedAt-10000||at>Date.now()+60000)return {status:'stale',received:0,detail:'助手返回的不是这次朋友圈任务的有效结果，请重新采集。旧材料没有计入本次结果。'};
 if(!received)return {status:interim?'running':'empty',received:0,coverage:batch.coverage,detail:interim?'正在读取朋友圈，尚未收到动态。':'这次没有读到朋友圈。请确认已打开所选好友的朋友圈，再重试；已有材料没有算作这次成功。'};
 const coverage=batch.coverage;
 if(interim)return {status:'running',received,coverage,detail:`这次已读到 ${received} 条动态，仍在采集中。`};
 const complete=received>=attempt.received&&!!coverage&&coverage.recordCount===received&&coverage.unreadableCount===0&&coverage.imageOmittedCount===0&&(attempt.allVisible?coverage.scope==='all-visible'&&coverage.complete&&coverage.stopReason==='visible-end':coverage.complete||coverage.scope==='requested-count'&&coverage.stopReason==='requested-count');
 return {status:complete?'complete':'partial',received,coverage,detail:complete?attempt.allVisible?'已确认采集到这位好友的可见末尾。':'所选数量已采集，未代表全部朋友圈。':`这次读到 ${received} 条，但尚未确认采集完整。${coverage?.unreadableCount?`有 ${coverage.unreadableCount} 条未能读取。`:''}${coverage?.imageOmittedCount?`有 ${coverage.imageOmittedCount} 张配图未保存。`:''}已读原文会保留，可继续重试。`};
}
